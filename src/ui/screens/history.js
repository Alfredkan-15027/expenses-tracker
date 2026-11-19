// 记录 — kept quiet. The scene is the month: its total, and one bar per day (tap a day to see only that day). On the
// panel one plain list, newest first — what, "类别 · 日期 时间", how much — a page at a time (查看更多). Search, the
// type filter and "jump to a date" wait behind three small buttons.
import { html, icon, money, facts } from '../html.js';
import { dayBars } from '../charts.js';
import { txRow, monthSwitcher } from './shared.js';
import { categoryMap, unknownCategory } from '../../core/categories.js';
import { formatMoney } from '../../core/money.js';
import { dateInMonth, dayLabel, daysInMonth, isValidISODate, monthLabel, monthOf } from '../../core/dates.js';
import { haptic } from '../haptics.js';

const PAGE = 12;
const ui = { ym: null, query: '', filter: 'all', day: '', searching: false, shown: PAGE };
const FILTERS = [['all', '全部'], ['expense', '支出'], ['income', '收入']];

const screen = {
  id: 'history',
  title: '记录',

  render({ state, today }) {
    const current = monthOf(today);
    if (!ui.ym || ui.ym > current) ui.ym = current;
    if (ui.day && monthOf(ui.day) !== ui.ym) ui.day = '';
    const cats = categoryMap(state.categories);
    const q = ui.query.trim().toLowerCase();
    const searching = q.length > 0;
    // Amounts are searched the way they are shown ("−RM 1,234.00"): sign, RM and grouping commas don't matter.
    const qAmount = q.replace(/^[−+-]/, '').replace(/^rm\s*/, '').replace(/,/g, '');

    let list = state.transactions;
    if (searching) {
      list = list.filter((t) => {
        const c = cats.get(t.categoryId);
        return (t.note || '').toLowerCase().includes(q) || (c?.name || '').toLowerCase().includes(q)
          || (qAmount !== '' && (t.amount / 100).toFixed(2).includes(qAmount));
      });
    } else {
      list = list.filter((t) => monthOf(t.date) === ui.ym);
    }
    if (ui.filter !== 'all') list = list.filter((t) => t.type === ui.filter);
    const month = searching ? [] : monthDays(list, ui.ym, today);
    // A picked day narrows everything below it: the figure and the rows.
    if (!searching && ui.day) list = list.filter((t) => t.date === ui.day);
    const count = list.length;
    const expense = list.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
    const income = list.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0);
    list = [...list].sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
    const rows = list.slice(0, ui.shown);
    const incomeOnly = ui.filter === 'income';
    const figure = incomeOnly ? income : expense;
    const days = daysInMonth(ui.ym);
    const what = incomeOnly ? '收入' : '支出';

    return html`
      <section class="scene scene--history">
        <div class="scene__content">
          <header class="scene__top">
            <h1 class="large-title">记录</h1>
          </header>
          <div class="month">
            ${searching ? '' : monthSwitcher(ui.ym, current)}
            <div class="month__figure">
              <span class="scene__label">${searching ? `在所有月份中找到 ${count} 笔 · ${what}` : ui.day ? `${dayLabel(ui.day, today)} · ${what}` : what}</span>
              <div class="scene__figure ${incomeOnly ? 'is-income' : ''}" data-motion="count" data-motion-key="month" data-value="${figure}">${money(figure)}</div>
              <p class="scene__sub">${facts(searching ? '' : `${count} 笔`, !incomeOnly && income ? `收入 ${formatMoney(income)}` : '')}</p>
            </div>
            ${searching ? '' : html`<div class="month__days">
              ${dayBars(month, { selected: ui.day, tappable: true, label: `${monthLabel(ui.ym)}每天的${what}` })}
              <div class="month__axis"><span>1</span><span>${Math.round(days / 2)}</span><span>${days}</span></div>
            </div>`}
          </div>
        </div>
      </section>

      <div class="panel">
        <div class="toolbar">
          <div class="segmented segmented--small" role="tablist" aria-label="筛选">
            ${FILTERS.map(([id, label]) => html`
              <button type="button" role="tab" class="segmented__item ${ui.filter === id ? 'is-active' : ''}" data-filter="${id}" aria-selected="${ui.filter === id}">${label}</button>`)}
          </div>
          <label class="tool" aria-label="只看某一天">
            ${icon('calendar')}
            <input class="chip__overlay" type="date" name="jump" value="${ui.day}" max="${today}" aria-label="只看某一天">
          </label>
          <button type="button" class="tool ${ui.searching || searching ? 'is-on' : ''}" data-search aria-label="搜索" aria-expanded="${ui.searching || searching}">${icon('search')}</button>
        </div>

        ${ui.searching || searching ? html`<label class="search">
          ${icon('search')}
          <input class="search__input" type="search" name="q" placeholder="备注、类别或金额" value="${ui.query}" autocomplete="off" enterkeyhint="search">
        </label>` : ''}

        ${!searching && ui.day ? html`<button type="button" class="chip chip--toggle is-on day-chip" data-day="">
          <span>${dayLabel(ui.day, today)}</span>${icon('close')}
        </button>` : ''}

        ${rows.length ? html`
          <ul class="list">${rows.map((t) => txRow(t, cats.get(t.categoryId) || unknownCategory(t.type), { today }))}</ul>
          ${count > rows.length ? html`<button type="button" class="more" data-more>查看更多<span>还有 ${count - rows.length} 笔</span></button>` : ''}`
          : html`<div class="empty-state empty-state--quiet">
            <span class="empty-state__icon">${icon(searching ? 'search' : 'list')}</span>
            <h3>${searching ? '没有找到相关记录' : ui.day ? '这一天没有记录' : '这个月没有记录'}</h3>
          </div>`}
      </div>
    `;
  },

  afterRender(el, ctx) {
    const jump = el.querySelector('input[name="jump"]');
    if (jump) {
      jump.onchange = () => {
        if (jump.value && !isValidISODate(jump.value)) return;
        ui.day = jump.value || '';
        if (ui.day) ui.ym = monthOf(ui.day);
        reset();
        ctx.rerender();
      };
    }
    const input = el.querySelector('.search__input');
    if (!input) return;
    if (screen._refocus) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
      screen._refocus = false;
    }
    input.oninput = () => {
      ui.query = input.value.slice(0, 40);
      reset();
      screen._refocus = true;
      clearTimeout(screen._t);
      screen._t = setTimeout(() => ctx.rerender(), 120);
    };
  },

  onClick(e, ctx) {
    const m = e.target.closest('[data-month]');
    if (m && !m.disabled) { ui.ym = m.dataset.month; ui.day = ''; reset(); haptic(); ctx.rerender(); return; }
    const d = e.target.closest('[data-day]');
    if (d && !d.disabled) { ui.day = ui.day === d.dataset.day ? '' : d.dataset.day; reset(); haptic(); ctx.rerender(); return; }
    const f = e.target.closest('[data-filter]');
    if (f) { ui.filter = f.dataset.filter; reset(); haptic(); ctx.rerender(); return; }
    if (e.target.closest('[data-more]')) { ui.shown += PAGE * 2; haptic(); ctx.rerender(); return; }
    if (e.target.closest('[data-search]')) {
      ui.searching = !(ui.searching || ui.query);
      if (!ui.searching) ui.query = '';
      screen._refocus = ui.searching;
      reset();
      haptic();
      ctx.rerender();
    }
  },
};

/** A different view starts on its first page again. */
function reset() { ui.shown = PAGE; }

/** One entry per day of the month: what was spent (or, with the income filter, received) that day. */
function monthDays(list, ym, today) {
  const sums = new Map();
  const incomeOnly = ui.filter === 'income';
  for (const t of list) {
    if (t.type !== (incomeOnly ? 'income' : 'expense')) continue;
    sums.set(t.date, (sums.get(t.date) || 0) + t.amount);
  }
  const out = [];
  for (let day = 1; day <= daysInMonth(ym); day += 1) {
    const date = dateInMonth(ym, day);
    const value = sums.get(date) || 0;
    out.push({
      date, value, state: date < today ? 'past' : date === today ? 'today' : 'future',
      title: `${dayLabel(date, today)} ${formatMoney(value)}`,
    });
  }
  return out;
}

export default screen;
