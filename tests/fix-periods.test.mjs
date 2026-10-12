// Regression tests for the 1.4.0 pay-cycle period fixes: late income, windows on the 29th–31st, the stub
// before the first income, future-dated income, the next-payday label and the payday itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as periods from '../src/core/periods.js';
import { dailyBudget, comparePeriods } from '../src/core/analysis.js';
import { checkData } from '../src/core/health.js';
import { DEFAULT_CATEGORIES } from '../src/core/categories.js';
import { sanitizeSettings } from '../src/core/settings.js';
import { addDays, addMonths, dateInMonth, monthOf } from '../src/core/dates.js';

const { periodFor, periodByKey, prevPeriod, nextPeriod, periodsEndingWith, payStarts } = periods;
const note = (p, txs, today) => (periods.cycleNote ? periods.cycleNote(p, txs, today) : '');

let n = 0;
const tx = (date, amount, categoryId = 'food', extra = {}) => ({
  id: `f${++n}`, type: 'expense', amount, categoryId, date, note: '', business: false, createdAt: n, updatedAt: n, ...extra,
});
const inc = (date, amount, categoryId = 'salary') => tx(date, amount, categoryId, { type: 'income' });
const RM = (x) => Math.round(x * 100);
const cycleSettings = (from, to, extra = {}) => sanitizeSettings({
  expectedIncome: RM(4000), savingsTarget: RM(1000), startDate: '2026-08-01', payCycle: { enabled: true, from, to }, ...extra,
});
const days = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const isPay = (t) => t.type === 'income' && periods.CYCLE_INCOME_CATEGORIES.includes(t.categoryId);

test('a salary one day after the window starts the new cycle on that day (Today and history agree)', () => {
  const settings = cycleSettings(15, 20);
  const txs = [inc('2026-09-16', RM(4000)), tx('2026-09-20', RM(1500)), tx('2026-10-10', RM(1200)),
    inc('2026-10-21', RM(4000)), tx('2026-10-24', RM(200)), tx('2026-10-30', RM(200))];
  // Before it arrives: the old cycle, as before
  assert.deepEqual([periodFor('2026-10-19', { txs, settings, today: '2026-10-19' }).start, periodFor('2026-10-19', { txs, settings, today: '2026-10-19' }).end], ['2026-09-16', '2026-10-19']);
  for (const today of days('2026-10-21', '2026-11-19')) {
    const b = dailyBudget({ txs, settings, today });
    assert.deepEqual([b.period.start, b.period.end, b.period.overdue], ['2026-10-21', '2026-11-19', false], today);
    assert.equal(b.budget, RM(3000), today);
    assert.equal(b.incomeMonth, RM(4000), today);   // one salary, not two
    assert.notEqual(b.status, 'overMonth', today);
    assert.doesNotMatch(note(b.period, txs, today), /比平常晚|还没记录/, today);
  }
  // History, seen later: the old cycle ends the day before the late salary
  const ctx = { txs: [...txs, inc('2026-11-16', RM(4000))], settings, today: '2026-12-01' };
  const oct = periodFor('2026-10-25', ctx);
  assert.deepEqual([oct.start, oct.end, oct.estimated], ['2026-10-21', '2026-11-15', false]);
  assert.deepEqual([prevPeriod(oct, ctx).start, prevPeriod(oct, ctx).end], ['2026-09-16', '2026-10-20']);
  assert.deepEqual(periodFor(oct.start, ctx), oct);
  assert.deepEqual(periodByKey(oct.key, ctx), oct);
});

test('a salary 3 days late ends the stretched cycle instead of waiting for the 14-day cut-off', () => {
  const settings = cycleSettings(15, 20, { expectedIncome: RM(5000) });
  const txs = [inc('2026-08-15', RM(5000)), inc('2026-09-15', RM(5000)), inc('2026-10-23', RM(5000))];
  for (const day of days('2026-08-15', '2026-11-02')) txs.push(tx(day, RM(100)));
  for (const today of ['2026-10-23', '2026-10-28', '2026-11-02', '2026-11-03']) {
    const b = dailyBudget({ txs, settings, today });
    assert.equal(b.period.start, '2026-10-23', today);
    assert.equal(b.period.overdue, false, today);
    assert.equal(b.period.estimated, false, today);
    assert.ok(b.allowanceToday > 0 && b.leftMonth > 0, today);
  }
  // Still late (no income yet) on the 22nd: the cycle is stretched, as designed
  assert.equal(periodFor('2026-10-22', { txs: txs.filter((t) => t.date < '2026-10-23' || t.type !== 'income'), settings, today: '2026-10-22' }).overdue, true);
});

