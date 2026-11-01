// Actions on a real page (Chromium): runs `storyshot inspect --after` on test/fixtures/sliders.html.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'bin', 'storyshot.mjs');
const page = `file://${path.join(here, 'fixtures', 'sliders.html')}`;
const browser = fs.existsSync(chromium.executablePath());

// the page after the given steps, as inspect prints it
function after(steps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyshot-test-'));
  const file = path.join(dir, 'board.yaml');
  fs.writeFileSync(file, `url: ${page}\npurpose: tutorial\nout: t.mp4\nsteps:\n${steps.map((a) => `  - actions: [${a}]\n    duration: 1\n`).join('')}`);
  return new Promise((done) => execFile('node', [cli, 'inspect', file, '--after', String(steps.length)], { timeout: 90000 }, (err, out, errOut) => {
    fs.rmSync(dir, { recursive: true, force: true });
    done(`${out}\n${errOut}${err ? `\n${err.message}` : ''}`);
  }));
}

test('slide: to a value, on an <input type=range> and on a knob whose track is its parent', { skip: !browser && 'no Chromium' }, async () => {
  const out = await after(['slide: { target: { label: Quality }, value: 65 }', 'slide: { target: { role: slider, name: m }, value: 3 }', 'slide: { target: { role: slider, name: m }, value: -2.5 }']);
  assert.match(out, /\{ label: "Quality", exact: true \}\s+\(slider 0…100, now 65 /, out);
  assert.match(out, /\{ role: "slider", name: "m", exact: true \}\s+\(slider -10…10, now -2\.5 /, out);
});

test('slide: to a position along the track', { skip: !browser && 'no Chromium' }, async () => {
  const out = await after(['slide: { target: { label: Quality }, to: 0.9 }']);
  assert.match(out, /\(slider 0…100, now 90 /, out);
});

test('scrollTo works below a sticky form with an <input name=id>', { skip: !browser && 'no Chromium' }, async () => {
  const out = await after(['scrollTo: { css: "#target" }']);
  assert.doesNotMatch(out, /failed|TypeError/, out);
});
