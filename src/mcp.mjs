// MCP server (stdio) for coding agents (Cursor, Claude Code, …): the whole
// plan → check → render → look → fix loop, with renders running as background jobs
// so no client-side tool timeout can kill them.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from './inspect.mjs';
import { loadConfig } from './config.mjs';
import { build } from './build.mjs';
import { record } from './record.mjs';
import { guide } from './guide.mjs';
import { check, formatCheck } from './check.mjs';
import { initStoryboard } from './init.mjs';
import { openLoginWindow, finishLogin, authFileFor } from './auth.mjs';
import { ensureBrowser, ffmpegInstallCommand } from './doctor.mjs';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const WAIT_MS = Number(process.env.STORYSHOT_MCP_WAIT_MS ?? 45000); // stay under typical client tool timeouts

const image = (file) => ({ type: 'image', data: fs.readFileSync(file).toString('base64'), mimeType: file.endsWith('.png') ? 'image/png' : 'image/jpeg' });
const text = (t) => ({ type: 'text', text: t });
const fail = (t, extra = []) => ({ isError: true, content: [text(t), ...extra] });
const abs = (p) => path.resolve(p);

const server = new McpServer({ name: 'storyshot', version: pkg.version }, {
  instructions: [
    'Storyshot makes product demo, tutorial, course and docs videos of web apps from a YAML storyboard.',
    'Before writing anything, inspect_page the start url (it reports login walls), then confirm the brief with the user in ONE message:',
    'purpose (pitch/tutorial/course/docs), length, flow, voice, music, subtitles, language, and whether a login is needed (then call login).',
    'Workflow: storyboard_guide (once) → init_storyboard (or inspect_page) → edit the YAML → check_storyboard → render_video',
    '→ look at the returned preview image → fix → render again (mode "compose" if only captions/timing/zoom/voice changed).',
    'Renders take 1–3 minutes and run in the background: if render_video returns a job_id, call render_status until done.',
    'With a paid voice, iterate with draft: true (free local voice), then do the final render with mode "compose".',
  ].join(' '),
});

server.registerTool('storyboard_guide', {
  title: 'Storyboard guide',
  description: 'Read first. The playbook for planning a demo/tutorial/course/docs video and the complete storyboard YAML reference (actions, targets, zoom, voice, purposes, end card).',
  inputSchema: {},
}, async () => ({ content: [text(guide())] }));

server.registerTool('init_storyboard', {
  title: 'Create a starter storyboard',
  description: 'Inspect a URL and write a starter storyboard YAML that already uses verified click targets from that page (listed as comments at the bottom). Start here, then edit the file.',
  inputSchema: {
    url: z.string().describe('Start page of the web app'),
    path: z.string().optional().describe('Absolute path for the YAML (must not exist yet). Default: <cwd>/videos/<site>-<kind>[-<topic>].yaml, kind = promo/tutorial/lesson/docs from purpose'),
    purpose: z.enum(['pitch', 'tutorial', 'course', 'docs']).optional().describe('pitch = 15–30s promo (default); tutorial = narrated how-to; course = narrated lesson; docs = silent per-step GIFs'),
    topic: z.string().optional().describe('Short topic for the file name, e.g. "export-pdf" → videos/<site>-tutorial-export-pdf.yaml. Use it for tutorials/lessons, since a site usually gets several'),
    storage_state: z.string().optional().describe('Absolute path to a saved login (from the login tool) for apps behind a login'),
    ignore_https_errors: z.boolean().optional().describe('Accept a self-signed HTTPS certificate (internal sites only); also writes ignoreHTTPSErrors: true into the storyboard'),
  },
}, async ({ url, path: file, purpose = 'pitch', topic, storage_state, ignore_https_errors = false }) => {
  try {
    await ensureBrowser(() => {});
    const r = await initStoryboard(url, { purpose, topic, file: file ? abs(file) : undefined, storageState: storage_state ? abs(storage_state) : undefined, ignoreHTTPSErrors: ignore_https_errors });
    return { content: [text(`${r.login?.hint ? `ℹ Login: ${r.login.hint}. If the flow needs it, call login first.\n\n` : ''}Wrote ${r.file}:\n\n${r.yaml}`), image(r.screenshot)] };
  } catch (e) { return fail(`init failed: ${e.message}`); }
});

