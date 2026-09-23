// Fixed monthly items: rent, phone plan, subscriptions, salary… logged automatically on their day.
import { html, icon, catIcon, mount, money } from '../html.js';
import { openSheet, confirmDialog, toast } from '../overlays.js';
import { haptic } from '../haptics.js';
import { state, saveRecurring, deleteRecurring, subscribe } from '../../data/store.js';
import { activeCategories, categoryMap, unknownCategory } from '../../core/categories.js';
import { centsToInput, formatMoney, toCents } from '../../core/money.js';
import { dateInMonth, dayLabel, monthOf, todayISO } from '../../core/dates.js';
import { newRecurring, nextDueDate, findManualMatch } from '../../core/recurring.js';
import { newId } from '../../core/ids.js';

export function openRecurringManager() {
  let unsub = null;
  const sheet = openSheet({
    title: '固定项目',
    size: 'large',
    actions: html`<button type="button" class="btn btn--glass btn--small" data-new>${icon('plus')}新增</button>`,
    body: html`<div class="rec-manager"></div>`,
    onClose: () => unsub?.(),
    onMount(el) {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-new]')) { openRecurringEditor(); return; }
        const r = e.target.closest('[data-edit]');
        if (r) openRecurringEditor(state.recurring.find((x) => x.id === r.dataset.edit));
      });
    },
  });
  const root = sheet.body.querySelector('.rec-manager');
  unsub = subscribe(render);
  render();

  function render() {
    const cats = categoryMap(state.categories);
    const today = todayISO();
    const list = [...state.recurring].sort((a, b) => a.day - b.day);
    const monthly = list.filter((r) => r.active && r.type === 'expense').reduce((a, r) => a + r.amount, 0);
    mount(root, html`
      <p class="callout">${icon('clock')}<span>每月固定的收支设一次就好，到了日子会自动记上；「今天还能花」也会先预留这些钱。</span></p>
      ${list.length ? html`
        <ul class="list">
          ${list.map((r) => {
            const c = cats.get(r.categoryId) || unknownCategory(r.type);
            return html`<li><button type="button" class="row ${r.active ? '' : 'is-paused'}" data-edit="${r.id}">
              ${catIcon(c)}
              <span class="row__body">
                <span class="row__title">${r.note || c.name}</span>
                <span class="row__subtitle">每月 ${r.day} 号 · ${r.active ? `下次 ${dayLabel(nextDueDate(r, today), today)}` : '已暂停'}</span>
              </span>
              <span class="row__value ${r.type === 'income' ? 'is-income' : ''}">${money(r.type === 'income' ? r.amount : -r.amount, { sign: r.type === 'income' })}</span>
            </button></li>`;
          })}
        </ul>
        <p class="section__footer">每月固定支出合计 ${formatMoney(monthly)}</p>`
      : html`<div class="empty-state">
          <span class="empty-state__icon">${icon('subscriptions')}</span>
          <h3>还没有固定项目</h3>
          <p>例如：房租、手机月费、Netflix、健身房、每月薪水。</p>
          <button type="button" class="btn btn--primary" data-new>新增固定项目</button>
        </div>`}
    `);
  }
}

