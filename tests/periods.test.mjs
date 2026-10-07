import test from 'node:test';
import assert from 'node:assert/strict';
import { periodFor, periodByKey, periodsEndingWith, prevPeriod, nextPeriod, payStarts } from '../src/core/periods.js';
import { dailyBudget, evaluatePeriod, comparePeriods, buildInsights, trendPeriods } from '../src/core/analysis.js';
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

test('the running cycle is judged by a month of fixed items + recent pace, not by extrapolating lumps', () => {
  const rec = [
    { id: 'h', type: 'expense', amount: RM(800), categoryId: 'housing', day: 19, active: true },
    { id: 'u', type: 'expense', amount: RM(50), categoryId: 'utilities', day: 15, active: true },
  ];
  const txs = [
    tx('2026-09-01', RM(40)), tx('2026-09-08', RM(40)),                 // pace before payday counts too
    inc('2026-09-15', RM(5000)), tx('2026-09-15', RM(50), 'utilities', { recurringId: 'u' }),
    tx('2026-09-19', RM(800), 'housing', { recurringId: 'h' }), tx('2026-09-19', RM(750), 'business', { business: true }),
    tx('2026-09-20', RM(40)),
  ];
  const p = periodFor('2026-09-24', { txs, settings });
  const ev = evaluatePeriod({ txs, period: p, categories: DEFAULT_CATEGORIES, profile: {}, today: '2026-09-24', recurring: rec, startDate: '2026-09-01' });
  // RM 120 of day-to-day spending in 24 days → RM 150 per 30 days; rent and utilities once; business left out
  assert.equal(ev.perMonth, RM(800) + RM(50) + RM(150));
  assert.equal(ev.normalized, false);
});

test('a running cycle is compared with the same first days of the previous one; a half-tracked one is not compared', () => {
  const txs = [inc('2026-08-15', RM(5000)), tx('2026-08-16', RM(900), 'housing'), tx('2026-09-10', RM(600)),
    inc('2026-09-15', RM(5000)), tx('2026-09-16', RM(900), 'housing'), tx('2026-09-20', RM(100))];
  const ctx = { txs, settings };
  const cur = periodFor('2026-09-24', ctx);
  const cmp = comparePeriods(txs, cur, prevPeriod(cur, ctx), DEFAULT_CATEGORIES, '2026-08-01', '2026-09-24');
  assert.equal(cmp.sameDays, 10);
  assert.equal(cmp.previous.expense, RM(900));   // 15–24 Aug only, not the RM 600 on 10 Sep
  assert.equal(cmp.delta, RM(100));
  assert.equal(cmp.normalized, false);
  // Tracking began on 1 Sep, inside the previous cycle: not comparable
  assert.equal(comparePeriods(txs, cur, prevPeriod(cur, ctx), DEFAULT_CATEGORIES, '2026-09-01', '2026-09-24').comparable, false);
});

test('trend marks a cycle that began before tracking as partial', () => {
  const txs = [tx('2026-09-02', RM(50)), inc('2026-09-15', RM(5000)), tx('2026-09-16', RM(20))];
  const ctx = { txs, settings };
  const cur = periodFor('2026-09-24', ctx);
  const rows = trendPeriods(txs, [prevPeriod(cur, ctx), cur], '2026-09-01');
  assert.deepEqual(rows.map((r) => [r.tick, r.partial]), [['8/15', true], ['9/15', false]]);
});

test('insights speak of 本期 and compare with the previous cycle', () => {
  const txs = [inc('2026-08-15', RM(5000)), tx('2026-08-20', RM(2000)), inc('2026-09-16', RM(5000)), tx('2026-09-20', RM(1500))];
  const cur = periodFor('2026-09-24', { txs, settings });
  const cmp = comparePeriods(txs, cur, prevPeriod(cur, { txs, settings }), DEFAULT_CATEGORIES, '2026-08-01');
  assert.equal(cmp.comparable, true);
  assert.equal(cmp.normalized, true); // finished periods: per 30 days
  const ins = buildInsights({ txs, period: cur, categories: DEFAULT_CATEGORIES, profile: {}, settings, today: '2026-09-24' });
  assert.ok(ins.some((i) => i.title === '与上一期相比' && /前 9 天/.test(i.body)));
  assert.ok(ins.some((i) => /预计结余/.test(i.body)));
  assert.ok(!ins.some((i) => /本月/.test(i.title + i.body)));
});

test('calendar months stay the default', () => {
  const plain = sanitizeSettings({});
  assert.equal(plain.payCycle.enabled, false);
  assert.equal(periodFor('2026-09-24', { txs: [], settings: plain }).key, '2026-09');
  assert.deepEqual(sanitizeSettings({ payCycle: { enabled: true, from: 20, to: 10 } }).payCycle, { enabled: true, from: 20, to: 20 });
});

