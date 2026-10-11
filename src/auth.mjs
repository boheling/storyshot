// Logged-in apps: detect login walls, and `storyshot login` — the user logs in once in a real
// browser window and the session (cookies, localStorage, IndexedDB) is saved for recording.
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import os from 'node:os';
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
  try { root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: path.dirname(path.resolve(file)), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
  const gi = path.join(root, '.gitignore');
  const rel = path.relative(root, path.resolve(file)).split(path.sep).join('/');
  if (rel.startsWith('../') || path.isAbsolute(rel)) return null; // outside the project: nothing to ignore
  const cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  if (cur.split('\n').includes(rel)) return null;
  fs.writeFileSync(gi, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}# Storyshot login session (contains your session cookies — never commit)\n${rel}\n`);
  return gi;
}

// --- login ------------------------------------------------------------------------------------
// The user logs in in a plain Chrome window that NOTHING is attached to while they do it: Google
// (and other SSO providers) refuse automated browsers, polling the page from a script makes
// Google's sign-in bounce between the app and accounts.google.com, and even an open DevTools port
// gets "This browser or app may not be secure". So Chrome runs with only a temporary profile; when
// the user is done we quit it and read the session back from that profile.

function chromeExecutable() {
  const home = os.homedir();
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')]
    : process.platform === 'win32'
      ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map((d) => path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find((c) => fs.existsSync(c)) ?? chromium.executablePath();
}

// Opens the window and returns at once. Pass the result to finishLogin() when the user is done.
export function openLoginWindow(url, { viewport = { width: 1600, height: 900 }, headless = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyshot-login-'));
  // "Continue where you left off" also keeps session cookies when the user closes the window.
  fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Default', 'Preferences'), JSON.stringify({ session: { restore_on_startup: 1 } }));
  const exe = chromeExecutable();
  const args = [`--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    `--window-size=${viewport.width},${viewport.height}`, ...(headless ? ['--headless=new'] : []), url];
  let proc;
  try { proc = spawn(exe, args, { stdio: 'ignore' }); } catch (e) {
    throw new Error(`could not open a browser window (${e.message}). Log in on a machine with a screen (storyshot login ${url}) and copy the file here.`);
  }
  const session = { url, dir, exe, proc, exited: false };
  proc.on('exit', () => { session.exited = true; });
  proc.on('error', () => { session.exited = true; });
  return session;
}

// Quit the window (if the user hasn't), read the session back from its profile, save it and delete
// the temporary profile.
export async function finishLogin(session, { file = authFileFor(session.url), log = console.log } = {}) {
  const { url, dir, exe, proc } = session;
  const how = session.exited ? 'window closed' : 'logged in';
  let state;
  try {
    if (!session.exited) {
      // SIGTERM makes Chrome shut down cleanly and flush cookies; force it if it hangs
      proc.kill('SIGTERM');
      const t = setTimeout(() => proc.kill('SIGKILL'), 10_000);
      await new Promise((r) => (session.exited ? r() : proc.once('exit', r)));
      clearTimeout(t);
    }
    // --restore-last-session reopens the user's tabs, which brings back their sessionStorage (some
    // apps, e.g. Microsoft MSAL, keep the login token there; storageState() doesn't capture it)
    const context = await chromium.launchPersistentContext(dir, { executablePath: exe, headless: true, args: ['--restore-last-session'] });
    await new Promise((r) => setTimeout(r, 1000));
    const sessionStorage = {};
    for (const p of context.pages()) {
      if (!/^https?:/.test(p.url())) continue;
      await p.waitForLoadState('load', { timeout: 15_000 }).catch(() => {});
      const items = await p.evaluate(() => Object.entries(window.sessionStorage)).catch(() => []);
      if (items.length) Object.assign(sessionStorage[new URL(p.url()).origin] ??= {}, Object.fromEntries(items));
    }
    // load the app once in a fresh tab, so its localStorage / IndexedDB are part of the snapshot
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 }).catch(() => {});
    state = await context.storageState({ indexedDB: true });
    const extra = Object.entries(sessionStorage).map(([origin, items]) => ({ origin, items: Object.entries(items).map(([name, value]) => ({ name, value })) }));
    if (extra.length) state.sessionStorage = extra;
    await context.close().catch(() => {});
  } finally {
    if (!session.exited) proc.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  const host = new URL(url).hostname.replace(/^www\./, '');
  const siteCookies = state.cookies.filter((c) => host.endsWith(c.domain.replace(/^\./, '')) || c.domain.replace(/^\./, '').endsWith(host)).length;
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 1));
  const gi = ignore(file);
  return { file: path.resolve(file), how, gitignore: gi, cookies: state.cookies.length, siteCookies, sessionStorage: state.sessionStorage?.length ?? 0 };
}

// A browser context with a saved login: storageState plus the sessionStorage that login() saved
// alongside it (Playwright has no sessionStorage in storageState, so it is restored by a script).
export async function sessionContext(browser, { storageState, ...options } = {}) {
  let state = storageState;
  if (typeof state === 'string') state = JSON.parse(fs.readFileSync(state, 'utf8'));
  const { sessionStorage, ...rest } = state ?? {};
  const context = await browser.newContext({ ...options, storageState: state ? rest : undefined });
  if (sessionStorage?.length) {
    await context.addInitScript((saved) => {
      const s = saved.find((o) => o.origin === location.origin);
      if (s) for (const { name, value } of s.items) if (window.sessionStorage.getItem(name) === null) window.sessionStorage.setItem(name, value);
    }, sessionStorage);
  }
  return context;
}

// CLI: open the window, wait for Enter (or the window closing), then save.
export async function login(url, { file = authFileFor(url), viewport, log = console.log } = {}) {
  const session = openLoginWindow(url, { viewport });
  log(`A Chrome window is open at ${url}. Log in there (2FA and "Sign in with Google" work).`);
  log('When you see the app logged in, come back here and press Enter (or just close the window).');
  await new Promise((resolve) => {
    const done = () => { process.stdin.pause(); resolve(); };
    process.stdin.resume(); process.stdin.once('data', done);
    session.proc.once('exit', done);
  });
  return finishLogin(session, { file, log });
}
