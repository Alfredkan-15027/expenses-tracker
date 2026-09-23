// Long-term investment plan: target, projections and actual performance.
// Pure functions (no DOM / storage). All money values are integer cents; rates are annual decimals (0.08 = 8%).
//
// This is a planning calculator, not investment advice: returns are assumptions supplied by the user.
import { addDays, isValidISODate, monthOf, parseISO, todayISO, addMonths } from './dates.js';

export const DEFAULT_INVEST = {
  target: 175_000_000,      // RM 1,750,000
  years: 10,
  rateLow: 0.08,
  rateHigh: 0.10,
  freq: 'yearly',           // yearly | quarterly | monthly
  planned: 0,               // cents per contribution; 0 = use the amount required at the low (conservative) rate
  triggerIncome: 1_400_000, // start investing once monthly income reaches RM 14,000
  startDate: '',            // '' = the date of the first recorded contribution
};

export const FREQ_OPTIONS = [
  { id: 'yearly', label: '每年一次', short: '每年', perYear: 1 },
  { id: 'quarterly', label: '每季一次', short: '每季', perYear: 4 },
  { id: 'monthly', label: '每月一次', short: '每月', perYear: 12 },
];

export const HOLDING_KINDS = [
  { id: 'stock', label: '股票', color: 'blue' },
  { id: 'etf', label: 'ETF', color: 'indigo' },
  { id: 'fund', label: '基金', color: 'purple' },
  { id: 'fixed', label: '定存 · 债券', color: 'green' },
  { id: 'reit', label: 'REIT', color: 'orange' },
  { id: 'crypto', label: '加密货币', color: 'yellow' },
  { id: 'other', label: '其他', color: 'gray' },
];

const DAY_MS = 86_400_000;
// Leap days make calendar spans slightly longer than whole years (10y ≈ 10.0014); ignore that noise.
const PERIOD_EPS = 0.01;
const periodsIn = (t, m) => Math.max(0, Math.ceil(t * m - PERIOD_EPS));

export function perYear(freq) {
  return FREQ_OPTIONS.find((f) => f.id === freq)?.perYear || 1;
}

export function sanitizeInvest(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const cents = (v, d) => (Number.isSafeInteger(v) && v >= 0 && v <= 99_999_999_999 ? v : d);
  const rate = (v, d) => (Number.isFinite(v) && v > -0.5 && v < 1 ? Math.round(v * 10000) / 10000 : d);
  let rateLow = rate(r.rateLow, DEFAULT_INVEST.rateLow);
  let rateHigh = rate(r.rateHigh, DEFAULT_INVEST.rateHigh);
  if (rateLow > rateHigh) [rateLow, rateHigh] = [rateHigh, rateLow];
  const years = Number.isInteger(r.years) && r.years >= 1 && r.years <= 50 ? r.years : DEFAULT_INVEST.years;
  return {
    target: cents(r.target, DEFAULT_INVEST.target) || DEFAULT_INVEST.target,
    years,
    rateLow,
    rateHigh,
    freq: FREQ_OPTIONS.some((f) => f.id === r.freq) ? r.freq : DEFAULT_INVEST.freq,
    planned: cents(r.planned, 0),
    triggerIncome: cents(r.triggerIncome, DEFAULT_INVEST.triggerIncome),
    startDate: isValidISODate(r.startDate) ? r.startDate : '',
  };
}

/** Effective per-period rate for an annual effective rate r paid m times a year. */
export function periodRate(r, m) {
  return (1 + r) ** (1 / m) - 1;
}

/** Future value factor of n equal contributions made at the START of each period. */
export function annuityDueFactor(i, n) {
  if (n <= 0) return 0;
  if (Math.abs(i) < 1e-12) return n;
  return (((1 + i) ** n - 1) / i) * (1 + i);
}

/** Calendar-exact years between two ISO dates: whole years by date, then the fraction of the next year. */
export function yearsBetween(a, b) {
  if (a === b) return 0;
  if (b < a) return -yearsBetween(b, a);
  let k = Math.max(0, Number(b.slice(0, 4)) - Number(a.slice(0, 4)) - 1);
  while (addYears(a, k + 1) <= b) k += 1;
  const from = parseISO(addYears(a, k));
  const to = parseISO(addYears(a, k + 1));
  return k + (parseISO(b) - from) / (to - from);
}

export function addYears(iso, n) {
  const d = parseISO(iso);
  const target = new Date(d.getFullYear() + n, d.getMonth(), d.getDate());
  // 29 Feb → 28 Feb in non-leap years
  if (target.getMonth() !== d.getMonth()) target.setDate(0);
  const p = (x) => String(x).padStart(2, '0');
  return `${target.getFullYear()}-${p(target.getMonth() + 1)}-${p(target.getDate())}`;
}

