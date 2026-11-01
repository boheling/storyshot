// node --test   (no dependencies)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { QWEN_VENV, qwenLang, qwenSpeakText, qwenStatus, qwenVoice } from '../src/qwen-tts.mjs';
import { qwenVoiceFor } from '../src/voice.mjs';

test('voice names are matched loosely', () => {
  assert.equal(qwenVoice('Serena'), 'serena');
  assert.equal(qwenVoice('Uncle Fu'), 'uncle_fu');
  assert.equal(qwenVoice('ono-anna'), 'ono_anna');
  assert.equal(qwenVoice('zf_001'), null);
});

test('the language follows the script', () => {
  assert.equal(qwenLang('每条直线都可以写成 y 等于 m x 加 b。'), 'chinese');
  assert.equal(qwenLang('Desmos 的 Settings 菜单'), 'chinese');
  assert.equal(qwenLang('Now drag m to two.'), 'auto');
  assert.equal(qwenLang('こんにちは'), 'japanese');
  assert.equal(qwenLang('안녕하세요'), 'korean');
});

test('Chinese lines: scientific numbers and a leading minus are spelled out', () => {
  for (const [from, to] of [
    ['E 值是 2e-105。', 'E 值是 2乘10的负105次方。'],
    ['E 值是 3.5E+12。', 'E 值是 3.5乘10的12次方。'],
    ['输入 −3，再按回车。', '输入 负3，再按回车。'],
    ['y = a(x − h)² + k', 'y = a(x − h)² + k'],
    ['第一行\n第二行', '第一行 第二行'],
  ]) assert.equal(qwenSpeakText(from), to);
});

test('other lines are left to the model', () => {
  assert.equal(qwenSpeakText('E value 2e-105, then −3.'), 'E value 2e-105, then −3.');
});

test('the default voice follows the narration', () => {
  assert.equal(qwenVoiceFor({ purpose: 'course', steps: [{ say: '现在把 b 的滑块向右拖到 3。' }] }), 'dylan');
  assert.equal(qwenVoiceFor({ purpose: 'tutorial', steps: [{ say: '点击“导出”。' }] }), 'dylan');
  assert.equal(qwenVoiceFor({ steps: [{ say: '粘贴任何 JSON，马上看到图。' }] }), 'serena');
  assert.equal(qwenVoiceFor({ steps: [{ say: 'Drag the slider to three.' }] }), 'aiden');
  assert.equal(qwenVoiceFor({ steps: [{ say: 'スライダーを動かします。' }] }), 'ono_anna');
  assert.equal(qwenVoiceFor({ lang: 'zh', steps: [{}] }), 'serena');
});

// takes from a real render: what Qwen3-ASR heard, and whether the take should be made again
test('the take check: garbles and wrong numbers fail, homophones and misheard letters pass', { skip: !qwenStatus().ready && 'no Qwen venv' }, () => {
  const cases = [
    ['现在 m 等于 2。横边是 1 格，竖边是 2 格。竖边正好等于 m。', '现在啊，买点：三百篇是一格，树边是两格，树边正好等于 m。', true],
    ['考考你。y 等于负 2 x 加 3，它和 y 轴交在哪里？往上斜，还是往下斜？', '考考你：y 等于负二长方荡加三，它和 y 轴交在哪里？往上斜还是往下斜？', true],
    ['Saturday has the tallest bar, at 260 ice creams.', 'Saturday has the tallest bar at 45 ice creams.', true],
    ['点开交点看看。b 是多少，直线就在 y 轴的多少穿过。', '点开焦点，看看 b 是多少。直线就在 y 轴的多少穿过。', false],
    ['先只动 b，m 保持 1 不变。', '先只动臂，M保持一不变。', false],
    ['这节课用 Desmos，搞懂方程 y 等于 m x 加 b 里的 m 和 b。', '这节课用代数模式搞懂方程 y 等于 mx 加 b 里的 m 和 b。', false],
    ['再拖到 0.5，直线变得很平缓。', '再拖到零点五，直线变得很平缓。', false],
    ['Across the week, the average was about 26 point 3 degrees.', 'Across the week, the average was about 26.3 degrees.', false],
  ];
  const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const out = execFileSync(path.join(QWEN_VENV, 'bin', 'python'), ['-I', '-B', '-c', `
import json, sys
sys.path.insert(0, ${JSON.stringify(helper)})
from pypinyin import lazy_pinyin
import qwen_tts as q
for text, heard in json.load(sys.stdin):
    rate, run = q.mismatch(text, heard, q.re.search(r'[㐀-鿿]', text) is not None, lazy_pinyin)
    print(json.dumps(rate > q.RETRY_AT or run > q.RETRY_RUN))
`], { input: JSON.stringify(cases.map(([t, h]) => [t, h])), encoding: 'utf8' });
  assert.deepEqual(out.trim().split('\n').map((l) => JSON.parse(l)), cases.map((c) => c[2]));
});
