// Pure analysis functions. No DOM, no storage — safe to unit test in Node.
import { addDays, addMonths, dateInMonth, monthOf, monthRange } from './dates.js';
import { daysBetween, inPeriod, monthPeriod, periodFor, prevPeriod } from './periods.js';
import { categoryMap } from './categories.js';
import {
  categoryRanges, livingCostTiers, normalizeProfile, TIER_LABELS,
  SAVINGS_RATE_GOOD, SAVINGS_RATE_OK, NEEDS_SHARE_MAX, WANTS_SHARE_MAX, RUNWAY_TARGET_MONTHS,
} from './benchmarks.js';
import { formatMoney, formatPercent } from './money.js';

const RM = 100; // cents per ringgit

export function isBusiness(tx) {
  return tx.type === 'expense' && (tx.business === true || tx.categoryId === 'business');
}

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
    byCategory.set(t.categoryId, (byCategory.get(t.categoryId) || 0) + t.amount);
    if (isBusiness(t)) { business += t.amount; byGroup.business += t.amount; continue; }
    const g = cats.get(t.categoryId)?.group;
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
    out.set(t.categoryId, (out.get(t.categoryId) || 0) + t.amount);
  }
  return out;
}

/** Recurring expenses still to come after `today` up to `end` (default: end of this month), not yet generated. */
export function upcomingRecurring(recurring = [], today, end = '') {
  const last = end || dateInMonth(monthOf(today), 31);
  let sum = 0;
  for (const r of recurring) {
    if (!r.active || r.type !== 'expense') continue;
    for (const m of monthRange(monthOf(today), monthOf(last))) {
      if (r.lastMonth && r.lastMonth >= m) continue;
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
 * month's rent, already paid) keep the setup date. Entries made by fixed items never count.
 */
export function trackingStart(settings, txs) {
  const setup = settings?.startDate || '';
  if (!setup) return '';
  const days = new Set();
  let earliest = setup;
  for (const t of txs) {
    if (t.recurringId || t.date >= setup) continue;
    days.add(t.date);
    if (t.date < earliest) earliest = t.date;
  }
  return days.size >= 3 ? earliest : setup;
}

/**
 * Budget for the current period (calendar month, or pay cycle when set): how much can be spent in total
 * and today. budget = income basis − savings target; income basis = expected income, or actual income
 * in the period if not set.
 */
export function dailyBudget({ txs, settings, recurring = [], today }) {
  const p = periodFor(today, { txs, settings });
  const dim = p.days;
  const day = daysBetween(p.start, today) + 1;
  const daysLeft = daysBetween(today, p.end) + 1;
  const s = periodSummary(txs, p);
  const expected = settings.expectedIncome || 0;
  const incomeBasis = expected > 0 ? expected : s.income;
  const target = settings.savingsTarget || 0;
  const hasPlan = incomeBasis > 0;
  let budget = Math.max(0, incomeBasis - target);
  // Started tracking in the middle of the period: only the remaining part of the budget applies.
  const start = trackingStart(settings, txs);
  const prorated = !!start && start > p.start && start <= p.end && expected > 0;
  if (prorated) budget = Math.round((budget * (daysBetween(start, p.end) + 1)) / dim);

  let spentToday = 0;
  let spentMonth = 0;
  for (const t of txInPeriod(txs, p)) {
    if (t.type !== 'expense') continue;
    if (t.date === today) spentToday += t.amount;
    // With a prorated budget, spending from before tracking started belongs to the unbudgeted part.
    if (!prorated || t.date >= start) spentMonth += t.amount;
  }
  const spentBefore = spentMonth - spentToday;
  const reserved = upcomingRecurring(recurring, today, p.end);
  const remainingAtStart = budget - spentBefore - reserved;
  const allowanceToday = Math.floor(remainingAtStart / daysLeft);
  const leftToday = allowanceToday - spentToday;
  const leftMonth = budget - spentMonth - reserved;
  const tracked = prorated ? daysBetween(start, p.end) + 1 : dim;

  return {
    ym: p.key, period: p, hasPlan, incomeBasis, usesExpected: expected > 0, budget, target, prorated, startDate: start,
    spentToday, spentMonth, reserved, daysLeft, dim, day,
    allowanceToday, leftToday, leftMonth,
    usedRatio: budget > 0 ? (spentMonth + reserved) / budget : 0,
    monthProgress: (tracked - daysLeft + 1) / tracked,
    incomeMonth: s.income,
    savedMonth: s.net,
    status: !hasPlan ? 'none' : leftToday >= 0 ? 'ok' : leftMonth >= 0 ? 'overToday' : 'overMonth',
  };
}

/** Totals per period for the trend chart: [{ ym, key, label, short, income, expense, personal, business }]. */
export function trendPeriods(txs, periods) {
  return periods.map((p) => {
    const r = { ym: p.key, key: p.key, label: p.label, short: p.short, income: 0, expense: 0, personal: 0, business: 0 };
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

/** Category comparison between a period and the one before it (amounts per 30 days for pay cycles). */
export function comparePeriods(txs, p, prev, categories, since = '') {
  // A period before tracking started only holds stray entries — comparing with it is meaningless.
  const comparable = !since || prev.end >= since;
  const cur = periodSummary(txs, p, categories);
  const old = periodSummary(txs, prev, categories);
  const fa = perMonthFactor(p);
  const fb = perMonthFactor(prev);
  const ids = new Set([...cur.byCategory.keys(), ...old.byCategory.keys()]);
  const rows = [...ids].map((id) => {
    const a = Math.round((cur.byCategory.get(id) || 0) * fa);
    const b = Math.round((old.byCategory.get(id) || 0) * fb);
    return { categoryId: id, current: a, previous: b, delta: a - b, ratio: b > 0 ? (a - b) / b : null };
  }).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const a = Math.round(cur.expense * fa);
  const b = Math.round(old.expense * fb);
  return {
    ym: p.key, prevYm: prev.key, period: p, prevPeriod: prev, current: cur, previous: old, rows, comparable,
    normalized: fa !== 1 || fb !== 1,
    delta: a - b,
    ratio: b > 0 ? (a - b) / b : null,
  };
}

/** Category comparison between month ym and the previous month. */
export function compareMonths(txs, ym, categories, since = '') {
  return comparePeriods(txs, monthPeriod(ym), monthPeriod(addMonths(ym, -1)), categories, since);
}

function tierFor(amountRM, tiers) {
  if (amountRM < tiers[0]) return 'lean';
  if (amountRM <= tiers[1]) return 'ok';
  if (amountRM <= tiers[2]) return 'high';
  return 'over';
}

export function categoryStatus(amountCents, range) {
  if (!range) return 'none';
  const rm = amountCents / RM;
  const [lo, hi] = range;
  if (rm > hi * 1.5 && rm - hi > 100) return 'over';
  if (rm > hi) return 'high';
  if (rm < lo && lo > 0) return 'lean';
  return 'ok';
}

/**
 * Compare a period's personal spending with the KL 24yo founder reference (a monthly figure).
 * A period only partly covered (in progress, or the one tracking started in) is projected to the whole
 * period; pay cycles are then scaled to 30 days so they compare fairly with the monthly reference.
 */
export function evaluatePeriod({ txs, period: p, categories, profile, today, recurring = [], startDate = '' }) {
  const prof = normalizeProfile(profile);
  const ranges = categoryRanges(prof);
  const tiers = livingCostTiers(prof);
  const summary = periodSummary(txs, p, categories);
  const personal = personalByCategory(txs, p);
  const f = perMonthFactor(p);
  const isCurrent = !!today && today >= p.start && today <= p.end;
  const from = startDate && startDate > p.start && startDate <= p.end ? startDate : p.start;
  const to = isCurrent ? today : p.end;
  const elapsed = Math.max(1, daysBetween(from, to) + 1) / p.days;
  const isPartial = elapsed < 1;

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
    rows.push({
      categoryId: c.id, amount, range,
      status: isPartial ? partialStatus(scaled, range, elapsed, c.id) : categoryStatus(scaled, range),
    });
  }
  for (const [id, amount] of personal) {
    if (seen.has(id)) continue;
    rows.push({ categoryId: id, amount, range: null, status: 'none' });
  }
  rows.sort((a, b) => b.amount - a.amount);

  const personalTotal = summary.personal;
  // Fixed costs (rent, recurring items) are not extrapolated; only day-to-day spending is.
  let projected = personalTotal;
  if (isPartial) {
    let fixed = 0;
    for (const t of txInPeriod(txs, p)) {
      if (t.type === 'expense' && !isBusiness(t) && (t.recurringId || t.categoryId === 'housing')) fixed += t.amount;
    }
    const upcoming = isCurrent ? upcomingRecurring(recurring.filter((r) => !r.business && r.categoryId !== 'business'), today, p.end) : 0;
    projected = Math.round(fixed + (personalTotal - fixed) / elapsed + upcoming);
  }
  const perMonth = Math.round(projected * f);
  const tier = tierFor(perMonth / RM, tiers);

  return {
    ym: p.key, period: p, profile: prof, tiers, tier, tierLabel: TIER_LABELS[tier],
    personalTotal, projected, perMonth, normalized: f !== 1, isCurrent, isPartial, elapsed,
    rows, summary, cats,
  };
}

export function evaluateMonth({ ym, ...rest }) {
  return evaluatePeriod({ ...rest, period: monthPeriod(ym) });
}

// While a month is in progress, only flag a category as high if it already exceeds the full-month range,
// or is on pace to exceed it by a wide margin (fixed costs like rent land early, so we stay gentle).
const LUMP_SUM_CATEGORIES = new Set(['housing', 'utilities', 'subscriptions', 'family', 'health', 'learning']);

function partialStatus(amount, range, elapsed, categoryId) {
  if (!range) return 'none';
  const full = categoryStatus(amount, range);
  if (full === 'high' || full === 'over') return full;
  if (elapsed >= 0.33 && !LUMP_SUM_CATEGORIES.has(categoryId)) {
    const pace = amount / elapsed;
    if (pace / RM > range[1] * 1.3 && pace / RM - range[1] > 100) return 'pace';
  }
  return 'ok';
}

/**
 * Personal runway in months: current savings ÷ average spending per month.
 * Average of the last up-to-3 complete, fully tracked periods (pay cycles counted per 30 days);
 * without one, the current period's pace — fixed costs as they are, day-to-day spending extrapolated.
 */
export function runway({ txs, currentSavings, today, since = '', settings = null, recurring = [] }) {
  if (!currentSavings || currentSavings <= 0) return null;
  const ctx = { txs, settings };
  const cur = periodFor(today, ctx);
  const cycle = cur.kind === 'cycle';
  const done = [];
  let p = cur;
  for (let i = 0; i < 3; i += 1) {
    p = prevPeriod(p, ctx);
    if (since && p.start < since) break; // only fully tracked periods
    const s = periodSummary(txs, p);
    if (s.expense > 0) done.push({ expense: s.expense, days: p.days });
  }
  let avg;
  let basis;
  if (done.length) {
    avg = cycle
      ? (done.reduce((a, d) => a + d.expense, 0) / done.reduce((a, d) => a + d.days, 0)) * 30
      : done.reduce((a, d) => a + d.expense, 0) / done.length;
    basis = cycle ? `近 ${done.length} 个收入周期平均（按 30 天）` : `近 ${done.length} 个月平均`;
  } else {
    const from = since && since > cur.start ? since : cur.start;
    const elapsedDays = daysBetween(from, today) + 1;
    const length = daysBetween(from, cur.end) + 1;
    if (elapsedDays / length < 0.2) return { months: null, avg: 0, basis: '资料还不够' };
    let fixed = 0;
    let variable = 0;
    for (const t of txInPeriod(txs, cur)) {
      if (t.type !== 'expense' || t.date < from || t.date > today) continue;
      if (t.recurringId || t.categoryId === 'housing') fixed += t.amount; else variable += t.amount;
    }
    if (!fixed && !variable) return { months: null, avg: 0, basis: '资料还不够' };
    const whole = fixed + (variable / elapsedDays) * length + upcomingRecurring(recurring, today, cur.end);
    avg = cycle ? whole * (30 / length) : whole;
    basis = cycle ? '按本期进度推算（按 30 天）' : '按本月进度推算';
  }
  return { months: avg > 0 ? currentSavings / avg : null, avg: Math.round(avg), basis, target: RUNWAY_TARGET_MONTHS };
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
 * Each: { tone: 'good'|'warn'|'bad'|'info', icon, title, body }
 */
export function buildInsights({ txs, ym, period, categories, profile, settings, today, recurring = [] }) {
  const p = period || monthPeriod(ym);
  const since = trackingStart(settings, txs);
  const ev = evaluatePeriod({ txs, period: p, categories, profile, today, recurring, startDate: since });
  const cmp = comparePeriods(txs, p, prevPeriod(p, { txs, settings }), categories, since);
  const cycle = p.kind === 'cycle';
  const THIS = cycle ? '本期' : '本月';
  const LAST = cycle ? '上一期' : '上个月';
  const s = ev.summary;
  const cats = ev.cats;
  const name = (id) => cats.get(id)?.name || '未分类';
  const out = [];

  if (s.count === 0) {
    return [{ tone: 'info', icon: 'sparkles', title: cycle ? '这一期还没有记录' : '这个月还没有记录', body: `每天花几秒记一笔，${cycle ? '这一期结束时' : '月底'}这里就会告诉你钱都去了哪里。` }];
  }

  // 1. Overall verdict vs KL reference
  const [lean, okMax, highMax] = ev.tiers;
  const rangeText = `RM ${lean.toLocaleString('en-MY')} – ${okMax.toLocaleString('en-MY')}`;
  const per30 = ev.normalized ? '（按 30 天换算）' : '';
  const amountText = ev.isPartial
    ? `按目前进度，${THIS}个人生活费预计约 ${formatMoney(ev.perMonth, { round: true })}${per30}`
    : `${THIS}个人生活费 ${formatMoney(ev.perMonth, { round: true })}${per30}`;
  const verdict = {
    lean: { tone: 'good', title: '生活费很精简', extra: '低于 EPF 合理生活标准。省钱很好，但别省到影响吃饭、健康和工作效率。' },
    ok: { tone: 'good', title: '生活费在合理范围', extra: '符合吉隆坡 24 岁单身创业者的合理水平。' },
    high: { tone: 'warn', title: '生活费偏高', extra: `超过合理上限，建议先从下面标黄的类别开始收一收。` },
    over: { tone: 'bad', title: '生活费明显过高', extra: `已超过 RM ${highMax.toLocaleString('en-MY')}，对创业期来说压力很大，建议马上检视。` },
  }[ev.tier];
  out.push({ tone: verdict.tone, icon: 'target', title: verdict.title, body: `${amountText}。吉隆坡同龄创业者合理区间 ${rangeText}。${verdict.extra}` });

  // 2. Savings rate vs target
  if (s.income > 0) {
    const rate = s.savingsRate;
    const target = settings.savingsTarget || 0;
    let tone = 'good', title = '储蓄率健康';
    if (rate < 0) { tone = 'bad'; title = `${THIS}入不敷出`; }
    else if (rate < SAVINGS_RATE_OK) { tone = 'warn'; title = '储蓄率偏低'; }
    else if (rate < SAVINGS_RATE_GOOD) { tone = 'info'; title = '储蓄率还可以'; }
    let body = `收入 ${formatMoney(s.income, { round: true })}，结余 ${formatMoney(s.net, { round: true })}，储蓄率 ${formatPercent(rate)}。`;
    body += rate >= SAVINGS_RATE_GOOD ? '创业期能存下 20% 以上很不容易，继续保持。' : '创业期建议至少存下收入的 20%。';
    if (target > 0) body += s.net >= target ? ` 已达成${cycle ? '每期' : '每月'}存款目标 ${formatMoney(target, { round: true })}。` : ` 距离每月存款目标还差 ${formatMoney(target - Math.max(0, s.net), { round: true })}。`;
    out.push({ tone, icon: 'savings', title, body });
  } else if (ev.isCurrent) {
    out.push({ tone: 'info', icon: 'salary', title: `还没记录${THIS}收入`, body: '记下收入后，才能算出储蓄率和存款目标的进度。' });
  }

  // 3. Categories above range
  const flagged = ev.rows.filter((r) => r.status === 'high' || r.status === 'over' || r.status === 'pace');
  for (const r of flagged.slice(0, 3)) {
    const [lo, hi] = r.range;
    const over = r.status === 'pace'
      ? `照这个速度，${cycle ? '这一期结束时' : '月底'}会超过参考上限 RM ${hi}`
      : `超过参考区间 RM ${lo} – ${hi}`;
    out.push({
      tone: r.status === 'over' ? 'bad' : 'warn', icon: cats.get(r.categoryId)?.icon || 'other',
      title: `${name(r.categoryId)} ${formatMoney(r.amount, { round: true })}`,
      body: `${over}。${categoryTip(r.categoryId)}`,
    });
  }

  // 4. Month-over-month change
  if (cmp.comparable && cmp.previous.expense > 0) {
    const up = cmp.delta > 0;
    const biggest = cmp.rows[0];
    let body = `总支出比${LAST}${up ? '多' : '少'} ${formatMoney(Math.abs(cmp.delta), { round: true })}${cmp.normalized ? '（按 30 天换算）' : ''}`;
    if (cmp.ratio !== null) body += `（${up ? '+' : '−'}${formatPercent(Math.abs(cmp.ratio))}）`;
    if (biggest && Math.abs(biggest.delta) >= 50 * RM) {
      body += `，变化最大的是${name(biggest.categoryId)}（${biggest.delta > 0 ? '+' : '−'}${formatMoney(Math.abs(biggest.delta), { round: true })}）`;
    }
    body += ev.isCurrent ? `。${THIS}还没结束，仅供参考。` : '。';
    out.push({ tone: up && !ev.isCurrent && cmp.ratio > 0.15 ? 'warn' : 'info', icon: up ? 'trendUp' : 'trendDown', title: cycle ? '与上一期相比' : '与上月相比', body });
  }

  // 5. Needs vs wants balance
  const personal = s.personal;
  if (personal > 0) {
    const wants = s.byGroup.want / personal;
    const needs = s.byGroup.need / personal;
    if (wants > WANTS_SHARE_MAX + 0.1) {
      out.push({ tone: 'warn', icon: 'shopping', title: '享受型开销占比偏高', body: `购物、娱乐、订阅占个人开销 ${formatPercent(wants)}，建议控制在 ${formatPercent(WANTS_SHARE_MAX)} 以内。` });
    } else if (needs > 0 && needs <= NEEDS_SHARE_MAX && wants <= WANTS_SHARE_MAX) {
      out.push({ tone: 'good', icon: 'check', title: '开销结构平衡', body: `必要开销 ${formatPercent(needs)}，享受型开销 ${formatPercent(wants)}，比例健康。` });
    }
  }

  // 6. Business spending share
  if (s.business > 0) {
    const share = s.expense > 0 ? s.business / s.expense : 0;
    out.push({
      tone: 'info', icon: 'business', title: `创业投入 ${formatMoney(s.business, { round: true })}`,
      body: `占${THIS}总支出 ${formatPercent(share)}。这部分不算进生活费评估；记得保留单据，公司有钱时可以报销或作为股东贷款记录。`,
    });
  }

  // 7. Uncategorised
  const other = personalByCategory(txs, p).get('other') || 0;
  if (personal > 0 && other / personal > 0.1 && other > 100 * RM) {
    out.push({ tone: 'info', icon: 'other', title: '「其他」有点多', body: `有 ${formatMoney(other, { round: true })} 记在「其他」。分到具体类别，分析会更准确。` });
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
