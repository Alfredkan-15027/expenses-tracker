// Money display fixes: typed amounts with commas, signed zeros, parts that add up to the total shown,
// history search totals, backup age labels and a damaged profile in an imported backup.
import test from 'node:test';
import assert from 'node:assert/strict';

// The screens touch the DOM on import (overlays, lock screen): just enough of it for render() to build strings.
globalThis.document ??= {
  addEventListener() {}, removeEventListener() {}, getElementById() { return null; }, querySelector() { return null; },
  querySelectorAll() { return []; },
  createElement() { return { setAttribute() {}, appendChild() {}, classList: { add() {}, remove() {} } }; },
  documentElement: { classList: { add() {}, remove() {}, contains() { return false; } } }, body: { appendChild() {} },
  visibilityState: 'visible',
};
globalThis.window ??= globalThis;
globalThis.window.matchMedia ??= () => ({ matches: false, addEventListener() {} });
globalThis.location ??= { hash: '', reload() {} };

const { toCents, normalizeNumberText, formatMoney, formatPercent, formatCompact, roundedRest, sharePercents } = await import('../src/core/money.js');
const { buildInsights } = await import('../src/core/analysis.js');
const { parseBackup, buildBackup } = await import('../src/core/backup.js');
const { normalizeProfile, livingCostTiers, categoryRanges } = await import('../src/core/benchmarks.js');
const { sanitizeSettings, backupAgeDays, backupAgeText } = await import('../src/core/settings.js');
const { DEFAULT_CATEGORIES } = await import('../src/core/categories.js');
const { addDays } = await import('../src/core/dates.js');
const { stackBar, divergeList } = await import('../src/ui/charts.js');
const history = (await import('../src/ui/screens/history.js')).default;
const insights = (await import('../src/ui/screens/insights.js')).default;
const today = (await import('../src/ui/screens/today.js')).default;
const settingsScreen = (await import('../src/ui/screens/settings.js')).default;

const strip = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const rm = (text) => Number(text.replace(/,/g, '')); // "1,234" → 1234
let n = 0;
const tx = (date, amount, categoryId = 'food', extra = {}) => ({
  id: `m${++n}`, type: 'expense', amount, categoryId, date, note: '', business: categoryId === 'business', createdAt: n, updatedAt: n, ...extra,
});
const income = (date, amount, categoryId = 'salary') => tx(date, amount, categoryId, { type: 'income' });
const stateOf = (transactions, settings = {}, recurring = []) => ({
  transactions, categories: DEFAULT_CATEGORIES, recurring, settings: sanitizeSettings({ onboarded: true, ...settings }),
  holdings: [], investFlows: [], valuations: [],
});

// ── Typed amounts ──────────────────────────────────────────────────────────────

test('a comma is thousands grouping only when it groups thousands; a lone decimal comma is a decimal point', () => {
  assert.equal(toCents('1,234.50'), 123450);
  assert.equal(toCents('1,234,567'), 123456700);
  assert.equal(toCents('RM 1,234.50'), 123450);
  assert.equal(toCents(' 12 '), 1200);
  // Keypads set to a region with a decimal comma type "12,50" for RM 12.50 — not RM 1,250.
  assert.equal(toCents('12,50'), 1250);
  assert.equal(toCents('0,99'), 99);
  assert.equal(toCents('1,5'), 150);
  // Malformed grouping and inner spaces are rejected, not glued together.
  assert.equal(toCents('12,3,4'), null);
  assert.equal(toCents('1 2'), null);
  assert.equal(toCents('12,345,6'), null);
  assert.equal(toCents('1,2345'), null);
  // The percentage sheet reads its number with the same rule: "2,5" is 2.5, not 25.
  assert.equal(Number(normalizeNumberText('2,5')), 2.5);
  assert.ok(Number.isNaN(Number(normalizeNumberText('12,3,4'))));
});

// ── Signed zeros ───────────────────────────────────────────────────────────────

test('percentages and compact amounts never show a signed zero, and the k unit follows the rounded value', () => {
  assert.equal(formatPercent(-0.0004), '0%');
  assert.equal(formatPercent(-0.004999), '0%');
  assert.equal(formatPercent(-0.00004, 1), '0.0%');
  assert.equal(formatPercent(-0.12), '−12%');
  assert.equal(formatPercent(0.12, 0, { sign: true }), '+12%');
  assert.equal(formatPercent(0.001, 0, { sign: true }), '0%');
  assert.equal(formatCompact(-30), '0');
  assert.equal(formatCompact(30, { sign: true }), '0');
  assert.equal(formatCompact(12000, { sign: true }), '+120');
  assert.equal(formatCompact(-12000, { sign: true }), '−120');
  assert.equal(formatCompact(99960), '1k'); // RM 999.60, like RM 1,000
  assert.equal(formatCompact(100000), '1k');
  assert.equal(formatCompact(104999), '1k');
  assert.equal(formatCompact(125000), '1.3k');
  assert.equal(formatCompact(996000), '10k');
  assert.equal(formatCompact(2500000), '25k');
  assert.equal(formatMoney(30, { round: true, sign: true }), 'RM 0');
  assert.equal(formatMoney(-30, { round: true }), 'RM 0');
  const html = strip(divergeList([{ label: 'food', delta: 12000 }, { label: 'subscriptions', delta: 30 }, { label: 'transport', delta: -30 }]));
  assert.doesNotMatch(html, /[+−-]0\b/);
});

