// node --test   (no dependencies)
import assert from 'node:assert/strict';
import test from 'node:test';
import { narrationLint } from '../src/check.mjs';
import { productName } from '../src/init.mjs';
import { sentenceGaps, sentences } from '../src/voice.mjs';

test('a line is split into sentences where a speaker takes a breath', () => {
  for (const [line, want] of [
    ['Meet Storyshot. Ask your agent for a video.', ['Meet Storyshot.', 'Ask your agent for a video.']],
    ['Done! Now click Export? Yes.', ['Done!', 'Now click Export?', 'Yes.']],
    ['现在把 b 拖到 3。图像向上平移了。对吗？', ['现在把 b 拖到 3。', '图像向上平移了。', '对吗？']],
    ['He said "Hi." Then he left.', ['He said "Hi."', 'Then he left.']],
  ]) assert.deepEqual(sentences(line), want);
});

test('abbreviations, initials, numbers and domains do not end a sentence', () => {
  for (const line of ['Type e.g. the name of a gene.', 'Run N. P. X. storyshot setup.', 'It costs 2.5 dollars on myapp.com today.', 'Ask Dr. Smith first.'])
    assert.deepEqual(sentences(line), [line]);
  assert.deepEqual(sentences('Wait… then it loads.'), ['Wait… then it loads.']); // lowercase after: one sentence
});

test('the product name comes from the page title, the repo on a code host', () => {
  for (const [title, want] of [
    ['GitHub - boheling/storyshot: Ask your coding agent for a video', 'storyshot'],
    ['boheling / storyshot · GitLab', 'storyshot'],
    ['Desmos | Graphing Calculator', 'Desmos'],
    ['Excalidraw — Collaborative whiteboarding made easy', 'Excalidraw'],
    ['regex101: build, test, and debug regex', 'regex101'],
    ['Tic-Tac-Toe', 'Tic-Tac-Toe'],
    ['', 'example.com'],
  ]) assert.equal(productName(title, 'example.com'), want);
});

test('narration lint: machine-written phrases and run-on sentences', () => {
  assert.deepEqual(narrationLint('Storyshot is not just a recorder, but a seamless studio — fast.').tells, ['not just a recorder, but', 'seamless', '—']);
  assert.deepEqual(narrationLint("It's not about recording, it's about the story.").tells, ["It's not about recording, it's"]);
  assert.deepEqual(narrationLint('这个工具不仅能录屏，更能一站式赋能团队。').tells, ['不仅能录屏，更', '一站式', '赋能']);
  assert.deepEqual(narrationLint('Click Export. The file downloads to your computer.'), { tells: [], long: null });
  assert.deepEqual(narrationLint('The chains make the others bind oxygen more easily.').tells, []);
  assert.equal(narrationLint(`${'word '.repeat(30).trim()}.`).long, '30-word');
  assert.equal(narrationLint(`${'图'.repeat(45)}。`).long, '45-character');
});

test('the pause between two sentences is found in the audio, not a pause at a comma', () => {
  // stereo 48 kHz, speech as long as its letters: 15 letters, a comma pause (0.2 s), 12 letters, a shorter
  // sentence pause (0.1 s), 33 letters
  const SR = 48000, segs = [[1, 0.75], [0, 0.2], [1, 0.6], [0, 0.1], [1, 1.65]];
  const pcm = new Float32Array(2 * Math.round(SR * segs.reduce((a, s) => a + s[1], 0)));
  let i = 0;
  for (const [on, d] of segs) for (let k = 0; k < Math.round(SR * d); k++, i++) pcm[2 * i] = pcm[2 * i + 1] = on ? 0.5 * Math.sin(i / 7) : 0;
  const [g] = sentenceGaps(pcm, ['One two three four, five six seven.', 'Eight nine ten eleven twelve thirteen.']);
  assert.ok(g && Math.abs(g[0] / SR - 1.55) < 0.03 && Math.abs(g[1] / SR - 1.65) < 0.03, `found ${g && g.map((x) => (x / SR).toFixed(2))}`);
});
