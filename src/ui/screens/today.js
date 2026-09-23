// 今天 — daily allowance, month rings, one-tap quick picks, and today's entries.
import { html, icon, catIcon, money } from '../html.js';
import { activityRings, progress } from '../charts.js';
import { dailyBudget, quickPicks } from '../../core/analysis.js';
import { categoryMap, unknownCategory } from '../../core/categories.js';
import { formatMoney, formatPercent } from '../../core/money.js';
import { dayLabel, longDateLabel, timeGreeting } from '../../core/dates.js';
import { txRow } from './shared.js';
import { openPlanSheet } from '../sheets/plan.js';
import { openInstallGuide, isStandalone, isIOS } from '../sheets/guides.js';
import { openBackupSheet, exportBackup } from '../sheets/backup.js';
import { backupNowToDrive } from '../sheets/cloud.js';
import { backupDue } from '../../core/settings.js';
import { openHealthCheck, healthIssues } from '../sheets/health.js';

const BACKUP_NUDGE_DAYS = 30;

const screen = {
  id: 'today',
  title: '今天',
  picks: [],

  render({ state, today, demo }) {
    const b = dailyBudget({ txs: state.transactions, settings: state.settings, recurring: state.recurring, today });
    const cats = categoryMap(state.categories);
    const todays = state.transactions
      .filter((t) => t.date === today)
      .sort((a, c) => c.createdAt - a.createdAt);
    const spentToday = todays.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
    const incomeToday = todays.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0);
    screen.picks = quickPicks(state.transactions, today);

    return html`
      <header class="screen__header">
        <p class="eyebrow">${longDateLabel(today)} · ${timeGreeting()}</p>
        <h1 class="large-title">今天</h1>
      </header>

      ${banners(state, demo)}
      ${hero(b)}
      ${monthCard(b, state.settings)}

      ${screen.picks.length ? html`
        <section class="section">
          <h2 class="section__title">常用 <span class="section__hint">点一下就记好</span></h2>
          <div class="chips chips--scroll">
            ${screen.picks.map((p, i) => {
              const c = cats.get(p.categoryId) || unknownCategory();
              return html`<button type="button" class="chip chip--pick" data-action="quick" data-i="${i}">
                ${catIcon(c, 'cat-icon--xs')}<span>${p.note || c.name}</span><span class="chip__value">${formatMoney(p.amount)}</span>
              </button>`;
            })}
          </div>
        </section>` : ''}

      <section class="section">
        <div class="section__header">
          <h2 class="section__title">今天的记录</h2>
          ${todays.length ? html`<span class="section__meta">支出 ${formatMoney(spentToday)}${incomeToday ? html` · 收入 ${formatMoney(incomeToday)}` : ''}</span>` : ''}
        </div>
        ${todays.length
          ? html`<ul class="list">${todays.map((t) => txRow(t, cats.get(t.categoryId) || unknownCategory(t.type), { showDate: false }))}</ul>
                 <p class="section__footer">向左滑动可删除，点一下可修改。</p>`
          : html`<div class="empty-state">
              <span class="empty-state__icon">${icon('sparkles')}</span>
              <h3>今天还没有记录</h3>
              <p>花了钱就点右下角的 <strong>＋</strong>，输入金额再点类别，3 秒完成。</p>
              <button type="button" class="btn btn--primary" data-action="add">记第一笔</button>
            </div>`}
      </section>
    `;
  },

  onClick(e, ctx) {
    if (e.target.closest('[data-open-plan]')) openPlanSheet();
    else if (e.target.closest('[data-open-install]')) openInstallGuide();
    else if (e.target.closest('[data-open-backup]')) openBackupSheet();
    else if (e.target.closest('[data-open-health]')) openHealthCheck();
    else if (e.target.closest('[data-backup-now]')) {
      if (ctx.state.settings.backupDest === 'gdrive') backupNowToDrive({ interactive: true });
      else exportBackup();
    }
  },
};

