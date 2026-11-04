// node --test   (no dependencies)
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { phrases, phraseTimes } from '../src/voice.mjs';
import { sceneInfo, sceneSeconds, sceneRuntime } from '../src/scenes.mjs';
import { loadConfig } from '../src/config.mjs';

const SR = 48000;
// stereo PCM: sound (a 220 Hz tone) and silence, as [seconds, loud?] pieces
const pcmOf = (pieces) => {
  const n = Math.round(pieces.reduce((a, [d]) => a + d, 0) * SR), pcm = new Float32Array(2 * n);
  let i = 0;
  for (const [d, loud] of pieces) for (let k = 0; k < Math.round(d * SR); k++, i++) {
    const v = loud ? 0.5 * Math.sin(2 * Math.PI * 220 * i / SR) : 0;
    pcm[2 * i] = v; pcm[2 * i + 1] = v;
  }
  return pcm;
};

test('a line splits into phrases at sentence ends and commas', () => {
  assert.deepEqual(phrases('The electrons are already in the wire, all the way round. Closing the gap lets the push through.'),
    ['The electrons are already in the wire,', 'all the way round.', 'Closing the gap lets the push through.']);
  assert.deepEqual(phrases('探针完整时，淬灭基团把光吃掉；扩增时，光就放出来了。'), ['探针完整时，', '淬灭基团把光吃掉；', '扩增时，', '光就放出来了。']);
  assert.deepEqual(phrases('One line only'), ['One line only']);
});

test('a phrase starts where the voice pauses at its comma', () => {
  // "aaaa bbbb, cc dd" spoken as 1.0 s of sound, a 0.2 s pause, 0.6 s of sound
  const pcm = pcmOf([[1.0, true], [0.2, false], [0.6, true]]);
  const [a, b] = phraseTimes(pcm, [{ text: 'aaaa bbbb, cc dd', start: 0, end: 1.8 }]);
  assert.equal(a.text, 'aaaa bbbb,');
  assert.ok(Math.abs(a.end - 1.0) < 0.03, `first phrase ends at the pause (${a.end})`);
  assert.ok(Math.abs(b.t - 1.2) < 0.03, `second starts after it (${b.t})`);
  assert.equal(b.end, 1.8);
});

test('a comma the voice runs through keeps its estimate from the letters before it', () => {
  const pcm = pcmOf([[2.0, true]]);
  const [a, b] = phraseTimes(pcm, [{ text: 'aaaa, aaaa', start: 0, end: 2.0 }]);
  assert.ok(Math.abs(a.end - 1.0) < 1e-6 && Math.abs(b.t - 1.0) < 1e-6);
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'storyshot-scenes-'));
const SCENE = (id, extra = '') => `<template>
  <style>#${id} { position: absolute; inset: 0; }</style>
  <div id="${id}" data-composition-id="${id}" data-width="1920" data-height="1080"><div id="${id}-a"></div></div>
  <script>(function () { const S = window.__storyshot; const tl = gsap.timeline({ paused: true });
    tl.fromTo('#${id}-a', { opacity: 0 }, { opacity: 1, duration: 0.3 }, S.at(0)); ${extra}
    window.__timelines['${id}'] = tl; })();</script>
</template>`;

