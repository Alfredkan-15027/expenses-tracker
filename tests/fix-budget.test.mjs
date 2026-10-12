// Regression tests for the budget fixes: the prorated first period (late income, fixed items, back-filled
// income) and the Today hero / rings wording that goes with it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { dailyBudget, periodBudget, trackingStart } from '../src/core/analysis.js';
import { periodFor } from '../src/core/periods.js';
import { sanitizeSettings } from '../src/core/settings.js';
import { DEFAULT_CATEGORIES } from '../src/core/categories.js';

let n = 0;
const RM = (v) => Math.round(v * 100);
const tx = (date, amount, categoryId = 'food', extra = {}) => ({
  id: `t${++n}`, type: 'expense', amount, categoryId, date, note: '', business: false, createdAt: n, updatedAt: n, ...extra,
});
const income = (date, amount, categoryId = 'salary') => tx(date, amount, categoryId, { type: 'income' });
const cycleSettings = (extra) => sanitizeSettings({
  expectedIncome: RM(4000), savingsTarget: RM(1000), payCycle: { enabled: true, from: 15, to: 20 }, ...extra,
});

// The Today screen pulls in the sheets, which touch the DOM when they load: just enough of it to render to a string.
const noop = () => {};
const el = () => ({ addEventListener: noop, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, appendChild: noop, querySelector: () => null, querySelectorAll: () => [], setAttribute: noop, style: {}, dataset: {} });
globalThis.window ??= globalThis;
globalThis.document ??= { addEventListener: noop, getElementById: () => el(), createElement: el, querySelector: () => null, querySelectorAll: () => [], documentElement: el(), body: el() };
globalThis.matchMedia ??= () => ({ matches: false, addEventListener: noop });
const todayScreen = (await import('../src/ui/screens/today.js')).default;
const text = (h) => h.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
function renderToday({ txs, settings, recurring = [], today }) {
  const out = String(todayScreen.render({
    state: { transactions: txs, recurring, categories: DEFAULT_CATEGORIES, settings: { ...settings, onboarded: true }, holdings: [], investFlows: [] },
    today, demo: true,
  }));
  const hero = out.match(/<section class="card card--hero"[\s\S]*?<\/section>/)?.[0] || '';
  const rings = out.match(/<section class="card card--rings"[\s\S]*?<\/section>/)?.[0] || '';
  return { hero, rings, heroText: text(hero), ringsText: text(rings) };
}

test('trackingStart: back-filled income is history, not past spending — the first period stays prorated', () => {
  const settings = sanitizeSettings({ expectedIncome: RM(4000), savingsTarget: RM(1000), startDate: '2026-11-10' });
  const salaries = [income('2026-08-25', RM(4000)), income('2026-09-25', RM(4000)), income('2026-10-25', RM(4000))];
  assert.equal(trackingStart(settings, salaries), '2026-11-10');
  const txs = [...salaries, tx('2026-11-03', RM(50))];
  assert.equal(trackingStart(settings, txs), '2026-11-10');
  const b = dailyBudget({ txs, settings, today: '2026-11-10' });
  assert.equal(b.prorated, true);
  assert.equal(b.budget, RM(2100)); // 3,000 × 21/30
  assert.equal(b.allowanceToday, RM(100));
  // Spending typed in on 3 different days still moves the start back (unchanged)
  assert.equal(trackingStart(settings, [tx('2026-11-01', 1000), tx('2026-11-03', 1000), tx('2026-11-05', 1000)]), '2026-11-01');

  // Pay cycle: the salary that opens the cycle plus two catch-up expenses keep the setup date
  const cyc = cycleSettings({ startDate: '2026-11-01' });
  const ctxs = [income('2026-10-16', RM(4000)), tx('2026-10-20', RM(30)), tx('2026-10-25', RM(30))];
  assert.equal(trackingStart(cyc, ctxs), '2026-11-01');
  const c = dailyBudget({ txs: ctxs, settings: cyc, today: '2026-11-01' });
  assert.equal(c.prorated, true);
  assert.equal(c.budget, Math.round((RM(3000) * 19) / 35)); // 16 Oct – 19 Nov, tracked from 1 Nov
});

