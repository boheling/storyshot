#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { loadConfig, loadEnv } from '../src/config.mjs';
import { inspect } from '../src/inspect.mjs';
import { build } from '../src/build.mjs';
import { check, formatCheck } from '../src/check.mjs';

const USAGE = `storyshot — turn a YAML storyboard into a product demo, tutorial or course video

Usage:
  storyshot init <url> [--purpose pitch|tutorial|course|docs] [--topic export-pdf] [--storage <site>-login.json]
                                    write a starter storyboard using verified targets from the page,
                                    named by type: videos/<site>-promo|tutorial|lesson|docs[-<topic>].yaml
  storyshot login <url> [--save videos/<site>-login.json]
                                    open a browser window to log in once; saves the session for
                                    \`storageState:\` (and adds it to .gitignore)
  storyshot inspect <url> [--storage <site>-login.json]
                                    list a page's headings, sections and verified click targets
  storyshot inspect <storyboard.yaml> [--after N]
                                    same, for the page as it is after the storyboard's steps 1..N
  storyshot check   <storyboard.yaml>     validate the storyboard in a second (no browser)
  storyshot render  <storyboard.yaml>     record the site, then compose video + soundtrack
  storyshot compose <storyboard.yaml>     re-compose from the last recording
                                    (after changing captions, durations, zoom, music, voice, end card)
  storyshot record  <storyboard.yaml>     only (re-)record the browser session
  storyshot guide                   print the agent playbook + storyboard reference
  storyshot setup cursor|claude     add the MCP server + playbook to this project for Cursor / Claude Code,
                                    and install / check everything Storyshot needs
  storyshot doctor                  check (and install what it can of) Chromium, ffmpeg, voices
  storyshot mcp                     run as an MCP server (stdio)

Options:
  --draft   (render/compose) use the free local voice instead of a paid TTS provider and write
            <out>.draft.mp4; when it looks right, run \`compose\` without --draft (reuses the recording)
  --viewport 1600x900   (inspect, init)
`;

const args = process.argv.slice(2);
const [cmd, arg] = args;
const flag = (name) => { const i = args.indexOf(`--${name}`); return i > 0 ? args[i + 1] : undefined; };
const NEEDS_ARG = ['login', 'init', 'inspect', 'check', 'render', 'compose', 'record', 'setup'];
if (![...NEEDS_ARG, 'mcp', 'guide', 'doctor'].includes(cmd) || (NEEDS_ARG.includes(cmd) && !arg)) {
  process.stdout.write(USAGE);
  process.exit(['--help', '-h', 'help'].includes(cmd) ? 0 : 1);
}
const viewport = () => { const [w, h] = (flag('viewport') ?? '1600x900').split('x').map(Number); return { width: w, height: h }; };

try {
  if (cmd === 'mcp') {
    await import('../src/mcp.mjs');
  } else if (cmd === 'guide') {
    const { guide } = await import('../src/guide.mjs');
    console.log(guide());
  } else if (cmd === 'doctor') {
    const { doctor } = await import('../src/doctor.mjs');
    loadEnv(process.cwd());
    const d = await doctor();
    console.log(d.report);
    if (d.todo.length) { console.log(`\nStill to do — run:\n${d.todo.map((t) => `  ${t}`).join('\n')}`); process.exit(1); }
  } else if (cmd === 'setup') {
    const { setup, cliCommand } = await import('../src/setup.mjs');
    const { doctor } = await import('../src/doctor.mjs');
    const files = setup(arg);
    for (const f of files) console.log(`✔ wrote ${f}`);
    loadEnv(process.cwd());
    console.log('\nChecking what Storyshot needs:');
    const d = await doctor();
    console.log(d.report.replace(/^/gm, '  '));
    const skill = files.find((f) => f.endsWith('SKILL.md'));
    console.log([
      '',
      ...(d.todo.length ? ['STILL TO DO (agent: run these yourself, then `' + cliCommand() + ' doctor`):', ...d.todo.map((t) => `  ${t}`), ''] : []),
      'NEXT',
      `  Agent: read ${skill} now and follow it for the user's request. Until the storyshot MCP tools`,
      `  show up in this session, use the CLI instead: ${cliCommand()} <command>`,
      arg === 'cursor'
        ? '  User: reload Cursor (Cmd/Ctrl+Shift+P → "Reload Window") so the storyshot MCP tools load; future chats use them automatically.'
        : '  User: restart Claude Code in this project and approve the storyshot MCP server; future sessions use it automatically.',
    ].join('\n'));
  } else if (cmd === 'login') {
    const { login, authFileFor } = await import('../src/auth.mjs');
    const r = await login(arg, { file: flag('save') ?? authFileFor(arg), viewport: viewport() });
    console.log(`✔ saved the login session to ${r.file} (${r.how}, ${r.cookies} cookies, ${r.siteCookies} for this site)${r.gitignore ? `\n  added it to ${r.gitignore}` : ''}` +
      `\n  use it: \`storageState: ${r.file.split(/[\\/]/).pop()}\` in the storyboard (path relative to the yaml), or \`--storage ${r.file}\` for inspect/init`);
  } else if (cmd === 'init') {
    const { initStoryboard } = await import('../src/init.mjs');
    const r = await initStoryboard(arg, { purpose: flag('purpose') ?? 'pitch', topic: flag('topic'), file: flag('file'), storageState: flag('storage'), viewport: viewport() });
    console.log(`✔ wrote ${r.file}\n  screenshot: ${r.screenshot}\n  next: edit it, then \`storyshot check ${r.file}\``);
  } else if (cmd === 'inspect') {
    await (await import('../src/doctor.mjs')).ensureBrowser();
    if (/\.ya?ml$/.test(arg)) {
      const { record } = await import('../src/record.mjs');
      const cfg = loadConfig(arg);
      const after = flag('after');
      console.log((await record(cfg, { log: () => {}, inspectAfter: after != null ? Number(after) : cfg.steps.length })).text);
    } else {
      console.log((await inspect(arg, { viewport: viewport(), storageState: flag('storage') })).text);
    }
  } else if (cmd === 'check') {
    const r = check(arg, { draft: args.includes('--draft') });
    console.log(formatCheck(r));
    process.exit(r.ok ? 0 : 1);
  } else {
    const draft = args.includes('--draft');
    const c = check(arg, { draft });
    if (!c.ok) { console.error(formatCheck(c)); process.exit(1); }
    try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch {
      throw new Error('storyshot needs ffmpeg on your PATH (macOS: brew install ffmpeg · Ubuntu: apt install ffmpeg · Windows: winget install ffmpeg) — or use the Docker image');
    }
    const r = await build(loadConfig(arg, { draft }), cmd);
    if (r.out) {
      console.log(`\n✔ ${r.out}  (${r.duration.toFixed(1)}s, built in ${r.seconds}s)`);
      console.log(`  preview: ${r.preview}`);
      for (const f of r.extras ?? []) if (!/-steps[\\/]/.test(f)) console.log(`  + ${f}`);
      for (const w of r.warnings) console.log(`  ⚠ ${w}`);
    }
  }
} catch (e) {
  console.error(`\n✖ ${e.message}`);
  if (/Executable doesn't exist/.test(e.message)) console.error('  run: npx playwright install chromium');
  process.exit(1);
}
