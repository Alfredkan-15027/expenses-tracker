import test from 'node:test';
import assert from 'node:assert/strict';

import { toCents, formatMoney, moneyParts, centsToInput } from '../src/core/money.js';
import { addMonths, daysInMonth, dateInMonth, dayLabel, isValidISODate, monthRange } from '../src/core/dates.js';
import { DEFAULT_CATEGORIES } from '../src/core/categories.js';
import {
  monthSummary, dailyBudget, compareMonths, evaluateMonth, trend, runway, quickPicks, buildInsights, upcomingRecurring,
  trackingStart,
} from '../src/core/analysis.js';
import { generateDue, newRecurring, nextDueDate, findManualMatch } from '../src/core/recurring.js';
import { buildBackup, parseBackup, toCSV } from '../src/core/backup.js';
import { sanitizeSettings } from '../src/core/settings.js';
import { livingCostTiers, categoryRanges } from '../src/core/benchmarks.js';

let n = 0;
const id = () => `id${++n}`;
const tx = (date, amount, categoryId = 'food', extra = {}) => ({
  id: id(), type: 'expense', amount, categoryId, date, note: '', business: false, createdAt: n, updatedAt: n, ...extra,
});
const income = (date, amount, categoryId = 'salary') => tx(date, amount, categoryId, { type: 'income' });

test('money: parsing and formatting', () => {
  assert.equal(toCents('12'), 1200);
  assert.equal(toCents('12.5'), 1250);
  assert.equal(toCents('1,234.56'), 123456);
  assert.equal(toCents('0.1'), 10);
  assert.equal(toCents('abc'), null);
  assert.equal(toCents('1.234'), null);
  assert.equal(toCents(''), null);
  assert.equal(toCents('-5'), null);
  assert.equal(formatMoney(123456), 'RM 1,234.56');
  assert.equal(formatMoney(-500), '−RM 5.00');
  assert.equal(formatMoney(150000, { round: true }), 'RM 1,500');
  assert.deepEqual(moneyParts(1205), { sign: '', int: '12', dec: '05' });
  assert.equal(centsToInput(1250), '12.50');
  assert.equal(centsToInput(1200), '12');
});