test('a finished month RM 1 short: the savings rate reads 0%, not -0%', () => {
  const txs = [income('2026-09-01', 400000), tx('2026-09-02', 150000, 'housing'), tx('2026-09-10', 250100)];
  const settings = sanitizeSettings({ expectedIncome: 400000, startDate: '2026-08-01', onboarded: true });
  const sav = buildInsights({ txs, ym: '2026-09', categories: DEFAULT_CATEGORIES, profile: settings.profile, settings, today: '2026-10-12' })
    .find((i) => i.icon === 'savings');
  assert.match(sav.body, /结余 −RM 1，储蓄率 0%/);
});

test('分析: a total change of 30 sen shows no −RM 0 / -0%, and categories that round to RM 0 are left out', () => {
  // Same first 12 days: RM 100.00 in September, RM 99.70 in October.
  const state = stateOf([tx('2026-09-05', 10000), tx('2026-10-05', 9970)], { startDate: '2026-08-01' });
  const out = strip(insights.render({ state, today: '2026-10-12' }));
  const section = out.slice(out.indexOf('与9月相比'), out.indexOf('近 6 个月'));
  assert.ok(section.length > 0);
  assert.doesNotMatch(section, /[−+-]RM 0\b|[−+-]0%/);
  assert.match(section, /RM 0 \(0%\)/);
  assert.match(section, /和上个月一样/);
  const mom = buildInsights({ txs: state.transactions, ym: '2026-10', categories: DEFAULT_CATEGORIES, profile: state.settings.profile, settings: state.settings, today: '2026-10-12' })
    .find((i) => i.title === '与上月相比');
  assert.doesNotMatch(mom.body, /[−+-]0%/);
});

// ── Parts that add up ──────────────────────────────────────────────────────────

test('roundedRest: total and part keep their own rounding, the rest makes up the difference', () => {
  assert.equal(roundedRest(153500, 30050), 123400); // RM 1,535 = 1,234 + 301
  assert.equal(roundedRest(460040, 110875), 349100); // RM 4,600 − 1,109 = 3,491
  assert.equal(formatMoney(roundedRest(400000, 400100), { round: true }), '−RM 1');
  assert.equal(formatMoney(roundedRest(30, 0), { round: true }), 'RM 0');
  // Every random split adds up as shown, and the rest is never off by RM 1 or more.
  let seed = 7;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 20000; i += 1) {
    const a = Math.floor(rnd() * 200000);
    const b = Math.floor(rnd() * 200000);
    const rest = roundedRest(a + b, a);
    assert.equal(Math.round(a / 100) * 100 + rest, Math.round((a + b) / 100) * 100);
    assert.ok(Math.abs(rest - b) < 100);
  }
});

test('今天: 本月已花 = 个人 + 创业 as shown', () => {
  const state = stateOf([tx('2026-10-05', 123450), tx('2026-10-06', 30050, 'business')],
    { expectedIncome: 400000, savingsTarget: 80000, budgetIncludesBusiness: true, startDate: '2026-09-01' });
  const out = strip(today.render({ state, today: '2026-10-12', demo: true }));
  const m = out.match(/本月已花 RM ([\d,]+)：个人 RM ([\d,]+) \+ 创业 RM ([\d,]+)/);
  assert.ok(m, out);
  assert.equal(rm(m[2]) + rm(m[3]), rm(m[1]));
  assert.equal(m[0], '本月已花 RM 1,535：个人 RM 1,234 + 创业 RM 301');
});

