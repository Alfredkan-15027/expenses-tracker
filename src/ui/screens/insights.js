// 分析 — monthly summary, KL 24yo founder benchmark, insights, categories, month-over-month, trend, runway.
import { html, icon, catIcon, facts } from '../html.js';
import { periodSwitcher, statusBadge } from './shared.js';
import { stackBar, tierGauge, trendChart, divergeList, progress } from '../charts.js';
import {
  periodSummary, evaluatePeriod, comparePeriods, trendPeriods, runway, buildInsights, periodBudget, trackingStart,
  cashOnHand, personalByCategory, periodOutlook, runwayShown,
} from '../../core/analysis.js';
import { infoButton, infoPanel, infoAttrs } from '../info.js';
import { overview } from './overview.js';
import { openCashSheet } from '../sheets/cash.js';
import { periodFor, periodByKey, prevPeriod, nextPeriod, periodsEndingWith } from '../../core/periods.js';
import { categoryMap, unknownCategory, GROUP_LABELS } from '../../core/categories.js';
import { HOUSING_OPTIONS, TRANSPORT_OPTIONS, BENCHMARK_SOURCES } from '../../core/benchmarks.js';
import { formatMoney, formatPercent, roundedRest, sharePercents } from '../../core/money.js';
import { dayLabel, monthLabel } from '../../core/dates.js';
import { haptic } from '../haptics.js';
import { openSheet } from '../overlays.js';
import { openChoiceSheet } from '../sheets/plan.js';
import { saveSettings } from '../../data/store.js';

const ui = { key: null, mode: null, trendIndex: null };

