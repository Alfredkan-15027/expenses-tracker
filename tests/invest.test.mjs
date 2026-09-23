import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requiredContribution, projectedValue, annuityDueFactor, periodRate, xirr, holdingSummary,
  portfolioSummary, planState, sanitizeInvest, addYears, projectionSeries, nextContributionDate, DEFAULT_INVEST,
} from '../src/core/invest.js';
import {
  encryptText, decryptEnvelope, deriveKey, randomBytes, isEnvelope, newRecoveryKey, normalizeRecoveryKey,
} from '../src/core/crypto.js';

const RM = (n) => Math.round(n * 100);
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test('yearly contribution to reach RM 1.75M in 10 years (start of each year)', () => {
  const base = { target: RM(1_750_000), current: 0, remainingYears: 10, freq: 'yearly' };
  near(requiredContribution({ ...base, rate: 0.08 }) / 100, 111_853, 2);
  near(requiredContribution({ ...base, rate: 0.09 }) / 100, 105_675, 2);
  near(requiredContribution({ ...base, rate: 0.10 }) / 100, 99_822, 2);
});

test('required contribution then projected value round-trips to the target', () => {
  for (const freq of ['yearly', 'quarterly', 'monthly']) {
    for (const t of [10, 7.4, 0.6]) {
      const args = { target: RM(1_750_000), current: RM(120_000), remainingYears: t, rate: 0.09, freq };
      const pmt = requiredContribution(args);
      const fv = projectedValue({ current: args.current, contribution: pmt, remainingYears: t, rate: 0.09, freq });
      assert.ok(fv >= args.target, `${freq} ${t}: ${fv}`);
      assert.ok(fv - args.target < pmt, `${freq} ${t}: overshoot`);
    }
  }
});

test('current value already enough → no contribution needed', () => {
  assert.equal(requiredContribution({ target: RM(1000), current: RM(900), remainingYears: 5, rate: 0.08 }), 0);
});

test('math helpers', () => {
  near(periodRate(0.1, 12), 0.007974, 1e-6);
  assert.equal(annuityDueFactor(0, 5), 5);
  near(annuityDueFactor(0.08, 10), 15.6455, 1e-4);
  assert.equal(addYears('2028-02-29', 1), '2029-02-28');
  assert.equal(addYears('2027-03-01', 10), '2037-03-01');
});

test('xirr matches a known result', () => {
  // -1000 now, +1100 one year later → 10%
  near(xirr([{ date: '2027-01-01', amount: -1000 }, { date: '2028-01-01', amount: 1100 }]), 0.0997, 0.001);
  // two deposits
  const r = xirr([
    { date: '2027-01-01', amount: -100000 },
    { date: '2028-01-01', amount: -100000 },
    { date: '2029-01-01', amount: 231000 },
  ]);
  near(r, 0.1, 0.002);
  assert.equal(xirr([{ date: '2027-01-01', amount: -1 }]), null);
  assert.equal(xirr([{ date: '2027-01-01', amount: 5 }, { date: '2027-06-01', amount: 5 }]), null);
});

test('holding value uses the latest valuation plus later flows', () => {
  const flows = [
    { holdingId: 'h', type: 'in', amount: 100000, date: '2027-01-10', createdAt: 1 },
    { holdingId: 'h', type: 'in', amount: 50000, date: '2027-06-10', createdAt: 3 },
    { holdingId: 'h', type: 'out', amount: 20000, date: '2027-07-01', createdAt: 4 },
  ];
  const vals = [{ holdingId: 'h', value: 110000, date: '2027-05-01', createdAt: 2 }];
  const s = holdingSummary('h', flows, vals, '2027-08-01');
  assert.equal(s.invested, 150000);
  assert.equal(s.withdrawn, 20000);
  assert.equal(s.value, 140000);
  assert.equal(s.gain, 10000);
  const noVal = holdingSummary('h', flows, [], '2027-08-01');
  assert.equal(noVal.value, 130000);
});

test('a withdrawal does not inflate the return or make the principal negative', () => {
  const flows = [
    { holdingId: 'h', type: 'in', amount: RM(100_000), date: '2027-01-01', createdAt: 1 },
    { holdingId: 'h', type: 'out', amount: RM(90_000), date: '2027-06-02', createdAt: 3 },
  ];
  const vals = [{ holdingId: 'h', value: RM(200_000), date: '2027-06-01', createdAt: 2 }];
  const s = holdingSummary('h', flows, vals, '2027-07-01');
  assert.equal(s.value, RM(110_000));
  assert.equal(s.gainRatio, 1); // it doubled: +100%, not +1000%
  const sold = holdingSummary('h', [flows[0], { ...flows[1], amount: RM(120_000) }], [], '2027-07-01');
  assert.equal(sold.invested, RM(100_000));
  assert.equal(sold.gain, RM(20_000));
});