test('分析: 收入 − 支出 = 结余, and the fixed + day-to-day lines add up to the monthly figure', () => {
  const recurring = [
    { id: 'rent', type: 'expense', amount: 90000, categoryId: 'housing', note: '房租', day: 1, business: false, active: true, startMonth: '2026-09', lastMonth: '2026-10' },
    { id: 'phone', type: 'expense', amount: 5850, categoryId: 'utilities', note: '手机', day: 3, business: false, active: true, startMonth: '2026-09', lastMonth: '2026-10' },
  ];
  const txs = [
    tx('2026-10-01', 90000, 'housing', { recurringId: 'rent' }),
    tx('2026-10-03', 5850, 'utilities', { recurringId: 'phone' }),
    tx('2026-09-20', 15025), tx('2026-10-05', 15025),
    income('2026-10-01', 460040),
  ];
  const state = stateOf(txs, { expectedIncome: 400000, savingsTarget: 80000, startDate: '2026-09-13', currentSavings: 1000000 }, recurring);
  const out = strip(insights.render({ state, today: '2026-10-12' }));
  // The bento overview: 目前结余 (RM 3,014 .36 as the money component draws it) above 收入 and 支出, all to the sen.
  const grid = out.match(/目前结余 RM ([\d,]+) \.(\d\d) 收入 RM ([\d,]+\.\d\d) 支出 RM ([\d,]+\.\d\d)/);
  assert.ok(grid, out);
  const sen = (text) => Math.round(Number(text.replace(/,/g, '')) * 100);
  assert.equal(sen(grid[3]) - sen(grid[4]), rm(grid[1]) * 100 + Number(grid[2]));
  const total = rm(out.match(/每月预计个人生活费 RM ([\d,]+)/)[1]);
  const bench = out.match(/= 个人固定项目 RM ([\d,]+) \+ 日常开销 RM ([\d,]+)/);
  assert.equal(rm(bench[1]) + rm(bench[2]), total);
  const rw = out.match(/每月开销 RM ([\d,]+) = 固定项目 RM ([\d,]+) \+ 日常开销 RM ([\d,]+)/);
  assert.equal(rm(rw[2]) + rm(rw[3]), rm(rw[1]));
  // The day-to-day figure reads the same in both places.
  assert.equal(bench[2], rw[3]);
});

test('a finished period: the 结余 in the savings insight matches 收入 − 支出 as the stat grid shows them', () => {
  const txs = [income('2026-09-01', 460040), tx('2026-09-05', 110875)];
  const settings = sanitizeSettings({ startDate: '2026-08-01', onboarded: true });
  const sav = buildInsights({ txs, ym: '2026-09', categories: DEFAULT_CATEGORIES, profile: settings.profile, settings, today: '2026-10-12' })
    .find((i) => i.icon === 'savings');
  assert.match(sav.body, /收入 RM 4,600，结余 RM 3,491，/);
});

test('shares of one whole add up to 100%', () => {
  assert.deepEqual(sharePercents([10000, 10000, 10000]), [34, 33, 33]);
  assert.deepEqual(sharePercents([1050, 1050, 7900]), [11, 10, 79]);
  assert.deepEqual(sharePercents([0, 500]), [0, 100]);
  assert.deepEqual(sharePercents([0, 0]), [0, 0]);
  const legend = strip(stackBar([
    { id: 'a', value: 10000, color: 'red', label: 'A' }, { id: 'b', value: 10000, color: 'blue', label: 'B' }, { id: 'c', value: 10000, color: 'green', label: 'C' },
  ]));
  assert.equal([...legend.matchAll(/(\d+)%/g)].reduce((a, m) => a + Number(m[1]), 0), 100);

  for (const amounts of [[10000, 10000, 10000], [1050, 1050, 7900]]) {
    const state = stateOf([tx('2026-10-03', amounts[0], 'food'), tx('2026-10-04', amounts[1], 'shopping'), tx('2026-10-05', amounts[2], 'learning')], { startDate: '2026-08-01' });
    const out = strip(insights.render({ state, today: '2026-10-12' }));
    const groups = out.slice(out.indexOf('钱花在哪一类'), out.indexOf('建议：必要开销'));
    assert.equal([...groups.matchAll(/(\d+)%/g)].reduce((a, m) => a + Number(m[1]), 0), 100, groups);
    const rows = [...out.matchAll(/参考 \d+–\d+[^%]*? · (\d+)%/g)];
    assert.equal(rows.length, 3);
    assert.equal(rows.reduce((a, m) => a + Number(m[1]), 0), 100);
  }
});

// ── 记录 search ────────────────────────────────────────────────────────────────

function search(query, transactions) {
  const input = { value: query, focus() {}, setSelectionRange() {} };
  history.afterRender({ querySelector: () => input }, { rerender() {} });
  input.oninput();
  clearTimeout(history._t);
  return strip(history.render({ state: stateOf(transactions), today: '2026-10-12' }));
}