server.registerTool('inspect_page', {
  title: 'Inspect page',
  description: 'List a page\'s headings, sections, images and clickable elements as verified storyboard targets, plus a screenshot. ' +
    'Give `url` for a page reachable by URL, or `storyboard` + `after_step` to see the page as it is after running that storyboard\'s setup and steps 1..after_step ' +
    '(for states only reachable by clicking through, e.g. an editor after an upload). Never guess selectors — use targets from here.',
  inputSchema: {
    url: z.string().optional().describe('Page URL'),
    storyboard: z.string().optional().describe('Absolute path to a storyboard YAML (instead of url)'),
    after_step: z.number().int().min(0).optional().describe('With storyboard: run steps 1..N first (0 = only setup). Default: all steps.'),
    storage_state: z.string().optional().describe('With url: absolute path to a saved login (from the login tool)'),
    ignore_https_errors: z.boolean().optional().describe('With url: accept a self-signed HTTPS certificate (internal sites only)'),
    viewport_width: z.number().optional(),
    viewport_height: z.number().optional(),
  },
}, async ({ url, storyboard, after_step, storage_state, ignore_https_errors = false, viewport_width = 1600, viewport_height = 900 }) => {
  try {
    await ensureBrowser(() => {});
    if (storyboard) {
      const cfg = loadConfig(abs(storyboard));
      const r = await record(cfg, { log: () => {}, inspectAfter: after_step ?? cfg.steps.length });
      return { content: [text(r.text), image(r.screenshot)] };
    }
    if (!url) return fail('give either url or storyboard');
    const r = await inspect(url, { viewport: { width: viewport_width, height: viewport_height }, storageState: storage_state ? abs(storage_state) : undefined, ignoreHTTPSErrors: ignore_https_errors });
    return { content: [text(r.text), image(r.screenshot)] };
  } catch (e) {
    const extra = [];
    if (e.pageDescription) extra.push(text(`Page at the moment of failure:\n${e.pageDescription}`));
    if (e.screenshot && fs.existsSync(e.screenshot)) extra.push(image(e.screenshot));
    return fail(`inspect failed: ${e.message}`, extra);
  }
});

// --- login: the user logs in once in a plain Chrome window ---------------------------------------
// Two calls: the first opens the window and returns; after the user says they are logged in, the
// second (done: true) saves the session. Nothing watches the window in between, because Google
// sign-in breaks when a script probes it.
const logins = new Map();
server.registerTool('login', {
  title: 'Log in (user)',
  description: 'For apps behind a login. Call 1 (`url`): opens a normal Chrome window at `url` and returns at once. ' +
    'Then tell the user: "A Chrome window opened. Log in there (Sign in with Google and 2FA work). When you see the app logged in, ' +
    'leave the window open and reply \'done\'." Never type passwords yourself, and do NOT make call 2 until the user replies. ' +
    'Call 2 (same `url`, `done: true`): saves the session to a file (added to .gitignore) and closes the window. ' +
    'Then use the file as storage_state in inspect_page/init_storyboard and as `storageState:` in the storyboard.',
  inputSchema: {
    url: z.string().describe('A page of the app that requires login (its login page or a page behind it)'),
    done: z.boolean().optional().describe('true only after the user has said they are logged in'),
    path: z.string().optional().describe('Absolute path for the session file. Default: <cwd>/videos/<site>-login.json'),
  },
}, async ({ url, done, path: file }) => {
  const out = abs(file ?? authFileFor(url));
  if (!done) {
    const old = logins.get(out);
    if (old && !old.exited) return { content: [text(`The login window for ${url} is already open. Ask the user to log in there and reply when done, then call login with done: true.`)] };
    await ensureBrowser(() => {});
    try { logins.set(out, openLoginWindow(url)); } catch (e) { return fail(e.message); }
    return { content: [text(`A Chrome window is open at ${url}. Tell the user: log in there (Sign in with Google and 2FA work); when the app shows them logged in, leave the window open and reply "done". ` +
      'Wait for their reply, then call login again with the same url and done: true.')] };
  }
  const session = logins.get(out);
  if (!session) return fail('no login window is open for this url — call login without done first');
  logins.delete(out);
  let r;
  try { r = await finishLogin(session, { file: out }); } catch (e) { return fail(`login failed: ${e.message}`); }
  return { content: [text(`✔ Saved the login session to ${r.file} (${r.how}, ${r.cookies} cookies, ${r.siteCookies} for this site${r.sessionStorage ? `, sessionStorage for ${r.sessionStorage} site(s)` : ''}).${r.gitignore ? ` Added it to ${r.gitignore}.` : ''}\n` +
    `Next: inspect_page with storage_state "${r.file}" to confirm you see the logged-in app, and put \`storageState: ${path.basename(r.file)}\` (path relative to the yaml) in the storyboard.` +
    (r.siteCookies || r.sessionStorage ? '' : '\nNote: no cookies were saved for this site — the user may not have finished logging in; inspect will show the login wall again if so.'))] };
});

server.registerTool('check_storyboard', {
  title: 'Check storyboard',
  description: 'Validate a storyboard YAML in about a second (YAML syntax, unknown fields and typos, action and target shapes, missing API keys) without opening a browser. Run it after every edit, before render_video.',
  inputSchema: { storyboard: z.string().describe('Absolute path to the storyboard YAML') },
}, async ({ storyboard }) => {
  const r = check(abs(storyboard));
  return { isError: !r.ok, content: [text(formatCheck(r))] };
});

