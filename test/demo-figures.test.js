/**
 * The demonstration team's figures read like a real day, whenever the demo
 * starts and however long it has run.
 *
 * The README's screenshots come from --demo, and once showed a burn of
 * "999k tok/min": the demo followed the wall-clock calendar, a Saturday
 * capture ran at a third of its weekday pace, and the fifteen-minute average
 * landed on the point where the console's formatter turns k into M. The
 * demo's day is now anchored to the moment it starts. These checks hold the
 * headline and burn figures away from every formatting cliff, inside a band
 * that looks like a five-machine team's afternoon, and coherent with one
 * another: the classes and the machines sum to the day, the models' dollars
 * to the estimate, the burn to the last hour's series and the lanes' five
 * minutes, each alert's multiple to its own numbers, and the week's strip to
 * the headline.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createRegistry } from "../lib/hub/registry.js";
import { createStore } from "../lib/hub/store.js";
import { startDemo } from "../lib/hub/demo.js";
import { createFleetSignals } from "../lib/hub/fleet.js";
import { createActivityBook } from "../lib/collector/activity.js";
import { buildConsole } from "../lib/hub/aggregate.js";
import { allAlerts, consoleSignals } from "../lib/hub/routes.js";

const MINUTE = 60_000;
const DAY = 86_400_000;
const PRICES = JSON.parse(fs.readFileSync(new URL("../lib/collector/prices.json", import.meta.url), "utf8"));
const CLASSES = ["fresh", "output", "cacheWrite", "cacheRead"];

/* The console's own formatter (public/console.js fmt), so a cliff is judged by what the screen would print. */
const fmt = (n) => {
  const a = Math.abs(n);
  return a >= 1e9 ? (n / 1e9).toFixed(2) + "B"
    : a >= 1e6 ? (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + "M"
    : a >= 1e3 ? Math.round(n / 1e3) + "k" : String(Math.round(n));
};
/* A figure the formatter would print at a unit boundary — 999k, 1000k, 1.0M, 1.00B — or within a hair of one. */
const CLIFF_TEXT = /^(999k|1000k|1\.0M|1\.00B|999M|1000M)$/u;
const onCliff = (n) => CLIFF_TEXT.test(fmt(n)) || [1e6, 1e9].some((unit) => Math.abs(n / unit - 1) < 0.006);

/** The demo built at `at`, then run by hand for `minutes` of live ticks. */
function demoAt(at, minutes = 0) {
  let now = at;
  const clock = () => now;
  const registry = createRegistry({ dir: null, now: clock });
  const store = createStore({ dir: null, retentionMs: 8 * DAY, prices: PRICES, now: clock });
  const fleet = createFleetSignals({ now: clock });
  const activity = createActivityBook({ now: clock });
  const demo = startDemo({ registry, store, fleet, activity, now: clock, tickMs: 1e9 });
  for (let s = 1; s <= minutes * 60; s += 1) { now = at + s * 1000; demo.tick(); }
  demo.stop();
  const alerts = { list: () => demo.alerts(now) };
  return buildConsole({ store, registry, names: demo.names, now, hub: { demo: true },
    alerts: allAlerts({ alerts, fleet }, now), signals: consoleSignals({ alerts, fleet, activity }, now) });
}

const CLOCKS = {
  "a Saturday before noon": new Date(2026, 8, 26, 11, 59, 0).getTime(),
  "a Sunday at three in the morning": new Date(2026, 8, 27, 3, 10, 0).getTime(),
  "a Thursday afternoon": new Date(2026, 8, 24, 13, 30, 20).getTime(),
};
// DEMO_FIGURES_SOAK=<n> adds n more starts, 37 minutes apart, for a longer look at the bands (not part of the gate).
for (let i = 0; i < Number(process.env.DEMO_FIGURES_SOAK || 0); i += 1) CLOCKS[`soak ${i}`] = CLOCKS["a Thursday afternoon"] + (i + 1) * 37 * MINUTE;

/* Every relation the screen shows, checked on one payload. */
function checkFigures(view, label) {
  const day = view.windows["24h"];
  const total = day.tokens.total;
  const at = (what) => `${label}: ${what}`;

  // --- the headline: a five-machine team's day, off every cliff -----------
  assert.ok(total >= 1.1e9 && total <= 1.7e9, at(`24 h total ${fmt(total)} is a five-machine day`));
  assert.ok(!onCliff(total), at(`24 h total ${fmt(total)} sits on a formatting cliff`));
  assert.equal(day.cost.status, "estimated", at("the day is priced"));
  assert.ok(day.cost.usd >= 1400 && day.cost.usd <= 2400, at(`the day's estimate $${day.cost.usd.toFixed(0)}`));
  assert.ok(Math.abs(day.cost.usd - Math.round(day.cost.usd)) > 0.004, at("the estimate is not a whole dollar"));
  for (const k of CLASSES) {
    assert.ok(day.tokens[k] > 0, at(`${k} is present`));
    assert.ok(!onCliff(day.tokens[k]), at(`${k} ${fmt(day.tokens[k])} sits on a cliff`));
    assert.ok(day.shares[k] > 0.005 && day.shares[k] < 0.995, at(`${k}'s share ${(day.shares[k] * 100).toFixed(1)}% is neither 0% nor 100%`));
  }
  // cache reads dominate the way Claude Code and Codex usage does
  assert.ok(day.shares.cacheRead >= 0.85 && day.shares.cacheRead <= 0.92, at(`cache read share ${(day.shares.cacheRead * 100).toFixed(1)}%`));

  // --- the classes and the machines sum to the day -------------------------
  assert.equal(CLASSES.reduce((a, k) => a + day.tokens[k], 0), total, at("the four classes sum to the total"));
  const byClassUsd = CLASSES.reduce((a, k) => a + day.cost.byClass[k], 0);
  assert.ok(Math.abs(byClassUsd - day.cost.usd) < 0.01, at("the classes' dollars sum to the estimate"));
  const machines = view.devices.filter((d) => d.day);
  assert.equal(machines.length, 5, at("five machines"));
  assert.equal(machines.reduce((a, d) => a + d.day.tokens.total, 0), total, at("the machines sum to the total"));
  assert.ok(Math.abs(machines.reduce((a, d) => a + (d.day.cost.usd || 0), 0) - day.cost.usd) < 0.01, at("the machines' dollars sum to the estimate"));
  for (const d of machines) assert.ok(!onCliff(d.day.tokens.total), at(`${d.label} ${fmt(d.day.tokens.total)} sits on a cliff`));
  const shares = machines.map((d) => d.day.tokens.total / total);
  assert.ok(Math.max(...shares) < 0.6 && Math.min(...shares) > 0.02, at("no machine is the whole team, none is nothing"));

  // --- the models: shares and dollars add up, and the prices explain the dollars
  const models = view.day.models;
  assert.ok(models.length >= 5, at("at least five models"));
  assert.ok(Math.abs(models.reduce((a, m) => a + m.share, 0) - 1) < 1e-6, at("model shares sum to one"));
  assert.equal(models.reduce((a, m) => a + m.tokens, 0), total, at("model tokens sum to the total"));
  assert.ok(Math.abs(models.reduce((a, m) => a + m.usd, 0) - day.cost.usd) < 0.01, at("model dollars sum to the estimate"));
  for (const m of models) {
    assert.ok(!onCliff(m.tokens), at(`${m.model} ${fmt(m.tokens)} sits on a cliff`));
    assert.ok(m.share > 0.01 && m.share < 0.6, at(`${m.model} share ${(m.share * 100).toFixed(1)}% is neither a rounding error nor the whole`));
  }

  // --- the burn: away from the cliff, and the last hour agrees -------------
  const burn = view.burn;
  assert.equal(burn.reporting, 4, at("four of five machines report (the build box is silent)"));
  assert.ok(burn.tokensPerMinute >= 1.2e6 && burn.tokensPerMinute <= 4.5e6, at(`burn ${fmt(burn.tokensPerMinute)} tok/min`));
  assert.ok(!onCliff(burn.tokensPerMinute), at(`burn ${fmt(burn.tokensPerMinute)} tok/min sits on the k/M cliff`));
  assert.notEqual(fmt(burn.tokensPerMinute), "999k", at("the burn is not 999k"));
  assert.ok(burn.usdPerMinute > 1 && burn.usdPerMinute < 8, at(`burn $${burn.usdPerMinute.toFixed(2)}/min`));
  const hour = view.series["1h"];
  assert.equal(hour.step, MINUTE);
  const lastQuarter = hour.values.slice(-burn.windowMinutes);
  const seriesRate = lastQuarter.reduce((a, v) => a + v, 0) / lastQuarter.length;
  assert.ok(seriesRate / burn.tokensPerMinute > 0.7 && seriesRate / burn.tokensPerMinute < 1.3,
    at(`the chart's last ${burn.windowMinutes} minutes (${fmt(seriesRate)}/min) agree with the burn (${fmt(burn.tokensPerMinute)}/min)`));
  const whole = hour.values.slice(0, -1).filter((v) => v > 0).sort((a, b) => a - b);
  const median = (whole[Math.floor(whole.length / 2)] + whole[Math.ceil(whole.length / 2) - 1]) / 2;
  assert.ok(!onCliff(median), at(`median active minute ${fmt(median)} sits on a cliff`));
  assert.ok(median / burn.tokensPerMinute > 0.5 && median / burn.tokensPerMinute < 2, at("the median active minute is the burn's order of magnitude"));

  // --- the lanes' five minutes agree with the burn --------------------------
  const live = view.lanes.filter((l) => l.state === "live");
  assert.ok(live.length >= 6, at(`${live.length} live lanes`));
  const fiveMin = view.lanes.reduce((a, l) => a + (l.tokens5m || 0), 0);
  const laneRate = fiveMin / 5;
  assert.ok(laneRate / burn.tokensPerMinute > 0.5 && laneRate / burn.tokensPerMinute < 1.6,
    at(`the lanes' five minutes (${fmt(laneRate)}/min) agree with the burn (${fmt(burn.tokensPerMinute)}/min)`));
  // a lane's five minutes is a few dozen Poisson draws and may print anything; the lane the screen lights is the one that must not sit on a cliff
  const lit = live.slice().sort((a, b) => b.tokens5m - a.tokens5m)[0];
  assert.ok(lit.tokens5m > 1.5e6 && !onCliff(lit.tokens5m), at(`the lit lane ${lit.project.name} 5-min ${fmt(lit.tokens5m)}`));
  assert.equal(view.lanes.reduce((a, l) => a + l.tokensDay, 0), total, at("the lanes' days sum to the total"));

  // --- the day's chart is the day -----------------------------------------
  const chart = view.series["24h"];
  assert.equal(chart.values.reduce((a, v) => a + v, 0), total, at("the 24 h chart sums to the total"));
  const peak = Math.max(...chart.values);
  assert.ok(!onCliff(peak), at(`chart peak ${fmt(peak)} sits on a cliff`));
  assert.ok(peak / (total / chart.values.length) > 1.8, at("the day has a shape: its peak stands well above its mean"));
  assert.ok(Math.min(...chart.values) > 0, at("no quarter hour of the day is empty"));

  // --- alerts: each multiple is its own numbers -----------------------------
  const spike = view.alerts.find((a) => a.kind === "spike");
  assert.ok(spike && spike.factor >= 3, at(`the spike measures ${spike && spike.factor}× normal`));
  assert.equal(spike.factor, Math.round((spike.tokens5m / spike.median5m) * 10) / 10, at("the spike's multiple is its five minutes over its median"));
  assert.ok(spike.tokens < spike.tokens5m, at("the spike's response is inside its five minutes"));
  assert.ok(spike.tokens > 3e5 && spike.tokens < 9e5, at(`the spike's response ${fmt(spike.tokens)} is one heavy response, on one side of the k/M boundary`));
  const stall = view.alerts.find((a) => a.kind === "stall");
  assert.ok(stall && stall.factor >= 2, at(`the stall measures ${stall && stall.factor}× normal`));
  assert.equal(stall.factor, Math.round((stall.tokens5m / stall.median5m) * 10) / 10, at("the stall's multiple is its five minutes over its median"));
  assert.ok(stall.tokens <= stall.tokens5m && stall.tokens > 0.25 * stall.tokens5m, at("what the stall spent is a large part of its five minutes, never more than them"));
  assert.ok(stall.tokens > 2e5 && stall.tokens < 9e5, at(`the stall's ${fmt(stall.tokens)} is a few heavy responses, on one side of the k/M boundary`));

  // --- the week's strip agrees with the headline ----------------------------
  const strip = view.series["7d"].byLocalDay.days;
  assert.equal(strip.length, 7);
  const today = strip[6];
  assert.ok(today.partial, at("today is in progress"));
  assert.ok(today.tokens <= total, at("today so far is within the last 24 hours"));
  const stripPeak = Math.max(...strip.map((d) => d.tokens));
  assert.ok(stripPeak >= total * 0.8 && stripPeak <= total * 1.4, at(`the week's busiest day ${fmt(stripPeak)} is the headline's order (${fmt(total)})`));
  assert.ok(!onCliff(stripPeak), at(`the week's peak ${fmt(stripPeak)} sits on a cliff`));
  const week = view.windows["7d"].tokens.total;
  const stripSum = strip.reduce((a, d) => a + d.tokens, 0);
  assert.ok(stripSum <= week && stripSum >= 0.75 * week, at("six days and today are most of the rolling week, never more"));
  for (const d of strip.slice(0, 6)) assert.ok(d.tokens >= 0.6 * stripPeak, at(`${d.date} ${fmt(d.tokens)} is a working day, not a weekend`));
}

for (const [when, at] of Object.entries(CLOCKS)) {
  test(`demo figures: started ${when}, the demo is a working afternoon`, () => {
    checkFigures(demoAt(at), when);
  });
}

test("demo figures: twenty minutes into a live demo the relations still hold", () => {
  checkFigures(demoAt(CLOCKS["a Saturday before noon"], 20), "after 20 minutes");
});

test("demo figures: the burn never reads 999k across a running hour", () => {
  // the burn's fifteen-minute average, read every two minutes across an hour of ticks
  let now = CLOCKS["a Sunday at three in the morning"];
  const clock = () => now;
  const registry = createRegistry({ dir: null, now: clock });
  const store = createStore({ dir: null, retentionMs: 8 * DAY, prices: PRICES, now: clock });
  const fleet = createFleetSignals({ now: clock });
  const activity = createActivityBook({ now: clock });
  const demo = startDemo({ registry, store, fleet, activity, now: clock, tickMs: 1e9 });
  const start = now;
  for (let s = 1; s <= 60 * 60; s += 1) {
    now = start + s * 1000;
    demo.tick();
    if (s % 120 !== 0) continue;
    const alerts = { list: () => demo.alerts(now) };
    const view = buildConsole({ store, registry, names: demo.names, now, hub: { demo: true },
      alerts: allAlerts({ alerts, fleet }, now), signals: consoleSignals({ alerts, fleet, activity }, now) });
    const rate = view.burn.tokensPerMinute;
    assert.ok(rate >= 1.2e6 && rate <= 4.5e6 && !onCliff(rate), `minute ${s / 60}: burn ${fmt(rate)} tok/min`);
    assert.ok(!onCliff(view.windows["24h"].tokens.total), `minute ${s / 60}: total ${fmt(view.windows["24h"].tokens.total)}`);
  }
  demo.stop();
});
