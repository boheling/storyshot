// Voiceover: text-to-speech for each step's `say:` line, cached on disk.
// Providers: kokoro (local, free: English, and Mandarin with the v1.1-zh voices), qwen (local, free, Apple
// Silicon: Qwen3-TTS, best for Chinese), elevenlabs, openai, say (macOS).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isZhVoice, synthZh, zhSpeakText, ZH_DEFAULT_VOICE, ZH_TTS_ID } from './kokoro-zh.mjs';
import { qwenSpeakText, QWEN_TTS_ID, synthQwen } from './qwen-tts.mjs';

const SR = 48000;
export const VOICE_DEFAULTS = {
  kokoro: { voice: 'af_heart' },
  qwen: { voice: 'serena' },
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

// qwen without a named voice: serena for Chinese, ono_anna for Japanese, sohee for Korean, aiden otherwise
export function qwenVoiceFor(raw) {
  const says = narration(raw);
  if (/[\u3040-\u30ff]/.test(says) || /^ja/i.test(String(raw.lang ?? ''))) return 'ono_anna';
  if (/[\uac00-\ud7af]/.test(says) || /^ko/i.test(String(raw.lang ?? ''))) return 'sohee';
  return narrationIsChinese(raw) ? VOICE_DEFAULTS.qwen.voice : 'aiden';
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
  const key = zh ? [v.provider, v.voice, ZH_TTS_ID, v.speed, text] : qwen ? [v.provider, v.voice, QWEN_TTS_ID, v.speed, text]
    : [v.provider, v.voice, v.model, v.speed, v.instructions, text];
  const hash = crypto.createHash('sha1').update(JSON.stringify(key)).digest('hex').slice(0, 16);
  return { text, file: path.join(dir, `${hash}.${ext}`), zh, qwen };
}

// Returns stereo Float32 PCM at 48 kHz with leading/trailing silence trimmed.
export async function speak(cfg, line, { log = console.log } = {}) {
  const v = cfg.voice;
  const { text, file, zh, qwen } = cached(cfg, line);
  if (!fs.existsSync(file)) {
    if (zh) await synthZh(v, [{ text, file }], { log });
    else if (qwen) await synthQwen(v, [{ text, file }], { log });
    else {
      log(`  tts (${v.provider}): "${text}"`);
      await synth(v, text, file);
    }
  }
  const trim = 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse';
  const pcm = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-af', trim, '-f', 'f32le', '-ac', '2', '-ar', `${SR}`, 'pipe:1'], { maxBuffer: 1 << 28 });
  return new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
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
    if (s.say && !s.hidden) lens.steps[i] = (await speak(cfg, s.say, { log })).length / 2 / SR;
    if (s.card?.say && !s.hidden) lens.cards[i] = (await speak(cfg, s.card.say, { log })).length / 2 / SR;
  }
  if (cfg.intro?.say) lens.intro = (await speak(cfg, cfg.intro.say, { log })).length / 2 / SR;
  if (cfg.endCard?.say) lens.endCard = (await speak(cfg, cfg.endCard.say, { log })).length / 2 / SR;
  return lens;
}