// --- background render jobs -------------------------------------------------------------------
const jobs = new Map();
let seq = 0;

function startJob(storyboard, mode, draft) {
  const running = [...jobs.values()].find((j) => j.storyboard === storyboard && !j.done);
  if (running) return running;
  const job = { id: `r${++seq}`, storyboard, mode, draft, logs: [], done: false, started: Date.now() };
  job.promise = (async () => {
    try {
      const cfg = loadConfig(storyboard, { draft });
      job.result = await build(cfg, mode, { log: (m) => job.logs.push(m) });
    } catch (e) { job.error = e; } finally { job.done = true; }
  })();
  jobs.set(job.id, job);
  return job;
}

async function waitFor(job, progress) {
  const deadline = Date.now() + WAIT_MS;
  let seen = 0;
  while (!job.done && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    if (job.logs.length !== seen) { seen = job.logs.length; progress?.(job.logs.at(-1)); }
  }
  return report(job);
}

function report(job) {
  const secs = Math.round((Date.now() - job.started) / 1000);
  if (!job.done) {
    return { content: [text(`Still rendering (${secs}s so far) — job_id "${job.id}". Call render_status with this job_id to keep waiting.\nLatest: ${job.logs.slice(-3).join(' | ')}`)] };
  }
  if (job.error) {
    const e = job.error, extra = [];
    if (e.pageDescription) extra.push(text(`Page at the moment of failure (use these targets):\n${e.pageDescription}`));
    if (e.screenshot && fs.existsSync(e.screenshot)) extra.push(image(e.screenshot));
    return fail(`✖ ${e.message}\n\nLog:\n${job.logs.slice(-15).join('\n')}`, extra);
  }
  const r = job.result;
  if (!r.out) return { content: [text(`Recorded (${secs}s). Now render_video with mode "compose".`)] };
  const next = r.warnings.length ? 'Fix the ⚠ warnings, then re-render (mode "compose" if no actions changed).'
    : job.draft ? 'Draft looks right? Render the final voice with mode "compose" and draft: false (reuses this recording).'
      : 'Check every frame of the preview below; if all good, give the user the video path.';
  return {
    content: [text([`✔ ${r.out} (${r.duration.toFixed(1)}s, ${secs}s to build)`, ...(r.extras ?? []).filter((f) => !/-steps\//.test(f)).map((f) => `+ ${f}`),
      ...r.warnings.map((w) => `⚠ ${w}`), '', `Next: ${next}`, '', 'Log:', ...job.logs].join('\n')), image(r.preview)],
  };
}

server.registerTool('render_video', {
  title: 'Render video',
  description: 'Render a storyboard YAML to MP4 and return the output path, warnings, the per-step timing log and a preview contact sheet (one frame per step) to check. ' +
    'mode "render" records the site then composes (1–3 min); "compose" reuses the last recording (seconds–1 min) — use it when no actions changed; "record" only records. ' +
    `Waits up to ${Math.round(WAIT_MS / 1000)}s; if not finished it returns a job_id — then call render_status.`,
  inputSchema: {
    storyboard: z.string().describe('Absolute path to the storyboard YAML'),
    mode: z.enum(['render', 'compose', 'record']).optional().describe('Default "render"'),
    draft: z.boolean().optional().describe('Use the free local voice instead of ElevenLabs/OpenAI and write <out>.draft.mp4. Iterate with draft: true; final render with mode "compose", draft: false.'),
  },
}, async ({ storyboard, mode = 'render', draft = false }, extra) => {
  const file = abs(storyboard);
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch {
    return fail(`ffmpeg is not installed. Run this in the terminal (ask the user to approve it), then call render_video again:\n  ${ffmpegInstallCommand()}`);
  }
  try { await ensureBrowser(() => {}); } catch (e) { return fail(`Chromium could not be installed: ${e.message.split('\n')[0]}`); }
  const c = check(file, { draft });
  if (!c.ok) return fail(`Storyboard has problems — fix them first:\n${formatCheck(c)}`);
  const job = startJob(file, mode, draft);
  const token = extra?._meta?.progressToken;
  let n = 0;
  return waitFor(job, token == null ? null : (msg) => extra.sendNotification({
    method: 'notifications/progress', params: { progressToken: token, progress: ++n, message: String(msg).slice(0, 200) },
  }).catch(() => {}));
});

server.registerTool('render_status', {
  title: 'Render status',
  description: `Wait (up to ${Math.round(WAIT_MS / 1000)}s) for a background render started by render_video and return its result, or its progress if still running.`,
  inputSchema: { job_id: z.string() },
}, async ({ job_id }) => {
  const job = jobs.get(job_id);
  if (!job) return fail(`no render job "${job_id}" (jobs only live as long as this MCP server process)`);
  return waitFor(job);
});

await server.connect(new StdioServerTransport());
