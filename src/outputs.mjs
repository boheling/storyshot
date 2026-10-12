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

export async function writeOutputs(cfg, { captions, cards = [], segs, narration, total }, { log = console.log } = {}) {
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
  if (cfg.chapters && (captions.length || cards.length)) {
    // section cards make the chapters when there are any; otherwise one chapter per caption
    const lines = cards.length
      ? [...(cards[0].t > 1 ? [`0:00 Introduction`] : []), ...cards.map((c, k) => `${clock(k === 0 && cards[0].t <= 1 ? 0 : c.t)} ${plain(c.title)}`)]
      : captions.map((c, k) => `${clock(k === 0 ? 0 : c.t[0])} ${cfg.stepNumbers ? `${c.n}. ` : ''}${plain(c.text)}`);
    fs.writeFileSync(`${base}.chapters.txt`, `${lines.join('\n')}\n`);
    files.push(`${base}.chapters.txt`);
    if (total < 30 || captions.length < 3) log('note: YouTube only shows chapters for videos with ≥3 chapters of ≥10s each');
  }

  // Per-step files for docs / help-center articles: clips cropped to what the step is about, an
  // annotated still of each step's result, and a ready-to-paste Markdown article that uses them.
  if (cfg.clips.length) {
    const dir = `${base}-steps`;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const article = [`# ${plain(cfg.intro?.title ?? cfg.name)}`, ''];
    for (const [k, g] of segs.entries()) {
      const stem = `${String(k + 1).padStart(2, '0')}${g.caption ? `-${slug(g.caption)}` : ''}`;
      const crop = g.crop ? `crop=${g.crop.w}:${g.crop.h}:${g.crop.x}:${g.crop.y},` : '';
      const cw = g.crop?.w ?? cfg.output.width;
      const span = ['-ss', g.o0.toFixed(3), '-t', (g.o1 - g.o0).toFixed(3), '-i', cfg.out];
      const made = [];
      for (const kind of cfg.clips) {
        const f = path.join(dir, `${stem}.${kind}`);
        if (kind === 'gif') {
          const w = Math.min(cw, 960);
          execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...span, '-filter_complex',
            `${crop}fps=12,scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`, f]);
        } else if (kind === 'png') {
          execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', Math.max(g.o0, g.o1 - 0.2).toFixed(3), '-i', cfg.out, '-frames:v', '1', ...(crop ? ['-vf', crop.slice(0, -1)] : []), f]);
        } else if (kind === 'webm') {
          execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...span, '-an', '-vf', `${crop}scale=${Math.min(cw, 1280)}:-2`, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-row-mt', '1', f]);
        } else {
          execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...span, ...(crop ? ['-vf', crop.slice(0, -1)] : []), '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-c:a', 'aac', '-movflags', '+faststart', f]);
        }
        files.push(f); made.push(path.basename(f));
      }
      article.push(`${k + 1}. **${plain(g.caption ?? `Step ${k + 1}`)}**${g.doc ? `\n\n   ${plain(g.doc)}` : ''}`, '');
      const show = made.find((m) => m.endsWith('.gif') || m.endsWith('.png'));
      if (show) article.push(`   ![${plain(g.caption ?? `Step ${k + 1}`)}](${encodeURI(show)})`, '');
    }
    fs.writeFileSync(path.join(dir, 'README.md'), article.join('\n'));
    files.push(path.join(dir, 'README.md'));
    log(`clips: ${segs.length} steps × ${cfg.clips.join(' + ')} in ${dir}, plus README.md (the article)`);
  }
  return files;
}

// `subtitles: burn`: the narration burned into the video, a few words at a time, each word lighting
// up as it is spoken (karaoke). Word timing is estimated from word length within each spoken line.
export function burnSubtitles(cfg, narration, { log = console.log } = {}) {
  if (!narration.length) return log('note: subtitles: burn needs narration (say: lines and a voice); nothing burned in');
  const { width: W, height: H } = cfg.output;
  const bgr = (hex, a = '00') => { const h = hex.replace('#', ''); return `&H${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase(); };
  const t = (s) => { const cs = Math.round(s * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
  const size = Math.round(H * 0.048), edge = Math.max(2, Math.round(size * 0.09));
  const events = [];
  for (const line of narration) {
    const words = plain(line.text).split(/\s+/).filter(Boolean);
    const weight = (w) => w.replace(/[^\p{L}\p{N}]/gu, '').length + 2;
    const total = words.reduce((a, w) => a + weight(w), 0), span = line.end - line.start;
    let at = line.start;
    const timed = words.map((w) => { const d = (span * weight(w)) / total; const r = { w, start: at, d }; at += d; return r; });
    // chunks of up to 7 words, broken after sentence punctuation
    let chunk = [];
    const flush = () => {
      if (!chunk.length) return;
      const s0 = chunk[0].start, e0 = chunk.at(-1).start + chunk.at(-1).d;
      events.push(`Dialogue: 0,${t(s0)},${t(e0 + 0.05)},Sub,,0,0,0,,${chunk.map((x) => `{\\kf${Math.round(x.d * 100)}}${x.w.replace(/[{}]/g, '')}`).join(' ')}`);
      chunk = [];
    };
    for (const x of timed) { chunk.push(x); if (chunk.length >= 7 || /[.!?;:]$/.test(x.w)) flush(); }
    flush();
  }
  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,${cfg.theme.font},${size},${bgr(cfg.theme.accent)},&H00FFFFFF,${bgr(cfg.theme.ink)},&H80000000,1,0,0,0,100,100,0,0,1,${edge},${Math.round(edge * 0.8)},2,${Math.round(W * 0.08)},${Math.round(W * 0.08)},${Math.round(H * 0.06)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`;
  const file = path.join(cfg.work, 'subtitles.ass'), tmp = cfg.out.replace(/(\.[^.]+)$/, '.burn$1');
  fs.writeFileSync(file, ass);
  // the filter argument is parsed by ffmpeg: escape the characters it treats specially in paths
  const arg = file.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', cfg.out, '-vf', `ass='${arg}'`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', tmp]);
  fs.renameSync(tmp, cfg.out);
  log(`subtitles: burned in ${events.length} lines with word-by-word highlight`);
}
