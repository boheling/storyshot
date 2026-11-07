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
    const sp = await speak(cfg, s.say, { log, chunk: true });
    len = sp.pcm.length / 2 / SR;
    cues = phraseTimes(sp.pcm, sp.parts);
  }
  const seconds = sceneSeconds(s, len);
  const { width: W, height: H, fps: FPS } = cfg.output;
  const { accent, ink, font } = cfg.theme;
  const ctx = { W, H, FPS, accent, ink, font, lang: cfg.lang, subs: cfg.subtitles === 'burn', fontFaces: sceneFontFaces(font) };
  const job = { name: `step${stepNo}`, kind: 'scene', seconds, scene: s.scene, say: s.say, lead: s.scene.lead, cues, step: i, preview: true, kit: cfg.sceneKit };
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
  // HOLD is a probe, not a shot worth looking at: the same picture at HOLD and at the end means
  // nothing has moved for the last 2.5 s (see "does the film end, or does it just stop?" below).
  const HOLD = seconds > 4 ? +(seconds - 2.55).toFixed(2) : null;
  let times = at?.length ? at : [...local.map((c) => c.t + Math.min(0.9, (c.end - c.t) * 0.6)), HOLD, seconds - 0.05];
  times = [...new Set(times.filter((t) => t != null).map((t) => +Math.max(0, Math.min(seconds - 0.02, t)).toFixed(2)))].sort((a, b) => a - b);
  if (times.length > 12) {
    times = Array.from({ length: 12 }, (_, k) => times[Math.round(k * (times.length - 1) / 11)]);
    if (HOLD != null && !at?.length && !times.includes(HOLD)) times = [...new Set([...times, HOLD])].sort((a, b) => a - b);
  }
  const shots = path.join(dir, 'shots');
  const r = await hyperframesRun(['snapshot', dir, '--at', times.join(','), '--no-end', '--output', shots], { log });
  if (r.code !== 0) throw new Error(`the scene did not load in HyperFrames: ${(r.err || r.out).trim().split('\n').filter(Boolean).slice(-4).join(' | ')}`);
  const files = fs.existsSync(shots) ? fs.readdirSync(shots).sort() : [];
  const images = files.filter((f) => /^frame-.*\.png$/.test(f)).map((f) => path.join(shots, f));
  const sheets = files.filter((f) => /^contact-sheet/.test(f)).map((f) => path.join(shots, f)), sheet = sheets[0] ?? null;

  // check: overlaps, text off the frame, contrast, text too small (needs a browser: ~20 s)
  const found = { errors: [], warnings: [] };
  if (check) {
    const c = await hyperframesRun(['check', dir, '--json', '--samples', '6'], { log });
    try {
      const j = JSON.parse(c.out.slice(c.out.indexOf('{')));
      for (const k of ['runtime', 'layout', 'contrast', 'craft']) {
        for (const f of j[k]?.findings ?? []) {
          if (f.severity === 'info') continue;
          // only the video's own first frame is its thumbnail, and only its last line needs the long hold
          const visible = cfg.steps.map((x, k) => (x.hidden ? -1 : k)).filter((k) => k >= 0);
          if (f.code === 'first_frame_empty' && visible[0] !== i) continue;
          if (f.code === 'line_unread' && /last line/i.test(f.message ?? '') && (visible.at(-1) !== i || cfg.endCard)) continue;
          if (f.selector && /storyshot-subtitle-band/.test(f.selector)) continue;
          if (f.code === 'film_silent') continue; // the video's sound comes from Storyshot, not the scene
          const where = [f.selector, f.time != null ? `at ${Number(f.time).toFixed(1)}s` : null].filter(Boolean).join(' ');
          const hint = HINTS[f.code] ? ` → ${HINTS[f.code]}` : '';
          (f.severity === 'error' ? found.errors : found.warnings).push(`${f.code}${where ? ` (${where})` : ''}: ${f.message}${hint}`);
        }
      }
    } catch { found.warnings.push(`the layout check could not run: ${(c.err || c.out).trim().split('\n').slice(-2).join(' | ')}`); }
    // one line for a finding repeated on siblings (a counter's digits, a row of tiles)
    for (const k of ['errors', 'warnings']) {
      const groups = new Map();
      for (const w of found[k]) {
        const key = w.replace(/:nth-of-type\(\d+\)/g, '').replace(/ at [\d.]+s/, '').replace(/"[^"]*"/g, '"…"').replace(/[\d.]+ s \(±[\d.]+ s\)/, '').slice(0, 120);
        groups.set(key, [...(groups.get(key) ?? []), w]);
      }
      found[k] = [...groups.values()].map((ws) => (ws.length > 1 ? `${ws[0]} (and ${ws.length - 1} more like it)` : ws[0]));
    }
  }
  // Does the film end, or does it just stop? A recap scene adds and adds, and its last frame — the
  // fullest of the whole film — is then held until the file runs out. The layout check samples too
  // few moments to see it, but the stills are already rendered: if the last two are the same picture
  // and they are seconds apart, the film has no last beat. (Only the film's last scene: a held frame
  // in the middle is a pause, and a scene handing over to an end card has already done its part.)
  const last = cfg.steps.map((x, k) => (x.hidden ? -1 : k)).filter((k) => k >= 0).at(-1);
  const hold = HOLD == null ? -1 : times.indexOf(HOLD);
  if (images.length === times.length && hold >= 0 && hold < times.length - 1 && last === i && !cfg.endCard) {
    const same = (a, b) => { try { return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch { return false; } };
    if (same(images[images.length - 1], images[hold])) {
      found.warnings.push(
        `frozen_ending (at ${times[times.length - 1].toFixed(1)}s): nothing has changed on screen since ${times[hold].toFixed(1)}s, ` +
        `so the film ends on a still frame of its fullest moment. A frozen picture is usually the symptom: check the WORDS first — read this ` +
        `scene's say: line alone, and if it summarises and stops rather than concluding, the film has no ending to show. An explainer ends on a ` +
        `closing beat of its own after the recap: what this actually means, what is still open, and one thought to leave with. Then clear everything ` +
        `except the one thing the viewer should leave holding, land that move ON the final words, and prefer a move still running when the file ends`);
    }
  }
  return { dir, seconds, cues: local, times, images, sheet, sheets, lint,
    check: check || found.warnings.length ? found : null, subs: ctx.subs };
}

