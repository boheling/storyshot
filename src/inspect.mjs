// Describe a page for an agent writing a storyboard: headings, anchor sections,
// interactive elements with verified YAML targets, internal pages, screenshots.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { detectLogin, loginAdvice } from './auth.mjs';

// Runs in the page. Positions are relative to the top of the main scrolling content,
// which may be the window or an inner scroll container (common in web apps).
function collect() {
  const NATIVE = 'a[href], button, [role=button], [role=tab], [role=link], [role=menuitem], [role=option], input:not([type=hidden]), select, textarea, summary, label, ' +
    '[contenteditable=""], [contenteditable=true], [role=textbox], [role=searchbox], [role=combobox], [role=slider], [role=switch], [role=checkbox]';
  // skip ad slots — they flood the list on some sites
  const isAd = (el) => {
    for (let p = el, k = 0; p && k < 8; p = p.parentElement, k++) {
      if (p.tagName === 'INS' || /(^|[\s_-])(ads?|advert\w*|adsbygoogle|sponsor(ed)?|carbonads)([\s_-]|$)/i.test(`${p.id} ${typeof p.className === 'string' ? p.className : ''}`)) return true;
    }
    return false;
  };
  const vis = (el) => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05;
  };
  const docScrolls = document.documentElement.scrollHeight > innerHeight + 10;
  let scroller = null;
  if (!docScrolls) {
    let best = 0;
    for (const el of document.querySelectorAll('body *')) {
      const s = getComputedStyle(el);
      if (!/(auto|scroll)/.test(s.overflowY) || el.scrollHeight <= el.clientHeight + 10) continue;
      const area = el.clientWidth * el.clientHeight;
      if (area < innerWidth * innerHeight * 0.25) continue;
      if (area > best) { best = area; scroller = el; }
    }
  }
  const scrollTop = scroller ? scroller.scrollTop : scrollY;
  const pos = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollTop), w: Math.round(r.width), h: Math.round(r.height),
      cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2), css: cssOf(el) };
  };
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  // a short CSS selector (tag + classes, or #id) — the last-resort target when names don't resolve
  const cssOf = (el) => {
    if (el.id && !/^[0-9:]|:/.test(el.id)) return `#${CSS.escape(el.id)}`;
    const cls = [...el.classList].filter((c) => !/^(css|sc|jsx|svelte|tw)-|\d{3,}|__/.test(c)).slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('');
    return cls ? `${el.tagName.toLowerCase()}${cls}` : null;
  };
  const nameOf = (el) => clean(el.getAttribute('aria-label')) ||
    clean([...(el.getAttribute('aria-labelledby') || '').split(' ')].map((id) => document.getElementById(id)?.innerText).join(' ')) ||
    clean(el.innerText) || clean(el.getAttribute('title')) || clean(el.querySelector('img')?.alt) ||
    clean(el.getAttribute('placeholder')) || clean(el.value);
  const roleOf = (el) => {
    const r = el.getAttribute('role'); if (r) return r;
    const t = el.tagName.toLowerCase();
    if (t === 'a') return 'link';
    if (t === 'button' || t === 'summary') return 'button';
    if (t === 'select') return 'combobox';
    if (t === 'textarea' || el.isContentEditable) return 'textbox';
    if (t === 'input') return ({ checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button', range: 'slider', search: 'searchbox', file: 'button' })[el.type] || 'textbox';
    return t;
  };
  // editors (contenteditable, CodeMirror…): name them by label/placeholder, never by their (long) content
  const editorName = (el) => clean(el.getAttribute('aria-label')) || clean(el.getAttribute('placeholder')) || clean(el.getAttribute('aria-placeholder')) ||
    clean(el.closest('label')?.innerText) || '';
  const interactive = [...document.querySelectorAll(NATIVE)]
    .filter((el) => vis(el) && el.tagName !== 'LABEL' && !isAd(el) && !(el.isContentEditable && el.parentElement?.isContentEditable))
    .map((el) => ({ kind: 'role', role: roleOf(el), name: (el.isContentEditable || el.tagName === 'TEXTAREA' ? editorName(el) : nameOf(el)).slice(0, 80), shows: clean(el.innerText).slice(0, 60), alt: clean(el.querySelector('img[alt]')?.alt) || null, href: el.getAttribute('href'), label: el.labels?.[0] ? clean(el.labels[0].innerText) : null, ...pos(el) }));
  // custom clickables: outermost cursor:pointer elements that aren't native controls
  const pointer = [];
  for (const el of document.querySelectorAll('body *')) {
    if (pointer.length >= 40) break;
    if (el.closest(NATIVE) || el.querySelector(NATIVE) || !vis(el) || isAd(el)) continue;
    if (getComputedStyle(el).cursor !== 'pointer' || (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer')) continue;
    const img = el.tagName === 'IMG' ? el : el.querySelector('img[alt]');
    pointer.push({ kind: 'pointer', alt: img?.alt ? clean(img.alt).slice(0, 80) : null, name: clean(el.innerText).slice(0, 80), ...pos(el) });
  }
  return {
    title: document.title,
    height: scroller ? scroller.scrollHeight : document.documentElement.scrollHeight,
    scroller: scroller ? (scroller.id ? `#${scroller.id}` : scroller.tagName.toLowerCase() + (scroller.className && typeof scroller.className === 'string' ? '.' + scroller.className.trim().split(/\s+/)[0] : '')) : null,
    headings: [...document.querySelectorAll('h1, h2, h3')].filter(vis).map((h) => ({ tag: h.tagName.toLowerCase(), text: clean(h.innerText).slice(0, 100), ...pos(h) })),
    anchors: [...document.querySelectorAll('[id]')].filter((el) => vis(el) && el !== scroller && el.getBoundingClientRect().height > 150 &&
      el.getBoundingClientRect().height < document.documentElement.scrollHeight * 0.8 && !/^(__|radix|headlessui|:)/.test(el.id))
      .map((el) => ({ id: el.id, ...pos(el) })).slice(0, 30),
    images: [...document.querySelectorAll('img[alt]')].filter((el) => vis(el) && el.alt.trim()).map((el) => ({ alt: clean(el.alt).slice(0, 80), ...pos(el) })).slice(0, 30),
    interactive: [...interactive, ...pointer],
  };
}

const yaml = (t) => (typeof t === 'string' ? JSON.stringify(t) : `{ ${Object.entries(t).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')} }`);

// Describe the page as it is right now. Shared by `inspect` and failure diagnostics.
export async function describePage(page, viewport, { maxElements = 80 } = {}) {
  const info = await page.evaluate(collect);
  const seen = new Set(), elements = [];
  const verify = async (locator, spec, el) => {
    const visible = locator.filter({ visible: true });
    const n = await visible.count().catch(() => 0);
    if (n === 1) return spec;
    if (n > 1) {
      // pick the match whose box is where we saw the element
      const xs = await visible.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width)]; })).catch(() => []);
      const k = xs.findIndex(([x, , w]) => Math.abs(x - el.x) <= 2 && Math.abs(w - el.w) <= 2);
      if (k >= 0) return { ...spec, nth: k };
    }
    return null;
  };
  for (const el of info.interactive) {
    if (elements.length >= maxElements) break;
    const key = `${el.role ?? el.alt}|${el.name}|${el.x}|${el.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let target = null;
    if (el.kind === 'role') {
      // our name guess can differ from the browser's accessible name, so fall back gracefully
      if (el.name) target = await verify(page.getByRole(el.role, { name: el.name, exact: true }), { role: el.role, name: el.name, exact: true }, el);
      if (!target && el.alt) target = await verify(page.getByAltText(el.alt, { exact: true }), { alt: el.alt, exact: true }, el);
      if (!target && el.name) target = await verify(page.getByRole(el.role, { name: el.name }), { role: el.role, name: el.name }, el);
      if (!target && el.name) target = await verify(page.getByText(el.name, { exact: true }), { text: el.name, exact: true }, el);
      if (!target && el.label) target = { label: el.label };
      if (!target && el.role === 'link' && el.href) target = `a[href="${el.href}"]`;
    } else {
      if (el.alt) target = await verify(page.getByAltText(el.alt, { exact: true }), { alt: el.alt, exact: true }, el);
      if (!target && el.name) target = await verify(page.getByText(el.name, { exact: true }), { text: el.name, exact: true }, el);
    }
    if (!target && el.css) target = await verify(page.locator(el.css), { css: el.css }, el);
    if (target) elements.push({ ...el, target });
  }

  const url = page.url(), origin = new URL(url).origin;
  const internal = [...new Set(info.interactive.filter((e) => e.href && !e.href.startsWith('#'))
    .map((e) => { try { const u = new URL(e.href, url); return u.origin === origin ? u.pathname : null; } catch { return null; } })
    .filter((p) => p && p !== new URL(url).pathname))].slice(0, 40);
  const fold = (y) => (y < viewport.height ? ' ' : '↓');
  // the accessible name (what targets match) can differ from the label you see on screen
  const shows = (e) => (e.shows && typeof e.target === 'object' && e.target.name && e.shows !== e.target.name ? `  (on screen: "${e.shows}")` : '');
  const lines = [
    `# ${info.title}`,
    `URL: ${url}`,
    `Viewport ${viewport.width}x${viewport.height} CSS px (screenshots use the same pixels; "at (x, y)" = element centre right now, usable as a point target { x, y }); scrollable content ${info.height}px tall` +
      (info.scroller ? ` — the page scrolls inside the container ${info.scroller}, not the window (scroll/scrollTo handle this)` : '') +
      '. y = px from the top of the content; ↓ = below the fold (needs scrolling, which click/move do automatically).',
    '',
    '## Headings',
    ...info.headings.map((h) => `${fold(h.y)} y=${h.y}\t${h.tag}  "${h.text}"`),
    '',
    '## Sections with ids (scrollTo: { css: "#id" } or in-page links)',
    ...(info.anchors.length ? info.anchors.map((a) => `${fold(a.y)} y=${a.y}\t#${a.id}  (${a.h}px tall)`) : ['(none)']),
    '',
    '## Clickable elements — verified targets (each matches exactly one visible element) for click/move/zoom',
    '   Copy targets exactly; `name` is the accessible name, which may differ from the on-screen label.',
    ...elements.map((e) => `${fold(e.y)} y=${e.y}\tat (${e.cx}, ${e.cy})\t${yaml(e.target)}${e.role === 'textbox' ? `  (text input ${e.w}×${e.h} — click it, then \`type: …\`)` : shows(e)}${e.href ? `  → ${e.href}` : ''}${e.kind === 'pointer' ? '  (custom clickable)' : ''}`),
    '',
    '## Images with alt text (target: { alt: "..." })',
    ...(info.images.length ? info.images.map((i) => `${fold(i.y)} y=${i.y}\t"${i.alt}"`) : ['(none)']),
    '',
    '## Internal pages linked from here (inspect them too)',
    internal.length ? internal.join('  ') : '(none)',
  ];
  return { text: lines.join('\n'), height: info.height, title: info.title, url, headings: info.headings, anchors: info.anchors, elements };
}

export async function inspect(url, { viewport = { width: 1600, height: 900 }, storageState, outDir = '.storyshot/inspect', maxElements = 80 } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, storageState });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => page.waitForLoadState('domcontentloaded'));
  await page.waitForTimeout(1500); // let late toasts / banners appear so they get listed

  const desc = await describePage(page, viewport, { maxElements });
  const login = await detectLogin(page);
  const { height } = desc;
  const text = (login.wall
    ? `⚠ LOGIN REQUIRED: ${login.reason}${storageState ? ' — even with the saved session, so it has probably expired' : ''}.\n  ${loginAdvice(url)}\n  Don't write steps that type a password.\n\n`
    : login.hint ? `ℹ Login: ${login.hint}. If the flow the user wants is behind it: ${loginAdvice(url)}\n\n` : '') + desc.text;
  const u = new URL(page.url());
  const slug = (u.host + u.pathname).replace(/[^\w.-]+/g, '_').replace(/_$/, '');
  fs.mkdirSync(outDir, { recursive: true });
  const shotViewport = path.resolve(outDir, `${slug}.jpg`);
  const shotFull = path.resolve(outDir, `${slug}.full.jpg`);
  await page.screenshot({ path: shotViewport, quality: 80 });
  await page.screenshot({ path: shotFull, quality: 70, fullPage: true, clip: { x: 0, y: 0, width: viewport.width, height: Math.min(height, 8000) } }).catch(() => {});
  await browser.close();
  return { ...desc, login, text: `${text}\n\nScreenshots: ${shotViewport} (viewport), ${shotFull} (full page)`, screenshot: shotViewport, fullScreenshot: shotFull };
}
