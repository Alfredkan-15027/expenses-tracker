#!/usr/bin/env node
// Guard for the Codex design pass: fails if anything outside the design layer changed,
// or if an allowed file gained something unsafe (external URLs, scripts in SVG, removed icon ids).
//
// Usage:
//   node scripts/check-codex-scope.mjs                 # compare working tree with HEAD
//   node scripts/check-codex-scope.mjs --base main     # compare with a branch / commit
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const ALLOWED = [
  /^styles\/[\w.-]+\.css$/,
  /^assets\/icons\/[\w.-]+\.(svg|png)$/,
  /^docs\/codex-proposals\.md$/,
];
// Files whose names must never change even inside the allowed folders (JS / manifest reference them).
const REQUIRED_FILES = [
  'styles/tokens.css', 'styles/base.css', 'styles/components.css', 'styles/screens.css',
  'assets/icons/sprite.svg', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png', 'assets/icons/apple-touch-icon.png',
];

const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'HEAD';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

let changed;
try {
  const diff = git('diff', '--name-only', base).split('\n');
  const staged = git('diff', '--name-only', '--cached', base).split('\n');
  const untracked = git('ls-files', '--others', '--exclude-standard').split('\n');
  changed = [...new Set([...diff, ...staged, ...untracked])].filter(Boolean).map((f) => f.replace(/\\/g, '/'));
} catch (err) {
  console.error(`无法读取 git 变更（base = ${base}）：${err.message}`);
  process.exit(2);
}

const problems = [];
for (const f of changed) {
  if (!ALLOWED.some((re) => re.test(f))) problems.push(`越界：${f} 不在 Codex 可编辑范围内`);
}
for (const f of REQUIRED_FILES) {
  if (!existsSync(f)) problems.push(`缺少必要文件：${f}（不可删除或改名）`);
}

// Content rules for the files Codex may touch.
for (const f of changed.filter((x) => existsSync(x))) {
  if (f.endsWith('.css')) {
    const css = readFileSync(f, 'utf8');
    if (/url\(\s*['"]?\s*(https?:)?\/\//i.test(css)) problems.push(`${f}：不可引用外部网址（字体、图片都必须放在本地）`);
    if (/@import/i.test(css)) problems.push(`${f}：不可使用 @import`);
    if (/expression\s*\(|javascript:/i.test(css)) problems.push(`${f}：含有不安全的 CSS`);
  }
  if (f.endsWith('.svg')) {
    const svg = readFileSync(f, 'utf8');
    if (/<script|<foreignObject|\son\w+\s*=|javascript:/i.test(svg)) problems.push(`${f}：SVG 不可包含脚本或事件属性`);
    if (/(href|src)\s*=\s*["']\s*(https?:)?\/\//i.test(svg)) problems.push(`${f}：SVG 不可引用外部资源`);
  }
}

// Every icon id that existed before must still exist (the JavaScript references them by id).
if (changed.includes('assets/icons/sprite.svg') && existsSync('assets/icons/sprite.svg')) {
  let before = '';
  try { before = git('show', `${base}:assets/icons/sprite.svg`); } catch { /* new file */ }
  const ids = (s) => new Set([...s.matchAll(/<symbol[^>]*\sid="([^"]+)"/g)].map((m) => m[1]));
  const now = ids(readFileSync('assets/icons/sprite.svg', 'utf8'));
  for (const id of ids(before)) if (!now.has(id)) problems.push(`sprite.svg：缺少图标 id「${id}」（可以重画，不能删除或改名）`);
}

if (problems.length) {
  console.error('✗ Codex 范围检查未通过：\n' + problems.map((p) => `  - ${p}`).join('\n'));
  console.error('\n请撤销以上改动；需要改结构或逻辑时，写进 docs/codex-proposals.md 交给人工处理。');
  process.exit(1);
}
console.log(`✓ Codex 范围检查通过（${changed.length} 个文件变更，全部在设计层内）`);