test('dates: month math and labels', () => {
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(dateInMonth('2026-09', 31), '2026-09-30');
  assert.equal(dayLabel('2026-09-23', '2026-09-23'), '今天');
  assert.equal(dayLabel('2026-09-22', '2026-09-23'), '昨天');
  assert.equal(isValidISODate('2026-02-30'), false);
  assert.deepEqual(monthRange('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
});

test('monthSummary separates business spending', () => {
  const txs = [
    tx('2026-09-01', 1000), tx('2026-09-02', 5000, 'business'), tx('2026-09-03', 2000, 'food', { business: true }),
    income('2026-09-01', 300000), tx('2026-08-30', 999),
  ];
  const s = monthSummary(txs, '2026-09', DEFAULT_CATEGORIES);
  assert.equal(s.expense, 8000);
  assert.equal(s.business, 7000);
  assert.equal(s.personal, 1000);
  assert.equal(s.income, 300000);
  assert.equal(s.byGroup.need, 1000);
});

test('dailyBudget spreads remaining budget over remaining days and reserves upcoming fixed costs', () => {
  const settings = { expectedIncome: 400000, savingsTarget: 100000 }; // budget RM 3,000
  const txs = [tx('2026-09-01', 30000), tx('2026-09-10', 20000), tx('2026-09-23', 1500)];
  const recurring = [{ id: 'r1', type: 'expense', amount: 60000, categoryId: 'housing', day: 28, active: true, startMonth: '2026-09', lastMonth: null }];
  const b = dailyBudget({ txs, settings, recurring, today: '2026-09-23' });
  assert.equal(b.budget, 300000);
  assert.equal(b.reserved, 60000);
  assert.equal(b.daysLeft, 8); // 23..30
  // remaining at start of today: 300000 - 50000 - 60000 = 190000 → /8 = 23750
  assert.equal(b.allowanceToday, 23750);
  assert.equal(b.leftToday, 22250);
  assert.equal(b.status, 'ok');
});

test('dailyBudget falls back to actual income and reports no plan', () => {
  const none = dailyBudget({ txs: [], settings: {}, today: '2026-09-05' });
  assert.equal(none.status, 'none');
  const actual = dailyBudget({ txs: [income('2026-09-01', 200000)], settings: {}, today: '2026-09-01' });
  assert.equal(actual.hasPlan, true);
  assert.equal(actual.usesExpected, false);
  assert.equal(actual.budget, 200000);
});

test('dailyBudget prorates the month tracking started', () => {
  const settings = { expectedIncome: 300000, savingsTarget: 0, startDate: '2026-09-23' }; // 30-day month
  const b = dailyBudget({ txs: [], settings, today: '2026-09-23' });
  assert.equal(b.prorated, true);
  assert.equal(b.budget, 80000); // 3000 × 8/30
  assert.equal(b.allowanceToday, 10000);
  const withRent = dailyBudget({ txs: [tx('2026-09-01', 75000, 'housing')], settings, today: '2026-09-23' });
  assert.equal(withRent.spentMonth, 0); // paid before tracking started — outside the prorated budget
  assert.equal(withRent.allowanceToday, 10000);
  const next = dailyBudget({ txs: [], settings, today: '2026-10-01' });
  assert.equal(next.prorated, false);
  assert.equal(next.budget, 300000);
});

test('evaluateMonth does not extrapolate rent and uses the start date', () => {
  const txs = [tx('2026-09-01', 75000, 'housing'), tx('2026-09-02', 30000, 'food')];
  const ev = evaluateMonth({ txs, ym: '2026-09', categories: DEFAULT_CATEGORIES, profile: {}, today: '2026-09-10' });
  assert.equal(ev.projected, 75000 + 90000); // rent as-is, food ×3
  assert.equal(ev.rows.find((r) => r.categoryId === 'housing').status, 'ok');
  const late = evaluateMonth({ txs: [tx('2026-08-25', 20000, 'food')], ym: '2026-08', categories: DEFAULT_CATEGORIES, profile: {}, today: '2026-09-10', startDate: '2026-08-25' });
  assert.equal(late.isPartial, true);
  assert.equal(late.projected, Math.round(20000 / (7 / 31)));
});

test('upcomingRecurring ignores already generated or past items', () => {
  const r = [
    { id: 'a', type: 'expense', amount: 100, day: 25, active: true, lastMonth: null },
    { id: 'b', type: 'expense', amount: 200, day: 25, active: true, lastMonth: '2026-09' },
    { id: 'c', type: 'expense', amount: 400, day: 5, active: true, lastMonth: null },
    { id: 'd', type: 'income', amount: 800, day: 28, active: true, lastMonth: null },
  ];
  assert.equal(upcomingRecurring(r, '2026-09-10'), 100);
});

test('compareMonths computes deltas per category', () => {
  const txs = [tx('2026-08-05', 10000), tx('2026-09-05', 15000), tx('2026-09-06', 5000, 'transport')];
  const c = compareMonths(txs, '2026-09', DEFAULT_CATEGORIES);
  assert.equal(c.delta, 10000);
  assert.equal(c.rows[0].categoryId, 'food');
  assert.equal(c.rows[0].ratio, 0.5);
});

test('evaluateMonth tiers respect profile', () => {
  assert.deepEqual(livingCostTiers({ housing: 'room', transport: 'public' }), [1700, 2800, 3800]);
  assert.deepEqual(livingCostTiers({ housing: 'family', transport: 'car' }), [2000, 3100, 4100]);
  assert.deepEqual(categoryRanges({ transport: 'car' }).transport, [700, 1300]);
  const txs = [tx('2026-08-01', 70000, 'housing'), tx('2026-08-02', 150000, 'food'), tx('2026-08-03', 20000, 'transport'), tx('2026-08-04', 900000, 'business')];
  const ev = evaluateMonth({ txs, ym: '2026-08', categories: DEFAULT_CATEGORIES, profile: { housing: 'room', transport: 'public' }, today: '2026-09-23' });
  assert.equal(ev.personalTotal, 240000); // business excluded
  assert.equal(ev.tier, 'ok');
  const food = ev.rows.find((r) => r.categoryId === 'food');
  assert.equal(food.status, 'over'); // RM1,500 vs [500, 900]
  assert.equal(ev.rows.find((r) => r.categoryId === 'housing').status, 'ok');
  assert.ok(!ev.rows.some((r) => r.categoryId === 'business'));
});

test('evaluateMonth projects the current month', () => {
  const txs = [tx('2026-09-01', 100000, 'food')];
  const ev = evaluateMonth({ txs, ym: '2026-09', categories: DEFAULT_CATEGORIES, profile: {}, today: '2026-09-10' });
  assert.equal(ev.isCurrent, true);
  assert.equal(ev.projected, 300000);
});

test('trend returns n months in order', () => {
  const t = trend([tx('2026-04-01', 100), income('2026-09-01', 500)], '2026-09', 6);
  assert.equal(t.length, 6);
  assert.equal(t[0].ym, '2026-04');
  assert.equal(t[0].expense, 100);
  assert.equal(t[5].income, 500);
});

test('runway uses average of recent complete months', () => {
  const txs = [tx('2026-08-01', 200000), tx('2026-07-01', 100000)];
  const r = runway({ txs, currentSavings: 900000, today: '2026-09-15' });
  assert.equal(r.avg, 150000);
  assert.equal(r.months, 6);
  assert.equal(runway({ txs, currentSavings: 0, today: '2026-09-15' }), null);
});

test('quickPicks finds repeated entries', () => {
  const txs = [tx('2026-09-01', 1200, 'food', { note: '午餐' }), tx('2026-09-02', 1200, 'food', { note: '午餐' }), tx('2026-09-03', 900, 'food')];
  const q = quickPicks(txs, '2026-09-23');
  assert.equal(q.length, 1);
  assert.equal(q[0].note, '午餐');
  assert.equal(q[0].count, 2);
});

test('buildInsights produces a verdict first', () => {
  const txs = [tx('2026-08-01', 60000, 'housing'), tx('2026-08-02', 80000, 'food'), income('2026-08-01', 400000)];
  const list = buildInsights({ txs, ym: '2026-08', categories: DEFAULT_CATEGORIES, profile: {}, settings: { savingsTarget: 80000 }, today: '2026-09-23' });
  assert.ok(list.length >= 2);
  assert.equal(list[0].icon, 'target');
  assert.ok(list.some((i) => i.title.includes('储蓄率')));
  const empty = buildInsights({ txs: [], ym: '2026-08', categories: DEFAULT_CATEGORIES, profile: {}, settings: {}, today: '2026-09-23' });
  assert.equal(empty.length, 1);
});

test('recurring: generates due months once and backfills', () => {
  let k = 0;
  const mk = () => `g${++k}`;
  const rent = { id: 'rent', type: 'expense', amount: 60000, categoryId: 'housing', day: 1, active: true, startMonth: '2026-07', lastMonth: null };
  const { created, updated } = generateDue([rent], '2026-09-23', mk);
  assert.deepEqual(created.map((c) => c.date), ['2026-07-01', '2026-08-01', '2026-09-01']);
  assert.equal(updated[0].lastMonth, '2026-09');
  const again = generateDue(updated, '2026-09-30', mk);
  assert.equal(again.created.length, 0);
  const late = { ...rent, day: 28, startMonth: '2026-09' };
  assert.equal(generateDue([late], '2026-09-23', mk).created.length, 0);
  assert.equal(generateDue([late], '2026-09-28', mk).created.length, 1);
});

test('recurring: newRecurring respects includeThisMonth', () => {
  const base = { id: 'x', type: 'expense', amount: 100, categoryId: 'utilities', day: 5 };
  assert.equal(newRecurring({ ...base, includeThisMonth: false }, '2026-09-23').lastMonth, '2026-09');
  assert.equal(newRecurring({ ...base, includeThisMonth: true }, '2026-09-23').lastMonth, null);
  assert.equal(nextDueDate(newRecurring({ ...base, includeThisMonth: false }, '2026-09-23'), '2026-09-23'), '2026-10-05');
});

test('backup round trip and validation', () => {
  const data = {
    transactions: [tx('2026-09-01', 1000, 'food', { note: '<img src=x onerror=alert(1)>' })],
    categories: DEFAULT_CATEGORIES,
    recurring: [],
    settings: { expectedIncome: 100, profile: { housing: 'unit', transport: 'car' }, evil: 'x' },
  };
  const parsed = parseBackup(JSON.stringify(buildBackup(data)));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.transactions.length, 1);
  assert.equal(parsed.data.settings.evil, undefined);
  assert.equal(parsed.data.settings.profile.housing, 'unit');
  assert.equal(parseBackup('nope').ok, false);
  assert.equal(parseBackup(JSON.stringify({ app: 'other' })).ok, false);
  const bad = buildBackup({ ...data, transactions: [{ id: '../x', type: 'expense', amount: -1 }] });
  assert.equal(parseBackup(JSON.stringify(bad)).data.transactions.length, 0);
});

test('csv escapes formulas and quotes', () => {
  const csv = toCSV([tx('2026-09-01', 1000, 'food', { note: '=HYPERLINK("x")' })], DEFAULT_CATEGORIES);
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.startsWith('﻿日期'));
});

