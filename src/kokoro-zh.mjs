// Mandarin narration with Kokoro v1.1-zh (voices zf_001…zf_099, zm_009…zm_100), free and local.
// Text → phonemes runs misaki's Chinese G2P (Python) in storyshot's own venv, once per render for all
// lines; phonemes → audio runs the v1.1-zh ONNX model through kokoro-js, like the English voice.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ZH_DEFAULT_VOICE = 'zf_001';
export const isZhVoice = (voice) => /^z[fm]_\d{3}$/.test(String(voice ?? ''));
const REPO = 'onnx-community/Kokoro-82M-v1.1-zh-ONNX';
const CACHE = path.join(os.homedir(), '.cache', 'storyshot');
const MODELS = path.join(CACHE, 'models');
export const ZH_VENV = path.join(CACHE, 'zh-venv');
const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'zh_g2p.py');
// misaki 0.9.4 (the v1.1 frontend) needs Python <3.13; regex 2026.x needs >=3.10
const PY_RANGE = [10, 12];
const REQUIREMENTS = ['misaki[zh]==0.9.4', 'cn2an==0.5.24', 'proces==0.1.7', 'jieba==0.42.1', 'pypinyin==0.55.0',
  'pypinyin-dict==0.9.0', 'ordered-set==4.1.0', 'phonemizer-fork==3.3.2', 'espeakng-loader==0.2.4', 'regex==2026.9.29', 'addict==2.4.0'];
// Part of every cached line's hash: change it when the model, the G2P or the text rewrites change.
export const ZH_TTS_ID = `${REPO}:q8|${REQUIREMENTS[0]}|text-2`;
// Pieces longer than this many phonemes are split at sentence ends (the model's hard limit is 510).
const TARGET = 300, MAX_PS = 510;

// --- text rewrites (TTS only: subtitles keep the original) ----------------------------------------
const MEASURE = `(?:${['个', '条', '只', '次(?!方|幂|函数|项|根)', '本', '位', '张', '种', '倍', '年(?!级)', '天', '点(?!\\d)', '分钟',
  '分(?!之)', '小时', '秒', '周', '页', '行', '列', '步', '格', '遍', '份', '组', '句', '段', '件', '台', '层', '部分', '名', '项',
  '类', '处', '边', '侧', '端', '根', '片', '块', '把', '支', '间', '元', '岁', '米', '公里', '千米', '厘米', '毫米', '公斤', '千克',
  '克', '斤', '升', '毫升', '度', '万', '千', '百', '亿'].join('|')})`;
const NUM_SPACE = new RegExp(`(\\d)\\s+(?=${MEASURE})`, 'g');
const LIANG = new RegExp(`(?<![\\d.,/A-Za-z_\\-−+]|第\\s*|负\\s*)2(?=${MEASURE})`, 'g');

export function zhSpeakText(text) {
  return String(text)
    // a number reads as one word with the measure word after it: "3 个" → "3个" (no pause; 一 gets its tone change)
    .replace(NUM_SPACE, '$1')
    // and a lone 2 there is 两: "2 个单位" → "两个单位" (not 12个, 0.2个, 2.5个, 第2个, 负2个, 2次方, 2年级)
    .replace(LIANG, '两')
    // math symbols the G2P would drop
    .replace(/\s*[=＝]\s*/g, '等于').replace(/\s*[+＋]\s*/g, '加').replace(/\s*×\s*/g, '乘').replace(/\s*÷\s*/g, '除以')
    .replace(/(?<=[\w)²³]\s*)−\s*/g, '减').replace(/−\s*/g, '负').replace(/²/g, '的平方').replace(/³/g, '的立方');
}

