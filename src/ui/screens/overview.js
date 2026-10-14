// 分析 → the period at a glance, as a bento grid: 结余 (big tile, with what share of the income was spent;
// 收入 − 支出 shown to the sen, so the three figures add up exactly),
// 储蓄率 and 花最多 beside it, and 手上的钱 / 创业投入 as a wide tile under it.
// While the period runs, 储蓄率 is where it is heading (periodOutlook, the same figure as the 重点 insight): right after
// payday all the income is in and little has gone out, so the rate so far would always look excellent.
import { html, icon, money, facts } from '../html.js';
import { formatMoney, formatPercent } from '../../core/money.js';
import { dayLabel } from '../../core/dates.js';
import { runwayShown } from '../../core/analysis.js';

const GOOD_RATE = 0.2; // the 20% the insights recommend keeping

/**
 * s: periodSummary of the period; personal: Map(categoryId → personal spending); cats: category lookup;
 * cash: cashOnHand (current period only, may be null); rw: runway (may be null); outlook: periodOutlook of the running
 * period (null otherwise, or without income).
 */
export function overview({ s, isCurrent, untracked = false, personal, cat, cash, rw, today, outlook = null }) {
  const spentShare = s.income > 0 ? s.expense / s.income : null;
  const top = [...personal.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0];
  const personalTotal = [...personal.values()].reduce((a, v) => a + Math.max(0, v), 0);
  const ahead = isCurrent && !untracked && outlook ? outlook : null;
  const rate = untracked ? null : ahead ? ahead.rate : s.savingsRate; // a period before tracking started has no meaningful rate
  const rateTone = rate === null ? '' : rate < 0 ? 'is-negative' : '';
  const rateSub = rate === null ? (untracked ? '开始记账之前' : '记下收入后显示')
    : ahead ? `预计结余 ${formatMoney(ahead.net, { round: true })}`
      : rate >= GOOD_RATE ? '达到 20% 的建议' : '建议至少 20%';
  return html`<div class="bento">
    <div class="bento__tile bento__tile--hero" data-tone="${s.net < 0 ? 'bad' : s.income > 0 ? 'good' : ''}">
      <div>
        <span class="bento__label">${isCurrent ? '目前结余' : '结余'}</span>
        <div class="bento__value bento__value--hero ${s.net < 0 ? 'is-negative' : ''}" data-motion="digits" data-motion-key="overview-net">${money(s.net, { cls: 'money--bento' })}</div>
      </div>
      <div class="bento__flow">
        <span>收入<strong class="is-income">${formatMoney(s.income)}</strong></span>
        <span>支出<strong>${formatMoney(s.expense)}</strong></span>
        ${spentShare === null ? html`<span class="bento__sub">还没有收入记录</span>` : html`
          <div class="bento__meter ${spentShare > 1 ? 'is-over' : ''}" role="img" aria-label="支出占收入 ${formatPercent(spentShare)}">
            <span style="width:${Math.min(100, Math.max(0, spentShare * 100)).toFixed(1)}%"></span>
            <i style="left:${(100 - GOOD_RATE * 100).toFixed(0)}%"></i>
          </div>
          <span class="bento__sub">花掉收入的 ${formatPercent(spentShare)}</span>`}
      </div>
    </div>
    <div class="bento__tile">
      <span class="bento__label">${ahead ? `预计储蓄率` : '储蓄率'}</span>
      <span class="bento__value ${rateTone}">${rate === null ? '—' : formatPercent(rate)}</span>
      <span class="bento__sub">${rateSub}</span>
    </div>
    <div class="bento__tile">
      <span class="bento__label">花最多</span>
      <span class="bento__value">${top ? cat(top[0]).name : '—'}</span>
      <span class="bento__sub">${top ? facts(formatMoney(top[1], { round: true }), `占 ${formatPercent(top[1] / personalTotal)}`) : '还没有个人支出'}</span>
    </div>
    ${isCurrent ? cashTile(cash, rw, today) : s.business > 0 ? html`<div class="bento__tile bento__tile--wide">
      <span class="bento__icon" data-color="mint">${icon('business')}</span>
      <span class="bento__body"><span class="bento__label">创业投入</span><span class="bento__sub">不算进生活费评估</span></span>
      <span class="bento__value">${formatMoney(s.business, { round: true })}</span>
    </div>` : ''}
  </div>`;
}

function cashTile(cash, rw, today) {
  if (!cash) {
    return html`<button type="button" class="bento__tile bento__tile--wide" data-open-cash>
      <span class="bento__icon" data-color="pink">${icon('wallet')}</span>
      <span class="bento__body"><span class="bento__label">手上的钱</span><span class="bento__sub">填一次，就能算出够撑几个月</span></span>
      ${icon('chevron-right', 'bento__chevron')}
    </button>`;
  }
  const months = runwayShown(rw?.months); // as the Runway card shows it
  return html`<button type="button" class="bento__tile bento__tile--wide" data-open-cash>
    <span class="bento__icon" data-color="pink">${icon('wallet')}</span>
    <span class="bento__body">
      <span class="bento__label">手上的钱</span>
      <span class="bento__sub">${facts(cash.kept ? `能用 ${formatMoney(cash.spendable, { round: true })}` : '', `${dayLabel(cash.at, today)}对账`)}</span>
    </span>
    <span class="bento__aside">
      <span class="bento__value ${cash.balance < 0 ? 'is-negative' : ''}" data-motion="digits" data-motion-key="overview-cash">${money(cash.balance, { cls: 'money--bento' })}</span>
      <span class="bento__sub">${months === null || months === undefined ? '记录满 7 天后算 Runway' : `够撑 ${months >= 99 ? '99+' : months.toFixed(1)} 个月`}</span>
    </span>
    ${icon('chevron-right', 'bento__chevron')}
  </button>`;
}
