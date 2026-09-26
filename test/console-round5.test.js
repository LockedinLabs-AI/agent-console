/**
 * The last verified round before the release (J5), each gap held by the
 * screen's own source; the probes check each one in a real browser:
 *
 * - a void cell's screen-reader reason is contained by the fold's own
 *   sideways scroller, so no page scrolls sideways on a phone (J5-01);
 * - a docked sheet's header is pinned, so opening a lane at Context scrolls
 *   the body and keeps × Close in view (J5-02);
 * - the room a hugging card leaves at 1920 goes to a fold held to that room,
 *   never to a bare tray (J5-03);
 * - while presenting, no folder is drawn at all (J5-04);
 * - the presenter's controls stay on a phone's strip as glyphs (J5-05).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL("../public/" + file, import.meta.url), "utf8").replace(/\r\n/gu, "\n");
const JS = read("console.js");
const CSS = read("console.css");
const PROBES = fs.readFileSync(new URL("../scripts/ui-probes.mjs", import.meta.url), "utf8");
const media = (query) => { const i = CSS.indexOf(`@media (${query}) {`); assert.ok(i >= 0, query); return CSS.slice(i, CSS.indexOf("\n}\n", i)); };

test("J5-01: a fold's body is positioned, so a 1px reason inside it never widens the page", () => {
  assert.match(CSS, /\n\.foldbody \{ position: relative;/u);
  assert.match(PROBES, /await section\("J5-01 no sideways scroll on a phone"/u);
});

test("J5-02: a docked sheet's header is pinned over its scrolling body", () => {
  assert.match(CSS, /\.sheet\.dock \.step > header \{ position: sticky; top: 0;[^}]*background: var\(--raise\);/u);
  assert.match(CSS, /\.sheet\.dock \.step > header ~ \* \[id\] \{ scroll-margin-top:/u);
  assert.match(PROBES, /await section\("J5-02 the sheet's header stays in view at Context"/u);
});

test("J5-03: what no fold fits whole goes to the smallest fold left, held to the room", () => {
  assert.match(JS, /if \(left > 48 && rest\.length\) \{/u);
  assert.match(JS, /foldHeld = id; holdFold\(id, px\);/u);
  assert.match(JS, /if \(foldTouched\) \{ releaseFold\(\); return openPx\(\); \}/u);
  assert.match(CSS, /\.foldrow\.roomfit > summary \+ \* \{ overflow-y: auto;/u);
  assert.match(PROBES, /await section\("J5-03 no dead tray at 1920"/u);
});

test("J5-04: while presenting the roots line names no folder", () => {
  assert.match(JS, /const list = present \? `the configured folders <span class="held">\(\$\{esc\(heldAll\)\}\)<\/span>`/u);
  assert.doesNotMatch(JS, /`Folder \$\{i \+ 1\}`/u);
  assert.match(PROBES, /await section\("J5-04 no path in the document while presenting"/u);
});

test("J5-05: the eye and the pause stay on a phone's strip as named glyph targets", () => {
  const narrow = media("max-width: 1023px");
  assert.match(narrow, /\.conhead \.ctrls button \{ min-width: 32px; min-height: 32px;/u);
  assert.match(narrow, /\.conhead \.ctrls button span \{ display: none; \}/u);
  assert.match(narrow, /\.conhead \.ctrls button svg \{ display: block; \}/u);
  assert.doesNotMatch(media("max-width: 760px"), /\.conhead \.ctrls \{ display: none; \}/u);
  assert.match(PROBES, /await section\("J5-05 presenter controls on a phone"/u);
});
