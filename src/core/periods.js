// Budget periods: calendar months, or pay cycles that start the day income arrives.
// A pay cycle starts at the first 薪水 / 创业收入 entry dated inside the pay window (e.g. the 15th–20th) of a
// month — or, when none came inside it, at the first one that came late (within STALE_LATE_DAYS) — and runs until
// the day before the next one. While the next income hasn't arrived, the cycle is assumed to end the day before
// the LAST day of the next window (conservative: money must last until then).
import { addDays, addMonths, dateInMonth, dayLabel, daysInMonth, monthLabel, monthOf, parseISO } from './dates.js';

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

// Every cycle carries the day the next one starts (or is assumed to start): nextPay.
function cyclePeriod(start, end, extra = {}) {
  return {
    kind: 'cycle', key: start, start, end, days: daysBetween(start, end) + 1,
    label: `${md(start)} – ${md(end)}`, short: md(start), tick: `${Number(start.slice(5, 7))}/${Number(start.slice(8, 10))}`,
    nextPay: addDays(end, 1), ...extra,
  };
}

/**
 * The month whose cycle a date falls in: from that month's window start (clamped, e.g. 31 → 30 in Sept) to the
 * day before the next month's. Late income after a window at the end of a month lands in the month before.
 */
const cycleMonth = (date, cfg) => (date >= dateInMonth(monthOf(date), cfg.from) ? monthOf(date) : addMonths(monthOf(date), -1));

const isPayIncome = (t) => t.type === 'income' && CYCLE_INCOME_CATEGORIES.includes(t.categoryId);

/**
 * Cycle start dates (sorted): per month, the first qualifying income inside the window; for a month with none
 * there, the first one that came after the window but before it would count as missing (the same cut-off as in
 * boundaries(): expected end + STALE_LATE_DAYS). An income inside its own month's window is never taken as the
 * month before's late one. Income dated after `today` (a typo, or entered ahead) starts nothing yet.
 */
export function payStarts(txs, cfg, today = '') {
  const first = new Map();
  const late = new Map();
  for (const t of txs) {
    if (!isPayIncome(t) || (today && t.date > today)) continue;
    const ym = monthOf(t.date);
    if (t.date >= dateInMonth(ym, cfg.from) && t.date <= dateInMonth(ym, cfg.to)) {
      if (!first.has(ym) || t.date < first.get(ym)) first.set(ym, t.date);
      continue;
    }
    const m = cycleMonth(t.date, cfg);
    const windowEnd = dateInMonth(m, cfg.to);
    if (t.date <= windowEnd || t.date > addDays(windowEnd, STALE_LATE_DAYS - 1)) continue; // early, or missing
    if (!late.has(m) || t.date < late.get(m)) late.set(m, t.date);
  }
  for (const [m, d] of late) if (!first.has(m)) first.set(m, d);
  return [...first.values()].sort();
}

/**
 * Cycle boundaries: every recorded start, plus a guessed start on the first day of the window
 *  - for a month between two recorded ones that has no income recorded (forgotten, or skipped), and
 *  - for the months after the last recorded start once the next income is more than STALE_LATE_DAYS overdue
 *    (it is then taken as missing rather than late).
 * Without those a single cycle would swallow the missing month(s). Depends only on the data and the real
 * `today`, never on which date is being asked about, so every period comes out the same however it is reached.
 * `cutoff` is the real today when the caller gave one: income dated after it is left out.
 */
function boundaries(txs, cfg, today, cutoff = '') {
  const recorded = payStarts(txs, cfg, cutoff);
  const out = [];
  recorded.forEach((s, i) => {
    out.push({ date: s, guessed: false });
    const nextRecorded = recorded[i + 1];
    if (!nextRecorded) return;
    for (let m = addMonths(cycleMonth(s, cfg), 1); m < cycleMonth(nextRecorded, cfg); m = addMonths(m, 1)) {
      out.push({ date: dateInMonth(m, cfg.from), guessed: true });
    }
  });
  const last = recorded[recorded.length - 1];
  if (last && today > addDays(expectedEnd(last, cfg), STALE_LATE_DAYS)) {
    for (let m = addMonths(cycleMonth(last, cfg), 1), n = 0; dateInMonth(m, cfg.from) <= today && n < 240; m = addMonths(m, 1), n += 1) {
      out.push({ date: dateInMonth(m, cfg.from), guessed: true });
    }
  }
  return out;
}

/** Where a cycle that began on `start` is expected to end: the day before the last day of next month's window. */
export const expectedEnd = (start, cfg) => addDays(dateInMonth(addMonths(cycleMonth(start, cfg), 1), cfg.to), -1);

/**
 * The cycle that is still running: its next income has not arrived (yet). From the window's last day (the
 * assumed payday) on it is stretched so it still holds today; the income only counts as late the day after.
 */
function openPeriod(start, today, cfg, estimated) {
  const expected = expectedEnd(start, cfg);
  const payday = addDays(expected, 1);
  const end = today > expected ? addDays(today, LATE_EXTENSION) : expected;
  return cyclePeriod(start, end, { open: true, estimated, overdue: today > payday, dueToday: today === payday });
}

/**
 * A stretch before the first recorded income: assume it came on the first day of the window. Such a period lasts
 * one calendar month (window start to window start); the one before the first recorded income runs up to it, so
 * a first income later in its window doesn't leave a stub of a few days.
 */
function guessedPeriod(date, cfg, nextStart = '') {
  let m = cycleMonth(date, cfg);
  if (nextStart && m === cycleMonth(nextStart, cfg)) m = addMonths(m, -1);
  const start = dateInMonth(m, cfg.from);
  const end = nextStart && addMonths(m, 1) === cycleMonth(nextStart, cfg)
    ? addDays(nextStart, -1)
    : addDays(dateInMonth(addMonths(m, 1), cfg.from), -1);
  return cyclePeriod(start, end, { open: false, estimated: true });
}

/**
 * The period containing `date`. ctx = { txs, settings, today }; `today` (default: `date`) is what decides whether
 * the running cycle is still waiting for income or is overdue. Income dated after ctx.today starts no cycle.
 */
export function periodFor(date, ctx) {
  const cfg = payCycle(ctx.settings);
  if (!cfg) return monthPeriod(monthOf(date));
  const today = ctx.today || date;
  let cur = null;
  let next = null;
  for (const b of boundaries(ctx.txs, cfg, today, ctx.today || '')) {
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

/**
 * The line under the 今天 hero for a pay cycle ('' for a calendar month). An estimated cycle only says that no
 * income was recorded when no 薪水 / 创业收入 is dated inside it.
 */
export function cycleNote(p, txs, today) {
  if (p.kind !== 'cycle') return '';
  if (p.overdue) return `收入比平常晚，本期（从${dayLabel(p.start, today)}起）暂时延长到${dayLabel(p.end, today)}`;
  if (p.dueToday) return `今天是预计收入日，记下收入就开始新的一期（在那之前本期暂按到${dayLabel(p.end, today)}计算）`;
  const paid = p.estimated && txs.some((t) => isPayIncome(t) && inPeriod(t, p));
  const est = !p.estimated ? '' : paid ? '（开始日按窗口估计）' : '（还没记录本期收入，先按窗口估计）';
  return `本期 ${p.label}${est} · 下次收入按${dayLabel(p.nextPay, today)}估计`;
}
