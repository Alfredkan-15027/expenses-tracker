// 分析 — monthly summary, KL 24yo founder benchmark, insights, categories, month-over-month, trend, runway.
import { html, icon, catIcon } from '../html.js';
import { monthSwitcher, statusBadge } from './shared.js';
import { stackBar, tierGauge, trendChart, divergeList, progress } from '../charts.js';
import {
  monthSummary, evaluateMonth, compareMonths, trend, runway, buildInsights, dailyBudget, trackingStart,
} from '../../core/analysis.js';
import { categoryMap, unknownCategory, GROUP_LABELS } from '../../core/categories.js';
import { HOUSING_OPTIONS, TRANSPORT_OPTIONS, BENCHMARK_SOURCES } from '../../core/benchmarks.js';
import { formatMoney, formatPercent } from '../../core/money.js';
import { monthLabel, monthOf } from '../../core/dates.js';
import { haptic } from '../haptics.js';
import { openSheet } from '../overlays.js';
import { openChoiceSheet } from '../sheets/plan.js';
import { saveSettings } from '../../data/store.js';

const ui = { ym: null, trendIndex: null };

const screen = {
  id: 'insights',
  title: '分析',

  render({ state, today }) {
    const current = monthOf(today);
    if (!ui.ym || ui.ym > current) ui.ym = current;
    const ym = ui.ym;
    const { transactions: txs, categories, settings } = state;
    const cats = categoryMap(categories);
    const s = monthSummary(txs, ym, categories);
    const since = trackingStart(settings, txs);
    const ev = evaluateMonth({ txs, ym, categories, profile: settings.profile, today, recurring: state.recurring, startDate: since });
    const cmp = compareMonths(txs, ym, categories, since);
    const insights = buildInsights({ txs, ym, categories, profile: settings.profile, settings, today, recurring: state.recurring });
    const rows = trend(txs, ym, 6);
    const tIdx = ui.trendIndex ?? rows.length - 1;
    const plan = dailyBudget({ txs, settings, recurring: state.recurring, today: ym === current ? today : `${ym}-01` });
    const rw = runway({ txs, currentSavings: settings.currentSavings, today, since });
    const cat = (id) => cats.get(id) || unknownCategory();
    const housing = HOUSING_OPTIONS.find((o) => o.id === ev.profile.housing)?.label;
    const transport = TRANSPORT_OPTIONS.find((o) => o.id === ev.profile.transport)?.label;

    return html`
      <header class="screen__header">
        <h1 class="large-title">分析</h1>
      </header>
      ${monthSwitcher(ym, current)}

      <div class="stat-grid">
        <div class="stat"><span class="stat__label">收入</span><span class="stat__value is-income">${formatMoney(s.income, { round: true })}</span></div>
        <div class="stat"><span class="stat__label">支出</span><span class="stat__value">${formatMoney(s.expense, { round: true })}</span></div>
        <div class="stat"><span class="stat__label">结余</span><span class="stat__value ${s.net < 0 ? 'is-negative' : ''}">${formatMoney(s.net, { round: true })}</span></div>
        <div class="stat"><span class="stat__label">储蓄率</span><span class="stat__value">${s.savingsRate === null ? '—' : formatPercent(s.savingsRate)}</span></div>
      </div>

      <section class="section">
        <h2 class="section__title">吉隆坡 24 岁创业者对照</h2>
        <div class="card card--benchmark" data-tier="${ev.tier}">
          <div class="benchmark__head">
            ${statusBadge(ev.tier)}
            <span class="benchmark__profile" data-edit-profile role="button" tabindex="0">${housing} · ${transport} ${icon('chevron-right')}</span>
          </div>
          <p class="benchmark__amount">
            <span>${ev.isPartial ? '本月预计个人生活费' : '个人生活费'}</span>
            <strong>${formatMoney(ev.isPartial ? ev.projected : ev.personalTotal, { round: true })}</strong>
          </p>
          ${tierGauge({ value: ev.isPartial ? ev.projected : ev.personalTotal, tiers: ev.tiers, label: '生活费对照' })}
          <div class="gauge__legend">
            <span data-tone="lean">精简</span><span data-tone="ok">合理</span><span data-tone="high">偏高</span><span data-tone="over">过高</span>
          </div>
          <p class="benchmark__note">
            不含创业投入${s.business ? ` ${formatMoney(s.business, { round: true })}` : ''}。
            ${ev.isPartial ? `已按记录天数（${Math.round(ev.elapsed * 100)}%）推算整月。` : ''}
            <button type="button" class="link" data-sources>参考资料</button>
          </p>
        </div>
      </section>

      <section class="section">
        <h2 class="section__title">重点</h2>
        <ul class="insights">
          ${insights.map((i) => html`<li class="insight" data-tone="${i.tone}">
            <span class="insight__icon">${icon(i.icon)}</span>
            <div class="insight__text"><strong>${i.title}</strong><p>${i.body}</p></div>
          </li>`)}
        </ul>
      </section>

      ${ev.rows.some((r) => r.amount > 0) || s.business ? html`
        <section class="section">
          <h2 class="section__title">类别明细 <span class="section__hint">对照合理区间（RM／月）</span></h2>
          <div class="card card--flush">
            <div class="card__pad">
              ${stackBar([...s.byCategory.entries()].map(([id, value]) => ({ id, value, color: cat(id).color, label: cat(id).name })))}
            </div>
            <ul class="list list--plain">
              ${ev.rows.filter((r) => r.amount > 0).map((r) => html`<li class="row row--static">
                ${catIcon(cat(r.categoryId))}
                <span class="row__body">
                  <span class="row__title">${cat(r.categoryId).name}</span>
                  <span class="row__subtitle">${r.range ? `参考 ${r.range[0]}–${r.range[1]}` : '无参考值'} · ${formatPercent(ev.personalTotal ? r.amount / ev.personalTotal : 0)}</span>
                </span>
                <span class="row__trail">
                  <span class="row__value">${formatMoney(r.amount, { round: true })}</span>
                  ${r.range ? statusBadge(r.status) : ''}
                </span>
              </li>`)}
              ${s.business ? html`<li class="row row--static">
                ${catIcon(cat('business'))}
                <span class="row__body"><span class="row__title">创业投入</span><span class="row__subtitle">单独计算，不影响生活费评估</span></span>
                <span class="row__trail"><span class="row__value">${formatMoney(s.business, { round: true })}</span></span>
              </li>` : ''}
            </ul>
          </div>
          ${groupSplit(s)}
        </section>` : ''}

      ${cmp.comparable && (cmp.previous.expense > 0 || cmp.current.expense > 0) ? html`
        <section class="section">
          <div class="section__header">
            <h2 class="section__title">与${monthLabel(cmp.prevYm, false)}相比</h2>
            <span class="section__meta ${cmp.delta > 0 ? 'is-up' : 'is-down'}">${cmp.delta > 0 ? '+' : cmp.delta < 0 ? '−' : ''}${formatMoney(Math.abs(cmp.delta), { round: true })}${cmp.ratio !== null ? ` (${cmp.delta > 0 ? '+' : ''}${formatPercent(cmp.ratio)})` : ''}</span>
          </div>
          <div class="card">
            ${cmp.rows.filter((r) => r.delta !== 0).length
              ? divergeList(cmp.rows.filter((r) => r.delta !== 0).slice(0, 6).map((r) => ({ ...r, label: cat(r.categoryId).name })))
              : html`<p class="muted">和上个月一样。</p>`}
            <p class="card__footnote">${icon('info')} 右侧为增加，左侧为减少${ym === current ? '；本月还没结束，差距会继续变化' : ''}。</p>
          </div>
        </section>` : ''}

      <section class="section">
        <h2 class="section__title">近 6 个月</h2>
        <div class="card">
          ${trendChart(rows, { selected: Math.min(tIdx, rows.length - 1), budget: plan.hasPlan ? plan.budget : 0 })}
        </div>
      </section>

      ${runwayCard(rw, settings)}
    `;
  },

  onClick(e, ctx) {
    const m = e.target.closest('[data-month]');
    if (m && !m.disabled) { ui.ym = m.dataset.month; ui.trendIndex = null; haptic(); ctx.rerender(); return; }
    const col = e.target.closest('[data-trend-i]');
    if (col) { ui.trendIndex = Number(col.dataset.trendI); haptic(); ctx.rerender(); return; }
    if (e.target.closest('[data-sources]')) { openSources(); return; }
    if (e.target.closest('[data-edit-profile]')) { editProfile(ctx); }
  },
};

