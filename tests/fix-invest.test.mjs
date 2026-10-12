// Regression tests for the investment fixes in 1.4.0: holding value, opening valuations, the contribution
// schedule, the start condition and the numbers the 投资 screen prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { holdingSummary, portfolioSummary, planState, contributionSchedule } from '../src/core/invest.js';

const RM = (n) => Math.round(n * 100);
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

// The screen imports the sheets module, which needs a browser. Swap it for a stub so the screen renders in Node.
const SHEETS_STUB = 'data:text/javascript,' + encodeURIComponent(
  ['openInvestActions', 'openFlowSheet', 'openValuationSheet', 'openHoldingDetail', 'openHoldingEditor', 'openPlanEditor']
    .map((n) => `export const ${n} = () => {};`).join('')
  + "export const holdingIcon = () => ({ icon: 'invest', color: 'blue' });",
);
if (nodeModule.registerHooks) {
  nodeModule.registerHooks({
    resolve: (spec, ctx, next) => (spec.endsWith('sheets/invest.js') ? { url: SHEETS_STUB, shortCircuit: true } : next(spec, ctx)),
  });
} else {
  nodeModule.register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) {
    return spec.endsWith('sheets/invest.js') ? { url: ${JSON.stringify(SHEETS_STUB)}, shortCircuit: true } : next(spec, ctx);
  }`));
}
const screen = (await import('../src/ui/screens/invest.js')).default;

const holdings = [{ id: 'h', name: '指数基金', kind: 'etf', order: 0 }];
function render({ flows = [], valuations = [], transactions = [], invest = {}, settings = {}, today }) {
  const state = { settings: { ...settings, invest }, holdings, investFlows: flows, valuations, transactions };
  return String(screen.render({ state, today })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

test('a sale above the recorded value is profit, not a debt the next deposit pays off', () => {
  const flows = [
    { holdingId: 'h', type: 'in', amount: RM(100_000), date: '2027-01-10', createdAt: 1 },
    { holdingId: 'h', type: 'out', amount: RM(120_000), date: '2027-06-10', createdAt: 3 },
    { holdingId: 'h', type: 'in', amount: RM(50_000), date: '2027-09-10', createdAt: 4 },
  ];
  for (const valuations of [[], [{ holdingId: 'h', value: RM(100_000), date: '2027-05-01', createdAt: 2 }]]) {
    const s = holdingSummary('h', flows, valuations, '2027-10-01');
    assert.equal(s.value, RM(50_000));
    assert.equal(s.gain, RM(20_000));
    const st = planState({ invest: {}, flows, valuations, holdings, asOf: '2027-10-01' });
    assert.equal(st.current, RM(50_000));
    near(st.progress, 50_000 / 1_750_000, 1e-9);
  }
});

test('a first market value with no money in before it is the opening principal, not profit', () => {
  const valuations = [{ holdingId: 'h', value: RM(50_000), date: '2026-01-05', createdAt: 1 }];
  const flows = [{ holdingId: 'h', type: 'in', amount: RM(10_000), date: '2026-02-01', createdAt: 2 }];
  const s = holdingSummary('h', flows, valuations, '2027-02-01');
  assert.equal(s.value, RM(60_000));
  assert.equal(s.invested, RM(60_000));
  assert.equal(s.gain, 0);
  const pf = portfolioSummary({ holdings, flows, valuations, asOf: '2027-02-01' });
  assert.equal(pf.gain, 0);
  near(pf.annualReturn, 0, 1e-6);
  // A real gain after it still counts
  const later = [...valuations, { holdingId: 'h', value: RM(66_000), date: '2027-02-01', createdAt: 3 }];
  assert.equal(holdingSummary('h', flows, later, '2027-02-01').gain, RM(6_000));
  assert.ok(portfolioSummary({ holdings, flows, valuations: later, asOf: '2027-02-01' }).annualReturn > 0.09);
  // Same day: the value typed before the money in is the opening; money in first means it is not
  assert.equal(holdingSummary('h', [{ ...flows[0], date: '2026-01-05' }], valuations, '2026-02-01').invested, RM(60_000));
  const inFirst = [{ ...flows[0], date: '2026-01-05', createdAt: 0 }];
  assert.equal(holdingSummary('h', inFirst, valuations, '2026-02-01').invested, RM(10_000));
});

test('a holding that only has a market value counts on the goal card; the 10 years still start at the first 投入', () => {
  const valuations = [{ holdingId: 'h', value: RM(50_000), date: '2026-10-01', createdAt: 1 }];
  const st = planState({ invest: {}, flows: [], valuations, holdings, asOf: '2026-10-12' });
  assert.equal(st.started, false);
  assert.equal(st.status, 'preparing');
  assert.equal(st.current, RM(50_000));
  near(st.required.low / 100, 104_954, 2);
  const text = render({ valuations, today: '2026-10-12' });
  assert.match(text, /准备阶段 RM 50,000/);
  assert.match(text, /从第一次投入开始计时/);
});

test('one late payment covers one scheduled contribution, not two', () => {
  const monthly = { freq: 'monthly' };
  const flows = [
    { holdingId: 'h', type: 'in', amount: RM(9_000), date: '2027-01-01' },
    { holdingId: 'h', type: 'in', amount: RM(9_000), date: '2027-02-14' },
  ];
  assert.deepEqual(planState({ invest: monthly, flows, valuations: [], holdings, asOf: '2027-02-14' }).next,
    { date: '2027-03-01', now: false, left: 118 });
  assert.deepEqual(planState({ invest: monthly, flows, valuations: [], holdings, asOf: '2027-03-05' }).next,
    { date: '2027-03-05', now: true, left: 118 });
  // Exactly halfway between 1 Feb and 1 Mar: it is February's (late), so March is still due
  const tie = [flows[0], { ...flows[1], date: '2027-02-15' }];
  assert.deepEqual(planState({ invest: monthly, flows: tie, valuations: [], holdings, asOf: '2027-03-05' }).next,
    { date: '2027-03-05', now: true, left: 118 });
  // Quarterly: the 1 Jan contribution paid on 15 Feb does not also pay 1 Apr
  const quarterly = [
    { holdingId: 'h', type: 'in', amount: RM(9_000), date: '2026-10-01' },
    { holdingId: 'h', type: 'in', amount: RM(9_000), date: '2027-02-15' },
  ];
  assert.deepEqual(planState({ invest: { freq: 'quarterly' }, flows: quarterly, valuations: [], holdings, asOf: '2027-04-03' }).next,
    { date: '2027-04-03', now: true, left: 38 });
  // Two payments in one month still count once
  const twice = contributionSchedule({ planStart: '2027-01-01', years: 1, freq: 'monthly', asOf: '2027-01-20', paidTimes: [0, 10 / 365] });
  assert.equal(twice.length, 11);
  assert.equal(twice[0].date, '2027-02-01');
});

test('the goal card counts down in days in the last month and says 已到期 only after the deadline', () => {
  const flows = [{ holdingId: 'h', type: 'in', amount: RM(1_000_000), date: '2030-05-20', createdAt: 1 }];
  const at = (today) => render({ flows, today });
  assert.match(at('2040-05-06'), /还剩 14 天 ·/);
  assert.match(at('2040-05-19'), /还剩 1 天 ·/);
  assert.match(at('2040-02-20'), /还剩 3 个月 ·/);
  assert.match(at('2037-11-21'), /还剩 2 年 5 个月 ·/);
  const after = at('2040-05-20');
  assert.match(after, /已到期 ·/);
  assert.doesNotMatch(after, /还剩 已到期/);
});

test('the start condition counts only income received so far this month', () => {
  const transactions = [
    { type: 'income', amount: RM(6_000), date: '2026-09-25' },
    { type: 'income', amount: RM(15_000), date: '2026-10-28' },
  ];
  const st = planState({ invest: {}, flows: [], valuations: [], holdings: [], transactions, asOf: '2026-10-12' });
  assert.equal(st.trigger.thisMonth, 0);
  assert.equal(st.trigger.reached, false);
});

test('完成 never reads 100% while the target is not reached', () => {
  const flows = [{ holdingId: 'h', type: 'in', amount: RM(1_000_000), date: '2016-03-01', createdAt: 1 }];
  const valuations = [{ holdingId: 'h', value: RM(1_742_000), date: '2026-10-01', createdAt: 2 }];
  const missed = render({ flows, valuations, today: '2026-10-12' });
  assert.match(missed, /期限已到，未达标/);
  assert.match(missed, /完成 99\.5%/);
  const done = render({ flows, valuations: [{ ...valuations[0], value: RM(1_750_000) }], today: '2026-10-12' });
  assert.match(done, /完成 100%/);
});

test('the income average leaves out months before tracking started', () => {
  const transactions = [{ type: 'income', amount: RM(15_000), date: '2026-09-25' }];
  const st = planState({ invest: {}, flows: [], valuations: [], holdings: [], transactions, asOf: '2026-10-12', since: '2026-09-01' });
  assert.equal(st.trigger.avg3, RM(15_000));
  assert.equal(st.trigger.avgMonths, 1);
  const none = planState({ invest: {}, flows: [], valuations: [], holdings: [], transactions, asOf: '2026-10-12', since: '2026-10-01' });
  assert.equal(none.trigger.avg3, null);
  // Without a tracking start every month counts, as before
  assert.equal(planState({ invest: {}, flows: [], valuations: [], holdings: [], transactions, asOf: '2026-10-12' }).trigger.avg3, RM(5_000));
  // The screen takes the start from the settings: one tracked month is just 上个月, two are averaged over two
  const one = render({ transactions, settings: { startDate: '2026-09-01' }, today: '2026-10-12' });
  assert.doesNotMatch(one, /个月平均/);
  const two = render({ transactions: [...transactions, { type: 'income', amount: RM(9_000), date: '2026-08-20' }], settings: { startDate: '2026-08-15' }, today: '2026-10-12' });
  assert.match(two, /近 2 个月平均 RM 12,000/);
});

test('the invest screen prints percentages and gains that agree with themselves', () => {
  const flows = [{ holdingId: 'h', type: 'in', amount: RM(100_000), date: '2025-10-12', createdAt: 1 }];
  const valued = (rm) => [{ holdingId: 'h', value: Math.round(rm * 100), date: '2026-10-12', createdAt: 2 }];
  // (a) 7.96% is shown as 8.0%, so it is not "below 8%"
  const st = planState({ invest: {}, flows, valuations: valued(107_960), holdings, asOf: '2026-10-12' });
  assert.equal(st.returnBand, 'within');
  assert.match(render({ flows, valuations: valued(107_960), today: '2026-10-12' }), /实际年化回报 8\.0%，在 8%–10% 之间/);
  assert.match(render({ flows, valuations: valued(110_040), today: '2026-10-12' }), /实际年化回报 10\.0%，在 8%–10% 之间/);
  // (b) a loss that rounds to 0.0% has no minus sign
  const flat = render({ flows, valuations: valued(99_960), today: '2026-10-12' });
  assert.doesNotMatch(flat, /-0\.0%|−0\.0%|\+0\.0%/);
  assert.match(flat, /RM 99,960 0\.0%/);
  assert.match(render({ flows, valuations: valued(96_500), today: '2026-10-12' }), /RM 96,500 −3\.5%/);
  // (c) return assumptions show as entered
  const rates = render({ flows, invest: { rateLow: 0.0825, rateHigh: 0.095 }, today: '2026-10-12' });
  assert.match(rates, /年回报假设 8\.25%–9\.5%/);
  assert.match(rates, /（按 8\.25%）/);
  // (d) a gain under RM 0.50 is RM 0, without a plus sign
  const tiny = render({ flows, valuations: valued(100_000.4), today: '2026-10-12' });
  assert.match(tiny, /盈亏 RM 0 /);
  assert.doesNotMatch(tiny, /\+RM 0/);
});
