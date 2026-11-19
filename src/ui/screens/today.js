// 今天 — one glance. The scene is water: its level is what today may still spend. On the panel only what the day
// needs: the money on hand, the things bought most often this month (one tap records one again), and the last
// 24 hours of entries, with the way to everything else. How the period is going lives in 分析.
import { html, icon, catIcon, money, facts } from '../html.js';
import { attachWater } from '../water.js';
import { dailyBudget, quickPicks } from '../../core/analysis.js';
import { infoButton, infoPanel } from '../info.js';
import { categoryMap, unknownCategory } from '../../core/categories.js';
import { formatMoney } from '../../core/money.js';
import { addDays, dayLabel, longDateLabel, timeGreeting } from '../../core/dates.js';
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
const STALE_CASH_DAYS = 14; // the money on hand hasn't been checked for this long → suggest it on the tile
const PICK_DAYS = 30;       // 常用 looks at the last month only, so it follows what is bought now
const PICK_LIMIT = 4;
const RECENT_MS = 24 * 3_600_000;
const RECENT_MAX = 5;

/** The entries of the last 24 hours, newest first: today's, and yesterday's that were typed in less than a day ago. */
function recentEntries(txs, today) {
  const yesterday = addDays(today, -1);
  const since = Date.now() - RECENT_MS;
  return txs
    .filter((t) => t.date === today || (t.date === yesterday && t.createdAt >= since))
    .sort((a, c) => (a.date === c.date ? c.createdAt - a.createdAt : a.date < c.date ? 1 : -1));
}

