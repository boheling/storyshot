// Load and normalize a demo.yaml storyboard.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { VOICE_DEFAULTS, kokoroVoiceFor, qwenVoiceFor } from './voice.mjs';
import { QWEN_VOICES, qwenSupported, qwenVoice } from './qwen-tts.mjs';
import { SCENE_DEFAULTS, toRgb } from './scenes.mjs';

// Built-in labels drawn into the video, by `lang` (e.g. es, es-MX); other languages get English
export const LABELS = {
  en: { think: 'Pause and think', intro: 'Introduction', downloaded: 'Downloaded', tryIt: 'try it' },
  zh: { think: '先想一想', intro: '开场', downloaded: '已下载', tryIt: '试试看' },
  es: { think: 'Piénsalo un momento', intro: 'Introducción', downloaded: 'Descargado', tryIt: 'pruébalo' },
  pt: { think: 'Pense um pouco', intro: 'Introdução', downloaded: 'Baixado', tryIt: 'experimente' },
  fr: { think: 'Réfléchissez', intro: 'Introduction', downloaded: 'Téléchargé', tryIt: 'essayez' },
  de: { think: 'Kurz nachdenken', intro: 'Einführung', downloaded: 'Heruntergeladen', tryIt: 'ausprobieren' },
  ja: { think: '考えてみよう', intro: 'はじめに', downloaded: 'ダウンロード済み', tryIt: '試してみて' },
};

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
  pitch:    { duration: null,   music: { bpm: 120, volume: 1 },    sfx: true,  highlight: false, stepNumbers: false, subtitles: false, chapters: false, clips: null, frame: 'aurora', pace: 'fast', follow: false, hyperframes: false },
  tutorial: { duration: 'auto', music: { bpm: 96, volume: 0.35 },  sfx: 'clicks', highlight: true,  stepNumbers: true,  subtitles: true,  chapters: true,  clips: null, frame: 'studio', pace: 'slow', follow: true, hyperframes: true },
  course:   { duration: 'auto', music: false,                     sfx: 'clicks', highlight: true,  stepNumbers: false, subtitles: true,  chapters: true,  clips: null, frame: 'studio', pace: 'slow', follow: true, hyperframes: true },
  docs:     { duration: 'auto', music: false,                     sfx: false, highlight: true,  stepNumbers: true,  subtitles: false, chapters: false, clips: ['gif', 'png'], frame: false, pace: 'normal', follow: false, hyperframes: false },
  // a concept explained with animated scenes the agent writes (no web app to record)
  explainer: { duration: 'auto', music: { style: 'calm', bpm: 64, volume: 0.3 }, sfx: false, highlight: false, stepNumbers: false, subtitles: true, chapters: true, clips: null, frame: false, pace: 'normal', follow: false, hyperframes: true },
};

// Where storyboards and their videos go, and how they're named: <site>-<kind>[-<topic>].yaml →
// .mp4, so a promo, a tutorial and a lesson for the same app never collide or all read "demo".
// How fast things happen on screen. Promos are brisk; tutorials and lessons give the viewer time to
// follow each action and to read its result before the next one starts.
export const PACES = {
  //        cursor ms  typing ms/char  beat after a click (ms)  hold after narration (s)  waits shown up to (s)  voice speed
  //        shortest pause between the sentences of one line (s)
  fast:   { cursor: 700,  type: 55,  beat: 0,   tail: 0.4, maxWait: 1.0, voiceSpeed: 1,    sentencePause: 0.3 },
  normal: { cursor: 900,  type: 70,  beat: 350, tail: 0.8, maxWait: 1.5, voiceSpeed: 1,    sentencePause: 0.45 },
  slow:   { cursor: 1200, type: 95,  beat: 800, tail: 1.6, maxWait: 3.0, voiceSpeed: 0.92, sentencePause: 0.6 },
};

export const FRAME_STYLES = ['aurora', 'studio', 'dark', 'pastel', 'blur'];

