// `storyshot setup cursor|claude`: wire Storyshot into a coding agent for this project —
// the MCP server config plus the playbook as an Agent Skill (both read SKILL.md).
import fs from 'node:fs';
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

export function setup(target, dir = process.cwd()) {
  const skill = fs.readFileSync(path.join(ROOT, 'skills/storyshot/SKILL.md'), 'utf8');
  const written = [];
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
  } else {
    throw new Error('usage: storyshot setup cursor | claude');
  }
  const gi = ignoreCache(dir);
  if (gi) written.push(`${gi} (added .storyshot/)`);
  return written;
}
