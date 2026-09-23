// Fixed monthly items (rent, phone plan, subscriptions, salary…) that are logged automatically.
import { addMonths, dateInMonth, monthOf, monthRange } from './dates.js';

const MAX_BACKFILL_MONTHS = 12;

/**
 * Create transactions for every recurring item that has come due up to `today`.
 * Idempotent: each item remembers the last month it generated (`lastMonth`),
 * so deleting a generated entry never brings it back.
 */
export function generateDue(recurring, today, newId, now = Date.now()) {
  const cur = monthOf(today);
  const created = [];
  const updated = [];
  for (const r of recurring) {
    if (!r.active) continue;
    let from = r.lastMonth ? addMonths(r.lastMonth, 1) : (r.startMonth || cur);
    const floor = addMonths(cur, -MAX_BACKFILL_MONTHS + 1);
    if (from < floor) from = floor;
    if (from > cur) continue;
    let last = r.lastMonth || null;
    for (const ym of monthRange(from, cur)) {
      const date = dateInMonth(ym, r.day);
      if (date > today) break;
      created.push({
        id: newId(),
        type: r.type,
        amount: r.amount,
        categoryId: r.categoryId,
        note: r.note || '',
        date,
        business: !!r.business,
        recurringId: r.id,
        createdAt: now,
        updatedAt: now,
      });
      last = ym;
    }
    if (last !== (r.lastMonth || null)) updated.push({ ...r, lastMonth: last });
  }
  return { created, updated };
}

/**
 * Initial state for a new recurring item.
 * includeThisMonth: log this month too (now if the day already passed, otherwise on the day). Turn it off when
 * this month's payment is already recorded by hand, so it is not counted twice.
 */
export function newRecurring({ id, type, amount, categoryId, note, day, business, includeThisMonth = true }, today) {
  const cur = monthOf(today);
  return {
    id, type, amount, categoryId, note: note || '', day, business: !!business, active: true,
    startMonth: cur,
    lastMonth: includeThisMonth ? null : cur,
  };
}

/** A transaction entered by hand this month that looks like the same fixed item (same kind, category, ~amount). */
export function findManualMatch(transactions, { type, categoryId, amount }, today) {
  if (!amount) return null;
  const cur = monthOf(today);
  const tolerance = Math.max(100, Math.round(amount * 0.05));
  return transactions.find((t) => !t.recurringId && t.type === type && t.categoryId === categoryId
    && monthOf(t.date) === cur && Math.abs(t.amount - amount) <= tolerance) || null;
}

export function nextDueDate(r, today) {
  const cur = monthOf(today);
  const thisMonth = dateInMonth(cur, r.day);
  const doneThisMonth = r.lastMonth && r.lastMonth >= cur;
  if (!doneThisMonth && thisMonth >= today) return thisMonth;
  return dateInMonth(addMonths(cur, 1), r.day);
}