test('income later than the 14-day cut-off does not start a cycle, but the note no longer says none was recorded', () => {
  const settings = cycleSettings(15, 20);
  const txs = [inc('2026-09-15', RM(4000)), inc('2026-11-03', RM(4000))]; // 14 days after the 20th: missing, not late
  const today = '2026-11-05';
  const p = periodFor(today, { txs, settings, today });
  assert.deepEqual([p.start, p.estimated], ['2026-10-15', true]);
  assert.doesNotMatch(note(p, txs, today), /还没记录本期收入/);
  assert.match(note(p, txs, today), /按窗口估计/);
  // with no income in it at all, it still says so
  const none = [inc('2026-09-15', RM(4000))];
  assert.match(note(periodFor(today, { txs: none, settings, today }), none, today), /还没记录本期收入/);
});

test('late income after a window at the end of the month belongs to that month, not the next', () => {
  const settings = cycleSettings(25, 30);
  const txs = [inc('2026-08-26', RM(4000)), inc('2026-10-03', RM(4000), 'bizincome')]; // September's, 3 days late
  const ctx = { txs, settings, today: '2026-10-05' };
  const p = periodFor('2026-10-05', ctx);
  assert.deepEqual([p.start, p.end, p.open, p.overdue], ['2026-10-03', '2026-10-29', true, false]);
  const before = prevPeriod(p, ctx);
  assert.deepEqual([before.start, before.end, before.estimated], ['2026-08-26', '2026-10-02', false]); // no guessed 25 Sep cut
  const ctx2 = { txs: [...txs, inc('2026-10-27', RM(4000))], settings, today: '2026-11-01' };
  assert.deepEqual([periodFor('2026-10-10', ctx2).start, periodFor('2026-10-10', ctx2).end], ['2026-10-03', '2026-10-26']);
});

test('an income inside the window keeps the start; later ones in the month do not split the cycle', () => {
  const settings = cycleSettings(15, 20);
  const txs = [inc('2026-09-16', RM(4000)), inc('2026-10-16', RM(4000)), inc('2026-10-25', RM(900), 'bizincome')];
  assert.deepEqual(payStarts(txs, { from: 15, to: 20 }), ['2026-09-16', '2026-10-16']);
  assert.equal(periodFor('2026-10-28', { txs, settings, today: '2026-10-28' }).start, '2026-10-16');
});

test('a window starting on the 29th–31st: every day lies in its own period, and keys and › work', () => {
  for (const [from, to] of [[29, 31], [30, 31], [31, 31]]) {
    const settings = cycleSettings(from, to);
    for (const d of days('2026-01-01', '2028-12-31')) {
      const ctx = { txs: [], settings, today: d };
      const p = periodFor(d, ctx);
      assert.ok(p.start <= d && d <= p.end, `${from}-${to}: ${d} outside ${p.start}–${p.end}`);
      assert.deepEqual(periodByKey(p.key, ctx), p, `${from}-${to}: key ${p.key}`);
      assert.equal(nextPeriod(p, ctx).start, addDays(p.end, 1), `${from}-${to}: › from ${p.key}`);
    }
  }
  const settings = cycleSettings(29, 31);
  const b = dailyBudget({ txs: [tx('2027-02-28', RM(15))], settings, today: '2027-02-28' });
  assert.deepEqual([b.period.start, b.period.end], ['2027-02-28', '2027-03-28']);
  assert.ok(b.daysLeft >= 1 && Number.isFinite(b.allowanceToday));
  assert.equal(b.spentToday, RM(15));
  // with a first salary on 30 May, the February period behind its key is the same one
  const s30 = cycleSettings(30, 31);
  const ctx = { txs: [inc('2026-05-30', RM(4000))], settings: s30, today: '2026-06-10' };
  assert.deepEqual([periodByKey('2026-02-28', ctx).start, periodByKey('2026-02-28', ctx).end], ['2026-02-28', '2026-03-29']);
  assert.equal(nextPeriod(periodByKey('2026-01-30', ctx), ctx).start, '2026-02-28');
});