test('no market value update yet → no annual return', () => {
  const holdings = [{ id: 'a' }];
  const flows = [{ holdingId: 'a', type: 'in', amount: RM(100_000), date: '2027-03-01' }];
  const pf = portfolioSummary({ holdings, flows, valuations: [], asOf: '2028-01-01' });
  assert.equal(pf.annualReturn, null);
  const st = planState({ invest: {}, flows, valuations: [], holdings, asOf: '2027-06-01' });
  assert.equal(st.valuationAgeDays, 92); // counts from the first money in
});

test('the contribution already made this period is not counted again', () => {
  const holdings = [{ id: 'a' }];
  const before = planState({ invest: {}, flows: [], valuations: [], holdings, asOf: '2027-03-01' });
  near(before.required.low / 100, 111_853, 2);
  const flows = [{ holdingId: 'a', type: 'in', amount: RM(111_853), date: '2027-03-01' }];
  const day1 = planState({ invest: {}, flows, valuations: [], holdings, asOf: '2027-03-01' });
  near(day1.required.low / 100, 111_853, 2); // 9 contributions left, at years 1–9
  assert.equal(day1.next.date, '2028-03-01');
  assert.equal(day1.next.left, 9);
  // RM 100k a year really reaches ≈ RM 1.56M at 8% and ≈ RM 1.75M at 10%
  const manual = planState({ invest: { planned: RM(100_000) }, flows: [{ ...flows[0], amount: RM(100_000) }], valuations: [], holdings, asOf: '2027-03-01' });
  near(manual.projected.low / 100, 1_564_549, 5);
  near(manual.projected.high / 100, 1_753_117, 5);
  assert.equal(manual.status, 'tight');
  // Next year's contribution is due but not made yet → it is due now
  const late = planState({ invest: {}, flows, valuations: [], holdings, asOf: '2028-03-10' });
  assert.equal(late.next.now, true);
  assert.equal(late.next.left, 9);
});

test('no phantom contribution after the schedule or the deadline ends', () => {
  const holdings = [{ id: 'a' }];
  // Deadline passed: the forecast is just today's value
  const late = planState({ invest: {}, flows: [{ holdingId: 'a', type: 'in', amount: RM(1_000_000), date: '2016-03-01' }], valuations: [], holdings, asOf: '2026-09-01' });
  assert.equal(late.status, 'missed');
  assert.equal(late.projected.low, RM(1_000_000));
  // Fixed plan, all 10 contributions made, 9 months left: growth only → behind
  const flows = Array.from({ length: 10 }, (_, k) => ({ holdingId: 'a', type: 'in', amount: RM(100_000), date: `${2017 + k}-03-01` }));
  const st = planState({ invest: { planned: RM(100_000) }, flows, valuations: [{ holdingId: 'a', value: RM(1_600_000), date: '2026-06-01' }], holdings, asOf: '2026-06-01' });
  assert.equal(st.next, null);
  assert.ok(st.projected.high < RM(1_750_000));
  assert.equal(st.status, 'behind');
});

test('next contribution follows calendar dates', () => {
  const holdings = [{ id: 'a' }];
  const invest = { freq: 'monthly' };
  const first = [{ holdingId: 'a', type: 'in', amount: RM(10_000), date: '2027-01-01' }];
  const st = planState({ invest, flows: first, valuations: [], holdings, asOf: '2027-03-02' });
  assert.equal(st.next.now, true); // March was due yesterday, not "next: yesterday"
  const monthly = Array.from({ length: 6 }, (_, k) => ({ holdingId: 'a', type: 'in', amount: RM(10_000), date: `2027-${String(3 + k).padStart(2, '0')}-01` }));
  const st2 = planState({ invest: { ...invest, startDate: '2027-03-01' }, flows: monthly, valuations: [], holdings, asOf: '2027-08-31' });
  assert.equal(st2.next.now, false);
  assert.equal(st2.next.date, '2027-09-01');
});

test('the chart ends exactly at the projected value', () => {
  const holdings = [{ id: 'a' }];
  const flows = [{ holdingId: 'a', type: 'in', amount: RM(100_000), date: '2027-03-01' }];
  const st = planState({ invest: {}, flows, valuations: [], holdings, asOf: '2028-02-28' });
  const band = projectionSeries({ planStart: st.planStart, deadline: st.deadline, asOf: '2028-02-28', current: st.current, contribution: st.planned, rateLow: 0.08, rateHigh: 0.1, times: st.times });
  assert.equal(band[band.length - 1].low, st.projected.low);
  assert.equal(band[band.length - 1].high, st.projected.high);
});

test('near the deadline, required and projected agree', () => {
  const holdings = [{ id: 'a' }];
  const flows = [{ holdingId: 'a', type: 'in', amount: RM(1_000_000), date: '2017-03-01' }];
  const st = planState({ invest: {}, flows, valuations: [], holdings, asOf: '2027-02-27' });
  assert.ok(st.projected.low >= RM(1_750_000));
  assert.equal(st.status, 'ahead');
});

