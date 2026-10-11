// The agent playbook (SKILL.md) + the storyboard reference from the README.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function guide() {
  const skill = fs.readFileSync(path.join(ROOT, 'skills/storyshot/SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\n/, '');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  return `${skill}\n\n---\n\n${readme.slice(readme.indexOf('## Storyboard'), readme.indexOf('## License'))}`;
}
