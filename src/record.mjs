// Drive the site through the storyboard's actions and capture screencast
// frames + per-step timing, clicks, navigations and zoom-target boxes.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { describePage } from './inspect.mjs';
import { detectLogin, loginAdvice, sessionContext } from './auth.mjs';
import { certError } from './config.mjs';

// Injected into every page: fake cursor, click ripple, smooth in-page anchor scrolling.
function pageScript({ scrollOffset }) {
  const install = () => {
    if (document.getElementById('__demo_cursor')) return;
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2 L4 20 L9 15.5 L12.4 22.4 L15.6 21 L12.2 14.2 L19 14 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, {
      position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none',
      transform: `translate(${(window.__cx ?? -100) - 4}px, ${(window.__cy ?? -100) - 2}px)`,
      filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.35))',
    });
    document.documentElement.appendChild(c);
  };
  window.addEventListener('pointermove', (e) => {
    window.__cx = e.clientX; window.__cy = e.clientY;
    const c = document.getElementById('__demo_cursor');
    if (c) c.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 2}px)`;
  }, true);
  window.addEventListener('pointerdown', (e) => {
    const r = document.createElement('div');
    Object.assign(r.style, {
      position: 'fixed', left: `${e.clientX - 22}px`, top: `${e.clientY - 22}px`, width: '44px', height: '44px',
      borderRadius: '50%', background: 'rgba(99,102,241,.35)', border: '2px solid rgba(99,102,241,.8)',
      zIndex: '2147483646', pointerEvents: 'none',
    });
    document.documentElement.appendChild(r);
    r.animate([{ transform: 'scale(.2)', opacity: 1 }, { transform: 'scale(1.6)', opacity: 0 }], { duration: 550, easing: 'ease-out' })
      .onfinish = () => r.remove();
  }, true);
  // Many web apps scroll an inner container instead of the window.
  const docEl = () => document.scrollingElement || document.documentElement;
  const scrollable = (el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 10;
  const mainScroller = () => {
    if (docEl().scrollHeight > innerHeight + 10) return docEl();
    let best = docEl(), area = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (!scrollable(el)) continue;
      const a = el.clientWidth * el.clientHeight;
      if (a < innerWidth * innerHeight * 0.25) continue;
      if (a > area) { area = a; best = el; }
    }
    return best;
  };
  const scrollerFor = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (scrollable(p)) return p;
    return docEl();
  };
  window.__demoScrollBy = (dy, ms = 1200, sc = mainScroller()) => new Promise((done) => {
    const start = sc.scrollTop, t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      sc.scrollTop = start + dy * ease(k);
      if (k < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  window.__demoScrollTo = (el, ms) => {
    const sc = scrollerFor(el), top = sc === docEl() ? 0 : sc.getBoundingClientRect().top;
    return window.__demoScrollBy(el.getBoundingClientRect().top - top - scrollOffset, ms, sc);
  };
  // Tutorial callouts: spotlight a target, show a pressed key combo.
  window.__demoSpot = (r) => {
    let el = document.getElementById('__demo_spot');
    if (!el) {
      el = document.createElement('div');
      el.id = '__demo_spot';
      Object.assign(el.style, {
        position: 'fixed', zIndex: '2147483645', pointerEvents: 'none', borderRadius: '10px', opacity: '0',
        boxShadow: '0 0 0 9999px rgba(15,23,42,.42), 0 0 0 3px rgba(99,102,241,.95), 0 0 24px 6px rgba(99,102,241,.45)',
        transition: 'opacity .25s ease',
      });
      document.documentElement.appendChild(el);
    }
    const pad = 8;
    Object.assign(el.style, { left: `${r.x - pad}px`, top: `${r.y - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
    requestAnimationFrame(() => { el.style.opacity = '1'; });
  };
  window.__demoSpotOff = () => {
    const el = document.getElementById('__demo_spot');
    if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }
  };
  window.__demoKeys = (label) => {
    const el = document.createElement('div');
    el.textContent = label;
    Object.assign(el.style, {
      position: 'fixed', left: '50%', bottom: '22%', transform: 'translateX(-50%)', zIndex: '2147483646', pointerEvents: 'none',
      font: '600 30px -apple-system, "Segoe UI", sans-serif', color: '#fff', background: 'rgba(15,23,42,.88)',
      padding: '14px 26px', borderRadius: '14px', boxShadow: '0 10px 30px rgba(0,0,0,.3)', letterSpacing: '.04em',
    });
    document.documentElement.appendChild(el);
    el.animate([{ opacity: 0, transform: 'translateX(-50%) scale(.9)' }, { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.15 },
      { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 1400, easing: 'ease-out' }).onfinish = () => el.remove();
  };
  // `mark`: a highlighter sweeps over a phrase (a text Range, even across inline elements) or an
  // element, line by line. Marks follow scrolling (positions are re-read every frame).
  window.__demoFind = (phrase) => {
    const norm = (s) => s.replace(/\s+/g, ' ');
    const want = norm(phrase).trim();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest('script,style,noscript,#__demo_cursor') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let text = '';
    const map = []; // map[i] = [node, offset] for text[i]
    for (let n; (n = walker.nextNode());) {
      for (let i = 0; i < n.data.length; i++) {
        const ch = /\s/.test(n.data[i]) ? ' ' : n.data[i];
        if (ch === ' ' && text.endsWith(' ')) continue;
        text += ch; map.push([n, i]);
      }
    }
    const ranges = [];
    for (const hay of [text, text.toLowerCase()]) {
      const needle = hay === text ? want : want.toLowerCase();
      for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
        const r = document.createRange();
        const [sn, so] = map[at], [en, eo] = map[at + needle.length - 1];
        r.setStart(sn, so); r.setEnd(en, eo + 1);
        const rects = [...r.getClientRects()].filter((q) => q.width > 1 && q.height > 1);
        if (rects.length) ranges.push(r);
      }
      if (ranges.length) break;
    }
    const inView = (r) => { const q = r.getBoundingClientRect(); return q.top >= 0 && q.bottom <= innerHeight; };
    const r = ranges.find(inView) ?? ranges[0];
    if (!r) return null;
    window.__demoFound = r;
    return { inView: inView(r), count: ranges.length };
  };
  window.__demoMark = (what, { ms = 700, color, box = false }) => {
    const layer = document.getElementById('__demo_marks') ?? document.documentElement.appendChild(Object.assign(document.createElement('div'), { id: '__demo_marks' }));
    // multiply on the layer itself (its children are isolated inside it), so text under a mark stays readable
    Object.assign(layer.style, { position: 'fixed', inset: '0', zIndex: '2147483644', pointerEvents: 'none', transition: 'opacity .3s ease', mixBlendMode: 'multiply' });
    const src = what === 'found' ? window.__demoFound : window.__demoMarkEl;
    const rectsOf = () => {
      const all = what === 'found' ? [...src.getClientRects()] : [src.getBoundingClientRect()];
      // one rect per line: merge the pieces of inline elements that sit on the same line
      const lines = [];
      for (const q of all.filter((q) => q.width > 1 && q.height > 1)) {
        const l = lines.find((l) => Math.abs(l.top - q.top) < q.height * 0.5);
        if (l) { l.left = Math.min(l.left, q.left); l.right = Math.max(l.right, q.right); l.top = Math.min(l.top, q.top); l.bottom = Math.max(l.bottom, q.bottom); }
        else lines.push({ left: q.left, right: q.right, top: q.top, bottom: q.bottom });
      }
      return lines;
    };
    const first = rectsOf();
    const total = first.reduce((s, q) => s + q.right - q.left, 0) || 1;
    let delay = 0;
    const els = first.map((q) => {
      const el = document.createElement('div');
      Object.assign(el.style, box
        ? { position: 'fixed', borderRadius: '8px', background: `${color}88`, boxShadow: `0 0 0 2px color-mix(in srgb, ${color} 55%, #000)`, clipPath: 'inset(0 100% 0 0)' }
        : { position: 'fixed', borderRadius: '3px', background: color, opacity: '.9', clipPath: 'inset(0 100% 0 0)' });
      layer.appendChild(el);
      const d = ms * (q.right - q.left) / total;
      el.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: d, delay, easing: 'ease-in-out', fill: 'forwards' });
      delay += d;
      return el;
    });
    const place = () => {
      if (!els[0]?.isConnected) return;
      rectsOf().forEach((q, i) => {
        const el = els[i]; if (!el) return;
        const pad = box ? 6 : 2;
        Object.assign(el.style, { left: `${q.left - pad}px`, top: `${q.top - (box ? pad : 0)}px`, width: `${q.right - q.left + 2 * pad}px`, height: `${q.bottom - q.top + (box ? 2 * pad : 0)}px` });
      });
      requestAnimationFrame(place);
    };
    place();
    const u = first.reduce((a, q) => ({ x: Math.min(a.x, q.left), y: Math.min(a.y, q.top), r: Math.max(a.r, q.right), b: Math.max(a.b, q.bottom) }), { x: 1e9, y: 1e9, r: -1e9, b: -1e9 });
    return { x: u.x, y: u.y, width: u.r - u.x, height: u.b - u.y };
  };
  window.__demoUnmark = () => {
    const layer = document.getElementById('__demo_marks');
    if (layer) { layer.style.opacity = '0'; setTimeout(() => layer.remove(), 300); }
  };
  // in-page anchor links scroll smoothly instead of jumping
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="#"]');
    const el = a && document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    window.__demoScrollTo(el, 1300);
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
  setInterval(install, 300);
}