test('portfolio summary and plan state', () => {
  const holdings = [{ id: 'a' }, { id: 'b' }];
  const flows = [
    { holdingId: 'a', type: 'in', amount: RM(100_000), date: '2027-03-01' },
    { holdingId: 'b', type: 'in', amount: RM(10_000), date: '2027-03-01' },
  ];
  const valuations = [
    { holdingId: 'a', value: RM(108_000), date: '2028-03-01' },
    { holdingId: 'b', value: RM(11_000), date: '2028-03-01' },
  ];
  const pf = portfolioSummary({ holdings, flows, valuations, asOf: '2028-03-01' });
  assert.equal(pf.value, RM(119_000));
  near(pf.annualReturn, 0.0818, 0.002);

  const st = planState({ invest: {}, flows, valuations, holdings, asOf: '2028-03-01' });
  assert.equal(st.started, true);
  assert.equal(st.startDate, '2027-03-01');
  assert.equal(st.deadline, '2037-03-01');
  near(st.remainingYears, 9, 0.01);
  assert.equal(st.returnBand, 'within');
  assert.ok(st.required.low > st.required.high);
  assert.ok(['ahead', 'tight', 'behind'].includes(st.status));
});

test('plan state before investing tracks the income trigger', () => {
  const tx = [
    { type: 'income', amount: RM(14_500), date: '2027-02-01' },
    { type: 'income', amount: RM(9_000), date: '2027-01-01' },
  ];
  const st = planState({ invest: {}, flows: [], valuations: [], holdings: [], transactions: tx, asOf: '2027-03-05' });
  assert.equal(st.started, false);
  assert.equal(st.status, 'preparing');
  assert.equal(st.trigger.lastMonth, RM(14_500));
  assert.equal(st.trigger.reached, true);
  near(st.required.low / 100, 111_853, 2);
  near(st.shareOfTriggerIncome, 111_853 / 168_000, 0.001); // default plan = conservative (8%) amount
});

test('projection series spans the plan', () => {
  const pts = projectionSeries({ planStart: '2027-03-01', deadline: '2037-03-01', asOf: '2027-03-01', current: 0, contribution: RM(105_675), rateLow: 0.08, rateHigh: 0.1 });
  assert.equal(pts.length, 11);
  assert.ok(pts[10].low < RM(1_750_000) && pts[10].high > RM(1_750_000));
  // After the first contribution is made, year 1 is that money grown once — not counted twice
  const after = projectionSeries({ planStart: '2027-03-01', deadline: '2037-03-01', asOf: '2027-03-01', current: RM(100_000), contribution: RM(100_000), rateLow: 0.08, rateHigh: 0.1, times: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
  near(after[1].low / 100, 108_000, 1);
});

test('sanitizeInvest', () => {
  assert.deepEqual(sanitizeInvest({}), DEFAULT_INVEST);
  const s = sanitizeInvest({ rateLow: 0.12, rateHigh: 0.05, years: 0, freq: 'weird', target: -1 });
  assert.equal(s.rateLow, 0.05);
  assert.equal(s.rateHigh, 0.12);
  assert.equal(s.years, 10);
  assert.equal(s.freq, 'yearly');
  assert.equal(s.target, DEFAULT_INVEST.target);
});

test('next contribution date', () => {
  assert.equal(nextContributionDate({ planStart: '2027-03-01', freq: 'yearly', asOf: '2027-03-02' }), '2028-03-01');
  assert.equal(nextContributionDate({ planStart: '2027-01-31', freq: 'monthly', asOf: '2027-02-02' }), '2027-02-28');
});

test('backup encryption round trip with a recovery key, and a wrong key', async () => {
  const rk = newRecoveryKey();
  assert.match(rk, /^([A-HJ-NP-Z2-9]{4}-){6}[A-HJ-NP-Z2-9]{4}$/);
  const salt = randomBytes(16);
  const key = await deriveKey(rk, salt, 20_000);
  const env = await encryptText(key, '{"hello":"世界"}', { salt, iterations: 20_000, keyId: 'abc' });
  assert.ok(isEnvelope(env));
  assert.equal(env.v, 2);
  assert.equal(env.keyId, 'abc');
  assert.ok(!env.data.includes('hello') && !JSON.stringify(env).includes(rk));
  assert.equal(await decryptEnvelope(rk, env), '{"hello":"世界"}');
  // typed in lower case, without dashes, with spaces: still the same key
  assert.equal(await decryptEnvelope(normalizeRecoveryKey(` ${rk.replace(/-/g, ' ').toLowerCase()} `), env), '{"hello":"世界"}');
  await assert.rejects(decryptEnvelope(newRecoveryKey(), env), (e) => e.code === 'bad-secret');
});

test('recovery keys: format and validation', () => {
  const keys = new Set(Array.from({ length: 50 }, () => newRecoveryKey()));
  assert.equal(keys.size, 50);
  assert.equal(normalizeRecoveryKey('abcd-efgh'), null);
  assert.equal(normalizeRecoveryKey('ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-234O'), null); // O is not in the alphabet
  assert.equal(normalizeRecoveryKey('ABCDEFGHJKLMNPQRSTUVWXYZ2345'), 'ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345');
});