test('a first salary later in the window does not leave a stub period before it', () => {
  const settings = cycleSettings(15, 20);
  const txs = [tx('2026-08-20', RM(100), 'groceries'), tx('2026-09-15', RM(120), 'groceries'),
    inc('2026-09-16', RM(4000)), tx('2026-09-20', RM(140), 'groceries')];
  const ctx = { txs, settings, today: '2026-09-25' };
  const cur = periodFor('2026-09-25', ctx);
  const prev = prevPeriod(cur, ctx);
  assert.deepEqual([prev.start, prev.end], ['2026-08-15', '2026-09-15']);
  assert.deepEqual(periodFor('2026-09-15', ctx), prev);
  assert.ok(periodsEndingWith(cur, 4, ctx).every((q) => q.days >= 28));
  const cmp = comparePeriods(txs, cur, prev, DEFAULT_CATEGORIES, '2026-08-01', '2026-09-25');
  assert.equal(cmp.sameDays, 10);
  assert.equal(cmp.previous.expense, RM(100)); // 15–24 Aug, not one day blown up ×10
  assert.equal(cmp.delta, RM(40));
});

test('a future-dated salary does not re-cut the running cycle, and the data check says what really happens', () => {
  const settings = cycleSettings(15, 20);
  const txs = [inc('2026-09-15', RM(4000)), inc('2026-12-16', RM(4000))]; // typo for 16 Sep
  const b = dailyBudget({ txs, settings, today: '2026-10-12' });
  assert.deepEqual([b.period.start, b.period.end, b.period.open, b.daysLeft], ['2026-09-15', '2026-10-19', true, 8]);
  assert.deepEqual(payStarts(txs, { from: 15, to: 20 }, '2026-10-12'), ['2026-09-15']);
  // A calendar-month user with RM 800 dated later this month: it counts now, and the data check says so
  const plain = sanitizeSettings({ expectedIncome: RM(5000), savingsTarget: RM(1000) });
  const month = [tx('2026-10-05', RM(100)), tx('2026-10-25', RM(800), 'shopping')];
  assert.equal(dailyBudget({ txs: month, settings: plain, today: '2026-10-12' }).spentMonth, RM(900));
  const future = (s, list) => checkData({ transactions: list, categories: DEFAULT_CATEGORIES, settings: s, today: '2026-10-12' }).find((i) => i.kind === 'future');
  assert.match(future(plain, month).body, /本月内的，现在就已算进「今天」/);
  assert.doesNotMatch(future(plain, month).body, /不会出现在「今天」/);
  assert.match(future(settings, txs).body, /本期内的，现在就已算进「今天」.*才会开始新的一期/);
});

test('every cycle names the day the next one starts (not its own last day)', () => {
  const settings = cycleSettings(15, 20);
  const early = periodFor('2026-09-10', { txs: [], settings, today: '2026-09-10' });
  assert.deepEqual([early.start, early.end, early.nextPay], ['2026-08-15', '2026-09-14', '2026-09-15']);
  assert.match(note(early, [], '2026-09-10'), /下次收入按9月15日估计/);
  assert.match(note(periodFor('2026-10-16', { txs: [], settings, today: '2026-10-16' }), [], '2026-10-16'), /下次收入按11月15日估计/);
  const txs = [inc('2026-09-15', RM(4000)), inc('2026-10-17', RM(4000))];
  assert.equal(periodFor('2026-09-24', { txs, settings, today: '2026-10-20' }).nextPay, '2026-10-17');
});