test('settings sanitize drops unknown keys and bad values', () => {
  const s = sanitizeSettings({ expectedIncome: -5, savingsTarget: 1.5, goalName: 'x'.repeat(50), profile: { housing: 'castle' } });
  assert.equal(s.expectedIncome, 0);
  assert.equal(s.savingsTarget, 0);
  assert.equal(s.goalName.length, 20);
  assert.equal(s.profile.housing, 'room');
});

test('history typed in after setup counts from its first day, not the setup day', () => {
  const settings = sanitizeSettings({ expectedIncome: 600000, savingsTarget: 100000, startDate: '2026-09-23' });
  const txs = [tx('2026-09-01', 150000, 'housing'), tx('2026-09-05', 3000), tx('2026-09-10', 2000), tx('2026-09-23', 2000)];
  assert.equal(trackingStart(settings, txs), '2026-09-01');
  const b = dailyBudget({ txs, settings, today: '2026-09-23' });
  assert.equal(b.budget, 500000); // the full month's budget, not 8/30 of it
  assert.equal(b.spentMonth, 157000); // earlier spending is counted
  // A single catch-up entry (rent already paid) keeps the setup date
  assert.equal(trackingStart(settings, [tx('2026-09-01', 150000, 'housing')]), '2026-09-23');
  const ev = evaluateMonth({ txs, ym: '2026-09', categories: DEFAULT_CATEGORIES, profile: {}, today: '2026-09-23', startDate: trackingStart(settings, txs) });
  assert.ok(ev.projected < 300000, `projection ${ev.projected} blown up`); // not extrapolated from 1 day
  // Entries made by fixed items do not move the start
  assert.equal(trackingStart(settings, [tx('2026-09-01', 150000, 'housing', { recurringId: 'r' })]), '2026-09-23');
});

