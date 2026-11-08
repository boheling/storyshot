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
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const SCENE_DEFAULTS = { lead: 0.5, tail: 0.8 };
export const GSAP_URL = 'https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js';
// r160 is the last three.js with a classic-script build; everything after it is ESM only, and a
// module script in a scene would run after HyperFrames has already collected the timelines.
export const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
// That build announces its own deprecation the moment it loads, and the layout check reports every
// console warning, so a 3D scene would carry one forever. Drop that one line and nothing else.
const THREE_QUIET = `(function () { const w = console.warn; console.warn = function (m) { if (typeof m === 'string' && /build\\/three(\\.min)?\\.js" are deprecated/.test(m)) return; return w.apply(console, arguments); }; })();`;

// How long a scene plays: a fixed `duration`, else its narration plus a lead-in and a tail.
export function sceneSeconds(step, voiceLen) {
  if (typeof step.duration === 'number') return step.duration;
  const { lead, tail } = step.scene;
  return voiceLen == null ? 4 : Math.max(1.5, lead + voiceLen + tail);
}

// What a scene file declares, and what is wrong with it (errors stop the render, warnings don't).
export function sceneInfo(file, { width, height, three = null } = {}) {
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
  // A 3D scene whose storyboard forgot `scenes: { three: true }` throws on its first line and
  // renders an empty frame — the scene still "works" everywhere except in the video.
  if (three === false && /\b(THREE|Kit3)\s*\./.test(html)) {
    errors.push(`${name}: uses ${/\bKit3\s*\./.test(html) ? 'Kit3' : 'THREE'} but the storyboard does not load it — add \`scenes: { three: true }\` (with your css/js kit, if any)`);
  }
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

// GSAP renders a fromTo's start state as soon as it is created. When a later fromTo animates the same
// property of the same element (a label that fades in, then out), that start state would show from the
// first frame. A fromTo placed after another on the same element and property gets immediateRender: false
// unless it says otherwise, so each one takes over when it starts.
export const GSAP_GUARD = `(function () {
  if (!window.gsap) return;
  const P = gsap.core.Timeline.prototype, fromTo = P.fromTo;
  const NOT = { duration: 1, ease: 1, stagger: 1, delay: 1, immediateRender: 1, overwrite: 1, repeat: 1, yoyo: 1, repeatDelay: 1, id: 1, paused: 1, data: 1,
    callbackScope: 1, onStart: 1, onUpdate: 1, onComplete: 1, transformOrigin: 1, svgOrigin: 1, autoRound: 1, keyframes: 1 };
  P.fromTo = function (targets, from, to, position) {
    if (to && typeof to === 'object' && to.immediateRender === undefined && typeof position === 'number') {
      let els = [];
      try { els = gsap.utils.toArray(targets); } catch (e) {}
      const props = Object.keys(to).filter((k) => !NOT[k]);
      const seen = this.__storyshotSeen || (this.__storyshotSeen = new Map());
      if (els.some((el) => props.some((p) => (seen.get(el) || {})[p] < position))) to = Object.assign({}, to, { immediateRender: false });
      for (const el of els) { const m = seen.get(el) || {}; for (const p of props) m[p] = Math.min(m[p] == null ? Infinity : m[p], position); seen.set(el, m); }
    }
    return fromTo.call(this, targets, from, to, position);
  };
})();`;

// The project HyperFrames renders for one scene: a root as long as the scene, mounting the scene file.
// preview: also draw the band the burned-in subtitles will cover (never in a render).
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
<script>${sceneRuntime(job, ctx)}
${GSAP_GUARD}${job.kit?.three ? `\n${THREE_QUIET}` : ''}</script>
${job.kit?.three ? `<script src="${THREE_URL}"></script>\n<script src="kit3d.js"></script>` : ''}
${(job.kit?.css ?? []).map((f, k) => `<link rel="stylesheet" href="kit/${k}-${path.basename(f)}">`).join('\n')}
${(job.kit?.js ?? []).map((f, k) => `<script src="kit/${k}-${path.basename(f)}"></script>`).join('\n')}
</head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${D}" data-width="${W}" data-height="${H}">
<!-- The host the scene mounts into carries no \`id\`, only \`data-composition-id\`, which is what
     HyperFrames matches on. It used to carry the scene's id as well, and since the scene's own root
     element must have that same id, every scene then had TWO elements with it in one document:
     document.getElementById('<id>') returned this empty host, and a scene that appended to it put
     everything outside its own styled root and rendered a blank frame. -->
<div class="clip" data-composition-id="${info.id}" data-composition-src="compositions/scene.html" data-start="0" data-duration="${D}" data-track-index="1" data-width="${W}" data-height="${H}"></div>
${job.preview && ctx.subs ? `<div id="storyshot-subtitle-band" data-layout-ignore style="position:absolute;left:0;right:0;bottom:0;height:${Math.round(H > W ? H * 0.22 : H * 0.16)}px;z-index:9999;background:repeating-linear-gradient(135deg,rgba(255,64,64,.18) 0 14px,rgba(255,64,64,.08) 14px 28px);border-top:3px dashed rgba(255,64,64,.9);pointer-events:none"><span style="position:absolute;right:24px;top:10px;font:600 26px/1 sans-serif;color:#ff4040">burned-in subtitles</span></div>` : ''}
</div>
<script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
}

export const fileHash = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');

// Write a scene's project into `dir` (index.html, the scene, its assets). Returns the scene info.
export function writeSceneProject(job, ctx, dir) {
  const info = sceneInfo(job.scene.file, { width: ctx.W, height: ctx.H, three: !!job.kit?.three });
  if (info.errors.length) throw new Error(info.errors.join('; '));
  fs.mkdirSync(path.join(dir, 'compositions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), sceneDoc(job, ctx, info));
  fs.writeFileSync(path.join(dir, 'compositions', 'scene.html'), info.html);
  // `scenes: { three: true }`: storyshot's own drawn-3D helpers, loaded before the storyboard's kit
  if (job.kit?.three) fs.copyFileSync(path.join(HERE, 'scene-kit', 'kit3d.js'), path.join(dir, 'kit3d.js'));
  // the storyboard's scene kit, shared by every scene
  for (const [kind, list] of Object.entries(job.kit ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const [k, f] of list.entries()) {
      fs.mkdirSync(path.join(dir, 'kit'), { recursive: true });
      fs.copyFileSync(f, path.join(dir, 'kit', `${k}-${path.basename(f)}`));
    }
  }
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

// The red, green and blue of a hex or rgb() colour, 0–255. null for anything else (a variable, an
// image, a colour function).
export function toRgb(colour) {
  const hex = String(colour).match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i)?.[1], rgb = String(colour).match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  return hex ? (hex.length === 3 ? [...hex].map((h) => parseInt(h + h, 16)) : [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16))) : rgb ? rgb.slice(1, 4).map(Number) : null;
}
const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

// Mix two colours: t = 0 is all `a`, t = 1 is all `b`. Returns a hex colour, or null if either side
// can't be read. This is how a film's own `theme.paper` becomes a whole set of card tones instead of
// storyshot's default near-white ones, which are cold against warm paper.
export function mixColour(a, b, t) {
  const [x, y] = [toRgb(a), toRgb(b)];
  if (!x || !y) return null;
  return `#${x.map((v, i) => hex2(v + (y[i] - v) * t)).join('')}`;
}
// Lighten (amount > 0) or darken (amount < 0) a colour, 0–1.
export const shadeColour = (c, amount) => mixColour(c, amount >= 0 ? '#ffffff' : '#000000', Math.abs(amount));