test('记录 search: 支出 / 收入 / 笔数 cover every match, only the list is capped', () => {
  const txs = [
    ...Array.from({ length: 350 }, (_, i) => tx(addDays('2026-10-12', -i), 420, 'food', { note: 'kopi' })),
    ...Array.from({ length: 20 }, (_, i) => ({ ...income(addDays('2025-09-01', -i), 1000), note: 'kopi refund' })),
  ];
  const summary = search('kopi', txs).match(/在所有月份中找到.*?笔数 \d+/)?.[0];
  assert.equal(summary, '在所有月份中找到 370 笔（下面只列出最近 300 笔） 支出 RM 1,470.00 收入 RM 200.00 笔数 370');
  const shown = (String(history.render({ state: stateOf(txs), today: '2026-10-12' })).match(/data-action="edit-tx"/g) || []).length;
  assert.equal(shown, 300);
});

test('记录 search: an amount typed the way it is shown ("1,234", "RM 1,234.00") finds the entry', () => {
  const txs = [tx('2026-10-05', 123400, 'shopping'), tx('2026-10-06', 1250)];
  const found = (q) => search(q, txs).match(/在所有月份中找到 (\d+) 笔/)?.[1];
  for (const q of ['1234', '1,234', '1,234.00', 'RM 1,234', '−RM 1,234.00']) assert.equal(found(q), '1', q);
  // "RM" alone is not an amount: it doesn't match every entry.
  assert.equal(found('rm'), '0');
});

// ── Backup age ─────────────────────────────────────────────────────────────────

test('backup age is counted in calendar days, like 今天 / 昨天 elsewhere', () => {
  const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime(); // local time, October 2026
  assert.equal(backupAgeText(at(11, 23, 30), at(12, 21, 30)), '昨天'); // 22 hours, but yesterday
  assert.equal(backupAgeText(at(12, 0, 10), at(12, 23, 50)), '今天');
  assert.equal(backupAgeText(at(10, 23), at(12, 8)), '2 天前'); // 33 hours, two days ago
  assert.equal(backupAgeText(at(1, 9), at(12, 8)), '11 天前');
  assert.equal(backupAgeText(0, at(12, 8)), '还没有备份过');
  assert.equal(backupAgeDays(at(11, 23, 30), at(12, 21, 30)), 1);
  assert.equal(backupAgeDays(0), null);
});

test('设置 and the 今天 reminder say 昨天 for last night\'s backup', () => {
  const realNow = Date.now;
  const now = new Date(2026, 9, 12, 21, 30).getTime();
  const last = new Date(2026, 9, 11, 23, 30).getTime();
  Date.now = () => now;
  try {
    const txs = Array.from({ length: 6 }, (_, i) => tx(addDays('2026-10-12', -i), 1000));
    const state = stateOf(txs, { backupFreq: 'daily', lastBackupAt: last });
    const todayOut = strip(today.render({ state, today: '2026-10-12', demo: false }));
    assert.match(todayOut, /该备份了/);
    assert.match(todayOut, /上次备份：昨天/);
    const settingsOut = strip(settingsScreen.render({ state, demo: true }));
    assert.match(settingsOut, /上次：昨天/);
  } finally {
    Date.now = realNow;
  }
});

// ── Imported profile ───────────────────────────────────────────────────────────

test('a backup whose profile is null or names prototype keys restores with the default profile', () => {
  const base = { transactions: [], categories: DEFAULT_CATEGORIES, recurring: [] };
  for (const profile of [null, 'room', { housing: 'constructor', transport: 'toString' }, { housing: '__proto__' }]) {
    const res = parseBackup(JSON.stringify(buildBackup({ ...base, settings: { onboarded: true, profile } })));
    assert.equal(res.ok, true);
    assert.deepEqual(res.data.settings.profile, { housing: 'room', transport: 'public' });
  }
  assert.deepEqual(normalizeProfile(null), { housing: 'room', transport: 'public' });
  assert.deepEqual(normalizeProfile({ housing: 'unit', transport: 'car' }), { housing: 'unit', transport: 'car' });
  assert.deepEqual(livingCostTiers({ housing: 'constructor', transport: 'toString' }), [1700, 2800, 3800]);
  assert.deepEqual(categoryRanges({ transport: 'toString' }).transport, [100, 300]);
});

test('parseBackup answers { ok: false } instead of throwing on content it cannot read', () => {
  // A getter that throws stands in for any unexpected shape deeper in the file.
  const res = parseBackup(JSON.stringify({ app: 'expenses-tracker', version: 2, data: { categories: DEFAULT_CATEGORIES } }));
  assert.equal(res.ok, true);
  const realParse = JSON.parse;
  JSON.parse = () => ({ app: 'expenses-tracker', version: 2, data: { get categories() { throw new TypeError('boom'); } } });
  try {
    const bad = parseBackup('{}');
    assert.equal(bad.ok, false);
    assert.equal(typeof bad.error, 'string');
  } finally {
    JSON.parse = realParse;
  }
});
