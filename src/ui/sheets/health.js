// 资料检查 — lists findings from core/health.js with one-tap fixes. Everything runs on the phone.
import { html, icon, catIcon, mount, money } from '../html.js';
import { openSheet, toast } from '../overlays.js';
import { haptic } from '../haptics.js';
import {
  state, subscribe, saveSettings, saveRecurring, addTransaction, deleteTransaction, restoreTransaction,
} from '../../data/store.js';
import { checkData, checkedRange } from '../../core/health.js';
import { categoryMap, unknownCategory } from '../../core/categories.js';
import { formatMoney } from '../../core/money.js';
import { dayLabel, todayISO } from '../../core/dates.js';
import { openEntrySheet } from './entry.js';
import { openPlanSheet, openMoneySheet } from './plan.js';

/** Current findings (ignored ones left out). */
export function healthIssues() {
  return checkData({
    transactions: state.transactions, categories: state.categories, recurring: state.recurring,
    settings: state.settings, today: todayISO(),
  });
}

const FIX_LABEL = { delete: '删除多出来的', 'add-fixed': '补记这一笔', 'set-day': '改扣款日', plan: '设定收入', savings: '填写存款' };

export function openHealthCheck() {
  let unsub = null;
  const sheet = openSheet({
    title: '资料检查',
    size: 'large',
    body: html`<div class="health"></div>`,
    onClose: () => unsub?.(),
    onMount(el) {
      el.addEventListener('click', async (e) => {
        const row = e.target.closest('[data-tx]');
        if (row) {
          const tx = state.transactions.find((t) => t.id === row.dataset.tx);
          if (tx) openEntrySheet({ tx });
          return;
        }
        const b = e.target.closest('[data-fix], [data-ignore], [data-unignore]');
        if (!b) return;
        haptic();
        if (b.dataset.unignore !== undefined) { await saveSettings({ healthIgnored: [] }); return; }
        const issue = healthIssues().find((i) => i.id === (b.dataset.fix || b.dataset.ignore));
        if (!issue) return;
        if (b.dataset.ignore) {
          await saveSettings({ healthIgnored: [...state.settings.healthIgnored, issue.id] });
          toast('已忽略这一项', { icon: 'check' });
          return;
        }
        await applyFix(issue.fix);
      });
    },
  });
  const root = sheet.body.querySelector('.health');
  unsub = subscribe(render);
  render();

  function render() {
    const issues = healthIssues();
    const cats = categoryMap(state.categories);
    const cat = (id) => cats.get(id) || unknownCategory();
    const byId = new Map(state.transactions.map((t) => [t.id, t]));
    const range = checkedRange(state.transactions);
    const warn = issues.filter((i) => i.level === 'warn').length;
    const ignored = state.settings.healthIgnored.length;
    mount(root, html`
      <p class="callout ${issues.length ? '' : 'callout--good'}">${icon(issues.length ? 'info' : 'shield')}<span>
        ${issues.length
          ? `检查了 ${state.transactions.length} 笔记录${range ? `（${dayLabel(range.from)} – ${dayLabel(range.to)}）` : ''}，发现 ${issues.length} 项${warn ? `，其中 ${warn} 项很可能影响分析` : '值得看一下'}。`
          : `检查了 ${state.transactions.length} 笔记录和所有设定，没有发现问题。`}
        资料只在这台手机上检查。</span></p>
      ${issues.map((i) => html`<section class="card health-item" data-level="${i.level}">
        <div class="health-item__head">
          <span class="health-item__icon">${icon(i.level === 'warn' ? 'warning' : 'info')}</span>
          <h3 class="health-item__title">${i.title}</h3>
        </div>
        <p class="health-item__body">${i.body}</p>
        ${i.txIds.length ? html`<ul class="list list--plain health-item__rows">
          ${i.txIds.map((id) => byId.get(id)).filter(Boolean).map((t) => html`<li><button type="button" class="row" data-tx="${t.id}">
            ${catIcon(cat(t.categoryId), 'cat-icon--xs')}
            <span class="row__body"><span class="row__title">${t.note || cat(t.categoryId).name}</span>
              <span class="row__subtitle">${dayLabel(t.date)}${t.recurringId ? ' · 固定项目' : ''}</span></span>
            <span class="row__value ${t.type === 'income' ? 'is-income' : ''}">${money(t.type === 'income' ? t.amount : -t.amount, { sign: t.type === 'income' })}</span>
            ${icon('chevron-right', 'row__chevron')}
          </button></li>`)}
        </ul>` : ''}
        <div class="action-row">
          ${i.fix ? html`<button type="button" class="btn btn--primary btn--small" data-fix="${i.id}">${fixLabel(i.fix)}</button>` : ''}
          <button type="button" class="btn btn--glass btn--small" data-ignore="${i.id}">没问题，忽略</button>
        </div>
      </section>`)}
      ${ignored ? html`<p class="section__footer">已忽略 ${ignored} 项。<button type="button" class="link" data-unignore>重新显示</button></p>` : ''}
      <p class="section__footer">会检查：重复记录、固定项目漏记或记了两次、扣款日不对、未来日期、类别不符、金额异常大、开始记账前的零星记录，以及收入与存款设定。</p>
    `);
  }
}

function fixLabel(fix) {
  if (fix.type === 'set-day') return `改成每月 ${fix.day} 号`;
  return FIX_LABEL[fix.type] || '修正';
}

async function applyFix(fix) {
  switch (fix.type) {
    case 'delete': {
      const removed = await deleteTransaction(fix.txId);
      if (removed) {
        haptic('success');
        toast(`已删除 ${formatMoney(removed.amount)} · ${dayLabel(removed.date)}`, {
          icon: 'trash', action: { label: '撤销', onClick: () => restoreTransaction(removed) },
        });
      }
      break;
    }
    case 'add-fixed': {
      const r = state.recurring.find((x) => x.id === fix.recurringId);
      if (!r) break;
      await addTransaction({ type: r.type, amount: r.amount, categoryId: r.categoryId, date: fix.date, note: r.note, business: r.business });
      haptic('success');
      toast(`已补记 ${r.note || ''} ${formatMoney(r.amount)}`, { icon: 'check', tone: 'success' });
      break;
    }
    case 'set-day': {
      const r = state.recurring.find((x) => x.id === fix.recurringId);
      if (!r) break;
      await saveRecurring({ ...r, day: fix.day });
      haptic('success');
      toast(`「${r.note || '固定项目'}」改成每月 ${fix.day} 号`, { icon: 'check', tone: 'success' });
      break;
    }
    case 'plan': await openPlanSheet(); break;
    case 'savings': {
      const v = await openMoneySheet({ title: '目前存款', label: '现在总共有多少存款', value: state.settings.currentSavings, hint: '包括银行存款、定存等随时可以动用的钱（投资另计）。' });
      if (v !== null) await saveSettings({ currentSavings: v });
      break;
    }
    default: break;
  }
}
