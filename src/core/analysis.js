// Pure analysis functions. No DOM, no storage — safe to unit test in Node.
import { addDays, addMonths, dateInMonth, dayLabel, dayOf, monthOf, monthRange } from './dates.js';
import { CYCLE_INCOME_CATEGORIES, daysBetween, expectedEnd, inPeriod, monthPeriod, payCycle, periodFor, prevPeriod } from './periods.js';
import { categoryMap } from './categories.js';
import { findManualMatch, paidByHand } from './recurring.js';
import {
  categoryRanges, livingCostTiers, normalizeProfile, TIER_LABELS,
  SAVINGS_RATE_GOOD, SAVINGS_RATE_OK, NEEDS_SHARE_MAX, WANTS_SHARE_MAX, RUNWAY_TARGET_MONTHS,
} from './benchmarks.js';
import { formatMoney, formatPercent, roundedRest } from './money.js';

const RM = 100; // cents per ringgit

export function isBusiness(tx) {
  return tx.type === 'expense' && (tx.business === true || tx.categoryId === 'business');
}

/** A fixed item that is a business cost (marked 创业, or filed under 创业支出). */
export const isBusinessItem = (r) => !!r.business || r.categoryId === 'business';

// Insurance premiums are protection, not living cost: they show as their own row (保险) and stay out of the living-cost
// verdict and the 健康 reference range, so paying the premium never makes a clinic visit look like overspending.
// Filed under 保险, or under 健康 with 保险 in the note (as records made before 保险 existed are).
const INSURANCE_NOTE = /保险|保單|保单|insurance|takaful|医药卡|medical card/i;
/** The category an expense (or a fixed item) is analysed under: an insurance premium filed under 健康 counts as 保险. */
export const analysisCategory = (t) => (t.categoryId === 'health' && INSURANCE_NOTE.test(t.note || '') ? 'insurance' : t.categoryId);

export function txInMonth(txs, ym) {
  return txs.filter((t) => monthOf(t.date) === ym);
}

export function txInPeriod(txs, p) {
  return txs.filter((t) => inPeriod(t, p));
}

function summarize(list, categories, extra) {
  const cats = categoryMap(categories);
  let income = 0, expense = 0, business = 0;
  const byCategory = new Map();
  const byGroup = { need: 0, want: 0, growth: 0, business: 0, other: 0 };
  for (const t of list) {
    if (t.type === 'income') { income += t.amount; continue; }
    expense += t.amount;
    const id = analysisCategory(t);
    byCategory.set(id, (byCategory.get(id) || 0) + t.amount);
    if (isBusiness(t)) { business += t.amount; byGroup.business += t.amount; continue; }
    const g = cats.get(id)?.group;
    byGroup[g in byGroup ? g : 'other'] += t.amount;
  }
  const personal = expense - business;
  const net = income - expense;
  return {
    ...extra, income, expense, business, personal, net,
    savingsRate: income > 0 ? net / income : null,
    byCategory, byGroup, count: list.length,
  };
}

/** Totals for one month. All values in cents. */
export function monthSummary(txs, ym, categories = []) {
  return summarize(txInMonth(txs, ym), categories, { ym });
}

/** Totals for a period (month or pay cycle). */
export function periodSummary(txs, p, categories = []) {
  return summarize(txInPeriod(txs, p), categories, { ym: p.key, period: p });
}

/** Personal (non-business) spending per category for a month (ym) or period, cents. */
export function personalByCategory(txs, ymOrPeriod) {
  const list = typeof ymOrPeriod === 'string' ? txInMonth(txs, ymOrPeriod) : txInPeriod(txs, ymOrPeriod);
  const out = new Map();
  for (const t of list) {
    if (t.type !== 'expense' || isBusiness(t)) continue;
    const id = analysisCategory(t);
    out.set(id, (out.get(id) || 0) + t.amount);
  }
  return out;
}

/**
 * Recurring expenses (or, with type 'income', recurring income) still to come after `today` up to `end`
 * (default: end of this month), not yet generated.
 */
export function upcomingRecurring(recurring = [], today, end = '', type = 'expense', txs = []) {
  const last = end || dateInMonth(monthOf(today), 31);
  const byHand = paidByHand(txs, recurring); // already paid by hand this month: nothing left to set aside
  let sum = 0;
  for (const r of recurring) {
    if (!r.active || r.type !== type) continue;
    for (const m of monthRange(monthOf(today), monthOf(last))) {
      if (r.lastMonth && r.lastMonth >= m) continue;
      if (byHand.has(`${r.id}|${m}`)) continue;
      if (r.startMonth && r.startMonth > m) continue;
      const due = dateInMonth(m, r.day);
      if (due > today && due <= last) sum += r.amount;
    }
  }
  return sum;
}

/**
 * First day of tracking: the setup date — or, when past spending was typed in after setup (entries on at
 * least 3 different days before it), the earliest of those entries. One or two catch-up entries (e.g. this
 * month's rent, already paid) keep the setup date. Entries made by fixed items never count, and neither does
 * income (past salaries typed in for the record are not spending history).
 */
export function trackingStart(settings, txs) {
  const setup = settings?.startDate || '';
  if (!setup) return '';
  const days = new Set();
  let earliest = setup;
  for (const t of txs) {
    if (t.type !== 'expense' || t.recurringId || t.date >= setup) continue;
    days.add(t.date);
    if (t.date < earliest) earliest = t.date;
  }
  return days.size >= 3 ? earliest : setup;
}

const MODEL_WINDOW_DAYS = 90;
export const MODEL_MIN_DAYS = 7;
const MODEL_STEADY_DAYS = 14; // below this the pace is only a rough guide
const nearAmount = (a, b) => Math.abs(a - b) <= Math.max(100, Math.round(b * 0.05));

// Bills that come once a month or less often (rent, utilities, subscriptions, money for family, insurance, courses).
// The monthly model spreads them over at least 30 days; a partly tracked period does not pace them (see partialStatus).
const LUMP_SUM_CATEGORIES = new Set(['housing', 'utilities', 'subscriptions', 'family', 'health', 'insurance', 'learning']);

/**
 * What a month of spending looks like right now — the basis for the living-cost verdict of the running
 * period and for runway. Fixed items (设置 → 固定项目) count at their set monthly amount; day-to-day
 * spending counts at its average daily pace over the last ≤90 tracked days, × 30. Nothing is extrapolated from
 * a single lump (rent, insurance, a debt payment): rent paid by hand counts once a month, and the other bills typed in
 * by hand (LUMP_SUM_CATEGORIES) are spread over at least 30 days. Period boundaries don't matter.
 * An entry that stands for a fixed item — made by one (even one since deleted or paused), or typed in by hand at
 * its usual amount in a month the item made no entry of its own — belongs to the fixed side and is left out of the pace.
 * One-off business spending is not part of the month; it is reported separately.
 * `byCategory`: the same estimate per personal category (cents / month), so category flags agree with the total.
 * `handRent`: rent paid by hand as a fixed item would be (due on the day it was last paid), or null.
 */
