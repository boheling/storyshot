// Voiceover: text-to-speech for each step's `say:` line, cached on disk.
// Providers: kokoro (local, free: English, and Mandarin with the v1.1-zh voices), qwen (local, free, Apple
// Silicon: Qwen3-TTS, best for Chinese), elevenlabs, openai, say (macOS).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isZhVoice, synthZh, zhSpeakText, ZH_DEFAULT_VOICE, ZH_TTS_ID } from './kokoro-zh.mjs';
import { qwenLang, qwenSpeakText, QWEN_TTS_ID, synthQwen } from './qwen-tts.mjs';

const SR = 48000;
export const VOICE_DEFAULTS = {
  kokoro: { voice: 'af_heart' },
  qwen: { voice: 'dylan' },
  elevenlabs: { voice: 'JBFqnCBsd6RMkjVDRZzb', model: 'eleven_multilingual_v2' },
  openai: { voice: 'alloy', model: 'gpt-4o-mini-tts' },
  say: { voice: 'Samantha' },
};

// kokoro without a named voice: the Mandarin one when the narration is mostly Chinese (more Han
// characters than Latin words; no kana or hangul), or, with no narration to go by, `lang: zh`.
// English (af_heart) otherwise.
export function kokoroVoiceFor(raw) {
  return narrationIsChinese(raw) ? ZH_DEFAULT_VOICE : VOICE_DEFAULTS.kokoro.voice;
}

// qwen without a named voice, for Chinese: dylan (a steady teacher's voice) in tutorials, lessons and
// docs, serena (warmer) in promos; ono_anna for Japanese, sohee for Korean, aiden otherwise
export function qwenVoiceFor(raw) {
  const says = narration(raw);
  if (/[\u3040-\u30ff]/.test(says) || /^ja/i.test(String(raw.lang ?? ''))) return 'ono_anna';
  if (/[\uac00-\ud7af]/.test(says) || /^ko/i.test(String(raw.lang ?? ''))) return 'sohee';
  if (!narrationIsChinese(raw)) return 'aiden';
  return (raw.purpose ?? 'pitch') === 'pitch' ? 'serena' : VOICE_DEFAULTS.qwen.voice;
}

const narration = (raw) => [...(raw.steps ?? []).flatMap((s) => [s?.say, s?.card?.say]), raw.intro?.say, raw.end_card?.say].filter(Boolean).join(' ');
function narrationIsChinese(raw) {
  const says = narration(raw);
  const han = (says.match(/[\u3400-\u9fff]/g) ?? []).length, latin = (says.match(/[A-Za-z]+/g) ?? []).length;
  return says.trim() ? han > latin && !/[\u3040-\u30ff\uac00-\ud7af]/.test(says) : /^zh/i.test(String(raw.lang ?? ''));
}

let kokoro = null;
async function synth(v, text, file) {
  switch (v.provider) {
    case 'kokoro': {
      if (/^z[fm]_/.test(v.voice)) throw new Error(`Kokoro voice "${v.voice}" is from v1.0, which storyshot does not run; for Mandarin use a v1.1-zh voice such as ${ZH_DEFAULT_VOICE}`);
      if (!kokoro) {
        let KokoroTTS;
        try { ({ KokoroTTS } = await import('kokoro-js')); } catch {
          throw new Error('voice provider "kokoro" needs the kokoro-js package: npm i kokoro-js');
        }
        // cache the model in the user's home (survives reinstalls; mount /root/.cache in Docker)
        const { env } = await import('@huggingface/transformers');
        env.cacheDir = path.join(os.homedir(), '.cache', 'storyshot', 'models');
        kokoro = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
      }
      const audio = await kokoro.generate(text, { voice: v.voice, speed: v.speed });
      await audio.save(file);
      return;
    }
    case 'elevenlabs': {
      const key = process.env.ELEVENLABS_API_KEY;
      if (!key) throw new Error('voice provider "elevenlabs" needs ELEVENLABS_API_KEY in the environment (create one at https://elevenlabs.io/app/developers/api-keys)');
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${v.voice}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ text, model_id: v.model, voice_settings: v.speed !== 1 ? { speed: v.speed } : undefined }),
      });
      if (!res.ok) throw new Error(`ElevenLabs TTS failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return;
    }
    case 'openai': {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error('voice provider "openai" needs OPENAI_API_KEY in the environment');
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: v.model, voice: v.voice, input: text, speed: v.speed, response_format: 'mp3', ...(v.instructions ? { instructions: v.instructions } : {}) }),
      });
      if (!res.ok) throw new Error(`OpenAI TTS failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return;
    }
    case 'say':
      execFileSync('say', ['-v', v.voice, '-r', String(Math.round(185 * v.speed)), '-o', file, text]);
      return;
    default:
      throw new Error(`unknown voice provider "${v.provider}" (use kokoro, qwen, elevenlabs, openai or say)`);
  }
}