// --- Python for the G2P: found once, then a venv of storyshot's own --------------------------------
const venvPython = (dir) => (process.platform === 'win32' ? path.join(dir, 'Scripts', 'python.exe') : path.join(dir, 'bin', 'python'));
const STAMP = 'storyshot-requirements.txt';
const venvReady = () => {
  try { return fs.readFileSync(path.join(ZH_VENV, STAMP), 'utf8') === REQUIREMENTS.join('\n') && fs.existsSync(venvPython(ZH_VENV)); } catch { return false; }
};
// (the real path: a venv made through a symlink to a relocatable build, like uv's ~/.local/bin/python3.12, can't find its stdlib)
function probe(cmd, args = []) {
  try {
    const [version, exe] = execFileSync(cmd, [...args, '-c', 'import os, sys; print("%d.%d.%d" % sys.version_info[:3]); print(os.path.realpath(sys.executable))'],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).toString().trim().split(/\r?\n/);
    const [maj, min] = version.split('.').map(Number);
    return { version, exe, ok: maj === 3 && min >= PY_RANGE[0] && min <= PY_RANGE[1] };
  } catch { return null; }
}
let found, seen = [];
// → { version, exe } of a Python 3.10–3.12, or null (then `seen` lists the unsuitable ones, for the error)
export function findPython() {
  if (found !== undefined) return found;
  const cands = [...(process.env.STORYSHOT_PYTHON ? [[process.env.STORYSHOT_PYTHON]] : []), ['python3.12'], ['python3.11'], ['python3.10'],
    ...(process.platform === 'win32' ? [['py', '-3.12'], ['py', '-3.11'], ['py', '-3.10']] : []), ['python3'], ['python']];
  for (const [cmd, ...args] of cands) {
    const p = probe(cmd, args);
    if (p?.ok) return (found = p);
    if (p) seen.push(`${[cmd, ...args].join(' ')} is ${p.version}`);
  }
  try { // a uv-managed interpreter (uv python install 3.12)
    const exe = execFileSync('uv', ['python', 'find', '>=3.10,<3.13'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).toString().trim();
    const p = exe && probe(exe);
    if (p?.ok) return (found = p);
  } catch { /* no uv */ }
  return (found = null);
}

const NO_PYTHON = () => 'the Chinese Kokoro voice needs Python 3.10–3.12 for its Mandarin text-to-phoneme step (misaki does not support ' +
  `Python 3.13+ yet)${seen.length ? `; found only: ${seen.join(', ')}` : ''}. Install one — macOS: brew install python@3.12 · ` +
  'Ubuntu/Debian: sudo apt install python3.12 python3.12-venv · any OS: uv python install 3.12 — or set STORYSHOT_PYTHON to one. ' +
  `Storyshot then keeps its packages in its own venv (${ZH_VENV}); nothing is installed globally.`;

// For doctor and check: is the Chinese voice usable, and what's missing?
export function zhVoiceStatus() {
  if (venvReady()) return { ready: true, venv: ZH_VENV, python: probe(venvPython(ZH_VENV)) };
  const python = findPython();
  return { ready: false, venv: ZH_VENV, python, problem: python ? null : NO_PYTHON() };
}

function ensureVenv(log) {
  if (venvReady()) return venvPython(ZH_VENV);
  const py = findPython();
  if (!py) throw new Error(NO_PYTHON());
  log(`setting up the Chinese voice (one time): a Python ${py.version} venv in ${ZH_VENV} with misaki, the Mandarin G2P (~1 min)…`);
  const run = (cmd, args, what) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.status !== 0) {
      throw new Error(`${what} failed: ${(r.stderr || r.stdout || r.error?.message || '').trim().split('\n').slice(-6).join('\n')}` +
        (what.includes('venv') && process.platform === 'linux' ? '\n  (Debian/Ubuntu: sudo apt install python3-venv, or the python3.X-venv package for your version)' : ''));
    }
  };
  fs.rmSync(ZH_VENV, { recursive: true, force: true });
  fs.mkdirSync(CACHE, { recursive: true });
  run(py.exe, ['-m', 'venv', ZH_VENV], `creating the venv with ${py.exe} -m venv`);
  run(venvPython(ZH_VENV), ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '-q', ...REQUIREMENTS], 'installing misaki into the venv');
  fs.writeFileSync(path.join(ZH_VENV, STAMP), REQUIREMENTS.join('\n')); // written last: a half-built venv is rebuilt next time
  return venvPython(ZH_VENV);
}