test('a scene file keeps the HyperFrames contract', () => {
  const d = tmp(), f = path.join(d, 'ok.html');
  fs.writeFileSync(f, SCENE('fret'));
  assert.deepEqual(sceneInfo(f, { width: 1920, height: 1080 }).errors, []);
  assert.equal(sceneInfo(f).id, 'fret');
  // wrong size, a clock, an id that differs from the composition id, no registration
  assert.match(sceneInfo(f, { width: 1080, height: 1920 }).errors.join(), /1920x1080 but the video is 1080x1920/);
  fs.writeFileSync(f, SCENE('fret', 'setTimeout(() => {}, 10);'));
  assert.match(sceneInfo(f).errors.join(), /no clocks or timers/);
  fs.writeFileSync(f, SCENE('fret').replace('id="fret" data-composition-id', 'id="other" data-composition-id'));
  assert.match(sceneInfo(f).errors.join(), /id must equal its data-composition-id/);
  fs.writeFileSync(f, SCENE('fret').replace("window.__timelines['fret'] = tl;", ''));
  assert.match(sceneInfo(f).errors.join(), /register the scene's timeline/);
  assert.match(sceneInfo(path.join(d, 'missing.html')).errors.join(), /does not exist/);
});

test('an explainer is made of scenes and needs no url', () => {
  const d = tmp(), y = path.join(d, 'x.yaml');
  fs.mkdirSync(path.join(d, 'scenes'));
  fs.writeFileSync(path.join(d, 'scenes', 'a.html'), SCENE('a'));
  fs.writeFileSync(y, 'purpose: explainer\nvoice: { provider: kokoro }\nsteps:\n  - scene: scenes/a.html\n    say: One. Two.\n  - scene: { file: scenes/a.html, title: Part two, lead: 0.2 }\n    duration: 3\n');
  const cfg = loadConfig(y);
  assert.equal(cfg.url, null);
  assert.equal(cfg.steps[0].scene.file, path.join(d, 'scenes', 'a.html'));
  assert.deepEqual([cfg.steps[0].duration, cfg.steps[0].scene.lead, cfg.steps[0].scene.tail], ['auto', 0.5, 0.8]);
  assert.deepEqual([cfg.steps[1].duration, cfg.steps[1].scene.lead, cfg.steps[1].scene.title], [3, 0.2, 'Part two']);
  assert.equal(cfg.music.style, 'calm');
  assert.equal(sceneSeconds(cfg.steps[0], 2.0), 0.5 + 2.0 + 0.8);
  assert.equal(sceneSeconds(cfg.steps[1], null), 3);
  // a recorded step needs the url; a scene has no actions
  fs.writeFileSync(y, 'purpose: explainer\nsteps:\n  - scene: scenes/a.html\n    duration: 2\n  - caption: hi\n    actions: [{ pause: 100 }]\n');
  assert.throws(() => loadConfig(y), /url` is required/);
  fs.writeFileSync(y, 'url: https://example.com\nsteps:\n  - scene: scenes/a.html\n    say: Hi.\n    actions: [{ pause: 100 }]\n');
  assert.throws(() => loadConfig(y), /has no actions/);
});

test('S.at() finds a phrase by number, from the end, or by its text', () => {
  const ctx = { W: 1920, H: 1080, lang: 'en', accent: '#f00', ink: '#000', font: 'Inter', subs: true };
  const job = { seconds: 6, lead: 0.5, say: 'a, b. c.', cues: [{ text: 'a,', t: 0, end: 1 }, { text: 'b.', t: 1.2, end: 2 }, { text: 'c.', t: 2.5, end: 4 }] };
  const win = {};
  vm.runInNewContext(sceneRuntime(job, ctx), { window: win });
  const S = win.__storyshot;
  assert.equal(S.at(0), 0.5);
  assert.equal(S.at(1, 0.1), 1.8);
  assert.equal(S.at(-1), 3);
  assert.equal(S.at('b'), 1.7);
  assert.equal(S.end(2), 4.5);
  assert.equal(S.at(9), 3); // past the last phrase: the last one
  assert.equal(S.safeBottom, Math.round(1080 * 0.16));
  assert.throws(() => S.at('zzz'), /no cue contains/);
  const none = {};
  vm.runInNewContext(sceneRuntime({ seconds: 3, lead: 0.5, cues: [] }, ctx), { window: none });
  assert.equal(none.__storyshot.at(2), 2.5); // no narration: lead + k seconds
});

test('a later fromTo on the same property waits for its start instead of rendering at once', async () => {
  const { GSAP_GUARD } = await import('../src/scenes.mjs');
  const calls = [];
  function Timeline() {}
  Timeline.prototype.fromTo = function (t, from, to, at) { calls.push({ t, to, at }); return this; };
  const a = { id: 'a' }, b = { id: 'b' };
  const gsap = { core: { Timeline }, utils: { toArray: (x) => [].concat(x) } };
  vm.runInNewContext(GSAP_GUARD, { window: { gsap }, gsap });
  const tl = new Timeline();
  tl.fromTo(a, { opacity: 0 }, { opacity: 1, duration: 0.3 }, 1);      // first on a.opacity: renders at once
  tl.fromTo(a, { opacity: 1 }, { opacity: 0, duration: 0.3 }, 5);      // later on a.opacity: waits
  tl.fromTo(a, { x: 0 }, { x: 10, duration: 0.3 }, 6);                 // another property: first of its own
  tl.fromTo(b, { opacity: 0 }, { opacity: 1, duration: 0.3 }, 7);      // another element
  tl.fromTo(a, { opacity: 0 }, { opacity: 1, immediateRender: true }, 8); // said explicitly: kept
  assert.deepEqual(calls.map((c) => c.to.immediateRender), [undefined, false, undefined, undefined, true]);
});