/**
 * The plan makes one contribution at the start of every period: planStart + k periods (calendar dates),
 * k = 0 … years·m − 1. A scheduled contribution counts as made when money went in within half a period of its
 * date, so an early or late payment is not counted twice. Returns the contributions still to make as
 * { k, date, at, now } where `at` is years after asOf: an unpaid one whose date has passed but whose window is
 * still open is due now (at = 0); later ones at their scheduled date.
 */
export function contributionSchedule({ planStart, years, freq = 'yearly', asOf, paidTimes = [] }) {
  const m = perYear(freq);
  const half = 0.5 / m;
  const elapsed = Math.max(0, yearsBetween(planStart, asOf));
  const out = [];
  for (let k = 0; k < Math.round(years * m); k += 1) {
    const date = addPeriods(planStart, k, freq);
    const tau = yearsBetween(planStart, date);
    if (paidTimes.some((x) => x > tau - half && x <= tau + half)) continue;
    if (date > asOf) out.push({ k, date, at: tau - elapsed, now: false });
    else if (elapsed < tau + half) out.push({ k, date: asOf, at: 0, now: true });
  }
  return out;
}

/** Contribution times (years from now) within `t` years: the given ones, or one at the start of every period. */
function timesFor(times, t, freq) {
  const m = perYear(freq);
  return Array.isArray(times)
    ? times.filter((x) => x >= 0 && x <= t)
    : Array.from({ length: periodsIn(t, m) }, (_, j) => j / m);
}

/** Growth multiple of 1 unit contributed at each time, measured at `t` years from now. */
const contributionFactor = (times, t, rate) => times.reduce((s, x) => s + (1 + rate) ** (t - x), 0);

/**
 * Contribution needed each time to reach `target`, given the value already invested.
 * remainingYears: time left to the deadline. times: when the remaining contributions happen (years from now);
 * default is the start of every remaining period, beginning now. With none left, the answer is the one final
 * top-up needed now.
 */
export function requiredContribution({ target, current = 0, remainingYears, rate, freq = 'yearly', times }) {
  const t = Math.max(0, remainingYears);
  const gap = target - current * (1 + rate) ** t;
  if (gap <= 0) return 0;
  const list = timesFor(times, t, freq);
  return Math.ceil(gap / contributionFactor(list.length ? list : [0], t, rate));
}

/** Value at the deadline if `contribution` is added at each of the remaining contribution times (none → growth only). */
export function projectedValue({ current = 0, contribution = 0, remainingYears, rate, freq = 'yearly', times }) {
  const t = Math.max(0, remainingYears);
  return Math.round(current * (1 + rate) ** t + contribution * contributionFactor(timesFor(times, t, freq), t, rate));
}

/**
 * Year-by-year projection from asOf to `deadline` for each rate.
 * Returns [{ t (years from planStart), low, high }]. `times` as in projectedValue (years after asOf).
 */
export function projectionSeries({ planStart, deadline, asOf, current = 0, contribution = 0, rateLow, rateHigh, freq = 'yearly', times }) {
  const total = yearsBetween(planStart, deadline);
  const t0 = Math.min(Math.max(0, yearsBetween(planStart, asOf)), total);
  const all = timesFor(times, total - t0, freq);
  const valueAt = (span, rate, final) => {
    // A point on a contribution date shows the value just before that contribution (except at the deadline).
    const made = all.filter((x) => final || x < span);
    return Math.round(current * (1 + rate) ** span + contribution * contributionFactor(made, span, rate));
  };
  const points = [{ t: t0, low: current, high: current }];
  const last = periodsIn(total, 1);
  for (let y = Math.floor(t0) + 1; y <= last; y += 1) {
    const t = Math.min(y, total);
    const span = t - t0;
    const final = y === last;
    points.push({ t, low: valueAt(span, rateLow, final), high: valueAt(span, rateHigh, final) });
  }
  return points;
}

