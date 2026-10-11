// Extra deliverables next to the MP4: SRT subtitles, YouTube chapters, per-step clips.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const plain = (s) => String(s).replace(/\*\*/g, '');
const srtTime = (t) => {
  const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const slug = (s) => plain(s).toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export async function writeOutputs(cfg, { captions, segs, narration, total }, { log = console.log } = {}) {
  const base = cfg.out.replace(/\.[^.]+$/, '');
  const files = [];

  // Subtitles: the spoken narration if there is any, otherwise the captions.
  if (cfg.subtitles) {
    const cues = narration?.length ? narration : captions.map((c) => ({ start: c.t[0] + 0.1, end: c.t[1] - 0.1, text: plain(c.text) }));
    const srt = cues.map((c, k) => `${k + 1}\n${srtTime(c.start)} --> ${srtTime(Math.max(c.end, c.start + 0.8))}\n${c.text}\n`).join('\n');
    fs.writeFileSync(`${base}.srt`, srt);
    files.push(`${base}.srt`);
  }

  // YouTube chapters (paste into the description): one per caption, first at 0:00.
  if (cfg.chapters && captions.length) {
    const lines = captions.map((c, k) => `${clock(k === 0 ? 0 : c.t[0])} ${cfg.stepNumbers ? `${c.n}. ` : ''}${plain(c.text)}`);
    fs.writeFileSync(`${base}.chapters.txt`, `${lines.join('\n')}\n`);
    files.push(`${base}.chapters.txt`);
    if (total < 30 || captions.length < 3) log('note: YouTube only shows chapters for videos with ≥3 chapters of ≥10s each');
  }

  // One clip per visible step, for docs / help-center embeds.
  if (cfg.clips) {
    const dir = `${base}-steps`;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const W = Math.min(cfg.output.width, cfg.clips === 'gif' ? 960 : 1280);
    for (const [k, g] of segs.entries()) {
      const name = `${String(k + 1).padStart(2, '0')}${g.caption ? `-${slug(g.caption)}` : ''}.${cfg.clips}`;
      const f = path.join(dir, name), span = ['-ss', g.o0.toFixed(3), '-t', (g.o1 - g.o0).toFixed(3), '-i', cfg.out];
      if (cfg.clips === 'gif') {
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...span, '-filter_complex',
          `fps=12,scale=${W}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`, f]);
      } else if (cfg.clips === 'webm') {
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...span, '-an', '-vf', `scale=${W}:-2`, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-row-mt', '1', f]);
      } else {
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...span, '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-c:a', 'aac', '-movflags', '+faststart', f]);
      }
      files.push(f);
    }
    log(`clips: ${segs.length} × ${cfg.clips} in ${dir}`);
  }
  return files;
}
