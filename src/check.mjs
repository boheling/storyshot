// Fast storyboard lint (no browser): catches typos and shape errors before a 1–3 minute render.
import fs from 'node:fs';
import YAML from 'yaml';
import { loadConfig } from './config.mjs';
import { gitIgnored } from './auth.mjs';

const TOP = ['name', 'url', 'out', 'purpose', 'viewport', 'output', 'theme', 'music', 'voice', 'sfx', 'storageState', 'ignoreHTTPSErrors', 'intro', 'frame', 'pace', 'follow', 'article', 'cards', 'lang', 'colorScheme',
  'scrollOffset', 'captionPosition', 'highlight', 'stepNumbers', 'subtitles', 'chapters', 'clips', 'maxWait', 'setup', 'steps', 'end_card'];
const STEP = ['caption', 'say', 'sayAt', 'duration', 'zoom', 'actions', 'hidden', 'sfx', 'highlight', 'captionPosition', 'card', 'follow', 'doc'];
const ZOOM = ['target', 'scale', 'start', 'end', 'ramp', 'offset'];
const END = ['logo', 'title', 'subtitle', 'cta', 'duration', 'say', 'kicker', 'bullets', 'image', 'think'];
const TARGET = ['role', 'name', 'text', 'label', 'placeholder', 'alt', 'testId', 'css', 'exact', 'last', 'nth'];
const OPTS = ['ms', 'offset', 'timeout', 'highlight', 'color', 'box'];
const ACTIONS = {
  pause: 'number', wait: 'number', move: 'target', hover: 'target', click: 'target', dblclick: 'target', dismiss: 'target', waitFor: 'target',
  waitForUrl: 'string', networkIdle: 'any', goto: 'string', scrollTo: 'target', scroll: 'any', type: 'type', drag: 'drag', press: 'any',
  mark: 'mark', unmark: 'any', note: 'note', select: 'select', hide: 'any', slide: 'slide', paste: 'type',
};

const dist = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
};
const near = (word, list) => {
  const best = list.map((w) => [w, dist(word.toLowerCase(), w.toLowerCase())]).sort((x, y) => x[1] - y[1])[0];
  return best && best[1] <= Math.max(1, Math.floor(word.length / 3)) ? best[0] : null;
};
const isPoint = (v) => v && typeof v === 'object' && typeof v.x === 'number' && typeof v.y === 'number';