test('on the window\'s last day the income is due, not late', () => {
  const settings = cycleSettings(15, 20);
  const txs = [inc('2026-08-20', RM(4000)), inc('2026-09-20', RM(4000)), tx('2026-09-25', RM(2500))];
  const at = (today) => dailyBudget({ txs, settings, today });
  const eve = at('2026-10-19');
  assert.deepEqual([eve.period.overdue, eve.period.dueToday, eve.daysLeft], [false, false, 1]);
  assert.match(note(eve.period, txs, '2026-10-19'), /下次收入按明天估计/);
  const payday = at('2026-10-20');
  assert.deepEqual([payday.period.start, payday.period.overdue, payday.period.dueToday], ['2026-09-20', false, true]);
  assert.ok(payday.daysLeft >= 1 && Number.isFinite(payday.allowanceToday));
  assert.doesNotMatch(note(payday.period, txs, '2026-10-20'), /比平常晚/);
  assert.match(note(payday.period, txs, '2026-10-20'), /今天是预计收入日/);
  const after = at('2026-10-21');
  assert.deepEqual([after.period.overdue, after.period.dueToday], [true, false]);
  assert.match(note(after.period, txs, '2026-10-21'), /收入比平常晚/);
  // a single fixed payday behaves the same
  const fixed = cycleSettings(25, 25);
  const ft = [inc('2026-09-25', RM(4000))];
  assert.equal(periodFor('2026-10-25', { txs: ft, settings: fixed, today: '2026-10-25' }).overdue, false);
  assert.equal(periodFor('2026-10-26', { txs: ft, settings: fixed, today: '2026-10-26' }).overdue, true);
});

test('seeded sweep over every window (1–31), late and early income and no income: periods tile the calendar', () => {
  let seed = 20261012;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pad = (x) => String(x).padStart(2, '0');
  let checked = 0;
  for (let iter = 0; iter < 90; iter += 1) {
    const from = ri(1, 31);
    const to = ri(from, Math.min(31, from + 10));
    const settings = cycleSettings(from, to);
    const txs = [];
    if (iter % 6) {
      for (let m = 0; m < 9; m += 1) {
        const r = rnd();
        if (r < 0.2) continue; // forgotten month
        const ym = `2026-${pad(2 + m)}`;
        const base = `${ym}-${pad(Math.min(from, 28))}`;
        // inside the window, late (up to 3 weeks after it), or anywhere
        const date = r < 0.6 ? addDays(base, ri(0, to - from)) : r < 0.85 ? addDays(base, to - from + ri(1, 21)) : `${ym}-${pad(ri(1, 28))}`;
        txs.push(inc(date, RM(1000), rnd() < 0.5 ? 'salary' : 'bizincome'));
        if (rnd() < 0.3) txs.push(inc(addDays(date, ri(1, 12)), RM(300), 'bizincome')); // a second one
      }
    }
    for (let t = 0; t < 3; t += 1) {
      const today = addDays('2026-02-01', ri(0, 320));
      const ctx = { txs, settings, today };
      for (let d = '2026-01-20'; d <= today; d = addDays(d, 3)) {
        const p = periodFor(d, ctx);
        checked += 1;
        assert.ok(p.start <= d && d <= p.end, `${d} outside ${p.start}–${p.end} (${from}-${to}, today ${today})`);
        assert.deepEqual(periodFor(p.start, ctx), p, `not reproducible from its start (${from}-${to}, today ${today})`);
        assert.deepEqual(periodByKey(p.key, ctx), p);
        assert.equal(prevPeriod(p, ctx).end, addDays(p.start, -1), 'previous period does not end the day before');
        if (!p.open) assert.equal(nextPeriod(p, ctx).start, addDays(p.end, 1), 'next period does not start the day after');
        assert.equal(p.nextPay, addDays(p.end, 1));
      }
      const cur = periodFor(today, ctx);
      const paid = txs.some((x) => isPay(x) && x.date >= cur.start && x.date <= cur.end);
      if (paid) assert.doesNotMatch(note(cur, txs, today), /还没记录本期收入/, `${from}-${to}, today ${today}`);
      if (cur.overdue) {
        // still waiting: nothing came inside the awaited window or after it (early income is not a start)
        const m = cur.start >= dateInMonth(monthOf(cur.start), from) ? monthOf(cur.start) : addMonths(monthOf(cur.start), -1);
        const awaited = dateInMonth(addMonths(m, 1), from);
        assert.ok(!txs.some((x) => isPay(x) && x.date >= awaited && x.date <= today), `income since ${awaited} ignored (${from}-${to}, today ${today})`);
      }
    }
  }
  assert.ok(checked > 3000, String(checked));
});