test('recurring: an entry already typed in this month is not logged again', () => {
  const txs = [tx('2026-09-01', 150000, 'housing')];
  assert.ok(findManualMatch(txs, { type: 'expense', categoryId: 'housing', amount: 150000 }, '2026-09-10'));
  assert.equal(findManualMatch(txs, { type: 'expense', categoryId: 'housing', amount: 90000 }, '2026-09-10'), null);
  assert.equal(findManualMatch(txs, { type: 'expense', categoryId: 'housing', amount: 150000 }, '2026-10-10'), null);
  // skipping this month works even when the due day is still ahead
  const r = newRecurring({ id: 'x', type: 'expense', amount: 150000, categoryId: 'housing', day: 28, includeThisMonth: false }, '2026-09-10');
  assert.equal(generateDue([r], '2026-09-28', id).created.length, 0);
  assert.equal(generateDue([r], '2026-10-28', id).created.length, 1);
});

test('a stray entry in the month before tracking does not drive runway or the monthly comparison', () => {
  const settings = sanitizeSettings({ expectedIncome: 500000, startDate: '2026-09-23' });
  const txs = [
    tx('2026-08-30', 2830, 'subscriptions', { recurringId: 'r' }), // one fixed-item entry dated in August
    tx('2026-09-01', 100000, 'food'), tx('2026-09-05', 100000, 'food'), tx('2026-09-12', 100000, 'food'),
  ];
  const since = trackingStart(settings, txs);
  assert.equal(since, '2026-09-01');
  const rw = runway({ txs, currentSavings: 118800, today: '2026-09-23', since });
  assert.ok(rw.months < 2, `runway ${rw.months} months`); // not 42 months from August's RM 28
  assert.equal(compareMonths(txs, '2026-09', DEFAULT_CATEGORIES, since).comparable, false);
  assert.equal(compareMonths(txs, '2026-10', DEFAULT_CATEGORIES, since).comparable, true);
  const ins = buildInsights({ txs, ym: '2026-09', categories: DEFAULT_CATEGORIES, profile: {}, settings, today: '2026-09-23' });
  assert.ok(!ins.some((i) => i.title === '与上月相比'));
});
