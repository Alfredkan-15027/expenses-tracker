import test from 'node:test';
import assert from 'node:assert/strict';
import { checkData } from '../src/core/health.js';
import { repriceRecurring } from '../src/core/recurring.js';
import { DEFAULT_CATEGORIES } from '../src/core/categories.js';
import { sanitizeSettings } from '../src/core/settings.js';

let n = 0;
const tx = (date, amount, categoryId = 'food', extra = {}) => ({
  id: `t${++n}`, type: 'expense', amount, categoryId, date, note: '', business: false, createdAt: n, updatedAt: n, ...extra,
});
const base = { categories: DEFAULT_CATEGORIES, today: '2026-09-23' };
const okSettings = sanitizeSettings({ expectedIncome: 500000, savingsTarget: 100000, currentSavings: 500000, startDate: '2026-09-01' });
const kinds = (issues) => issues.map((i) => i.kind).sort();

test('a clean month has no findings', () => {
  const txs = [tx('2026-09-01', 1200), tx('2026-09-02', 800), tx('2026-09-03', 1500, 'transport')];
  assert.deepEqual(checkData({ ...base, transactions: txs, settings: okSettings }), []);
});

test('finds the problems seen in real data', () => {
  const rent = { id: 'rRent', type: 'expense', amount: 80000, categoryId: 'housing', note: '房租', day: 20, active: true, startMonth: '2026-09', lastMonth: '2026-09' };
  const wifi = { id: 'rWifi', type: 'expense', amount: 5600, categoryId: 'utilities', note: 'Wi-Fi 费用', day: 15, active: true, startMonth: '2026-09', lastMonth: '2026-09' };
  const apple = { id: 'rApple', type: 'expense', amount: 2830, categoryId: 'subscriptions', note: 'Apple 订阅', day: 23, active: true, startMonth: '2026-09', lastMonth: '2026-09' };
  const txs = [
    tx('2026-09-01', 1200), tx('2026-09-01', 1200), tx('2026-09-01', 300), // same meal twice
    tx('2026-09-02', 800), tx('2026-09-05', 900),
    tx('2026-09-19', 80000, 'housing', { recurringId: 'rRent', note: '房租' }),
    tx('2026-09-02', 80000, 'housing', { note: '九月房租' }),             // typed in as well
    tx('2026-08-30', 2830, 'subscriptions', { recurringId: 'rApple', note: 'Apple 订阅' }), // charged on the 30th
  ];
  const issues = checkData({ ...base, transactions: txs, recurring: [rent, wifi, apple], settings: okSettings });
  const k = kinds(issues);
  assert.ok(k.includes('duplicate'));
  assert.ok(k.includes('fixed-double'));
  assert.ok(issues.some((i) => i.kind === 'fixed-missing' && i.title.includes('Wi-Fi')));
  assert.ok(issues.some((i) => i.kind === 'fixed-missing' && i.title.includes('Apple'))); // September's charge not logged
  assert.ok(issues.some((i) => i.kind === 'fixed-day' && i.fix.day === 30));
  assert.ok(k.includes('before-start'));
  assert.equal(issues[0].level, 'warn'); // most important first
});

test('odd dates, categories, amounts and settings', () => {
  const food = Array.from({ length: 6 }, (_, i) => tx(`2026-09-0${i + 1}`, 1500));
  const txs = [...food, tx('2026-09-10', 150000), tx('2026-10-02', 1000), tx('2026-09-11', 5000, 'salary')];
  const issues = checkData({ ...base, transactions: txs, settings: sanitizeSettings({ startDate: '2026-09-01' }) });
  const k = kinds(issues);
  for (const kind of ['big', 'future', 'category', 'settings']) assert.ok(k.includes(kind), kind);
  assert.ok(issues.some((i) => i.id === 'plan:income'));
  assert.ok(issues.some((i) => i.id === 'plan:savings'));
});

test('ignored findings stay hidden', () => {
  const txs = [tx('2026-09-01', 1200), tx('2026-09-01', 1200)];
  const first = checkData({ ...base, transactions: txs, settings: okSettings });
  assert.equal(first.length, 1);
  const settings = sanitizeSettings({ ...okSettings, healthIgnored: [first[0].id] });
  assert.equal(checkData({ ...base, transactions: txs, settings }).length, 0);
});