test('a prorated first cycle keeps its budget while the next salary is late', () => {
  // Salary on 16 Sep typed in at setup on 30 Sep: the cycle 16 Sep – 19 Oct (34 days) is tracked for 20 of them.
  const settings = cycleSettings({ startDate: '2026-09-30' });
  const txs = [income('2026-09-16', RM(4000)), tx('2026-09-30', RM(500)), tx('2026-10-10', RM(500))];
  const onTime = dailyBudget({ txs, settings, today: '2026-10-19' });
  assert.equal(onTime.prorated, true);
  assert.equal(onTime.budget, Math.round((RM(3000) * 20) / 34));
  for (const today of ['2026-10-20', '2026-10-24', '2026-10-28', '2026-11-02']) {
    const b = dailyBudget({ txs, settings, today });
    assert.ok(b.period.end > '2026-10-19', `${today}: the cycle is stretched while the salary is late`);
    assert.equal(b.budget, onTime.budget, `${today}: lateness adds no budget`);
    assert.equal(b.leftMonth, onTime.leftMonth, `${today}: and no money to spend`);
  }
  assert.equal(dailyBudget({ txs, settings, today: '2026-10-28' }).period.overdue, true);

  // Overspent before the salary is due: still overspent the days after, not "ok" again
  const heavy = [income('2026-09-16', RM(4000)), tx('2026-09-30', RM(900)), tx('2026-10-10', RM(900))];
  assert.equal(dailyBudget({ txs: heavy, settings, today: '2026-10-19' }).status, 'overMonth');
  for (const today of ['2026-10-20', '2026-10-24']) assert.equal(dailyBudget({ txs: heavy, settings, today }).status, 'overMonth');

  // Same with the salary of 15 Sep and tracking from 1 Oct (4,000 budget × 19/35)
  const s2 = sanitizeSettings({ expectedIncome: RM(5000), savingsTarget: RM(1000), startDate: '2026-10-01', payCycle: { enabled: true, from: 15, to: 20 } });
  const t2 = [income('2026-09-15', RM(5000))];
  for (const today of ['2026-10-19', '2026-10-20', '2026-10-25', '2026-11-01']) {
    assert.equal(dailyBudget({ txs: t2, settings: s2, today }).budget, Math.round((RM(4000) * 19) / 35), today);
  }
  // Set up while the salary is already late (after the cycle's planned end): still a sensible, positive budget
  const s3 = cycleSettings({ startDate: '2026-10-22' });
  const late = dailyBudget({ txs: [income('2026-09-16', RM(4000))], settings: s3, today: '2026-10-22' });
  assert.ok(late.budget > 0 && late.budget < RM(3000), `budget ${late.budget}`);
});

test('a prorated first month counts fixed items on the day they land, not by the share of days', () => {
  // November (30 days), budget 3,000, rent 1,500. A whole month leaves (3,000 − 1,500) / 30 = RM 50 a day.
  const settings = sanitizeSettings({ expectedIncome: RM(4000), savingsTarget: RM(1000), startDate: '2026-11-10' });
  const rent = (day, extra = {}) => ({
    id: 'rent', type: 'expense', amount: RM(1500), categoryId: 'housing', note: '房租', day, active: true, startMonth: '2026-11', lastMonth: null, ...extra,
  });
  const logged = (date) => tx(date, RM(1500), 'housing', { recurringId: 'rent', note: '房租' });

  // Rent on the 1st, logged before tracking started: outside the tracked part
  const early = dailyBudget({ txs: [logged('2026-11-01')], settings, recurring: [rent(1, { lastMonth: '2026-11' })], today: '2026-11-10' });
  assert.equal(early.budget, RM(1050)); // (3,000 − 1,500) × 21/30
  assert.equal(early.allowanceToday, RM(50));
  // Rent on the 25th, still to come: all of it lands in the tracked part, and it is reserved
  const later = dailyBudget({ txs: [], settings, recurring: [rent(25)], today: '2026-11-10' });
  assert.equal(later.budget, RM(1050 + 1500));
  assert.equal(later.reserved, RM(1500));
  assert.equal(later.allowanceToday, RM(50));
  assert.equal(later.fixedTracked, RM(1500));
  // Set up on the 20th with rent on the 25th: no "overspent" on day one with nothing spent
  const s20 = { ...settings, startDate: '2026-11-20' };
  const day1 = dailyBudget({ txs: [], settings: s20, recurring: [rent(25)], today: '2026-11-20' });
  assert.equal(day1.status, 'ok');
  assert.equal(day1.leftMonth, RM(550));
  assert.equal(day1.allowanceToday, RM(50));
  const charged = dailyBudget({ txs: [logged('2026-11-25')], settings: s20, recurring: [rent(25, { lastMonth: '2026-11' })], today: '2026-11-26' });
  assert.equal(charged.status, 'ok');
  assert.equal(charged.leftMonth, RM(550));
  // Already paid by hand (本月也记一笔 off): the hand-typed entry is this month's rent, on the day it was typed in
  const handAfter = dailyBudget({ txs: [tx('2026-11-10', RM(1500), 'housing')], settings, recurring: [rent(1, { lastMonth: '2026-11' })], today: '2026-11-11' });
  assert.equal(handAfter.leftMonth, RM(1050));
  assert.equal(handAfter.status, 'ok');
  const handBefore = dailyBudget({ txs: [tx('2026-11-05', RM(1500), 'housing')], settings, recurring: [rent(25, { lastMonth: '2026-11' })], today: '2026-11-10' });
  assert.equal(handBefore.leftMonth, RM(1050));
  // A business fixed item stays outside unless business spending counts
  const biz = { id: 'cowork', type: 'expense', amount: RM(600), categoryId: 'business', day: 25, business: true, active: true, startMonth: '2026-11', lastMonth: null };
  assert.equal(dailyBudget({ txs: [], settings, recurring: [biz], today: '2026-11-10' }).budget, RM(2100));
  // Analysis gets the same budget for the period as Today
  const p = periodFor('2026-11-10', { txs: [], settings, today: '2026-11-10' });
  assert.equal(periodBudget({ txs: [], settings, period: p, recurring: [rent(25)] }).budget, later.budget);
  // Not prorated: fixed items change nothing
  const full = sanitizeSettings({ expectedIncome: RM(4000), savingsTarget: RM(1000), startDate: '2026-11-01' });
  assert.equal(dailyBudget({ txs: [], settings: full, recurring: [rent(25)], today: '2026-11-10' }).budget, RM(3000));
});

