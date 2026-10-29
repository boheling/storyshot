// node --test   (no dependencies)
import assert from 'node:assert/strict';
import test from 'node:test';
import { isZhVoice, zhSpeakText, zhSpeed } from '../src/kokoro-zh.mjs';
import { kokoroVoiceFor } from '../src/voice.mjs';

test('a lone 2 before a measure word is read 两', () => {
  for (const [from, to] of [
    ['向上平移了 2 个单位', '向上平移了 两个单位'],
    ['2个', '两个'],
    ['共 2 倍', '共 两倍'],
    ['等 2 分钟', '等 两分钟'],
    ['2 小时后', '两小时后'],
    ['分成 2 种', '分成 两种'],
  ]) assert.equal(zhSpeakText(from), to);
});

test('other 2s are left alone (the space before a measure word still goes)', () => {
  for (const [from, to] of [
    ['12 个', '12个'],
    ['0.2 个', '0.2个'],
    ['2.5 个', '2.5个'],
    ['20 个', '20个'],
    ['第 2 个', '第 2个'],
    ['负 2 个', '负 2个'],
    ['x 的 2 次方', 'x 的 2 次方'],
    ['2 年级', '2 年级'],
    ['2 分之 1', '2 分之 1'],
    ['拖到 2。', '拖到 2。'],
    ['a 等于 2，是正数', 'a 等于 2，是正数'],
    ['3 个单位', '3个单位'],
  ]) assert.equal(zhSpeakText(from), to);
});

test('行 after a number is read háng (as 航)', () => {
  for (const [from, to] of [
    ['输入到 Desmos 的第一行。', '输入到 Desmos 的第一航。'],
    ['第 3 行', '第 3航'],
    ['这 2 行', '这 两航'],
    ['每一行都', '每一航都'],
    ['三行代码', '三航代码'],
    ['一行人', '一行人'],
    ['统一行动', '统一行动'],
    ['银行', '银行'],
    ['不行', '不行'],
  ]) assert.equal(zhSpeakText(from), to);
});

test('math symbols are spoken', () => {
  assert.equal(zhSpeakText('y = mx + b'), 'y等于mx加b');
  assert.equal(zhSpeakText('y=−2x+4'), 'y等于负2x加4');
  assert.equal(zhSpeakText('x²'), 'x的平方');
});

test('v1.1-zh voice ids', () => {
  for (const v of ['zf_001', 'zf_099', 'zm_009', 'zm_100']) assert.ok(isZhVoice(v), v);
  for (const v of ['af_heart', 'zf_xiaobei', 'zm_yunxi', undefined]) assert.ok(!isZhVoice(v), v);
});

test('kokoro defaults to zf_001 for Chinese narration only', () => {
  assert.equal(kokoroVoiceFor({ steps: [{ say: '我们用 Desmos 来学习。' }] }), 'zf_001');
  assert.equal(kokoroVoiceFor({ steps: [{ say: 'OK.' }], intro: { say: '大家好，开始吧' } }), 'zf_001');
  assert.equal(kokoroVoiceFor({ steps: [{ say: 'Click export.' }] }), 'af_heart');
  assert.equal(kokoroVoiceFor({ steps: [{ say: 'Click 关闭 to close the dialog.' }] }), 'af_heart');
  assert.equal(kokoroVoiceFor({ steps: [{ say: 'これは日本語です。' }] }), 'af_heart');
  assert.equal(kokoroVoiceFor({ steps: [{ caption: '关闭', actions: [] }], lang: 'zh-CN' }), 'zf_001');
  assert.equal(kokoroVoiceFor({ steps: [{ caption: '关闭', actions: [] }] }), 'af_heart');
});

test('speed curve from make_zh.py', () => {
  assert.equal(zhSpeed(50), 1.1);
  assert.ok(Math.abs(zhSpeed(133) - 0.99) < 1e-9);
  assert.ok(Math.abs(zhSpeed(400) - 0.88) < 1e-9);
});
