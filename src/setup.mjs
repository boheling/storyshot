// `storyshot setup <agent>`: wire Storyshot into a coding agent for this project —
// the MCP server config plus the playbook as an Agent Skill (both read SKILL.md).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Installed from npm → `npx -y storyshot mcp`; running from a checkout → node <abs path>.
function serverCommand() {
  const fromNpm = ROOT.split(path.sep).includes('node_modules');
  return fromNpm ? { command: 'npx', args: ['-y', 'storyshot', 'mcp'] } : { command: 'node', args: [path.join(ROOT, 'bin', 'storyshot.mjs'), 'mcp'] };
}

// how an agent should call the CLI from this project
export function cliCommand() {
  const { command, args } = serverCommand();
  return [command, ...args.slice(0, -1)].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
}

// recordings, previews and voice caches live in .storyshot/ next to each storyboard
function ignoreCache(dir) {
  const gi = path.join(dir, '.gitignore');
  const cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  if (/^\.storyshot\/?$/m.test(cur) || /^\*\*\/\.storyshot/m.test(cur)) return null;
  fs.writeFileSync(gi, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}# Storyshot cache (recordings, previews, voice lines)\n.storyshot/\n`);
  return gi;
}

function mergeMcp(file) {
  let json = {};
  if (fs.existsSync(file)) {
    try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error(`${file} is not valid JSON — fix or remove it first`); }
  }
  json.mcpServers = { ...(json.mcpServers ?? {}), storyshot: serverCommand() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  return file;
}

// one shared copy of the playbook for agents that read instruction files rather than skills folders
function sharedSkill(dir, skill) {
  const dest = path.join(dir, '.agents', 'skills', 'storyshot', 'SKILL.md');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, skill);
  return dest;
}
const pointer = () => ['## Videos of this web app (Storyshot)', '',
  'When asked for a demo or promo video, a tutorial or onboarding video, a lesson, or GIFs for docs of a website or web app,',
  'read `.agents/skills/storyshot/SKILL.md` first and follow it. Use the `storyshot` MCP tools when they are available;',
  `otherwise run the CLI: \`${cliCommand()} <command>\` (\`${cliCommand()} guide\` prints the playbook and storyboard reference).`].join('\n');