// All lines in one Python run (jieba + espeak start once): → per line, a list of phoneme strings
function phonemize(lines, log) {
  const py = ensureVenv(log);
  const r = spawnSync(py, ['-I', HELPER], { input: JSON.stringify({ lines, target: TARGET, max: MAX_PS }), maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`Mandarin G2P failed (${py} ${HELPER}): ${String(r.stderr || r.error?.message).trim().split('\n').slice(-8).join('\n')}`);
  return JSON.parse(r.stdout.toString('utf8')).pieces;
}

// --- model + voice --------------------------------------------------------------------------------
let model = null;
async function loadModel(log) {
  if (model) return model;
  let KokoroTTS;
  try { ({ KokoroTTS } = await import('kokoro-js')); } catch {
    throw new Error('the Chinese Kokoro voice needs the kokoro-js package: npm i kokoro-js');
  }
  const { env } = await import('@huggingface/transformers');
  env.cacheDir = MODELS;
  if (!fs.existsSync(path.join(MODELS, REPO, 'onnx', 'model_quantized.onnx'))) log(`downloading the Chinese Kokoro model (one time, ~130 MB) into ${MODELS}…`);
  model = await KokoroTTS.from_pretrained(REPO, { dtype: 'q8', device: 'cpu' });
  return model;
}

const packs = new Map();
async function voicePack(voice) {
  if (packs.has(voice)) return packs.get(voice);
  const file = path.join(MODELS, REPO, 'voices', `${voice}.bin`);
  const SIZE = 510 * 256 * 4; // one 256-dim style vector per input length
  if (!fs.existsSync(file) || fs.statSync(file).size !== SIZE) {
    const res = await fetch(`https://huggingface.co/${REPO}/resolve/main/voices/${voice}.bin`);
    if (res.status === 404) throw new Error(`Kokoro v1.1-zh has no voice "${voice}" (try zf_001, zf_002, zm_010; list: https://huggingface.co/${REPO}/tree/main/voices)`);
    if (!res.ok) throw new Error(`downloading Kokoro voice ${voice} failed (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length !== SIZE) throw new Error(`Kokoro voice ${voice}: unexpected size ${buf.length}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, buf);
    fs.renameSync(`${file}.tmp`, file);
  }
  const pack = new Float32Array(new Uint8Array(fs.readFileSync(file)).buffer);
  packs.set(voice, pack);
  return pack;
}

// The model rushes inputs longer than its training lines (~100 tokens): slow those down, as hexgrad's make_zh.py does
export const zhSpeed = (n) => (n <= 83 ? 1 : n < 183 ? 1 - (n - 83) / 500 : 0.8) * 1.1;

const SR = 24000;
// Join a long line's pieces: trim each piece's edges, then a pause like a sentence break between them.
function join(chunks) {
  if (chunks.length === 1) return chunks[0];
  const trim = (a) => {
    const th = 0.01;
    let s = 0, e = a.length;
    while (s < e && Math.abs(a[s]) < th) s++;
    while (e > s && Math.abs(a[e - 1]) < th) e--;
    return a.subarray(Math.max(0, s - SR * 0.02), Math.min(a.length, e + SR * 0.05));
  };
  const parts = chunks.map(trim), gap = Math.round(SR * 0.35);
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0) + gap * (parts.length - 1));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length + gap; }
  return out;
}

// entries: [{ text, file }] — synthesizes each line (already rewritten by zhSpeakText) into a WAV at `file`.
export async function synthZh(v, entries, { log = console.log } = {}) {
  if (!entries.length) return;
  const pieces = phonemize(entries.map((e) => e.text), log);
  const tts = await loadModel(log);
  const pack = await voicePack(v.voice);
  const { Tensor, RawAudio } = await import('@huggingface/transformers');
  for (const [i, e] of entries.entries()) {
    log(`  tts (kokoro/${v.voice}): "${e.text}"`);
    const chunks = [];
    for (const ps of pieces[i]) {
      const { input_ids } = tts.tokenizer(ps, { truncation: true });
      const off = 256 * Math.min(Math.max(input_ids.dims.at(-1) - 2, 0), 509);
      const { waveform } = await tts.model({
        input_ids,
        style: new Tensor('float32', pack.slice(off, off + 256), [1, 256]),
        speed: new Tensor('float32', [zhSpeed([...ps].length) * (v.speed ?? 1)], [1]),
      });
      chunks.push(waveform.data);
    }
    const tmp = `${e.file}.tmp.wav`;
    await new RawAudio(chunks.length ? join(chunks) : new Float32Array(SR / 10), SR).save(tmp);
    fs.renameSync(tmp, e.file);
  }
}
