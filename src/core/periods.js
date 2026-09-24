// Budget periods: calendar months, or pay cycles that start the day income arrives.
// A pay cycle starts at the first 薪水 / 创业收入 entry dated inside the pay window (e.g. the 15th–20th) of a
// month, and runs until the day before the next one. While the next income hasn't arrived, the cycle is
// assumed to end the day before the LAST day of the next window (conservative: money must last until then).
import { addDays, addMonths, dateInMonth, dayOf, daysInMonth, monthLabel, monthOf, parseISO } from './dates.js';

export const CYCLE_INCOME_CATEGORIES = ['salary', 'bizincome'];
const DAY_MS = 86_400_000;
const STALE_DAYS = 70;   // no income for this long: stop stretching the old cycle
const LATE_EXTENSION = 6; // income later than the window: assume one more week

export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / DAY_MS);

/** Pay window from settings, or null for calendar months. */
export function payCycle(settings) {
  const c = settings?.payCycle;
  if (!c?.enabled) return null;
  return { from: c.from, to: c.to };
}

const md = (iso) => `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;

export function monthPeriod(ym) {
  const days = daysInMonth(ym);
  return { kind: 'month', key: ym, start: `${ym}-01`, end: dateInMonth(ym, days), days, label: monthLabel(ym), short: monthLabel(ym, false) };
}

function cyclePeriod(start, end, extra = {}) {
  return {
    kind: 'cycle', key: start, start, end, days: daysBetween(start, end) + 1,
    label: `${md(start)} – ${md(end)}`, short: md(start), ...extra,
  };
}

/** First qualifying income inside the window, per calendar month → cycle start dates (sorted). */
export function payStarts(txs, cfg) {
  const first = new Map();
  for (const t of txs) {
    if (t.type !== 'income' || !CYCLE_INCOME_CATEGORIES.includes(t.categoryId)) continue;
    const d = dayOf(t.date);
    const lo = Math.min(cfg.from, daysInMonth(monthOf(t.date)));
    const hi = Math.min(cfg.to, daysInMonth(monthOf(t.date)));
    if (d < lo || d > hi) continue;
    const m = monthOf(t.date);
    if (!first.has(m) || t.date < first.get(m)) first.set(m, t.date);
  }
  return [...first.values()].sort();
}

/** The period containing `date`. ctx = { txs, settings }. */
export function periodFor(date, ctx) {
  const cfg = payCycle(ctx.settings);
  if (!cfg) return monthPeriod(monthOf(date));
  const starts = payStarts(ctx.txs, cfg);
  let start = null;
  let next = null;
  for (const s of starts) {
    if (s <= date) start = s;
    else { next = s; break; }
  }
  let estimated = false;
  if (!start || daysBetween(start, date) > STALE_DAYS) {
    // No income recorded yet for this stretch: assume it came on the first day of the window.
    const m = dayOf(date) >= cfg.from ? monthOf(date) : addMonths(monthOf(date), -1);
    const guess = dateInMonth(m, cfg.from);
    start = start && start > guess ? start : guess;
    estimated = true;
  }
  if (next) return cyclePeriod(start, addDays(next, -1), { open: false, estimated });
  // Open cycle: runs until the day before the last day of next month's window.
  let end = addDays(dateInMonth(addMonths(monthOf(start), 1), cfg.to), -1);
  let overdue = false;
  if (date > end) { end = addDays(date, LATE_EXTENSION); overdue = true; }
  return cyclePeriod(start, end, { open: true, estimated, overdue, nextPay: addDays(end, 1) });
}

/** Resolve a stored key: 'YYYY-MM' → month, 'YYYY-MM-DD' → the period containing that day. */
export function periodByKey(key, ctx) {
  return key.length === 7 ? monthPeriod(key) : periodFor(key, ctx);
}

export function prevPeriod(p, ctx) {
  if (p.kind === 'month') return monthPeriod(addMonths(p.key, -1));
  const q = periodFor(addDays(p.start, -1), ctx);
  if (q.end < p.start) return q;
  return cyclePeriod(q.start, addDays(p.start, -1), { open: false, estimated: q.estimated });
}

export function nextPeriod(p, ctx) {
  return p.kind === 'month' ? monthPeriod(addMonths(p.key, 1)) : periodFor(addDays(p.end, 1), ctx);
}

/** The n periods ending with p, oldest first. */
export function periodsEndingWith(p, n, ctx) {
  const out = [p];
  while (out.length < n) out.unshift(prevPeriod(out[0], ctx));
  return out;
}

export const inPeriod = (t, p) => t.date >= p.start && t.date <= p.end;