export function spendingModel({ txs, recurring = [], today, since = '' }) {
  const active = recurring.filter((r) => r.active && r.type === 'expense');
  const fixedBy = new Map();
  let fixedPersonal = 0;
  let fixedBusiness = 0;
  for (const r of active) {
    if (isBusinessItem(r)) { fixedBusiness += r.amount; continue; }
    fixedPersonal += r.amount;
    const id = analysisCategory(r);
    fixedBy.set(id, (fixedBy.get(id) || 0) + r.amount);
  }
  const fixedInsurance = fixedBy.get('insurance') || 0;
  // A hand-typed entry stands for a fixed item only in a month the item made no entry of its own, and only one a month
  // (the closest amount): a RM 50 Touch 'n Go reload is not the RM 50 My50 pass every time.
  const made = new Set(txs.filter((t) => t.recurringId).map((t) => `${t.recurringId}|${monthOf(t.date)}`));
  const standIns = new Set();
  for (const r of active) {
    const best = new Map(); // month → closest hand-typed entry
    for (const t of txs) {
      if (t.type !== 'expense' || t.recurringId || standIns.has(t) || t.categoryId !== r.categoryId || !nearAmount(t.amount, r.amount)) continue;
      const m = monthOf(t.date);
      if (made.has(`${r.id}|${m}`)) continue;
      const b = best.get(m);
      if (!b || Math.abs(t.amount - r.amount) < Math.abs(b.amount - r.amount)) best.set(m, t);
    }
    for (const t of best.values()) standIns.add(t);
  }
  const coversFixed = (t) => !!t.recurringId || standIns.has(t);

  const expenses = txs.filter((t) => t.type === 'expense' && t.date <= today);
  let from = since || expenses.reduce((a, t) => (!a || t.date < a ? t.date : a), '');
  if (!from) {
    return {
      fixedPersonal, fixedBusiness, variable: 0, variableDaily: 0, variableMonthly: 0, personalMonthly: fixedPersonal,
      totalMonthly: fixedPersonal + fixedBusiness, oneOffBusiness: 0, days: 0, from: '', enough: false, steady: false, byCategory: fixedBy,
      handRent: null, fixedInsurance, insurance: fixedInsurance,
    };
  }
  const floor = addDays(today, -(MODEL_WINDOW_DAYS - 1));
  if (from < floor) from = floor;
  const days = Math.max(1, daysBetween(from, today) + 1);
  const lumpDays = Math.max(days, 30);

  // Rent paid by hand (no fixed item for it) counts as fixed, not as pace: the latest month's housing — unless all that
  // month holds so far is small next to the month before (a fee paid before this month's rent): then the month before's.
  const rentByHand = !active.some((r) => r.categoryId === 'housing');
  const rentMonths = new Map(); // month → { total, top: its largest payment, day: the day of that payment }
  const variableBy = new Map();
  let variable = 0;
  let oneOffBusiness = 0;
  for (const t of expenses) {
    if (t.date < from || coversFixed(t)) continue;
    if (isBusiness(t)) { oneOffBusiness += t.amount; continue; }
    if (rentByHand && t.categoryId === 'housing') {
      const m = monthOf(t.date);
      const e = rentMonths.get(m) || { total: 0, top: 0, day: 1 };
      e.total += t.amount;
      if (t.amount > e.top) { e.top = t.amount; e.day = dayOf(t.date); }
      rentMonths.set(m, e);
      continue;
    }
    variable += t.amount;
    const id = analysisCategory(t);
    variableBy.set(id, (variableBy.get(id) || 0) + t.amount);
  }
  let handRent = null;
  if (rentMonths.size) {
    const months = [...rentMonths.keys()].sort();
    let paid = months[months.length - 1];
    const before = months[months.length - 2];
    if (before && rentMonths.get(paid).top * 2 < rentMonths.get(before).top) paid = before;
    const { total: rent, day } = rentMonths.get(paid);
    handRent = { type: 'expense', active: true, categoryId: 'housing', amount: rent, day, lastMonth: paid };
    fixedPersonal += rent;
    fixedBy.set('housing', (fixedBy.get('housing') || 0) + rent);
  }
  // Day-to-day spending at its daily pace; bills (LUMP_SUM_CATEGORIES) over at least 30 days, so with under a month
  // of records one payment is not multiplied.
  const lump = [...variableBy].reduce((a, [id, v]) => a + (LUMP_SUM_CATEGORIES.has(id) ? v : 0), 0);
  const variableDaily = (variable - lump + (lump * days) / lumpDays) / days;
  const variableMonthly = Math.round(variableDaily * 30);
  const byCategory = new Map(fixedBy);
  for (const [id, v] of variableBy) {
    byCategory.set(id, (byCategory.get(id) || 0) + Math.round((v / (LUMP_SUM_CATEGORIES.has(id) ? lumpDays : days)) * 30));
  }
  return {
    fixedPersonal, fixedBusiness, variable, variableDaily, variableMonthly,
    personalMonthly: fixedPersonal + variableMonthly,
    totalMonthly: fixedPersonal + fixedBusiness + variableMonthly,
    oneOffBusiness, days, from, enough: days >= MODEL_MIN_DAYS, steady: days >= MODEL_STEADY_DAYS, byCategory, handRent,
    fixedInsurance, insurance: byCategory.get('insurance') || 0,
  };
}

/**
 * Money on hand now (对账): the figure last filled in (设置 → 目前存款, `currentSavings` on `currentSavingsAt`) carried
 * forward by what was recorded after it — + income − spending − money moved into investments (+ taken out).
 * Entries dated before that day are taken as already in the figure; entries on that day count when they were logged
 * after it was filled in (`currentSavingsTs`; without one, that day's entries are taken as included). Entries dated
 * after today don't count yet. Null when it was never filled in.
 * `todayOut`: today's spending in it that is not a fixed item's charge — made by the item, or (with `recurring`) a
 * fixed item paid by hand (see paidByHand) — for today's cash allowance; `todayOutBiz`: the business part of it.
 * `kept`: the savings in it that are not to be spent (settings.keptSavings); `spendable` = balance − kept, the money
 * the allowance may use. Runway and the goal still count all of it.
 */
