// 分析 → how the running period is going, as one card: spent against the budget, a bar for every day, and where the
// balance is heading. (今天 only shows what today may still spend; this is the rest of that picture.)
import { html, icon, facts } from '../html.js';
import { progress, dayBars } from '../charts.js';
import {
  dailyBudget, periodOutlook, periodSummary, spendingModel, trackingStart, txInPeriod, isBusiness,
} from '../../core/analysis.js';
import { paidByHand } from '../../core/recurring.js';
import { infoButton, infoPanel } from '../info.js';
import { formatMoney, formatPercent } from '../../core/money.js';
import { addDays, dayLabel } from '../../core/dates.js';

const md = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

/** Day-to-day spending for every day of the period (fixed items left out: they are set aside, not a day's doing). */
function daySeries(state, b, today) {
  const p = b.period;
  const fixed = new Set([...paidByHand(state.transactions, state.recurring).values()].map((t) => t.id));
  const sums = new Map();
  for (const t of txInPeriod(state.transactions, p)) {
    if (t.type !== 'expense' || t.recurringId || fixed.has(t.id)) continue;
    if (isBusiness(t) && !b.countsBusiness) continue;
    sums.set(t.date, (sums.get(t.date) || 0) + t.amount);
  }
  const out = [];
  for (let d = p.start, n = 0; d <= p.end && n < 62; d = addDays(d, 1), n += 1) {
    out.push({ date: d, value: sums.get(d) || 0, state: d < today ? 'past' : d === today ? 'today' : 'future' });
  }
  return out;
}

/** The card. `cash`: the money on hand (cashOnHand), or null. */
export function periodCard({ state, today, cash = null }) {
  const { transactions: txs, settings, recurring } = state;
  const b = dailyBudget({ txs, settings, recurring, today, cash });
  // 结余 is shown where the period is heading: right after payday the income is all in and little is out.
  const model = spendingModel({ txs, recurring, today, since: trackingStart(settings, txs) });
  const outlook = b.hasPlan ? periodOutlook({ txs, period: b.period, settings, today, recurring, model, summary: periodSummary(txs, b.period) }) : null;
  const THIS = b.period.kind === 'cycle' ? '本期' : '本月';
  const bizOutside = !b.countsBusiness && b.spentBusiness > 0; // business spending is tracked but not part of the budget
  const target = settings.savingsTarget;
  const saved = outlook ? outlook.net : b.savedMonth;
  const saveRatio = target > 0 ? Math.max(0, saved) / target : 0;
  // A plan can leave RM 0 to spend (savings target = income): then any spending is over it.
  const spendRatio = b.budget > 0 ? b.spentMonth / b.budget : b.hasPlan && b.spentMonth > 0 ? Infinity : 0;
  const spendTone = spendRatio > 1 ? 'over' : 'spend';
  const spendSub = !b.hasPlan ? '未设定预算' : b.budget > 0 ? `预算的 ${formatPercent(spendRatio)}` : `预算为 RM 0${b.spentMonth > 0 ? ' · 已超出' : ''}`;
  const cashLimit = b.limit === 'cash';
  const overPeriod = b.status === 'overMonth';
  const days = daySeries(state, b, today);
  const todayAt = days.findIndex((d) => d.state === 'today');
  return html`<section class="card period">
    <div class="period__head">
      <span class="period__title">${THIS}预算<span class="period__range">${md(b.period.start)} – ${md(b.period.end)}</span></span>
      <span class="period__left">还有 ${b.daysLeft} 天</span>
    </div>

    <div class="period__spend" data-tone="${spendTone}">
      <div class="period__figure">
        <span class="period__label">${bizOutside ? `${THIS}个人支出` : `${THIS}支出`}</span>
        <span class="period__value" data-motion="count" data-motion-key="spent" data-value="${b.spentMonth}">${formatMoney(b.spentMonth, { round: true })}</span>
      </div>
      <span class="period__sub">${facts(spendSub, bizOutside ? `另有创业 ${formatMoney(b.spentBusiness, { round: true })}` : '')}</span>
    </div>
    ${b.hasPlan ? html`${progress({ ratio: b.usedRatio, marker: b.monthProgress, tone: overPeriod || spendTone === 'over' ? 'bad' : 'spend', label: `${THIS}预算使用`, key: 'period' })}
      <div class="period__foot">
        <span>${overPeriod
          ? (cashLimit ? html`还要付的固定支出 <strong>${formatMoney(b.reservedAll, { round: true })}</strong>` : html`${THIS}预算 <strong>${formatMoney(b.budget, { round: true })}</strong>`)
          : cashLimit ? html`手上可用 <strong>${formatMoney(b.leftMonth, { round: true })}</strong>` : html`${THIS}还剩 <strong>${formatMoney(b.leftMonth, { round: true })}</strong>`}</span>
        <span>${overPeriod && !cashLimit ? '' : html`预算 ${formatMoney(b.budget, { round: true })}`}</span>
      </div>` : ''}

    <div class="period__days">
      ${dayBars(days, { limit: b.hasPlan ? Math.max(0, b.allowanceToday) : 0, label: `${THIS}每天的日常开销` })}
      <div class="period__axis">
        <span>${md(b.period.start)}</span>
        ${todayAt > 2 && todayAt < days.length - 3 ? html`<span class="period__now" style="left:${(((todayAt + 0.5) / days.length) * 100).toFixed(1)}%">今天</span>` : ''}
        <span>${md(b.period.end)}</span>
      </div>
    </div>

    <div class="period__saving" data-tone="save">
      <div class="period__figure">
        <span class="period__label">${outlook ? html`${THIS}预计结余 ${infoButton('outlook', '预计结余怎么算')}` : `${THIS}结余`}</span>
        <span class="period__value ${saved < 0 ? 'is-negative' : ''}" data-motion="count" data-motion-key="saved" data-value="${saved}">${formatMoney(saved, { round: true })}</span>
      </div>
      <span class="period__sub">${!outlook && b.incomeMonth <= 0 ? '记下收入后显示进度'
        : target > 0
          ? facts(`${saved >= target ? '可达成' : ''}存款目标 ${formatMoney(target, { round: true })}`, saved >= target ? '' : `${outlook ? '照目前速度' : ''}差 ${formatMoney(target - saved, { round: true })}`, bizOutside ? '已扣创业' : '')
          : outlook ? `按目前速度到${dayLabel(b.period.end)}` : '未设定存款目标'}</span>
      ${target > 0 ? progress({ ratio: saveRatio, tone: 'save', label: `${THIS}存款目标进度`, key: 'save' }) : ''}
    </div>
    ${outlook ? infoPanel('outlook', outlookNote(b, outlook, target)) : ''}
  </section>`;
}