const screen = {
  id: 'today',
  title: '今天',
  picks: [],

  render({ state, today, demo }) {
    const cash = currentCash(today);
    const b = dailyBudget({ txs: state.transactions, settings: state.settings, recurring: state.recurring, today, cash });
    const cats = categoryMap(state.categories);
    const recent = recentEntries(state.transactions, today);
    const month = addDays(today, -PICK_DAYS);
    screen.picks = quickPicks(state.transactions.filter((t) => t.date > month), today, PICK_LIMIT);
    const h = hero(b, cycleNote(b.period, state.transactions, today));

    return html`
      <section class="scene scene--today" data-tone="${h.tone}">
        <canvas class="water" data-level="${h.level.toFixed(3)}" aria-hidden="true"></canvas>
        <div class="scene__content">
          <header class="scene__top">
            <p class="eyebrow">${longDateLabel(today)} · ${timeGreeting()}</p>
            <h1 class="large-title">今天</h1>
          </header>
          ${h.figure}
        </div>
      </section>

      <div class="panel">
        ${h.notes}
        ${banners(state, demo)}
        ${cashTile(cash, today)}

        ${screen.picks.length ? html`
          <section class="section">
            <h2 class="section__title">常用</h2>
            <div class="picks">
              ${screen.picks.map((p, i) => {
                const c = cats.get(p.categoryId) || unknownCategory();
                return html`<button type="button" class="pick" data-action="quick" data-i="${i}" aria-label="记一笔 ${p.note || c.name} ${formatMoney(p.amount)}">
                  ${catIcon(c)}
                  <span class="pick__name">${p.note || c.name}</span>
                  <span class="pick__amount">${formatMoney(p.amount)}</span>
                </button>`;
              })}
            </div>
          </section>` : ''}

        <section class="section">
          <div class="section__header">
            <h2 class="section__title">最近 24 小时</h2>
            <a class="link" href="#/history">全部记录</a>
          </div>
          ${recent.length
            ? html`<ul class="list">${recent.slice(0, RECENT_MAX).map((t) => txRow(t, cats.get(t.categoryId) || unknownCategory(t.type), { today, showDate: false }))}</ul>
                ${recent.length > RECENT_MAX ? html`<a class="more" href="#/history">还有 ${recent.length - RECENT_MAX} 笔</a>` : ''}`
            : html`<div class="empty-state empty-state--quiet">
                <span class="empty-state__icon">${icon('sparkles')}</span>
                <h3>这 24 小时还没有记录</h3>
                <button type="button" class="btn btn--primary" data-action="add">记一笔</button>
              </div>`}
        </section>
      </div>
    `;
  },

  afterRender(el, ctx) {
    const canvas = el.querySelector('.water');
    if (canvas) attachWater(canvas, { level: Number(canvas.dataset.level), fresh: ctx.entering });
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

/**
 * The scene's figure and what belongs to it: { tone, level (0 → 1 of today's allowance still there: the water),
 * figure (in the scene), notes (the first thing on the panel: warnings, and how the figure was worked out behind ⓘ) }.
 */
function hero(b, cycleLine = '') {
  if (b.status === 'none') {
    return {
      tone: 'calm', level: 0.56, notes: '',
      figure: html`<div class="allowance allowance--setup">
        <span class="allowance__label">每日额度</span>
        <strong class="allowance__setup">设定每月收入，就能知道今天还能花多少</strong>
        <button type="button" class="btn btn--primary" data-open-plan>开始设定</button>
      </div>`,
    };
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
  const level = overPeriod || over || b.allowanceToday <= 0 ? 0 : Math.min(1, b.leftToday / b.allowanceToday);
  const personal = b.spentAll - b.spentBusiness;
  // Whole ringgit that add up: round the total and the business part, personal is the rest.
  const allRM = Math.round(b.spentAll / 100);
  const bizRM = Math.round(b.spentBusiness / 100);
  // With savings set aside (对账 → 其中存款), only the rest is spending money.
  const kept = b.cash?.kept || 0;
  const usable = b.cash ? formatMoney(b.cash.balance - kept, { round: true }) : '';
  const keptNote = kept ? `（存款 ${formatMoney(kept, { round: true })} 不动用）` : '';
  const WHAT = kept ? '能用的钱' : '手上的钱';
  // Warnings stay in view; how the figure was worked out folds behind the ⓘ beside the label.
  const lines = [
    html`<li>${icon('target')}<span>每日额度 ${formatMoney(Math.max(0, b.allowanceToday))}，今天已花 ${formatMoney(b.shownToday)}。</span></li>`,
    cashLimit && !overPeriod ? html`<li>${icon('wallet')}<span>按${WHAT}算：约 ${usable}${keptNote}，扣掉${THIS}还要付的固定支出 ${formatMoney(b.reservedAll, { round: true })}，平均到剩下 ${b.daysLeft} 天。比按预算算的少，所以按这个。</span></li>` : '',
    cycleLine ? html`<li>${icon('calendar')}<span>${cycleLine}</span></li>` : '',
    b.prorated ? html`<li>${icon('info')}<span>从${dayLabel(b.startDate)}开始记录，${THIS}预算已按剩余天数折算为 ${formatMoney(b.budget, { round: true })}${b.fixedTracked > 0 ? `（这之后才扣的固定支出 ${formatMoney(b.fixedTracked, { round: true })} 全额算在内）` : ''}</span></li>` : '',
    !cashLimit && b.reserved > 0 ? html`<li>${icon('clock')}<span>已预留${THIS}未到期的固定支出 ${formatMoney(b.reserved, { round: true })}</span></li>` : '',
    b.nextIncomeBills > 0 ? html`<li>${icon('calendar')}<span>${dayLabel(addDays(b.billsUntil, 1))}起到期的固定支出约 ${formatMoney(b.nextIncomeBills, { round: true })}（例如房租）留给下次收入付，不从现在的钱里预留</span></li>` : '',
    b.fixedToday > 0 ? html`<li>${icon('clock')}<span>今天的固定支出 ${formatMoney(b.fixedToday, { round: true })} 已提前预留，不占今天的额度</span></li>` : '',
    b.spentBusiness > 0 ? html`<li>${icon('business')}<span>${b.countsBusiness
      ? `${THIS}已花 ${formatMoney(allRM * 100, { round: true })}：个人 ${formatMoney((allRM - bizRM) * 100, { round: true })} + 创业 ${formatMoney(bizRM * 100, { round: true })}（都算进预算）`
      : `${THIS}创业支出 ${formatMoney(b.spentBusiness, { round: true })} 不占预算（个人 ${formatMoney(personal, { round: true })}）`}</span></li>` : '',
  ].filter(Boolean);
  const warning = cashLimit && overPeriod
    ? `${WHAT}约 ${usable}${keptNote}，不够付到${dayLabel(b.period.end)}还要扣的固定支出 ${formatMoney(b.reservedAll, { round: true })}，还差 ${formatMoney(-b.leftMonth, { round: true })}。`
    : overPeriod ? (overAhead
      ? `已花的加上还没扣的固定支出，超过了${THIS}预算，接下来每一笔都会动用存款目标。`
      : `${THIS}预算已用完，接下来每一笔都会动用存款目标。`) : '';
  return {
    tone, level,
    figure: html`<div class="allowance" data-tone="${tone}">
      <div class="allowance__label"><span>${label}</span>${lines.length ? infoButton('hero', '额度怎么算') : ''}</div>
      <div class="allowance__amount" data-motion="count" data-motion-key="hero" data-value="${amount}">${money(amount, { cls: 'money--hero' })}</div>
      <p class="allowance__sub">今天已花 ${formatMoney(b.shownToday)}</p>
    </div>`,
    notes: warning || lines.length ? html`<section class="hero-notes">
      ${warning ? html`<p class="callout callout--bad">${icon('warning')}<span>${warning}</span></p>` : ''}
      ${lines.length ? infoPanel('hero', html`<ul class="info-list">${lines}</ul>`) : ''}
    </section>` : '',
  };
}

/** 手上的钱: the balance carried forward from the last check (对账), one tap to check it again. */
function cashTile(cash, today) {
  if (!cash) {
    return html`<button type="button" class="card cash-tile" data-open-cash>
      <span class="cash-tile__icon">${icon('wallet')}</span>
      <span class="cash-tile__body"><span class="cash-tile__label">手上的钱</span></span>
      <span class="cash-tile__cta">去填写</span>
    </button>`;
  }
  const stale = cash.days >= STALE_CASH_DAYS;
  const note = facts(cash.kept ? `能用 ${formatMoney(cash.spendable, { round: true })}` : '', stale ? `${cash.days} 天没对账` : '');
  return html`<button type="button" class="card cash-tile" data-open-cash data-tone="${stale ? 'warn' : ''}" aria-label="手上的钱，${dayLabel(cash.at, today)}对账，点一下核对">
    <span class="cash-tile__icon">${icon('wallet')}</span>
    <span class="cash-tile__body"><span class="cash-tile__label">手上的钱</span>
      ${cash.kept || stale ? html`<span class="cash-tile__sub">${note}</span>` : ''}</span>
    <span class="cash-tile__value" data-motion="count" data-motion-key="cash" data-value="${cash.balance}">${money(cash.balance, { cls: 'money--row' })}</span>
  </button>`;
}

export default screen;
