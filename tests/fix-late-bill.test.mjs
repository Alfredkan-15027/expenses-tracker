// Last month's bill paid late (1.4.6): typed in by hand in a month the fixed item already charged, while the month
// before went unpaid — it settles that month, so it is a fixed payment, not today's spending. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';

const { paidByHand } = await import('../src/core/recurring.js');
const { cashOnHand, dailyBudget, spendingModel } = await import('../src/core/analysis.js');
const { sanitizeSettings } = await import('../src/core/settings.js');

let n = 0;
const tx = (date, amount, categoryId = 'food', extra = {}) => ({
  id: `l${++n}`, type: 'expense', amount, categoryId, date, note: '', business: false, createdAt: n, updatedAt: n, ...extra,
});
const water = { id: 'water', type: 'expense', amount: 1755, categoryId: 'utilities', note: '水费', day: 15, active: true, startMonth: '2026-09', lastMonth: '2026-11' };

test('a bill paid late settles the unpaid month before it, and is not today\'s spending', () => {
  const txs = [
    tx('2026-09-15', 1755, 'utilities', { recurringId: 'water', note: '水费' }),
    // October's charge was deleted (not paid then); November's came in as usual
    tx('2026-11-15', 1521, 'utilities', { recurringId: 'water', note: '水费' }),
    tx('2026-11-19', 1755, 'utilities', { note: '水费' }), // October's water, paid today
    tx('2026-11-19', 1100), // lunch
  ];
  const late = paidByHand(txs, [water]);
  assert.equal(late.get('water|2026-10')?.date, '2026-11-19');
  assert.equal(late.has('water|2026-11'), false);

  const settings = sanitizeSettings({ startDate: '2026-09-01', expectedIncome: 500000, currentSavings: 300000, currentSavingsAt: '2026-11-18', currentSavingsTs: 1 });
  const cash = cashOnHand({ txs, settings, today: '2026-11-19', recurring: [water] });
  assert.equal(cash.todayOut, 1100);
  assert.equal(cash.balance, 300000 - 1755 - 1100); // the money did leave
  const b = dailyBudget({ txs, settings, recurring: [water], today: '2026-11-19', cash });
  assert.equal(b.fixedToday, 1755);
  assert.equal(b.spentTodayFree, 1100);
  // … and it is no day-to-day pace either
  const m = spendingModel({ txs, recurring: [water], today: '2026-11-19', since: '2026-09-01' });
  assert.equal(m.variable, 1100);
});

test('a second water bill in a month whose month before is paid stays ordinary spending', () => {
  const txs = [
    tx('2026-09-15', 1755, 'utilities', { recurringId: 'water', note: '水费' }),
    tx('2026-10-15', 1755, 'utilities', { recurringId: 'water', note: '水费' }),
    tx('2026-11-15', 1755, 'utilities', { recurringId: 'water', note: '水费' }),
    tx('2026-11-19', 1755, 'utilities', { note: '水费' }),
  ];
  assert.equal(paidByHand(txs, [water]).size, 0);
  // Only the month just before counts: an unpaid month two back is too unsure a guess
  const twoBack = txs.filter((t) => t.date !== '2026-09-15');
  assert.equal(paidByHand(twoBack, [water]).size, 0);
});