const screen = {
  id: 'insights',
  title: '分析',

  render({ state, today }) {
    const { transactions: txs, categories, settings } = state;
    const ctx = { txs, settings, today };
    const currentP = periodFor(today, ctx);
    // ui.key = null follows the running period (it moves on by itself when new income starts the next cycle).
    // Switching between calendar months and pay cycles resets the view to the running period.
    if (ui.mode !== currentP.kind || (ui.key && ui.key > today)) { ui.key = null; ui.mode = currentP.kind; }
    if (ui.key === currentP.key) ui.key = null;
    const p = ui.key ? periodByKey(ui.key, ctx) : currentP;
    const isCurrentP = p.key === currentP.key;
    const cycle = p.kind === 'cycle';
    const THIS = cycle ? '本期' : '本月';
    const cats = categoryMap(categories);
    const s = periodSummary(txs, p, categories);
    const since = trackingStart(settings, txs);
    const ev = evaluatePeriod({ txs, period: p, categories, profile: settings.profile, today, recurring: state.recurring, startDate: since });
    const prevP = prevPeriod(p, ctx);
    const cmp = comparePeriods(txs, p, prevP, categories, since, today, state.recurring);
    // The running period's 储蓄率 is where it is heading, like the insight (see periodOutlook).
    const outlook = ev.model ? periodOutlook({ txs, period: p, settings, today, recurring: state.recurring, model: ev.model, summary: s }) : null;
    const insights = buildInsights({ txs, period: p, categories, profile: settings.profile, settings, today, recurring: state.recurring });
    // Periods that ended before tracking started hold nothing (or only stray entries): leave them out.
    const shown = periodsEndingWith(p, 6, ctx).filter((q) => !since || q.end >= since || q.key === p.key);
    // Each bar is held against its own period's budget — without expected income that is the period's own income, so
    // the one 预算 line is drawn only with expected income (the same for every period). A bar holds everything recorded
    // in its period, so a partly tracked one is held against the whole period's budget, not the prorated part.
    const whole = { ...settings, startDate: '' };
    const rows = trendPeriods(txs, shown, since).map((r, i) => {
      const b = periodBudget({ txs, settings: whole, period: shown[i] });
      return { ...r, budget: b.hasPlan ? b.budget : 0 };
    });
    const tIdx = ui.trendIndex ?? rows.length - 1;
    const plan = periodBudget({ txs, settings: whole, period: p, recurring: state.recurring });
    const cash = cashOnHand({ txs, settings, flows: state.investFlows, today, recurring: state.recurring });
    const savingsNow = cash ? cash.balance : settings.currentSavings;
    const rw = runway({ txs, currentSavings: savingsNow, today, since, recurring: state.recurring, known: !!cash });
    const nextP = nextPeriod(p, ctx);
    const cat = (id) => cats.get(id) || unknownCategory();
    const housing = HOUSING_OPTIONS.find((o) => o.id === ev.profile.housing)?.label;
    const transport = TRANSPORT_OPTIONS.find((o) => o.id === ev.profile.transport)?.label;
    // Insurance is kept out of the living cost (see analysisCategory), so out of its fixed part too.
    const [fixedShown, dailyShown] = ev.model ? roundedParts(ev.perMonth, ev.model.fixedPersonal - ev.model.fixedInsurance) : [0, 0];
    // Category rows: everything with spending in the period, and any category the running period flags from its
    // monthly estimate even with nothing spent on it yet — the verdict points at the flagged rows "below".
    const listed = ev.rows.filter((r) => r.amount > 0 || r.status === 'high' || r.status === 'over' || r.status === 'pace');
    const cmpRM = Math.round(Math.abs(cmp.delta) / 100); // signs follow the rounded figures shown: no "−RM 0"
    const cmpRows = cmp.rows.filter((r) => Math.round(Math.abs(r.delta) / 100) > 0);
    const rowShares = sharePercents(listed.map((r) => r.amount)); // of personal spending, adding up to 100%

    return html`
      <header class="screen__header">
        <h1 class="large-title">分析</h1>
      </header>
      ${periodSwitcher(p, { prevKey: prevP.key, nextKey: nextP.key, currentKey: currentP.key, canNext: !isCurrentP && nextP.start <= today })}

      ${overview({ s, isCurrent: isCurrentP, untracked: ev.untracked, personal: personalByCategory(txs, p), cat, cash: isCurrentP ? cash : null, rw, today, outlook })}

      ${ev.untracked ? '' : html`<section class="section">
        <h2 class="section__title">吉隆坡 24 岁创业者对照 ${infoButton('bench')}</h2>
        ${infoPanel('bench', html`<p>
            ${ev.model
              ? `每月预计个人生活费 = 个人固定项目 ${formatMoney(fixedShown, { round: true })} + 日常开销 ${formatMoney(dailyShown, { round: true })}（按近 ${ev.model.days} 天的平均速度）。`
              : ''}
            不含创业投入${s.business ? `（${THIS} ${formatMoney(s.business, { round: true })}）` : ''}${ev.insurance > 0 ? `，也不含保险（${ev.model ? '每月' : THIS} ${formatMoney(ev.insurance, { round: true })}）：保险是保障，不算生活费；EPF 的标准里也没有保险` : ''}。
            ${!ev.model && ev.isPartial ? `这一期只记录了 ${Math.round(ev.elapsed * 100)}% 的天数，日常开销已推算到${cycle ? '整期' : '整月'}。` : ''}
            ${ev.normalized ? `本期共 ${p.days} 天（${p.label}），已换算成 30 天和每月参考值比较。` : ''}
          </p>
          <button type="button" class="link" data-sources>参考资料</button>`)}
        <div class="card card--benchmark" data-tier="${ev.tier}">
          <div class="benchmark__head">
            ${statusBadge(ev.tier)}
            <span class="benchmark__profile" data-edit-profile role="button" tabindex="0">${housing} · ${transport} ${icon('chevron-right')}</span>
          </div>
          <p class="benchmark__amount">
            <span>${ev.model ? '每月预计个人生活费' : ev.isPartial ? `${THIS}推算个人生活费` : '个人生活费'}${ev.normalized ? '（按 30 天）' : ''}</span>
            <strong>${formatMoney(ev.perMonth, { round: true })}</strong>
          </p>
          ${tierGauge({ value: ev.perMonth, tiers: ev.tiers, label: '生活费对照' })}
          <div class="gauge__legend">
            <span data-tone="lean">精简</span><span data-tone="ok">合理</span><span data-tone="high">偏高</span><span data-tone="over">过高</span>
          </div>
        </div>
      </section>`}

      <section class="section">
        <h2 class="section__title">重点</h2>
        <ul class="insights">
          ${insights.map((i) => html`<li class="insight" data-tone="${i.tone}">
            <button type="button" class="insight__head" ${infoAttrs(`insight-${i.id}`)}>
              <span class="insight__icon">${icon(i.icon)}</span>
              <strong class="insight__title">${i.title}</strong>
              ${i.figure ? html`<span class="insight__figure">${i.figure}</span>` : ''}
              ${icon('chevron-down', 'insight__chevron')}
            </button>
            ${infoPanel(`insight-${i.id}`, html`<p>${i.body}</p>`, 'insight__body')}
          </li>`)}
        </ul>
      </section>

      ${listed.length || s.business ? html`
        <section class="section">
          <h2 class="section__title">类别明细 ${infoButton('cats')}</h2>
          ${infoPanel('cats', html`<p>右边是${isCurrentP ? `${THIS}到今天` : THIS}花的钱；标签按${ev.model ? '每月估算（固定项目 + 近期日常开销）' : ev.normalized ? '按 30 天换算的金额' : '这个金额'}对照吉隆坡 24 岁创业者每月的合理区间（「参考」后面的数字，RM／月）。创业投入单独计算，不影响生活费评估。</p>`)}
          <div class="card card--flush">
            ${s.personal > 0 ? html`<div class="card__pad">
              ${stackBar(listed.filter((r) => r.amount > 0).map((r) => ({ id: r.categoryId, value: r.amount, color: cat(r.categoryId).color, label: cat(r.categoryId).name })))}
            </div>` : ''}
            <ul class="list list--plain">
              ${listed.map((r, i) => html`<li class="row row--static">
                ${catIcon(cat(r.categoryId))}
                <span class="row__body">
                  <span class="row__title">${cat(r.categoryId).name}</span>
                  <span class="row__subtitle">${r.categoryId === 'insurance'
                    ? facts('保障，不算进生活费评估', `${rowShares[i]}%`)
                    : facts(
                      r.monthly !== null && r.monthly !== undefined ? `每月约 ${formatMoney(r.monthly, { round: true })}` : r.per30 !== null && r.per30 !== undefined ? `按 30 天约 ${formatMoney(r.per30, { round: true })}` : '',
                      r.range ? `参考 ${r.range[0]}–${r.range[1]}` : '无参考值',
                      `${rowShares[i]}%`,
                    )}</span>
                </span>
                <span class="row__trail">
                  <span class="row__value">${formatMoney(r.amount, { round: true })}</span>
                  ${r.range && !ev.untracked ? statusBadge(r.status) : ''}
                </span>
              </li>`)}
              ${s.business ? html`<li class="row row--static">
                ${catIcon(cat('business'))}
                <span class="row__body"><span class="row__title">创业投入</span><span class="row__subtitle">单独计算</span></span>
                <span class="row__trail"><span class="row__value">${formatMoney(s.business, { round: true })}</span></span>
              </li>` : ''}
            </ul>
          </div>
          ${groupSplit(s, !!ev.model)}
        </section>` : ''}

      ${cmp.comparable && (cmp.previous.expense > 0 || cmp.current.expense > 0) ? html`
        <section class="section">
          <div class="section__header">
            <h2 class="section__title">${cycle ? '与上一期相比' : `与${monthLabel(cmp.prevYm, false)}相比`}${cmp.sameDays ? html` <span class="section__hint">前 ${cmp.sameDays} 天</span>` : ''} ${infoButton('compare')}</h2>
            <span class="section__meta ${!cmpRM ? '' : cmp.delta > 0 ? 'is-up' : 'is-down'}">${formatMoney(cmp.delta, { round: true, sign: true })}${cmp.ratio !== null ? ` (${formatPercent(cmp.ratio, 0, { sign: true })})` : ''}</span>
          </div>
          ${infoPanel('compare', html`<p>比的是个人支出，创业投入不算在内。右侧为增加，左侧为减少${cmp.sameDays
            ? `。${THIS}还没结束，所以两期都只比较前 ${cmp.sameDays} 天的日常开销；固定项目（房租、保险、订阅等）每期扣的日子不同，也先不算`
            : cmp.normalized ? '；两期都按 30 天换算' : ''}。</p>`)}
          <div class="card">
            ${cmpRows.length
              ? divergeList(cmpRows.slice(0, 6).map((r) => ({ ...r, label: cat(r.categoryId).name })))
              : html`<p class="muted">和上个月一样。</p>`}
          </div>
        </section>` : ''}

      <section class="section">
        <h2 class="section__title">${cycle ? '近 6 个收入周期' : '近 6 个月'}</h2>
        <div class="card">
          ${trendChart(rows, { selected: Math.min(tIdx, rows.length - 1), budget: plan.hasPlan && plan.usesExpected ? plan.budget : 0, personalOnly: !settings.budgetIncludesBusiness })}
        </div>
      </section>

      ${runwayCard(rw, settings, savingsNow, cash, today)}
    `;
  },

  onClick(e, ctx) {
    if (e.target.closest('[data-open-cash]')) { haptic(); openCashSheet(); return; }
    const m = e.target.closest('[data-period]');
    if (m && !m.disabled) { ui.key = m.dataset.period; ui.trendIndex = null; haptic(); ctx.rerender(); return; }
    const col = e.target.closest('[data-trend-i]');
    if (col) { ui.trendIndex = Number(col.dataset.trendI); haptic(); ctx.rerender(); return; }
    if (e.target.closest('[data-sources]')) { openSources(); return; }
    if (e.target.closest('[data-edit-profile]')) { editProfile(ctx); }
  },
};

