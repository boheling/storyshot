// node --test   (no dependencies)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { check, narrationLint, teachingLint } from '../src/check.mjs';
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

test('teaching lint: one step, one job, and figures nobody can hold by ear', () => {
  // the real line from the BLAST tutorial: a definition, a rule of thumb and a reading, in one breath
  const dense = 'The E value is how many hits this good you would expect by pure chance in a database this size. '
    + 'Smaller is better, and anything below 1e-5 usually means a real relationship. Here it is 6e-106, essentially zero.';
  const t = teachingLint(dense);
  assert.equal(t.heavy, '38-word');
  assert.equal(t.long, '20-word'); // the middle sentence: under the promo limit of 25, over a lesson's 15
  assert.deepEqual(t.numbers, ['1e-5', '6e-106']);
  // what the same step sounds like parcelled out
  assert.deepEqual(teachingLint('The E value answers one question. Could a match this good happen by chance?'),
    { heavy: null, long: null, numbers: [] });
  // an accession or a version inside a word is not a figure the viewer has to hold
  assert.deepEqual(teachingLint('Our example is hemoglobin beta, UniProt P68871.').numbers, []);
  assert.deepEqual(teachingLint('Row two is the gorilla, 99.32 percent, and row six the rat, 82.73 percent, at 3e-56.').numbers,
    ['99.32', '82.73', '3e-56']);
  // the comma inside 1,000 belongs to the number; the one after 105 does not
  assert.deepEqual(teachingLint('About 1,000 hours on a rope, at position 105, before you move up.').numbers, ['1,000', '105']);
  // "about 15 words" is a target, not a cliff: 18 is let through, 19 is not
  assert.equal(teachingLint(`${'word '.repeat(18).trim()}.`).long, null);
  assert.equal(teachingLint(`${'word '.repeat(19).trim()}.`).long, '19-word');
  // Chinese: the character budget is what limits a line, since its numbers are spelled out
  assert.equal(teachingLint('先点一下查询框。把蛋白序列粘进去。').heavy, null);
  assert.equal(teachingLint(`${'图'.repeat(60)}。`).heavy, '60-character');
  assert.equal(teachingLint(`${'图'.repeat(34)}。`).long, '34-character');
});

test('a tutorial is held to a teaching pace; the same storyboard as a promo is not', () => {
  const yaml = (purpose) => `url: https://example.com\npurpose: ${purpose}\nout: t.mp4\nvoice: { provider: kokoro }\nsteps:\n`
    + '  - caption: Each row is one **hit**\n'
    + '    say: The E value is how many hits this good you would expect by pure chance in a database this size.'
    + ' Smaller is better, and anything below 1e-5 usually means a real relationship. Here it is 6e-106, essentially zero.\n'
    + '    actions:\n'
    + '      - mark: "E value"\n'
    + '      - note: { target: { css: "td.c9" }, text: "Curated and fast, which makes it good for learning" }\n';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyshot-teach-'));
  const run = (purpose) => {
    const f = path.join(dir, `${purpose}.yaml`);
    fs.writeFileSync(f, yaml(purpose));
    return check(f).warnings.join('\n');
  };
  const taught = run('tutorial');
  assert.match(taught, /a 38-word line for one step/);
  assert.match(taught, /a 20-word sentence — a tutorial keeps them to about 15 words/);
  assert.match(taught, /the caption bolds a payoff/);
  assert.match(taught, /the note reads as a sentence/);
  const sold = run('pitch');
  for (const re of [/for one step/, /keeps them to about/, /bolds a payoff/, /note reads as a sentence/]) assert.doesNotMatch(sold, re);
  assert.doesNotMatch(sold, /sentence — split it/); // 19 words is within a promo's budget
});

test('a lesson asks, waits, and shows the answer; a card names one idea', () => {
  const head = 'url: https://example.com\npurpose: course\nout: t.mp4\nvoice: { provider: kokoro }\nsteps:\n';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyshot-lesson-'));
  const run = (name, body, top = head) => {
    const f = path.join(dir, `${name}.yaml`);
    fs.writeFileSync(f, top + body);
    return check(f).warnings.join('\n');
  };
  // no question anywhere: a lecture
  assert.match(run('lecture', '  - caption: The E value column\n    say: Find the E value column.\n    actions:\n      - mark: "E value"\n'), /a lesson with no question card/);
  // a question that does not wait, and a reveal that points at nothing
  const rhetorical = run('rhetorical', '  - card: { kicker: Question, title: "Which one is the relative?" }\n    caption: Both rows\n    say: Both of them are.\n');
  assert.match(rhetorical, /asks a question but does not wait/);
  assert.match(rhetorical, /answers the question card before it, but points at nothing/);
  assert.doesNotMatch(rhetorical, /no question card/);
  assert.match(run('rushed', '  - card: { kicker: Question, title: "Which one?", think: 1 }\n    caption: Both rows\n    say: Both.\n    actions:\n      - mark: "Gorilla"\n'), /think: 1 is too short/);
  // asked, waited for, and marked: nothing to say (a localized kicker is still a question because it waits)
  const good = run('good', '  - card: { kicker: 想一想, title: "哪一行才是亲戚？", think: 3 }\n    caption: 两行都是\n    say: 两行都是。\n    actions:\n      - mark: "Gorilla"\n');
  for (const re of [/question card/, /does not wait/, /too short/, /points at nothing/]) assert.doesNotMatch(good, re);
  // a card that defines, gives the rule and reads the number
  const packed = '  - card:\n      kicker: Question\n      title: Is it chance?\n      think: 3\n'
    + '      say: The E value is how many hits this good you would expect by chance. Far below one in a hundred thousand, chance is ruled out. Near one, the hit could be luck. Here it is close to zero.\n'
    + '    caption: The E value column\n    say: Find it here.\n    actions:\n      - mark: "E value"\n';
  assert.match(run('packed', packed), /a 3\d-word line on one card — a card names one idea/);
  // a tutorial is not required to ask, and a promo is held to none of it
  assert.doesNotMatch(run('tutorial', '  - caption: The E value column\n    say: Find the E value column.\n    actions:\n      - mark: "E value"\n', head.replace('course', 'tutorial')), /no question card/);
  assert.doesNotMatch(run('pitch', packed, head.replace('course', 'pitch')), /on one card|question/);
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
