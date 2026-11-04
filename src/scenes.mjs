// Scenes: a step whose picture is an animation the agent writes (a HyperFrames composition) instead
// of a recording of the web app: a concept, a mechanism, a diagram that grows while the voice explains
// it. `purpose: explainer` storyboards are made of scenes only (no url, nothing recorded); tutorials
// and lessons can put a scene between recorded steps.
//
// A scene file is one HyperFrames sub-composition: a <template> with a root element whose id and
// data-composition-id are the same, and a script that registers one paused GSAP timeline under that
// id. Storyshot wraps it in a project of its own, as long as the step's narration needs, and gives it
// `window.__storyshot`: the duration, the frame size, the theme, and `cues`, when each phrase of the
// step's `say:` line is spoken, so the animation lands on the words (`S.at(2)` = when the third phrase
// starts). Media the scene uses sit in an `assets/` folder next to the scene file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SCENE_DEFAULTS = { lead: 0.5, tail: 0.8 };
export const GSAP_URL = 'https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js';

// How long a scene plays: a fixed `duration`, else its narration plus a lead-in and a tail.
export function sceneSeconds(step, voiceLen) {
  if (typeof step.duration === 'number') return step.duration;
  const { lead, tail } = step.scene;
  return voiceLen == null ? 4 : Math.max(1.5, lead + voiceLen + tail);
}