/**
 * Shares of personal spending — the base the guide (and the 重点 insight) uses; business spending is counted apart.
 * `running`: the period is still running, so these are the shares so far (the insight judges a month's estimate).
 */
function groupSplit(s, running) {
  const total = s.personal;
  if (!total) return '';
  const parts = ['need', 'want', 'growth', 'other']
    .map((g) => ({ g, v: s.byGroup[g] || 0 }))
    .filter((p) => p.v > 0);
  const shares = sharePercents(parts.map((p) => p.v));
  return html`<div class="card card--groups">
    <h3 class="card__title">钱花在哪一类${running ? html` <span class="section__hint">目前</span>` : ''} ${infoButton('groups')}</h3>
    <ul class="groups">
      ${parts.map((p, i) => html`<li class="groups__row" data-group="${p.g}">
        <span class="groups__label">${GROUP_LABELS[p.g]}</span>
        ${progress({ ratio: p.v / total, tone: `group-${p.g}`, label: GROUP_LABELS[p.g] })}
        <span class="groups__value">${shares[i]}%</span>
      </li>`)}
    </ul>
    ${infoPanel('groups', html`<p>按个人开销计算${s.business ? `，创业投入 ${formatMoney(s.business, { round: true })} 另计` : ''}。建议：必要开销 ≤ 60%，生活享受 ≤ 25%，每月至少存下 20%。</p>`)}
  </div>`;
}

