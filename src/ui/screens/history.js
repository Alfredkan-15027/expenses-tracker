// 记录 — every entry for a month grouped by day, with search and type filter.
import { html, icon } from '../html.js';
import { txRow, monthSwitcher } from './shared.js';
import { categoryMap, unknownCategory } from '../../core/categories.js';
import { formatMoney } from '../../core/money.js';
import { dayLabel, monthOf, weekday } from '../../core/dates.js';
import { haptic } from '../haptics.js';

const ui = { ym: null, query: '', filter: 'all' };
const MAX_SEARCH_RESULTS = 300;

const screen = {
  id: 'history',
  title: '记录',

  render({ state, today }) {
    const current = monthOf(today);
    if (!ui.ym || ui.ym > current) ui.ym = current;
    const cats = categoryMap(state.categories);
    const q = ui.query.trim().toLowerCase();
    const searching = q.length > 0;

    let list = state.transactions;
    if (searching) {
      list = list.filter((t) => {
        const c = cats.get(t.categoryId);
        return (t.note || '').toLowerCase().includes(q) || (c?.name || '').toLowerCase().includes(q)
          || (t.amount / 100).toFixed(2).includes(q);
      });
    } else {
      list = list.filter((t) => monthOf(t.date) === ui.ym);
    }
    if (ui.filter !== 'all') list = list.filter((t) => t.type === ui.filter);
    list = [...list].sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
    const truncated = searching && list.length > MAX_SEARCH_RESULTS;
    if (truncated) list = list.slice(0, MAX_SEARCH_RESULTS);

    const expense = list.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
    const income = list.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0);

    const groups = [];
    for (const t of list) {
      const g = groups[groups.length - 1];
      if (g && g.date === t.date) g.items.push(t); else groups.push({ date: t.date, items: [t] });
    }

    return html`
      <header class="screen__header">
        <h1 class="large-title">记录</h1>
      </header>

      <div class="toolbar">
        <label class="search">
          ${icon('search')}
          <input class="search__input" type="search" name="q" placeholder="搜索备注、类别或金额" value="${ui.query}" autocomplete="off" enterkeyhint="search">
        </label>
        <div class="segmented segmented--small" role="tablist" aria-label="筛选">
          ${[['all', '全部'], ['expense', '支出'], ['income', '收入']].map(([id, label]) => html`
            <button type="button" role="tab" class="segmented__item ${ui.filter === id ? 'is-active' : ''}" data-filter="${id}" aria-selected="${ui.filter === id}">${label}</button>`)}
        </div>
      </div>

      ${searching ? html`<p class="section__meta section__meta--block">在所有月份中找到 ${list.length}${truncated ? '+' : ''} 笔</p>` : monthSwitcher(ui.ym, current)}

      <div class="summary-row">
        <div class="summary-row__item"><span>支出</span><strong>${formatMoney(expense)}</strong></div>
        <div class="summary-row__item"><span>收入</span><strong class="is-income">${formatMoney(income)}</strong></div>
        <div class="summary-row__item"><span>笔数</span><strong>${list.length}</strong></div>
      </div>

      ${groups.length ? groups.map((g) => {
        const dayExp = g.items.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
        return html`<section class="section section--day">
          <div class="section__header">
            <h2 class="section__title section__title--day">${dayLabel(g.date, today)} <span>${weekday(g.date)}</span></h2>
            ${dayExp ? html`<span class="section__meta">${formatMoney(dayExp)}</span>` : ''}
          </div>
          <ul class="list">${g.items.map((t) => txRow(t, cats.get(t.categoryId) || unknownCategory(t.type)))}</ul>
        </section>`;
      }) : html`<div class="empty-state">
          <span class="empty-state__icon">${icon(searching ? 'search' : 'list')}</span>
          <h3>${searching ? '没有找到相关记录' : '这个月没有记录'}</h3>
          <p>${searching ? '换个关键词试试。' : '记下的每一笔都会按日期出现在这里。'}</p>
        </div>`}
    `;
  },

  afterRender(el, ctx) {
    const input = el.querySelector('.search__input');
    if (!input) return;
    if (screen._refocus) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
      screen._refocus = false;
    }
    input.oninput = () => {
      ui.query = input.value.slice(0, 40);
      screen._refocus = true;
      clearTimeout(screen._t);
      screen._t = setTimeout(() => ctx.rerender(), 120);
    };
  },

  onClick(e, ctx) {
    const m = e.target.closest('[data-month]');
    if (m && !m.disabled) { ui.ym = m.dataset.month; haptic(); ctx.rerender(); return; }
    const f = e.target.closest('[data-filter]');
    if (f) { ui.filter = f.dataset.filter; haptic(); ctx.rerender(); }
  },
};

export default screen;
