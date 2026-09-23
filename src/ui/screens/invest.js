// 投资 — RM 1,750,000 in 10 years: plan, projection band (8–10%), actual performance and holdings.
import { html, icon, catIcon, money } from '../html.js';
import { progress, projectionChart } from '../charts.js';
import { statusBadge } from './shared.js';
import {
  planState, projectionSeries, portfolioSummary, holdingSummary, yearsBetween, FREQ_OPTIONS, HOLDING_KINDS,
} from '../../core/invest.js';
import { formatMoney, formatPercent } from '../../core/money.js';
import { dayLabel } from '../../core/dates.js';
import {
  openInvestActions, openFlowSheet, openValuationSheet, openHoldingDetail, openHoldingEditor, openPlanEditor, holdingIcon,
} from '../sheets/invest.js';

const STATUS = {
  preparing: ['info', 'clock', '准备阶段'],
  ahead: ['good', 'check', '按计划可达标'],
  tight: ['warn', 'warning', '保守估计不足'],
  behind: ['bad', 'warning', '按计划不足'],
  done: ['good', 'check', '已达成目标'],
  missed: ['bad', 'warning', '期限已到，未达标'],
};

const pct = (r) => `${(r * 100).toFixed(1).replace(/\.0$/, '')}%`;

function statusPill(status) {
  const [tone, ic, label] = STATUS[status] || STATUS.preparing;
  return html`<span class="badge" data-tone="${tone}">${icon(ic)}${label}</span>`;
}

function timeLeft(years) {
  const totalMonths = Math.max(0, Math.round(years * 12));
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths % 12;
  if (!y && !m) return '已到期';
  return `${y ? `${y} 年` : ''}${m ? ` ${m} 个月` : ''}`.trim();
}

/** Portfolio value at every date something happened, for the "actual" line. */
function actualSeries(st, state, today) {
  if (!st.started) return [];
  const dates = [...new Set([
    ...state.investFlows.map((f) => f.date),
    ...state.valuations.map((v) => v.date),
    today,
  ])].filter((d) => d >= st.startDate && d <= today).sort();
  return dates.map((d) => ({
    t: yearsBetween(st.startDate, d),
    value: portfolioSummary({ holdings: state.holdings, flows: state.investFlows, valuations: state.valuations, asOf: d }).value,
  }));
}