/**
 * 预计结余, worked out: not a shortfall yet, but where today's pace leads by the end of the period — and, with a savings
 * target, how much a day the rest of the period may spend to still reach it.
 */
function outlookNote(b, o, target) {
  const THIS = b.period.kind === 'cycle' ? '本期' : '本月';
  const rm = (c) => formatMoney(c, { round: true });
  const { soFar, days: daysAfter } = o;
  const room = soFar + o.incomeAhead - o.fixedAhead - target; // what the days left may spend and still reach the target
  return html`<ul class="info-list">
    <li>${icon('calendar')}<span>这是到${dayLabel(b.period.end)}的估计，不是现在已经差的钱：${THIS}到今天收入减支出是 ${rm(soFar)}${o.incomeAhead ? `，另有固定收入 ${rm(o.incomeAhead)} 还没到` : ''}；接下来还要付固定支出 ${rm(o.fixedAhead)}，剩下 ${daysAfter} 天按最近每天约 ${rm(daysAfter ? Math.round(o.dayToDay / daysAfter) : 0)} 的日常开销算，大约 ${rm(o.dayToDay)}。</span></li>
    ${target > 0 && daysAfter > 0 ? html`<li>${icon('target')}<span>${room > 0
      ? `想达成存款目标 ${rm(target)}，接下来 ${daysAfter} 天的日常开销平均每天约 ${rm(Math.floor(room / daysAfter))} 以内。`
      : `扣掉固定支出后，就算接下来一分钱都不花，${THIS}也存不到目标 ${rm(target)}。`}</span></li>` : ''}
  </ul>`;
}
