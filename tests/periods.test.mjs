import test from 'node:test';
import assert from 'node:assert/strict';
import { periodFor, prevPeriod, payStarts } from '../src/core/periods.js';
import { dailyBudget, evaluatePeriod, runway, comparePeriods, buildInsights } from '../src/core/analysis.js';
import { DEFAULT_CATEGORIES } from '../src/core/categories.js';
import { sanitizeSettings } from '../src/core/settings.js';

let n = 0;
const tx = (date, amount, categoryId = 'food', extra = {}) => ({
  id: `t${++n}`, type: 'expense', amount, categoryId, date, note: '', business: false, createdAt: n, updatedAt: n, ...extra,
});
const inc = (date, amount, categoryId = 'bizincome') => tx(date, amount, categoryId, { type: 'income' });
const RM = (x) => Math.round(x * 100);
const settings = sanitizeSettings({
  expectedIncome: RM(5000), savingsTarget: RM(1000), currentSavings: RM(6000), startDate: '2026-08-01',
  payCycle: { enabled: true, from: 15, to: 20 },
});

test('a pay cycle starts with the first 薪水 / 创业收入 inside the window', () => {
  const txs = [inc('2026-09-03', RM(300), 'salary'), inc('2026-09-15', RM(1000), 'freelance'), inc('2026-09-16', RM(1500)), inc('2026-09-19', RM(3500))];
  assert.deepEqual(payStarts(txs, { from: 15, to: 20 }), ['2026-09-16']); // not the 3rd (outside), not 项目兼职
  const p = periodFor('2026-09-24', { txs, settings });
  assert.equal(p.kind, 'cycle');
  assert.equal(p.start, '2026-09-16');
  assert.equal(p.end, '2026-10-19');       // next income assumed on the 20th — the latest day of the window
  assert.equal(p.nextPay, '2026-10-20');
  // Once October's income is in, the cycle closes the day before
  const withOct = [...txs, inc('2026-10-17', RM(5000))];
  assert.equal(periodFor('2026-09-24', { txs: withOct, settings }).end, '2026-10-16');
  assert.equal(periodFor('2026-10-18', { txs: withOct, settings }).start, '2026-10-17');
  assert.equal(prevPeriod(periodFor('2026-10-18', { txs: withOct, settings }), { txs: withOct, settings }).start, '2026-09-16');
});

test('late income stretches the cycle instead of starting a new one', () => {
  const txs = [inc('2026-09-15', RM(5000))];
  const p = periodFor('2026-10-22', { txs, settings });
  assert.equal(p.start, '2026-09-15');
  assert.equal(p.overdue, true);
  assert.equal(p.end, '2026-10-28'); // one more week
});

test('daily budget runs from payday to the day before the next one', () => {
  const rec = [
    { id: 'u', type: 'expense', amount: RM(60), categoryId: 'utilities', day: 15, active: true, startMonth: '2026-09', lastMonth: '2026-09' },
    { id: 'h', type: 'expense', amount: RM(900), categoryId: 'housing', day: 20, active: true, startMonth: '2026-09', lastMonth: '2026-09' },
  ];
  const txs = [
    tx('2026-09-05', RM(400)),                  // before this cycle: not counted
    inc('2026-09-15', RM(5000)),
    tx('2026-09-19', RM(900), 'housing', { recurringId: 'h' }),
    tx('2026-09-20', RM(100)),
    tx('2026-09-24', RM(20)),
  ];
  const b = dailyBudget({ txs, settings, recurring: rec, today: '2026-09-24' });
  assert.equal(b.period.start, '2026-09-15');
  assert.equal(b.budget, RM(4000));
  assert.equal(b.spentMonth, RM(1020));
  assert.equal(b.daysLeft, 26);              // 24 Sep … 19 Oct
  assert.equal(b.reserved, RM(60));          // utilities on 15 Oct falls inside; rent on 20 Oct is the next cycle's
  assert.equal(b.allowanceToday, Math.floor((RM(4000) - RM(1000) - RM(60)) / 26));
});

test('cycles are compared with the monthly reference per 30 days', () => {
  const txs = [inc('2026-08-15', RM(5000)), tx('2026-08-16', RM(3500)), inc('2026-09-19', RM(5000))];
  const p = periodFor('2026-08-20', { txs, settings }); // 15 Aug – 18 Sep = 35 days
  assert.equal(p.days, 35);
  const ev = evaluatePeriod({ txs, period: p, categories: DEFAULT_CATEGORIES, profile: {}, today: '2026-09-24' });
  assert.equal(ev.perMonth, RM(3000));
  assert.equal(ev.normalized, true);
});

test('runway uses complete cycles per 30 days, or the current pace with fixed costs as they are', () => {
  const txs = [
    inc('2026-08-15', RM(5000)), tx('2026-08-16', RM(3500)),   // 35-day cycle → RM 3,000 per 30 days
    inc('2026-09-19', RM(5000)), tx('2026-09-20', RM(1000)),
  ];
  const rw = runway({ txs, currentSavings: RM(6000), today: '2026-09-24', since: '2026-08-01', settings });
  assert.equal(Math.round(rw.avg), RM(3000));
  assert.equal(rw.months, 2);
  assert.match(rw.basis, /收入周期/);
  // No complete cycle yet: rent counted once, day-to-day spending extrapolated
  const fresh = [inc('2026-09-15', RM(5000)), tx('2026-09-15', RM(900), 'housing'), tx('2026-09-20', RM(300))];
  const r2 = runway({ txs: fresh, currentSavings: RM(6000), today: '2026-09-24', since: '2026-09-15', settings });
  const length = 35; // 15 Sep – 19 Oct
  assert.equal(Math.round(r2.avg), Math.round((RM(900) + (RM(300) / 10) * length) * (30 / length)));
});

test('insights speak of 本期 and compare with the previous cycle', () => {
  const txs = [inc('2026-08-15', RM(5000)), tx('2026-08-20', RM(2000)), inc('2026-09-16', RM(5000)), tx('2026-09-20', RM(1500))];
  const cur = periodFor('2026-09-24', { txs, settings });
  const cmp = comparePeriods(txs, cur, prevPeriod(cur, { txs, settings }), DEFAULT_CATEGORIES, '2026-08-01');
  assert.equal(cmp.comparable, true);
  assert.equal(cmp.normalized, true);
  const ins = buildInsights({ txs, period: cur, categories: DEFAULT_CATEGORIES, profile: {}, settings, today: '2026-09-24' });
  assert.ok(ins.some((i) => i.title === '与上一期相比'));
  assert.ok(!ins.some((i) => /本月/.test(i.title + i.body)));
});

test('calendar months stay the default', () => {
  const plain = sanitizeSettings({});
  assert.equal(plain.payCycle.enabled, false);
  assert.equal(periodFor('2026-09-24', { txs: [], settings: plain }).key, '2026-09');
  assert.deepEqual(sanitizeSettings({ payCycle: { enabled: true, from: 20, to: 10 } }).payCycle, { enabled: true, from: 20, to: 20 });
});
