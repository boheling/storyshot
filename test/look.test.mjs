// node --test   (no dependencies)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { check } from '../src/check.mjs';
import { initExplainer } from '../src/init.mjs';
import { lesson } from '../src/hyperframes.mjs';

const fill = (file) => fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/say: TODO[^\n]*/g, 'say: Steam squeezes through a narrow gap, and the gap sings.'));

test('a new explainer starts as a grey pencil test, and check says so until the look is chosen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyshot-look-'));
  const r = initExplainer({ topic: 'how a kettle whistles', file: path.join(dir, 'k.yaml') });
  const look = fs.readFileSync(r.look, 'utf8');
  // no hue to inherit: every colour the starter ships is a grey
  for (const hex of [...look.matchAll(/#([0-9a-f]{6})\b/gi), ...r.yaml.matchAll(/#([0-9a-f]{6})\b/gi)].map((m) => m[1])) {
    const [red, green, blue] = [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16));
    assert.ok(Math.max(red, green, blue) - Math.min(red, green, blue) <= 6, `#${hex} is not a grey`);
  }
  assert.match(r.yaml, /scenes: \{ css: scenes\/kit\/look\.css \}/);
  for (const f of r.scenes) assert.match(fs.readFileSync(f, 'utf8'), /class="film"/);
  fill(r.file);
  assert.match(check(r.file).warnings.join('\n'), /look sheet is still the grey pencil test/);
  // the four parts written and the marker deleted: nothing left to say about the look
  fs.writeFileSync(r.look, look.replace(/storyshot-look: placeholder/, ''));
  assert.doesNotMatch(check(r.file).warnings.join('\n'), /look sheet|pencil test/);
});

test('an explainer whose scenes share no look sheet, or label in capitals, hears about it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyshot-look-'));
  const r = initExplainer({ topic: 'how a kettle whistles', file: path.join(dir, 'k.yaml') });
  fill(r.file);
  fs.writeFileSync(r.file, fs.readFileSync(r.file, 'utf8').replace(/^scenes: \{[^\n]*\n/m, ''));
  assert.match(check(r.file).warnings.join('\n'), /share no look sheet/);
  fs.appendFileSync(r.scenes[0], '<!-- <style>.eyebrow { text-transform: uppercase; letter-spacing: .2em }</style> -->');
  assert.match(check(r.file).warnings.join('\n'), /set in capitals/);
});

test('a card is an intertitle hung from one edge, with none of the template chrome', () => {
  const ctx = { W: 1920, H: 1080, FPS: 30, dark: false, accent: '#d9f75b', ink: '#0f172a', paper: null, font: 'Inter', lang: 'en', labels: { think: 'Pause and think' }, opts: {}, subs: false };
  const html = (job, over = {}) => lesson({ name: 'c', seconds: 8, ...job }, { ...ctx, ...over });
  const intro = html({ kind: 'intro', card: { title: 'Reading a BLAST hit', bullets: ['What the E value counts', 'What identity tells you'] } });
  const section = html({ kind: 'section', index: 1, of: 4, card: { kicker: 'Part 2', title: 'Run the search' } });
  const end = html({ kind: 'end', card: { title: 'Recap', bullets: ['E value first', 'Then identity'] } });
  for (const h of [intro, section, end]) {
    assert.doesNotMatch(h, /text-transform:\s*uppercase/);
    assert.doesNotMatch(h, /box-shadow/);
    assert.match(h, /\.col\{[^}]*align-items:flex-start[^}]*text-align:left/);
  }
  // the kicker is in the film's face, not a mono one
  assert.doesNotMatch(section.match(/\.kick\{[^}]*\}/)[0], /Mono|letter-spacing/);
  // the strip above the title: one segment per part on a section, a strip of one elsewhere
  assert.equal(section.match(/class="seg"/g).length, 4);
  assert.equal(intro.match(/class="seg"/g).length, 1);
  // a pale accent on a pale card would vanish as a mark, so it is deepened; on a dark card it is kept
  assert.doesNotMatch(intro.match(/\.fill\{[^}]*\}/)[0], /#d9f75b/);
  assert.match(html({ kind: 'intro', card: { title: 'x' } }, { dark: true }).match(/\.fill\{[^}]*\}/)[0], /#d9f75b/);
});
