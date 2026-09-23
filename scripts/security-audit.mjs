#!/usr/bin/env node
// Pre-publish privacy & security audit. Scans every file that would be published (git-tracked +
// untracked, not ignored) for personal data, secrets, external requests and unsafe code patterns.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const files = [...new Set([
  ...git('ls-files').split('\n'),
  ...git('ls-files', '--others', '--exclude-standard').split('\n'),
])].filter(Boolean).filter((f) => !/\.(png|jpg|jpeg|gif|webp|ico)$/i.test(f));

const findings = [];
const add = (file, line, msg) => findings.push(`${file}${line ? `:${line}` : ''}  ${msg}`);

const RULES = [
  { re: /[A-Z0-9._%+-]+@(?!users\.noreply\.github\.com|anthropic\.com)[A-Z0-9.-]+\.[A-Z]{2,}/i, msg: '疑似个人邮箱' },
  { re: /(\+?6?01[0-9]-?\d{3,4}-?\d{4})/, msg: '疑似马来西亚手机号码' },
  { re: /\b\d{6}-\d{2}-\d{4}\b/, msg: '疑似身份证号码 (IC)' },
  { re: /\b(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[A-Za-z0-9-]{10,})/, msg: '疑似 API 密钥 / Token' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, msg: '私钥' },
  { re: /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/, msg: '疑似银行卡号' },
];

// Code that ships to the browser.
const isAppCode = (f) => /^(src\/.*\.js|sw\.js|index\.html|manifest\.webmanifest|styles\/.*\.css|assets\/icons\/.*\.svg)$/.test(f);
const APP_RULES = [
  { re: /https?:\/\/(?!www\.w3\.org\/)/, msg: 'App 代码中出现外部网址（App 不应连接任何外部服务）' },
  { re: /\b(XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b/, msg: '网络请求 API' },
  { re: /\beval\s*\(|new Function\s*\(/, msg: '动态执行代码' },
  { re: /\bon(click|load|error|input|change|submit)\s*=\s*["']/i, msg: '内联事件处理（违反 CSP）' },
  { re: /document\.write\s*\(/, msg: 'document.write' },
  { re: /localStorage|sessionStorage|document\.cookie/, msg: '使用了 localStorage / cookie（资料应只存在 IndexedDB）' },
];

for (const f of files) {
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const r of RULES) if (r.re.test(line)) add(f, i + 1, r.msg);
    if (isAppCode(f)) for (const r of APP_RULES) if (r.re.test(line)) add(f, i + 1, r.msg);
  });
  if (isAppCode(f) && f.endsWith('.js')) {
    lines.forEach((line, i) => {
      if (/\bfetch\s*\(/.test(line) && !/fetch\(\s*(req\b|'index\.html'|url\b)/.test(line)) add(f, i + 1, '非预期的 fetch 调用');
      if (/\.innerHTML\s*=/.test(line) && !/innerHTML\s*=\s*(''|toHTML\()/.test(line)) add(f, i + 1, 'innerHTML 赋值未经过安全模板');
    });
  }
}

// Content-Security-Policy must stay strict.
const htmlText = readFileSync('index.html', 'utf8');
const csp = htmlText.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] || '';
if (!csp) add('index.html', 0, '缺少 Content-Security-Policy');
if (!/script-src 'self'(;|$)/.test(csp)) add('index.html', 0, "script-src 必须只允许 'self'");
if (!/connect-src 'self'/.test(csp)) add('index.html', 0, "connect-src 必须只允许 'self'");
if (/<script(?![^>]*\ssrc=)[^>]*>/i.test(htmlText)) add('index.html', 0, '不允许内联 <script>');

// Commit author e-mails become public on GitHub.
try {
  const authors = new Set(git('log', '--format=%ae%n%ce').split('\n').filter(Boolean));
  for (const a of authors) if (!/noreply/.test(a)) add('git log', 0, `提交记录含公开邮箱：${a}`);
} catch { /* no commits yet */ }

if (findings.length) {
  console.error(`✗ 安全检查发现 ${findings.length} 个问题：\n` + findings.map((x) => `  - ${x}`).join('\n'));
  process.exit(1);
}
console.log(`✓ 安全检查通过（扫描 ${files.length} 个文件）：无个人资料、无密钥、无外部请求、CSP 严格。`);