// --- locators ------------------------------------------------------------------------
const OPTION_KEYS = new Set(['ms', 'offset', 'timeout', 'highlight', 'color', 'box']);
// All elements matching a target spec (visible or not).
function locateAll(page, spec) {
  if (typeof spec === 'string') return page.locator(spec);
  const exact = spec.exact ?? false;
  let l;
  if (spec.role) l = page.getByRole(spec.role, spec.name ? { name: spec.name, exact } : {});
  else if (spec.text) l = page.getByText(spec.text, { exact });
  else if (spec.label) l = page.getByLabel(spec.label, { exact });
  else if (spec.placeholder) l = page.getByPlaceholder(spec.placeholder, { exact });
  else if (spec.alt) l = page.getByAltText(spec.alt, { exact });
  else if (spec.testId) l = page.getByTestId(spec.testId);
  else if (spec.css) l = page.locator(spec.css);
  else throw new Error(`cannot build a locator from ${JSON.stringify(spec)}`);
  return l;
}
// The single element a target refers to: only visible matches count, so hidden
// duplicates (closed menus, <option>s, responsive copies) are never picked.
export function locate(page, spec) {
  const l = locateAll(page, spec).filter({ visible: true });
  if (typeof spec === 'string') return l.first();
  if (spec.last) return l.last();
  if (spec.nth != null) return l.nth(spec.nth);
  return l.first();
}
const isPoint = (v) => v && typeof v === 'object' && typeof v.x === 'number' && typeof v.y === 'number' && !v.role && !v.css && !v.text;

