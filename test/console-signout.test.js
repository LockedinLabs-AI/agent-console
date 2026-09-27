import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync(new URL("../public/console.js", import.meta.url), "utf8").replace(/\r\n/gu, "\n");
function body(name, async = false) {
  const start = source.indexOf(`  ${async ? "async " : ""}function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n  }\n", start) + 4);
}

// Hold an already-authorized response at JSON decoding, not just at fetch.
// A cache clear alone is insufficient if this continuation can refill it.
for (const name of ["poll", "loadProjects", "loadFold"]) {
  test(`${name} discards a response decoded after sign-out`, async () => {
    let release, started;
    const ready = new Promise((resolve) => { started = resolve; });
    const delayed = new Promise((resolve) => { release = resolve; });
    let painted = 0, scheduled = 0;
    const el = { innerHTML: "", tBodies: [{ innerHTML: "" }] };
    const classes = new Set();
    const context = vm.createContext({
      signOutStarted: false, pollTimer: null, D: { lanes: [] }, projCache: { projects: [] },
      foldFetched: { key: null, at: 0, data: null, error: null }, period: "24h",
      $: () => el, document: { body: { classList: {
        contains: (name) => classes.has(name), add: (name) => classes.add(name), remove: (name) => classes.delete(name),
      } } },
      clearTimeout() {}, setTimeout() { scheduled++; }, performance: { now: () => 10 }, HEADERS: {}, POLL_MS: 2000,
      fetch: async () => ({ status: 200, ok: true, json() { started(); return delayed; } }),
      onData() { painted++; }, paintFold() { painted++; }, toast() { painted++; },
      summary() {}, serverNow: () => 1, laneTotal: () => 0, showUnavailable: false,
      fillRows: new Map(), coldRows: new Map(), offline: false,
    });
    const pending = vm.runInContext(body(name, true) + `\n${name}();`, context);
    await ready;
    context.signOutStarted = true;
    classes.add("signed-out");
    context.D = null; context.projCache = null;
    context.foldFetched = { key: null, at: 0, data: null, error: null };
    release({ privateMarker: "synthetic late response" });
    await pending;
    assert.equal(context.D, null);
    assert.equal(context.projCache, null);
    assert.equal(context.foldFetched.data, null);
    assert.equal(context.foldFetched.error, null);
    assert.equal(painted, 0);
    assert.equal(scheduled, 0);
  });
}

test("signed-out entry points do not open, render, fetch or change view", async () => {
  const context = vm.createContext({ signOutStarted: true });
  for (const name of ["openAdd", "openInspect", "openSheet", "openTree", "fillLane", "showContext", "focusLane", "show", "setPeriod", "setPresent", "onData", "frame", "startLoop", "palRun"]) {
    // No DOM or payload dependencies are available: the guard must run first.
    vm.runInContext(body(name) + `\n${name}();`, context);
  }
  vm.runInContext(body("palOpen") + "\npalOpen(true);", context);
  assert.equal(vm.runInContext(body("palItems") + "\npalItems().length;", context), 0);
  for (const name of ["poll", "loadProjects", "loadFold"]) {
    await vm.runInContext(body(name, true) + `\n${name}();`, context);
  }
});
