// Budget periods: calendar months, or pay cycles that start the day income arrives.
// A pay cycle starts at the first 薪水 / 创业收入 entry dated inside the pay window (e.g. the 15th–20th) of a
// month, and runs until the day before the next one. While the next income hasn't arrived, the cycle is
// assumed to end the day before the LAST day of the next window (conservative: money must last until then).
import { addDays, addMonths, dateInMonth, dayOf, daysInMonth, monthLabel, monthOf, parseISO } from './dates.js';

export const CYCLE_INCOME_CATEGORIES = ['salary', 'bizincome'];
const DAY_MS = 86_400_000;
const STALE_LATE_DAYS = 14; // income this many days past its expected end: it is missing, not late
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
  return { kind: 'month', key: ym, start: `${ym}-01`, end: dateInMonth(ym, days), days, label: monthLabel(ym), short: monthLabel(ym, false), tick: monthLabel(ym, false) };
}

function cyclePeriod(start, end, extra = {}) {
  return {
    kind: 'cycle', key: start, start, end, days: daysBetween(start, end) + 1,
    label: `${md(start)} – ${md(end)}`, short: md(start), tick: `${Number(start.slice(5, 7))}/${Number(start.slice(8, 10))}`, ...extra,
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

/**
 * Cycle boundaries: every recorded start, plus a guessed start on the first day of the window
 *  - for a month between two recorded ones that has no income recorded (forgotten, or skipped), and
 *  - for the months after the last recorded start once the next income is more than STALE_LATE_DAYS overdue
 *    (it is then taken as missing rather than late).
 * Without those a single cycle would swallow the missing month(s). Depends only on the data and the real
 * `today`, never on which date is being asked about, so every period comes out the same however it is reached.
 */
function boundaries(txs, cfg, today) {
  const recorded = payStarts(txs, cfg);
  const out = [];
  recorded.forEach((s, i) => {
    out.push({ date: s, guessed: false });
    const nextRecorded = recorded[i + 1];
    if (!nextRecorded) return;
    for (let m = addMonths(monthOf(s), 1); m < monthOf(nextRecorded); m = addMonths(m, 1)) {
      out.push({ date: dateInMonth(m, cfg.from), guessed: true });
    }
  });
  const last = recorded[recorded.length - 1];
  if (last && today > addDays(expectedEnd(last, cfg), STALE_LATE_DAYS)) {
    for (let m = addMonths(monthOf(last), 1), n = 0; dateInMonth(m, cfg.from) <= today && n < 240; m = addMonths(m, 1), n += 1) {
      out.push({ date: dateInMonth(m, cfg.from), guessed: true });
    }
  }
  return out;
}

/** Where a cycle that began on `start` is expected to end: the day before the last day of next month's window. */
const expectedEnd = (start, cfg) => addDays(dateInMonth(addMonths(monthOf(start), 1), cfg.to), -1);

/** The cycle that is still running: its next income has not arrived (yet). */
function openPeriod(start, today, cfg, estimated) {
  let end = expectedEnd(start, cfg);
  let overdue = false;
  if (today > end) { end = addDays(today, LATE_EXTENSION); overdue = true; }
  return cyclePeriod(start, end, { open: true, estimated, overdue, nextPay: addDays(end, 1) });
}

/**
 * A stretch before the first recorded income: assume it came on the first day of the window. Such a period lasts
 * one calendar month (window start to window start) — or until the first recorded income.
 */
function guessedPeriod(date, cfg, nextStart = '') {
  const m = dayOf(date) >= cfg.from ? monthOf(date) : addMonths(monthOf(date), -1);
  const start = dateInMonth(m, cfg.from);
  const monthEnd = addDays(dateInMonth(addMonths(m, 1), cfg.from), -1);
  if (!nextStart) return cyclePeriod(start, monthEnd, { open: false, estimated: true });
  const beforeNext = addDays(nextStart, -1);
  return cyclePeriod(start, monthEnd < beforeNext ? monthEnd : beforeNext, { open: false, estimated: true });
}

/**
 * The period containing `date`. ctx = { txs, settings, today }; `today` (default: `date`) is what decides whether
 * the running cycle is still waiting for income or is overdue.
 */
export function periodFor(date, ctx) {
  const cfg = payCycle(ctx.settings);
  if (!cfg) return monthPeriod(monthOf(date));
  const today = ctx.today || date;
  let cur = null;
  let next = null;
  for (const b of boundaries(ctx.txs, cfg, today)) {
    if (b.date <= date) cur = b;
    else { next = b; break; }
  }
  if (!cur) return guessedPeriod(date, cfg, next?.date || '');
  if (next) return cyclePeriod(cur.date, addDays(next.date, -1), { open: false, estimated: cur.guessed });
  return openPeriod(cur.date, today, cfg, cur.guessed);
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