function groupSplit(s) {
  const total = s.expense;
  if (!total) return '';
  const parts = ['need', 'want', 'growth', 'business', 'other']
    .map((g) => ({ g, v: s.byGroup[g] || 0 }))
    .filter((p) => p.v > 0);
  return html`<div class="card card--groups">
    <h3 class="card__title">钱花在哪一类</h3>
    <ul class="groups">
      ${parts.map((p) => html`<li class="groups__row" data-group="${p.g}">
        <span class="groups__label">${GROUP_LABELS[p.g]}</span>
        ${progress({ ratio: p.v / total, tone: `group-${p.g}`, label: GROUP_LABELS[p.g] })}
        <span class="groups__value">${formatPercent(p.v / total)}</span>
      </li>`)}
    </ul>
    <p class="card__footnote">${icon('info')} 建议：必要开销 ≤ 60%，生活享受 ≤ 25%，每月至少存下 20%。</p>
  </div>`;
}

function runwayCard(rw, settings) {
  const goal = settings.goalAmount;
  if (!rw && !goal) {
    return html`<section class="section">
      <h2 class="section__title">个人 Runway</h2>
      <a class="card card--setup" href="#/settings">
        <span class="card__eyebrow">${icon('savings')} 存款</span>
        <strong class="card--setup__title">填入目前存款，算出不靠收入还能撑几个月</strong>
        <span class="card--setup__cta">去设定 ${icon('chevron-right')}</span>
      </a>
    </section>`;
  }
  const months = rw?.months;
  const tone = months === null || months === undefined ? 'info' : months >= rw.target ? 'good' : months >= 3 ? 'warn' : 'bad';
  return html`<section class="section">
    <h2 class="section__title">个人 Runway</h2>
    <div class="card card--runway" data-tone="${tone}">
      ${rw ? html`
        <div class="runway__main">
          <span class="runway__value">${months === null ? '—' : months >= 99 ? '99+' : months.toFixed(1)}</span>
          <span class="runway__unit">个月</span>
        </div>
        <p class="runway__text">目前存款 ${formatMoney(settings.currentSavings, { round: true })}，${rw.basis}每月支出 ${formatMoney(rw.avg, { round: true })}。
          ${months !== null ? (months >= rw.target ? '已达到 6 个月的安全线。' : `建议至少储备 ${rw.target} 个月生活费作为创业安全垫。`) : ''}</p>` : ''}
      ${goal ? html`
        <div class="goal">
          <div class="goal__head"><span>${settings.goalName}</span><span>${formatMoney(settings.currentSavings, { round: true })} / ${formatMoney(goal, { round: true })}</span></div>
          ${progress({ ratio: settings.currentSavings / goal, tone: 'save', label: settings.goalName })}
        </div>` : ''}
    </div>
  </section>`;
}

function openSources() {
  openSheet({
    title: '参考资料',
    size: 'medium',
    body: html`<div class="prose">
      <p>「合理区间」是给吉隆坡 24 岁、单身、正在创业的人的参考值，不是硬性规定。数字以 EPF 的「合理最低生活标准」为底，再按吉隆坡的实际价格留出空间。</p>
      <ul class="sources">${BENCHMARK_SOURCES.map((s) => html`<li><strong>${s.name}</strong><span>${s.detail}</span></li>`)}</ul>
      <p>在「设置 → 我的情况」选择住房和交通方式后，参考值会自动调整：住家里会降低住房和餐饮参考，有车会提高交通参考。</p>
      <p>创业相关的支出（标记为「创业」或记在「创业支出」类别）不计入生活费评估，会另外显示。</p>
    </div>`,
  });
}

async function editProfile(ctx) {
  const { profile } = ctx.state.settings;
  const housing = await openChoiceSheet({ title: '住房情况', options: HOUSING_OPTIONS, value: profile.housing });
  if (!housing) return;
  const transport = await openChoiceSheet({ title: '主要交通方式', options: TRANSPORT_OPTIONS, value: profile.transport });
  if (!transport) return;
  await saveSettings({ profile: { housing, transport } });
}

export default screen;