// What a scene file declares, and what is wrong with it (errors stop the render, warnings don't).
export function sceneInfo(file, { width, height } = {}) {
  const errors = [], warnings = [];
  if (!fs.existsSync(file)) return { errors: [`the scene ${file} does not exist — write it (\`storyshot init --purpose explainer\` writes a starter)`], warnings };
  const html = fs.readFileSync(file, 'utf8');
  const name = path.basename(file);
  if (!/<template[\s>]/i.test(html)) errors.push(`${name}: a scene puts its styles, markup and script inside one <template> … </template>`);
  const id = html.match(/data-composition-id\s*=\s*["']([^"']+)["']/)?.[1];
  if (!id) errors.push(`${name}: the scene's root element needs data-composition-id="<id>" (and the same id)`);
  else {
    const tag = html.match(new RegExp(`<[a-z][^>]*data-composition-id\\s*=\\s*["']${id}["'][^>]*>`, 'i'))?.[0] ?? '';
    const elId = tag.match(/\sid\s*=\s*["']([^"']+)["']/)?.[1];
    if (elId !== id) errors.push(`${name}: the root element's id must equal its data-composition-id ("${id}"), or HyperFrames shows a still`);
    const re = new RegExp(`__timelines\\s*\\[\\s*["'\`]${id}["'\`]\\s*\\]\\s*=`);
    if (!re.test(html)) errors.push(`${name}: register the scene's timeline: window.__timelines['${id}'] = tl;`);
    const w = Number(tag.match(/data-width\s*=\s*["'](\d+)/)?.[1]), h = Number(tag.match(/data-height\s*=\s*["'](\d+)/)?.[1]);
    if (width && height && w && h && (w !== width || h !== height)) errors.push(`${name}: the scene is ${w}x${h} but the video is ${width}x${height} — set data-width/data-height to the video's size`);
  }
  if (/\bDate\.now\(|\bnew Date\(|setTimeout\(|setInterval\(|requestAnimationFrame\(/.test(html)) errors.push(`${name}: no clocks or timers in a scene (Date, setTimeout, requestAnimationFrame): everything on screen must follow the timeline, which is seeked frame by frame`);
  if (/Math\.random\(/.test(html)) warnings.push(`${name}: Math.random() gives a different picture on every render — use a seeded generator`);
  if (/repeat\s*:\s*-1/.test(html)) errors.push(`${name}: repeat: -1 never ends; repeat a fixed number of times`);
  if (!/__storyshot/.test(html)) warnings.push(`${name}: times nothing from window.__storyshot — read them from its cues (S.at(k)) so the animation stays on the words when the narration changes`);
  if (/["'(]\/assets\//.test(html)) errors.push(`${name}: asset paths are relative: "assets/…", not "/assets/…"`);
  return { id, html, errors, warnings };
}

// Every file in the scene's assets/ folder: { 'sub/x.png': '/abs/…/assets/sub/x.png' }
export function sceneAssets(file) {
  const root = path.join(path.dirname(file), 'assets'), out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else out[path.relative(root, f).split(path.sep).join('/')] = f;
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

// The runtime a scene reads: window.__storyshot.
//   duration, width, height, lang, lead (when the voice starts), say (the line), safeBottom (px the
//   burned-in subtitles take at the bottom, 0 without them), theme { accent, ink, font }
//   cues: [{ text, t, end }] in scene seconds
//   at(k, offset = 0): when phrase k starts (0-based; -1 = the last; or a piece of its text)
//   end(k, offset = 0): when it ends
export function sceneRuntime(job, ctx) {
  const data = {
    duration: +job.seconds.toFixed(3), width: ctx.W, height: ctx.H, lang: ctx.lang, lead: job.lead, say: job.say ?? '',
    safeBottom: ctx.subs ? Math.round(ctx.H > ctx.W ? ctx.H * 0.22 : ctx.H * 0.16) : 0,
    theme: { accent: ctx.accent, ink: ctx.ink, font: ctx.font },
    cues: (job.cues ?? []).map((c) => ({ text: c.text, t: +(c.t + job.lead).toFixed(3), end: +(c.end + job.lead).toFixed(3) })),
  };
  return `window.__storyshot = Object.assign(${JSON.stringify(data)}, {
  _find(k) {
    const c = this.cues;
    if (!c.length) return null;
    if (typeof k === 'string') { const i = c.findIndex((x) => x.text.includes(k)); if (i < 0) throw new Error('no cue contains "' + k + '"'); return c[i]; }
    return c[Math.max(0, Math.min(c.length - 1, k < 0 ? c.length + k : k))];
  },
  at(k, offset = 0) { const c = this._find(k); return Math.max(0, (c ? c.t : this.lead + (typeof k === 'number' ? k : 0)) + offset); },
  end(k, offset = 0) { const c = this._find(k); return Math.max(0, (c ? c.end : this.lead + (typeof k === 'number' ? k + 1 : 1)) + offset); },
});`;
}

// The project HyperFrames renders for one scene: a root as long as the scene, mounting the scene file.
export function sceneDoc(job, ctx, info) {
  const { W, H } = ctx, D = job.seconds.toFixed(3);
  return `<!doctype html><html lang="${ctx.lang ?? 'en'}"><head><meta charset="UTF-8"><meta name="viewport" content="width=${W}, height=${H}">
<script src="${GSAP_URL}"></script>
<style>
${ctx.fontFaces}
:root{--accent:${ctx.accent};--ink:${ctx.ink};--font:'${ctx.font}','StoryshotCJK',sans-serif;--safe-bottom:${ctx.subs ? Math.round(H > W ? H * 0.22 : H * 0.16) : 0}px}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:#000}
#root{position:relative;width:100%;height:100%;font-family:var(--font)}
</style>
<script>${sceneRuntime(job, ctx)}</script>
</head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${D}" data-width="${W}" data-height="${H}">
<div id="${info.id}" class="clip" data-composition-id="${info.id}" data-composition-src="compositions/scene.html" data-start="0" data-duration="${D}" data-track-index="1" data-width="${W}" data-height="${H}"></div>
</div>
<script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
}

export const fileHash = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');

// Write a scene's project into `dir` (index.html, the scene, its assets). Returns the scene info.
export function writeSceneProject(job, ctx, dir) {
  const info = sceneInfo(job.scene.file, { width: ctx.W, height: ctx.H });
  if (info.errors.length) throw new Error(info.errors.join('; '));
  fs.mkdirSync(path.join(dir, 'compositions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), sceneDoc(job, ctx, info));
  fs.writeFileSync(path.join(dir, 'compositions', 'scene.html'), info.html);
  for (const [k, f] of Object.entries(sceneAssets(job.scene.file))) {
    fs.mkdirSync(path.dirname(path.join(dir, 'assets', k)), { recursive: true });
    fs.copyFileSync(f, path.join(dir, 'assets', k));
  }
  fs.writeFileSync(path.join(dir, 'hyperframes.json'), JSON.stringify({ paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' } }));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ id: job.name, name: job.name }));
  return info;
}

// The scene steps of a storyboard with their timing: [{ i, file, seconds, lead, cues }] (cues in scene seconds).
export function sceneTimings(cfg, voiceLens) {
  return cfg.steps.flatMap((s, i) => (!s.scene || s.hidden ? [] : [{
    i, file: s.scene.file, title: s.scene.title ?? null, seconds: +sceneSeconds(s, voiceLens.steps[i]).toFixed(3), lead: s.scene.lead,
    voice: voiceLens.steps[i] != null ? +voiceLens.steps[i].toFixed(3) : null,
    cues: (voiceLens.cues?.[i] ?? []).map((c) => ({ text: c.text, t: +(c.t + s.scene.lead).toFixed(2), end: +(c.end + s.scene.lead).toFixed(2) })),
  }]));
}

export function formatTimings(list) {
  return list.map((s) => [
    `step ${s.i + 1} · ${path.basename(s.file)} · ${s.seconds.toFixed(2)}s${s.voice != null ? ` (voice ${s.voice.toFixed(2)}s from ${s.lead}s)` : ' (no say: line)'}${s.title ? ` · ${s.title}` : ''}`,
    ...s.cues.map((c, k) => `  S.at(${k}) = ${c.t.toFixed(2)}  → ${c.end.toFixed(2)}  ${c.text}`),
  ].join('\n')).join('\n\n');
}