export function cashOnHand({ txs, settings, flows = [], today, recurring = [] }) {
  const at = settings?.currentSavingsAt || '';
  if (!at) return null;
  const ts = settings.currentSavingsTs || 0;
  const after = (date, createdAt) => date > at || (date === at && ts > 0 && (createdAt || 0) > ts);
  let income = 0;
  let spent = 0;
  let invested = 0;
  let count = 0;
  let todayOut = 0;
  let todayOutBiz = 0;
  const fixedByHand = new Set([...paidByHand(txs, recurring).values()].map((t) => t.id));
  for (const t of txs) {
    // Today's spending, also what was logged before the check today: it is already out of the figure, and the
    // money at the start of today = balance + all of today's spending.
    if (t.type === 'expense' && t.date === today && !t.recurringId && !fixedByHand.has(t.id)) {
      todayOut += t.amount;
      if (isBusiness(t)) todayOutBiz += t.amount;
    }
    if (t.date > today || !after(t.date, t.createdAt)) continue;
    count += 1;
    if (t.type === 'income') { income += t.amount; continue; }
    spent += t.amount;
  }
  for (const f of flows) {
    if (f.date > today || !after(f.date, f.createdAt)) continue;
    count += 1;
    invested += f.type === 'out' ? -f.amount : f.amount;
  }
  const base = settings.currentSavings || 0;
  const balance = base + income - spent - invested;
  const kept = settings.keptSavings || 0;
  return {
    base, at, days: Math.max(0, daysBetween(at, today)), income, spent, invested, count, todayOut, todayOutBiz,
    balance, kept, spendable: balance - kept,
  };
}

const RECONCILE_MATCH = 100; // within RM 1 the records and the bank agree

/**
 * 对账: the entry that closes the gap between the money really there (`real`) and what the records say
 * (`recorded`, cashOnHand().balance) — spending nobody wrote down (less money) or income that wasn't (more).
 * Dated the day before, so it counts as past spending in the budget instead of eating today's allowance (and stays
 * out of the new figure, which already reflects it). Null when they agree within RM 1.
 */
export function reconcileGap(real, recorded, today) {
  const diff = real - recorded;
  if (Math.abs(diff) < RECONCILE_MATCH) return null;
  const date = addDays(today, -1);
  return diff < 0
    ? { type: 'expense', amount: -diff, categoryId: 'other', date, note: '对账差额：没记到的支出' }
    : { type: 'income', amount: diff, categoryId: 'otherincome', date, note: '对账差额：没记到的收入' };
}

/**
 * The fixed-item expenses from `from` to `to`, each on the day it lands: the entry a fixed item made (also one since
 * paused or deleted); for a month the app won't log (本月也记一笔 off, or skipped while paused) the entry typed in by
 * hand for it, if there is one; otherwise the item's day. Business ones only when they count against the budget.
 */
function fixedCharges({ txs, recurring, from, to, countsBusiness }) {
  const out = [];
  const logged = new Set();
  for (const t of txs) {
    if (t.type !== 'expense' || !t.recurringId) continue;
    logged.add(`${t.recurringId}|${monthOf(t.date)}`);
    if (t.date >= from && t.date <= to && (countsBusiness || !isBusiness(t))) out.push({ date: t.date, amount: t.amount });
  }
  const byHand = new Set(); // a hand-typed entry stands for one fixed item only
  for (const r of recurring) {
    if (!r.active || r.type !== 'expense' || (!countsBusiness && isBusinessItem(r))) continue;
    for (const m of monthRange(monthOf(from), monthOf(to))) {
      if ((r.startMonth && r.startMonth > m) || logged.has(`${r.id}|${m}`)) continue;
      let charge = { date: dateInMonth(m, r.day), amount: r.amount };
      if (r.lastMonth && r.lastMonth >= m) {
        const hand = findManualMatch(txs.filter((t) => !byHand.has(t.id)), r, `${m}-01`);
        if (!hand) continue;
        byHand.add(hand.id);
        charge = { date: hand.date, amount: hand.amount };
      }
      if (charge.date >= from && charge.date <= to) out.push(charge);
    }
  }
  return out;
}

/**
 * What a period may spend in total: income basis − savings target; income basis = expected income, or the period's
 * actual income when none is set. A period tracking started in the middle of is prorated to the days that count:
 * the day-to-day part by days, fixed items by the day they land (due after the start: in full; paid before it: not
 * at all), so rent never makes the first days look overspent or roomier than a whole month would.
 * While the next income is late the cycle is prorated over its planned length: the extra days stretch the same
 * money, they add none. `fixedTracked`: the fixed items inside the tracked part.
 */
export function periodBudget({ txs, settings, period: p, recurring = [] }) {
  const summary = periodSummary(txs, p);
  const expected = settings.expectedIncome || 0;
  const incomeBasis = expected > 0 ? expected : summary.income;
  const target = settings.savingsTarget || 0;
  let budget = Math.max(0, incomeBasis - target);
  const start = trackingStart(settings, txs);
  const prorated = !!start && start > p.start && start <= p.end && expected > 0;
  let fixedTracked = 0;
  if (prorated) {
    const cfg = p.open ? payCycle(settings) : null;
    const planned = cfg ? expectedEnd(p.start, cfg) : p.end;
    // Set up only after the planned end (income already late): nothing to anchor to but the stretched end.
    const end = planned < p.end && start <= planned ? planned : p.end;
    const countsBusiness = settings.budgetIncludesBusiness === true;
    let fixed = 0;
    for (const c of fixedCharges({ txs, recurring, from: p.start, to: end, countsBusiness })) {
      fixed += c.amount;
      if (c.date >= start) fixedTracked += c.amount;
    }
    const dayToDay = Math.round((Math.max(0, budget - fixed) * (daysBetween(start, end) + 1)) / (daysBetween(p.start, end) + 1));
    budget = Math.min(budget, dayToDay + fixedTracked);
  }
  return { budget, hasPlan: incomeBasis > 0, incomeBasis, usesExpected: expected > 0, target, start, prorated, fixedTracked, summary };
}

/**
 * Budget for the current period (calendar month, or pay cycle when set): how much can be spent in total
 * and today. budget = income basis − savings target; income basis = expected income, or actual income
 * in the period if not set.
 * Fixed items charged today were set aside beforehand, so they do not count against today's allowance
 * (spentTodayFree = what was spent on top of them).
 * Business spending (and business fixed items) counts against the budget only when settings.budgetIncludesBusiness
 * is on; otherwise it is tracked (spentBusiness) but kept outside the allowance. Either way it stays in the
 * income / balance figures — that is money that really left.
 */