const screen = {
  id: 'invest',
  title: '投资',

  navActions() {
    return html`<button type="button" class="btn btn--icon btn--glass" data-invest-add aria-label="新增投资记录">${icon('plus')}</button>`;
  },

  render({ state, today }) {
    const st = planState({
      invest: state.settings.invest, flows: state.investFlows, valuations: state.valuations,
      holdings: state.holdings, transactions: state.transactions, asOf: today,
    });
    const p = st.invest;
    const freq = FREQ_OPTIONS.find((f) => f.id === p.freq);
    const years = p.years;
    const startYear = Number(st.planStart.slice(0, 4));
    const band = projectionSeries({
      planStart: st.planStart, deadline: st.deadline, asOf: today, current: st.current, contribution: st.planned,
      rateLow: p.rateLow, rateHigh: p.rateHigh, freq: p.freq, times: st.times,
    });
    const actual = actualSeries(st, state, today);
    const holdings = state.holdings.filter((h) => !h.archived).sort((a, b) => a.order - b.order);
    const pf = st.portfolio;

    return html`
      <header class="screen__header">
        <p class="eyebrow">${years} 年目标 · 年回报假设 ${pct(p.rateLow)}–${pct(p.rateHigh)}</p>
        <h1 class="large-title">投资</h1>
      </header>

      <section class="card card--goal" data-status="${st.status}">
        <div class="goal-card__head">
          <span class="card__eyebrow">${icon('target')} 目标 ${formatMoney(p.target, { round: true })}</span>
          ${statusPill(st.status)}
        </div>
        <div class="hero-amount">${money(st.current, { cls: 'money--hero' })}</div>
        ${progress({ ratio: st.progress, marker: st.started ? Math.min(1, st.elapsedYears / years) : null, tone: 'save', label: '目标完成度' })}
        <div class="hero-foot">
          <span>完成 <strong>${formatPercent(st.progress, st.progress < 0.1 ? 1 : 0)}</strong></span>
          <span>${st.started ? `还剩 ${timeLeft(st.remainingYears)} · ${dayLabel(st.deadline)}到期` : '从第一次投入开始计时'}</span>
        </div>
      </section>

      ${st.started ? '' : triggerCard(st)}
      ${st.started && st.valuationAgeDays !== null && st.valuationAgeDays > 45 ? html`
        <button type="button" class="banner banner--warn" data-invest="value">
          <span class="banner__icon">${icon('trendUp')}</span>
          <span class="banner__text"><strong>市值已经 ${st.valuationAgeDays} 天没更新</strong><span>更新后，进度和实际回报才准确</span></span>
          ${icon('chevron-right', 'banner__chevron')}
        </button>` : ''}

      <section class="section">
        <div class="section__header">
          <h2 class="section__title">计划</h2>
          <button type="button" class="link" data-invest="plan">调整</button>
        </div>
        <div class="card card--plan">
          <p class="plan__lead">要在${st.started ? '到期前' : ` ${years} 年内`}达到目标，${freq.label}需要投入：</p>
          <div class="rate-table" role="table" aria-label="不同回报假设下每次需要投入的金额">
            ${[['low', p.rateLow], ['mid', (p.rateLow + p.rateHigh) / 2], ['high', p.rateHigh]].map(([k, r]) => html`
              <div class="rate-table__cell ${k === 'low' && st.usesRequired ? 'is-mid' : ''}" role="cell">
                <span class="rate-table__rate">${pct(r)}</span>
                <span class="rate-table__amount"><small>RM</small>${formatMoney(st.required[k], { round: true }).replace(/^RM\s/, '')}</span>
              </div>`)}
          </div>
          <ul class="plan__facts">
            <li><span>你的计划</span><strong>${freq.short} ${formatMoney(st.planned, { round: true })}${st.usesRequired ? `（按 ${pct(p.rateLow)}）` : ''}</strong></li>
            ${st.started && st.next ? html`<li><span>下次投入</span><strong>${st.next.now ? '本期还没投入' : dayLabel(st.next.date)} · 还剩 ${st.next.left} 次</strong></li>` : ''}
            <li><span>到期预计</span><strong>${formatMoney(st.projected.low, { round: true })} – ${formatMoney(st.projected.high, { round: true })}</strong></li>
            ${st.shareOfTriggerIncome !== null ? html`<li><span>约占月收入 ${formatMoney(p.triggerIncome, { round: true })} 的</span><strong>${formatPercent(st.shareOfTriggerIncome)}</strong></li>` : ''}
          </ul>
          <p class="card__footnote">${icon('info')} 每${freq.short === '每年' ? '年' : freq.short === '每季' ? '季' : '月'}初投入、按年复利计算。回报率是假设，不是保证。</p>
        </div>
      </section>

      <section class="section">
        <h2 class="section__title">${st.started ? '走势与预测' : `${years} 年预测`}</h2>
        <div class="card">
          ${projectionChart({
            band, actual, target: p.target, years,
            todayT: st.started ? Math.min(years, st.elapsedYears) : null,
            yearLabel: (t) => (st.started ? String(startYear + t) : t === 0 ? '现在' : `${t}年`),
          })}
          <table class="milestones">
            <thead><tr><th>时间点</th><th>${pct(p.rateLow)}</th><th>${pct(p.rateHigh)}</th></tr></thead>
            <tbody>
              ${band.filter((b, i) => i > 0 && (Math.round(b.t) % Math.max(1, Math.floor(years / 3)) === 0 || i === band.length - 1)).map((b) => html`<tr>
                <td>${st.started ? `${startYear + Math.round(b.t)} 年` : `第 ${Math.round(b.t)} 年`}</td>
                <td>${formatMoney(b.low, { round: true })}</td>
                <td>${formatMoney(b.high, { round: true })}</td>
              </tr>`)}
            </tbody>
          </table>
        </div>
      </section>

      ${st.started ? performanceCard(st, pf, p) : ''}

      <section class="section">
        <div class="section__header">
          <h2 class="section__title">持仓</h2>
          ${holdings.length ? html`<button type="button" class="link" data-invest="value">更新市值</button>` : ''}
        </div>
        ${holdings.length ? html`<ul class="list">
          ${holdings.map((h) => {
            const s = holdingSummary(h.id, state.investFlows, state.valuations, today);
            const weight = pf.value > 0 ? s.value / pf.value : 0;
            return html`<li><button type="button" class="row row--holding" data-holding-id="${h.id}">
              ${catIcon(holdingIcon(h))}
              <span class="row__body">
                <span class="row__title">${h.name}</span>
                <span class="row__subtitle">${HOLDING_KINDS.find((k) => k.id === h.kind)?.label || '其他'} · 占 ${formatPercent(weight)}${s.lastValuationDate ? '' : ' · 未更新市值'}</span>
              </span>
              <span class="row__trail">
                <span class="row__value">${formatMoney(s.value, { round: true })}</span>
                ${s.gainRatio !== null ? html`<span class="delta ${s.gain < 0 ? 'is-down' : 'is-up'}">${s.gain < 0 ? '' : '+'}${formatPercent(s.gainRatio, 1)}</span>` : ''}
              </span>
              ${icon('chevron-right', 'row__chevron')}
            </button></li>`;
          })}
        </ul>` : html`<div class="empty-state">
          <span class="empty-state__icon">${icon('invest')}</span>
          <h3>还没有持仓</h3>
          <p>${st.started && state.holdings.some((h) => h.archived) ? '之前的持仓都已移除。新增持仓或记录投入，继续这个计划。'
            : st.trigger.reached || !p.triggerIncome ? `记录第一笔投入，${years} 年计划就从那天开始。`
            : '达到开始条件后，在这里记录第一笔投入。也可以先把打算投资的项目建好。'}</p>
          <button type="button" class="btn btn--primary" data-invest="${st.trigger.reached || !p.triggerIncome ? 'first-in' : 'new-holding'}">${st.trigger.reached || !p.triggerIncome ? '记录第一笔投入' : '新增持仓'}</button>
        </div>`}
      </section>

      <p class="section__footer disclaimer">这是规划工具，不构成投资建议。回报率是你的假设，实际回报可能更高、更低，也可能亏损；投资前请自行评估风险。</p>
    `;
  },

  onClick(e) {
    if (e.target.closest('[data-invest-add]')) { openInvestActions(); return; }
    const h = e.target.closest('[data-holding-id]');
    if (h) { openHoldingDetail(h.dataset.holdingId); return; }
    const a = e.target.closest('[data-invest]');
    if (!a) return;
    const act = a.dataset.invest;
    if (act === 'plan') openPlanEditor();
    else if (act === 'value') openValuationSheet();
    else if (act === 'first-in') openFlowSheet({ type: 'in' });
    else if (act === 'new-holding') openHoldingEditor();
  },
};

