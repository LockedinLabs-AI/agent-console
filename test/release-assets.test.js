import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { checkReleaseAssets, expectedAssets } from "../scripts/release-assets-check.mjs";

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-console-release-assets-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = { dist: path.join(dir, "dist"), labels: path.join(dir, "labels"), version: "9.9.9" };
  fs.mkdirSync(config.dist);
  fs.mkdirSync(config.labels);
  for (const name of expectedAssets(config.version)) fs.writeFileSync(path.join(config.dist, name), "synthetic artifact\n");
  for (const [target, platform, signing] of [
    ["darwin-arm64", "macOS, Apple silicon", ", signed and notarized"],
    ["darwin-x64", "macOS, Intel", ", signed and notarized"],
    ["linux-arm64", "Linux, arm64", ""], ["linux-x64", "Linux, x64", ""],
    ["win32-x64.exe", "Windows, x64", ", unsigned"],
  ]) {
    fs.writeFileSync(path.join(config.labels, `agent-console-${target}.label`), `agent-console-${target} · ${platform} executable${signing}\n`);
  }
  return config;
}

test("release upload requires every prerequisite to succeed, including real executable builds", () => {
  const workflow = fs.readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8").replace(/\r\n/gu, "\n");
  const job = workflow.split("\n  asset:\n")[1].split(/\n  [a-z-]+:\n/u)[0];
  const expression = /^    if: \$\{\{ (.+) \}\}$/mu.exec(job)?.[1];
  assert.ok(expression, "asset upload has an explicit prerequisite gate");
  const statuses = ["success", "failure", "cancelled", "skipped"];
  for (const authorize of statuses) for (const signing of statuses) for (const executables of statuses) {
    for (const cancelled of [false, true]) {
      const actual = vm.runInNewContext(expression, { cancelled: () => cancelled,
        needs: { authorize: { result: authorize }, signing: { result: signing }, executables: { result: executables } } }, { timeout: 100 });
      assert.equal(actual, !cancelled && [authorize, signing, executables].every((s) => s === "success"),
        JSON.stringify({ authorize, signing, executables, cancelled }));
    }
  }
  const collect = job.indexOf("name: Collect the executables");
  const check = job.indexOf('node scripts/release-assets-check.mjs dist labels "$version"');
  const sums = job.indexOf("sha256sum -- *");
  const attest = job.indexOf("uses: actions/attest-build-provenance@");
  const upload = job.indexOf("gh release upload");
  assert.ok(collect > 0 && check > collect && sums > check && attest > sums && upload > attest,
    "complete files before checksums, attestation, or upload");
  assert.doesNotMatch(job.slice(collect, job.indexOf("      - name: Pack")), /\bif:/u, "artifact collection cannot silently skip");
  assert.doesNotMatch(job.slice(upload).split("\n")[0], /--clobber/u);
});

test("complete release asset set accepts five platforms, archives and the versioned package", (t) => {
  const f = fixture(t);
  assert.equal(checkReleaseAssets(f).length, 10);
});

test("every missing release file blocks publication, including one missing architecture", (t) => {
  const f = fixture(t);
  for (const name of expectedAssets(f.version)) {
    const file = path.join(f.dist, name);
    fs.unlinkSync(file);
    assert.throws(() => checkReleaseAssets(f), /Incomplete/u, name);
    fs.writeFileSync(file, "synthetic artifact\n");
  }
});

test("unexpected, empty and non-file artifacts cannot be published", (t) => {
  const f = fixture(t);
  const extra = path.join(f.dist, "internal-notes.txt");
  fs.writeFileSync(extra, "synthetic notes\n");
  assert.throws(() => checkReleaseAssets(f), /unexpected/u);
  fs.unlinkSync(extra);
  const file = path.join(f.dist, "agent-console-linux-x64");
  fs.writeFileSync(file, "");
  assert.throws(() => checkReleaseAssets(f), /nonempty and regular/u);
  fs.unlinkSync(file);
  fs.mkdirSync(file);
  assert.throws(() => checkReleaseAssets(f), /nonempty and regular/u);
});

test("both macOS signing labels must confirm completed signing and notarization", (t) => {
  const f = fixture(t);
  for (const target of ["darwin-arm64", "darwin-x64"]) {
    const file = path.join(f.labels, `agent-console-${target}.label`);
    const label = fs.readFileSync(file, "utf8");
    for (const value of ["unsigned", "signed", ""]) {
      fs.writeFileSync(file, value ? label.replace("signed and notarized", value) : label.replace(", signed and notarized", ""));
      assert.throws(() => checkReleaseAssets(f), /not signed and notarized/u);
    }
    fs.unlinkSync(file);
    assert.throws(() => checkReleaseAssets(f));
    fs.writeFileSync(file, label);
  }
});

test("release versions cannot address paths outside the asset directory", () => {
  for (const version of ["../9.9.9", "v9.9.9", "9.9.9/extra", "", undefined]) {
    assert.throws(() => expectedAssets(version), /Invalid release version/u);
  }
});
