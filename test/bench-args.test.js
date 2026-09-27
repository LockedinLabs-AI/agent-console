// The benchmark's option parser keeps option names as plain data.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { args } from "../bench/run.mjs";

test("benchmark options named after Object.prototype members are stored as plain options", () => {
  const o = args(["cold", "--__proto__", "x", "--constructor", "y", "--home", "/tmp/h"]);
  assert.equal(Object.getPrototypeOf(o), null);
  assert.equal(o.__proto__, "x");
  assert.equal(o.constructor, "y");
  assert.equal(o.home, "/tmp/h");
  assert.deepEqual(o._, ["cold"]);
  assert.equal({}.polluted, undefined);
});

test("the benchmark refuses a run name that is not one of its own", () => {
  const script = fileURLToPath(new URL("../bench/run.mjs", import.meta.url));
  for (const name of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
    assert.throws(() => execFileSync(process.execPath, [script, name], { stdio: "pipe" }), (error) => error.status === 2);
  }
});