function triggerCard(st) {
  const t = st.trigger;
  if (!t.threshold) return '';
  const best = Math.max(t.thisMonth, t.lastMonth);
  return html`<section class="card card--trigger" data-reached="${t.reached}">
    <div class="goal-card__head">
      <span class="card__eyebrow">${icon('salary')} 开始条件</span>
      ${t.reached ? statusBadge('ok') : ''}
    </div>
    <p class="trigger__title">${t.reached ? '已达到月收入' : '月收入达到'} <strong>${formatMoney(t.threshold, { round: true })}</strong> ${t.reached ? '，可以开始投资' : '时开始投资'}</p>
    ${progress({ ratio: best / t.threshold, tone: t.reached ? 'save' : 'spend', label: '月收入对照开始条件' })}
    <ul class="plan__facts">
      <li><span>本月至今</span><strong>${formatMoney(t.thisMonth, { round: true })}</strong></li>
      <li><span>上个月</span><strong>${formatMoney(t.lastMonth, { round: true })}</strong></li>
      <li><span>近 3 个月平均</span><strong>${formatMoney(t.avg3, { round: true })}</strong></li>
    </ul>
    ${t.reached ? html`<button type="button" class="btn btn--primary btn--block" data-invest="first-in">记录第一笔投入</button>` : html`<p class="card__footnote">${icon('info')} 收入按「记录」里的收入计算。达到后这里会提醒你。</p>`}
  </section>`;
}

function performanceCard(st, pf, p) {
  const bandText = { below: `低于 ${pct(p.rateLow)}`, within: `在 ${pct(p.rateLow)}–${pct(p.rateHigh)} 之间`, above: `高于 ${pct(p.rateHigh)}` }[st.returnBand];
  const bandTone = { below: 'warn', within: 'good', above: 'info' }[st.returnBand];
  return html`<section class="section">
    <h2 class="section__title">实际表现</h2>
    <div class="stat-grid">
      <div class="stat"><span class="stat__label">${pf.withdrawn ? '累计投入' : '投入本金'}</span><span class="stat__value">${formatMoney(pf.invested, { round: true })}</span>
        ${pf.withdrawn ? html`<span class="stat__note">已取出 ${formatMoney(pf.withdrawn, { round: true })}</span>` : ''}</div>
      <div class="stat"><span class="stat__label">目前市值</span><span class="stat__value">${formatMoney(pf.value, { round: true })}</span></div>
      <div class="stat"><span class="stat__label">盈亏</span><span class="stat__value ${pf.gain < 0 ? 'is-negative' : 'is-income'}">${formatMoney(pf.gain, { round: true, sign: true })}</span></div>
      <div class="stat"><span class="stat__label">年化回报</span><span class="stat__value">${pf.annualReturn === null ? '—' : formatPercent(pf.annualReturn, 1)}</span></div>
    </div>
    ${pf.annualReturn !== null ? html`<p class="insight-line" data-tone="${bandTone}">${icon(bandTone === 'good' ? 'check' : bandTone === 'warn' ? 'warning' : 'info')}
      <span>实际年化回报 ${formatPercent(pf.annualReturn, 1)}，${bandText}${pf.heldYears < 1 ? '。持有不到 1 年，年化数字波动会很大，仅供参考' : ''}。</span></p>` : ''}
  </section>`;
}

export default screen;
