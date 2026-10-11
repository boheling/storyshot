// Logged-in apps: detect login walls, and `storyshot login` — the user logs in once in a real
// browser window and the session (cookies, localStorage, IndexedDB) is saved for recording.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { VIDEO_DIR, siteOf } from './config.mjs';

const LOGIN_URL = /\/(log-?in|sign-?in|signin|auth|sso|oauth|session\/new|account\/login)\b|accounts\.google\.com|login\.microsoftonline|github\.com\/login|auth0\.com|clerk\.|okta\.com/i;

// { wall: true, reason } when the page is asking to log in; { hint } when the site merely has a
// "Log in" link (so parts of the flow may need a session).
export async function detectLogin(page) {
  const dom = await page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const password = [...document.querySelectorAll('input[type=password]')].some(vis);
    const link = [...document.querySelectorAll('a,button')].filter(vis).map((e) => e.textContent.trim()).find((t) => /^(log ?in|sign ?in|登录|登入)$/i.test(t));
    return { password, link, title: document.title };
  }).catch(() => ({}));
  const url = page.url();
  if (dom.password) return { wall: true, reason: `a password field is showing (${url})` };
  if (LOGIN_URL.test(url)) return { wall: true, reason: `the page is a login page (${url})` };
  if (dom.link) return { wall: false, hint: `the site has a "${dom.link}" button — anything behind it needs a saved login` };
  return { wall: false };
}

export const loginAdvice = (url, file = authFileFor(url)) =>
  `Ask the user to log in once: \`storyshot login ${url}\` (MCP tool: login) opens a browser window; they log in, ` +
  `the session is saved to ${file}, then add \`storageState: ${path.basename(file)}\` to the storyboard.`;

export const authFileFor = (url, dir = VIDEO_DIR) => path.join(dir, `${siteOf(url)}-login.json`);

// true / false, or null when not inside a git repository
export function gitIgnored(file) {
  try { execFileSync('git', ['check-ignore', '-q', path.resolve(file)], { cwd: path.dirname(path.resolve(file)), stdio: 'ignore' }); return true; } catch (e) {
    return e.status === 1 ? false : null;
  }
}

// Make sure the session file never gets committed: add it to the .gitignore of the repo (or cwd).
function ignore(file) {
  if (gitIgnored(file) === true) return null;
  let root = process.cwd();
  try { root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: path.dirname(path.resolve(file)) }).toString().trim(); } catch {}
  const gi = path.join(root, '.gitignore');
  const rel = path.relative(root, path.resolve(file)).split(path.sep).join('/');
  const cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  if (cur.split('\n').includes(rel)) return null;
  fs.writeFileSync(gi, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}# Storyshot login session (contains your session cookies — never commit)\n${rel}\n`);
  return gi;
}

// Open a visible browser at `url`; save the session when the user has logged in (a login wall
// appeared and then went away) or closes the window. Resolves with the saved file.
export async function login(url, { file = authFileFor(url), viewport = { width: 1600, height: 900 }, timeoutMs = 10 * 60_000, log = console.log } = {}) {
  let browser;
  try { browser = await chromium.launch({ headless: false }); } catch (e) {
    throw new Error(`could not open a browser window (${e.message.split('\n')[0]}). Log in on a machine with a screen ` +
      `(storyshot login ${url} --save ${file}) and copy the file here.`);
  }
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  log(`A browser window is open at ${url}. Log in there (2FA and "Sign in with Google" work).`);
  log('The session is saved automatically once you are logged in — or close the window when done.');
  let state = null, sawWall = false, clearFor = 0, done = 'timeout';
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (!browser.isConnected() || page.isClosed()) { done = 'closed'; break; }
    try {
      state = await context.storageState({ indexedDB: true });
      const d = await detectLogin(page);
      if (d.wall) { sawWall = true; clearFor = 0; } else if (sawWall && ++clearFor >= 3) { done = 'logged in'; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  await browser.close().catch(() => {});
  if (!state) throw new Error('the browser was closed before anything could be saved — run login again');
  if (done === 'timeout') log('warning: timed out waiting for the login; saving the session as it is');
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 1));
  const gi = ignore(file);
  return { file: path.resolve(file), how: done, gitignore: gi, cookies: state.cookies.length, sawWall };
}