/** Money-weighted annual return. flows: [{ date, amount }] — money in negative, money out / final value positive. */
export function xirr(flows) {
  const list = flows.filter((f) => f.amount !== 0 && isValidISODate(f.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (list.length < 2 || !list.some((f) => f.amount > 0) || !list.some((f) => f.amount < 0)) return null;
  const d0 = parseISO(list[0].date);
  const ts = list.map((f) => (parseISO(f.date) - d0) / DAY_MS / 365);
  if (ts[ts.length - 1] <= 0) return null;
  const npv = (r) => list.reduce((s, f, k) => s + f.amount / (1 + r) ** ts[k], 0);
  const dnpv = (r) => list.reduce((s, f, k) => s - (ts[k] * f.amount) / (1 + r) ** (ts[k] + 1), 0);
  let r = 0.1;
  for (let k = 0; k < 60; k += 1) {
    const v = npv(r);
    const d = dnpv(r);
    if (!Number.isFinite(v) || !Number.isFinite(d) || d === 0) break;
    const next = r - v / d;
    if (!Number.isFinite(next) || next <= -0.9999) break;
    if (Math.abs(next - r) < 1e-10) return next;
    r = next;
  }
  // Bisection fallback on [-0.99, 10]
  let lo = -0.99, hi = 10;
  let flo = npv(lo), fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let k = 0; k < 200; k += 1) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

/**
 * Value and cost of one holding as of a date.
 * Market value = latest valuation, adjusted by money added / taken out after that valuation.
 */
export function holdingSummary(holdingId, flows, valuations, asOf = todayISO()) {
  const f = flows.filter((x) => x.holdingId === holdingId && x.date <= asOf);
  const v = valuations.filter((x) => x.holdingId === holdingId && x.date <= asOf)
    .sort((a, b) => (a.date === b.date ? (a.createdAt || 0) - (b.createdAt || 0) : a.date < b.date ? -1 : 1));
  const invested = f.reduce((s, x) => s + (x.type === 'in' ? x.amount : 0), 0);
  const withdrawn = f.reduce((s, x) => s + (x.type === 'out' ? x.amount : 0), 0);
  const last = v[v.length - 1] || null;
  let value;
  if (last) {
    const after = f.filter((x) => x.date > last.date || (x.date === last.date && (x.createdAt || 0) > (last.createdAt || 0)));
    value = last.value + after.reduce((s, x) => s + (x.type === 'in' ? x.amount : -x.amount), 0);
  } else {
    value = invested - withdrawn; // no valuation yet: assume it is worth what was put in
  }
  value = Math.max(0, value);
  // Total gain = what it is worth now + what was already taken out − everything put in (never a negative principal).
  const gain = value + withdrawn - invested;
  return {
    holdingId, invested, withdrawn, value, gain,
    gainRatio: invested > 0 ? gain / invested : null,
    lastValuationDate: last?.date || null,
    firstFlowDate: f.reduce((m, x) => (!m || x.date < m ? x.date : m), ''),
  };
}

/** Whole-portfolio summary including money-weighted return. */
export function portfolioSummary({ holdings, flows, valuations, asOf = todayISO() }) {
  const ids = holdings.map((h) => h.id);
  const rows = ids.map((id) => holdingSummary(id, flows, valuations, asOf));
  const value = rows.reduce((s, r) => s + r.value, 0);
  const invested = rows.reduce((s, r) => s + r.invested, 0);
  const withdrawn = rows.reduce((s, r) => s + r.withdrawn, 0);
  const known = new Set(ids);
  const cash = flows.filter((f) => known.has(f.holdingId) && f.date <= asOf)
    .map((f) => ({ date: f.date, amount: f.type === 'in' ? -f.amount : f.amount }));
  if (value > 0) cash.push({ date: asOf, amount: value });
  const firstDate = cash.reduce((m, x) => (!m || x.date < m ? x.date : m), '');
  const heldYears = firstDate ? yearsBetween(firstDate, asOf) : 0;
  const valued = valuations.filter((v) => known.has(v.holdingId) && v.date <= asOf);
  const lastValuation = valued.reduce((m, v) => (!m || v.date > m ? v.date : m), '');
  // Oldest "last known value" among holdings that still hold money: a valuation, or the first money in.
  const stalest = rows.filter((r) => r.value > 0)
    .map((r) => r.lastValuationDate || r.firstFlowDate).filter(Boolean)
    .reduce((m, d) => (!m || d < m ? d : m), '');
  const gain = value + withdrawn - invested;
  return {
    rows, value, invested, withdrawn, gain,
    gainRatio: invested > 0 ? gain / invested : null,
    // Without any market value update the return would just be 0% — show nothing instead.
    annualReturn: value > 0 && heldYears > 0 && valued.length ? xirr(cash) : null,
    heldYears,
    firstDate: firstDate || null,
    lastValuation: lastValuation || null,
    stalestValue: stalest || null,
  };
}

/** Where the plan stands today. */
export function planState({ invest, flows, valuations, holdings, transactions = [], asOf = todayISO() }) {
  const s = sanitizeInvest(invest);
  const pf = portfolioSummary({ holdings, flows, valuations, asOf });
  const firstFlow = flows.filter((f) => f.type === 'in').reduce((m, f) => (!m || f.date < m ? f.date : m), '');
  const startDate = s.startDate || firstFlow || '';
  const started = !!startDate && startDate <= asOf;
  const planStart = started ? startDate : asOf;
  const deadline = addYears(planStart, s.years);
  const mid = (s.rateLow + s.rateHigh) / 2;
  const current = started ? pf.value : 0;
  const elapsedYears = started ? Math.max(0, yearsBetween(planStart, asOf)) : 0;
  // Measured from planStart like the projection chart, so its last point equals 到期预计 exactly.
  const remainingYears = Math.max(0, yearsBetween(planStart, deadline) - elapsedYears);

  // Which scheduled contributions are still to come (money already put in this period is part of `current`).
  const paidTimes = started
    ? flows.filter((f) => f.type === 'in' && f.date <= asOf).map((f) => yearsBetween(planStart, f.date))
    : [];
  const upcoming = contributionSchedule({ planStart, years: s.years, freq: s.freq, asOf, paidTimes })
    .filter((c) => c.at < remainingYears);
  const calc = { current, remainingYears, freq: s.freq, times: upcoming.map((c) => c.at) };

  const required = {
    low: requiredContribution({ ...calc, target: s.target, rate: s.rateLow }),
    mid: requiredContribution({ ...calc, target: s.target, rate: mid }),
    high: requiredContribution({ ...calc, target: s.target, rate: s.rateHigh }),
  };
  // Default plan is the conservative one: enough to reach the target even at the low return assumption.
  const planned = s.planned || required.low;
  // What the plan will still put in. With nothing left on the schedule, the automatic plan is the one final
  // top-up that `required` asks for; a fixed amount adds nothing more (and after the deadline nothing does).
  const times = !upcoming.length && remainingYears > 0 && !s.planned ? [0] : calc.times;
  const projected = {
    low: projectedValue({ ...calc, times, contribution: planned, rate: s.rateLow }),
    high: projectedValue({ ...calc, times, contribution: planned, rate: s.rateHigh }),
  };
  const next = upcoming[0] ? { date: upcoming[0].date, now: upcoming[0].now, left: upcoming.length } : null;
  let status = 'preparing';
  if (started) {
    if (remainingYears <= 0) status = current >= s.target ? 'done' : 'missed';
    else if (projected.low >= s.target) status = 'ahead';
    else if (projected.high >= s.target) status = 'tight';
    else status = 'behind';
  }

  // Trend of monthly income against the start condition.
  const month = monthOf(asOf);
  const incomeOf = (ym) => transactions.reduce((sum, t) => (t.type === 'income' && monthOf(t.date) === ym ? sum + t.amount : sum), 0);
  const lastMonths = [1, 2, 3].map((k) => incomeOf(addMonths(month, -k)));
  const trigger = {
    threshold: s.triggerIncome,
    thisMonth: incomeOf(month),
    lastMonth: lastMonths[0],
    avg3: Math.round(lastMonths.reduce((a, b) => a + b, 0) / 3),
  };
  trigger.reached = s.triggerIncome > 0 && (trigger.lastMonth >= s.triggerIncome || trigger.thisMonth >= s.triggerIncome);

  const annualPlanned = planned * perYear(s.freq);
  return {
    invest: s, portfolio: pf, started, startDate, planStart, deadline, remainingYears, elapsedYears,
    current, required, planned, usesRequired: !s.planned, projected, status, trigger, times, next,
    annualPlanned,
    shareOfTriggerIncome: s.triggerIncome > 0 ? annualPlanned / (s.triggerIncome * 12) : null,
    progress: s.target > 0 ? Math.min(1, current / s.target) : 0,
    returnBand: pf.annualReturn === null ? 'none'
      : pf.annualReturn < s.rateLow ? 'below' : pf.annualReturn > s.rateHigh ? 'above' : 'within',
    valuationAgeDays: pf.stalestValue ? Math.round((parseISO(asOf) - parseISO(pf.stalestValue)) / DAY_MS) : null,
  };
}

/** planStart + k periods (month-end safe: 31 Jan + 1 month → 28/29 Feb). */
export function addPeriods(planStart, k, freq) {
  const [y, m, d] = planStart.split('-').map(Number);
  const target = new Date(y, m - 1 + k * (12 / perYear(freq)), d);
  if (target.getDate() !== d) target.setDate(0);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
}

/** Contribution dates of the plan (for reminders): startDate + k periods. */
export function nextContributionDate({ planStart, freq, asOf = todayISO() }) {
  for (let k = 0; k < 600; k += 1) {
    const iso = addPeriods(planStart, k, freq);
    if (iso >= asOf) return iso;
  }
  return addDays(asOf, 365);
}
