// node --test   (no dependencies)
import assert from 'node:assert/strict';
import test from 'node:test';
import { qwenLang, qwenSpeakText, qwenVoice } from '../src/qwen-tts.mjs';
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
