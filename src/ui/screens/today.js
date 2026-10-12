// 今天 — daily allowance, month rings, one-tap quick picks, and today's entries.
import { html, icon, catIcon, money } from '../html.js';
import { activityRings, progress } from '../charts.js';
import { dailyBudget, quickPicks } from '../../core/analysis.js';
import { categoryMap, unknownCategory } from '../../core/categories.js';
import { formatMoney, formatPercent } from '../../core/money.js';
import { dayLabel, longDateLabel, timeGreeting } from '../../core/dates.js';
import { cycleNote } from '../../core/periods.js';
import { txRow } from './shared.js';
import { openPlanSheet } from '../sheets/plan.js';
import { openInstallGuide, isStandalone, isIOS } from '../sheets/guides.js';
import { openBackupSheet, exportBackup } from '../sheets/backup.js';
import { backupNowToDrive } from '../sheets/cloud.js';
import { backupDue, backupAgeDays, backupAgeText } from '../../core/settings.js';
import { openHealthCheck, healthIssues } from '../sheets/health.js';
import { openCashSheet, currentCash } from '../sheets/cash.js';

const BACKUP_NUDGE_DAYS = 30;
const STALE_CASH_DAYS = 14; // the money on hand hasn't been checked for this long → suggest it on the card

const screen = {
  id: 'today',
  title: '今天',
  picks: [],

  render({ state, today, demo }) {
    const cash = currentCash(today);
    const b = dailyBudget({ txs: state.transactions, settings: state.settings, recurring: state.recurring, today, cash });
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
      ${hero(b, cycleNote(b.period, state.transactions, today))}
      ${monthCard(b, state.settings)}
      ${cashCard(cash, today)}

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
    else if (e.target.closest('[data-open-cash]')) openCashSheet();
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
    const when = last ? `上次备份：${backupAgeText(last)}` : '还没有备份过';
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
        <span class="banner__text"><strong>${Number.isFinite(days) ? `已经 ${backupAgeDays(s.lastBackupAt)} 天没有备份` : '还没有备份过'}</strong><span>资料只存在这台手机，建议开启自动备份</span></span>
        ${icon('chevron-right', 'banner__chevron')}
      </button>`);
    }
  }
  return out;
}

function hero(b, cycleLine = '') {
  if (b.status === 'none') {
    return html`<button type="button" class="card card--hero card--setup" data-open-plan>
      <span class="card__eyebrow">${icon('target')} 每日额度</span>
      <strong class="card--setup__title">设定每月收入，就能知道今天还能花多少</strong>
      <span class="card--setup__cta">开始设定 ${icon('chevron-right')}</span>
    </button>`;
  }
  const cycle = b.period.kind === 'cycle';
  const THIS = cycle ? '本期' : '本月';
  // Past the period's budget the per-day figure means nothing (it only gets more negative as days run out):
  // show how far over the whole period is. When the money on hand is what limits (b.limit === 'cash'), "over"
  // means it can't cover the fixed items still due.
  const cashLimit = b.limit === 'cash';
  const overPeriod = b.status === 'overMonth';
  // Over only because of the fixed items still to come: nothing past the budget has been spent yet.
  const overAhead = overPeriod && !cashLimit && b.spentMonth <= b.budget;
  const over = b.leftToday < 0;
  const label = overPeriod ? (cashLimit ? (b.cash?.kept ? '能用的钱不够' : '手上的钱不够') : overAhead ? `${THIS}预计超支` : `${THIS}已超支`) : over ? '今天已超出' : '今天还能花';
  const amount = overPeriod ? -b.leftMonth : Math.abs(b.leftToday);
  const tone = overPeriod ? 'bad' : over ? 'warn' : 'good';
  const personal = b.spentAll - b.spentBusiness;
  // Whole ringgit that add up: round the total and the business part, personal is the rest.
  const allRM = Math.round(b.spentAll / 100);
  const bizRM = Math.round(b.spentBusiness / 100);
  // With savings set aside (对账 → 其中存款), only the rest is spending money.
  const kept = b.cash?.kept || 0;
  const usable = b.cash ? formatMoney(b.cash.balance - kept, { round: true }) : '';
  const keptNote = kept ? `（存款 ${formatMoney(kept, { round: true })} 不动用）` : '';
  const WHAT = kept ? '能用的钱' : '手上的钱';
  return html`<section class="card card--hero" data-tone="${tone}">
    <span class="card__eyebrow">${label}</span>
    <div class="hero-amount" data-motion="digits" data-motion-key="hero">${money(amount, { cls: 'money--hero' })}</div>
    <p class="hero-sub">
      每日额度 ${formatMoney(Math.max(0, b.allowanceToday))} · 今天已花 ${formatMoney(b.shownToday)}
    </p>
    ${progress({ ratio: b.usedRatio, marker: b.monthProgress, tone: tone === 'good' ? 'spend' : tone, label: `${THIS}预算使用`, key: 'hero' })}
    <div class="hero-foot">
      <span>${overPeriod
        ? (cashLimit ? html`还要付的固定支出 <strong>${formatMoney(b.reservedAll, { round: true })}</strong>` : html`${THIS}预算 <strong>${formatMoney(b.budget, { round: true })}</strong>`)
        : cashLimit ? html`手上可用 <strong>${formatMoney(b.leftMonth, { round: true })}</strong>` : html`${THIS}还剩 <strong>${formatMoney(b.leftMonth, { round: true })}</strong>`}</span>
      <span>还有 ${b.daysLeft} 天</span>
    </div>
    ${cashLimit ? html`<p class="hero-note ${overPeriod ? 'hero-note--bad' : ''}">${icon(overPeriod ? 'warning' : 'wallet')} ${overPeriod
      ? `${WHAT}约 ${usable}${keptNote}，不够付到${dayLabel(b.period.end)}还要扣的固定支出 ${formatMoney(b.reservedAll, { round: true })}，还差 ${formatMoney(-b.leftMonth, { round: true })}。`
      : `按${WHAT}算：约 ${usable}${keptNote}，扣掉${THIS}还要付的固定支出 ${formatMoney(b.reservedAll, { round: true })}，平均到剩下 ${b.daysLeft} 天。比按预算算的少，所以按这个。`}</p>` : ''}
    ${cycleLine ? html`<p class="hero-note">${icon('calendar')} ${cycleLine}</p>` : ''}
    ${b.prorated ? html`<p class="hero-note">${icon('info')} 从${dayLabel(b.startDate)}开始记录，${THIS}预算已按剩余天数折算为 ${formatMoney(b.budget, { round: true })}${b.fixedTracked > 0 ? `（这之后才扣的固定支出 ${formatMoney(b.fixedTracked, { round: true })} 全额算在内）` : ''}</p>` : ''}
    ${!cashLimit && b.reserved > 0 ? html`<p class="hero-note">${icon('clock')} 已预留${THIS}未到期的固定支出 ${formatMoney(b.reserved, { round: true })}</p>` : ''}
    ${b.fixedToday > 0 ? html`<p class="hero-note">${icon('clock')} 今天自动记的固定支出 ${formatMoney(b.fixedToday, { round: true })} 已提前预留，不占今天的额度</p>` : ''}
    ${b.spentBusiness > 0 ? html`<p class="hero-note">${icon('business')} ${b.countsBusiness
      ? `${THIS}已花 ${formatMoney(allRM * 100, { round: true })}：个人 ${formatMoney((allRM - bizRM) * 100, { round: true })} + 创业 ${formatMoney(bizRM * 100, { round: true })}（都算进预算）`
      : `${THIS}创业支出 ${formatMoney(b.spentBusiness, { round: true })} 不占预算（个人 ${formatMoney(personal, { round: true })}）`}</p>` : ''}
    ${overPeriod && !cashLimit ? html`<p class="hero-note hero-note--bad">${icon('warning')} ${overAhead
      ? `已花的加上还没扣的固定支出，超过了${THIS}预算，接下来每一笔都会动用存款目标。`
      : `${THIS}预算已用完，接下来每一笔都会动用存款目标。`}</p>` : ''}
  </section>`;
}

function monthCard(b, settings) {
  const THIS = b.period.kind === 'cycle' ? '本期' : '本月';
  const bizOutside = !b.countsBusiness && b.spentBusiness > 0; // business spending is tracked but not part of the budget
  const target = settings.savingsTarget;
  const saveRatio = target > 0 ? Math.max(0, b.savedMonth) / target : 0;
  // A plan can leave RM 0 to spend (savings target = income): then any spending is over it.
  const spendRatio = b.budget > 0 ? b.spentMonth / b.budget : b.hasPlan && b.spentMonth > 0 ? Infinity : 0;
  const spendTone = spendRatio > 1 ? 'over' : 'spend';
  const spendSub = !b.hasPlan ? '未设定预算' : b.budget > 0 ? `预算的 ${formatPercent(spendRatio)}` : `预算为 RM 0${b.spentMonth > 0 ? ' · 已超出' : ''}`;
  return html`<section class="card card--rings">
    <div class="rings">
      ${activityRings([
        { ratio: spendRatio, tone: spendTone, label: `${THIS}支出占预算`, key: 'spend' },
        { ratio: saveRatio, tone: 'save', label: `${THIS}存款目标进度`, key: 'save' },
      ])}
      <ul class="rings__legend">
        <li class="rings__item" data-tone="${spendTone}">
          <span class="rings__label">${bizOutside ? `${THIS}个人支出` : `${THIS}支出`}</span>
          <span class="rings__value">${formatMoney(b.spentMonth, { round: true })}</span>
          <span class="rings__sub">${spendSub}${bizOutside ? ` · 另有创业 ${formatMoney(b.spentBusiness, { round: true })}` : ''}</span>
        </li>
        <li class="rings__item" data-tone="save">
          <span class="rings__label">${THIS}结余</span>
          <span class="rings__value">${formatMoney(b.savedMonth, { round: true })}</span>
          <span class="rings__sub">${target > 0
            ? (b.incomeMonth > 0 ? `存款目标 ${formatMoney(target, { round: true })} · ${formatPercent(Math.min(saveRatio, 9.99))}${bizOutside ? ' · 已扣创业' : ''}` : '记下收入后显示进度')
            : '未设定存款目标'}</span>
        </li>
      </ul>
    </div>
  </section>`;
}

/** 手上的钱: the balance carried forward from the last check (对账), one tap to check it again. */
function cashCard(cash, today) {
  if (!cash) {
    return html`<button type="button" class="card cash-card" data-open-cash>
      <span class="cash-card__icon">${icon('wallet')}</span>
      <span class="cash-card__body"><span class="cash-card__label">手上的钱</span>
        <span class="cash-card__sub">填一次，App 就按你记的收支帮你算着走</span></span>
      <span class="cash-card__cta">去填写</span>
      ${icon('chevron-right', 'cash-card__chevron')}
    </button>`;
  }
  const stale = cash.days >= STALE_CASH_DAYS;
  return html`<button type="button" class="card cash-card" data-open-cash data-tone="${stale ? 'warn' : ''}">
    <span class="cash-card__icon">${icon('wallet')}</span>
    <span class="cash-card__body"><span class="cash-card__label">手上的钱</span>
      <span class="cash-card__sub">${cash.kept ? `能用 ${formatMoney(cash.spendable, { round: true })} · 存款 ${formatMoney(cash.kept, { round: true })} 不动用 · ` : ''}${dayLabel(cash.at, today)}对账${cash.count ? ` · 之后记了 ${cash.count} 笔` : ''}${stale ? ` · ${cash.days} 天没对账，点一下核对` : ''}</span></span>
    <span class="cash-card__value" data-motion="digits" data-motion-key="cash">${money(cash.balance, { cls: 'money--row' })}</span>
    ${icon('chevron-right', 'cash-card__chevron')}
  </button>`;
}

export default screen;