// `voice.pronounce: { pxGenius: P X Genius }` rewrites words for the TTS engine only,
// so subtitles keep the real spelling.
function pronounce(v, text) {
  let t = text;
  for (const [word, spoken] of Object.entries(v.pronounce ?? {})) {
    t = t.replace(new RegExp(`(?<![\\w.])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'g'), spoken);
  }
  return t;
}

// The cache file for a line, and the text the engine is given. The Mandarin Kokoro voice reads a
// rewritten text (2个 → 两个, …) and has its model and G2P version in the hash; so does qwen.
function cached(cfg, line) {
  const v = cfg.voice;
  const dir = path.join(path.dirname(cfg.work), 'tts-cache');
  fs.mkdirSync(dir, { recursive: true });
  const zh = v.provider === 'kokoro' && isZhVoice(v.voice), qwen = v.provider === 'qwen';
  const text = zh ? zhSpeakText(pronounce(v, line)) : qwen ? qwenSpeakText(pronounce(v, line)) : pronounce(v, line);
  const ext = { kokoro: 'wav', qwen: 'wav', say: 'aiff' }[v.provider] ?? 'mp3';
  const key = zh ? [v.provider, v.voice, ZH_TTS_ID, v.speed, text] : qwen ? [v.provider, v.voice, QWEN_TTS_ID, v.speed, text, ...(qwenLang(text, v.lang) !== qwenLang(text) ? [qwenLang(text, v.lang)] : [])]
    : [v.provider, v.voice, v.model, v.speed, v.instructions, text];
  const hash = crypto.createHash('sha1').update(JSON.stringify(key)).digest('hex').slice(0, 16);
  return { text, written: line, file: path.join(dir, `${hash}.${ext}`), zh, qwen };
}

// A line's sentences, so each is spoken on its own with a pause after it (TTS engines run the
// sentences of one line together with barely a breath). Latin text breaks after . ! ? when a capital,
// digit or quote follows, but not after e.g., Dr., a lone initial (N. P. X.), 2.5 or myapp.com;
// Chinese and Japanese after 。！？.
const ABBREV = /^(e\.g|i\.e|etc|vs|approx|incl|cf|Mr|Mrs|Ms|Dr|Prof|St|No|Fig)\.$/i;
export function sentences(text) {
  const s = String(text).replace(/\s+/g, ' ').trim(), out = [];
  const re = /([.!?…]+["'”’)\]]*) +(?=["'“‘(\[]?[\p{Lu}\p{N}\p{Lo}])|([。！？]+[”’」』)）]*) */gu;
  let from = 0;
  for (let m; (m = re.exec(s));) {
    if (m[1]) {
      const word = s.slice(from, m.index + 1).match(/(\S+)$/)?.[1] ?? '';
      if (ABBREV.test(word) || /^\p{Lu}\.$/u.test(word)) continue;
    }
    const piece = s.slice(from, m.index + (m[1] ?? m[2]).length).trim();
    if (piece) out.push(piece);
    from = re.lastIndex;
  }
  if (s.slice(from).trim()) out.push(s.slice(from).trim());
  return out;
}
// One line as stereo Float32 PCM at 48 kHz, leading and trailing silence trimmed.
async function speakLine(cfg, line, log) {
  const v = cfg.voice;
  const { text, written, file, zh, qwen } = cached(cfg, line);
  if (!fs.existsSync(file)) {
    if (zh) await synthZh(v, [{ text, file }], { log });
    else if (qwen) await synthQwen(v, [{ text, written, file }], { log });
    else {
      log(`  tts (${v.provider}): "${text}"`);
      await synth(v, text, file);
    }
  }
  const trim = 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse';
  const pcm = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-af', trim, '-f', 'f32le', '-ac', '2', '-ar', `${SR}`, 'pipe:1'], { maxBuffer: 1 << 28 });
  return new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
}

// Where a line's sentences meet in its audio. Every break in the text (sentence ends, and commas,
// which voices pause at too) gets an expected time from the letters spoken before it; each quiet
// stretch belongs to the break it is nearest, and a sentence end takes the longest stretch that is
// its own, so a long pause at a comma is never mistaken for it. [start, end] in samples per channel,
// or null when the voice runs straight on (no quiet there to widen).
const WIN = SR / 100; // 10 ms
const letters = (s) => (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
export function sentenceGaps(pcm, sents) {
  const n = Math.floor(pcm.length / 2 / WIN), env = new Float32Array(n);
  let peak = 0;
  for (let w = 0; w < n; w++) {
    let e = 0;
    for (let i = w * WIN; i < (w + 1) * WIN; i++) e = Math.max(e, Math.abs(pcm[2 * i]), Math.abs(pcm[2 * i + 1]));
    env[w] = e; peak = Math.max(peak, e);
  }
  const quiet = [], thr = peak * 0.02;
  for (let w = 0; w < n;) {
    if (env[w] >= thr) { w++; continue; }
    const a = w;
    while (w < n && env[w] < thr) w++;
    if (w - a >= 4 && a > 0 && w < n) quiet.push([a, w]); // ≥ 40 ms, not the trimmed ends
  }
  // breaks in the text, at the share of letters spoken before them: { at, end: k } for the end of sentence k
  const total = letters(sents.join(' ')) || 1, breaks = [];
  let before = 0;
  for (const [k, s] of sents.entries()) {
    for (const m of s.matchAll(/[,;:，、；：]/g)) breaks.push({ at: (before + letters(s.slice(0, m.index))) / total });
    before += letters(s);
    if (k < sents.length - 1) breaks.push({ at: before / total, end: k });
  }
  const mine = sents.slice(0, -1).map(() => []);
  for (const q of quiet) {
    const mid = (q[0] + q[1]) / 2 / n;
    const b = breaks.reduce((x, y) => (Math.abs(y.at - mid) < Math.abs(x.at - mid) ? y : x));
    if (b.end != null && Math.abs(b.at - mid) < 0.25) mine[b.end].push(q);
  }
  let after = 0;
  return mine.map((qs) => {
    const best = qs.filter((q) => q[0] >= after).reduce((x, q) => (!x || q[1] - q[0] > x[1] - x[0] ? q : x), null);
    if (!best) return null;
    after = best[1];
    return [best[0] * WIN, best[1] * WIN];
  });
}

// A line as stereo Float32 PCM at 48 kHz, spoken in one go (so the voice keeps its flow from sentence
// to sentence), with each pause between sentences widened to at least `voice.pause` seconds: voices
// often run sentences together with barely a breath. parts: where each sentence is, in seconds (for
// subtitles).
export async function speak(cfg, line, { log = console.log } = {}) {
  const raw = await speakLine(cfg, line, log), pause = cfg.voice.pause ?? 0;
  const sents = pause > 0 ? sentences(line) : [];
  if (sents.length < 2) return { pcm: raw, parts: [{ text: line, start: 0, end: raw.length / 2 / SR }] };
  const gaps = sentenceGaps(raw, sents), want = Math.round(pause * SR);
  const add = gaps.map((g) => (g ? Math.max(0, want - (g[1] - g[0])) : 0));
  const pcm = new Float32Array(raw.length + 2 * add.reduce((a, b) => a + b, 0));
  const parts = [];
  let from = 0, to = 0, startAt = 0;
  for (const [k, g] of gaps.entries()) {
    if (!g) continue; // no quiet stretch: this sentence runs on into the next
    const mid = Math.round((g[0] + g[1]) / 2);
    pcm.set(raw.subarray(2 * from, 2 * mid), 2 * to);
    to += mid - from; from = mid;
    const end = to - (mid - g[0]);
    to += add[k]; // silence: the array is zero-filled
    parts.push({ text: sents.slice(parts.length ? parts.at(-1).next : 0, k + 1).join(' '), start: startAt / SR, end: end / SR, next: k + 1 });
    startAt = to + (g[1] - mid);
  }
  pcm.set(raw.subarray(2 * from), 2 * to);
  const last = parts.length ? parts.at(-1).next : 0;
  parts.push({ text: sents.slice(last).join(' '), start: startAt / SR, end: pcm.length / 2 / SR, next: sents.length });
  return { pcm, parts: parts.map(({ next, ...p }) => p) };
}

// Speed a clip up (factor > 1) with ffmpeg's pitch-preserving atempo.
export function tempo(pcm, factor) {
  if (!(factor >= 0.5 && factor <= 100)) throw new Error(`internal: speed factor ${factor} is outside what ffmpeg's atempo accepts (0.5–100)`);
  const out = execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'f32le', '-ac', '2', '-ar', `${SR}`, '-i', 'pipe:0',
    '-af', `atempo=${factor.toFixed(4)}`, '-f', 'f32le', '-ac', '2', '-ar', `${SR}`, 'pipe:1'], { input: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), maxBuffer: 1 << 28 });
  return new Float32Array(out.buffer, out.byteOffset, out.length / 4);
}