export function dailyBudget({ txs, settings, recurring = [], today, cash = null }) {
  const p = periodFor(today, { txs, settings, today });
  const dim = p.days;
  const day = daysBetween(p.start, today) + 1;
  const daysLeft = Math.max(1, daysBetween(today, p.end) + 1); // today is always inside its period; never divide by 0
  const countsBusiness = settings.budgetIncludesBusiness === true;
  // Started tracking in the middle of the period: only the remaining part of the budget applies.
  const { budget, hasPlan, incomeBasis, usesExpected, target, start, prorated, fixedTracked, summary: s } = periodBudget({ txs, settings, period: p, recurring });

  let spentToday = 0;
  let fixedToday = 0;
  let spentMonth = 0;
  let spentBusiness = 0;
  // A fixed item paid by hand (rent transferred early) is a fixed charge too: set aside, not today's spending.
  const fixedByHand = new Set([...paidByHand(txs, recurring).values()].map((t) => t.id));
  for (const t of txInPeriod(txs, p)) {
    if (t.type !== 'expense') continue;
    // With a prorated budget, spending from before tracking started belongs to the unbudgeted part.
    const inBudget = !prorated || t.date >= start;
    const biz = isBusiness(t);
    if (biz && inBudget) spentBusiness += t.amount;
    if (biz && !countsBusiness) continue;
    if (t.date === today) {
      spentToday += t.amount;
      if (t.recurringId || fixedByHand.has(t.id)) fixedToday += t.amount;
    }
    if (inBudget) spentMonth += t.amount;
  }
  const spentBefore = spentMonth - spentToday;
  const spentTodayFree = spentToday - fixedToday;
  const reserved = upcomingRecurring(countsBusiness ? recurring : recurring.filter((r) => !isBusinessItem(r)), today, p.end, 'expense', txs);
  const remainingAtStart = budget - spentBefore - fixedToday - reserved;
  let allowanceToday = Math.floor(remainingAtStart / daysLeft);
  let leftMonth = budget - spentMonth - reserved;
  // The budget can only be spent if the money is there. With the money on hand known (对账, see cashOnHand), what
  // it can still cover — after every fixed item still due this period, business ones too: it's the same account —
  // spread over the days left caps the allowance. Then today's spending is counted the same way — business spending
  // only when it counts against the budget; otherwise a business payment today just leaves less for the days left.
  let limit = 'budget';
  let shownToday = spentTodayFree;
  let cashLeft = null;
  let reservedAll = reserved;
  if (cash && hasPlan) {
    reservedAll = upcomingRecurring(recurring, today, p.end, 'expense', txs);
    cashLeft = (cash.spendable ?? cash.balance) - reservedAll; // savings kept aside are not spending money
    const cashToday = cash.todayOut - (countsBusiness ? 0 : cash.todayOutBiz || 0);
    const cashAllowance = Math.floor((cashLeft + cashToday) / daysLeft);
    if (cashAllowance < allowanceToday) {
      limit = 'cash';
      allowanceToday = cashAllowance;
      shownToday = cashToday;
      leftMonth = Math.min(leftMonth, cashLeft);
    }
  }
  // Once the period is overspent there is no allowance left: today's spending is simply over.
  const leftToday = Math.max(0, allowanceToday) - shownToday;
  const tracked = prorated ? daysBetween(start, p.end) + 1 : dim;

  return {
    ym: p.key, period: p, hasPlan, incomeBasis, usesExpected, budget, target, prorated, startDate: start, fixedTracked,
    countsBusiness, spentToday, spentTodayFree, fixedToday, spentMonth, spentBusiness,
    spentAll: spentMonth + (countsBusiness ? 0 : spentBusiness),
    reserved, daysLeft, dim, day,
    cash, limit, cashLeft, reservedAll, shownToday,
    allowanceToday, leftToday, leftMonth,
    // A RM 0 budget (savings target = income) is used up by the first ringgit.
    usedRatio: budget > 0 ? (spentMonth + reserved) / budget : spentMonth + reserved > 0 ? Infinity : 0,
    monthProgress: (tracked - daysLeft + 1) / tracked,
    incomeMonth: s.income,
    savedMonth: s.net,
    status: !hasPlan ? 'none' : leftMonth < 0 ? 'overMonth' : leftToday < 0 ? 'overToday' : 'ok',
  };
}

/**
 * Totals per period for the trend chart: [{ ym, key, label, short, tick, partial, income, expense, personal, business }].
 * `partial`: the period began before tracking started, so its total is incomplete.
 */
export function trendPeriods(txs, periods, since = '') {
  return periods.map((p) => {
    const r = {
      ym: p.key, key: p.key, label: p.label, short: p.short, tick: p.tick, partial: !!since && p.start < since,
      income: 0, expense: 0, personal: 0, business: 0,
    };
    for (const t of txInPeriod(txs, p)) {
      if (t.type === 'income') r.income += t.amount;
      else {
        r.expense += t.amount;
        if (isBusiness(t)) r.business += t.amount; else r.personal += t.amount;
      }
    }
    return r;
  });
}

/** Last n months ending at endYm. */
export function trend(txs, endYm, n = 6) {
  return trendPeriods(txs, monthRange(addMonths(endYm, -(n - 1)), endYm).map(monthPeriod));
}

// Pay cycles are 28–36 days long; compare them per 30 days so a long cycle doesn't look like overspending.
const perMonthFactor = (p) => (p.kind === 'cycle' ? 30 / p.days : 1);

export const MIN_COMPARE_DAYS = 7; // a running period is compared once it is this many days old: a day or two says nothing

/**
 * Personal spending per category, a period against the one before it. Business spending is counted apart, as
 * everywhere in the analysis (one debt payment would swamp the rest).
 * While `p` is still running (today inside it), both are compared over the same first N days — a whole previous
 * period against a few days of this one is meaningless — once N reaches MIN_COMPARE_DAYS (`early` before that: not
 * comparable). N is at most the previous period's length: nothing is scaled up. Fixed items (made by one, or paid
 * by hand: see paidByHand) are left out then (`dayToDay`): they land on different days of each period, so the
 * first days would hold this period's rent against none of the last one's. Finished periods are compared whole,
 * fixed items included; pay cycles per 30 days. The previous period must be fully tracked.
 */
