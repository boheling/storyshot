// Make sure everything Storyshot needs is there, installing what can be installed without
// admin rights (Chromium for Playwright). ffmpeg comes from the system package manager, so we
// return the exact command for the agent to run.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

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
    lines.push(`✔ ffmpeg ${v ?? ''}`.trim());
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
  lines.push(process.env.ELEVENLABS_API_KEY ? '✔ ELEVENLABS_API_KEY set' : '· ELEVENLABS_API_KEY not set — optional, for the best voice (put it in .env)');
  return { ok: !todo.length, report: lines.join('\n'), todo };
}
