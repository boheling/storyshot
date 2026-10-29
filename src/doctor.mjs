// Make sure everything Storyshot needs is there, installing what can be installed without
// admin rights (Chromium for Playwright). ffmpeg comes from the system package manager, so we
// return the exact command for the agent to run.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { hasFilter, hasEncoder, NEEDED, OPTIONAL } from './ffmpeg.mjs';
import { zhVoiceStatus } from './kokoro-zh.mjs';
import { hyperframesCli, HF_VERSION } from './hyperframes.mjs';

const has = (cmd, args = ['--version']) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; } };

export function ffmpegInstallCommand() {
  if (process.platform === 'darwin') return has('brew') ? 'brew install ffmpeg' : 'install Homebrew (https://brew.sh), then: brew install ffmpeg';
  if (process.platform === 'win32') return 'winget install --id Gyan.FFmpeg -e   (then open a new terminal)';
  if (has('apt-get')) return 'sudo apt-get install -y ffmpeg';
  if (has('dnf')) return 'sudo dnf install -y ffmpeg';
  if (has('pacman')) return 'sudo pacman -S --noconfirm ffmpeg';
  return 'install ffmpeg with your package manager';
}

export async function browserReady() {
  try { const b = await chromium.launch(); await b.close(); return true; } catch (e) {
    if (/Executable doesn't exist|playwright install/i.test(e.message)) return false;
    throw e;
  }
}

export function installBrowser(log = console.log) {
  log('downloading Chromium for Playwright (one time, ~150 MB)…');
  const cli = path.join(path.dirname(createRequire(import.meta.url).resolve('playwright/package.json')), 'cli.js');
  execFileSync(process.execPath, [cli, 'install', 'chromium'], { stdio: ['ignore', 'ignore', 'pipe'] });
}

let browserChecked = false;
// For every command that opens a browser: install Chromium on first use instead of failing.
export async function ensureBrowser(log = console.log) {
  if (browserChecked) return;
  if (!(await browserReady())) installBrowser(log);
  browserChecked = true;
}

// Returns { ok, report, todo }: `todo` is what the agent still has to run itself.
export async function doctor({ log = console.log } = {}) {
  const lines = [], todo = [];
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 18) lines.push(`✔ Node ${process.versions.node}`);
  else { lines.push(`✖ Node ${process.versions.node} (needs 18+)`); todo.push('install Node 18 or newer (https://nodejs.org)'); }

  try {
    const v = execFileSync('ffmpeg', ['-version']).toString().match(/ffmpeg version (\S+)/)?.[1];
    // a build can lack pieces Storyshot uses: say which, and what that affects
    const missing = [...NEEDED.filters.filter((f) => !hasFilter(f)), ...NEEDED.encoders.filter((e) => !hasEncoder(e))];
    if (missing.length) {
      lines.push(`✖ ffmpeg ${v ?? ''} is missing ${missing.join(', ')}`);
      todo.push(`install an ffmpeg build with ${missing.join(', ')} (${process.platform === 'darwin' ? 'e.g. brew install ffmpeg-full, then put "$(brew --prefix ffmpeg-full)/bin" first on your PATH, as it is keg-only; or a static build from https://ffmpeg.org/download.html' : 'e.g. a static build from https://ffmpeg.org/download.html'})`);
    } else lines.push(`✔ ffmpeg ${v ?? ''}`.trim());
    for (const o of OPTIONAL) {
      if (o.filter ? !hasFilter(o.filter) : !hasEncoder(o.encoder)) lines.push(`· ffmpeg has no ${o.filter ? `${o.filter} filter` : `${o.encoder} encoder`} — ${o.for}`);
    }
  } catch {
    lines.push('✖ ffmpeg not found');
    todo.push(ffmpegInstallCommand());
  }

  try {
    if (await browserReady()) lines.push('✔ Chromium');
    else { installBrowser(log); lines.push('✔ Chromium (just installed)'); }
  } catch (e) {
    lines.push(`✖ Chromium: ${e.message.split('\n')[0]}`);
    todo.push(process.platform === 'linux' ? 'npx playwright install --with-deps chromium' : 'npx playwright install chromium');
  }

  try { await import('kokoro-js'); lines.push('✔ free local voice (kokoro)'); } catch { lines.push('· free local voice (kokoro) not installed — optional: npm i kokoro-js'); }
  // Mandarin (kokoro zf_001…): its G2P runs in a Python 3.10–3.12 venv that storyshot creates on first use
  const zh = zhVoiceStatus();
  lines.push(zh.ready ? `✔ Chinese voice (kokoro zf_001): Python ${zh.python?.version ?? '?'} venv in ${zh.venv}`
    : zh.python ? `· Chinese voice (kokoro zf_001): Python ${zh.python.version} found; storyshot sets up its venv in ${zh.venv} on first use`
      : '· Chinese voice (kokoro zf_001) needs Python 3.10–3.12 — optional: brew install python@3.12, or uv python install 3.12 (or set STORYSHOT_PYTHON)');
  const hf = hyperframesCli();
  lines.push(hf.error ? `· HyperFrames cards (hyperframes: true) unavailable — optional: ${hf.error}`
    : hf.missing ? `· HyperFrames cards (hyperframes: true): ${HF_VERSION} installs itself on first use`
      : `✔ HyperFrames cards (${hf.how})`);
  lines.push(process.env.ELEVENLABS_API_KEY ? '✔ ELEVENLABS_API_KEY set' : '· ELEVENLABS_API_KEY not set — optional, for the best voice (put it in .env)');
  return { ok: !todo.length, report: lines.join('\n'), todo };
}
