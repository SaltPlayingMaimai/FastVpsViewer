/**
 * Guard: a release always ships the handoff and the plan, and the README
 * links to both. Runs in CI and from `npm run verify`.
 */
import { readFile, stat } from 'node:fs/promises';

const required = ['README.md', 'README.zh.md', 'plan.md', 'handoff.md', 'docs/DETAIL.md', 'docs/DETAIL.zh.md'];
const problems = [];

for (const file of required) {
  try {
    const info = await stat(file);
    if (!info.size) problems.push(`${file}: empty`);
    else if (info.size < 200) problems.push(`${file}: suspiciously short (${info.size} bytes)`);
  } catch {
    problems.push(`${file}: missing`);
  }
}

const readme = await readFile('README.md', 'utf8').catch(() => '');
const readmeZh = await readFile('README.zh.md', 'utf8').catch(() => '');
if (!readme.includes('plan.md') || !readme.includes('handoff.md')) {
  problems.push('README.md does not link plan.md / handoff.md');
}
if (!readmeZh.includes('plan.md') || !readmeZh.includes('handoff.md')) {
  problems.push('README.zh.md does not link plan.md / handoff.md');
}

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
for (const file of ['plan.md', 'handoff.md', 'README.md', 'README.zh.md']) {
  if (!(pkg.files || []).includes(file)) problems.push(`package.json files[] is missing ${file}`);
}

if (problems.length) {
  console.error('check-docs failed:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log('ok  docs: README (en/zh), plan, handoff, DETAIL (en/zh), package files[]');
