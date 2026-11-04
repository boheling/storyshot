// record → compose → soundtrack, shared by the CLI and the MCP server.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { record } from './record.mjs';
import { compose } from './compose.mjs';
import { soundtrack } from './audio.mjs';
import { measureVoice } from './voice.mjs';
import { writeOutputs, burnSubtitles } from './outputs.mjs';

export async function build(cfg, mode = 'render', { log = console.log } = {}) {
  const t0 = Date.now();
  // a storyboard of scenes only (an explainer) has no web app to record: an empty recording stands in
  if (!cfg.url) noRecording(cfg);
  else if (mode !== 'compose') await record(cfg, { log });
  if (mode === 'record') return { warnings: [] };
  const voiceLens = await measureVoice(cfg, { log });
  const { silent, clean, events, preview, warnings, captions, cards, segs } = await compose(cfg, { log, voiceLens });
  const audio = await soundtrack(cfg, events, silent, { log });
  if (cfg.subtitles === 'burn') await burnSubtitles(cfg, audio.narration ?? [], { log });
  const extras = await writeOutputs(cfg, { captions, cards, segs, clean, narration: audio.narration, total: events.total }, { log });
  return { out: audio.out, extras, preview, warnings: [...warnings, ...audio.warnings], duration: events.total, seconds: Math.round((Date.now() - t0) / 1000) };
}

// The recording of a storyboard with nothing to record: one black frame, every step empty.
export function noRecording(cfg) {
  fs.mkdirSync(path.join(cfg.work, 'raw'), { recursive: true });
  const frame = path.join(cfg.work, 'raw', 'blank.jpg');
  if (!fs.existsSync(frame)) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black:s=${cfg.output.width}x${cfg.output.height}`, '-frames:v', '1', frame]);
  const steps = cfg.steps.map((s) => ({ start: 0, end: 0, hidden: !!s.hidden, zoomBox: null, zoomTarget: null, waits: [], holds: 0, marks: [] }));
  fs.writeFileSync(path.join(cfg.work, 'timeline.json'), JSON.stringify({ frames: [{ t: 0, file: 'blank.jpg' }], steps, clicks: [], navs: [], gotos: [], urls: [], app: null, introLogo: null, scale: cfg.scale }, null, 1));
}