export function comparePeriods(txs, p, prev, categories, since = '', today = '', recurring = []) {
  const running = !!today && today >= p.start && today < p.end;
  let pa = p;
  let pb = prev;
  let fa = perMonthFactor(p);
  let fb = perMonthFactor(prev);
  let sameDays = 0;
  if (running) {
    sameDays = Math.min(daysBetween(p.start, today) + 1, daysBetween(prev.start, prev.end) + 1);
    pa = { ...p, end: addDays(p.start, sameDays - 1) };
    pb = { ...prev, end: addDays(prev.start, sameDays - 1) };
    fa = 1;
    fb = 1;
  }
  const early = running && sameDays < MIN_COMPARE_DAYS;
  const comparable = (!since || prev.start >= since) && !early;
  const handPaid = running ? new Set([...paidByHand(txs, recurring).values()].map((t) => t.id)) : null;
  const counted = txs.filter((t) => t.type !== 'expense' || (!isBusiness(t) && !(running && (t.recurringId || handPaid.has(t.id)))));
  const cur = periodSummary(counted, pa, categories);
  const old = periodSummary(counted, pb, categories);
  const ids = new Set([...cur.byCategory.keys(), ...old.byCategory.keys()]);
  const rows = [...ids].map((id) => {
    const a = Math.round((cur.byCategory.get(id) || 0) * fa);
    const b = Math.round((old.byCategory.get(id) || 0) * fb);
    return { categoryId: id, current: a, previous: b, delta: a - b, ratio: b > 0 ? (a - b) / b : null };
  }).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const a = Math.round(cur.expense * fa);
  const b = Math.round(old.expense * fb);
  return {
    ym: p.key, prevYm: prev.key, period: p, prevPeriod: prev, current: cur, previous: old, rows, comparable, sameDays,
    early, dayToDay: running,
    normalized: fa !== 1 || fb !== 1,
    delta: a - b,
    ratio: b > 0 ? (a - b) / b : null,
  };
}

/** Category comparison between month ym and the previous month. */
export function compareMonths(txs, ym, categories, since = '', today = '', recurring = []) {
  return comparePeriods(txs, monthPeriod(ym), monthPeriod(addMonths(ym, -1)), categories, since, today, recurring);
}

function tierFor(amountRM, tiers) {
  if (amountRM < tiers[0]) return 'lean';
  if (amountRM <= tiers[1]) return 'ok';
  if (amountRM <= tiers[2]) return 'high';
  return 'over';
}

// A running period's category figures are estimates (fixed items + recent pace): allow a little room above the
// reference range before calling a category high, so a few ringgit over a fixed cost like insurance isn't flagged.
const ESTIMATE_SLACK = 1.1;

export function categoryStatus(amountCents, range, slack = 1) {
  if (!range) return 'none';
  const rm = amountCents / RM;
  const [lo, hi] = range;
  if (rm > hi * 1.5 && rm - hi > 100) return 'over';
  if (rm > hi * slack) return 'high';
  if (rm < lo && lo > 0) return 'lean';
  return 'ok';
}

/**
 * Compare a period's personal spending with the KL 24yo founder reference (a monthly figure).
 * The running period is a month at today's fixed items + recent day-to-day pace (spendingModel), per category
 * too. A finished period only partly covered (tracking began inside it) is projected to the whole period;
 * finished pay cycles are scaled to 30 days so they compare fairly with the monthly reference (`per30` on each row:
 * the figure its status was judged on). A period that ended before tracking started (`untracked`) holds only stray
 * entries: nothing in it is judged.
 */
export function evaluatePeriod({ txs, period: p, categories, profile, today, recurring = [], startDate = '' }) {
  const prof = normalizeProfile(profile);
  const ranges = categoryRanges(prof);
  const tiers = livingCostTiers(prof);
  const summary = periodSummary(txs, p, categories);
  const personal = personalByCategory(txs, p);
  const f = perMonthFactor(p);
  const isCurrent = !!today && today >= p.start && today <= p.end;
  const untracked = !!startDate && p.end < startDate;
  const from = startDate && startDate > p.start && startDate <= p.end ? startDate : p.start;
  const to = isCurrent ? today : p.end;
  const elapsed = Math.max(1, daysBetween(from, to) + 1) / p.days;
  const isPartial = elapsed < 1;

  // The running period is judged by a month of fixed items + recent pace (see spendingModel), for the total and
  // for every category alike; a finished period is judged by what it actually held.
  const model = isCurrent ? spendingModel({ txs, recurring, today, since: startDate }) : null;
  const monthlyOf = (id) => (model ? Math.round(model.byCategory.get(id) || 0) : null);

  // A finished period tracking began inside of: entries dated before that day (catch-up entries) count as they are,
  // like fixed costs — only what was spent on the tracked days is extrapolated.
  const early = new Map();
  if (!model && isPartial) {
    for (const t of txInPeriod(txs, p)) {
      if (t.type === 'expense' && !isBusiness(t) && t.date < from) early.set(analysisCategory(t), (early.get(analysisCategory(t)) || 0) + t.amount);
    }
  }

  const cats = categoryMap(categories);
  const rows = [];
  const seen = new Set();
  for (const c of categories) {
    if (c.type !== 'expense' || c.id === 'business') continue;
    const amount = personal.get(c.id) || 0;
    seen.add(c.id);
    if (!amount && c.archived) continue;
    const range = ranges[c.id] || null;
    const scaled = Math.round(amount * f);
    const monthly = monthlyOf(c.id);
    rows.push({
      categoryId: c.id, amount, range, monthly, per30: !model && f !== 1 ? scaled : null,
      status: untracked ? 'none'
        : model ? categoryStatus(monthly, range, ESTIMATE_SLACK)
          : isPartial ? partialStatus(scaled, range, elapsed, c.id, Math.round((early.get(c.id) || 0) * f))
            : categoryStatus(scaled, range),
    });
  }
  for (const [id, amount] of personal) {
    if (seen.has(id)) continue;
    rows.push({ categoryId: id, amount, range: null, status: 'none', monthly: monthlyOf(id), per30: !model && f !== 1 ? Math.round(amount * f) : null });
  }
  rows.sort((a, b) => b.amount - a.amount);

  // The living-cost verdict leaves insurance out (see analysisCategory); `insurance` is shown beside it.
  const personalTotal = summary.personal;
  const insured = personal.get('insurance') || 0;
  let projected = personalTotal;
  let perMonth;
  let insurance;
  if (model) {
    perMonth = model.personalMonthly - model.insurance;
    projected = model.personalMonthly;
    insurance = model.insurance;
  } else {
    // A finished period tracked only in part (tracking began inside it): fixed costs and entries from before tracking
    // began as they are, day-to-day spending of the tracked days extrapolated to the whole period.
    if (isPartial) {
      let asIs = 0;
      for (const t of txInPeriod(txs, p)) {
        if (t.type === 'expense' && !isBusiness(t) && (t.recurringId || t.categoryId === 'housing' || analysisCategory(t) === 'insurance' || t.date < from)) asIs += t.amount;
      }
      projected = Math.round(asIs + (personalTotal - asIs) / elapsed);
    }
    perMonth = Math.round((projected - insured) * f);
    insurance = Math.round(insured * f);
  }
  const tier = tierFor(perMonth / RM, tiers);

  return {
    ym: p.key, period: p, profile: prof, tiers, tier, tierLabel: TIER_LABELS[tier],
    personalTotal, projected, perMonth, insurance, normalized: !model && f !== 1, isCurrent, isPartial, untracked, elapsed, model,
    rows, summary, cats,
  };
}

