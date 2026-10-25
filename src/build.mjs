// record → compose → soundtrack, shared by the CLI and the MCP server.
import { record } from './record.mjs';
import { compose } from './compose.mjs';
import { soundtrack } from './audio.mjs';
import { measureVoice } from './voice.mjs';
import { writeOutputs, burnSubtitles } from './outputs.mjs';

export async function build(cfg, mode = 'render', { log = console.log } = {}) {
  const t0 = Date.now();
  if (mode !== 'compose') await record(cfg, { log });
  if (mode === 'record') return { warnings: [] };
  const voiceLens = await measureVoice(cfg, { log });
  const { silent, clean, events, preview, warnings, captions, cards, segs } = await compose(cfg, { log, voiceLens });
  const audio = await soundtrack(cfg, events, silent, { log });
  if (cfg.subtitles === 'burn') await burnSubtitles(cfg, audio.narration ?? [], { log });
  const extras = await writeOutputs(cfg, { captions, cards, segs, clean, narration: audio.narration, total: events.total }, { log });
  return { out: audio.out, extras, preview, warnings: [...warnings, ...audio.warnings], duration: events.total, seconds: Math.round((Date.now() - t0) / 1000) };
}
