// What the installed ffmpeg can do: builds differ (Homebrew's default ffmpeg has no libass, so no
// `ass` filter for burned-in subtitles).
import { execFileSync } from 'node:child_process';

const cache = {};
const list = (kind) => {
  if (!cache[kind]) {
    try {
      const out = execFileSync('ffmpeg', ['-hide_banner', `-${kind}`], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      // " .. zoompan  V->V  ..." (filters) or " V....D libx264  ..." (encoders): the name is the second column
      cache[kind] = new Set(out.split('\n').map((l) => l.trim().split(/\s+/)[1]).filter(Boolean));
    } catch { cache[kind] = new Set(); }
  }
  return cache[kind];
};
export const hasFilter = (name) => list('filters').has(name);
export const hasEncoder = (name) => list('encoders').has(name);

// what Storyshot needs from ffmpeg, and what each optional piece is for
export const NEEDED = {
  filters: ['zoompan', 'overlay', 'alphamerge', 'gblur', 'fade', 'tpad', 'loudnorm', 'alimiter', 'aresample', 'atempo', 'silenceremove', 'areverse', 'palettegen', 'paletteuse'],
  encoders: ['libx264', 'aac'],
};
export const OPTIONAL = [
  { filter: 'ass', for: '`subtitles: burn` uses its own renderer instead (the word highlight steps word by word rather than sweeping)' },
  { encoder: 'libvpx-vp9', for: 'webm clips (clips: webm)' },
];