export function evaluateMonth({ ym, ...rest }) {
  return evaluatePeriod({ ...rest, period: monthPeriod(ym) });
}

// While a month is in progress, only flag a category as high if it already exceeds the full-month range,
// or is on pace to exceed it by a wide margin (fixed costs like rent land early, so we stay gentle; bills in
// LUMP_SUM_CATEGORIES are never paced). `early`: the part spent before tracking began, which is not a pace either.
function partialStatus(amount, range, elapsed, categoryId, early = 0) {
  if (!range) return 'none';
  const full = categoryStatus(amount, range);
  if (full === 'high' || full === 'over') return full;
  if (elapsed >= 0.33 && !LUMP_SUM_CATEGORIES.has(categoryId)) {
    const pace = early + (amount - early) / elapsed;
    if (pace / RM > range[1] * 1.3 && pace / RM - range[1] > 100) return 'pace';
  }
  return 'ok';
}

/**
 * Personal runway in months: current savings ÷ what a month costs without any income —
 * every fixed item (personal and business, they keep being charged) + day-to-day spending at its recent
 * pace. One-off business spending isn't a monthly cost and is only reported. See spendingModel.
 */
export function runway({ txs, currentSavings, today, since = '', recurring = [], known = false }) {
  // `known`: the figure comes from a check of the money on hand (cashOnHand), so even 0 or less is an answer.
  if (!known && (!currentSavings || currentSavings <= 0)) return null;
  const m = spendingModel({ txs, recurring, today, since });
  const base = { target: RUNWAY_TARGET_MONTHS, fixed: m.fixedPersonal + m.fixedBusiness, variable: m.variableMonthly, days: m.days, oneOffBusiness: m.oneOffBusiness };
  if (!m.enough || m.totalMonthly <= 0) return { ...base, months: null, avg: 0, basis: '资料还不够' };
  return { ...base, months: Math.max(0, currentSavings) / m.totalMonthly, avg: m.totalMonthly, basis: `固定项目 + 近 ${m.days} 天的日常开销` };
}

/** Runway months as shown: rounded down to the tenth, so 5.96 reads "5.9", short of the 6-month line. */
export const runwayShown = (months) => (typeof months === 'number' ? Math.floor(months * 10 + 1e-9) / 10 : months);

/**
 * Where the running period is heading, so that its 结余 and 储蓄率 are not judged by the first few days (right after
 * payday all the income is in and little has gone out): what is in so far, + fixed income still due (under pay cycles
 * not a 薪水 / 创业收入 item due inside the pay window: that starts the next cycle), − fixed items still due
 * (expenses, business ones too — the same money — and rent paid by hand), − day-to-day spending at its recent pace
 * (spendingModel) for the `days` after today until the period ends. `soFar`: 收入 − 支出 to date. `model`: spendingModel
 * for today; `summary`: periodSummary of the period. Null without income (so far or due).
 */
export function periodOutlook({ txs, period: p, settings, today, recurring = [], model, summary }) {
  const cfg = p.kind === 'cycle' ? payCycle(settings) : null;
  const startsCycle = (r) => !!cfg && CYCLE_INCOME_CATEGORIES.includes(r.categoryId) && r.day >= cfg.from && r.day <= cfg.to;
  const incomeAhead = upcomingRecurring(recurring.filter((r) => !startsCycle(r)), today, p.end, 'income');
  const income = summary.income + incomeAhead;
  if (income <= 0) return null;
  const fixedAhead = upcomingRecurring(model.handRent ? [...recurring, model.handRent] : recurring, today, p.end, 'expense', txs);
  const days = daysBetween(today, p.end); // after today
  const dayToDay = Math.round(model.variableDaily * days);
  const net = summary.net + incomeAhead - fixedAhead - dayToDay;
  return { income, soFar: summary.net, incomeAhead, fixedAhead, days, dayToDay, net, rate: net / income, end: p.end };
}

/** Most repeated (category, amount, note) combos from the last 60 days → one-tap quick add. */
export function quickPicks(txs, today, limit = 6) {
  const cutoffISO = addDays(today, -60);
  const counts = new Map();
  for (const t of txs) {
    if (t.type !== 'expense' || t.recurringId || t.date < cutoffISO) continue;
    const note = (t.note || '').trim();
    const key = `${t.categoryId}|${t.amount}|${note}|${t.business ? 1 : 0}`;
    const e = counts.get(key) || { categoryId: t.categoryId, amount: t.amount, note, business: !!t.business, count: 0, last: '' };
    e.count += 1;
    if (t.date > e.last) e.last = t.date;
    counts.set(key, e);
  }
  return [...counts.values()]
    .filter((e) => e.count >= 2)
    .sort((a, b) => b.count - a.count || (a.last < b.last ? 1 : -1))
    .slice(0, limit);
}

/**
 * Plain-language insights for a month, most important first.
 * Each: { id, tone: 'good'|'warn'|'bad'|'info', icon, title, figure, body } — `id` stays the same for the same kind of
 * insight (the screen remembers which ones are unfolded), `figure` is the short number shown beside the title ('' for
 * none), `body` the explanation behind it.
 */