// What to do about the findings agents meet most in scenes (HyperFrames' own messages point at its docs).
const HINTS = {
  text_below_floor: 'text meant to be read: at least 28 px at 1080p; a source credit or a label that is only texture may stay small with data-layout-ignore on it',
  escaped_container: 'a glow or a part meant to spill out of its box: add data-layout-allow-overflow to the box',
  content_overlap: 'parts meant to overlap (a label on its object): add data-layout-allow-overlap to their container',
  line_unread: 'hold the text longer: reveal it on an earlier phrase (S.at), or give the scene more tail: (seconds after the voice)',
  text_occluded: 'text under another element: move one of them, or add data-layout-allow-occlusion if that is the point',
};

export function formatPreview(r, stepNo) {
  const list = (xs) => xs.map((x) => `    ${x}`).join('\n');
  return [
    `step ${stepNo} scene: ${r.seconds.toFixed(2)}s`,
    ...(r.cues.length ? ['  cues (scene seconds):', ...r.cues.map((c, k) => `    S.at(${k}) = ${c.t.toFixed(2)} → ${c.end.toFixed(2)}  ${c.text}`)] : ['  (no narration: S.at(k) = lead + k seconds)']),
    `  stills at ${r.times.join(', ')}s:`, ...r.images.map((f) => `    ${f}`), ...(r.sheets ?? []).map((f) => `  contact sheet: ${f}`),
    ...(r.lint.errors.length ? ['  ✖ lint errors:', list(r.lint.errors)] : []), ...(r.lint.warnings.length ? ['  ⚠ lint warnings:', list(r.lint.warnings)] : []),
    ...(r.check ? [r.check.errors.length || r.check.warnings.length ? '  layout check:' : '  ✔ layout check: nothing found', ...r.check.errors.map((e) => `    ✖ ${e}`), ...r.check.warnings.map((w) => `    ⚠ ${w}`)] : []),
    `  look at every still: does each part appear when the voice names it, and does anything overlap, crop or sit under the subtitles${r.subs ? ' (the striped red band)' : ''}?`,
    ...(r.lint.errors.length || r.lint.warnings.length || r.check?.errors.length || r.check?.warnings.length ? ['  (references/….md in these messages are HyperFrames docs: https://hyperframes.heygen.com)'] : []),
  ].join('\n');
}
