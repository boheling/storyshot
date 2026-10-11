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
  pitch:    { duration: null,   music: { bpm: 120, volume: 1 },    sfx: true,  highlight: false, stepNumbers: false, subtitles: false, chapters: false, clips: null },
  tutorial: { duration: 'auto', music: { bpm: 96, volume: 0.35 },  sfx: true,  highlight: true,  stepNumbers: true,  subtitles: true,  chapters: true,  clips: null },
  course:   { duration: 'auto', music: false,                     sfx: true,  highlight: true,  stepNumbers: false, subtitles: true,  chapters: true,  clips: null },
  docs:     { duration: 'auto', music: false,                     sfx: false, highlight: true,  stepNumbers: true,  subtitles: false, chapters: false, clips: 'gif' },
};

// Where storyboards and their videos go, and how they're named: <site>-<kind>[-<topic>].yaml →
// .mp4, so a promo, a tutorial and a lesson for the same app never collide or all read "demo".
export const VIDEO_DIR = 'videos';
export const KINDS = { pitch: 'promo', tutorial: 'tutorial', course: 'lesson', docs: 'docs' };
export const siteOf = (url) => new URL(url).hostname.replace(/^www\./, '').split('.')[0];
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

  const steps = raw.steps.map((s, i) => {
    const duration = s.duration ?? P.duration;
    if (!s.hidden && duration !== 'auto' && !(duration > 0)) {
      throw new Error(`step ${i + 1}: visible steps need a positive \`duration\` in seconds, or \`duration: auto\``);
    }
    return { actions: [], ...s, duration };
  });

  let endCard = raw.end_card === false ? null : raw.end_card ?? null;
  if (endCard) endCard = { duration: endCard.say ? 'auto' : 1.0, ...endCard };
  if (endCard?.logo && typeof endCard.logo === 'string' && /\.(png|jpe?g|svg|webp)$/i.test(endCard.logo)) {
    endCard.logoFile = path.resolve(dir, endCard.logo);
  }

  let voice = null;
  if (raw.voice) {
    const provider = raw.voice.provider ?? 'kokoro';
    if (!VOICE_DEFAULTS[provider]) throw new Error(`voice.provider must be one of ${Object.keys(VOICE_DEFAULTS).join(', ')}`);
    voice = { speed: 1, volume: 1, ...VOICE_DEFAULTS[provider], ...raw.voice, provider };
    if (draft && provider !== 'kokoro') {
      voice = { ...voice, provider: 'kokoro', voice: raw.voice.draftVoice ?? VOICE_DEFAULTS.kokoro.voice, model: undefined };
    }
  }

  const m = pick('music');
  let music = m === false || m === null ? null : { bpm: 120, volume: 1, ...(P.music || {}), ...(raw.music || {}) };
  const clips = pick('clips');
  if (clips && !['gif', 'webm', 'mp4'].includes(clips)) throw new Error('clips must be gif, webm or mp4');
  if (music?.file) music.file = path.resolve(dir, music.file);

  return {
    name,
    purpose,
    highlight: pick('highlight'),
    stepNumbers: pick('stepNumbers'),
    subtitles: pick('subtitles'),
    chapters: pick('chapters'),
    clips,
    maxWait: raw.maxWait ?? 1.0,
    url: raw.url,
    viewport,
    output,
    scale,
    colorScheme: raw.colorScheme ?? 'light',
    storageState: raw.storageState ? path.resolve(dir, raw.storageState) : undefined,
    scrollOffset: raw.scrollOffset ?? 40,
    captionPosition: raw.captionPosition ?? 'bottom',
    theme: { accent: '#d9f75b', ink: '#0f172a', font: 'Inter', ...raw.theme },
    setup: raw.setup ?? [],
    steps,
    endCard,
    music,
    voice,
    sfx: pick('sfx') !== false,
    draft,
    out: path.resolve(dir, raw.out ?? `${name}.mp4`).replace(/(\.[^./]+)?$/, (ext) => (draft ? `.draft${ext || '.mp4'}` : ext)),
    work: path.resolve(dir, '.storyshot', name),
  };
}
