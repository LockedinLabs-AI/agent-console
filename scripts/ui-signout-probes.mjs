import assert from "node:assert/strict";

// Owned demo data only. Hold decoded responses to cover the race where fetch
// succeeded before logout but its JSON resolves after browser state was reset.
export async function probeSignOut({ browser, hub, signInUrl, settled, shot, ok }) {
  const marker = "signout-synthetic-private-";
  for (const width of [1440, 390]) for (const mode of ["retry", "expired"]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
    const errors = [];
    let signouts = 0, expired = false;
    try {
      await context.addInitScript(() => {
        const nativeFetch = window.fetch.bind(window);
        const probe = window.__signoutProbe = { hold: false, waiting: [], completed: 0 };
        probe.release = () => { for (const done of probe.waiting.splice(0)) done.release(); };
        window.fetch = async (...args) => {
          const response = await nativeFetch(...args);
          const path = new URL(typeof args[0] === "string" ? args[0] : args[0].url, location.href).pathname;
          if (["/api/console", "/api/projects", "/api/invitations"].includes(path)) {
            const json = response.json.bind(response);
            response.json = async () => {
              const data = await json();
              if (probe.hold) await new Promise((release) => probe.waiting.push({ path, release }));
              probe.completed++;
              return data;
            };
          }
          return response;
        };
      });
      await context.route(/\/api\/console(?:\?|$)/u, async (route) => {
        if (expired) return route.fulfill({ status: 401, json: { error: "unauthorized" } });
        const response = await route.fetch(), data = await response.json();
        data.devices[0].label = marker + "machine";
        data.people[0].person = marker + "person";
        data.hub.networkCommand = marker + "restart-command";
        await route.fulfill({ response, json: data });
      });
      await context.route(/\/api\/projects(?:\?|$)/u, async (route) => {
        const response = await route.fetch(), data = await response.json();
        assert.ok(data.projects.length, "the demo must have a project to seed");
        data.projects[0].name = marker + "project";
        await route.fulfill({ response, json: data });
      });
      await context.route(/\/api\/invitations$/u, (route) => route.fulfill({ json: {
        invitation: { id: "synthetic-invitation", person: marker + "person", machine: marker + "machine", expiresAt: Date.now() + 60000 },
        link: "http://example.invalid/#synthetic-code.synthetic-fingerprint",
        code: "synthetic-code", command: "synthetic-command synthetic-code", typed: "synthetic-command synthetic-code", demo: true,
      } }));
      await context.route(/\/api\/signout$/u, (route) => {
        signouts++;
        return route.fulfill(signouts === 1 ? { status: 503, json: { ok: false, reason: "Synthetic storage failure. Retry sign-out." } } : { json: { ok: true } });
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(await signInUrl(hub), { waitUntil: "domcontentloaded" });
      await page.goto(hub.base + "/", { waitUntil: "domcontentloaded" });
      await settled(page);
      await page.locator('[data-view="projects"].tab').click();
      await page.waitForFunction((needle) => document.getElementById("projTable").textContent.includes(needle), marker + "project");
      await page.locator("#palBtn").click();
      await page.waitForFunction((needle) => document.getElementById("palres").textContent.includes(needle), marker + "machine");
      await page.keyboard.press("Escape");

      if (mode === "retry") {
        await page.evaluate(() => { window.__signoutProbe.hold = true; });
        await page.locator('[data-view="projects"].tab').click();
        await page.locator("#addBtn").click();
        await page.locator("#fPerson").fill(marker + "person");
        await page.locator("#fMachine").fill(marker + "machine");
        assert.equal(await page.locator("#linkField").getAttribute("type"), "password");
        await page.locator("#createBtn").click();
        await page.waitForFunction(() => ["/api/console", "/api/projects", "/api/invitations"].every((path) => window.__signoutProbe.waiting.some((item) => item.path === path)));
        await page.keyboard.press("Escape");
        await page.locator("#signOutBtn").click();
        await page.waitForSelector("#retrySignOut:visible");
      } else {
        expired = true;
        await page.waitForSelector("#signedOut:visible");
      }

      const assertPrivateStateCleared = async () => {
        const state = await page.evaluate((needle) => ({
          privateInDOM: document.documentElement.outerHTML.includes(needle),
          privateInInput: [...document.querySelectorAll("input, textarea")].some((el) => el.value.includes(needle)),
          joinValue: document.getElementById("linkField").value,
          openDialogs: document.querySelectorAll("dialog[open]").length,
          signedOut: !document.getElementById("signedOut").hidden,
          overflow: document.documentElement.scrollWidth > innerWidth,
        }), marker);
        assert.deepEqual(state, { privateInDOM: false, privateInInput: false, joinValue: "", openDialogs: 0, signedOut: true, overflow: false });
      };
      await assertPrivateStateCleared();
      await page.keyboard.press("Control+k");
      await page.keyboard.press("Meta+k");
      await page.keyboard.press("3");
      // Exercise a stale click listener as well as real keyboard navigation.
      await page.locator("#palBtn").evaluate((el) => el.click());
      for (const hash of ["#projects/add", "#team/person/blocked", "#console/alerts"]) {
        await page.evaluate((value) => { location.hash = value; }, hash);
        await page.waitForFunction(() => !location.hash);
      }
      if (mode === "retry") {
        await page.evaluate(() => { window.__signoutProbe.hold = false; window.__signoutProbe.release(); });
        await page.waitForTimeout(100); // let already-queued async continuations finish
        await assertPrivateStateCleared();
        const retry = await page.locator("#retrySignOut").boundingBox();
        assert.ok(retry.height >= 44, "retry remains a usable phone target");
        await shot(page, `signout-retry-${width}`);
        await page.locator("#retrySignOut").click();
        await page.waitForSelector("#printSignIn:visible");
        assert.equal(signouts, 2);
      }
      await assertPrivateStateCleared();
      assert.deepEqual(errors, [], "no script errors during teardown or delayed continuations");
      ok(`${width} ${mode}: private DOM cleared; late responses, shortcuts and deep links cannot reopen the console`);
    } finally { await context.close(); }
  }
}
