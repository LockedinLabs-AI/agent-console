/**
 * Two words the console draws: an estimate under a cent is "<$0.01", never
 * "$0.00", which reads as nothing spent; and a lane whose machine ran
 * `leave` says LEFT, as the Machines panel does, not REMOVED.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";

const JS = fs.readFileSync(new URL("../public/console.js", import.meta.url), "utf8");

function slice(from, to) {
  const start = JS.indexOf(from);
  const end = JS.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `console.js no longer holds ${from.trim()}`);
  return JS.slice(start, end);
}

const context = { D: null };
const helpers = vm.runInNewContext(slice("  const machineLeft = ", "  const pct = ")
  + slice("  const stateWord = ", "\n") + "\n({ machineLeft, money, stateWord })", context);

test("an estimate under a cent is said as under a cent", () => {
  assert.equal(helpers.money(0.0049), "<$0.01");
  assert.equal(helpers.money(0.0001), "<$0.01");
  assert.equal(helpers.money(0), "$0.00", "a counted zero stays zero");
  assert.equal(helpers.money(0.005), "$0.01");
  assert.equal(helpers.money(12.5), "$12.50");
  assert.equal(helpers.money(null), "—");
});

test("a lane whose machine left says LEFT; one the console removed says REMOVED", () => {
  context.D = { devices: [{ id: "dev_left", leftAt: "2026-09-28T10:00:00.000Z" }, { id: "dev_removed", leftAt: null }] };
  assert.equal(helpers.stateWord("revoked", "dev_left"), "LEFT");
  assert.equal(helpers.stateWord("revoked", "dev_removed"), "REMOVED");
  assert.equal(helpers.stateWord("revoked"), "REMOVED");
  assert.equal(helpers.stateWord("live", "dev_left"), "LIVE");
  // The lane row itself uses the same rule.
  assert.match(JS, /l\.state === "revoked" \? \(machineLeft\(l\.device\.id\) \? "LEFT" : "REMOVED"\)/u);
});

test("the spend-per-commit card says every author, not 'no priced commit', when no Git email is set", () => {
  // The Projects card's void line: a withheld ratio is never read as an unpriced one.
  const card = slice("      const othersOnly = ", "      const voidLine = ");
  const run = (projects) => vm.runInNewContext(card + "\n({ commitWhy, mergeWhy })", {
    priced: [], merged: [], anyGit: true, ranked: projects,
    everyAuthor: (x) => Boolean(x.repo && x.repo.mine === false),
    mergeReading: () => ({ count: 2 }),
  });
  const others = run([{ repo: { mine: false } }]);
  assert.equal(others.commitWhy, "every author — no Git email set here");
  assert.equal(others.mergeWhy, "", "said once, not twice");
  const unpriced = run([{ repo: { mine: true } }]);
  assert.equal(unpriced.commitWhy, "no priced commit in this period");
  assert.equal(unpriced.mergeWhy, "no priced merge in this period");
});
