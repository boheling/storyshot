// HyperFrames cards (optional, `hyperframes: true`): the intro, section and end cards as HTML
// compositions rendered by HyperFrames (HeyGen's open-source HTML-to-video renderer, Apache-2.0),
// for more motion than the built-in cards. Two templates:
//   lesson (tutorials, courses, docs): the title lands word by word over a slowly drifting backdrop;
//     section cards show where in the video you are; intro steps and end-card points light up as the
//     narration names them
//   launch (promos): hand-drawn accents; the intro's paper turns into the browser window with the
//     logo landing on the app's own; the outro zooms from the last frame into the page
// Needs Node 22+. Uses a local install of the `hyperframes` package if there is one, else the pinned
// version, installed into storyshot's cache on first use. A card that fails to render falls back to the
// built-in one.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const HF_VERSION = '0.8.217';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GSAP_CDN = 'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js';
// families HyperFrames resolves by name; any other needs an @font-face
const BUNDLED = ['Inter', 'Montserrat', 'Outfit', 'Nunito', 'Oswald', 'League Gothic', 'Archivo Black', 'Space Mono', 'IBM Plex Mono', 'JetBrains Mono',
  'EB Garamond', 'Playfair Display', 'Source Code Pro', 'Noto Sans JP', 'Roboto', 'Open Sans', 'Lato', 'Poppins'];

// --- the CLI -------------------------------------------------------------------------------------
// A local install of the `hyperframes` package wins (or STORYSHOT_HYPERFRAMES, a path to the CLI); else
// storyshot keeps the pinned version in its own cache, installed with npm on first use.
const cacheDir = () => path.join(os.homedir(), '.cache', 'storyshot', 'hyperframes', HF_VERSION);
const binOf = (pj) => {
  const meta = JSON.parse(fs.readFileSync(pj, 'utf8'));
  const rel = typeof meta.bin === 'string' ? meta.bin : meta.bin?.hyperframes;
  return rel && fs.existsSync(path.join(path.dirname(pj), rel)) ? { file: path.join(path.dirname(pj), rel), version: meta.version } : null;
};
export function hyperframesCli() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) return { error: `HyperFrames needs Node 22 or newer (this is Node ${process.versions.node})` };
  if (process.env.STORYSHOT_HYPERFRAMES) return { cmd: process.env.STORYSHOT_HYPERFRAMES, args: [], how: process.env.STORYSHOT_HYPERFRAMES };
  for (const base of [path.join(process.cwd(), 'package.json'), import.meta.url]) {
    try {
      const b = binOf(createRequire(base).resolve('hyperframes/package.json'));
      if (b) return { cmd: process.execPath, args: [b.file], how: `hyperframes ${b.version} (local install)` };
    } catch { /* not installed here */ }
  }
  const pj = path.join(cacheDir(), 'node_modules', 'hyperframes', 'package.json');
  const b = fs.existsSync(pj) && binOf(pj);
  return b ? { cmd: process.execPath, args: [b.file], how: `hyperframes ${b.version}` } : { missing: true, how: `hyperframes ${HF_VERSION} (not installed yet)` };
}
async function ensureCli(log) {
  const cli = hyperframesCli();
  if (!cli.missing) return cli;
  log(`hyperframes: installing ${HF_VERSION} into ${cacheDir()} (first use)`);
  fs.mkdirSync(cacheDir(), { recursive: true });
  await run({ cmd: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: [] }, ['install', '--prefix', cacheDir(), '--no-audit', '--no-fund', '--loglevel=error', `hyperframes@${HF_VERSION}`]);
  const again = hyperframesCli();
  if (again.missing) throw new Error('the install finished but the CLI is not there');
  return again;
}

const run = (cli, args) => new Promise((resolve, reject) => {
  const p = spawn(cli.cmd, [...cli.args, ...args], { env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('error', reject);
  p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(out.trim().split('\n').filter(Boolean).slice(-3).join(' | ') || `exit ${code}`))));
});

