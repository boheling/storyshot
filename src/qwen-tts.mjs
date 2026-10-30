// Narration with Qwen3-TTS 0.6B CustomVoice (Apache-2.0): nine preset voices, five of them Chinese
// (serena, vivian, uncle_fu, dylan with a Beijing accent, eric with a Sichuan one), free and local.
// It runs through mlx-audio, so on Apple Silicon only; elsewhere config.mjs falls back to kokoro.
// Python (qwen_tts.py) runs in storyshot's own venv, once per render for all uncached lines.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPython } from './kokoro-zh.mjs';

export const QWEN_VOICES = ['serena', 'vivian', 'uncle_fu', 'dylan', 'eric', 'ryan', 'aiden', 'ono_anna', 'sohee'];
export const qwenSupported = () => process.platform === 'darwin' && process.arch === 'arm64';
// `Uncle Fu`, `Serena` → uncle_fu, serena (null when it isn't one of the nine)
export const qwenVoice = (name) => {
  const v = String(name ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return QWEN_VOICES.includes(v) ? v : null;
};

const REPO = 'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16';
const REVISION = '6415d95f88be018ff9e46813119dc3bc12261328';
// 0.9 (the model's default) now and then runs on into made-up words; 0.7 keeps the same voice steadier
const TEMPERATURE = 0.7;
const REQUIREMENTS = ['mlx-audio==0.6.3', 'mlx==0.32.4', 'mlx-metal==0.32.4', 'transformers==5.22.0', 'huggingface-hub==2.4.0',
  'tokenizers==0.23.3', 'safetensors==0.8.0', 'numpy==2.5.4'];
// Part of every cached line's hash: change it when the model, the packages or qwen_tts.py's sampling change.
export const QWEN_TTS_ID = `${REPO}@${REVISION.slice(0, 7)}|${REQUIREMENTS[0]}|t${TEMPERATURE}|guard-1`;
const CACHE = path.join(os.homedir(), '.cache', 'storyshot');
export const QWEN_VENV = path.join(CACHE, 'qwen-venv');
const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'qwen_tts.py');
const HUB = process.env.HF_HUB_CACHE ?? path.join(process.env.HF_HOME ?? path.join(os.homedir(), '.cache', 'huggingface'), 'hub');
const MODEL_FILE = path.join(HUB, `models--${REPO.replace('/', '--')}`, 'snapshots', REVISION, 'model.safetensors');

// --- text (TTS only: subtitles keep the original) --------------------------------------------------
// The model reads = + 2个 第2行 x² itself; a minus sign before a number it drops, and a number like
// 2e-105 sets it babbling, so those are spelled out in Chinese lines.
export function qwenSpeakText(text, lang = qwenLang(text)) {
  let t = String(text).replace(/\s*\n+\s*/g, ' ');
  if (lang === 'chinese') {
    t = t.replace(/(\d(?:\.\d+)?)[eE]\s*([-−+]?)\s*(\d+)/g, (_, m, s, e) => `${m}乘10的${s && s !== '+' ? '负' : ''}${e}次方`)
      .replace(/(?<![\w)²³]\s*)−\s*(?=\d)/g, '负');
  }
  return t;
}

// The language the model is told: the script decides; Latin text is left to the model.
export function qwenLang(text) {
  const s = String(text).replace(/\d+(?:\.\d+)?(?:[eE][-−+]?\d+)?/g, ' '); // the e in 2e-105 is no English word
  if (/[぀-ヿ]/.test(s)) return 'japanese';
  if (/[가-힯]/.test(s)) return 'korean';
  const han = (s.match(/[㐀-鿿]/g) ?? []).length, latin = (s.match(/[A-Za-z]+/g) ?? []).length;
  return han > latin ? 'chinese' : 'auto';
}

// --- the venv ---------------------------------------------------------------------------------------
const venvPython = (dir) => path.join(dir, 'bin', 'python');
const STAMP = 'storyshot-requirements.txt';
const venvReady = () => {
  try { return fs.readFileSync(path.join(QWEN_VENV, STAMP), 'utf8') === REQUIREMENTS.join('\n') && fs.existsSync(venvPython(QWEN_VENV)); } catch { return false; }
};

const NO_PYTHON = () => 'the Qwen3-TTS voice needs Python 3.10–3.12 to run (brew install python@3.12, or uv python install 3.12, ' +
  `or set STORYSHOT_PYTHON); storyshot then keeps its packages in its own venv (${QWEN_VENV}), nothing is installed globally`;