// add (or refresh) our section in a shared instructions file, leaving the rest of the file alone
function upsertBlock(file, body) {
  const block = `<!-- storyshot:start -->\n${body}\n<!-- storyshot:end -->`;
  const re = /<!-- storyshot:start -->[\s\S]*?<!-- storyshot:end -->/;
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, re.test(cur) ? cur.replace(re, block) : `${cur}${cur && !cur.endsWith('\n') ? '\n\n' : cur ? '\n' : ''}${block}\n`);
  return file;
}
// a rules file we own outright
function writeRule(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}
function mergeJson(file, key, entry) {
  let json = {};
  if (fs.existsSync(file)) {
    try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error(`${file} is not valid JSON — fix or remove it first`); }
  }
  json[key] = { ...(json[key] ?? {}), storyshot: entry };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  return file;
}
// Cline keeps MCP servers in its extension storage, per editor (VS Code, Cursor, Windsurf…)
function clineSettings() {
  const home = os.homedir();
  const base = process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
    : process.platform === 'win32' ? (process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')) : path.join(home, '.config');
  return ['Code', 'Code - Insiders', 'Cursor', 'Windsurf', 'VSCodium']
    .map((ed) => path.join(base, ed, 'User', 'globalStorage', 'saoudrizwan.claude-dev'))
    .filter((d) => fs.existsSync(d))
    .map((d) => path.join(d, 'settings', 'cline_mcp_settings.json'));
}

export const TARGETS = ['cursor', 'claude', 'codex', 'gemini', 'vscode', 'windsurf', 'cline'];

export function setup(target, dir = process.cwd()) {
  const skill = fs.readFileSync(path.join(ROOT, 'skills/storyshot/SKILL.md'), 'utf8');
  const written = [];
  const server = serverCommand();
  if (target === 'cursor') {
    // Cursor loads Agent Skills from .cursor/skills/<name>/SKILL.md (same format as Claude Code)
    written.push(mergeMcp(path.join(dir, '.cursor', 'mcp.json')));
    const dest = path.join(dir, '.cursor', 'skills', 'storyshot', 'SKILL.md');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, skill);
    written.push(dest);
  } else if (target === 'claude') {
    written.push(mergeMcp(path.join(dir, '.mcp.json')));
    const dest = path.join(dir, '.claude', 'skills', 'storyshot', 'SKILL.md');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, skill);
    written.push(dest);
  } else if (target === 'codex') {
    // Codex reads AGENTS.md on every task and keeps MCP servers in ~/.codex/config.toml (per user).
    written.push(sharedSkill(dir, skill), upsertBlock(path.join(dir, 'AGENTS.md'), `${pointer()}\n\nStoryshot launches a browser (Chromium) and ffmpeg. Codex's default sandbox blocks the browser: when a Storyshot\ncommand or tool needs it, ask the user to approve running it outside the sandbox. Never work around a blocked browser\nby faking the video.`));
    try {
      execFileSync('codex', ['mcp', 'add', 'storyshot', '--', server.command, ...server.args], { stdio: 'ignore' });
      written.push(`${process.env.CODEX_HOME ?? '~/.codex'}/config.toml (codex mcp add storyshot)`);
    } catch {
      written.push(`(codex CLI not found: add the MCP server yourself with \`codex mcp add storyshot -- ${[server.command, ...server.args].join(' ')}\`)`);
    }
  } else if (target === 'gemini') {
    // Gemini CLI: project settings in .gemini/settings.json, project context in GEMINI.md
    written.push(sharedSkill(dir, skill), mergeJson(path.join(dir, '.gemini', 'settings.json'), 'mcpServers', server), upsertBlock(path.join(dir, 'GEMINI.md'), pointer()));
  } else if (target === 'vscode') {
    // VS Code (GitHub Copilot agent mode): workspace MCP servers in .vscode/mcp.json, instructions in .github/copilot-instructions.md
    written.push(sharedSkill(dir, skill), mergeJson(path.join(dir, '.vscode', 'mcp.json'), 'servers', { type: 'stdio', ...server }),
      upsertBlock(path.join(dir, '.github', 'copilot-instructions.md'), pointer()));
  } else if (target === 'windsurf') {
    // Windsurf: workspace rules in .windsurf/rules/, MCP servers only per user in ~/.codeium/windsurf/mcp_config.json
    written.push(sharedSkill(dir, skill), writeRule(path.join(dir, '.windsurf', 'rules', 'storyshot.md'),
      `---\ntrigger: model_decision\ndescription: Making demo, promo, tutorial, lesson or docs videos/GIFs of a website or web app with Storyshot\n---\n\n${pointer()}\n`));
    written.push(mergeJson(path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json'), 'mcpServers', server));
  } else if (target === 'cline') {
    // Cline: project rules in .clinerules/, MCP servers in the extension's settings (per user, per editor)
    written.push(sharedSkill(dir, skill), writeRule(path.join(dir, '.clinerules', 'storyshot.md'), `${pointer()}\n`));
    const files = clineSettings();
    for (const f of files) written.push(mergeJson(f, 'mcpServers', { ...server, disabled: false }));
    if (!files.length) written.push(`(Cline not found in VS Code, Cursor or Windsurf: in Cline, open MCP Servers → Configure and add "storyshot": ${JSON.stringify(server)})`);
  } else {
    throw new Error(`usage: storyshot setup ${TARGETS.join(' | ')}`);
  }
  const gi = ignoreCache(dir);
  if (gi) written.push(`${gi} (added .storyshot/)`);
  return written;
}
