// Regression tests for the first days after payday (1.4.3): income just in, rent and insurance paid by hand the same
// day, a business payment — the 分析 and 今天 figures must not read "excellent" or "+6,000%" from one day of records.
// Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document ??= { addEventListener() {}, getElementById() { return null; }, documentElement: { classList: { toggle() {} } } };

const { addDays } = await import('../src/core/dates.js');
const { periodFor, prevPeriod } = await import('../src/core/periods.js');
const { DEFAULT_CATEGORIES } = await import('../src/core/categories.js');
const { sanitizeSettings } = await import('../src/core/settings.js');
const { buildInsights, comparePeriods, runwayShown, MIN_COMPARE_DAYS } = await import('../src/core/analysis.js');
const { default: insights } = await import('../src/ui/screens/insights.js');
const { default: today } = await import('../src/ui/screens/today.js');

let n = 0;
const tx = (date, amount, categoryId = 'food', extra = {}) => ({
  id: `p${++n}`, type: 'expense', amount, categoryId, date, note: '', business: false, createdAt: n, updatedAt: n, ...extra,
});
const inc = (date, amount, categoryId = 'bizincome') => tx(date, amount, categoryId, { type: 'income' });
const RM = (x) => Math.round(x * 100);
const text = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const daily = (from, to, amount, categoryId = 'food') => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(tx(d, amount, categoryId));
  return out;
};

const settings = sanitizeSettings({
  startDate: '2026-09-14', expectedIncome: RM(5000), savingsTarget: RM(1000), payCycle: { enabled: true, from: 14, to: 20 },
  currentSavings: RM(3000), currentSavingsAt: '2026-11-14', currentSavingsTs: 1,
});
const recurring = [
  { id: 'rent', type: 'expense', amount: RM(800), categoryId: 'housing', note: '房租', day: 20, business: false, active: true, startMonth: '2026-09', lastMonth: '2026-10' },
  { id: 'ins', type: 'expense', amount: RM(250), categoryId: 'health', note: '保险费', day: 20, business: false, active: true, startMonth: '2026-09', lastMonth: '2026-10' },
];
// Two pay cycles: 9/14 and 10/16 (rent logged by the app on the 20th), then 11/14 with rent + insurance paid by hand.
const txs = [
  inc('2026-09-14', RM(4500)), ...daily('2026-09-14', '2026-10-15', RM(40)),
  tx('2026-09-20', RM(800), 'housing', { recurringId: 'rent' }), tx('2026-09-20', RM(250), 'health', { recurringId: 'ins' }),
  inc('2026-10-16', RM(4500)), ...daily('2026-10-16', '2026-11-14', RM(40)),
  tx('2026-10-20', RM(800), 'housing', { recurringId: 'rent' }), tx('2026-10-20', RM(250), 'health', { recurringId: 'ins' }),
  inc('2026-11-14', RM(4400)),
  tx('2026-11-14', RM(800), 'housing', { note: '' }), tx('2026-11-14', RM(250), 'health', { note: '保险费' }),
  tx('2026-11-14', RM(1750), 'business', { note: 'Debts' }),
];
const ctx = { txs, settings, today: '2026-11-14' };
const state = { transactions: txs, categories: DEFAULT_CATEGORIES, settings, recurring, investFlows: [] };

test('payday: a running period is compared only from its 7th day, without fixed items or business spending', () => {
  const cur = periodFor('2026-11-14', ctx);
  assert.equal(cur.start, '2026-11-14');
  const day1 = comparePeriods(txs, cur, prevPeriod(cur, ctx), DEFAULT_CATEGORIES, '2026-09-14', '2026-11-14', recurring);
  assert.equal(day1.early, true);
  assert.equal(day1.comparable, false);
  const ins = buildInsights({ txs, period: cur, categories: DEFAULT_CATEGORIES, profile: {}, settings, today: '2026-11-14', recurring });
  assert.ok(!ins.some((i) => i.id === 'compare'), 'no "+6,000%" from one day');
  assert.doesNotMatch(text(insights.render({ state, today: '2026-11-14' })), /与上一期相比/);

  // A week on, the same daily habit compares flat: the hand-paid rent / insurance and the business payment are left out
  const later = [...txs, ...daily('2026-11-15', '2026-11-20', RM(40))];
  const c7 = comparePeriods(later, periodFor('2026-11-20', { ...ctx, txs: later, today: '2026-11-20' }), prevPeriod(cur, ctx), DEFAULT_CATEGORIES, '2026-09-14', '2026-11-20', recurring);
  assert.equal(c7.sameDays, MIN_COMPARE_DAYS);
  assert.equal(c7.dayToDay, true);
  assert.equal(c7.delta, 0);
  assert.ok(!c7.rows.some((r) => r.categoryId === 'business' || r.categoryId === 'housing' || r.categoryId === 'health'));

  // Finished periods: personal spending, fixed items included, business left out
  const prev = prevPeriod(cur, ctx);
  const done = comparePeriods(txs, prev, prevPeriod(prev, ctx), DEFAULT_CATEGORIES, '2026-09-14', '2026-11-14', recurring);
  assert.equal(done.dayToDay, false);
  assert.ok(done.rows.some((r) => r.categoryId === 'housing'));
});

test('payday: 储蓄率 and 结余 show where the period is heading, the same figure everywhere', () => {
  const cur = periodFor('2026-11-14', ctx);
  const ins = buildInsights({ txs, period: cur, categories: DEFAULT_CATEGORIES, profile: {}, settings, today: '2026-11-14', recurring });
  const sav = ins.find((i) => i.id === 'savings');
  assert.match(sav.title, /预计/);
  const page = text(insights.render({ state, today: '2026-11-14' }));
  // The overview tile shows the insight's rate, not the "so far" rate of payday (RM 4,400 in, RM 2,840 out → 35%):
  // RM 4,400 − 2,840 − 35 more days × RM 40 = RM 160 by 12/19, 4%
  const tile = page.match(/预计储蓄率 (−?\d+%) 预计结余 (−?RM [\d,]+)/);
  assert.ok(tile, page.slice(0, 400));
  assert.equal(tile[1], sav.figure);
  assert.deepEqual([tile[1], tile[2]], ['4%', 'RM 160']);
  assert.doesNotMatch(page, /目前储蓄率/);
  const home = text(today.render({ state, today: '2026-11-14' }));
  assert.match(home, new RegExp(`本期预计结余 ${tile[2].replace(/[$()*+.?[\\\]^{|}]/g, '\\$&')}`));
  // A shortfall is measured from the projection
  assert.match(sav.body, /预计距离每期存款目标 RM 1,000 还差 RM 840/);
  assert.match(home, /存款目标 RM 1,000 · 还差 RM 840/);
});

test('payday: the Runway tile and card show the same months; the small print is folded', () => {
  const html = String(insights.render({ state, today: '2026-11-14' }));
  const tile = html.match(/够撑 ([\d.]+) 个月/)[1];
  const card = html.match(/runway__value">([^<]+)</)[1];
  assert.equal(tile, card);
  assert.equal(runwayShown(5.96), 5.9);
  // Explanations are in the page (VoiceOver, tests) but folded: inert until the ⓘ is tapped
  assert.match(html, /<button type="button" class="info-btn" data-info="bench" aria-expanded="false"/);
  assert.match(html, /class="info-panel " id="info-bench" inert/);
  assert.match(html, /class="insight__head" data-info="insight-savings" aria-expanded="false"/);
});