// inspectAfter: N → don't record; run setup + steps 1..N quickly, then describe the page as
// it is at that moment (for states only reachable through the flow, e.g. an editor after upload).
export async function record(cfg, { log = console.log, inspectAfter = null } = {}) {
  const fast = inspectAfter != null;
  const RAW = path.join(cfg.work, 'raw');
  fs.mkdirSync(cfg.work, { recursive: true });
  if (!fast) {
    fs.rmSync(RAW, { recursive: true, force: true });
    fs.mkdirSync(RAW, { recursive: true });
  }
  const { width: VW, height: VH } = cfg.viewport;

  const browser = await chromium.launch();
  const context = await sessionContext(browser, {
    viewport: cfg.viewport, deviceScaleFactor: cfg.scale, colorScheme: cfg.colorScheme, storageState: cfg.storageState, ignoreHTTPSErrors: cfg.ignoreHTTPSErrors,
  });
  await context.addInitScript(pageScript, { scrollOffset: cfg.scrollOffset });
  const page = await context.newPage();
  const sleep = (ms) => page.waitForTimeout(ms);
  const now = () => Date.now() / 1000;

  // --- cursor ---------------------------------------------------------------------
  let cur = { x: VW * 0.62, y: VH * 0.55 };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  async function moveTo(x, y, ms = 700) {
    if (fast) ms = 40;
    const from = { ...cur }, steps = Math.max(8, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
      await sleep(ms / steps);
    }
    cur = { x, y };
  }
  const nudge = () => page.mouse.move(cur.x, cur.y);
  const clicks = [];
  async function press() { clicks.push(now()); await page.mouse.down(); await sleep(70); await page.mouse.up(); }
  // Time spent waiting on the page (loads, AI processing…) is tracked separately so
  // compose can compress it hard while keeping cursor motion at a natural speed.
  let waits = [], holds = 0;
  async function waiting(fn) {
    const start = now();
    try { return await fn(); } finally { waits.push([start, now()]); }
  }
  // After anything that may load new content, wait (as compressible waiting time) until the
  // images on screen have loaded and decoded, so the video never shows empty image boxes.
  async function settle(ms = 5000) {
    await waiting(() => page.evaluate(async (ms) => {
      const tick = (t) => new Promise((r) => setTimeout(r, t));
      const onScreen = (e) => { const r = e.getBoundingClientRect(); return r.width > 24 && r.height > 24 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
      const pending = () => [...document.images].filter((i) => onScreen(i) && !i.complete);
      const end = performance.now() + ms;
      await tick(150); // let a click's new view render first
      let quiet = 0;
      while (performance.now() < end && quiet < 2) { quiet = pending().length ? 0 : quiet + 1; await tick(120); }
      await Promise.race([Promise.all([...document.images].filter(onScreen).map((i) => i.decode?.().catch(() => {}))), tick(1000)]);
    }, ms).catch(() => {}));
  }
  // where the step's subjects (click/move/type/drag targets) are, so compose can keep captions off them
  let marks = [];
  // stable key for a locator spec, so a zoom target can reuse the box of an action's target
  const keyOf = (spec) => JSON.stringify(Object.keys(spec).sort().map((k) => [k, spec[k]]));
  let boxes = new Map();
  async function pointOf(spec, opt, timeout = opt.timeout ?? 15000) {
    if (isPoint(spec)) {
      const p = { x: spec.x <= 1 ? spec.x * VW : spec.x, y: spec.y <= 1 ? spec.y * VH : spec.y };
      marks.push({ t: now(), box: { x: p.x - 16, y: p.y - 16, width: 32, height: 32 } });
      return p;
    }
    const l = locate(page, spec);
    await waiting(() => l.waitFor({ state: 'visible', timeout }));
    await l.scrollIntoViewIfNeeded();
    const b = await l.boundingBox();
    boxes.set(keyOf(spec), b);
    marks.push({ t: now(), box: b });
    const o = opt.offset ?? { x: 0.5, y: 0.5 };
    return { x: b.x + b.width * o.x, y: b.y + b.height * o.y, box: b };
  }
  const split = (v) => {
    if (v == null || typeof v !== 'object') return [v, {}];
    const spec = {}, opt = {};
    for (const [k, x] of Object.entries(v)) (OPTION_KEYS.has(k) ? opt : spec)[k] = x;
    return [spec, opt];
  };

  let stepHighlight = false;
  // spotlight the target while the cursor travels to it (tutorial purposes)
  async function spot(box, on) {
    if (!on || !box) return false;
    await page.evaluate((r) => window.__demoSpot(r), box).catch(() => {});
    await sleep(280);
    return true;
  }
  const spotOff = () => page.evaluate(() => window.__demoSpotOff()).catch(() => {});
  const keyLabel = (k) => k.split('+').map((p) => ({ Meta: '⌘', ControlOrMeta: '⌘', Control: 'Ctrl', Shift: '⇧', Alt: '⌥', Enter: '↵ Enter', Escape: 'Esc', Backspace: '⌫', Tab: '⇥ Tab' })[p] ?? (p.length === 1 ? p.toUpperCase() : p)).join(' ');

  async function runAction(action) {
    const [kind, value] = Object.entries(action)[0];
    const [spec, opt] = split(value);
    const hl = value?.highlight ?? stepHighlight;
    switch (kind) {
      case 'pause': case 'wait': holds += Number(value) / 1000; if (!fast) await sleep(Number(value)); break;
      case 'move': case 'hover': {
        const p = await pointOf(spec, opt);
        await spot(p.box, value?.highlight === true); // stays on until the step ends
        await moveTo(p.x, p.y, opt.ms ?? 700);
        break;
      }
      case 'click': {
        const p = await pointOf(spec, opt);
        const lit = await spot(p.box, hl);
        await moveTo(p.x, p.y, opt.ms ?? 700);
        await sleep(lit ? 350 : 120);
        await press();
        if (lit) { await sleep(150); await spotOff(); }
        await settle();
        break;
      }
      case 'dismiss': {
        const l = locate(page, spec);
        if (await l.isVisible().catch(() => false)) { await l.click(); await sleep(400); }
        break;
      }
      case 'waitFor': await waiting(() => locate(page, spec).waitFor({ state: 'visible', timeout: opt.timeout ?? 180000 })); await settle(); await nudge(); break;
      case 'waitForUrl': await waiting(() => page.waitForURL(value, { timeout: 60000 })); await settle(); await nudge(); break;
      case 'networkIdle': await waiting(() => page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})); await settle(); break;
      case 'goto': await waiting(() => page.goto(new URL(value, cfg.url).href, { waitUntil: 'domcontentloaded' })); await settle(); await nudge(); break;
      case 'scrollTo': {
        const h = await locate(page, spec).elementHandle({ timeout: opt.timeout ?? 15000 });
        await page.evaluate(([el, ms]) => window.__demoScrollTo(el, ms), [h, opt.ms ?? 1200]);
        break;
      }
      case 'scroll': await page.evaluate(([dy, ms]) => window.__demoScrollBy(dy, ms), [value.y ?? value, value.ms ?? 1000]); break;
      case 'type': {
        // type: "text" or { text } types into whatever has focus; { target, text } clicks the target first
        const v = typeof value === 'object' ? value : { text: value };
        let lit = false;
        if (v.target) {
          const p = await pointOf(v.target, v);
          lit = await spot(p.box, hl);
          await moveTo(p.x, p.y, v.ms ?? 600);
          await press();
        }
        await page.keyboard.type(String(v.text), { delay: fast ? 0 : v.delay ?? 55 });
        if (lit) await spotOff();
        break;
      }
      case 'drag': {
        // drag: { from: <target>, to: <target or point> } or { from, by: { x, y } } or by: [ {x}, {x} ] (several moves while held)
        const from = await pointOf(value.from, value);
        await moveTo(from.x, from.y, value.ms ?? 600);
        await sleep(150);
        clicks.push(now());
        await page.mouse.down();
        const hops = value.to ? [await pointOf(value.to, {})] : [].concat(value.by ?? []).reduce((acc, d) => {
          const p = acc.at(-1) ?? from;
          return [...acc, { x: p.x + (d.x ?? 0), y: p.y + (d.y ?? 0) }];
        }, []);
        for (const h of hops) { await moveTo(h.x, h.y, value.dragMs ?? 900); await sleep(150); }
        await page.mouse.up();
        break;
      }
      case 'mark': {
        // mark: "a phrase" | { text: "a phrase" } (a text range, even inside a paragraph) | any target
        // (e.g. a table row: { css: "tr:nth-child(3)" }) → highlighter sweep, kept until the step ends
        const v = typeof value === 'string' ? { text: value } : spec;
        const ms = fast ? 0 : opt.ms ?? 700, color = opt.color ?? cfg.theme.accent;
        let box = null;
        const phraseOnly = v.text && Object.keys(v).every((k) => ['text', 'exact'].includes(k));
        if (phraseOnly) {
          const found = await page.evaluate((t) => window.__demoFind(t), v.text);
          if (found && !found.inView) {
            await page.evaluate((ms) => window.__demoScrollTo(window.__demoFound.startContainer.parentElement, ms), fast ? 0 : 900);
            await sleep(fast ? 50 : 950);
          }
          if (found) box = await page.evaluate(([ms, color, b]) => window.__demoMark('found', { ms, color, box: b }), [ms, color, opt.box ?? false]);
        }
        if (!box) {
          const l = locate(page, v);
          await waiting(() => l.waitFor({ state: 'visible', timeout: opt.timeout ?? 15000 }));
          await l.scrollIntoViewIfNeeded();
          await l.evaluate((el) => { window.__demoMarkEl = el; });
          box = await page.evaluate(([ms, color, b]) => window.__demoMark('el', { ms, color, box: b }), [ms, color, opt.box ?? !phraseOnly]);
        }
        marks.push({ t: now(), box });
        boxes.set(keyOf(v), box);
        await sleep(ms + (fast ? 0 : 300)); // let the sweep finish on screen
        break;
      }
      case 'unmark': await page.evaluate(() => window.__demoUnmark()).catch(() => {}); break;
      case 'press': {
        const key = typeof value === 'object' ? value.key : String(value);
        // on-screen key badge: shortcuts and special keys only (not plain characters), when highlighting
        const show = value?.show ?? (hl && (key.includes('+') || key.length > 1));
        if (show && !fast) await page.evaluate((l) => window.__demoKeys(l), keyLabel(key)).catch(() => {});
        await page.keyboard.press(key);
        await sleep(200);
        if (key === 'Enter') await settle();
        break;
      }
      default: throw new Error(`unknown action "${kind}"`);
    }
  }

  // --- setup (not recorded) -----------------------------------------------------------
  // Run a list of actions; on failure, say exactly which one and save a screenshot.
  async function runAll(actions, where) {
    for (const [j, a] of actions.entries()) {
      try { await runAction(a); } catch (e) {
        const shot = path.join(cfg.work, 'error.jpg');
        await page.screenshot({ path: shot, quality: 80 }).catch(() => {});
        // How did the target match? (nothing / only hidden elements / fine but something else failed)
        const [kind, value] = Object.entries(a)[0];
        const target = kind === 'type' ? value?.target : kind === 'drag' ? value?.from : split(value)[0];
        let matches = '';
        if (target && (typeof target === 'string' || (typeof target === 'object' && !isPoint(target) && Object.keys(target).length))) {
          try {
            const all = locateAll(page, target), total = await all.count(), vis = await all.filter({ visible: true }).count();
            matches = `\n  target matches ${total} element(s), ${vis} visible` + (total && !vis
              ? ' — it exists but is hidden (inside a closed menu, <select>, or another state); target something visible instead'
              : !total ? ' — nothing matches; pick a target from the list below' : '');
          } catch {}
        }
        // List what *is* clickable on the page at this moment (works for pages only reachable through the flow).
        const pageFile = path.join(cfg.work, 'error-page.txt');
        const desc = await describePage(page, cfg.viewport, { maxElements: 60 }).catch(() => null);
        const lw = await detectLogin(page).catch(() => ({})), loginWall = lw.wall ? lw.reason : null;
        if (desc) fs.writeFileSync(pageFile, desc.text);
        await browser.close().catch(() => {});
        const err = new Error(`${where}, action ${j + 1} (${kind}: ${JSON.stringify(value)}) failed: ` +
          `${e.message.split('\n')[0]}${matches}\n  page: ${page.url()}\n  screenshot of the moment it failed: ${shot}` +
          (loginWall ? `\n  ⚠ the page is asking to log in (${loginWall}) — ${cfg.storageState ? 'the saved session has probably expired; run login again' : loginAdvice(cfg.url)}` : '') +
          (desc ? `\n  targets on the page at that moment: ${pageFile}` : ''));
        err.screenshot = shot;
        err.pageDescription = desc?.text;
        throw err;
      }
    }
  }

  log(`opening ${cfg.url}`);
  await page.goto(cfg.url, { waitUntil: 'networkidle' }).catch(() => page.goto(cfg.url)).catch((e) => { throw certError(e, cfg.url) ?? e; });
  // sent to a login page instead of the start url → no (valid) session
  if (new URL(page.url()).pathname !== new URL(cfg.url).pathname || cfg.storageState) {
    const d = await detectLogin(page);
    if (d.wall) {
      await browser.close();
      throw new Error(cfg.storageState
        ? `the saved login (${cfg.storageState}) has expired: ${cfg.url} shows a login page (${page.url()}). Run \`storyshot login ${cfg.url} --save ${cfg.storageState}\` (MCP: login) again.`
        : `${cfg.url} needs a login: it redirected to ${page.url()}. ${loginAdvice(cfg.url)}`);
    }
  }
  await runAll(cfg.setup, 'setup');
  for (const [card, file] of [[cfg.endCard, 'logo.png'], [cfg.intro, 'intro-logo.png']]) {
    if (!card?.logo || card.logoFile) continue;
    await locate(page, card.logo).screenshot({ path: path.join(cfg.work, file), omitBackground: true, timeout: 5000 })
      .catch((e) => log(`warning: could not capture logo (${e.message.split('\n')[0]})`));
  }
  await nudge();
  await sleep(600);

  if (fast) {
    const n = Math.min(inspectAfter, cfg.steps.length);
    for (const [i, s] of cfg.steps.slice(0, n).entries()) {
      stepHighlight = false;
      await runAll(s.actions, `step ${i + 1}`);
    }
    await sleep(800);
    const shot = path.join(cfg.work, `inspect-after-${n}.jpg`);
    await page.screenshot({ path: shot, quality: 80, scale: 'css' });
    const desc = await describePage(page, cfg.viewport);
    await browser.close();
    return { text: `State after ${n ? `step ${n}` : 'setup'} of ${cfg.name}:\n${desc.text}\n\nScreenshot: ${shot}`, screenshot: shot };
  }

  // --- recording ----------------------------------------------------------------------
  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(RAW, file), Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  const navs = [];
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs.push(now()); });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg', quality: 92, maxWidth: cfg.output.width, maxHeight: cfg.output.height, everyNthFrame: 1,
  });
  await sleep(300);

  const steps = [];
  for (const [i, s] of cfg.steps.entries()) {
    const start = now();
    waits = []; holds = 0; boxes = new Map(); marks = [];
    stepHighlight = s.highlight ?? cfg.highlight;
    // Measure the zoom target now too: the step's actions may navigate away from it.
    const boxNow = async () => {
      const l = locate(page, s.zoom.target);
      return (await l.isVisible().catch(() => false)) ? l.boundingBox({ timeout: 1000 }).catch(() => null) : null;
    };
    const zoomTarget = s.zoom?.target && !isPoint(s.zoom.target);
    const startBox = zoomTarget ? await boxNow() : null;
    await runAll(s.actions, `step ${i + 1}`);
    const end = now(); // before clearing: a step that is held for its narration keeps its marks
    await spotOff();
    await page.evaluate(() => window.__demoUnmark()).catch(() => {});
    let zoomBox = null;
    if (s.zoom?.target) {
      if (isPoint(s.zoom.target)) {
        const p = await pointOf(s.zoom.target, {});
        zoomBox = { x: p.x, y: p.y, width: 0, height: 0 };
      } else {
        // prefer: where an action used it > where it was when the zoom happens (start or end of step)
        const early = (s.zoom.start ?? 0) < (s.duration ?? 0) / 2;
        const endBox = await boxNow();
        zoomBox = boxes.get(keyOf(s.zoom.target)) ?? (early ? startBox ?? endBox : endBox ?? startBox);
      }
    }
    steps.push({ start, end, hidden: !!s.hidden, zoomBox, zoomTarget: s.zoom?.target ?? null, waits, holds, marks });
    log(`step ${i + 1}/${cfg.steps.length}${s.hidden ? ' (hidden)' : ''}: ${(now() - start).toFixed(1)}s raw${s.caption ? ` — ${s.caption}` : ''}`);
  }
  await sleep(300);
  await cdp.send('Page.stopScreencast');
  await browser.close();

  const timeline = { frames, steps, clicks, navs, scale: cfg.scale };
  fs.writeFileSync(path.join(cfg.work, 'timeline.json'), JSON.stringify(timeline, null, 1));
  log(`recorded ${frames.length} frames`);
  return timeline;
}