// The shape of the video, as one word in the storyboard: `aspect: portrait`. Portrait is a phone held
// upright and is what every short-video feed wants; square still plays either way round.
export const ASPECTS = { landscape: [1920, 1080], portrait: [1080, 1920], square: [1080, 1080] };
export const ASPECT_ALIASES = {
  '16:9': 'landscape', wide: 'landscape', horizontal: 'landscape',
  '9:16': 'portrait', vertical: 'portrait', tall: 'portrait',
  '1:1': 'square',
};
// Any other shape is written as the ratio itself — `aspect: "3:4"` → 1080x1440, `aspect: "4:5"` →
// 1080x1350 — because the feeds do not all want the same tall frame: a 9:16 video is cropped in
// Xiaohongshu's feed, where 3:4 is what fills it. The short side is always 1080, and both sides come
// out even, which h.264 requires.
export function aspectFrame(ratio) {
  const m = String(ratio).match(/^\s*(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)\s*$/);
  const [w, h] = [Number(m?.[1]), Number(m?.[2])];
  if (!m || !(w > 0) || !(h > 0)) return null;
  const even = (n) => 2 * Math.round(n / 2);
  return w >= h ? [even((1080 * w) / h), 1080] : [1080, even((1080 * h) / w)];
}
export const orientationOf = (w, h) => (h > w ? 'portrait' : h === w ? 'square' : 'landscape');

