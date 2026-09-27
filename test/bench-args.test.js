// The benchmark accepts only its own options and run names.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { args } from "../bench/run.mjs";

const script = fileURLToPath(new URL("../bench/run.mjs", import.meta.url));

test("benchmark options are read into fixed names", () => {
  const o = args(["cold", "--home", "/tmp/h", "--retention-days", "30"]);
  assert.deepEqual(o._, ["cold"]);
  assert.equal(o.home, "/tmp/h");
  assert.equal(o["retention-days"], "30");
  assert.equal(Object.getPrototypeOf(o), Object.prototype);
});

test("an option the benchmark does not have is refused, including Object.prototype member names", () => {
  for (const name of ["--__proto__", "--constructor", "--toString", "--polluted"]) {
    assert.throws(() => args(["cold", name, "x"]), /unknown option/u);
  }
  assert.equal({}.polluted, undefined);
  assert.throws(() => execFileSync(process.execPath, [script, "cold", "--__proto__", "x"], { stdio: "pipe" }), (error) => error.status === 2);
});

test("the benchmark refuses a run name that is not one of its own", () => {
  for (const name of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
    assert.throws(() => execFileSync(process.execPath, [script, name], { stdio: "pipe" }), (error) => error.status === 2);
  }
});
