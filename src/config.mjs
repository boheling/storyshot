// Load and normalize a demo.yaml storyboard.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { VOICE_DEFAULTS } from './voice.mjs';

// Load API keys (ELEVENLABS_API_KEY, OPENAI_API_KEY) from .env next to the storyboard
// and in the working directory; variables already set in the environment win.
export function loadEnv(dir) {
  for (const d of new Set([dir, process.cwd()])) {
    const f = path.join(d, '.env');
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

// What the video is for sets sensible defaults; anything in the YAML overrides them.
export const PURPOSES = {
  pitch:    { duration: null,   music: { bpm: 120, volume: 1 },    sfx: true,  highlight: false, stepNumbers: false, subtitles: false, chapters: false, clips: null, frame: 'aurora', pace: 'fast', follow: false },
  tutorial: { duration: 'auto', music: { bpm: 96, volume: 0.35 },  sfx: true,  highlight: true,  stepNumbers: true,  subtitles: true,  chapters: true,  clips: null, frame: 'studio', pace: 'slow', follow: true },
  course:   { duration: 'auto', music: false,                     sfx: true,  highlight: true,  stepNumbers: false, subtitles: true,  chapters: true,  clips: null, frame: 'studio', pace: 'slow', follow: true },
  docs:     { duration: 'auto', music: false,                     sfx: false, highlight: true,  stepNumbers: true,  subtitles: false, chapters: false, clips: ['gif', 'png'], frame: false, pace: 'normal', follow: false },
};

// Where storyboards and their videos go, and how they're named: <site>-<kind>[-<topic>].yaml →
// .mp4, so a promo, a tutorial and a lesson for the same app never collide or all read "demo".
// How fast things happen on screen. Promos are brisk; tutorials and lessons give the viewer time to
// follow each action and to read its result before the next one starts.
export const PACES = {
  //        cursor ms  typing ms/char  beat after a click (ms)  hold after narration (s)  waits shown up to (s)  voice speed
  fast:   { cursor: 700,  type: 55,  beat: 0,   tail: 0.4, maxWait: 1.0, voiceSpeed: 1 },
  normal: { cursor: 900,  type: 70,  beat: 350, tail: 0.8, maxWait: 1.5, voiceSpeed: 1 },
  slow:   { cursor: 1200, type: 95,  beat: 800, tail: 1.6, maxWait: 3.0, voiceSpeed: 0.92 },
};

export const FRAME_STYLES = ['aurora', 'studio', 'dark', 'pastel', 'blur'];

export const VIDEO_DIR = 'videos';
export const KINDS = { pitch: 'promo', tutorial: 'tutorial', course: 'lesson', docs: 'docs' };
// pxgenius.ai → pxgenius; an IP or a port is kept whole so two internal apps don't share a name
// (http://10.1.2.3:8080 → 10-1-2-3-8080, http://localhost:3000 → localhost-3000)
export const siteOf = (url) => {
  const { hostname, port } = new URL(url);
  const host = hostname.replace(/^\[|\]$/g, '');
  const ip = /^[\d.]+$/.test(host) || host.includes(':');
  return [ip ? host.replace(/[.:]+/g, '-').replace(/^-|-$/g, '') : host.replace(/^www\./, '').split('.')[0], port].filter(Boolean).join('-');
};

// A clear message for an internal site with a self-signed / untrusted HTTPS certificate.
export const certError = (e, url) => (/ERR_CERT|ERR_SSL/.test(e?.message ?? '')
  ? new Error(`${url} has an untrusted HTTPS certificate (${e.message.match(/ERR_\w+/)[0]}). If it is your own internal site with a self-signed ` +
    'certificate, add `ignoreHTTPSErrors: true` to the storyboard (inspect/init: --insecure, MCP: ignore_https_errors: true).')
  : null);
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export function defaultStoryboard(url, purpose = 'pitch', topic) {
  const base = [siteOf(url), KINDS[purpose] ?? purpose, topic && slug(topic)].filter(Boolean).join('-');
  for (let i = 1; ; i++) {
    const file = path.join(VIDEO_DIR, `${base}${i > 1 ? `-${i}` : ''}.yaml`);
    if (!fs.existsSync(file)) return file;
  }
}

// draft: swap the voice for the free local one (kokoro) and write <out>.draft.mp4, so timing
// and visuals can be iterated without spending TTS credits. Recordings are shared, so the
// final render afterwards only needs `compose`.
export function loadConfig(file, { draft = false } = {}) {
  const abs = path.resolve(file);
  loadEnv(path.dirname(abs));
  const raw = YAML.parse(fs.readFileSync(abs, 'utf8'));
  const dir = path.dirname(abs);
  const name = raw.name ?? path.basename(abs).replace(/\.ya?ml$/, '');
  if (!raw.url) throw new Error('demo.yaml: `url` is required');
  if (!Array.isArray(raw.steps) || !raw.steps.length) throw new Error('demo.yaml: `steps` must be a non-empty list');

  const viewport = { width: 1600, height: 900, ...raw.viewport };
  const output = { width: 1920, height: 1080, fps: 30, ...raw.output };
  const scale = output.width / viewport.width;
  if (Math.abs(viewport.height * scale - output.height) > 1) {
    throw new Error(`viewport ${viewport.width}x${viewport.height} and output ${output.width}x${output.height} must have the same aspect ratio`);
  }

  const purpose = raw.purpose ?? 'pitch';
  const P = PURPOSES[purpose];
  if (!P) throw new Error(`purpose must be one of ${Object.keys(PURPOSES).join(', ')}`);
  const pick = (k) => (raw[k] !== undefined ? raw[k] : P[k]);
  if (!PACES[pick('pace')]) throw new Error(`pace must be one of ${Object.keys(PACES).join(', ')}`);

  const steps = raw.steps.map((s, i) => {
    const duration = s.duration ?? P.duration;
    if (!s.hidden && duration !== 'auto' && !(duration > 0)) {
      throw new Error(`step ${i + 1}: visible steps need a positive \`duration\` in seconds, or \`duration: auto\``);
    }
    const card = s.card ? { ...s.card, ...(s.card.image ? { imageFile: path.resolve(dir, s.card.image) } : {}) } : undefined;
    return { actions: [], ...s, duration, card };
  });

  let endCard = raw.end_card === false ? null : raw.end_card ?? null;
  // auto: as long as its narration, bullets and call to action need, and never under 2.5s
  if (endCard) endCard = { duration: 'auto', ...endCard };
  // An intro title card (promos; optional for tutorials and lessons). Same fields as the end card.
  let intro = raw.intro === false ? null : raw.intro ?? null;
  if (intro) intro = { duration: intro.say ? 'auto' : 2.2, ...intro };
  for (const card of [endCard, intro]) {
    if (card?.image) card.imageFile = path.resolve(dir, card.image);
    if (card?.logo && typeof card.logo === 'string' && /\.(png|jpe?g|svg|webp)$/i.test(card.logo)) card.logoFile = path.resolve(dir, card.logo);
  }
  // Browser-window frame on a backdrop (promos by default): true, false, or { background: <css> }
  const frame0 = pick('frame');
  // follow: the camera zooms in on what each step touches and pans from step to step (tutorials)
  const follow0 = pick('follow');
  const follow = follow0 ? { scale: 1.8, ...(typeof follow0 === 'object' ? follow0 : {}) } : null;
  // frame: false | true | a style name | { style, background: <css> }. Styles: aurora (dark, grain),
  // studio (light, grain), dark, pastel, blur (the page itself, blurred, behind the window)
  const styleOf = (f) => (typeof f === 'string' ? f : f?.style) ?? (typeof P.frame === 'string' ? P.frame : 'aurora');
  const frame = frame0 ? { background: null, ...(typeof frame0 === 'object' ? frame0 : {}), style: styleOf(frame0) } : null;
  if (frame && !FRAME_STYLES.includes(frame.style)) throw new Error(`frame style must be one of ${FRAME_STYLES.join(', ')}`);

  let voice = null;
  if (raw.voice) {
    const provider = raw.voice.provider ?? 'kokoro';
    if (!VOICE_DEFAULTS[provider]) throw new Error(`voice.provider must be one of ${Object.keys(VOICE_DEFAULTS).join(', ')}`);
    const pace0 = PACES[pick('pace')] ?? PACES.normal;
    voice = { speed: pace0.voiceSpeed, volume: 1, ...VOICE_DEFAULTS[provider], ...raw.voice, provider };
    if (draft && provider !== 'kokoro') {
      voice = { ...voice, provider: 'kokoro', voice: raw.voice.draftVoice ?? VOICE_DEFAULTS.kokoro.voice, model: undefined };
    }
  }

  const m = pick('music');
  let music = m === false || m === null ? null : { bpm: 120, volume: 1, ...(P.music || {}), ...(raw.music || {}) };
  // per-step files for docs: any of gif, webm, mp4, png (annotated still of the step's result)
  const clips = [].concat(pick('clips') ?? []).filter(Boolean);
  for (const c of clips) if (!['gif', 'webm', 'mp4', 'png'].includes(c)) throw new Error('clips must be gif, webm, mp4 or png (or a list of them)');
  if (music?.file) music.file = path.resolve(dir, music.file);

  return {
    name,
    purpose,
    highlight: pick('highlight'),
    stepNumbers: pick('stepNumbers'),
    subtitles: pick('subtitles'),
    chapters: pick('chapters'),
    clips,
    pace: { name: pick('pace'), ...PACES[pick('pace')] },
    maxWait: raw.maxWait ?? PACES[pick('pace')].maxWait,
    url: raw.url,
    viewport,
    output,
    scale,
    colorScheme: raw.colorScheme ?? 'light',
    ignoreHTTPSErrors: raw.ignoreHTTPSErrors === true,
    storageState: raw.storageState ? path.resolve(dir, raw.storageState) : undefined,
    scrollOffset: raw.scrollOffset ?? 40,
    // burned-in subtitles sit at the bottom, so captions move to the top
    captionPosition: raw.captionPosition ?? (pick('subtitles') === 'burn' ? 'top' : 'bottom'),
    theme: { accent: '#d9f75b', ink: '#0f172a', font: 'Inter', ...raw.theme },
    setup: raw.setup ?? [],
    steps,
    endCard,
    intro,
    article: raw.article ?? null,
    // captions: false keeps the caption pills off the video (chapters and SRT still use them),
    // e.g. when burned-in subtitles already carry the words
    captions: raw.captions !== false,
    cards: raw.cards ?? 'auto',
    // language of the built-in labels ("Pause and think", "Introduction"): `lang`, else guessed from the captions
    lang: raw.lang ?? (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(JSON.stringify(raw.steps ?? [])) ? 'zh' : 'en'),
    frame,
    follow,
    music,
    voice,
    sfx: pick('sfx') !== false,
    draft,
    out: path.resolve(dir, raw.out ?? `${name}.mp4`).replace(/(\.[^./]+)?$/, (ext) => (draft ? `.draft${ext || '.mp4'}` : ext)),
    work: path.resolve(dir, '.storyshot', name),
  };
}