/** A total and its fixed part in whole ringgit, the rest as the difference — so the parts shown add up to the total. */
function roundedParts(total, fixed) {
  const fixedRM = Math.round(fixed / 100);
  return [fixedRM * 100, (Math.round(total / 100) - fixedRM) * 100];
}

function runwayCard(rw, settings, savingsNow, cash, today) {
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
  // Rounded down once to the tenth shown, and judged on that figure (the overview tile shows the same).
  const months = runwayShown(rw?.months);
  const tone = months === null || months === undefined ? 'info' : months >= rw.target ? 'good' : months >= 3 ? 'warn' : 'bad';
  const [fixedShown, dailyShown] = rw ? roundedParts(rw.avg, rw.fixed) : [0, 0];
  return html`<section class="section">
    <h2 class="section__title">个人 Runway ${rw ? infoButton('runway') : ''}</h2>
    ${rw ? infoPanel('runway', html`<p>${months === null
      ? '记录满 7 天后，就能算出每月开销和 Runway。'
      : `每月开销 ${formatMoney(rw.avg, { round: true })} = 固定项目 ${formatMoney(fixedShown, { round: true })} + 日常开销 ${formatMoney(dailyShown, { round: true })}（按近 ${rw.days} 天的平均速度）。${months >= rw.target ? '已达到 6 个月的安全线。' : `建议至少储备 ${rw.target} 个月生活费作为创业安全垫。`}`}</p>
      <p>「目前存款」${cash ? `是${dayLabel(cash.at, today)}对账填的数字，之后` : ''}跟着记的收入和支出自动加减；有漏记的话它会偏高，隔一段时间在「今天」页点「手上的钱」对一次账就准了。${rw.oneOffBusiness > 0 ? `一次性的创业支出（近 ${rw.days} 天共 ${formatMoney(rw.oneOffBusiness, { round: true })}）不算进每月开销；如果是每月都要付的（例如分期还款），把它设成固定项目就会算进去。` : ''}</p>`) : ''}
    <div class="card card--runway" data-tone="${tone}">
      ${rw ? html`
        <div class="runway__main">
          <span class="runway__value">${months === null ? '—' : months >= 99 ? '99+' : months.toFixed(1)}</span>
          <span class="runway__unit">个月</span>
        </div>
        <p class="runway__text">目前存款 ${formatMoney(savingsNow, { round: true })}${months === null ? '' : html` ÷ 每月开销 <strong>${formatMoney(rw.avg, { round: true })}</strong>`}</p>` : ''}
      ${goal ? html`
        <div class="goal">
          <div class="goal__head"><span>${settings.goalName}</span><span>${formatMoney(Math.max(0, savingsNow), { round: true })} / ${formatMoney(goal, { round: true })}</span></div>
          ${progress({ ratio: Math.max(0, savingsNow) / goal, tone: 'save', label: settings.goalName })}
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
