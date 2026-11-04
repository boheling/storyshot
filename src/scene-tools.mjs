// The two tools for writing scenes: the cue table (when each phrase of each scene's narration is
// spoken, so the animation can land on the words) and a preview of one scene (stills at chosen
// moments, plus HyperFrames' own lint and layout check), without rendering the whole video.
import fs from 'node:fs';
import path from 'node:path';
import { measureVoice, speak, phraseTimes } from './voice.mjs';
import { sceneTimings, sceneSeconds, writeSceneProject, formatTimings } from './scenes.mjs';
import { hyperframesRun, sceneFontFaces } from './hyperframes.mjs';

const SR = 48000;

// Every scene step's timing and cues; also written to .storyshot/<name>/cues.json.
export async function sceneCues(cfg, { log = console.log } = {}) {
  const lens = await measureVoice(cfg, { log });
  const list = sceneTimings(cfg, lens);
  fs.mkdirSync(cfg.work, { recursive: true });
  const file = path.join(cfg.work, 'cues.json');
  fs.writeFileSync(file, JSON.stringify(list.map((s) => ({ ...s, file: path.relative(path.dirname(cfg.work), s.file) })), null, 1));
  return { list, file, text: formatTimings(list) };
}

// One scene as HyperFrames will render it: stills at `at` (scene seconds; default: as each phrase is
// spoken, and the last frame), HyperFrames lint, and (check: true) its layout/contrast check.
export async function previewScene(cfg, stepNo, { at, check = true, log = console.log } = {}) {
  const i = stepNo - 1, s = cfg.steps[i];
  if (!s) throw new Error(`the storyboard has ${cfg.steps.length} steps, not ${stepNo}`);
  if (!s.scene) throw new Error(`step ${stepNo} is not a scene (it records the web app: preview it with render --draft, or inspect after_step)`);
  let len = null, cues = [];
  if (s.say && cfg.voice) {
    const sp = await speak(cfg, s.say, { log });
    len = sp.pcm.length / 2 / SR;
    cues = phraseTimes(sp.pcm, sp.parts);
  }
  const seconds = sceneSeconds(s, len);
  const { width: W, height: H, fps: FPS } = cfg.output;
  const { accent, ink, font } = cfg.theme;
  const ctx = { W, H, FPS, accent, ink, font, lang: cfg.lang, subs: cfg.subtitles === 'burn', fontFaces: sceneFontFaces(font) };
  const job = { name: `step${stepNo}`, kind: 'scene', seconds, scene: s.scene, say: s.say, lead: s.scene.lead, cues, step: i };
  const dir = path.join(cfg.work, 'scene-preview', `step-${stepNo}`);
  fs.rmSync(dir, { recursive: true, force: true });
  writeSceneProject(job, ctx, dir);
  const local = cues.map((c) => ({ text: c.text, t: +(c.t + s.scene.lead).toFixed(2), end: +(c.end + s.scene.lead).toFixed(2) }));

  // lint: the HyperFrames contract (fast, no browser)
  const lint = { errors: [], warnings: [] };
  {
    const r = await hyperframesRun(['lint', dir, '--json'], { log });
    try {
      const j = JSON.parse(r.out.slice(r.out.indexOf('{')));
      for (const f of j.findings ?? []) {
        // the wrapper is ours: only what is about the scene file counts
        if (f.file && !/scene\.html$/.test(f.file)) continue;
        (f.severity === 'error' ? lint.errors : f.severity === 'warning' ? lint.warnings : []).push(`${f.code}: ${f.message}${f.fixHint ? ` — ${f.fixHint}` : ''}`);
      }
    } catch { if (r.code !== 0) lint.errors.push((r.err || r.out).trim().split('\n').slice(-3).join(' | ')); }
  }

  // stills: as each phrase is spoken (a beat into it), and the end
  let times = at?.length ? at : [...local.map((c) => c.t + Math.min(0.9, (c.end - c.t) * 0.6)), seconds - 0.05];
  times = [...new Set(times.map((t) => +Math.max(0, Math.min(seconds - 0.02, t)).toFixed(2)))].sort((a, b) => a - b);
  if (times.length > 12) times = Array.from({ length: 12 }, (_, k) => times[Math.round(k * (times.length - 1) / 11)]);
  const shots = path.join(dir, 'shots');
  const r = await hyperframesRun(['snapshot', dir, '--at', times.join(','), '--no-end', '--output', shots], { log });
  if (r.code !== 0) throw new Error(`the scene did not load in HyperFrames: ${(r.err || r.out).trim().split('\n').filter(Boolean).slice(-4).join(' | ')}`);
  const files = fs.existsSync(shots) ? fs.readdirSync(shots).sort() : [];
  const images = files.filter((f) => /^frame-.*\.png$/.test(f)).map((f) => path.join(shots, f));
  const sheet = files.filter((f) => /^contact-sheet/.test(f)).map((f) => path.join(shots, f))[0] ?? null;

  // check: overlaps, text off the frame, contrast, text too small (needs a browser: ~20 s)
  const found = { errors: [], warnings: [] };
  if (check) {
    const c = await hyperframesRun(['check', dir, '--json', '--samples', '6'], { log });
    try {
      const j = JSON.parse(c.out.slice(c.out.indexOf('{')));
      for (const k of ['runtime', 'layout', 'contrast', 'craft']) {
        for (const f of j[k]?.findings ?? []) {
          if (f.severity === 'info') continue;
          // only the video's own first frame is its thumbnail
          if (f.code === 'first_frame_empty' && cfg.steps.findIndex((x) => !x.hidden) !== i) continue;
          const where = [f.selector, f.time != null ? `at ${Number(f.time).toFixed(1)}s` : null].filter(Boolean).join(' ');
          (f.severity === 'error' ? found.errors : found.warnings).push(`${f.code}${where ? ` (${where})` : ''}: ${f.message}`);
        }
      }
    } catch { found.warnings.push(`the layout check could not run: ${(c.err || c.out).trim().split('\n').slice(-2).join(' | ')}`); }
  }
  return { dir, seconds, cues: local, times, images, sheet, lint, check: check ? found : null };
}

export function formatPreview(r, stepNo) {
  const list = (xs) => xs.map((x) => `    ${x}`).join('\n');
  return [
    `step ${stepNo} scene: ${r.seconds.toFixed(2)}s`,
    ...(r.cues.length ? ['  cues (scene seconds):', ...r.cues.map((c, k) => `    S.at(${k}) = ${c.t.toFixed(2)} → ${c.end.toFixed(2)}  ${c.text}`)] : ['  (no narration: S.at(k) = lead + k seconds)']),
    `  stills at ${r.times.join(', ')}s:`, ...r.images.map((f) => `    ${f}`), ...(r.sheet ? [`  contact sheet: ${r.sheet}`] : []),
    ...(r.lint.errors.length ? ['  ✖ lint errors:', list(r.lint.errors)] : []), ...(r.lint.warnings.length ? ['  ⚠ lint warnings:', list(r.lint.warnings)] : []),
    ...(r.check ? [r.check.errors.length || r.check.warnings.length ? '  layout check:' : '  ✔ layout check: nothing found', ...r.check.errors.map((e) => `    ✖ ${e}`), ...r.check.warnings.map((w) => `    ⚠ ${w}`)] : []),
    `  look at every still: does each part appear when the voice names it, and does anything overlap, crop or sit under the subtitles?`,
  ].join('\n');
}