// Synthesize every narration line up front and return their lengths (seconds),
// so `duration: auto` steps can be timed to the voice.
export async function measureVoice(cfg, { log = console.log } = {}) {
  const seconds = ({ pcm }) => pcm.length / 2 / SR;
  const lens = { steps: {}, endCard: null, intro: null, cards: {} };
  if (!cfg.voice) return lens;
  if (cfg.voice.fallback) log(`note: ${cfg.voice.fallback}`);
  const zh = cfg.voice.provider === 'kokoro' && isZhVoice(cfg.voice.voice);
  if (zh || cfg.voice.provider === 'qwen') {
    // synthesize every uncached line in one batch, so Python (the G2P, or the Qwen model) starts once
    const lines = [...cfg.steps.filter((s) => !s.hidden).flatMap((s) => [s.say, s.card?.say]), cfg.intro?.say, cfg.endCard?.say].filter(Boolean);
    const todo = new Map(lines.map((l) => cached(cfg, l)).filter((c) => !fs.existsSync(c.file)).map((c) => [c.file, c]));
    await (zh ? synthZh : synthQwen)(cfg.voice, [...todo.values()], { log });
  }
  for (const [i, s] of cfg.steps.entries()) {
    if (s.say && !s.hidden) lens.steps[i] = seconds(await speak(cfg, s.say, { log }));
    if (s.card?.say && !s.hidden) lens.cards[i] = seconds(await speak(cfg, s.card.say, { log }));
  }
  if (cfg.intro?.say) lens.intro = seconds(await speak(cfg, cfg.intro.say, { log }));
  if (cfg.endCard?.say) lens.endCard = seconds(await speak(cfg, cfg.endCard.say, { log }));
  return lens;
}