// How light a hex or rgb() colour is, 0 (black) to 1 (white). null for anything else (a variable, an
// image, a colour function).
export function luminance(colour) {
  const c = toRgb(colour);
  if (!c) return null;
  const lin = c.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

// How much two colours differ to the eye, 1:1 to 21:1 (WCAG: large text wants 3, normal text 4.5).
export function contrast(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  return la == null || lb == null ? null : +((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)).toFixed(1);
}

// Darker than mid-grey? null for a colour this can't read (a variable, an image, a colour function).
export function isDark(colour) {
  const l = luminance(colour);
  return l == null ? null : l < 0.18;
}

// Whether a scene draws on a dark ground: the background of the rule for its root (a colour, or the
// first colour of a gradient). A scene whose ground comes from the shared kit (`<div id="x"
// class="world">` + `.world { background: … }` in scenes.css) has none of its own, so the root's
// classes are looked up in the kit's CSS too. null when it can't tell (a variable, an image).
export function sceneIsDark(file, kitCss = '') {
  const info = fs.existsSync(file) ? sceneInfo(file) : null;
  if (!info?.id) return null;
  const tag = info.html.match(new RegExp(`<[a-z][^>]*data-composition-id\\s*=\\s*["']${info.id}["'][^>]*>`, 'i'))?.[0] ?? '';
  const selectors = [`#${info.id}`, ...(tag.match(/\sclass\s*=\s*["']([^"']*)["']/)?.[1] ?? '').split(/\s+/).filter(Boolean).map((c) => `.${c}`)];
  for (const css of [info.html, kitCss]) {
    for (const sel of selectors) {
      const rule = css.match(new RegExp(`(?<![\\w#.-])${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
      const bg = rule.match(/background(?:-color|-image)?\s*:\s*([^;]+)/)?.[1];
      const dark = bg ? isDark(bg) : null; // a rule with no background of its own says nothing: try the next one
      if (dark != null) return dark;
    }
  }
  return null;
}

// Is the film light or dark overall? That decides what reads on top of it: the colour of the burned-in
// subtitles, and the ground of the intro, section and end cards. `ground: light | dark` in the
// storyboard says so outright; otherwise a film of scenes is read from the scenes themselves (a
// majority vote) and a recording from its frame's backdrop. null when nothing is sure — a recording of
// a page whose colours we have not measured — and then the subtitles stay white, which carries an
// outline and works over most screens.
export function filmGround(cfg) {
  if (cfg.ground === 'light' || cfg.ground === 'dark') return cfg.ground;
  if (!cfg.frame) {
    const kitCss = (cfg.sceneKit?.css ?? []).filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const grounds = cfg.steps.filter((s) => s.scene && !s.hidden).map((s) => sceneIsDark(s.scene.file, kitCss)).filter((d) => d != null);
    if (grounds.length) return grounds.filter(Boolean).length * 2 > grounds.length ? 'dark' : 'light';
  }
  return ['aurora', 'dark', 'blur'].includes(cfg.frame?.style ?? '') ? 'dark' : null;
}
