// Soundtrack: synthesized royalty-free music (or a user-supplied file) plus UI
// sound effects synced to the composed video's events, muxed into the final MP4.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { speak, tempo } from './voice.mjs';

const SR = 48000;
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const saw = (ph) => 2 * (ph - Math.floor(ph + 0.5));

export async function soundtrack(cfg, events, silentVideo, { log = console.log } = {}) {
  const warnings = [];
  const warn = (m) => { warnings.push(m); log(`warning: ${m}`); };
  const N = Math.ceil(events.total * SR);
  const music = [new Float32Array(N), new Float32Array(N)];
  const sfx = [new Float32Array(N), new Float32Array(N)];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  function add(buf, t0, len, fn, gain = 1, pan = 0) {
    const s0 = Math.round(t0 * SR), n = Math.round(len * SR);
    const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
    for (let i = 0; i < n; i++) {
      const j = s0 + i; if (j < 0 || j >= N) continue;
      const v = fn(i / SR, i);
      buf[0][j] += v * gl; buf[1][j] += v * gr;
    }
  }
  // state-variable filter (returns a per-sample processor)
  function svf() {
    let lp = 0, bp = 0;
    return (x, fc, q = 0.7) => {
      const f = 2 * Math.sin(Math.PI * Math.min(fc, SR / 6) / SR);
      const hp = x - lp - bp / q; bp += f * hp; lp += f * bp;
      return { lp, bp, hp };
    };
  }

  // --- music ----------------------------------------------------------------------------
  if (cfg.music?.file) {
    const pcm = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', cfg.music.file, '-t', `${events.total}`,
      '-f', 'f32le', '-ac', '2', '-ar', `${SR}`, 'pipe:1'], { maxBuffer: 1 << 30 });
    const f = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
    for (let i = 0; i < Math.min(N, f.length / 2); i++) { music[0][i] = f[2 * i] * 0.5; music[1][i] = f[2 * i + 1] * 0.5; }
  } else if (cfg.music) {
    // I–V–vi–IV in C at `bpm`, resolving on the end card (or fading at the end)
    const BEAT = 60 / cfg.music.bpm, BAR = BEAT * 4;
    const chords = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]];
    const endT = events.endCard ?? events.total;
    for (let b = 0, t0 = 0; t0 < endT; b++, t0 = b * BAR) {
      const ch = chords[b % chords.length], len = Math.min(BAR, endT - t0);
      ch.forEach((note, k) => {
        for (const det of [-0.08, 0.08]) {
          const f = hz(note + det), filt = svf();
          add(music, t0, len + 0.15, (t) => {
            const env = Math.min(1, t / 0.25) * Math.min(1, Math.max(0, len + 0.15 - t) / 0.2);
            return filt(saw(f * t), 900 + 500 * Math.sin(t * 1.3)).lp * env;
          }, 0.035, (k - 1) * 0.5 + det * 3);
        }
      });
      for (let i = 0; i < 4 && t0 + i * BEAT < endT; i++) {
        const f = hz(ch[0] - 24);
        add(music, t0 + i * BEAT, BEAT * 0.95, (t) => Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 4) * Math.min(1, t / 0.005), 0.22);
      }
      const arp = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[1] + 12];
      for (let i = 0; i < 8 && t0 + i * BEAT / 2 < endT; i++) {
        const f = hz(arp[i % 4]);
        add(music, t0 + i * BEAT / 2, 0.4, (t) =>
          (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) * Math.exp(-t * 11) * Math.min(1, t / 0.003),
          0.06, i % 2 ? 0.35 : -0.35);
      }
    }
    for (let t = BAR; t < endT - BEAT / 2; t += BEAT) {
      add(music, t, 0.3, (x) => Math.sin(2 * Math.PI * (45 + 90 * Math.exp(-x * 30)) * x - 4 * Math.exp(-x * 30)) * Math.exp(-x * 9), 0.5);
    }
    for (let t = 2 * BAR + BEAT / 2; t < endT - BEAT; t += BEAT) {
      const filt = svf();
      add(music, t, 0.06, (x) => filt(rand(), 8000, 0.8).hp * Math.exp(-x * 60), 0.06, 0.25);
    }
    if (events.endCard != null) {
      for (const note of [48, 60, 64, 67, 72]) {
        const f = hz(note);
        add(music, endT, events.total - endT, (t) =>
          (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t)) * Math.exp(-t * 1.6) * Math.min(1, t / 0.01), 0.07);
      }
      add(music, endT, 0.3, (x) => Math.sin(2 * Math.PI * (45 + 90 * Math.exp(-x * 30)) * x) * Math.exp(-x * 8), 0.55);
      const filt = svf();
      add(music, endT, events.total - endT, (x) => filt(rand(), 6000, 0.6).hp * Math.exp(-x * 2.5), 0.12);
    }
  }
  if (cfg.music) for (const c of music) for (let i = 0; i < N; i++) c[i] *= cfg.music.volume;

  // --- sound effects ------------------------------------------------------------------------
  if (cfg.sfx) {
    // a mouse click: the press (band-passed noise with a small body thump), then a quieter release
    for (const c of events.clicks) {
      const fa = svf(), fb = svf();
      add(sfx, c, 0.1, (t) => {
        const press = t < 0.02 ? (fa(rand(), 3200, 2.5).bp * 1.4 + Math.sin(2 * Math.PI * 190 * t) * 0.5) * Math.exp(-t * 320) : 0;
        const r = t - 0.075, release = r > 0 && r < 0.015 ? fb(rand(), 4200, 3).bp * 0.8 * Math.exp(-r * 420) : 0;
        return press + release;
      }, 0.55);
    }
    for (const c of events.whooshes) {
      const filt = svf(), len = 0.45;
      add(sfx, c - len * 0.55, len, (t) => {
        const p = t / len;
        return filt(rand(), 400 + 5000 * Math.sin(Math.PI * p), 1.6).bp * Math.pow(Math.sin(Math.PI * p), 2);
      }, 0.5);
    }
    for (const [a, b] of events.risers) {
      const len = b - a, filt = svf();
      let ph = 0;
      add(sfx, a, len, (t) => {
        const p = t / len, f = 220 * Math.pow(6, p);
        ph += f / SR;
        return (filt(rand(), 500 + 7000 * p, 2).bp * 0.6 + Math.sin(2 * Math.PI * ph) * 0.25) * p * p;
      }, 0.35);
    }
    for (const t0 of events.chimes) {
      [84, 88, 91, 96].forEach((note, i) => {
        const f = hz(note);
        add(sfx, t0 + i * 0.06, 0.8, (t) =>
          (Math.sin(2 * Math.PI * f * t) + 0.2 * Math.sin(6 * Math.PI * f * t)) * Math.exp(-t * 5) * Math.min(1, t / 0.004), 0.09, (i - 1.5) * 0.3);
      });
    }
  }

  // --- voiceover ----------------------------------------------------------------------------------
  const voice = [new Float32Array(N), new Float32Array(N)];
  const voiceOn = new Uint8Array(N);
  const narration = [];
  if (cfg.voice && events.voice?.length) {
    let prevEnd = 0;
    for (const line of events.voice) {
      let pcm = await speak(cfg, line.text, { log });
      let dur = pcm.length / 2 / SR;
      const start = Math.max(line.start, prevEnd + 0.12), room = line.until - start - 0.1;
      let sped = 1;
      if (dur > room && dur / room <= 1.2) { sped = dur / room; pcm = tempo(pcm, sped); dur = pcm.length / 2 / SR; }
      else if (dur > room) warn(`${line.where}: narration is ${dur.toFixed(1)}s but only ${Math.max(0, room).toFixed(1)}s until ${line === events.voice.at(-1) ? 'the video ends' : 'the next line'} — shorten "${line.text}" or give the step more duration`);
      log(`  voice ${start.toFixed(2)}–${(start + dur).toFixed(2)}s  ${line.where}${sped > 1 ? `  (sped up x${sped.toFixed(2)})` : ''}  "${line.text}"`);
      let pk = 0;
      for (const v of pcm) pk = Math.max(pk, Math.abs(v));
      const g = (0.9 / (pk || 1)) * cfg.voice.volume, s0 = Math.round(start * SR);
      for (let i = 0; i < pcm.length / 2 && s0 + i < N; i++) {
        voice[0][s0 + i] += pcm[2 * i] * g; voice[1][s0 + i] += pcm[2 * i + 1] * g;
        voiceOn[s0 + i] = 1;
      }
      prevEnd = start + dur;
      narration.push({ start, end: start + dur, text: line.text });
    }
  }

  // --- mix: duck music under voice and sfx, master fade, normalize -----------------------------------
  const out = [new Float32Array(N), new Float32Array(N)];
  let env = 0, venv = 0, peak = 0;
  const vAttack = 1 - Math.exp(-1 / (0.04 * SR)), vRelease = 1 - Math.exp(-1 / (0.35 * SR));
  const musicBed = cfg.voice && events.voice?.length ? 0.75 : 1;
  for (let i = 0; i < N; i++) {
    const lvl = Math.max(Math.abs(sfx[0][i]), Math.abs(sfx[1][i]));
    env = lvl > env ? lvl : env * 0.9997;
    venv += (voiceOn[i] - venv) * (voiceOn[i] > venv ? vAttack : vRelease);
    const duck = (1 - Math.min(0.35, env * 0.8)) * (1 - 0.6 * venv) * musicBed;
    const t = i / SR, fade = Math.min(1, t / 0.08) * Math.min(1, (events.total - t) / 0.35);
    for (let ch = 0; ch < 2; ch++) {
      out[ch][i] = Math.tanh((music[ch][i] * duck + sfx[ch][i] * (1 - 0.3 * venv) + voice[ch][i] * 0.85) * 1.1) * fade;
      peak = Math.max(peak, Math.abs(out[ch][i]));
    }
  }
  fs.mkdirSync(path.dirname(cfg.out), { recursive: true });
  if (peak === 0) { // no music, no sfx
    fs.copyFileSync(silentVideo, cfg.out);
    return { out: cfg.out, warnings, narration };
  }
  const g = 0.89 / peak;
  const wav = Buffer.alloc(44 + N * 4);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + N * 4, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(SR, 24);
  wav.writeUInt32LE(SR * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(N * 4, 40);
  for (let i = 0; i < N; i++) for (let ch = 0; ch < 2; ch++)
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[ch][i] * g)) * 32767), 44 + i * 4 + ch * 2);
  const wavFile = path.join(cfg.work, 'soundtrack.wav');
  fs.writeFileSync(wavFile, wav);

  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silentVideo, '-i', wavFile,
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', `${SR}`, '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', cfg.out]);
  log(`soundtrack: ${cfg.music ? (cfg.music.file ? 'music file' : `synth ${cfg.music.bpm} bpm`) : 'no music'}, ${events.clicks.length} clicks, ${events.whooshes.length} whooshes` +
    (cfg.voice ? `, ${events.voice.length} narration lines (${cfg.voice.provider}/${cfg.voice.voice})` : ''));
  return { out: cfg.out, warnings, narration };
}
