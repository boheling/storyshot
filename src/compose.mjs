// Turn a recording (timeline.json + raw frames) into the final silent video:
// retime each step to its target duration -> smooth zoom/pan -> captions -> end card.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const md = (s, accent) => esc(s).replace(/\*\*(.+?)\*\*/g, `<b style="color:${accent};font-weight:700">$1</b>`);

export async function compose(cfg, { log = console.log, voiceLens = { steps: {}, endCard: null } } = {}) {
  const warnings = [];
  const warn = (m) => { warnings.push(m); log(`warning: ${m}`); };
  const tl = JSON.parse(fs.readFileSync(path.join(cfg.work, 'timeline.json'), 'utf8'));
  if (tl.steps.length !== cfg.steps.length) {
    throw new Error(`recording has ${tl.steps.length} steps but demo.yaml has ${cfg.steps.length} — re-record (actions changed)`);
  }
  const { width: W, height: H, fps: FPS } = cfg.output;
  const K = tl.scale; // css px -> output px
  const ec0 = cfg.endCard;
  // a card with bullets needs time to read them: they appear one by one, then hold
  const readTime = (c) => (c?.bullets?.length ? 1.6 + 0.4 * c.bullets.length + 0.6 * c.bullets.length : 0);
  // `think: N` (question cards): after the question is read out, N seconds with a countdown bar
  const cardLen = (c, voice, min) => (c.duration === 'auto' || c.duration == null ? Math.max(min, (voice ?? 0) + 0.9, readTime(c)) + (c.think ?? 0) : c.duration);
  const END = !ec0 ? 0 : ec0.duration === 'auto' ? Math.max(1.0, (voiceLens.endCard ?? 0) + 0.6, readTime(ec0)) : ec0.duration;
  const in0 = cfg.intro;
  const INTRO = !in0 ? 0 : in0.duration === 'auto' ? Math.max(1.8, (voiceLens.intro ?? 0) + 0.8, readTime(in0)) : in0.duration;
  const cards = []; // section cards: { i, t0, t1, card }

  // --- 1. segments (one per visible step), split into motion / waiting pieces ------------
  // Waiting (page loads, processing) is squeezed hard; cursor motion keeps a natural pace.
  // `duration: auto` plays motion in real time and makes the step as long as its narration
  // needs: extra time first shows more of the waiting, then holds the last frame.
  const segs = [], pieces = [];
  let acc = INTRO, afterHidden = false; // the intro card plays over the first frame
  for (const [i, s] of cfg.steps.entries()) {
    const r = tl.steps[i];
    if (s.hidden) { afterHidden = segs.length > 0; continue; }
    const end = Math.max(r.end, r.start + 1e-3);
    // alternating [a, b, isWait] intervals covering the step
    const parts = [];
    let t = r.start;
    for (const [a0, b0] of r.waits ?? []) {
      const a = Math.max(a0, t), b = Math.min(b0, end);
      if (b - a < 0.05) continue;
      if (a > t) parts.push([t, a, false]);
      parts.push([a, b, true]);
      t = b;
    }
    if (end > t) parts.push([t, end, false]);
    const M = parts.filter((p) => !p[2]).reduce((x, p) => x + p[1] - p[0], 0);
    const Wt = parts.filter((p) => p[2]).reduce((x, p) => x + p[1] - p[0], 0);
    let D, waitBudget, motionBudget, hold = 0;
    if (s.duration === 'auto') {
      const voiceNeed = voiceLens.steps[i] != null ? voiceLens.steps[i] + (s.sayAt ?? 0.15) + cfg.pace.tail : 0;
      waitBudget = Math.min(Wt, cfg.maxWait);
      motionBudget = M;
      // a silent step holds its result too (docs GIFs: long enough to see it before the loop restarts)
      const quiet = s.say ? 0 : cfg.clips.length ? 1.5 : cfg.pace.tail;
      D = Math.max(M + waitBudget + quiet, voiceNeed, 0.8);
      let extra = D - M - waitBudget;
      const stretch = Math.min(extra, Wt - waitBudget);
      waitBudget += stretch; extra -= stretch;
      hold = extra;
    } else {
      D = s.duration;
      waitBudget = M + Wt <= D ? Wt * D / (M + Wt) : M === 0 ? D : Math.min(Wt, Math.max(D - M, 0.15 * D));
      motionBudget = D - waitBudget;
    }
    if (s.card) {
      // a section card plays over the step's first frame, before the step
      const C = cardLen(s.card, voiceLens.cards?.[i], 2.4);
      pieces.push({ raw: [r.start, r.start], o0: acc, o1: acc + C });
      cards.push({ i, t0: acc, t1: acc + C, card: s.card, thinkAt: C - (s.card.think ?? 0) - 0.3 });
      acc += C;
    }
    const g = { i, step: s, o0: acc, o1: acc + D, zoomBox: r.zoomBox, afterHidden, hold,
      motionSpeed: M && motionBudget ? M / motionBudget : 1, waitSpeed: Wt && waitBudget ? Wt / waitBudget : 1 };
    for (const [a, b, w] of parts) {
      const len = (b - a) / (w ? g.waitSpeed : g.motionSpeed);
      pieces.push({ raw: [a, b], o0: acc, o1: acc + len });
      acc += len;
    }
    if (hold > 0.01) { pieces.push({ raw: [end, end], o0: acc, o1: acc + hold }); acc += hold; }
    if (g.motionSpeed > 2.5) warn(`step ${i + 1}: cursor motion plays at x${g.motionSpeed.toFixed(1)} and will look rushed — raise its duration or shorten pauses/ms`);
    if (M - (r.holds ?? 0) > 0.3 && g.motionSpeed < 0.5) warn(`step ${i + 1}: plays in slow motion (x${g.motionSpeed.toFixed(1)}) — lower its duration or add a pause`);
    acc = g.o1; // absorb float drift
    pieces.at(-1).o1 = acc;
    segs.push(g);
    afterHidden = false;
  }
  const VIDEO = acc, TOTAL = VIDEO + END;
  const toOut = (r) => {
    for (const p of pieces) if (r >= p.raw[0] && r <= p.raw[1]) return p.o0 + ((r - p.raw[0]) / (p.raw[1] - p.raw[0])) * (p.o1 - p.o0);
    return null; // in a hidden step or outside the recording
  };

  // --- 2. retimed frame sequence ------------------------------------------------------------
  const SEQ = path.join(cfg.work, 'seq');
  fs.rmSync(SEQ, { recursive: true, force: true });
  fs.mkdirSync(SEQ, { recursive: true });
  const nFrames = Math.round(VIDEO * FPS);
  let fi = 0, pi = 0;
  for (let n = 0; n < nFrames; n++) {
    const t = n / FPS;
    while (pi + 1 < pieces.length && t >= pieces[pi].o1) pi++;
    const p = pieces[pi];
    const r = p.raw[0] + Math.min(1, Math.max(0, (t - p.o0) / Math.max(1e-6, p.o1 - p.o0))) * (p.raw[1] - p.raw[0]);
    while (fi + 1 < tl.frames.length && tl.frames[fi + 1].t <= r) fi++;
    fs.linkSync(path.join(cfg.work, 'raw', tl.frames[fi].file), path.join(SEQ, `${String(n).padStart(5, '0')}.jpg`));
  }

  // --- 2b. near-blank frames (a page still loading: spinner on an empty page) --------------------
  // Edge density of a 160x90 grey thumbnail: real pages score ≳ 5, an empty page with a spinner ≈ 1–2.
  {
    const tw = 160, th = 90, rate = 10;
    const buf = execFileSync('ffmpeg', ['-loglevel', 'error', '-framerate', `${FPS}`, '-i', path.join(SEQ, '%05d.jpg'),
      '-vf', `fps=${rate},scale=${tw}:${th},format=gray`, '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 1 << 28 });
    // plus the share of 8x8 blocks with no detail at all: an empty canvas or image area that is still
    // loading (dark or light) next to toolbars that are already there
    const n = Math.floor(buf.length / (tw * th)), score = [], flat = [];
    for (let f = 0; f < n; f++) {
      let e = 0;
      const blocks = new Float64Array(Math.ceil(tw / 8) * Math.ceil(th / 8));
      for (let y = 0, o = f * tw * th; y < th - 1; y++) for (let x = 0; x < tw - 1; x++) {
        const k = o + y * tw + x, d = Math.abs(buf[k] - buf[k + 1]) + Math.abs(buf[k] - buf[k + tw]);
        e += d; blocks[Math.floor(y / 8) * Math.ceil(tw / 8) + Math.floor(x / 8)] += d;
      }
      score.push(e / (tw * th));
      flat.push(blocks.filter((b) => b / 64 < 0.6).length / blocks.length);
    }
    const median = [...score].sort((a, b) => a - b)[Math.floor(n / 2)] ?? 0;
    const blank = score.map((e) => e < 3 && e < median * 0.4);
    for (const g of segs) {
      // compared with how the step ends (its content loaded): much emptier = still loading. Only right
      // after the step waited for something (a load), so drawing on an empty canvas isn't flagged.
      const last = Math.min(n - 1, Math.max(0, Math.floor(g.o1 * rate) - 1));
      const loading = (tl.steps[g.i].waits ?? []).map(([a, b]) => [toOut(a), toOut(b)]).filter(([a]) => a != null).map(([a, b]) => [a, (b ?? a) + 1.5]);
      for (let f = Math.ceil(g.o0 * rate); f <= last; f++) {
        if (flat[f] > 0.55 && flat[f] - flat[last] > 0.25 && loading.some(([a, b]) => f / rate >= a - 0.1 && f / rate <= b)) blank[f] = true;
      }
    }
    for (const g of segs) {
      let run = 0, from = 0;
      const report = (to) => { if (run / rate >= 0.2) warn(`step ${g.i + 1}: ${(run / rate).toFixed(1)}s of near-blank frames at ${from.toFixed(1)}–${to.toFixed(1)}s (the page is still loading) — move that load into a hidden step, or wait for the loaded content before the step starts`); };
      for (let f = Math.ceil(g.o0 * rate); f < Math.min(n, Math.floor(g.o1 * rate)); f++) {
        if (blank[f]) { if (!run) from = f / rate; run++; } else { report(f / rate); run = 0; }
      }
      report(g.o1);
    }
  }

  // --- 3. zoom keyframes: [time, zoom, [cx, cy]] in output px -------------------------------
  const C0 = [W / 2, H / 2];
  const kf = [[0, 1, C0]];
  // follow camera: steps without a zoom of their own zoom in on the boxes their actions touched
  // (clicks, typing, marks), and consecutive followed steps pan from one subject to the next
  const { width: VW0, height: VH0 } = cfg.viewport;
  const followOf = (g) => {
    if (!cfg.follow || g.step.zoom || g.step.follow === false) return null;
    const bs = (tl.steps[g.i].marks ?? []).map((m) => m.box).filter((b) => b && b.width < VW0 * 0.9);
    if (!bs.length) return null;
    const u = bs.reduce((a, b) => ({ x0: Math.min(a.x0, b.x), y0: Math.min(a.y0, b.y), x1: Math.max(a.x1, b.x + b.width), y1: Math.max(a.y1, b.y + b.height) }), { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
    const w = u.x1 - u.x0 + 160, h = u.y1 - u.y0 + 140; // some context around the subject
    const scale = Math.max(1, Math.min(cfg.follow.scale, VW0 / w, VH0 / h));
    if (scale < 1.15) return null;
    return { box: { x: u.x0, y: u.y0, width: u.x1 - u.x0, height: u.y1 - u.y0 }, scale };
  };
  let followEnd = -1;
  for (const g of segs) {
    const f = followOf(g);
    if (f) {
      g.zoomBox = f.box;
      const c = [(f.box.x + f.box.width / 2) * K, (f.box.y + f.box.height / 2) * K];
      const move = Math.min(0.7, (g.o1 - g.o0) / 3);
      g.zoomPeak = g.o0 + move + 0.1;
      if (Math.abs(followEnd - g.o0) < 1e-3 && kf.at(-1)[1] === 1) kf.pop(); // pan straight from the previous subject
      else kf.push([g.o0, 1, C0]);
      kf.push([g.o0 + move, f.scale, c], [g.o1 - 0.6, f.scale, c], [g.o1, 1, C0]);
      followEnd = g.o1;
      continue;
    }
    const z = g.step.zoom;
    const t = z?.target;
    if (t && typeof t === 'object' && typeof t.x === 'number' && typeof t.y === 'number' && !t.role && !t.css && !t.text) {
      // a point needs no measuring, so it works even if the zoom was added after recording
      const { width: VW, height: VH } = cfg.viewport;
      // a point names the middle of the subject: give it some area, so captions keep off it too
      const px = t.x <= 1 ? t.x * VW : t.x, py = t.y <= 1 ? t.y * VH : t.y, bw = VW * 0.12, bh = VH * 0.1;
      g.zoomBox = { x: px - bw / 2, y: py - bh / 2, width: bw, height: bh };
    } else if (t && 'zoomTarget' in tl.steps[g.i] && JSON.stringify(tl.steps[g.i].zoomTarget) !== JSON.stringify(t)) {
      warn(`step ${g.i + 1}: zoom target was added or changed after recording, so its position is unknown — re-render with mode "render" (or use a point target)`);
      g.zoomBox = null;
    } else if (z && !g.zoomBox) warn(`step ${g.i + 1}: zoom target not found on the page, zoom skipped`);
    if (!z || !g.zoomBox) continue;
    g.zoomPeak = g.o0 + (z.start ?? 0) + (Array.isArray(z.ramp) ? z.ramp[0] : z.ramp ?? 0.5) + 0.1;
    const b = g.zoomBox, off = z.offset ?? {};
    const c = [(b.x + b.width / 2 + (off.x ?? 0)) * K, (b.y + b.height / 2 + (off.y ?? 0)) * K];
    const [rin, rout] = Array.isArray(z.ramp) ? z.ramp : [z.ramp ?? 0.5, z.ramp ?? 0.5];
    const s = g.o0 + (z.start ?? 0), e = Math.min(TOTAL, g.o0 + (z.end ?? g.o1 - g.o0)), scale = z.scale ?? 1.3;
    const last = kf.at(-1)[0];
    if (s < last) { warn(`zoom in step ${g.i + 1} overlaps the previous zoom, skipped`); continue; }
    kf.push([s, 1, C0], [Math.min(s + rin, e), scale, c], [Math.max(s + rin, e - rout), scale, c], [e, 1, C0]);
  }
  if (kf.at(-1)[0] < TOTAL) kf.push([TOTAL, 1, C0]);
  const S = 2; // supersample to avoid zoompan's integer-pixel jitter
  const piece = (get) => {
    let e = String(get(kf.at(-1)));
    for (let i = kf.length - 2; i >= 0; i--) {
      const t0 = kf[i][0], t1 = kf[i + 1][0], v0 = get(kf[i]), v1 = get(kf[i + 1]);
      const p = `clip((T-${t0.toFixed(3)})/${Math.max(1e-3, t1 - t0).toFixed(3)},0,1)`;
      const body = v0 === v1 ? `${v0}` : `(${v0}+(${(v1 - v0).toFixed(4)})*${p}*${p}*(3-2*${p}))`;
      e = `if(lt(T,${t1.toFixed(3)}),${body},${e})`;
    }
    return e.replaceAll('T', `(on/${FPS})`);
  };
  const zExpr = piece((k) => k[1]);
  const cxExpr = piece((k) => +(k[2][0] * S).toFixed(1));
  const cyExpr = piece((k) => +(k[2][1] * S).toFixed(1));
  // where a recorded css-px box lands on screen at output time t (same easing and clamping as zoompan)
  const view = (t) => {
    let i = 0;
    while (i + 1 < kf.length - 1 && t >= kf[i + 1][0]) i++;
    const [t0, z0, c0] = kf[i], [t1, z1, c1] = kf[i + 1] ?? kf[i];
    const q = Math.min(1, Math.max(0, (t - t0) / Math.max(1e-3, t1 - t0))), e = q * q * (3 - 2 * q);
    const z = z0 + (z1 - z0) * e, cx = c0[0] + (c1[0] - c0[0]) * e, cy = c0[1] + (c1[1] - c0[1]) * e;
    return { z, x0: Math.min(Math.max(cx - W / z / 2, 0), W - W / z), y0: Math.min(Math.max(cy - H / z / 2, 0), H - H / z) };
  };
  // browser-window frame: the page is drawn at (FX, FY), FW x FH, inside a window on a backdrop
  const even = (x) => 2 * Math.round(x / 2);
  const FW = cfg.frame ? even(W * 0.82) : W, FH = cfg.frame ? even(H * 0.82) : H, BAR = cfg.frame ? Math.round(H * 0.034) : 0;
  const FX = even((W - FW) / 2), FY = cfg.frame ? even((H - FH - BAR) / 2 + BAR) : 0, F = FW / W;
  const onScreen = (b, t) => {
    const v = view(t);
    return { x: FX + (b.x * K - v.x0) * v.z * F, y: FY + (b.y * K - v.y0) * v.z * F, w: b.width * K * v.z * F, h: b.height * K * v.z * F };
  };

  // --- 4. captions + end card rendered as PNGs ----------------------------------------------
  const { accent, ink, font } = cfg.theme;
  const fontCss = `font-family:'${font}',-apple-system,'Segoe UI','Helvetica Neue',sans-serif;`;
  const head = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@400;500;600;700&display=block">`;
  const browser = await chromium.launch();
  const pg = await browser.newPage({ viewport: { width: W, height: H } });
  const shot = async (html, file, transparent) => {
    await pg.setContent(`<html><head>${head}</head>${html}</html>`, { waitUntil: 'networkidle' }).catch(() => {});
    await pg.evaluate(() => document.fonts.ready);
    await pg.screenshot({ path: file, omitBackground: transparent });
  };
  const fs1 = Math.round(H * 0.043), MARGIN = Math.round(H * 0.06);
  const bubble = (text, n, pos) => `<body style="margin:0;background:transparent">
      <div style="position:absolute;left:0;right:0;${pos === 'top' ? 'top' : 'bottom'}:${MARGIN}px;display:flex;justify-content:center;padding:0 5%">
        <div id="cap" style="${fontCss}font-size:${fs1}px;font-weight:500;letter-spacing:-.01em;color:#fff;background:${ink}e0;text-align:center;
          padding:${Math.round(fs1 * 0.43)}px ${Math.round(fs1 * 0.87)}px;border-radius:${fs1}px;box-shadow:0 12px 40px rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.12)">
          ${cfg.stepNumbers ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:1.45em;height:1.45em;margin:-.2em .55em -.2em -.35em;border-radius:50%;background:${accent};color:${ink};font-weight:700;font-size:.85em;vertical-align:middle">${n}</span>` : ''}${md(text, accent)}</div></div></body>`;

  // Keep each caption off what the step is about: the targets its actions click, hover, type
  // into or drag (where they are on screen at that moment, zoom included) and its zoom subject.
  // If the chosen side covers one and the other side is clear, the caption moves there.
  const sizes = new Map();
  const sizeOf = async (text, n) => {
    const key = `${n}|${text}`;
    if (!sizes.has(key)) {
      await pg.setContent(`<html><head>${head}</head>${bubble(text, n, 'bottom')}</html>`, { waitUntil: 'networkidle' }).catch(() => {});
      await pg.evaluate(() => document.fonts.ready);
      sizes.set(key, await pg.$eval('#cap', (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; }));
    }
    return sizes.get(key);
  };
  const captions = [];
  for (const g of segs) {
    if (!g.step.caption) continue;
    const prev = captions.at(-1);
    const n = prev && prev.text === g.step.caption && Math.abs(prev.t[1] - g.o0) < 1e-6 ? prev.n : captions.length + 1;
    const explicit = g.step.captionPosition, want = explicit ?? cfg.captionPosition;
    const { w, h } = await sizeOf(g.step.caption, n);
    const rectOf = (pos) => ({ x: (W - w) / 2, y: pos === 'top' ? MARGIN : H - MARGIN - h, w, h });
    const subjects = [];
    for (const m of tl.steps[g.i].marks ?? []) {
      const t = toOut(m.t);
      if (t != null) for (const dt of [0, 0.5]) subjects.push({ what: 'a click/hover target', box: onScreen(m.box, Math.min(g.o1, t + dt)) });
    }
    if (g.zoomPeak != null) subjects.push({ what: 'the zoom subject', box: onScreen(g.zoomBox, g.zoomPeak) });
    const pad = H * 0.012;
    const hits = (pos) => {
      const r = rectOf(pos);
      return subjects.find(({ box: b }) => b.x - pad < r.x + r.w && b.x + b.w + pad > r.x && b.y - pad < r.y + r.h && b.y + b.h + pad > r.y);
    };
    const other = want === 'top' ? 'bottom' : 'top';
    let pos = want;
    const hit = hits(want);
    if (hit && cfg.subtitles === 'burn' && other === 'bottom') {
      warn(`step ${g.i + 1}: the caption covers ${hit.what}, and the bottom is kept for the burned-in subtitles — shorten the caption, or change the zoom`);
    } else if (hit && !hits(other)) {
      pos = other;
      warn(`step ${g.i + 1}: the ${want} caption would cover ${hit.what}, so it was moved to the ${other}` + (explicit ? ` (despite captionPosition: ${explicit})` : '') + ` — set captionPosition: ${other} to make this explicit`);
    } else if (hit) warn(`step ${g.i + 1}: the caption covers ${hit.what} at both top and bottom — shorten the caption, or change the zoom`);
    if (prev && n === prev.n && prev.pos === pos) prev.t[1] = g.o1;
    else captions.push({ text: g.step.caption, t: [g.o0, g.o1], pos, n, h });
  }
  for (const [i, c] of captions.entries()) await shot(bubble(c.text, c.n, c.pos), path.join(cfg.work, `cap${i}.png`), true);
  // Intro and end cards are short animations (logo pops, title rises, the highlight sweeps, a command
  // CTA types itself out), rendered frame by frame by seeking the page's CSS animations.
  const u = H / 1080;
  // cards follow the frame: dark backdrops (aurora, dark, blur) get dark cards, so a dark app doesn't
  // cut to a white card; `cards: light | dark` overrides
  const darkCards = cfg.cards === 'dark' || (cfg.cards !== 'light' && ['aurora', 'dark', 'blur'].includes(cfg.frame?.style));
  const CK = darkCards
    ? { bg: `radial-gradient(${W * 0.62}px ${H * 0.65}px at 50% 40%,#1e2a44 0%,#111830 60%,#0b1020 100%)`, title: '#f1f5f9', sub: '#cbd5e1', muted: '#94a3b8', item: '#e2e8f0', track: '#26314d',
      pillBg: '#1a2238', pillFg: '#e2e8f0', pillLine: '1px solid #33405f', ctaBg: accent, ctaFg: ink, shadow: 'rgba(0,0,0,.45)' }
    : { bg: `radial-gradient(${W * 0.62}px ${H * 0.65}px at 50% 40%,#ffffff 0%,#eef2f7 60%,#e2e8f0 100%)`, title: ink, sub: '#334155', muted: '#64748b', item: '#1e293b', track: '#e2e8f0',
      pillBg: ink, pillFg: '#e2e8f0', pillLine: 'none', ctaBg: ink, ctaFg: '#fff', shadow: 'rgba(15,23,42,.25)' };
  const card = (c, logoPath, { thinkAt = 0 } = {}) => {
    const image = c.imageFile && fs.existsSync(c.imageFile)
      ? `<img class="a rise" src="data:image/${path.extname(c.imageFile).slice(1).replace('jpg', 'jpeg').replace('svg', 'svg+xml')};base64,${fs.readFileSync(c.imageFile).toString('base64')}" style="animation-delay:.4s;max-width:${W * 0.6}px;max-height:${H * 0.42}px;border-radius:${12 * H / 1080}px;box-shadow:0 ${12 * H / 1080}px ${36 * H / 1080}px rgba(15,23,42,.18)">` : '';
    const think = c.think ? `<div class="a rise" style="animation-delay:${thinkAt.toFixed(2)}s;position:absolute;left:50%;bottom:${H * 0.1}px;transform:translateX(-50%);width:${W * 0.3}px;text-align:center;font-size:${26 * H / 1080}px;color:${CK.muted}">
        <div style="margin-bottom:${12 * H / 1080}px">${cfg.lang === 'zh' ? '先想一想' : 'Pause and think'}</div>
        <div style="height:${8 * H / 1080}px;border-radius:99px;background:${CK.track};overflow:hidden"><div style="height:100%;background:${accent};transform-origin:left;animation:drain ${c.think}s linear ${thinkAt.toFixed(2)}s both"></div></div></div>
        <style>@keyframes drain{from{transform:scaleX(1)}to{transform:scaleX(0)}}</style>` : '';
    const logo = fs.existsSync(logoPath)
      ? `<img class="a pop" src="data:image/${path.extname(logoPath).slice(1).replace('jpg', 'jpeg').replace('svg', 'svg+xml')};base64,${fs.readFileSync(logoPath).toString('base64')}" style="height:${Math.round(H * 0.09)}px;${darkCards ? `background:#fff;padding:${Math.round(10 * u)}px ${Math.round(16 * u)}px;border-radius:${Math.round(14 * u)}px;box-shadow:0 ${8 * u}px ${24 * u}px rgba(0,0,0,.35)` : ''}">` : ''; // logos captured from a light page often carry its white: give them a plate on dark cards
    const cmd = c.cta && /^\$?\s*(npx|npm|pnpm|yarn|bun|pip|pipx|uv|brew|curl|git|docker|cargo|go)\b/.test(c.cta);
    const ctaText = String(c.cta ?? '').replace(/^\$\s*/, '');
    return `<body style="margin:0;width:${W}px;height:${H}px;${fontCss}
      background:${CK.bg};
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${28 * u}px;text-align:center">
      <style>
        .a{animation-fill-mode:both;animation-timing-function:cubic-bezier(.2,.8,.2,1)}
        .pop{animation-name:pop;animation-duration:.55s;animation-delay:.05s}
        .rise{animation-name:rise;animation-duration:.6s}
        ${darkCards
          ? `.hl{color:${accent};background:linear-gradient(${accent},${accent}) no-repeat 0 100%/0% ${Math.max(2, Math.round(3 * u))}px;padding-bottom:${Math.round(4 * u)}px;animation:sweep .6s cubic-bezier(.4,0,.2,1) .75s both}`
          : `.hl{background:linear-gradient(transparent 60%,${accent} 60%) no-repeat 0 0/0% 100%;animation:sweep .6s cubic-bezier(.4,0,.2,1) .75s both}`}
        .type{display:inline-block;overflow:hidden;white-space:nowrap;vertical-align:bottom;width:0;animation:type ${(ctaText.length * 0.045).toFixed(2)}s steps(${ctaText.length || 1}) .8s both}
        .caret{display:inline-block;width:.55em;height:1.1em;margin-left:.1em;vertical-align:-.15em;background:${accent};animation:blink 1s steps(1) .8s infinite}
        @keyframes pop{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}}
        @keyframes rise{from{opacity:0;transform:translateY(${24 * u}px)}to{opacity:1;transform:none}}
        @keyframes sweep{to{background-size:100% ${darkCards ? `${Math.max(2, Math.round(3 * u))}px` : '100%'}}}
        @keyframes type{to{width:${ctaText.length}ch}}
        @keyframes blink{50%{opacity:0}}
      </style>
      ${c.kicker ? `<div class="a rise" style="font-size:${30 * u}px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${CK.muted}">${esc(c.kicker)}</div>` : ''}
      <div style="display:flex;align-items:center;gap:${22 * u}px">${logo}
        ${c.title ? `<span class="a rise" style="animation-delay:.12s;display:block;max-width:${W * 0.8}px;text-wrap:balance;line-height:1.15;font-size:${(c.title.length > 40 ? 68 : 92) * u}px;font-weight:600;letter-spacing:-.03em;color:${CK.title}">${esc(c.title).replace(/\*\*(.+?)\*\*/g, '<span class="hl">$1</span>')}</span>` : ''}</div>
      ${c.subtitle ? `<div class="a rise" style="animation-delay:.3s;font-size:${44 * u}px;color:${CK.sub};letter-spacing:-.01em">${esc(c.subtitle).replace(/\*\*(.+?)\*\*/g, '<span class="hl">$1</span>')}</div>` : ''}
      ${image}${think}
      ${c.bullets?.length ? `<ol style="margin:${10 * u}px 0 0;padding:0;list-style:none;text-align:left;display:flex;flex-direction:column;gap:${18 * u}px">${c.bullets.map((b, k) =>
        `<li class="a rise" style="animation-delay:${(0.6 + 0.4 * k).toFixed(2)}s;display:flex;align-items:center;gap:${20 * u}px;font-size:${38 * u}px;color:${CK.item}">
          <span style="flex:none;display:inline-flex;align-items:center;justify-content:center;width:${52 * u}px;height:${52 * u}px;border-radius:50%;background:${accent};color:${ink};font-weight:700;font-size:${28 * u}px">${k + 1}</span>
          <span>${md(b, darkCards ? accent : ink)}</span></li>`).join('')}</ol>` : ''}
      ${!c.cta ? '' : cmd
        ? `<div class="a rise" style="animation-delay:.45s;margin-top:${18 * u}px;font:500 ${36 * u}px ui-monospace,SFMono-Regular,Menlo,monospace;color:${CK.pillFg};background:${CK.pillBg};border:${CK.pillLine};padding:${20 * u}px ${36 * u}px;border-radius:${16 * u}px;text-align:left;box-shadow:0 ${16 * u}px ${40 * u}px ${CK.shadow}"><span style="color:${accent}">$</span> <span class="type">${esc(ctaText)}</span><span class="caret"></span></div>`
        : `<div class="a rise" style="animation-delay:.45s;margin-top:${18 * u}px;font-size:${38 * u}px;font-weight:600;color:${CK.ctaFg};background:${CK.ctaBg};padding:${20 * u}px ${46 * u}px;border-radius:${16 * u}px">${esc(c.cta)}</div>`}
      </body>`;
  };
  const animate = async (html, seconds, dir) => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await pg.setContent(`<html><head>${head}</head>${html}</html>`, { waitUntil: 'networkidle' }).catch(() => {});
    await pg.evaluate(() => document.fonts.ready);
    const n = Math.ceil(seconds * FPS) + 1;
    for (let k = 0; k < n; k++) {
      await pg.evaluate((ms) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = ms; }), (k * 1000) / FPS);
      await pg.screenshot({ path: path.join(dir, `${String(k).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92 });
    }
  };
  const ec = cfg.endCard;
  if (ec) await animate(card(ec, ec.logoFile ?? path.join(cfg.work, 'logo.png')), END + 0.5, path.join(cfg.work, 'endcard'));
  for (const [k, c] of cards.entries()) await animate(card(c.card, c.card.logoFile ?? '', { thinkAt: c.thinkAt }), c.t1 - c.t0, path.join(cfg.work, `card${k}`));
  if (in0) await animate(card(in0, in0.logoFile ?? path.join(cfg.work, 'intro-logo.png')), INTRO, path.join(cfg.work, 'intro'));
  if (cfg.frame) {
    // three layers: the backdrop (a picture, or the page itself blurred), the window chrome (shadow and
    // title bar), and the page with rounded bottom corners
    const grain = `url('data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .09 0"/></filter><rect width="200" height="200" filter="url(#n)"/></svg>')}')`;
    const STYLES = {
      aurora: { dark: true, bg: `${grain}, radial-gradient(${W * 0.47}px ${H * 0.65}px at 20% 20%, #22d3ee99, transparent 60%), radial-gradient(${W * 0.47}px ${H * 0.65}px at 80% 30%, #a78bfa99, transparent 60%), radial-gradient(${W * 0.52}px ${H * 0.74}px at 50% 100%, #34d39988, transparent 60%), #0b1020` },
      studio: { dark: false, bg: `${grain}, radial-gradient(${W * 0.73}px ${H * 0.83}px at 50% 0%, #ffffff, #e9edf3 60%, #d6dce6)` },
      dark: { dark: true, bg: `radial-gradient(${W * 0.7}px ${H * 0.8}px at 15% 0%, ${accent}66, transparent 70%), radial-gradient(${W * 0.7}px ${H * 0.8}px at 100% 100%, #6366f166, transparent 70%), linear-gradient(135deg, #1e293b, ${ink})` },
      pastel: { dark: false, bg: 'linear-gradient(135deg, #fde2e4 0%, #e2ece9 35%, #dfe7fd 70%, #f0e6ff 100%)' },
      blur: { dark: true, bg: null },
    };
    const st = STYLES[cfg.frame.style], bg = cfg.frame.background ?? st.bg;
    const R = Math.round(14 * u), host = new URL(cfg.url).host.replace(/^www\./, '') + new URL(cfg.url).pathname.replace(/\/$/, '');
    const dot = (col) => `<span style="width:${13 * u}px;height:${13 * u}px;border-radius:50%;background:${col};display:inline-block"></span>`;
    const [barBg, barFg, pill, line] = st.dark ? ['#1f2430', '#9aa4b2', '#2b3140', '#11151d'] : ['#e8ebef', '#4b5563', '#fff', '#d5d9df'];
    if (bg) await shot(`<body style="margin:0;width:${W}px;height:${H}px;background:${bg}"></body>`, path.join(cfg.work, 'frame-bg.png'), false);
    await shot(`<body style="margin:0;width:${W}px;height:${H}px;background:transparent;${fontCss}">
      <div style="position:absolute;left:${FX}px;top:${FY - BAR}px;width:${FW}px;height:${FH + BAR}px;border-radius:${R}px;background:#fff;box-shadow:0 ${30 * u}px ${80 * u}px rgba(0,0,0,${st.dark ? '.5' : '.25'}),0 0 0 1px rgba(255,255,255,.08)"></div>
      <div style="position:absolute;left:${FX}px;top:${FY - BAR}px;width:${FW}px;height:${BAR}px;border-radius:${R}px ${R}px 0 0;background:${barBg};display:flex;align-items:center;border-bottom:1px solid ${line}">
        <div style="display:flex;gap:${8 * u}px;margin-left:${16 * u}px">${dot('#ff5f57')}${dot('#febc2e')}${dot('#28c840')}</div>
        <div style="position:absolute;left:50%;transform:translateX(-50%);font-size:${15 * u}px;color:${barFg};background:${pill};border-radius:${8 * u}px;padding:${4 * u}px ${60 * u}px">${esc(host)}</div>
      </div></body>`, path.join(cfg.work, 'frame-chrome.png'), true);
    // alpha mask for the page: rounded bottom corners (the title bar covers the top ones)
    await pg.setViewportSize({ width: FW, height: FH });
    await pg.setContent(`<body style="margin:0;width:${FW}px;height:${FH}px;background:#000"><div style="width:100%;height:100%;background:#fff;border-radius:0 0 ${R}px ${R}px"></div></body>`);
    await pg.screenshot({ path: path.join(cfg.work, 'frame-mask.png') });
    await pg.setViewportSize({ width: W, height: H });
  }
  await browser.close();

  // --- 5. ffmpeg --------------------------------------------------------------------------------
  const inputs = ['-framerate', `${FPS}`, '-i', path.join(SEQ, '%05d.jpg')];
  let graph = `[0:v]scale=${W * S}:${H * S}:flags=lanczos,` +
    `zoompan=z='${zExpr}':x='clip(${cxExpr}-iw/zoom/2,0,iw-iw/zoom)':y='clip(${cyExpr}-ih/zoom/2,0,ih-ih/zoom)'` +
    `:d=1:fps=${FPS}:s=${W}x${H},format=yuv420p${END ? `,tpad=stop_mode=clone:stop_duration=${END}` : ''}[v0];\n`;
  let last = 'v0', idx = 1;
  if (cfg.frame) {
    const still = (f) => inputs.push('-loop', '1', '-t', `${TOTAL}`, '-framerate', `${FPS}`, '-i', path.join(cfg.work, f));
    const blur = !cfg.frame.background && cfg.frame.style === 'blur';
    let base;
    if (blur) {
      graph += `[v0]split[v0a][v0b];[v0b]scale=${even(W / 12)}:${even(H / 12)},gblur=sigma=4,scale=${W}:${H},eq=brightness=-0.12:saturation=1.3[fbg];\n`;
      base = 'fbg';
    } else { still('frame-bg.png'); base = `${idx++}:v`; }
    still('frame-chrome.png'); const chrome = idx++;
    still('frame-mask.png'); const mask = idx++;
    graph += `[${blur ? 'v0a' : 'v0'}]scale=${FW}:${FH}:flags=lanczos,format=rgba[pg0];[${mask}:v]format=gray,scale=${FW}:${FH}[pm];[pg0][pm]alphamerge[pg];\n` +
      `[${base}][${chrome}:v]overlay=0:0[fc];[fc][pg]overlay=${FX}:${FY},format=yuv420p[vf];\n`;
    last = 'vf';
  }
  // docs: a second, caption-free copy for the per-step clips and stills (the article carries the
  // text), so crops never have to dodge a caption
  const clean = cfg.clips.length ? path.join(cfg.work, 'video-clean.mp4') : null;
  if (clean) { graph += `[${last}]split[vmain][vclean0];\n`; last = 'vmain'; }
  for (const [i, c] of captions.entries()) {
    const a = c.t[0] + 0.1, b = c.t[1] - 0.1;
    // each caption is an input only as long as it is on screen (decoding a looped PNG for the whole
    // video, once per caption, made long tutorials take minutes to compose)
    inputs.push('-loop', '1', '-t', `${(b - a + 0.1).toFixed(3)}`, '-framerate', `${FPS}`, '-i', path.join(cfg.work, `cap${i}.png`));
    graph += `[${idx}:v]format=rgba,setpts=PTS-STARTPTS+${a.toFixed(3)}/TB,fade=in:st=${a.toFixed(3)}:d=0.15:alpha=1,fade=out:st=${(b - 0.15).toFixed(3)}:d=0.15:alpha=1[c${i}];\n` +
      `[${last}][c${i}]overlay=0:0:eof_action=pass:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})'[v${idx}];\n`;
    last = `v${idx++}`;
  }
  for (const [k, c] of cards.entries()) {
    inputs.push('-framerate', `${FPS}`, '-i', path.join(cfg.work, `card${k}`, '%04d.jpg'));
    graph += `[${idx}:v]format=rgba,setpts=PTS-STARTPTS+${c.t0.toFixed(3)}/TB,fade=in:st=${c.t0.toFixed(3)}:d=0.25:alpha=1,fade=out:st=${Math.max(c.t0, c.t1 - 0.3).toFixed(3)}:d=0.3:alpha=1[sc${k}];\n` +
      `[${last}][sc${k}]overlay=0:0:eof_action=pass:enable='between(t,${c.t0.toFixed(3)},${c.t1.toFixed(3)})'[v${++idx}];\n`;
    last = `v${idx}`;
  }
  if (ec) {
    const st = VIDEO - 0.25;
    inputs.push('-framerate', `${FPS}`, '-i', path.join(cfg.work, 'endcard', '%04d.jpg'));
    graph += `[${idx}:v]format=rgba,setpts=PTS-STARTPTS+${st.toFixed(3)}/TB,fade=in:st=${st.toFixed(3)}:d=0.3:alpha=1[ec];\n` +
      `[${last}][ec]overlay=0:0:eof_action=repeat:enable='gte(t,${st.toFixed(3)})'[v${++idx}];\n`;
    last = `v${idx}`;
  }
  if (in0) {
    inputs.push('-framerate', `${FPS}`, '-i', path.join(cfg.work, 'intro', '%04d.jpg'));
    graph += `[${idx}:v]format=rgba,fade=out:st=${Math.max(0, INTRO - 0.35).toFixed(3)}:d=0.35:alpha=1[in];\n` +
      `[${last}][in]overlay=0:0:eof_action=pass[v${++idx}];\n`;
    last = `v${idx}`;
  }
  graph += `[${last}]trim=duration=${TOTAL},format=yuv420p[out]`;
  if (clean) graph += `;\n[vclean0]trim=duration=${TOTAL},format=yuv420p[clean]`;
  const graphFile = path.join(cfg.work, 'graph.txt');
  fs.writeFileSync(graphFile, graph);
  const silent = path.join(cfg.work, 'video-silent.mp4');
  log(`composing ${TOTAL.toFixed(2)}s video (${captions.length} captions, ${segs.filter((g) => g.zoomPeak != null).length} zooms)`);
  // ffmpeg ≥ 7 reads a filtergraph file with `-/filter_complex`; older builds (e.g. Ubuntu's 6.x) need -filter_complex_script
  const major = Number((execFileSync('ffmpeg', ['-version']).toString().match(/ffmpeg version n?(\d+)/) ?? [])[1] ?? 7);
  const graphArgs = major >= 7 ? ['-/filter_complex', graphFile] : ['-filter_complex_script', graphFile];
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, ...graphArgs, '-map', '[out]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', `${FPS}`, silent,
    ...(clean ? ['-map', '[clean]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', `${FPS}`, clean] : [])]);

  // --- 6. preview contact sheet: one frame per step (at its zoom peak) + end card ------------
  // zoomed steps: at the zoom peak; others: late in the step, where its actions' result is visible
  const shots = segs.map((g) => ({ t: Math.min(g.o1 - 0.05, g.zoomPeak ?? g.o0 + (g.o1 - g.o0) * 0.8), label: `step ${g.i + 1} · ${g.o0.toFixed(1)}–${g.o1.toFixed(1)}s${g.step.zoom ? ' · zoom' : ''}`, caption: g.step.caption ?? '' }));
  for (const c of cards) shots.push({ t: c.t0 + (c.t1 - c.t0) * 0.85, label: `card · ${c.t0.toFixed(1)}–${c.t1.toFixed(1)}s`, caption: c.card.title ?? '' });
  shots.sort((a, b) => a.t - b.t);
  if (in0) shots.unshift({ t: INTRO * 0.8, label: `intro · 0.0–${INTRO.toFixed(1)}s`, caption: '' });
  if (ec) shots.push({ t: VIDEO + END / 2, label: `end card · ${VIDEO.toFixed(1)}–${TOTAL.toFixed(1)}s`, caption: '' });
  const cells = shots.map((sh, k) => {
    const f = path.join(cfg.work, `pv${k}.jpg`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', sh.t.toFixed(3), '-i', silent, '-frames:v', '1', '-vf', 'scale=640:-2', f]);
    return `<figure><img src="data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}"><figcaption><b>${esc(sh.label)}</b> ${esc(sh.caption.replace(/\*\*/g, ''))}</figcaption></figure>`;
  });
  const preview = path.join(cfg.work, 'preview.jpg');
  {
    const b2 = await chromium.launch();
    const p2 = await b2.newPage({ viewport: { width: 1980, height: 400 } });
    await p2.setContent(`<body style="margin:0;padding:12px;background:#111;font:15px -apple-system,'Segoe UI',sans-serif;color:#ddd">
      <style>main{display:grid;grid-template-columns:repeat(3,640px);gap:12px}figure{margin:0}img{width:640px;display:block;border-radius:4px}
      figcaption{padding:6px 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}b{color:#fff}</style><main>${cells.join('')}</main></body>`);
    await p2.screenshot({ path: preview, fullPage: true, type: 'jpeg', quality: 85 });
    await b2.close();
  }

  // --- 7. events for the soundtrack (output seconds) ---------------------------------------------
  const dedupe = (ts) => ts.sort((a, b) => a - b).filter((t, i, a) => i === 0 || t - a[i - 1] > 0.3);
  const events = {
    total: TOTAL,
    endCard: ec ? VIDEO : null,
    clicks: tl.clicks.map(toOut).filter((t) => t != null),
    whooshes: dedupe([
      // whoosh on deliberate scene changes (goto) only: a page the app opens after a click, or a
      // results page reloading itself while you wait, is not a scene change
      ...(tl.gotos ?? tl.navs.filter((n) => !tl.clicks.some((c) => n - c >= 0 && n - c < 2) && !tl.steps.some((s) => (s.waits ?? []).some(([a, b]) => n >= a - 0.5 && n <= b + 0.5))))
        .map(toOut).filter((t) => t != null && t > 0.2),
      ...segs.filter((g) => g.afterHidden).map((g) => g.o0),
      ...(in0 ? [INTRO - 0.3] : []),
      ...cards.flatMap((c) => [c.t0, c.t1 - 0.3]),
      ...(ec ? [VIDEO - 0.25] : []),
    ]),
    risers: segs.filter((g) => g.step.sfx === 'riser').map((g) => [g.o0, g.o1]),
    chimes: segs.filter((g) => g.step.sfx === 'riser' || g.step.sfx === 'chime').map((g) => g.o1),
    // narration: each line may run until the next one starts
    voice: [
      ...(in0?.say ? [{ text: in0.say, start: 0.15, where: 'intro' }] : []),
      ...cards.filter((c) => c.card.say).map((c) => ({ text: c.card.say, start: c.t0 + 0.15, where: `step ${c.i + 1} card` })),
      ...segs.filter((g) => g.step.say).map((g) => ({ text: g.step.say, start: g.o0 + (g.step.sayAt ?? 0.15), where: `step ${g.i + 1}` })),
      ...(ec?.say ? [{ text: ec.say, start: VIDEO + 0.05, where: 'end card' }] : []),
    ],
  };
  events.voice.sort((a, b) => a.start - b.start);
  events.voice.forEach((v, k) => { v.until = events.voice[k + 1]?.start ?? TOTAL - 0.1; });
  fs.writeFileSync(path.join(cfg.work, 'events.json'), JSON.stringify(events, null, 1));
  log(segs.map((g) => `  ${g.o0.toFixed(1)}–${g.o1.toFixed(1)}s  step ${g.i + 1}  motion x${g.motionSpeed.toFixed(1)}  waiting x${g.waitSpeed.toFixed(1)}`).join('\n'));
  // docs clips: the part of the frame each step is about (what it clicked, typed into, marked or
  // noted, with some context), in output px, same aspect ratio as the video
  for (const g of segs) {
    const bs = (tl.steps[g.i].marks ?? []).map((m) => onScreen(m.box, Math.max(g.o0, g.o1 - 0.1))).filter((b) => b.w > 0);
    if (!bs.length) continue;
    const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
    const x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h));
    const pad = H * 0.12;
    let w = Math.max(x1 - x0 + 2 * pad, W * 0.5), h = Math.max(y1 - y0 + 2 * pad, H * 0.5);
    if (w / h > W / H) h = w * H / W; else w = h * W / H;
    w = Math.min(W, w); h = Math.min(H, h);
    let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    g.crop = { x: even(Math.max(0, Math.min(W - w, cx - w / 2))), y: even(Math.max(0, Math.min(H - h, cy - h / 2))), w: even(w), h: even(h) };
  }
  return { silent, clean, events, preview, warnings, captions, cards: cards.map((c) => ({ t: c.t0, title: [c.card.kicker, c.card.title].filter(Boolean).join(' · ') })), segs: segs.map((g) => ({ i: g.i, o0: g.o0, o1: g.o1, caption: g.step.caption, doc: g.step.doc ?? g.step.say, crop: g.crop })) };
}