export function openRecurringEditor(rec = null) {
  const editing = !!rec;
  const today = todayISO();
  const s = {
    type: rec?.type || 'expense',
    amount: rec ? centsToInput(rec.amount) : '',
    categoryId: rec?.categoryId || 'housing',
    note: rec?.note || '',
    day: rec?.day || Number(today.slice(8, 10)),
    business: rec?.business || false,
    active: rec ? rec.active : true,
    includeThisMonth: null, // null = not chosen yet: on, unless this month's payment is already recorded
  };
  const manualMatch = () => (editing ? null : findManualMatch(state.transactions, { type: s.type, categoryId: s.categoryId, amount: toCents(s.amount) }, today));
  const includeNow = () => (s.includeThisMonth ?? !manualMatch());
  const sheet = openSheet({
    title: editing ? '编辑固定项目' : '新增固定项目',
    size: 'large',
    actions: html`<button type="button" class="btn btn--primary btn--small" data-save>保存</button>`,
    body: html`<div class="rec-editor"></div>`,
    onMount(el, api) {
      el.addEventListener('input', (e) => {
        const { name, value, checked } = e.target;
        if (name === 'amount') s.amount = value;
        if (name === 'note') s.note = value;
        if (name === 'day') { s.day = Number(value); render(); }
        if (name === 'business') s.business = checked;
        if (name === 'active') s.active = checked;
        if (name === 'include') s.includeThisMonth = checked;
      });
      // Re-check for an existing entry this month once the amount is typed in.
      el.addEventListener('change', (e) => { if (e.target.name === 'amount') render(); });
      el.addEventListener('click', async (e) => {
        const t = e.target.closest('[data-type]');
        if (t && t.dataset.type !== s.type) {
          s.type = t.dataset.type;
          s.categoryId = activeCategories(state.categories, s.type)[0]?.id;
          haptic(); render(); return;
        }
        const c = e.target.closest('[data-cat]');
        if (c) { s.categoryId = c.dataset.cat; haptic(); render(); return; }
        if (e.target.closest('[data-save]')) { await save(api); return; }
        if (e.target.closest('[data-remove]')) {
          const ok = await confirmDialog({ title: '删除这个固定项目？', message: '已经记下的记录会保留，只是以后不再自动记录。', confirm: '删除', destructive: true });
          if (!ok) return;
          await deleteRecurring(rec.id);
          toast('已删除', { icon: 'trash' });
          api.close();
        }
      });
    },
  });
  const root = sheet.body.querySelector('.rec-editor');
  render();

  function render() {
    const focused = document.activeElement?.name;
    const cats = activeCategories(state.categories, s.type);
    const duePassed = dateInMonth(monthOf(today), s.day) <= today;
    const match = manualMatch();
    mount(root, html`
      <div class="segmented">
        <button type="button" class="segmented__item ${s.type === 'expense' ? 'is-active' : ''}" data-type="expense">支出</button>
        <button type="button" class="segmented__item ${s.type === 'income' ? 'is-active' : ''}" data-type="income">收入</button>
      </div>
      <div class="form">
        <label class="field field--money"><span class="field__label">每月金额</span>
          <span class="field__control"><span class="field__prefix">RM</span>
          <input class="field__input" name="amount" type="text" inputmode="decimal" placeholder="0" value="${s.amount}" autocomplete="off"></span></label>
        <label class="field"><span class="field__label">名称</span>
          <input class="field__input field__input--text" name="note" maxlength="40" placeholder="${s.type === 'expense' ? '例如：房租' : '例如：薪水'}" value="${s.note}" autocomplete="off"></label>
        <label class="field field--inline"><span class="field__label">每月几号</span>
          <select class="field__select" name="day">
            ${Array.from({ length: 31 }, (_, i) => i + 1).map((d) => html`<option value="${d}" ${d === s.day ? 'selected' : ''}>${d} 号</option>`)}
          </select></label>
      </div>
      <p class="section__footer">${s.day > 28 ? '遇到较短的月份，会在当月最后一天记录。' : ''}</p>
      <h3 class="section__title">类别</h3>
      <div class="cat-grid cat-grid--compact">
        ${cats.map((c) => html`<button type="button" class="cat-grid__item ${s.categoryId === c.id ? 'is-selected' : ''}" data-cat="${c.id}" aria-pressed="${s.categoryId === c.id}">
          ${catIcon(c)}<span class="cat-grid__label">${c.name}</span></button>`)}
      </div>
      <ul class="list">
        ${s.type === 'expense' ? html`<li class="row row--toggle"><span class="row__body"><span class="row__title">创业支出</span><span class="row__subtitle">不计入个人生活费评估</span></span>
          <input type="checkbox" switch class="switch" name="business" ${s.business ? 'checked' : ''} aria-label="创业支出"></li>` : ''}
        ${editing ? html`<li class="row row--toggle"><span class="row__body"><span class="row__title">启用</span><span class="row__subtitle">关闭后暂停自动记录</span></span>
          <input type="checkbox" switch class="switch" name="active" ${s.active ? 'checked' : ''} aria-label="启用"></li>` : ''}
        ${!editing && (duePassed || match) ? html`<li class="row row--toggle"><span class="row__body"><span class="row__title">本月也记一笔</span><span class="row__subtitle">${match
            ? `本月已有一笔 ${formatMoney(match.amount)}（${dayLabel(match.date)}），默认不重复记录`
            : `本月 ${s.day} 号已经过了；如果这个月已经付了，打开它`}</span></span>
          <input type="checkbox" switch class="switch" name="include" ${includeNow() ? 'checked' : ''} aria-label="本月也记一笔"></li>` : ''}
      </ul>
      ${editing ? html`<button type="button" class="btn btn--plain btn--danger btn--block" data-remove>删除固定项目</button>` : ''}
    `);
    if (focused && focused !== 'day') root.querySelector(`[name=${focused}]`)?.focus({ preventScroll: true });
  }

  async function save(api) {
    const cents = toCents(s.amount);
    if (!cents) { haptic('error'); toast('请输入正确的金额', { icon: 'warning', tone: 'error' }); return; }
    if (!s.categoryId) { haptic('error'); toast('请选择类别', { icon: 'warning', tone: 'error' }); return; }
    const base = { type: s.type, amount: cents, categoryId: s.categoryId, note: s.note.trim().slice(0, 40), day: s.day, business: s.type === 'expense' && s.business };
    const r = editing
      ? { ...rec, ...base, active: s.active }
      : newRecurring({ id: newId(), ...base, includeThisMonth: includeNow() }, today);
    await saveRecurring(r);
    haptic('success');
    toast(editing ? '已保存' : '已新增固定项目', { icon: 'check', tone: 'success' });
    api.close();
  }
}
