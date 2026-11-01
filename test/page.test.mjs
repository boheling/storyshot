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

// test/fixtures/targets.html: the cases the 0.7.0 promo and tutorial remakes ran into
const targets = `file://${path.join(here, 'fixtures', 'targets.html')}`;
const afterOn = (url, steps) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyshot-test-'));
  const file = path.join(dir, 'board.yaml');
  fs.writeFileSync(file, `url: ${url}\npurpose: tutorial\nout: t.mp4\nsteps:\n${steps.map((a) => `  - actions: [${a}]\n    duration: 1\n`).join('')}`);
  return new Promise((done) => execFile('node', [cli, 'inspect', file, '--after', String(steps.length)], { timeout: 120000 }, (err, out, errOut) => {
    fs.rmSync(dir, { recursive: true, force: true });
    done(`${out}\n${errOut}${err ? `\n${err.message}` : ''}`);
  }));
};

test('inspect: same-named elements get their own nth, and a long page says what it left out', { skip: !browser && 'no Chromium' }, async () => {
  const out = await afterOn(targets, ['pause: 10']);
  // a column of buttons all named "button": same x and width, different y
  const nths = [...out.matchAll(/\{ role: "button", name: "button", exact: true, nth: (\d+) \}/g)].map((m) => Number(m[1]));
  assert.deepEqual(nths.sort((a, b) => a - b), [...Array(12).keys()], out);
  const py = [...out.matchAll(/\{ role: "button", name: "Python \(Pyodide\)", exact: true, nth: (\d+) \}/g)].map((m) => Number(m[1]));
  assert.deepEqual(py, [0, 1], out);
  assert.match(out, /… and \d+ more not listed/, out);
});

test('inspect --after: what the step opened comes first and is marked; covered elements say so', { skip: !browser && 'no Chromium' }, async () => {
  const out = await afterOn(targets, ['click: { role: button, name: "Open dialog" }']);
  assert.match(out, /★ y=\d+\s+at \(\d+, \d+\)\s+\{ role: "button", name: "Stay here", exact: true \}/, out);
  assert.match(out, /covered by something on top right now/, out);
});

test('click: a radio parked off screen is clicked through its label', { skip: !browser && 'no Chromium' }, async () => {
  const out = await afterOn(targets, ['click: { role: radio, name: blastp }', 'waitFor: { text: "blastp picked", timeout: 3000 }']);
  assert.doesNotMatch(out, /failed/, out);
});

test('click: warns when something is on top of the target', { skip: !browser && 'no Chromium' }, async () => {
  const out = await afterOn(targets, ['click: { role: button, name: Covered }']);
  assert.match(out, /⚠ step 1: div\.veil is on top of the click target/, out);
});

test('a failed step in inspect --after lists the page right there; a blocked click names the blocker', { skip: !browser && 'no Chromium' }, async () => {
  const missing = await afterOn(targets, ['click: { role: button, name: Nope, timeout: 1000 }']);
  assert.match(missing, /nothing matches[\s\S]*The page at that moment:[\s\S]*## Clickable elements/, missing);
  const blocked = await afterOn(targets, ['click: { role: button, name: "Open dialog" }', 'dismiss: { role: button, name: "Open dialog" }']);
  assert.match(blocked, /another element is on top of it and takes the click: <div id="dlg"/, blocked);
});

// test/fixtures/marks.html: `mark` on text the viewer can't see, and marks on text that scrolls away
test('mark: picks the copy the viewer can see, and a mark leaves with its text', { skip: !browser && 'no Chromium' }, async () => {
  const { pageScript } = await import('../src/record.mjs');
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(pageScript, { scrollOffset: 120 });
    const page = await ctx.newPage();
    await page.goto(`file://${path.join(here, 'fixtures', 'marks.html')}`);
    const found = (t) => page.evaluate((t) => {
      const f = window.__demoFind(t);
      return f && { ...f, id: window.__demoFound.startContainer.parentElement.id || window.__demoFound.startContainer.parentElement.parentElement.id };
    }, t);
    // an invisible copy on screen loses to the real one further down (which needs a scroll)
    assert.deepEqual(await found('Total: 42 rows'), { inView: false, count: 1, id: 'total' });
    // text in a collapsed section loses to the copy that shows
    assert.equal((await found('Hidden detail inside a collapsed section'))?.id, 'panel');
    // a mark on text that then scrolls out of its panel (under the header) is no longer drawn
    await found('Alpha result');
    await page.evaluate(() => window.__demoMark('found', { ms: 0, color: '#ffe066' }));
    const shown = () => page.evaluate(() => [...document.querySelectorAll('#__demo_marks > div')].map((d) => d.style.display !== 'none'));
    assert.deepEqual(await shown(), [true]);
    await page.evaluate(() => { document.getElementById('panel').scrollTop = 500; });
    await page.waitForTimeout(100);
    assert.deepEqual(await shown(), [false]);
  } finally { await b.close(); }
});
