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
  const END = !ec0 ? 0 : ec0.duration === 'auto' ? Math.max(1.0, (voiceLens.endCard ?? 0) + 0.6) : ec0.duration;

  // --- 1. segments (one per visible step), split into motion / waiting pieces ------------
  // Waiting (page loads, processing) is squeezed hard; cursor motion keeps a natural pace.
  // `duration: auto` plays motion in real time and makes the step as long as its narration
  // needs: extra time first shows more of the waiting, then holds the last frame.
  const segs = [], pieces = [];
  let acc = 0, afterHidden = false;
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
      const voiceNeed = voiceLens.steps[i] != null ? voiceLens.steps[i] + (s.sayAt ?? 0.15) + 0.4 : 0;
      waitBudget = Math.min(Wt, cfg.maxWait);
      motionBudget = M;
      D = Math.max(M + waitBudget, voiceNeed, 0.8);
      let extra = D - M - waitBudget;
      const stretch = Math.min(extra, Wt - waitBudget);
      waitBudget += stretch; extra -= stretch;
      hold = extra;
    } else {
      D = s.duration;
      waitBudget = M + Wt <= D ? Wt * D / (M + Wt) : M === 0 ? D : Math.min(Wt, Math.max(D - M, 0.15 * D));
      motionBudget = D - waitBudget;
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
    const r = p.raw[0] + Math.min(1, (t - p.o0) / Math.max(1e-6, p.o1 - p.o0)) * (p.raw[1] - p.raw[0]);
    while (fi + 1 < tl.frames.length && tl.frames[fi + 1].t <= r) fi++;
    fs.linkSync(path.join(cfg.work, 'raw', tl.frames[fi].file), path.join(SEQ, `${String(n).padStart(5, '0')}.jpg`));
  }

  // --- 2b. near-blank frames (a page still loading: spinner on an empty page) --------------------
  // Edge density of a 160x90 grey thumbnail: real pages score ≳ 5, an empty page with a spinner ≈ 1–2.
  {
    const tw = 160, th = 90, rate = 10;
    const buf = execFileSync('ffmpeg', ['-loglevel', 'error', '-framerate', `${FPS}`, '-i', path.join(SEQ, '%05d.jpg'),
      '-vf', `fps=${rate},scale=${tw}:${th},format=gray`, '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 1 << 28 });
    const n = Math.floor(buf.length / (tw * th)), score = [];
    for (let f = 0; f < n; f++) {
      let e = 0;
      for (let y = 0, o = f * tw * th; y < th - 1; y++) for (let x = 0; x < tw - 1; x++) {
        const k = o + y * tw + x;
        e += Math.abs(buf[k] - buf[k + 1]) + Math.abs(buf[k] - buf[k + tw]);
      }
      score.push(e / (tw * th));
    }
    const median = [...score].sort((a, b) => a - b)[Math.floor(n / 2)] ?? 0;
    const blank = score.map((e) => e < 3 && e < median * 0.4);
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
  for (const g of segs) {
    const z = g.step.zoom;
    const t = z?.target;
    if (t && typeof t === 'object' && typeof t.x === 'number' && typeof t.y === 'number' && !t.role && !t.css && !t.text) {
      // a point needs no measuring, so it works even if the zoom was added after recording
      const { width: VW, height: VH } = cfg.viewport;
      g.zoomBox = { x: t.x <= 1 ? t.x * VW : t.x, y: t.y <= 1 ? t.y * VH : t.y, width: 0, height: 0 };
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
  const onScreen = (b, t) => {
    const v = view(t);
    return { x: (b.x * K - v.x0) * v.z, y: (b.y * K - v.y0) * v.z, w: b.width * K * v.z, h: b.height * K * v.z };
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
    if (hit && !hits(other)) {
      pos = other;
      warn(`step ${g.i + 1}: the ${want} caption would cover ${hit.what}, so it was moved to the ${other}` + (explicit ? ` (despite captionPosition: ${explicit})` : '') + ` — set captionPosition: ${other} to make this explicit`);
    } else if (hit) warn(`step ${g.i + 1}: the caption covers ${hit.what} at both top and bottom — shorten the caption, or change the zoom`);
    if (prev && n === prev.n && prev.pos === pos) prev.t[1] = g.o1;
    else captions.push({ text: g.step.caption, t: [g.o0, g.o1], pos, n });
  }
  for (const [i, c] of captions.entries()) await shot(bubble(c.text, c.n, c.pos), path.join(cfg.work, `cap${i}.png`), true);
  const ec = cfg.endCard;
  if (ec) {
    const logoPath = ec.logoFile ?? path.join(cfg.work, 'logo.png');
    const logo = fs.existsSync(logoPath)
      ? `<img src="data:image/${path.extname(logoPath).slice(1).replace('jpg', 'jpeg').replace('svg', 'svg+xml')};base64,${fs.readFileSync(logoPath).toString('base64')}" style="height:${Math.round(H * 0.09)}px">` : '';
    const u = H / 1080;
    await shot(`<body style="margin:0;width:${W}px;height:${H}px;${fontCss}
      background:radial-gradient(${W * 0.62}px ${H * 0.65}px at 50% 40%,#ffffff 0%,#eef2f7 60%,#e2e8f0 100%);
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${28 * u}px;text-align:center">
      <div style="display:flex;align-items:center;gap:${22 * u}px">${logo}
        ${ec.title ? `<span style="font-size:${92 * u}px;font-weight:600;letter-spacing:-.03em;color:${ink}">${esc(ec.title)}</span>` : ''}</div>
      ${ec.subtitle ? `<div style="font-size:${44 * u}px;color:#334155;letter-spacing:-.01em">${esc(ec.subtitle).replace(/\*\*(.+?)\*\*/g, `<span style="background:linear-gradient(transparent 62%,${accent} 62%)">$1</span>`)}</div>` : ''}
      ${ec.cta ? `<div style="margin-top:${18 * u}px;font-size:${38 * u}px;font-weight:600;color:#fff;background:${ink};padding:${20 * u}px ${46 * u}px;border-radius:${16 * u}px">${esc(ec.cta)}</div>` : ''}
      </body>`, path.join(cfg.work, 'endcard.png'), false);
  }
  await browser.close();

  // --- 5. ffmpeg --------------------------------------------------------------------------------
  const inputs = ['-framerate', `${FPS}`, '-i', path.join(SEQ, '%05d.jpg')];
  let graph = `[0:v]scale=${W * S}:${H * S}:flags=lanczos,` +
    `zoompan=z='${zExpr}':x='clip(${cxExpr}-iw/zoom/2,0,iw-iw/zoom)':y='clip(${cyExpr}-ih/zoom/2,0,ih-ih/zoom)'` +
    `:d=1:fps=${FPS}:s=${W}x${H},format=yuv420p${END ? `,tpad=stop_mode=clone:stop_duration=${END}` : ''}[v0];\n`;
  let last = 'v0', idx = 1;
  for (const [i, c] of captions.entries()) {
    const a = c.t[0] + 0.1, b = c.t[1] - 0.1;
    inputs.push('-loop', '1', '-t', `${TOTAL}`, '-framerate', `${FPS}`, '-i', path.join(cfg.work, `cap${i}.png`));
    graph += `[${idx}:v]format=rgba,fade=in:st=${a.toFixed(3)}:d=0.15:alpha=1,fade=out:st=${(b - 0.15).toFixed(3)}:d=0.15:alpha=1[c${i}];\n` +
      `[${last}][c${i}]overlay=0:0:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})'[v${idx}];\n`;
    last = `v${idx++}`;
  }
  if (ec) {
    const st = VIDEO - 0.25;
    inputs.push('-loop', '1', '-t', `${TOTAL}`, '-framerate', `${FPS}`, '-i', path.join(cfg.work, 'endcard.png'));
    graph += `[${idx}:v]format=rgba,fade=in:st=${st.toFixed(3)}:d=0.3:alpha=1[ec];\n[${last}][ec]overlay=0:0:enable='gte(t,${st.toFixed(3)})'[v${++idx}];\n`;
    last = `v${idx}`;
  }
  graph += `[${last}]trim=duration=${TOTAL},format=yuv420p[out]`;
  const graphFile = path.join(cfg.work, 'graph.txt');
  fs.writeFileSync(graphFile, graph);
  const silent = path.join(cfg.work, 'video-silent.mp4');
  log(`composing ${TOTAL.toFixed(2)}s video (${captions.length} captions, ${segs.filter((g) => g.zoomPeak != null).length} zooms)`);
  // ffmpeg ≥ 7 reads a filtergraph file with `-/filter_complex`; older builds (e.g. Ubuntu's 6.x) need -filter_complex_script
  const major = Number((execFileSync('ffmpeg', ['-version']).toString().match(/ffmpeg version n?(\d+)/) ?? [])[1] ?? 7);
  const graphArgs = major >= 7 ? ['-/filter_complex', graphFile] : ['-filter_complex_script', graphFile];
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, ...graphArgs, '-map', '[out]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', `${FPS}`, silent]);

  // --- 6. preview contact sheet: one frame per step (at its zoom peak) + end card ------------
  // zoomed steps: at the zoom peak; others: late in the step, where its actions' result is visible
  const shots = segs.map((g) => ({ t: Math.min(g.o1 - 0.05, g.zoomPeak ?? g.o0 + (g.o1 - g.o0) * 0.8), label: `step ${g.i + 1} · ${g.o0.toFixed(1)}–${g.o1.toFixed(1)}s${g.step.zoom ? ' · zoom' : ''}`, caption: g.step.caption ?? '' }));
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
      ...tl.navs.map(toOut).filter((t) => t != null && t > 0.2),
      ...segs.filter((g) => g.afterHidden).map((g) => g.o0),
      ...(ec ? [VIDEO - 0.25] : []),
    ]),
    risers: segs.filter((g) => g.step.sfx === 'riser').map((g) => [g.o0, g.o1]),
    chimes: segs.filter((g) => g.step.sfx === 'riser' || g.step.sfx === 'chime').map((g) => g.o1),
    // narration: each line may run until the next one starts
    voice: [
      ...segs.filter((g) => g.step.say).map((g) => ({ text: g.step.say, start: g.o0 + (g.step.sayAt ?? 0.15), where: `step ${g.i + 1}` })),
      ...(ec?.say ? [{ text: ec.say, start: VIDEO + 0.05, where: 'end card' }] : []),
    ],
  };
  events.voice.forEach((v, k) => { v.until = events.voice[k + 1]?.start ?? TOTAL - 0.1; });
  fs.writeFileSync(path.join(cfg.work, 'events.json'), JSON.stringify(events, null, 1));
  log(segs.map((g) => `  ${g.o0.toFixed(1)}–${g.o1.toFixed(1)}s  step ${g.i + 1}  motion x${g.motionSpeed.toFixed(1)}  waiting x${g.waitSpeed.toFixed(1)}`).join('\n'));
  return { silent, events, preview, warnings, captions, segs: segs.map((g) => ({ i: g.i, o0: g.o0, o1: g.o1, caption: g.step.caption })) };
}