// --- narration cues --------------------------------------------------------------------------------
// When the narration names each item (a bullet, the call to action): the item's earliest content word
// found in the line after the previous item's, placed by its character position (speech runs at a
// roughly even rate). Items it can't find share the time between their neighbours.
const STOP = new Set('a an the and or of to in on at for with by from your you it its is are be this that then than e.g. eg i.e. ie'.split(' '));
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
export function cueTimes(items, say, start, len) {
  if (!items?.length) return [];
  const text = String(say ?? '').toLowerCase(), N = text.length;
  const pos = [];
  let from = 0;
  for (const it of items) {
    const plain = String(it).replace(/\*\*|`/g, '').toLowerCase();
    let best = -1;
    if (N && CJK.test(plain)) {
      for (let k = 0; k + 2 <= plain.length && best < 0; k++) {
        const s = plain.slice(k, k + 2);
        if (CJK.test(s[0]) && CJK.test(s[1])) { const p = text.indexOf(s, from); if (p >= 0) best = p; }
      }
    } else if (N) {
      for (const w of plain.match(/[a-z0-9][a-z0-9'.-]*[a-z0-9]|[a-z0-9]/g) ?? []) {
        if (STOP.has(w) || w.length < 3) continue;
        const m = new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).exec(text.slice(from));
        if (m) { const p = from + m.index + m[1].length; if (best < 0 || p < best) best = p; }
      }
    }
    pos.push(best);
    if (best >= 0) from = best + 1;
  }
  const t = pos.map((p) => (p >= 0 && len ? start + (p / N) * len - 0.1 : null));
  // fill the gaps evenly between known neighbours (or across the line)
  const lo = len ? start : 1, hi = len ? start + len : lo + 0.6 * items.length;
  for (let i = 0; i < t.length; i++) {
    if (t[i] != null) continue;
    let j = i; while (j < t.length && t[j] == null) j++;
    const a = i > 0 ? t[i - 1] : lo - (hi - lo) / (t.length + 1) / 2, b = j < t.length ? t[j] : hi;
    for (let k = i; k < j; k++) t[k] = a + ((k - i + 1) * (b - a)) / (j - i + 1);
    i = j;
  }
  for (let i = 1; i < t.length; i++) t[i] = Math.max(t[i], t[i - 1] + 0.35); // never two at once
  return t.map((x) => Math.max(0.3, x));
}

// --- shared bits -----------------------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// "**word** rest" -> one span per word (per character in CJK), highlighted words inside a .hl span
const words = (text, { cls = 'w', underline = '' } = {}) => String(text ?? '').split(/(\*\*.+?\*\*)/).filter(Boolean).map((seg) => {
  const hl = /^\*\*.+\*\*$/.test(seg);
  const inner = seg.replace(/^\*\*|\*\*$/g, '').split(/(\s+)/).filter(Boolean).map((w) => (/^\s+$/.test(w) ? ' '
    : CJK.test(w) ? [...w].map((ch) => `<span class="${cls}">${esc(ch)}</span>`).join('') : `<span class="${cls}">${esc(w)}</span>`)).join('');
  return hl ? `<span class="hl">${inner}${underline}</span>` : inner;
}).join('');
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
const isCmd = (cta) => /^\$?\s*(npx|npm|pnpm|yarn|bun|pip|pipx|uv|brew|curl|git|docker|cargo|go)\b/.test(String(cta ?? ''));
const lum = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? ''); if (!m) return 0.5; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
// a light accent (a highlighter colour) made dark enough to draw lines and text with on white: same
// hue, lightness capped (lower for yellows and greens, which read light at any lightness)
const deepen = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? ''); if (!m) return '#4f46e5';
  const n = parseInt(m[1], 16), [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((c) => c / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0, l = (mx + mn) / 2, s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) h = 60 * (mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4);
  if (h < 0) h += 360;
  l = Math.min(l, h >= 40 && h <= 200 ? 0.36 : 0.58); s = Math.min(s, 0.75);
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), o = l - c / 2;
  const [R, G, B] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [R, G, B].map((v) => Math.round((v + o) * 255).toString(16).padStart(2, '0')).join('');
};
const RES = { A: '#3b6fd8', I: '#3b6fd8', L: '#3b6fd8', M: '#3b6fd8', F: '#3b6fd8', W: '#3b6fd8', V: '#3b6fd8', K: '#d9483b', R: '#d9483b', D: '#c43cc4', E: '#c43cc4',
  N: '#2ea44f', Q: '#2ea44f', S: '#2ea44f', T: '#2ea44f', C: '#e27093', G: '#e8890c', P: '#c9a400', H: '#1aa3a3', Y: '#1aa3a3' };
const NUC = { A: '#2ea44f', C: '#3b6fd8', G: '#e8890c', T: '#d9483b', U: '#d9483b' };

const fontFaces = (font, { hand = false } = {}) => [
  BUNDLED.includes(font) ? '' : `@font-face{font-family:'${font}';src:local('${font}')}`,
  // Chinese, Japanese and Korean text: whatever CJK face the machine has
  `@font-face{font-family:'StoryshotCJK';font-weight:400;src:local('PingFang SC'),local('Noto Sans CJK SC'),local('Noto Sans SC'),local('Hiragino Sans GB'),local('Microsoft YaHei'),local('Source Han Sans SC')}`,
  `@font-face{font-family:'StoryshotCJK';font-weight:600;src:local('PingFang SC Semibold'),local('Noto Sans CJK SC Bold'),local('Noto Sans SC Bold'),local('Hiragino Sans GB W6'),local('Microsoft YaHei Bold'),local('Source Han Sans SC Bold')}`,
  hand ? `@font-face{font-family:'Virgil';src:url('assets/Virgil.woff2') format('woff2')}` : '',
].join('\n');

const doc = ({ W, H, D, css, body, js, bg = 'transparent', gsap }) => `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=${W}, height=${H}">
<script src="${gsap}"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:${bg}}
#stage{position:absolute;inset:0}
.full{position:absolute;left:0;top:0;width:${W}px;height:${H}px}
.w{display:inline-block}
${css}
</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${D.toFixed(3)}" data-width="${W}" data-height="${H}">
<div id="stage" class="clip" data-start="0" data-duration="${D.toFixed(3)}" data-track-index="0">
${body}
</div></div>
<script>
const tl = gsap.timeline({ paused: true });
const blurIn = (sel, at, o = {}) => { if (document.querySelector(sel)) tl.fromTo(sel, { opacity: 0, filter: 'blur(8px)', ...o.from }, { opacity: 1, filter: 'blur(0px)', duration: o.d ?? 0.18, ease: 'power4.out', stagger: o.stagger ?? 0, ...o.to }, at); };
const draw = (sel, at, d = 0.35, stagger = 0.12) => { if (document.querySelector(sel)) tl.fromTo(sel, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: d, ease: 'power1.inOut', stagger }, at); };
${js}
window.__timelines["main"] = tl;
</script></body></html>`;

// --- lesson: tutorials, courses, docs ---------------------------------------------------------------
function lesson(job, ctx) {
  const { W, H, dark, font, opts } = ctx, u = H / 1080, D = job.seconds, c = job.card, accent = ctx.accent, ink = ctx.ink;
  const P = dark
    ? { ground: '#0c1222', ground2: '#070b16', glow: '#1b2744', text: '#eef2f8', muted: '#9aa8bd', line: '#2a3550', chip: '#131c31', chipLine: '#26324d', band: 0.14, shadow: 'rgba(0,0,0,.35)' }
    : { ground: '#eef2f7', ground2: '#dfe6ef', glow: '#ffffff', text: ink, muted: '#56667d', line: '#c6d0dc', chip: '#ffffff', chipLine: '#d6dee8', band: 0.17, shadow: 'rgba(13,27,46,.08)' };
  const strong = dark ? accent : deepen(accent); // accent as text/line on this ground
  const bandText = opts.band ? String(opts.band).replace(/\s+/g, '') : null;
  const colorOf = (ch) => (opts.bandColors === 'aminoacid' ? RES[ch] : opts.bandColors === 'nucleotide' ? NUC[ch] : null) ?? strong;
  const band = (id, top, text) => `<div class="band-wrap" data-layout-ignore style="top:${top}px"><div id="${id}" class="band">${
    text.repeat(Math.max(2, Math.ceil((W * 2.2) / (text.length * 46 * u)))).split('').map((ch) => `<i style="color:${colorOf(ch.toUpperCase())}">${esc(ch)}</i>`).join('')}</div></div>`;
  // the emblem: up to three mono lines (a sequence alignment, a formula, a line of code); where the
  // first and last differ, both are marked; a middle line's non-'|' marks are marked too
  const em = job.kind === 'end' ? null : c.emblem === false ? null : [].concat(c.emblem ?? opts.emblem ?? []).filter(Boolean).slice(0, 3).map(String);
  const emblem = !em?.length ? '' : (() => {
    const a = em[0], z = em.at(-1);
    const diff = (i) => em.length > 1 && a[i] !== z[i];
    const row = (s, k) => `<div class="row r${k === 0 ? 'q' : k === em.length - 1 ? 's' : 'm'}">${[...s].map((ch, i) =>
      `<i class="${(k === 1 && em.length === 3 ? ch !== '|' && ch !== ' ' : diff(i)) ? 'df' : ''}">${ch === ' ' ? '&nbsp;' : esc(ch)}</i>`).join('')}</div>`;
    return `<div id="aln" class="aln" data-layout-ignore>${em.map(row).join('')}</div>`;
  })();
  const kicker = c.kicker ?? (job.kind === 'end' && c.subtitle && c.bullets?.length && String(c.subtitle).length <= 14 ? c.subtitle : null);
  const subtitle = kicker === c.subtitle && job.kind === 'end' ? null : c.subtitle;
  // a picture goes beside the text (left), so a concept card with a diagram and a list still fits
  const split = !!job.image && W >= H && job.kind !== 'end';
  const titleSize = (split ? 76 : (c.title ?? '').length > 28 ? 84 : job.kind === 'intro' ? 112 : 104) * u;
  const bullets = c.bullets ?? [];
  const v = job.voice;
  const cues = cueTimes(bullets, v?.text, v?.start ?? 0, v?.len ?? 0);
  const fallback = (i, first, step) => first + i * step;
  const at = bullets.map((_, i) => (v?.len ? cues[i] : job.kind === 'end' ? fallback(i, 1.4, Math.max(0.5, (D - 4) / bullets.length)) : fallback(i, job.kind === 'intro' ? 1.0 : 0.6, job.kind === 'intro' ? 0.9 : 0.4)));
  const chips = job.kind === 'intro' && bullets.length && bullets.length <= 4 && bullets.join('').length <= 90 && W >= H && !job.image;
  const cols = W < H ? 1 : bullets.length <= 3 ? Math.max(1, bullets.length) : bullets.length === 4 ? 2 : 3;
  const itemW = Math.min(500 * u, (W * 0.88 - (cols - 1) * 26 * u) / cols);
  const logo = job.logo ? `<img id="logo" class="logo" src="assets/logo${path.extname(job.logo)}">` : '';
  const image = job.image ? `<img id="img" class="cimg" src="assets/image${path.extname(job.image)}">` : '';
  const cta = c.cta ? (isCmd(c.cta)
    ? `<div id="cta" class="cta cmd"><b>$</b> <span id="type">${esc(String(c.cta).replace(/^\$\s*/, ''))}</span></div>`
    : `<div id="cta" class="cta">${esc(c.cta)}</div>`) : '';
  const ctaAt = c.cta ? Math.max(bullets.length ? at.at(-1) + 0.6 : 0.8, v?.len ? cueTimes([c.cta], v.text, v.start, v.len)[0] : 0) : 0;
  const map = job.kind === 'section' && job.of > 1
    ? `<div id="map" class="map">${Array.from({ length: job.of }, (_, i) => `<div class="seg"><div class="fill" id="f${i}"></div></div>`).join('')}</div>` : '';
  const think = c.think ? `<div id="think" class="think"><div class="tlabel">${esc(ctx.labels.think)}</div><div class="track"><div id="drain" class="drain"></div></div></div>` : '';

  const css = `${fontFaces(font)}
#stage{font-family:'${font}','StoryshotCJK',sans-serif;color:${P.text}}
.bg{background:radial-gradient(${W * 0.73}px ${H * 0.88}px at 50% 40%, ${P.glow} 0%, ${P.ground} 52%, ${P.ground2} 100%)}
.backdrop{object-fit:cover;opacity:${dark ? 0.16 : 0.1};-webkit-mask-image:radial-gradient(ellipse 60% 60% at 50% 50%,#000 35%,transparent 100%)}
.band-wrap{position:absolute;left:0;right:0;height:${80 * u}px;overflow:hidden;opacity:${P.band};-webkit-mask-image:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent)}
.band{position:absolute;left:0;top:0;white-space:nowrap;font:500 ${54 * u}px 'IBM Plex Mono',monospace;letter-spacing:.3em}
.band i,.aln i{font-style:normal}
.col{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 ${W * 0.06}px}
.aln{font:500 ${30 * u}px 'IBM Plex Mono',monospace;letter-spacing:.34em;line-height:1.12;margin-bottom:${44 * u}px;color:${P.muted}}
.aln .row{white-space:nowrap}.aln i{display:inline-block}
.aln .rm{color:${strong};opacity:.8}.aln i.df{color:${dark ? accent : P.text};background:${dark ? 'transparent' : accent};font-weight:700}
.kick{font:600 ${30 * u}px 'IBM Plex Mono','StoryshotCJK',monospace;letter-spacing:.24em;text-transform:uppercase;color:${P.muted};margin-bottom:${22 * u}px}
h1{font-weight:600;letter-spacing:-.03em;line-height:1.08;max-width:${W * 0.82}px;text-wrap:balance;font-size:${titleSize}px}
.hl{position:relative;${dark ? `color:${accent}` : `background-image:linear-gradient(${accent},${accent});background-repeat:no-repeat;background-position:0 88%;background-size:0% 36%;padding:0 .06em`}}
.sub{font-size:${44 * u}px;color:${P.muted};margin-top:${22 * u}px;letter-spacing:-.01em;max-width:${W * 0.8}px}
.logo{height:${H * 0.09}px;margin-bottom:${36 * u}px;${dark ? `background:#fff;padding:${10 * u}px ${16 * u}px;border-radius:${14 * u}px` : ''}}
.cimg{max-width:${W * 0.6}px;max-height:${H * 0.4}px;margin-top:${34 * u}px;border-radius:${12 * u}px;box-shadow:0 ${12 * u}px ${36 * u}px ${P.shadow}}
.split{flex-direction:row;gap:${72 * u}px;text-align:left}
.split .left .cimg{width:${W * 0.4}px;height:auto;max-height:${H * 0.62}px;object-fit:contain;margin-top:0}
.split .right{display:flex;flex-direction:column;align-items:flex-start;max-width:${W * 0.44}px}
.split h1{max-width:${W * 0.44}px;text-wrap:pretty}
.split .map{justify-content:flex-start}
.map{display:flex;justify-content:center;gap:${14 * u}px;margin-top:${60 * u}px}
.seg{width:${120 * u}px;height:${8 * u}px;border-radius:${4 * u}px;background:${P.line};overflow:hidden}
.fill{width:100%;height:100%;background:${accent};transform-origin:0 50%}
.steps{display:flex;align-items:center;margin-top:${64 * u}px}
.step{display:flex;align-items:center;gap:${18 * u}px;padding:${20 * u}px ${32 * u}px ${20 * u}px ${20 * u}px;border-radius:999px;background:${P.chip};border:${2 * u}px solid ${P.chipLine};font-size:${34 * u}px;font-weight:500;box-shadow:0 ${18 * u}px ${40 * u}px ${P.shadow}}
.n{flex:none;width:${52 * u}px;height:${52 * u}px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${accent};color:${ink};font:700 ${28 * u}px 'IBM Plex Mono',monospace}
.link{width:${64 * u}px;height:${3 * u}px;background:${P.line};transform-origin:0 50%}
.list{display:flex;flex-direction:column;gap:${18 * u}px;margin-top:${44 * u}px;text-align:left}
.li{display:flex;align-items:center;gap:${20 * u}px;font-size:${38 * u}px}
.grid{display:grid;grid-template-columns:repeat(${cols},${itemW}px);gap:${26 * u}px;margin-top:${56 * u}px;text-align:left}
.item{display:flex;gap:${20 * u}px;align-items:flex-start;padding:${26 * u}px ${28 * u}px;border-radius:${22 * u}px;background:${P.chip};border:${2 * u}px solid ${P.chipLine};min-height:${140 * u}px;box-shadow:0 ${18 * u}px ${40 * u}px ${P.shadow}}
.ck{flex:none;width:${52 * u}px;height:${52 * u}px;border-radius:50%;border:${3 * u}px solid ${P.line};position:relative}
.ck .dot{position:absolute;inset:${-3 * u}px;border-radius:50%;background:${accent}}
.ck svg{position:absolute;inset:${-3 * u}px;width:${52 * u}px;height:${52 * u}px}
.tx{font-size:${31 * u}px;line-height:1.24;font-weight:500}
.tx b{color:${dark ? accent : P.text}}
.tx code,.li code{font:500 .9em 'IBM Plex Mono',monospace}
.cta{margin-top:${50 * u}px;font-size:${38 * u}px;font-weight:600;padding:${20 * u}px ${44 * u}px;border-radius:${16 * u}px;background:${dark ? accent : ink};color:${dark ? ink : '#fff'}}
.cta.cmd{font:500 ${36 * u}px 'IBM Plex Mono',monospace;background:${dark ? '#1a2238' : ink};color:#e2e8f0;text-align:left}
.cta.cmd b{color:${accent}}
#type{display:inline-block;white-space:nowrap}
.think{position:absolute;left:50%;bottom:${H * 0.1}px;width:${W * 0.3}px;margin-left:${-W * 0.15}px;text-align:center;font-size:${26 * u}px;color:${P.muted}}
.tlabel{margin-bottom:${12 * u}px}
.track{height:${8 * u}px;border-radius:99px;background:${P.line};overflow:hidden}
.drain{height:100%;background:${accent};transform-origin:0 50%}`;

  const body = `<div class="full bg"></div>
${job.backdrop ? `<img id="backdrop" class="full backdrop" src="assets/backdrop.jpg">` : ''}
${bandText ? band('bandA', 96 * u, bandText) + band('bandB', H - 176 * u, [...bandText].reverse().join('')) : ''}
<div class="col${split ? ' split' : ''}">
  ${split ? `<div class="left">${image}</div><div class="right">` : ''}
  ${logo}${emblem}
  ${kicker ? `<div id="kick" class="kick">${esc(kicker)}</div>` : ''}
  ${c.title ? `<h1 id="title">${words(c.title)}</h1>` : ''}
  ${subtitle ? `<div id="sub" class="sub">${words(subtitle)}</div>` : ''}
  ${split ? '' : image}
  ${!bullets.length ? '' : chips
    ? `<div class="steps">${bullets.map((b, i) => `${i ? `<div class="link" id="l${i}"></div>` : ''}<div class="step" id="s${i}"><span class="n">${i + 1}</span><span>${md(b)}</span></div>`).join('')}</div>`
    : job.kind === 'end'
      ? `<div class="grid">${bullets.map((b, i) => `<div class="item" id="i${i}"><div class="ck"><div class="dot" id="d${i}"></div><svg viewBox="0 0 52 52"><path id="p${i}" d="M15 27 l8 8 l15 -17" pathLength="1" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1" stroke-dashoffset="1"/></svg></div><div class="tx">${md(b)}</div></div>`).join('')}</div>`
      : `<div class="list">${bullets.map((b, i) => `<div class="li" id="s${i}"><span class="n">${i + 1}</span><span>${md(b)}</span></div>`).join('')}</div>`}
  ${cta}${map}
  ${split ? '</div>' : ''}
</div>
${think}`;

  const n = (x) => x.toFixed(2);
  const js = `
${bandText ? `tl.fromTo('#bandA', { x: 0 }, { x: ${-92 * D * u}, duration: ${D}, ease: 'none' }, 0);
tl.fromTo('#bandB', { x: ${-900 * u} }, { x: ${-900 * u + 92 * D * u}, duration: ${D}, ease: 'none' }, 0);` : ''}
${job.backdrop ? `tl.fromTo('#backdrop', { x: 0 }, { x: ${-14 * D * u}, duration: ${D}, ease: 'none' }, 0);` : ''}
${logo ? `tl.fromTo('#logo', { opacity: 0, scale: 0.85, filter: 'blur(6px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 0.5, ease: 'back.out(1.6)' }, 0.05);` : ''}
${emblem ? `tl.fromTo('#aln .rq', { x: ${-460 * u}, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: 'expo.out' }, 0);
${em.length > 1 ? `tl.fromTo('#aln .rs', { x: ${460 * u}, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: 'expo.out' }, 0);` : ''}
${em.length === 3 ? `tl.fromTo('#aln .rm i', { opacity: 0, scaleY: 0.2 }, { opacity: 1, scaleY: 1, duration: 0.12, ease: 'power2.out', stagger: ${n(Math.min(0.011, 0.35 / Math.max(1, em[1].length)))} }, 0.3);` : ''}` : ''}
blurIn('#kick', 0.1);
blurIn('#title .w', ${job.kind === 'intro' ? 0.3 : 0.2}, { d: 0.16, stagger: ${CJK.test(c.title ?? '') ? 0.035 : 0.07} });
${dark ? '' : `if (document.querySelector('#title .hl')) tl.fromTo('#title .hl', { backgroundSize: '0% 36%' }, { backgroundSize: '100% 36%', duration: 0.45, ease: 'power2.inOut' }, 0.75);`}
blurIn('#sub .w', ${job.kind === 'intro' ? 0.8 : 0.55}, { d: 0.16, stagger: ${CJK.test(subtitle ?? '') ? 0.03 : 0.06} });
${dark ? '' : `if (document.querySelector('#sub .hl')) tl.fromTo('#sub .hl', { backgroundSize: '0% 36%' }, { backgroundSize: '100% 36%', duration: 0.45, ease: 'power2.inOut' }, 1.05);`}
${image ? `tl.fromTo('#img', { opacity: 0, y: ${24 * u} }, { opacity: 1, y: 0, duration: 0.6, ease: 'expo.out' }, 0.45);` : ''}
${map ? `tl.fromTo('#map', { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power2.out' }, 0.4);
${Array.from({ length: job.of }, (_, i) => i < job.index ? `tl.fromTo('#f${i}', { scaleX: 1 }, { scaleX: 1, duration: 0.01 }, 0);`
    : i === job.index ? `tl.fromTo('#f${i}', { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: 'power2.inOut' }, 0.55);`
      : `tl.fromTo('#f${i}', { scaleX: 0 }, { scaleX: 0, duration: 0.01 }, 0);`).join('\n')}` : ''}
${bullets.map((_, i) => chips
    ? `${i ? `tl.fromTo('#l${i}', { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: 'power2.inOut' }, ${n(at[i] - 0.3)});` : ''}
tl.fromTo('#s${i}', { opacity: 0, y: ${18 * u}, filter: 'blur(6px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.45, ease: 'expo.out' }, ${n(at[i])});`
    : job.kind === 'end'
      ? `tl.fromTo('#i${i}', { opacity: 0.42 }, { opacity: 1, duration: 0.25, ease: 'power2.out', immediateRender: false }, ${n(at[i])});
tl.fromTo('#d${i}', { scale: 0 }, { scale: 1, duration: 0.3, ease: 'back.out(1.6)' }, ${n(at[i])});
tl.fromTo('#p${i}', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.3, ease: 'power2.out' }, ${n(at[i] + 0.12)});`
      : `tl.fromTo('#s${i}', { opacity: 0, x: ${-24 * u}, filter: 'blur(6px)' }, { opacity: 1, x: 0, filter: 'blur(0px)', duration: 0.45, ease: 'expo.out' }, ${n(at[i])});`).join('\n')}
${job.kind === 'end' && bullets.length ? `tl.fromTo('.item', { opacity: 0, y: ${24 * u}, filter: 'blur(6px)' }, { opacity: 0.42, y: 0, filter: 'blur(0px)', duration: 0.5, ease: 'expo.out', stagger: 0.06 }, 0.5);` : ''}
${cta ? `blurIn('#cta', ${n(ctaAt)});
${isCmd(c.cta) ? `tl.fromTo('#type', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: ${n(String(c.cta).length * 0.045)}, ease: 'steps(${String(c.cta).length})' }, ${n(ctaAt + 0.2)});` : ''}` : ''}
${think ? `blurIn('#think', ${n(job.thinkAt)});
tl.fromTo('#drain', { scaleX: 1 }, { scaleX: 0, duration: ${c.think}, ease: 'none' }, ${n(job.thinkAt)});` : ''}
`;
  return doc({ W, H, D, css, body, js, bg: P.ground, gsap: ctx.gsap });
}

// --- launch: promos ----------------------------------------------------------------------------------
async function launch(job, ctx) {
  const { W, H, opts } = ctx, u = H / 1080, D = job.seconds, c = job.card;
  const { default: rough } = await import('roughjs');
  const g = rough.generator();
  const INK = '#1e1e1e', STROKE = deepen(ctx.accent), font = ctx.font;
  const handFont = opts.hand ? "'Virgil','StoryshotCJK',sans-serif" : `'${font}','StoryshotCJK',sans-serif`;
  // rough.js strokes drawn with pathLength=1, so a dashoffset 1 -> 0 draws them in order
  const strokes = (drawable, cls, extra = '') => g.toPaths(drawable).map((p) =>
    `<path class="${cls}" d="${p.d}" pathLength="1" fill="none" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1" stroke-dashoffset="1" ${extra}/>`).join('');
  const R = (o) => ({ roughness: 1.4, bowing: 1.2, strokeWidth: 3.5, stroke: INK, ...o });
  const underline = (seed) => `<svg class="ul" viewBox="0 0 400 40" preserveAspectRatio="none">${strokes(g.curve([[6, 22], [120, 30], [260, 18], [394, 26]], R({ stroke: STROKE, strokeWidth: 6, roughness: 1.1, seed })), 'ulp', 'vector-effect="non-scaling-stroke"')}</svg>`;
  const css0 = `${fontFaces(font, { hand: true })}
#stage{font-family:'${font}','StoryshotCJK',sans-serif;color:${INK}}
.paper{background:#fff}
.grid{background-image:radial-gradient(#d4d4dc ${1.6 * u}px,transparent ${1.8 * u}px);background-size:${36 * u}px ${36 * u}px;background-position:${18 * u}px ${18 * u}px}
.line{position:absolute;left:0;right:0;text-align:center;white-space:nowrap}
.hl{position:relative;display:inline-block;color:${STROKE}}
.ul{position:absolute;left:-4%;width:108%;bottom:-0.42em;height:0.5em;overflow:visible}
.ulp{stroke-width:${6 * u}px}
.title{font-weight:700;letter-spacing:-.03em}`;
  const n = (x) => x.toFixed(2);

  if (job.kind === 'intro') {
    const F = ctx.frame; // page rect on screen: { FX, FY, FW, FH } (the whole frame when there's no window)
    const T = job.logoTarget; // where the app shows the same logo in its first frame, if it does
    const L = job.logoSize; // the logo picture's size in output px
    const hasLogo = !!(job.logo && L);
    const big = hasLogo ? Math.min((W * 0.42) / L.w, (H * 0.17) / L.h, 3.2) : 1;
    const cy = H * (c.subtitle ? 0.41 : 0.47);
    const bw = hasLogo ? L.w * big : 0, bh = hasLogo ? L.h * big : 0, bx = (W - bw) / 2, by = cy - bh / 2;
    const exitAt = Math.max(1.4, D - 1.0), shrink = 0.68;
    const box = hasLogo ? strokes(g.rectangle(bx - 70 * u, by - 56 * u, bw + 140 * u, bh + 112 * u, R({ seed: 7, strokeWidth: 3.5 * u })), 'bx') : '';
    const logoBox = T ?? { x: bx, y: by, w: bw, h: bh }; // the logo's own layout box: its landing spot
    const css = `${css0}
#paper{transform-origin:0 0}
#logo{position:absolute;left:${logoBox.x}px;top:${logoBox.y}px;width:${T ? T.w : bw}px;height:${T ? T.h : bh}px;transform-origin:0 0}
#pageimg{object-fit:fill;opacity:0}
.tbox{position:absolute;left:0;right:0;top:${cy - 80 * u}px;display:flex;justify-content:center}
.tbox span.t{position:relative;display:inline-block;padding:${24 * u}px ${60 * u}px;font-size:${(String(c.title ?? '').length > 18 ? 96 : 128) * u}px}
.tbox svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}`;
    const tbox = !hasLogo && c.title ? `<div class="tbox" id="tbox"><span class="t title">${words(c.title)}<svg viewBox="0 0 1000 300" preserveAspectRatio="none">${strokes(g.rectangle(6, 8, 988, 284, R({ seed: 7 })), 'bx', 'vector-effect="non-scaling-stroke"')}</svg></span></div>` : '';
    const body = `
${F.frameBg ? `<img class="full" src="assets/frame-bg.png">` : `<div class="full" style="background:#0b1020"></div>`}
${F.chrome ? `<img id="chrome" class="full" src="assets/frame-chrome.png" style="opacity:0">` : ''}
${F.url ? `<img id="url" class="full" src="assets/frame-url.png" style="opacity:0">` : ''}
<div id="paper" class="full paper"><div id="grid" class="full grid"></div>${job.page ? `<img id="pageimg" class="full" src="assets/page.jpg">` : ''}</div>
${hasLogo ? `<svg id="box" class="full" viewBox="0 0 ${W} ${H}">${box}</svg><img id="logo" src="assets/logo${path.extname(job.logo)}">` : tbox}
${c.subtitle ? `<div id="sub" class="line" style="top:${(hasLogo ? by + bh + 120 * u : cy + 190 * u)}px;font-family:${handFont};font-size:${(opts.hand ? 78 : 64) * u}px">${words(c.subtitle, { underline: underline(11) })}</div>` : ''}`;
    const sx = F.FW / W, sy = F.FH / H, framed = F.FX > 0 || F.FY > 0;
    const js = `
${hasLogo ? `draw('.bx', 0.0, 0.5, 0.18);
tl.fromTo('#logo', { x: ${n(bx - logoBox.x)}, y: ${n(by - logoBox.y)}, scale: ${n(T ? (bw / T.w) * 0.92 : 0.92)}, opacity: 0, filter: 'blur(8px)' },
  { x: ${n(bx - logoBox.x)}, y: ${n(by - logoBox.y)}, scale: ${n(T ? bw / T.w : 1)}, opacity: 1, filter: 'blur(0px)', duration: 0.45, ease: 'back.out(1.5)' }, 0.12);`
    : `draw('.bx', 0.0, 0.5, 0.18);
blurIn('#tbox .w', 0.12, { d: 0.16, stagger: 0.07 });`}
blurIn('#sub .w', 0.5, { d: 0.16, stagger: 0.07 });
draw('#sub .ulp', 1.0, 0.4, 0);
// the paper turns into the app window; the logo lands where the app shows its own
tl.to('#box, #sub, #grid, #tbox', { opacity: 0, filter: 'blur(6px)', duration: 0.22, ease: 'power2.in' }, ${n(exitAt)});
${framed ? `tl.to('#paper', { x: ${F.FX}, y: ${F.FY}, scaleX: ${sx.toFixed(5)}, scaleY: ${sy.toFixed(5)}, duration: ${shrink}, ease: 'power3.inOut' }, ${n(exitAt + 0.08)});` : ''}
${job.page ? `tl.fromTo('#pageimg', { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power2.inOut' }, ${n(exitAt + 0.25)});` : ''}
${hasLogo ? (T ? `tl.to('#logo', { x: 0, y: 0, scale: 1, duration: ${shrink}, ease: 'power3.inOut' }, ${n(exitAt + 0.08)});`
      : `tl.to('#logo', { opacity: 0, filter: 'blur(6px)', duration: 0.22, ease: 'power2.in' }, ${n(exitAt)});`) : ''}
${F.chrome ? `tl.to('#chrome, #url', { opacity: 1, duration: 0.3, ease: 'power2.out' }, ${n(exitAt + 0.35)});` : ''}
`;
    return doc({ W, H, D, css, body, js, bg: '#fff', gsap: ctx.gsap });
  }

  // the end card is drawn over the last frame, which storyshot zooms into the page underneath: the
  // card itself is transparent, then turns to paper with the drawing still faintly showing through
  const v = job.voice;
  const ctaAt = !c.cta ? 0 : Math.max(1.2, v?.len ? cueTimes([c.cta], v.text, v.start, v.len)[0] : 1.45);
  const L = job.logoSize, hasLogo = !!(job.logo && L);
  const lh = hasLogo ? Math.min(H * 0.1, (W * 0.36 * L.h) / L.w) : 0, lw = hasLogo ? (lh * L.w) / L.h : 0;
  const bullets = c.bullets ?? [];
  const bAt = cueTimes(bullets, v?.text, v?.start ?? 0, v?.len ?? 0).map((t) => (v?.len ? t : null));
  const cmd = isCmd(c.cta), ctaText = String(c.cta ?? '').replace(/^\$\s*/, '');
  const tryLabel = ctx.labels.tryIt ?? 'try it';
  const arrowW = 280 * u, arrowH = 160 * u;
  const css = `${css0}
.stack{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:${30 * u}px}
#logo{height:${lh}px;width:${lw}px}
.etitle{font-size:${(String(c.title ?? '').length > 24 ? 80 : 104) * u}px}
.esub{font-family:${handFont};font-size:${(opts.hand ? 66 : 54) * u}px}
.blist{display:flex;flex-direction:column;gap:${12 * u}px;font-size:${36 * u}px;text-align:left}
.blist .bi{display:flex;align-items:center;gap:${16 * u}px}
.blist svg{width:${40 * u}px;height:${40 * u}px;overflow:visible}
.cta{position:relative;margin-top:${26 * u}px;padding:${22 * u}px ${54 * u}px;font-family:${cmd ? "'IBM Plex Mono',monospace" : handFont};font-size:${(cmd ? 46 : opts.hand ? 84 : 64) * u}px;color:${STROKE};font-weight:${cmd ? 500 : 600}}
.cta .box{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.cta .arrow{position:absolute;left:${-arrowW - 16 * u}px;top:calc(50% - ${24 * u}px);width:${arrowW}px;height:${arrowH}px;overflow:visible}
.cta .try{position:absolute;right:calc(100% + ${arrowW - 10 * u}px);top:calc(50% + ${arrowH - 30 * u}px);font-family:'Virgil','StoryshotCJK',sans-serif;font-size:${46 * u}px;color:${INK};white-space:nowrap;transform:rotate(-7deg)}
#type{display:inline-block;white-space:nowrap}`;
  const check = (i) => strokes(g.linearPath([[4, 22], [15, 34], [36, 6]], R({ seed: 30 + i, stroke: STROKE, strokeWidth: 4 * u })), `ck${i}`);
  const body = `
<div id="paper" class="full paper" style="opacity:0"></div>
<div class="stack">
  ${hasLogo ? `<img id="logo" src="assets/logo${path.extname(job.logo)}">` : ''}
  ${c.title ? `<div id="etitle" class="etitle title">${words(c.title)}</div>` : ''}
  ${c.subtitle ? `<div id="esub" class="esub">${words(c.subtitle, { underline: underline(13) })}</div>` : ''}
  ${bullets.length ? `<div class="blist">${bullets.map((b, i) => `<div class="bi" id="b${i}"><svg viewBox="0 0 40 40">${check(i)}</svg><span>${md(b)}</span></div>`).join('')}</div>` : ''}
  ${c.cta ? `<div id="cta" class="cta">${cmd ? `<b style="color:${INK}">$</b> <span id="type">${esc(ctaText)}</span>` : esc(c.cta)}
    <svg class="box" viewBox="0 0 1000 200" preserveAspectRatio="none">${strokes(g.rectangle(4, 6, 992, 188, R({ seed: 21, stroke: STROKE, strokeWidth: 4.5 })), 'cb', 'vector-effect="non-scaling-stroke"')}</svg>
    <svg class="arrow" viewBox="0 0 280 160" preserveAspectRatio="none">${strokes(g.curve([[18, 150], [60, 72], [150, 30], [270, 24]], R({ seed: 5, strokeWidth: 3.5 })), 'ar', 'vector-effect="non-scaling-stroke"')}${strokes(g.linearPath([[238, 0], [272, 24], [240, 50]], R({ seed: 6, strokeWidth: 3.5 })), 'ah', 'vector-effect="non-scaling-stroke"')}</svg>
    <div id="try" class="try">${esc(tryLabel)}</div></div>` : ''}
</div>`;
  const js = `
tl.fromTo('#paper', { opacity: 0 }, { opacity: 0.88, duration: 0.45, ease: 'power2.out' }, 0.3);
${hasLogo ? `tl.fromTo('#logo', { opacity: 0, y: ${14 * u}, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.4, ease: 'expo.out' }, 0.5);` : ''}
blurIn('#etitle .w', 0.5, { d: 0.16, stagger: 0.07 });
blurIn('#esub .w', 0.75, { d: 0.16, stagger: 0.07 });
draw('#esub .ulp', 1.2, 0.4, 0);
${bullets.map((_, i) => `blurIn('#b${i}', ${n(bAt[i] ?? 1.0 + 0.35 * i)});
draw('.ck${i}', ${n((bAt[i] ?? 1.0 + 0.35 * i) + 0.1)}, 0.25, 0);`).join('\n')}
${c.cta ? `blurIn('#cta', ${n(ctaAt)}, { d: 0.2 });
${cmd ? `tl.fromTo('#type', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: ${n(ctaText.length * 0.045)}, ease: 'steps(${ctaText.length})' }, ${n(ctaAt + 0.15)});` : ''}
draw('.cb', ${n(ctaAt + 0.05)}, 0.5, 0.2);
draw('.ar', ${n(ctaAt + 0.55)}, 0.4, 0.1);
draw('.ah', ${n(ctaAt + 0.9)}, 0.2, 0.05);
blurIn('#try', ${n(ctaAt + 0.85)}, { d: 0.25 });` : ''}
`;
  return doc({ W, H, D, css, body, js, bg: 'transparent', gsap: ctx.gsap });
}

// --- rendering ---------------------------------------------------------------------------------------
const hashOf = (...parts) => {
  const h = crypto.createHash('sha1');
  for (const p of parts) h.update(typeof p === 'string' ? p : JSON.stringify(p));
  return h.digest('hex').slice(0, 16);
};

// jobs: [{ name, kind: intro|section|end, seconds, card, voice: {text, start, len}?, index, of, thinkAt,
//          backdrop?, page?, logo?, logoSize?, logoTarget?, image?, alpha? }]
// ctx: { W, H, FPS, dark, accent, ink, font, lang, labels, opts, frame: {FX,FY,FW,FH,frameBg,chrome,url}, work }
// Returns { [name]: { dir, ext, alpha } } for the cards that rendered; the rest fall back.
export async function renderHyperframesCards(jobs, ctx, { log = console.log, warn = log } = {}) {
  if (!jobs.length) return {};
  let cli = hyperframesCli();
  if (cli.error) { warn(`hyperframes: ${cli.error} — using the built-in cards`); return {}; }
  let gsapFile = null;
  try { gsapFile = createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js'); } catch { /* the CDN copy */ }
  const template = ctx.opts.template;
  const root = path.join(ctx.work, 'hf');
  fs.mkdirSync(root, { recursive: true });
  const out = {};
  const todo = [];
  for (const job of jobs) {
    const launchCard = template === 'launch' && job.kind !== 'section';
    if (launchCard) {
      try { await import('roughjs'); } catch { warn('hyperframes: the launch template needs the roughjs package (npm i roughjs) — using the built-in cards'); return {}; }
    }
    const alpha = launchCard && job.kind === 'end';
    const html = launchCard ? await launch(job, { ...ctx, gsap: gsapFile ? 'assets/gsap.min.js' : GSAP_CDN })
      : lesson(job, { ...ctx, gsap: gsapFile ? 'assets/gsap.min.js' : GSAP_CDN });
    const assets = {
      ...(gsapFile ? { 'gsap.min.js': gsapFile } : {}),
      ...(launchCard ? { 'Virgil.woff2': path.join(HERE, 'fonts', 'Virgil.woff2') } : {}),
      ...(job.backdrop ? { 'backdrop.jpg': job.backdrop } : {}),
      ...(job.page ? { 'page.jpg': job.page } : {}),
      ...(job.logo ? { [`logo${path.extname(job.logo)}`]: job.logo } : {}),
      ...(job.image ? { [`image${path.extname(job.image)}`]: job.image } : {}),
      ...(launchCard && job.kind === 'intro' && ctx.frame.frameBg ? { 'frame-bg.png': ctx.frame.frameBg } : {}),
      ...(launchCard && job.kind === 'intro' && ctx.frame.chrome ? { 'frame-chrome.png': ctx.frame.chrome } : {}),
      ...(launchCard && job.kind === 'intro' && ctx.frame.url ? { 'frame-url.png': ctx.frame.url } : {}),
    };
    const key = hashOf(HF_VERSION, ctx.FPS, alpha, html, ...Object.entries(assets).map(([k, f]) => [k, fs.existsSync(f) ? crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex') : 'missing']));
    const dir = path.join(root, `${job.name}-${key}`);
    const frames = path.join(dir, 'frames');
    const ext = alpha ? 'png' : 'jpg';
    if (fs.existsSync(path.join(dir, 'done'))) { out[job.name] = { dir: frames, ext, alpha }; continue; }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    for (const [k, f] of Object.entries(assets)) if (fs.existsSync(f)) fs.copyFileSync(f, path.join(dir, 'assets', k));
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    fs.writeFileSync(path.join(dir, 'hyperframes.json'), JSON.stringify({ paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' } }));
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ id: job.name, name: job.name }));
    todo.push({ job, dir, frames, ext, alpha });
  }
  // drop renders of cards that changed (each card keeps only its latest)
  const keep = new Set([...Object.values(out).map((o) => path.dirname(o.dir)), ...todo.map((t) => t.dir)]);
  for (const d of fs.readdirSync(root)) if (!keep.has(path.join(root, d)) && jobs.some((j) => d.startsWith(`${j.name}-`))) fs.rmSync(path.join(root, d), { recursive: true, force: true });
  if (!todo.length) return out;

  try { cli = await ensureCli(log); } catch (e) {
    warn(`hyperframes: could not install the CLI (${String(e.message).slice(0, 200)}) — using the built-in cards`);
    return out;
  }
  log(`hyperframes: rendering ${todo.length} card${todo.length > 1 ? 's' : ''} (${cli.how})`);
  const one = async (t) => {
    const t0 = Date.now();
    try {
      const target = t.alpha ? path.join(t.dir, 'seq') : path.join(t.dir, 'out.mp4');
      await run(cli, ['render', t.dir, '--output', target, '--fps', String(ctx.FPS), '--quality', 'delivery', '--quiet', ...(t.alpha ? ['--format', 'png-sequence'] : [])]);
      fs.mkdirSync(t.frames, { recursive: true });
      if (t.alpha) {
        const pngs = fs.readdirSync(target).filter((f) => f.endsWith('.png')).sort();
        if (!pngs.length) throw new Error('no frames came out');
        pngs.forEach((f, k) => fs.renameSync(path.join(target, f), path.join(t.frames, `${String(k).padStart(4, '0')}.png`)));
      } else {
        await new Promise((resolve, reject) => {
          const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', target, '-q:v', '2', '-start_number', '0', path.join(t.frames, '%04d.jpg')], { stdio: 'ignore' });
          p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('could not read the rendered card'))));
        });
      }
      fs.writeFileSync(path.join(t.dir, 'done'), '');
      out[t.job.name] = { dir: t.frames, ext: t.ext, alpha: t.alpha };
      log(`  ${t.job.name}: ${t.job.seconds.toFixed(1)}s card in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    } catch (e) {
      warn(`hyperframes: the ${t.job.name} card did not render (${String(e.message).slice(0, 300)}) — using the built-in one`);
    }
  };
  // two renders at a time (each one drives its own browser)
  const queue = [...todo];
  await Promise.all([0, 1].map(async () => { while (queue.length) await one(queue.shift()); }));
  return out;
}
