// Fixed monthly items (rent, phone plan, subscriptions, salary…) that are logged automatically.
import { addMonths, dateInMonth, dayOf, monthOf, monthRange } from './dates.js';

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

/** The brand-like first word of a note ("Claude Pro 订阅" → "claude"), or '' when it has no Latin word. */
export const firstWord = (note) => (String(note || '').toLowerCase().match(/[a-z][a-z0-9]{2,}/) || [''])[0];

/** Within max(RM 1, 5%) of a fixed item's amount. */
export const nearAmount = (a, amount) => Math.abs(a - amount) <= Math.max(100, Math.round(amount * 0.05));

/**
 * Could entry `t` be this fixed item's charge: same kind, category and about the amount, and not a bill whose name
 * says otherwise ("Maxis 手机" is not "Unifi 宽带" at a similar price). A note with no Latin word ("九月房租") can't
 * tell, so it still matches.
 */
export function sameBill(t, { type, categoryId, amount, note }) {
  if (t.type !== type || t.categoryId !== categoryId || !nearAmount(t.amount, amount)) return false;
  const a = firstWord(t.note);
  const b = firstWord(note);
  return !a || !b || a === b;
}

/**
 * An entry this month that looks like the same fixed item: typed in by hand, or (when `recurring` is passed) logged
 * by a fixed item that has since been deleted — its entries stay, so adding the item back must not log them again.
 */
export function findManualMatch(transactions, item, today, recurring = null) {
  if (!item.amount) return null;
  const cur = monthOf(today);
  const live = recurring ? new Set(recurring.map((r) => r.id)) : null;
  return transactions.find((t) => (!t.recurringId || (live && !live.has(t.recurringId)))
    && monthOf(t.date) === cur && sameBill(t, item)) || null;
}

/**
 * Switch a paused item back on. It resumes from now: charges that fell due while it was paused are not logged
 * afterwards (without this the app would "catch up" every paused month, up to a year of them).
 */
export function resumeRecurring(r, today) {
  const cur = monthOf(today);
  const floor = dateInMonth(cur, r.day) <= today ? cur : addMonths(cur, -1);
  return { ...r, active: true, lastMonth: !r.lastMonth || r.lastMonth < floor ? floor : r.lastMonth };
}

/**
 * A hand-typed entry shows what the fixed item costs now (plan upgrade, price rise): take its amount, name and
 * day, and don't log that entry's month again. A date after `today` (likely a typo) can't mark a month that hasn't
 * come. `daySince`: the day was set from this entry — the data check compares it with charges from then on only.
 */
export function repriceRecurring(r, { amount, note, date }, today = date) {
  const since = date < today ? date : today;
  const m = monthOf(since);
  return {
    ...r, amount, note: note || r.note, day: dayOf(date), daySince: since,
    lastMonth: !r.lastMonth || r.lastMonth < m ? m : r.lastMonth,
  };
}

export function nextDueDate(r, today) {
  const cur = monthOf(today);
  const thisMonth = dateInMonth(cur, r.day);
  const doneThisMonth = r.lastMonth && r.lastMonth >= cur;
  if (!doneThisMonth && thisMonth >= today) return thisMonth;
  // Marked done past this month: the next charge logged is the month after that one.
  const next = r.lastMonth && r.lastMonth > cur ? r.lastMonth : cur;
  return dateInMonth(addMonths(next, 1), r.day);
}