test('a fixed item marked done this month by last month\'s charge is flagged before its day', () => {
  const apple = { id: 'rA', type: 'expense', amount: 2830, categoryId: 'subscriptions', note: 'Apple 订阅', day: 30, active: true, startMonth: '2026-09', lastMonth: '2026-09' };
  const txs = [tx('2026-08-30', 2830, 'subscriptions', { recurringId: 'rA' }), tx('2026-09-01', 1200), tx('2026-09-02', 800), tx('2026-09-03', 900)];
  const found = checkData({ ...base, transactions: txs, recurring: [apple], settings: okSettings }).filter((i) => i.kind === 'fixed-skipped');
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].fix, { type: 'unskip', recurringId: 'rA' });
  // Skipped on purpose because it was paid by hand this month: fine
  const paid = [...txs, tx('2026-09-10', 2830, 'subscriptions')];
  assert.equal(checkData({ ...base, transactions: paid, recurring: [apple], settings: okSettings }).filter((i) => i.kind === 'fixed-skipped').length, 0);
});

test('a hand-typed entry that looks like the same service at a new price offers to update the fixed item', () => {
  const pro = { id: 'rPro', type: 'expense', amount: 9990, categoryId: 'subscriptions', note: 'Claude Pro 订阅', day: 20, business: true, active: true, startMonth: '2026-09', lastMonth: '2026-09' };
  const apple = { id: 'rApple', type: 'expense', amount: 2830, categoryId: 'subscriptions', note: 'Apple 订阅', day: 30, active: true, startMonth: '2026-09', lastMonth: '2026-09' };
  const txs = [
    tx('2026-09-20', 9990, 'subscriptions', { recurringId: 'rPro', note: 'Claude Pro 订阅', business: true }),
    tx('2026-09-29', 59990, 'subscriptions', { note: 'Claude Max 订阅', business: true }), // upgraded
    tx('2026-09-01', 1200), tx('2026-09-02', 800), tx('2026-09-03', 900),
  ];
  const found = checkData({ ...base, transactions: txs, recurring: [pro, apple], settings: okSettings }).filter((i) => i.kind === 'fixed-changed');
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].fix, { type: 'update-fixed', recurringId: 'rPro', amount: 59990, note: 'Claude Max 订阅', date: '2026-09-29' });
  // Applying it makes the finding go away, keeps September from being logged twice and moves the day
  const updated = repriceRecurring(pro, found[0].fix);
  assert.deepEqual([updated.amount, updated.note, updated.day, updated.lastMonth], [59990, 'Claude Max 订阅', 29, '2026-09']);
  assert.equal(checkData({ ...base, transactions: txs, recurring: [updated, apple], settings: okSettings }).filter((i) => i.kind === 'fixed-changed').length, 0);
  // Not the same service, same price, an older entry, or an entry that is another fixed item's price: nothing to say
  const other = [...txs.slice(0, 1), tx('2026-09-29', 5990, 'subscriptions', { note: 'Spotify 订阅', business: true }), ...txs.slice(2)];
  assert.equal(checkData({ ...base, transactions: other, recurring: [pro, apple], settings: okSettings }).filter((i) => i.kind === 'fixed-changed').length, 0);
  const same = [...txs.slice(0, 1), tx('2026-09-29', 9990, 'subscriptions', { note: 'Claude Pro 订阅', business: true }), ...txs.slice(2)];
  assert.equal(checkData({ ...base, transactions: same, recurring: [pro, apple], settings: okSettings }).filter((i) => i.kind === 'fixed-changed').length, 0);
  const older = [tx('2026-09-10', 59990, 'subscriptions', { note: 'Claude Max 订阅', business: true }), ...txs.slice(0, 1), ...txs.slice(2)];
  assert.equal(checkData({ ...base, transactions: older, recurring: [pro, apple], settings: okSettings }).filter((i) => i.kind === 'fixed-changed').length, 0);
  const lookalike = { ...apple, id: 'rMax', amount: 59990, note: 'Anthropic 订阅', day: 3 };
  assert.equal(checkData({ ...base, transactions: txs, recurring: [pro, lookalike], settings: okSettings }).filter((i) => i.kind === 'fixed-changed').length, 0);
});