function banners(state, demo) {
  const out = [];
  if (!demo && isIOS() && !isStandalone()) {
    out.push(html`<button type="button" class="banner" data-open-install>
      <span class="banner__icon">${icon('add-home')}</span>
      <span class="banner__text"><strong>添加到主屏幕</strong><span>全屏使用、离线可用，资料也更安全</span></span>
      ${icon('chevron-right', 'banner__chevron')}
    </button>`);
  }
  // Only findings that very likely skew the numbers get a banner; the rest wait in 设置 → 资料检查.
  const warn = demo ? 0 : healthIssues().filter((i) => i.level === 'warn').length;
  if (warn) {
    out.push(html`<button type="button" class="banner banner--warn" data-open-health>
      <span class="banner__icon">${icon('warning')}</span>
      <span class="banner__text"><strong>资料检查发现 ${warn} 个可能的问题</strong><span>例如重复记录，可能让分析不准确</span></span>
      ${icon('chevron-right', 'banner__chevron')}
    </button>`);
  }
  const s = state.settings;
  const hasData = state.transactions.length >= 5 || state.holdings.length > 0;
  if (!demo && hasData && s.backupFreq !== 'off' && backupDue(s)) {
    const drive = s.backupDest === 'gdrive';
    const last = drive ? s.lastGdriveBackupAt : s.lastBackupAt;
    const when = last ? `上次备份：${Math.floor((Date.now() - last) / 86_400_000)} 天前` : '还没有备份过';
    out.push(html`<button type="button" class="banner banner--warn" data-backup-now>
      <span class="banner__icon">${icon(drive ? 'cloud' : 'shield')}</span>
      <span class="banner__text"><strong>${drive ? (s.gdriveConnected ? '该备份了 · 点一下备份到 Google Drive' : '连接 Google Drive 以备份') : '该备份了 · 点一下存到 iCloud'}</strong><span>${when}${drive ? ' · 已加密' : ' · 在分享菜单选「存储到文件」'}</span></span>
      ${icon('chevron-right', 'banner__chevron')}
    </button>`);
  } else if (!demo && s.backupFreq === 'off' && state.transactions.length >= 20) {
    const days = s.lastBackupAt ? (Date.now() - s.lastBackupAt) / 86_400_000 : Infinity;
    if (days > BACKUP_NUDGE_DAYS) {
      out.push(html`<button type="button" class="banner banner--warn" data-open-backup>
        <span class="banner__icon">${icon('shield')}</span>
        <span class="banner__text"><strong>${Number.isFinite(days) ? `已经 ${Math.floor(days)} 天没有备份` : '还没有备份过'}</strong><span>资料只存在这台手机，建议开启自动备份</span></span>
        ${icon('chevron-right', 'banner__chevron')}
      </button>`);
    }
  }
  return out;
}

function hero(b) {
  if (b.status === 'none') {
    return html`<button type="button" class="card card--hero card--setup" data-open-plan>
      <span class="card__eyebrow">${icon('target')} 每日额度</span>
      <strong class="card--setup__title">设定每月收入，就能知道今天还能花多少</strong>
      <span class="card--setup__cta">开始设定 ${icon('chevron-right')}</span>
    </button>`;
  }
  const over = b.leftToday < 0;
  const label = over ? '今天已超出' : '今天还能花';
  const tone = b.status === 'overMonth' ? 'bad' : over ? 'warn' : 'good';
  return html`<section class="card card--hero" data-tone="${tone}">
    <span class="card__eyebrow">${label}</span>
    <div class="hero-amount">${money(Math.abs(b.leftToday), { cls: 'money--hero' })}</div>
    <p class="hero-sub">
      每日额度 ${formatMoney(Math.max(0, b.allowanceToday))} · 今天已花 ${formatMoney(b.spentToday)}
    </p>
    ${progress({ ratio: b.usedRatio, marker: b.monthProgress, tone: tone === 'good' ? 'spend' : tone, label: '本月预算使用' })}
    <div class="hero-foot">
      <span>${b.leftMonth >= 0 ? html`本月还剩 <strong>${formatMoney(b.leftMonth, { round: true })}</strong>` : html`本月已超支 <strong>${formatMoney(-b.leftMonth, { round: true })}</strong>`}</span>
      <span>还有 ${b.daysLeft} 天</span>
    </div>
    ${b.prorated ? html`<p class="hero-note">${icon('info')} 从${dayLabel(b.startDate)}开始记录，本月预算已按剩余天数折算为 ${formatMoney(b.budget, { round: true })}</p>` : ''}
    ${b.reserved > 0 ? html`<p class="hero-note">${icon('clock')} 已预留本月未到期的固定支出 ${formatMoney(b.reserved, { round: true })}</p>` : ''}
    ${b.status === 'overMonth' ? html`<p class="hero-note hero-note--bad">${icon('warning')} 本月预算已用完，接下来每一笔都会动用存款目标。</p>` : ''}
  </section>`;
}

function monthCard(b, settings) {
  const target = settings.savingsTarget;
  const saveRatio = target > 0 ? Math.max(0, b.savedMonth) / target : 0;
  const spendRatio = b.budget > 0 ? b.spentMonth / b.budget : 0;
  const spendTone = spendRatio > 1 ? 'over' : 'spend';
  return html`<section class="card card--rings">
    <div class="rings">
      ${activityRings([
        { ratio: spendRatio, tone: spendTone, label: '本月支出占预算' },
        { ratio: saveRatio, tone: 'save', label: '本月存款目标进度' },
      ])}
      <ul class="rings__legend">
        <li class="rings__item" data-tone="${spendTone}">
          <span class="rings__label">本月支出</span>
          <span class="rings__value">${formatMoney(b.spentMonth, { round: true })}</span>
          <span class="rings__sub">${b.budget > 0 ? `预算的 ${formatPercent(spendRatio)}` : '未设定预算'}</span>
        </li>
        <li class="rings__item" data-tone="save">
          <span class="rings__label">本月结余</span>
          <span class="rings__value">${formatMoney(b.savedMonth, { round: true })}</span>
          <span class="rings__sub">${target > 0
            ? (b.incomeMonth > 0 ? `存款目标 ${formatMoney(target, { round: true })} · ${formatPercent(Math.min(saveRatio, 9.99))}` : '记下收入后显示进度')
            : '未设定存款目标'}</span>
        </li>
      </ul>
    </div>
  </section>`;
}

export default screen;