test('Today: over only because of fixed items still to come reads as a projection, not as already overspent', () => {
  const settings = sanitizeSettings({ expectedIncome: RM(3000), savingsTarget: RM(1000), startDate: '2026-10-01' }); // budget 2,000
  const recurring = [{ id: 'rent', type: 'expense', amount: RM(1500), categoryId: 'housing', note: '房租', day: 25, active: true, startMonth: '2026-10', lastMonth: '2026-10' }];
  const txs = [tx('2026-11-03', RM(1000))];
  const b = dailyBudget({ txs, settings, recurring, today: '2026-11-10' });
  assert.equal(b.status, 'overMonth'); // the calculation stays: rent is reserved
  const { heroText, ringsText } = renderToday({ txs, settings, recurring, today: '2026-11-10' });
  assert.match(heroText, /本月预计超支/);
  assert.doesNotMatch(heroText, /已超支|预算已用完/);
  assert.match(heroText, /还没扣的固定支出/);
  assert.match(ringsText, /预算的 50%/);
  // Spending past the budget itself is still "already overspent"
  const over = [tx('2026-11-03', RM(2100))];
  const o = renderToday({ txs: over, settings, recurring, today: '2026-11-10' });
  assert.match(o.heroText, /本月已超支/);
  assert.match(o.heroText, /本月预算已用完/);
});

test('Today: the business split adds up to the total shown', () => {
  const settings = sanitizeSettings({ expectedIncome: RM(5000), savingsTarget: RM(1000), startDate: '2026-11-01', budgetIncludesBusiness: true });
  const txs = [tx('2026-11-03', RM(1200.5)), tx('2026-11-04', RM(300.5), 'business', { business: true })];
  const { heroText } = renderToday({ txs, settings, today: '2026-11-10' });
  const m = heroText.match(/本月已花 RM ([\d,]+)：个人 RM ([\d,]+) \+ 创业 RM ([\d,]+)/);
  assert.ok(m, heroText);
  const [total, personal, business] = m.slice(1).map((v) => Number(v.replace(/,/g, '')));
  assert.equal(personal + business, total);
  assert.equal(total, 1501);
  const low = [tx('2026-11-03', RM(1200.49)), tx('2026-11-04', RM(300.49), 'business', { business: true })];
  const l = renderToday({ txs: low, settings, today: '2026-11-10' }).heroText.match(/本月已花 RM ([\d,]+)：个人 RM ([\d,]+) \+ 创业 RM ([\d,]+)/);
  const [t2, p2, b2] = l.slice(1).map((v) => Number(v.replace(/,/g, '')));
  assert.equal(p2 + b2, t2);
});

test('Today: a RM 0 budget (savings target = income) is a plan that is exceeded, not "未设定预算"', () => {
  const settings = sanitizeSettings({ expectedIncome: RM(3000), savingsTarget: RM(3000), startDate: '2026-11-01' });
  const txs = [tx('2026-11-03', RM(50))];
  const b = dailyBudget({ txs, settings, today: '2026-11-10' });
  assert.equal(b.hasPlan, true);
  assert.equal(b.budget, 0);
  assert.ok(b.usedRatio > 1, `usedRatio ${b.usedRatio}`);
  const { hero, rings, ringsText } = renderToday({ txs, settings, today: '2026-11-10' });
  assert.doesNotMatch(ringsText, /未设定预算/);
  assert.match(ringsText, /预算为 RM 0/);
  assert.match(rings, /data-tone="over"/);
  assert.match(rings, /ring--over/);
  assert.match(hero, /progress__fill" style="width:100\.00%"/);
  // Nothing spent yet: an empty ring, still not "未设定预算"
  const none = renderToday({ txs: [], settings, today: '2026-11-10' });
  assert.match(none.ringsText, /预算为 RM 0/);
  assert.doesNotMatch(none.rings, /data-tone="over"/);
  // No plan at all is still "未设定预算"
  assert.match(renderToday({ txs, settings: sanitizeSettings({ startDate: '2026-11-01' }), today: '2026-11-10' }).ringsText, /未设定预算/);
});
