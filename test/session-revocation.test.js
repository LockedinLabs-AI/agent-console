import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAdmin } from "../lib/hub/admin.js";
import { createConsoleHandler } from "../lib/hub/routes.js";

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-console-revocation-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const admin = createAdmin({ dir });
  const request = (cookie) => ({ method: "POST", url: "/api/signout",
    headers: { cookie, host: "127.0.0.1", "x-agent-console": "1" }, socket: { remoteAddress: "127.0.0.1" } });
  const first = request(admin.startSession().split(";")[0]);
  const other = request(admin.startSession().split(";")[0]);
  const handler = createConsoleHandler({ config: {}, admin });
  const signOut = async (req = first) => {
    const response = {};
    await handler.handle(req, {
      writeHead(status, headers) { Object.assign(response, { status, headers }); },
      end(body) { response.body = JSON.parse(body); },
    });
    return response;
  };
  return { dir, admin, first, other, signOut, sessions: path.join(dir, "sessions.json") };
}

for (const [method, code] of [["openSync", "EACCES"], ["writeFileSync", "ENOSPC"], ["renameSync", "EACCES"]]) {
  test(`sign-out reports ${code} during ${method}, denies the live session, and persists its retry`, async (t) => {
    const f = fixture(t);
    const original = fs.readFileSync(f.sessions, "utf8");
    const operation = fs[method];
    const fault = t.mock.method(fs, method, (...args) => {
      const sessionWrite = method === "writeFileSync" ? typeof args[0] === "number"
        : method === "renameSync" ? args[1] === f.sessions : String(args[0]).startsWith(f.sessions + ".");
      if (sessionWrite) throw Object.assign(new Error("synthetic private path must not reach the response"), { code });
      return operation(...args);
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const failed = await f.signOut();
      assert.equal(failed.status, 503);
      assert.equal(failed.body.ok, false);
      assert.match(failed.body.reason, /could not be saved/u);
      assert.doesNotMatch(failed.body.reason, /synthetic|ENOSPC|EACCES/u);
      assert.equal(failed.headers["set-cookie"], undefined, "keep the cookie so the user can retry");
      assert.equal(f.admin.signedIn(f.first), false, "never roll back the live-process denial");
      assert.equal(f.admin.signedIn(f.other), true, "do not revoke another browser");
      assert.equal(fs.readFileSync(f.sessions, "utf8"), original);
      assert.deepEqual(fs.readdirSync(f.dir).sort(), ["admin.key", "sessions.json"], "remove failed temporary writes");
    }
    fault.mock.restore();
    const retried = await f.signOut();
    assert.equal(retried.status, 200);
    assert.equal(retried.body.ok, true);
    assert.match(retried.headers["set-cookie"], /Max-Age=0/u);
    const restarted = createAdmin({ dir: f.dir });
    assert.equal(restarted.signedIn(f.first), false, "successful retry survives restart");
    assert.equal(restarted.signedIn(f.other), true);
    assert.equal((await f.signOut()).status, 200, "repeated sign-out is idempotent");
  });
}

test("a later successful session save flushes pending revocations without reviving them", async (t) => {
  const f = fixture(t);
  const rename = fs.renameSync;
  const fault = t.mock.method(fs, "renameSync", (from, to) => {
    if (to === f.sessions) throw Object.assign(new Error("synthetic storage failure"), { code: "EIO" });
    return rename(from, to);
  });
  assert.equal((await f.signOut()).status, 503);
  fault.mock.restore();
  f.admin.startSession();
  assert.equal(createAdmin({ dir: f.dir }).signedIn(f.first), false);
  assert.equal((await f.signOut()).status, 200);
});