test('a month with no income recorded gets its own estimated cycle instead of being swallowed', () => {
  const txs = [inc('2026-07-16', RM(5000)), inc('2026-10-17', RM(5000))]; // August and September forgotten
  const ctx = { txs, settings, today: '2026-10-20' };
  const aug = periodFor('2026-08-20', ctx);
  assert.deepEqual([aug.start, aug.end, aug.estimated], ['2026-08-15', '2026-09-14', true]);
  assert.deepEqual([periodFor('2026-07-20', ctx).start, periodFor('2026-07-20', ctx).end, periodFor('2026-07-20', ctx).estimated], ['2026-07-16', '2026-08-14', false]);
  assert.equal(periodFor('2026-09-20', ctx).end, '2026-10-16');
  assert.ok(periodsEndingWith(periodFor('2026-10-20', ctx), 5, ctx).every((q) => q.days <= 35));
});

test('before the first recorded income, periods are guessed one calendar month at a time', () => {
  const txs = [inc('2026-09-15', RM(5000))];
  const ctx = { txs, settings, today: '2026-09-24' };
  assert.deepEqual([periodFor('2026-07-20', ctx).start, periodFor('2026-07-20', ctx).end], ['2026-07-15', '2026-08-14']);
  assert.deepEqual([periodFor('2026-08-20', ctx).start, periodFor('2026-08-20', ctx).end], ['2026-08-15', '2026-09-14']);
  // and the period behind a stored key is the same one (the Analysis page navigates by key)
  const p = periodFor('2026-07-20', ctx);
  assert.deepEqual(periodByKey(p.key, ctx), p);
});

test('income missing for two weeks past its window is taken as missing, not late — consistently', () => {
  const txs = [inc('2026-09-15', RM(5000))]; // expected next on the 20th; nothing since
  const late = (today) => periodFor(today, { txs, settings, today });
  assert.equal(late('2026-10-25').overdue, true);                       // 5 days late: stretch the cycle
  assert.equal(late('2026-10-25').start, '2026-09-15');
  const stale = late('2026-11-05');                                     // 17 days late: a new, guessed cycle
  assert.deepEqual([stale.start, stale.estimated, stale.open], ['2026-10-15', true, true]);
  // it is the same period whichever way it is reached, and the one before it ends where it starts
  const ctx = { txs, settings, today: '2026-11-05' };
  assert.deepEqual(periodFor(stale.start, ctx), stale);
  assert.deepEqual(periodByKey(stale.key, ctx), stale);
  const before = prevPeriod(stale, ctx);
  assert.deepEqual([before.start, before.end], ['2026-09-15', '2026-10-14']);
  // while the running cycle is overdue it is also reachable from its own start
  const ctx2 = { txs, settings, today: '2026-10-25' };
  assert.deepEqual(periodFor('2026-09-15', ctx2), late('2026-10-25'));
});

test('every period is found again from its start, sits right after the one before, and nothing overlaps (seeded sweep)', () => {
  let seed = 20261007;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const day = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  let checked = 0;
  for (let iter = 0; iter < 80; iter += 1) {
    const from = ri(1, 25);
    const to = ri(from, Math.min(31, from + 10));
    const cfg = sanitizeSettings({ payCycle: { enabled: true, from, to } });
    const txs = [];
    for (let m = 0; m < 8; m += 1) {
      if (rnd() < 0.25) continue; // forgotten month
      const ym = `2026-${String(3 + m).padStart(2, '0')}`;
      const d = rnd() < 0.8 ? ri(from, to) : ri(1, 28);
      txs.push(inc(`${ym}-${String(Math.min(d, 28)).padStart(2, '0')}`, RM(1000), rnd() < 0.5 ? 'salary' : 'bizincome'));
    }
    for (let t = 0; t < 3; t += 1) {
      const today = day('2026-03-01', ri(0, 290));
      const ctx = { txs, settings: cfg, today };
      for (let d = '2026-02-25'; d <= today; d = day(d, 5)) {
        const p = periodFor(d, ctx);
        checked += 1;
        assert.ok(p.start <= d && d <= p.end, `${d} outside ${p.start}–${p.end}`);
        const again = periodFor(p.start, ctx);
        assert.deepEqual([again.start, again.end], [p.start, p.end], `not reproducible from its start (${from}-${to}, today ${today})`);
        assert.equal(prevPeriod(p, ctx).end, day(p.start, -1), 'previous period does not end the day before');
        if (!p.open) assert.equal(nextPeriod(p, ctx).start, day(p.end, 1), 'next period does not start the day after');
      }
    }
  }
  assert.ok(checked > 3000);
});