export function check(file, { draft = false } = {}) {
  const errors = [], warnings = [];
  const unknown = (obj, allowed, where) => {
    for (const k of Object.keys(obj ?? {})) {
      if (!allowed.includes(k)) {
        const guess = near(k, allowed);
        errors.push(`${where}: unknown field "${k}"${guess ? ` — did you mean "${guess}"?` : ` (allowed: ${allowed.join(', ')})`}`);
      }
    }
  };
  const target = (t, where) => {
    if (typeof t === 'string') return;
    if (!t || typeof t !== 'object') return errors.push(`${where}: target must be a selector string or an object like { role: button, name: Save }`);
    if (isPoint(t)) return;
    const kinds = ['role', 'text', 'label', 'placeholder', 'alt', 'testId', 'css'].filter((k) => k in t);
    if (!kinds.length) errors.push(`${where}: target needs one of role, text, label, placeholder, alt, testId, css (or a point { x, y })`);
    if (kinds.length > 1) errors.push(`${where}: target has ${kinds.join(' + ')} — use only one`);
    if ('name' in t && !('role' in t)) errors.push(`${where}: "name" only works together with "role"`);
    unknown(t, [...TARGET, ...OPTS, 'x', 'y'], where);
  };

  let raw;
  try { raw = YAML.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    return { ok: false, errors: [`YAML syntax: ${e.message.split('\n')[0]}`], warnings, summary: '' };
  }
  unknown(raw, TOP, 'top level');
  for (const [i, a] of (raw.setup ?? []).entries()) checkAction(a, `setup action ${i + 1}`);
  for (const [i, s] of (raw.steps ?? []).entries()) {
    const where = `step ${i + 1}`;
    unknown(s, STEP, where);
    if (s.zoom) {
      unknown(s.zoom, ZOOM, `${where} zoom`);
      if (!s.zoom.target) errors.push(`${where} zoom: needs a target`);
      else target(s.zoom.target, `${where} zoom.target`);
    }
    if (s.hidden && (s.caption || s.say)) warnings.push(`${where}: hidden steps are cut from the video, so caption/say are ignored`);
    if (!Array.isArray(s.actions ?? [])) errors.push(`${where}: actions must be a list`);
    for (const [j, a] of (s.actions ?? []).entries()) checkAction(a, `${where} action ${j + 1}`);
    if (s.card) unknown(s.card, END, `${where} card`);
    // tutorials: one thing per step, so the viewer can follow (and the narration can explain it)
    const purpose = raw.purpose ?? 'pitch';
    if ((purpose === 'tutorial' || purpose === 'course') && !s.hidden) {
      const doing = (s.actions ?? []).filter((a) => a && ['click', 'dblclick', 'type', 'drag', 'press', 'goto', 'select', 'slide', 'paste'].includes(Object.keys(a)[0]) && !(Object.keys(a)[0] === 'press' && /^(Enter|Tab)$/.test(String(Object.values(a)[0]))));
      if (doing.length > 2) warnings.push(`${where}: does ${doing.length} things (${doing.map((a) => Object.keys(a)[0]).join(', ')}) in one step — in a ${purpose}, split it so each action gets its own explanation and the viewer can keep up`);
      if (doing.length && !s.say) warnings.push(`${where}: does something but has no say: line — in a ${purpose}, tell the viewer what and why`);
      const kinds = (s.actions ?? []).map((a) => a && Object.keys(a)[0]);
      if (s.say && kinds.some((k) => k === 'scroll' || k === 'scrollTo') && !kinds.some((k) => ['mark', 'note', 'click', 'type', 'select', 'move', 'hover'].includes(k)) && !s.zoom) {
        warnings.push(`${where}: scrolls and talks but points at nothing — on a dense page the viewer can't tell what you mean; \`mark\` or \`note\` the row or value the narration is about (the camera then zooms to it)`);
      }
    }
  }
  if (raw.end_card) unknown(raw.end_card, END, 'end_card');
  if (raw.intro) unknown(raw.intro, END, 'intro');
  if (raw.article) unknown(raw.article, ['title', 'intro'], 'article');
  if (raw.frame && typeof raw.frame === 'object') unknown(raw.frame, ['background', 'style'], 'frame');
  const todo = (fs.readFileSync(file, 'utf8').split('\n').map((l, i) => [l.replace(/#.*$/, ''), i + 1]).filter(([l]) => /\bTODO\b/.test(l)));
  for (const [, n] of todo) errors.push(`line ${n}: replace the TODO placeholder`);

  function checkAction(a, where) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return errors.push(`${where}: each action is a one-key map, e.g. "- click: { role: button, name: Save }"`);
    const keys = Object.keys(a);
    if (keys.length !== 1) return errors.push(`${where}: has ${keys.length} keys (${keys.join(', ')}) — put each action in its own list item`);
    const [kind] = keys, v = a[kind], type = ACTIONS[kind];
    if (!type) {
      const guess = near(kind, Object.keys(ACTIONS));
      return errors.push(`${where}: unknown action "${kind}"${guess ? ` — did you mean "${guess}"?` : ` (actions: ${Object.keys(ACTIONS).join(', ')})`}`);
    }
    if (type === 'number' && typeof v !== 'number') errors.push(`${where}: ${kind} takes milliseconds, e.g. "${kind}: 800"`);
    if (type === 'string' && typeof v !== 'string') errors.push(`${where}: ${kind} takes a string`);
    if (type === 'target') target(v, `${where} (${kind})`);
    if (type === 'mark' && typeof v !== 'string') target(v, `${where} (mark)`); // a string is a phrase to highlight
    if (type === 'slide') {
      if (!v?.target || typeof v?.to !== 'number' || v.to < 0 || v.to > 1) errors.push(`${where}: slide needs { target: <slider>, to: 0..1 } (0 = start of the track, 1 = end)`);
      else target(v.target, `${where} (slide.target)`);
    }
    if (type === 'select') {
      if (!v?.target || v?.option == null) errors.push(`${where}: select needs { target: <dropdown>, option: "visible text of the option" }`);
      else target(v.target, `${where} (select.target)`);
    }
    if (type === 'note') {
      if (!v?.target || !v?.text) errors.push(`${where}: note needs { target: <target>, text: "short label" }`);
      else if (isPoint(v.target)) errors.push(`${where}: a note points at an element, not a screen position — target the element (a label, button, cell…) next to that spot`);
      else { target(v.target, `${where} (note.target)`); unknown(v, ['target', 'text', 'side', 'ms', 'timeout'], `${where} (note)`); }
      if (v?.side && !['auto', 'left', 'right', 'top', 'bottom'].includes(v.side)) errors.push(`${where}: note side must be auto, left, right, top or bottom`);
    }
    if (type === 'type') {
      if (typeof v === 'string' || typeof v === 'number') return;
      if (v?.text == null) errors.push(`${where}: ${kind} needs text — "type: hello" types into the focused element, "type: { target: <target>, text: hello }" clicks the target first`);
      else if (v.target) target(v.target, `${where} (type.target)`);
    }
    if (type === 'drag') {
      if (!v?.from || !(v.to || v.by)) errors.push(`${where}: drag needs { from: <target or point>, to: <target or point> } or { from, by: { x, y } }`);
      else target(v.from, `${where} (drag.from)`);
    }
  }

  // semantic checks via the real loader
  let cfg = null;
  if (!errors.length) {
    try { cfg = loadConfig(file); } catch (e) { errors.push(e.message); }
  }
  let summary = '';
  if (cfg) {
    const visible = cfg.steps.filter((s) => !s.hidden);
    const says = visible.filter((s) => s.say).length + (cfg.endCard?.say ? 1 : 0) + (cfg.intro?.say ? 1 : 0);
    if (cfg.voice && !says) warnings.push('voice is set but no step has a `say:` line');
    if (!cfg.voice && says) warnings.push('steps have `say:` lines but there is no `voice:` block, so they will not be spoken');
    if (!draft && cfg.voice && ['elevenlabs', 'openai'].includes(cfg.voice.provider)) {
      const env = cfg.voice.provider === 'elevenlabs' ? 'ELEVENLABS_API_KEY' : 'OPENAI_API_KEY';
      if (!process.env[env]) errors.push(`voice provider ${cfg.voice.provider} needs ${env} (environment or a .env file next to the storyboard) — or render with draft mode to use the free local voice`);
    }
    if (cfg.storageState) {
      const f = cfg.storageState;
      if (!fs.existsSync(f)) errors.push(`storageState ${f} does not exist — ask the user to log in: \`storyshot login ${cfg.url} --save ${f}\` (MCP tool: login)`);
      else {
        if (gitIgnored(f) === false) errors.push(`${f} holds the user's session cookies but is not in .gitignore — add it before anything gets committed`);
        try {
          const now = Date.now() / 1000, cookies = JSON.parse(fs.readFileSync(f, 'utf8')).cookies ?? [];
          const dated = cookies.filter((c) => c.expires > 0);
          if (dated.length && dated.every((c) => c.expires < now)) warnings.push(`every cookie in ${f} has expired — the login probably has too; run login again`);
        } catch { errors.push(`${f} is not a valid session file — run login again`); }
      }
    }
    const fixed = visible.filter((s) => s.duration !== 'auto').reduce((a, s) => a + s.duration, 0);
    const auto = visible.filter((s) => s.duration === 'auto').length;
    const ec = cfg.endCard ? (cfg.endCard.duration === 'auto' ? null : cfg.endCard.duration) : 0;
    const length = auto ? `${fixed ? `${fixed.toFixed(1)}s fixed + ` : ''}${auto} steps timed to narration${cfg.endCard ? ' + end card' : ''}${cfg.intro ? ' + intro' : ''}`
      : `${fixed.toFixed(1)}s of steps${cfg.endCard ? ` + ${ec ?? 'auto'}s end card` : ''}${ec != null ? ` = ${(fixed + ec).toFixed(1)}s total` : ''}`;
    summary = `${cfg.name}: purpose ${cfg.purpose}, ${visible.length} visible steps, ${length}` +
      (cfg.voice ? `, voice ${cfg.voice.provider}` : '') + ` → ${cfg.out}`;
  }
  return { ok: !errors.length, errors, warnings, summary };
}

export function formatCheck(r) {
  return [r.ok ? `✔ storyboard is valid${r.summary ? ` — ${r.summary}` : ''}\n  (this checks structure only; targets are verified when rendering — test new ones with inspect after_step)` : `✖ ${r.errors.length} problem(s):`,
    ...r.errors.map((e) => `  ✖ ${e}`), ...r.warnings.map((w) => `  ⚠ ${w}`)].join('\n');
}
