// 分析 → the period at a glance, in two parts:
//   flow()   the scene: 结余 as the big figure, with 收入 and 支出 as two bars of the same scale under it
//            (to the sen, so the three figures add up exactly), and what share of the income was spent
//   tiles()  the first thing on the panel: 储蓄率 and 花最多 side by side, 手上的钱 / 创业投入 as a wide tile under them
// While the period runs, 储蓄率 is where it is heading (periodOutlook, the same figure as the 重点 insight): right after
// payday all the income is in and little has gone out, so the rate so far would always look excellent.
import { html, icon, money, facts, catIcon } from '../html.js';
import { formatMoney, formatPercent } from '../../core/money.js';
import { dayLabel } from '../../core/dates.js';
import { runwayShown } from '../../core/analysis.js';

const GOOD_RATE = 0.2; // the 20% the insights recommend keeping

/** s: periodSummary of the period. */
export function flow({ s, isCurrent }) {
  const spentShare = s.income > 0 ? s.expense / s.income : null;
  const max = Math.max(s.income, s.expense, 1);
  const w = (v) => `${Math.max(v > 0 ? 3 : 0, (v / max) * 100).toFixed(1)}%`;
  return html`<div class="flow" data-tone="${s.net < 0 ? 'bad' : 'good'}">
    <span class="scene__label">${isCurrent ? '目前结余' : '结余'}</span>
    <div class="scene__figure ${s.net < 0 ? 'is-negative' : ''}" data-motion="count" data-motion-key="overview-net" data-value="${s.net}">${money(s.net)}</div>
    <div class="flow__bars">
      <div class="flow__row flow__row--in">
        <span class="flow__label">收入</span>
        <span class="flow__track"><i style="width:${w(s.income)}"></i></span>
        <strong class="flow__value is-income">${formatMoney(s.income)}</strong>
      </div>
      <div class="flow__row flow__row--out">
        <span class="flow__label">支出</span>
        <span class="flow__track"><i style="width:${w(s.expense)}"></i></span>
        <strong class="flow__value">${formatMoney(s.expense)}</strong>
      </div>
    </div>
    <p class="scene__sub">${spentShare === null ? '还没有收入记录' : `花掉收入的 ${formatPercent(spentShare)}`}</p>
  </div>`;
}

/**
 * s: periodSummary of the period; personal: Map(categoryId → personal spending); cat: category lookup;
 * cash: cashOnHand (current period only, may be null); rw: runway (may be null); outlook: periodOutlook of the running
 * period (null otherwise, or without income).
 */
export function tiles({ s, isCurrent, untracked = false, personal, cat, cash, rw, today, outlook = null }) {
  const top = [...personal.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0];
  const personalTotal = [...personal.values()].reduce((a, v) => a + Math.max(0, v), 0);
  const ahead = isCurrent && !untracked && outlook ? outlook : null;
  const rate = untracked ? null : ahead ? ahead.rate : s.savingsRate; // a period before tracking started has no meaningful rate
  const rateSub = rate === null ? (untracked ? '开始记账之前' : '记下收入后显示')
    : ahead ? `预计结余 ${formatMoney(ahead.net, { round: true })}`
      : rate >= GOOD_RATE ? '达到 20% 的建议' : '建议至少 20%';
  const rateTone = rate === null ? '' : rate < 0 ? 'bad' : rate >= GOOD_RATE ? 'good' : 'warn';
  return html`<div class="tiles">
    <div class="tile tile--rate" data-tone="${rateTone}">
      <span class="tile__label">${ahead ? `预计储蓄率` : '储蓄率'}</span>
      <span class="tile__value ${rate !== null && rate < 0 ? 'is-negative' : ''}">${rate === null ? '—' : formatPercent(rate)}</span>
      <span class="tile__sub">${rateSub}</span>
      ${rate === null ? '' : html`<span class="tile__meter" aria-hidden="true"><i style="width:${Math.min(100, Math.max(0, rate * 100 * 2.5)).toFixed(1)}%"></i><b></b></span>`}
    </div>
    <div class="tile tile--top">
      <span class="tile__label">花最多</span>
      <span class="tile__value tile__value--text">${top ? cat(top[0]).name : '—'}</span>
      <span class="tile__sub">${top ? facts(formatMoney(top[1], { round: true }), `占 ${formatPercent(top[1] / personalTotal)}`) : '还没有个人支出'}</span>
      ${top ? html`<span class="tile__mark">${catIcon(cat(top[0]))}</span>` : ''}
    </div>
    ${isCurrent ? cashTile(cash, rw, today) : s.business > 0 ? html`<div class="tile tile--wide">
      <span class="tile__icon" data-color="mint">${icon('business')}</span>
      <span class="tile__body"><span class="tile__label">创业投入</span><span class="tile__sub">不算进生活费评估</span></span>
      <span class="tile__value">${formatMoney(s.business, { round: true })}</span>
    </div>` : ''}
  </div>`;
}

function cashTile(cash, rw, today) {
  if (!cash) {
    return html`<button type="button" class="tile tile--wide" data-open-cash>
      <span class="tile__icon tile__icon--ink">${icon('wallet')}</span>
      <span class="tile__body"><span class="tile__label">手上的钱</span><span class="tile__sub">填一次，就能算出够撑几个月</span></span>
      ${icon('chevron-right', 'tile__chevron')}
    </button>`;
  }
  const months = runwayShown(rw?.months); // as the Runway card shows it
  return html`<button type="button" class="tile tile--wide" data-open-cash>
    <span class="tile__icon tile__icon--ink">${icon('wallet')}</span>
    <span class="tile__body">
      <span class="tile__label">手上的钱</span>
      <span class="tile__sub">${facts(cash.kept ? `能用 ${formatMoney(cash.spendable, { round: true })}` : '', `${dayLabel(cash.at, today)}对账`)}</span>
    </span>
    <span class="tile__aside">
      <span class="tile__value ${cash.balance < 0 ? 'is-negative' : ''}" data-motion="count" data-motion-key="overview-cash" data-value="${cash.balance}">${money(cash.balance)}</span>
      <span class="tile__sub">${months === null || months === undefined ? '记录满 7 天后算 Runway' : `够撑 ${months >= 99 ? '99+' : months.toFixed(1)} 个月`}</span>
    </span>
    ${icon('chevron-right', 'tile__chevron')}
  </button>`;
}