// For doctor and check: can this machine use it, and what's still to come on first use?
export function qwenStatus() {
  if (!qwenSupported()) return { supported: false };
  const model = fs.existsSync(MODEL_FILE);
  if (venvReady()) return { supported: true, ready: true, venv: QWEN_VENV, model };
  const python = findPython();
  return { supported: true, ready: false, venv: QWEN_VENV, model, python, problem: python ? null : NO_PYTHON() };
}

function ensureVenv(log) {
  if (venvReady()) return venvPython(QWEN_VENV);
  const py = findPython();
  if (!py) throw new Error(NO_PYTHON());
  log(`setting up the Qwen3-TTS voice (one time): a Python ${py.version} venv in ${QWEN_VENV} with mlx-audio (~400 MB, 1–2 min)…`);
  const run = (cmd, args, what) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.status !== 0) throw new Error(`${what} failed: ${(r.stderr || r.stdout || r.error?.message || '').trim().split('\n').slice(-6).join('\n')}`);
  };
  fs.rmSync(QWEN_VENV, { recursive: true, force: true });
  fs.mkdirSync(CACHE, { recursive: true });
  run(py.exe, ['-m', 'venv', QWEN_VENV], `creating the venv with ${py.exe} -m venv`);
  run(venvPython(QWEN_VENV), ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '-q', ...REQUIREMENTS], 'installing mlx-audio into the venv');
  fs.writeFileSync(path.join(QWEN_VENV, STAMP), REQUIREMENTS.join('\n')); // written last: a half-built venv is rebuilt next time
  return venvPython(QWEN_VENV);
}

// --- synthesis --------------------------------------------------------------------------------------
// entries: [{ text, file }] (text already through qwenSpeakText) → a WAV at each `file`.
export async function synthQwen(v, entries, { log = console.log } = {}) {
  if (!entries.length) return;
  if (!qwenSupported()) throw new Error('the Qwen3-TTS voice runs on Apple Silicon Macs only (it uses MLX)');
  const py = ensureVenv(log);
  if (!fs.existsSync(MODEL_FILE)) log(`downloading the Qwen3-TTS model (one time, ~2.3 GB) into ${HUB}…`);
  const lines = entries.map((e) => ({
    text: e.text, file: `${e.file}.raw.wav`, voice: v.voice, lang: qwenLang(e.text),
    // the same line gets the same take: a seed from the text
    seed: parseInt(crypto.createHash('sha1').update(e.text).digest('hex').slice(0, 7), 16),
  }));
  const job = JSON.stringify({ repo: REPO, revision: REVISION, temperature: TEMPERATURE, lines });
  const { code, stdout, tail } = await new Promise((resolve, reject) => {
    const p = spawn(py, ['-I', HELPER], { env: { ...process.env, HF_HUB_DISABLE_TELEMETRY: '1', TRANSFORMERS_VERBOSITY: 'error' } });
    let out = '', err = '', buf = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => {
      err = (err + d).slice(-4000);
      buf += d;
      let nl;
      while ((nl = buf.search(/[\r\n]/)) >= 0) {
        const m = buf.slice(0, nl).match(/^line (\d+)\/\d+ (\S+)( \d+ tries)?/);
        buf = buf.slice(nl + 1);
        if (m) log(`  tts (qwen/${v.voice}, ${m[2]}${m[3] ? `,${m[3]}` : ''}): "${entries[m[1] - 1].text}"`);
      }
    });
    p.on('error', reject);
    p.on('close', (c) => resolve({ code: c, stdout: out, tail: err }));
    p.stdin.end(job);
  });
  if (code !== 0) throw new Error(`Qwen3-TTS failed (${py} ${HELPER}): ${tail.trim().split('\n').slice(-8).join('\n')}`);
  const { results } = JSON.parse(stdout);
  for (const [i, e] of entries.entries()) {
    if (results[i]?.suspect) log(`  ⚠ qwen: "${e.text}" still sounds off after ${results[i].tries} tries (${results[i].seconds.toFixed(1)}s) — listen to it, or rephrase the line / add a pronounce entry`);
    const raw = lines[i].file, tmp = `${e.file}.tmp.wav`;
    // the model has no speed control: ffmpeg's pitch-preserving atempo does it
    if ((v.speed ?? 1) !== 1) execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', raw, '-af', `atempo=${v.speed}`, tmp]);
    else fs.renameSync(raw, tmp);
    fs.rmSync(raw, { force: true });
    fs.renameSync(tmp, e.file);
  }
}