export function buildInsights({ txs, ym, period, categories, profile, settings, today, recurring = [] }) {
  const p = period || monthPeriod(ym);
  const since = trackingStart(settings, txs);
  const ev = evaluatePeriod({ txs, period: p, categories, profile, today, recurring, startDate: since });
  const cmp = comparePeriods(txs, p, prevPeriod(p, { txs, settings, today }), categories, since, today, recurring);
  const cycle = p.kind === 'cycle';
  const THIS = cycle ? '本期' : '本月';
  const LAST = cycle ? '上一期' : '上个月';
  const s = ev.summary;
  const cats = ev.cats;
  const name = (id) => cats.get(id)?.name || '未分类';
  const has = (v) => v !== null && v !== undefined;
  // A category's figure as judged: a month's estimate while the period runs, per 30 days for a finished pay cycle.
  const figure = (r) => (has(r.monthly) ? r.monthly : has(r.per30) ? r.per30 : r.amount);
  const figureText = (r) => `${formatMoney(figure(r), { round: true })}${has(r.monthly) ? '／月' : has(r.per30) ? '／30 天' : ''}`;
  const out = [];

  if (ev.untracked) {
    return [{
      id: 'untracked', tone: 'info', icon: 'calendar', title: `${cycle ? '这一期' : '这个月'}在开始记账之前`, figure: '',
      body: `从 ${dayLabel(since, today)}才开始记账，这段时间只有零星几笔记录（例如固定项目自动记上的），所以这里不评估生活费和储蓄率。`,
    }];
  }
  if (s.count === 0) {
    return [{ id: 'empty', tone: 'info', icon: 'sparkles', title: cycle ? '这一期还没有记录' : '这个月还没有记录', figure: '', body: `每天花几秒记一笔，${cycle ? '这一期结束时' : '月底'}这里就会告诉你钱都去了哪里。` }];
  }

  // 1. Overall verdict vs KL reference
  const [lean, okMax, highMax] = ev.tiers;
  const rangeText = `RM ${lean.toLocaleString('en-MY')} – ${okMax.toLocaleString('en-MY')}`;
  const per30 = ev.normalized ? '（按 30 天换算）' : '';
  const flagged = ev.rows.filter((r) => r.status === 'high' || r.status === 'over' || r.status === 'pace');
  // Categories without a reference range (added by hand) are never flagged — which doesn't make them "in range".
  const unranged = ev.rows.filter((r) => !r.range && r.categoryId !== 'insurance' && figure(r) > 0).sort((a, b) => figure(b) - figure(a));
  const insuranceText = ev.insurance > 0 ? `（保险 ${formatMoney(ev.insurance, { round: true })}${ev.model ? '／月' : ''}另计）` : '';
  const amountText = ev.model
    ? `按固定项目加上近 ${ev.model.days} 天的日常开销，每月个人生活费约 ${formatMoney(ev.perMonth, { round: true })}${insuranceText}${ev.model.steady ? '' : `（才记了 ${ev.model.days} 天，仅供参考）`}`
    : ev.isPartial
      ? `按记录天数推算，${THIS}个人生活费约 ${formatMoney(ev.perMonth, { round: true })}${per30}${insuranceText}`
      : `${THIS}个人生活费 ${formatMoney(ev.perMonth, { round: true })}${per30}${insuranceText}`;
  const verdict = {
    lean: { tone: 'good', title: '生活费很精简', extra: '低于 EPF 合理生活标准。省钱很好，但别省到影响吃饭、健康和工作效率。' },
    ok: { tone: 'good', title: '生活费在合理范围', extra: '符合吉隆坡 24 岁单身创业者的合理水平。' },
    high: { tone: 'warn', title: '生活费偏高', extra: flagged.length
      ? '超过合理上限，建议先从下面标黄的类别开始收一收。'
      : unranged.length
        ? `有参考区间的类别都还在区间内，超出的部分主要来自没有参考区间的${name(unranged[0].categoryId)}（${figureText(unranged[0])}），先看看这一项能不能减少。`
        : '每个类别都还在参考区间内，是加起来超过了上限，可以先检视金额最大的固定开销（房租、订阅）。' },
    over: { tone: 'bad', title: '生活费明显过高', extra: `已超过 RM ${highMax.toLocaleString('en-MY')}，对创业期来说压力很大，建议马上检视。` },
  }[ev.tier];
  out.push({
    id: 'verdict', tone: verdict.tone, icon: 'target', title: verdict.title,
    figure: `${formatMoney(ev.perMonth, { round: true })}${ev.model ? '／月' : ev.normalized ? '／30 天' : ''}`,
    body: `${amountText}。吉隆坡同龄创业者合理区间 ${rangeText}。${verdict.extra}`,
  });

  // 2. Savings rate vs target. While the period runs it is judged by where it is heading (periodOutlook), not by
  // the first few days.
  const outlook = ev.model ? periodOutlook({ txs, period: p, settings, today, recurring, model: ev.model, summary: s }) : null;
  const income = outlook ? outlook.income : s.income;
  if (income > 0) {
    let net = s.net;
    let body;
    if (outlook) {
      net = outlook.net;
      body = `${THIS}收入 ${formatMoney(s.income, { round: true })}${outlook.incomeAhead ? `，另有固定收入 ${formatMoney(outlook.incomeAhead, { round: true })} 还没到` : ''}，目前已花 ${formatMoney(s.expense, { round: true })}。按目前速度，到 ${dayLabel(p.end, today)}预计结余 ${formatMoney(net, { round: true })}，储蓄率约 ${formatPercent(net / income)}。`;
    } else {
      // 结余 as the 分析 overview shows it: 收入 − 支出 in whole ringgit.
      body = `收入 ${formatMoney(s.income, { round: true })}，结余 ${formatMoney(roundedRest(s.income, s.expense), { round: true })}，储蓄率 ${formatPercent(net / s.income)}。`;
    }
    const rate = net / income;
    const target = settings.savingsTarget || 0;
    let tone = 'good', title = outlook ? '预计储蓄率健康' : '储蓄率健康';
    if (rate < 0) { tone = 'bad'; title = outlook ? `${THIS}预计入不敷出` : `${THIS}入不敷出`; }
    else if (rate < SAVINGS_RATE_OK) { tone = 'warn'; title = outlook ? '预计储蓄率偏低' : '储蓄率偏低'; }
    else if (rate < SAVINGS_RATE_GOOD) { tone = 'info'; title = outlook ? '预计储蓄率还可以' : '储蓄率还可以'; }
    body += rate >= SAVINGS_RATE_GOOD ? '创业期能存下 20% 以上很不容易，继续保持。' : '创业期建议至少存下收入的 20%。';
    const EACH = cycle ? '每期' : '每月';
    if (target > 0) {
      // Short of the target by all of it plus whatever the period runs short.
      body += net >= target
        ? ` ${outlook ? '预计可以达成' : '已达成'}${EACH}存款目标 ${formatMoney(target, { round: true })}。`
        : ` ${outlook ? '预计' : ''}距离${EACH}存款目标 ${formatMoney(target, { round: true })} 还差 ${formatMoney(target - net, { round: true })}。`;
    }
    out.push({ id: 'savings', tone, icon: 'savings', title, figure: formatPercent(rate), body });
  } else if (ev.isCurrent) {
    out.push({ id: 'savings', tone: 'info', icon: 'salary', title: `还没记录${THIS}收入`, figure: '', body: '记下收入后，才能算出储蓄率和存款目标的进度。' });
  }

  // 3. Categories above range
  for (const r of flagged.slice(0, 3)) {
    const [lo, hi] = r.range;
    // Running period: a month's estimate, like the verdict above; finished pay cycle: per 30 days, like its badge.
    const basis = has(r.monthly) ? '（按固定项目加上近期开销推算）' : has(r.per30) ? '（按 30 天换算）' : '';
    const over = r.status === 'pace'
      ? `照这个速度，${cycle ? '这一期结束时' : '月底'}会超过参考上限 RM ${hi}`
      : `超过参考区间 RM ${lo} – ${hi}${basis}`;
    out.push({
      id: `cat-${r.categoryId}`, tone: r.status === 'over' ? 'bad' : 'warn', icon: cats.get(r.categoryId)?.icon || 'other',
      title: `${name(r.categoryId)}${r.status === 'pace' ? '快超出了' : r.status === 'over' ? '过高' : '偏高'}`,
      figure: figureText(r),
      body: `${over}。${categoryTip(r.categoryId)}`,
    });
  }

  // 4. Change against the period before (personal spending, see comparePeriods). Signs follow the rounded figures
  // shown: under RM 0.50 is no change.
  if (cmp.comparable && cmp.previous.expense > 0) {
    const flat = Math.round(Math.abs(cmp.delta) / RM) === 0;
    const up = !flat && cmp.delta > 0;
    const biggest = cmp.rows[0];
    const diff = `${up ? '多' : '少'} ${formatMoney(Math.abs(cmp.delta), { round: true })}`;
    let body = cmp.sameDays
      ? `${THIS}前 ${cmp.sameDays} 天的日常开销${flat ? `和${LAST}同期持平` : `比${LAST}同期${diff}`}`
      : `个人支出${flat ? `和${LAST}持平` : `比${LAST}${diff}`}${cmp.normalized ? '（按 30 天换算）' : ''}`;
    if (cmp.ratio !== null && !flat) body += `（${formatPercent(cmp.ratio, 0, { sign: true })}）`;
    if (biggest && Math.abs(biggest.delta) >= 50 * RM) {
      body += `，变化最大的是${name(biggest.categoryId)}（${biggest.delta > 0 ? '+' : '−'}${formatMoney(Math.abs(biggest.delta), { round: true })}）`;
    }
    body += cmp.dayToDay ? `。固定项目和创业投入不算在内；${THIS}还没结束，仅供参考。` : '。创业投入不算在内。';
    out.push({
      id: 'compare', tone: up && !ev.isCurrent && cmp.ratio > 0.15 ? 'warn' : 'info', icon: flat ? 'check' : up ? 'trendUp' : 'trendDown',
      title: cycle ? '与上一期相比' : '与上月相比',
      figure: flat ? '持平' : formatMoney(cmp.delta, { round: true, sign: true }),
      body,
    });
  }

  // 5. Needs vs wants balance — while the period runs, on the same monthly estimate as the verdict above
  const personal = s.personal;
  const shares = { need: s.byGroup.need, want: s.byGroup.want };
  let base = personal;
  if (ev.model) {
    shares.need = 0;
    shares.want = 0;
    for (const [id, v] of ev.model.byCategory) {
      const g = cats.get(id)?.group;
      if (g === 'need' || g === 'want') shares[g] += v;
    }
    base = ev.model.personalMonthly;
  }
  if (base > 0) {
    const wants = shares.want / base;
    const needs = shares.need / base;
    const est = ev.model ? '按每月估算，' : '';
    if (wants > WANTS_SHARE_MAX + 0.1) {
      out.push({ id: 'balance', tone: 'warn', icon: 'shopping', title: '享受型开销占比偏高', figure: formatPercent(wants), body: `${est}购物、娱乐、订阅${ev.model ? '约' : ''}占个人开销 ${formatPercent(wants)}，建议控制在 ${formatPercent(WANTS_SHARE_MAX)} 以内。` });
    } else if (needs > 0 && needs <= NEEDS_SHARE_MAX && wants <= WANTS_SHARE_MAX) {
      out.push({ id: 'balance', tone: 'good', icon: 'check', title: '开销结构平衡', figure: '', body: `${est}必要开销 ${formatPercent(needs)}，享受型开销 ${formatPercent(wants)}，比例健康。` });
    }
  }

  // 6. Business spending share
  if (s.business > 0) {
    const share = s.expense > 0 ? s.business / s.expense : 0;
    out.push({
      id: 'business', tone: 'info', icon: 'business', title: '创业投入', figure: formatMoney(s.business, { round: true }),
      body: `占${THIS}总支出 ${formatPercent(share)}。这部分不算进生活费评估，${settings.budgetIncludesBusiness
        ? `但钱确实花出去了，所以「今天还能花」会把它算进${THIS}预算（「设置 → 每月计划」可以关掉）`
        : '也不占「今天还能花」（「设置 → 每月计划」可以改）'}；记得保留单据，公司有钱时可以报销或作为股东贷款记录。`,
    });
  }

  // 7. Uncategorised
  const other = personalByCategory(txs, p).get('other') || 0;
  if (personal > 0 && other / personal > 0.1 && other > 100 * RM) {
    out.push({ id: 'other', tone: 'info', icon: 'other', title: '「其他」有点多', figure: formatMoney(other, { round: true }), body: `有 ${formatMoney(other, { round: true })} 记在「其他」。分到具体类别，分析会更准确。` });
  }

  return out;
}

function categoryTip(id) {
  return {
    food: '外卖和咖啡最容易累积，试试一周带几次饭或多吃 hawker / mamak。',
    groceries: '列清单再去超市，少买临时想要的东西。',
    transport: '经常 Grab 的话，考虑 My50 地铁无限次卡（RM50／月）。',
    housing: '租金超过收入 30% 会压缩创业资金，合约到期时可以考虑合租。',
    utilities: '检查手机和网络配套是否过高，冷气用电是大头。',
    health: '保险和健身是好投资，但确认没有重复购买。',
    family: '家庭支出很重要，可以和家人约定固定金额，方便规划。',
    shopping: '想买的东西先放进清单等 7 天，还想要再买。',
    social: '聚会可以轮流选便宜一点的地方，或和朋友 AA。',
    subscriptions: '检查有没有忘记取消的订阅。',
    learning: '投资自己很值得，确认每一笔都有实际用上。',
    other: '把「其他」里的开销分到具体类别，更容易找到省钱点。',
  }[id] || '看看这个类别里有没有可以减少的项目。';
}