export const VIDEO_DIR = 'videos';
export const KINDS = { pitch: 'promo', tutorial: 'tutorial', course: 'lesson', docs: 'docs', explainer: 'explainer' };
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
  // an explainer has no site: it is named by its topic
  const base = (url ? [siteOf(url), KINDS[purpose] ?? purpose, topic && slug(topic)] : [topic && slug(topic), KINDS[purpose] ?? purpose]).filter(Boolean).join('-');
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
  if (!Array.isArray(raw.steps) || !raw.steps.length) throw new Error('demo.yaml: `steps` must be a non-empty list');
  // only a storyboard made entirely of scenes has nothing to record
  if (!raw.url && !raw.steps.every((s) => s?.scene || s?.hidden)) throw new Error('demo.yaml: `url` is required (only a storyboard whose steps are all scenes can leave it out)');

  // aspect: the shape of the video in one word — landscape (16:9, the default), portrait (9:16: a
  // phone held upright, and most short-video feeds) or square (1:1) — or as a ratio, `3:4` for the
  // shape Xiaohongshu's feed fills. `output` still wins when it is given outright, so an unusual
  // size stays possible.
  const aspectName = raw.aspect == null ? null : (ASPECT_ALIASES[String(raw.aspect).toLowerCase()] ?? String(raw.aspect).toLowerCase());
  const aspectSize = aspectName == null ? null : (ASPECTS[aspectName] ?? aspectFrame(aspectName));
  if (aspectName && !aspectSize) throw new Error(`aspect must be one of ${Object.keys(ASPECTS).join(', ')}, or a ratio like "3:4" (16:9, 9:16 and 1:1 also work)`);
  const [AW, AH] = aspectSize ?? ASPECTS.landscape;
  const output = { width: AW, height: AH, fps: 30, ...raw.output };
  // The browser viewport is only what a recording is captured at, and it has to share the output's
  // aspect ratio. Unless it is given, it follows the output — so a portrait or square video never
  // asks for that arithmetic, and a storyboard of scenes (which records nothing) never mentions it.
  const long = 1600;
  const viewport = {
    ...(output.width >= output.height
      ? { width: long, height: Math.round((long * output.height) / output.width) }
      : { width: Math.round((long * output.width) / output.height), height: long }),
    ...raw.viewport,
  };
  const scale = output.width / viewport.width;
  if (Math.abs(viewport.height * scale - output.height) > 1) {
    throw new Error(`viewport ${viewport.width}x${viewport.height} and output ${output.width}x${output.height} must have the same aspect ratio`
      + ' (leave `viewport` out and it follows the output)');
  }

  const purpose = raw.purpose ?? 'pitch';
  const P = PURPOSES[purpose];
  if (!P) throw new Error(`purpose must be one of ${Object.keys(PURPOSES).join(', ')}`);
  const pick = (k) => (raw[k] !== undefined ? raw[k] : P[k]);
  if (!PACES[pick('pace')]) throw new Error(`pace must be one of ${Object.keys(PACES).join(', ')}`);

  const steps = raw.steps.map((s, i) => {
    // scene: an animation the agent wrote (see scenes.mjs), timed to the step's narration
    let scene;
    if (s.scene) {
      const sc = typeof s.scene === 'string' ? { file: s.scene } : s.scene;
      if (!sc.file) throw new Error(`step ${i + 1}: scene needs a file: \`scene: scenes/<name>.html\``);
      if (s.actions?.length) throw new Error(`step ${i + 1}: a scene plays its own animation instead of the web app, so it has no actions — move them into a step of their own`);
      if (!s.say && typeof s.duration !== 'number') throw new Error(`step ${i + 1}: a scene without a say: line needs a duration in seconds`);
      scene = { ...SCENE_DEFAULTS, ...sc, file: path.resolve(dir, sc.file) };
      const card = s.card ? { ...s.card, ...(s.card.image ? { imageFile: path.resolve(dir, s.card.image) } : {}) } : undefined;
      return { ...s, actions: [], duration: typeof s.duration === 'number' ? s.duration : 'auto', card, scene };
    }
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
  // (a HyperFrames launch intro also turns into the app window at the end: it needs a little longer)
  const launchCards = raw.hyperframes && (raw.hyperframes.template ?? (purpose === 'pitch' ? 'launch' : 'lesson')) === 'launch';
  if (intro) intro = { duration: intro.say ? 'auto' : launchCards ? 3.0 : 2.2, ...intro };
  for (const card of [endCard, intro]) {
    if (card?.image) card.imageFile = path.resolve(dir, card.image);
    if (card?.logo && typeof card.logo === 'string' && /\.(png|jpe?g|svg|webp)$/i.test(card.logo)) card.logoFile = path.resolve(dir, card.logo);
  }
  // Browser-window frame on a backdrop (promos by default): true, false, or { background: <css> }
  const frame0 = pick('frame');
  // follow: the camera zooms in on what each step touches and pans from step to step (tutorials)
  const follow0 = pick('follow');
  const follow = follow0 ? { scale: 1.8, ...(typeof follow0 === 'object' ? follow0 : {}) } : null;
  // frame: false | true | a style name | { style, background: <css>, window, title, icon }. Styles: aurora
  // (dark, grain), studio (light, grain), dark, pastel, blur (the page itself, blurred, behind the window).
  // window: browser (an address bar) or app (an installed web app / desktop app: its icon and name in the
  // title bar, no address bar; both are read from the page's web app manifest unless given)
  const styleOf = (f) => (typeof f === 'string' ? f : f?.style) ?? (typeof P.frame === 'string' ? P.frame : 'aurora');
  const frame = frame0 ? { background: null, window: 'browser', ...(typeof frame0 === 'object' ? frame0 : {}), style: styleOf(frame0) } : null;
  if (frame && !FRAME_STYLES.includes(frame.style)) throw new Error(`frame style must be one of ${FRAME_STYLES.join(', ')}`);
  if (frame && !['browser', 'app'].includes(frame.window)) throw new Error('frame.window must be browser or app');
  if (!['auto', 'light', 'dark'].includes(raw.ground ?? 'auto')) throw new Error('ground must be light or dark (leave it out and auto reads it from the scenes, or from the frame)');
  if (frame?.icon) frame.iconFile = path.resolve(dir, frame.icon);

  // hyperframes: true | { template: lesson | launch, band, bandColors, emblem, hand, backdrop } — cards
  // rendered by HyperFrames (see hyperframes.mjs); promos get the launch template, the rest the lesson one.
  // On by default for tutorials and lessons, where Node can run it (22+); else the built-in cards
  const hf0 = raw.hyperframes !== undefined ? raw.hyperframes : P.hyperframes && Number(process.versions.node.split('.')[0]) >= 22;
  const hyperframes = hf0 ? { template: purpose === 'pitch' ? 'launch' : 'lesson', backdrop: true, ...(typeof hf0 === 'object' ? hf0 : {}) } : null;
  if (hyperframes && !['lesson', 'launch'].includes(hyperframes.template)) throw new Error('hyperframes.template must be lesson or launch');
  if (hyperframes?.bandColors && !['aminoacid', 'nucleotide', 'accent'].includes(hyperframes.bandColors)) throw new Error('hyperframes.bandColors must be aminoacid, nucleotide or accent');

  let voice = null;
  if (raw.voice) {
    const provider = raw.voice.provider ?? 'kokoro';
    if (!VOICE_DEFAULTS[provider]) throw new Error(`voice.provider must be one of ${Object.keys(VOICE_DEFAULTS).join(', ')}`);
    const pace0 = PACES[pick('pace')] ?? PACES.normal;
    // kokoro's and qwen's default voices follow the narration's language (zf_001 / serena for Chinese)
    const kokoroVoice = kokoroVoiceFor(raw);
    const byLang = { kokoro: kokoroVoice, qwen: qwenVoiceFor(raw) }[provider];
    voice = { speed: pace0.voiceSpeed, volume: 1, pause: pace0.sentencePause, ...VOICE_DEFAULTS[provider], ...(byLang ? { voice: byLang } : {}), ...(raw.lang ? { lang: raw.lang } : {}), ...raw.voice, provider };
    if (!(typeof voice.pause === 'number' && voice.pause >= 0 && voice.pause <= 3)) throw new Error('voice.pause is the shortest pause between the sentences of a line, in seconds, 0–3 (0 leaves the voice as it is)');
    // explainers: a scene's narration keeps moving (no pause in a line longer than this)
    if (voice.maxPause === undefined && purpose === 'explainer') voice.maxPause = 0.55;
    if (voice.maxPause != null && !(typeof voice.maxPause === 'number' && voice.maxPause >= voice.pause)) throw new Error(`voice.maxPause is the longest pause inside a line, in seconds, at least voice.pause (${voice.pause})`);
    if (provider === 'qwen') {
      const v = qwenVoice(voice.voice);
      if (!v) throw new Error(`voice: qwen has no voice "${voice.voice}" (one of ${QWEN_VOICES.join(', ')})`);
      voice.voice = v;
      // MLX needs Apple Silicon: anywhere else the same storyboard renders with kokoro
      if (!qwenSupported()) {
        const k = raw.voice.draftVoice ?? kokoroVoice;
        voice = { ...voice, provider: 'kokoro', voice: k, fallback: `the qwen voice needs an Apple Silicon Mac; using kokoro ${k} instead` };
      }
    }
    // free local voices stay; a paid one is swapped for kokoro
    if (draft && !['kokoro', 'qwen'].includes(voice.provider)) {
      voice = { ...voice, provider: 'kokoro', voice: raw.voice.draftVoice ?? kokoroVoice, model: undefined };
    }
  }

  const m = pick('music');
  let music = m === false || m === null ? null : { bpm: 120, volume: 1, ...(P.music || {}), ...(raw.music || {}) };
  // per-step files for docs: any of gif, webm, mp4, png (annotated still of the step's result)
  const clips = [].concat(pick('clips') ?? []).filter(Boolean);
  for (const c of clips) if (!['gif', 'webm', 'mp4', 'png'].includes(c)) throw new Error('clips must be gif, webm, mp4 or png (or a list of them)');
  if (music?.file) music.file = path.resolve(dir, music.file);
  if (music?.style && !['calm'].includes(music.style)) throw new Error('music.style must be calm (or leave it out for the upbeat synth)');
  if (raw.theme?.paper != null && !toRgb(raw.theme.paper)) throw new Error('theme.paper is the film\'s background colour, as a hex or rgb() value (e.g. "#e9ddc4")');

  // scenes: { css: [files], js: [files] } shared by every scene (a palette, drawing helpers), loaded before each one
  const sk = raw.scenes ?? {};
  // `three: true` adds storyshot's own drawn-3D helpers (three.js + Kit3) before the storyboard's
  // own kit files, for scenes whose subject is an object rather than a quantity (guide: "3D scenes").
  if (sk.three != null && typeof sk.three !== 'boolean') throw new Error('scenes.three is true or false (it loads three.js and storyshot\'s Kit3 helpers into every scene)');
  const sceneKit = {
    css: [].concat(sk.css ?? []).map((f) => path.resolve(dir, f)),
    js: [].concat(sk.js ?? []).map((f) => path.resolve(dir, f)),
    three: sk.three === true,
  };
  return {
    name,
    purpose,
    sceneKit,
    highlight: pick('highlight'),
    stepNumbers: pick('stepNumbers'),
    subtitles: pick('subtitles'),
    chapters: pick('chapters'),
    clips,
    pace: { name: pick('pace'), ...PACES[pick('pace')] },
    maxWait: raw.maxWait ?? PACES[pick('pace')].maxWait,
    url: raw.url ?? null,
    viewport,
    output,
    scale,
    colorScheme: raw.colorScheme ?? 'light',
    ignoreHTTPSErrors: raw.ignoreHTTPSErrors === true,
    storageState: raw.storageState ? path.resolve(dir, raw.storageState) : undefined,
    scrollOffset: raw.scrollOffset ?? 40,
    // burned-in subtitles sit at the bottom, so captions move to the top
    captionPosition: raw.captionPosition ?? (pick('subtitles') === 'burn' ? 'top' : 'bottom'),
    // theme.paper: the film's own background colour. The title, section and end cards are built on it
    // instead of storyshot's default near-white, which is a cold blue-grey and cuts badly against a
    // film drawn on warm paper. Leave it out and the cards keep the default ground for `ground:`.
    theme: { accent: '#d9f75b', ink: '#0f172a', font: 'Inter', paper: null, ...raw.theme },
    // landscape | portrait | square, for anything that lays out by the shape rather than the pixels
    // which way up the finished video is, whatever got it there: a named aspect, a ratio or `output`
    aspect: orientationOf(output.width, output.height),
    setup: raw.setup ?? [],
    steps,
    endCard,
    intro,
    article: raw.article ?? null,
    // captions: false keeps the caption pills off the video (chapters and SRT still use them),
    // e.g. when burned-in subtitles already carry the words
    captions: raw.captions !== false,
    cards: raw.cards ?? 'auto',
    // ground: light | dark — is the film light or dark overall? It decides the colour of the burned-in
    // subtitles (ink letters on a light film, white on a dark one) and the cards' ground. `auto` reads
    // it from the scenes, or from the frame's backdrop; say it outright when the scenes take their
    // ground from the shared scene kit, which `auto` cannot always see through.
    ground: raw.ground ?? 'auto',
    // language of the built-in labels ("Pause and think", "Introduction"): `lang`, else guessed from the captions
    lang: raw.lang ?? (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(JSON.stringify(raw.steps ?? [])) ? 'zh' : 'en'),
    labels: LABELS[String(raw.lang ?? '').toLowerCase().split(/[-_]/)[0]] ?? (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(JSON.stringify(raw.steps ?? [])) ? LABELS.zh : LABELS.en),
    frame,
    hyperframes,
    follow,
    music,
    voice,
    // sfx: true (clicks, transition whooshes and risers), 'clicks' (no whooshes or risers: tutorials and
    // lessons, where a sound at every card soon grates), or false
    sfx: pick('sfx') === false ? false : { clicks: true, transitions: pick('sfx') !== 'clicks' },
    draft,
    out: path.resolve(dir, raw.out ?? `${name}.mp4`).replace(/(\.[^./]+)?$/, (ext) => (draft ? `.draft${ext || '.mp4'}` : ext)),
    work: path.resolve(dir, '.storyshot', name),
  };
}
