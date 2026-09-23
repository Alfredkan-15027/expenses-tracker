// "记一笔" — the core logging flow: amount on a big keypad, then one tap on a category saves.
import { html, icon, catIcon, mount } from '../html.js';
import { openSheet, toast, confirmDialog } from '../overlays.js';
import { openChoiceSheet } from './plan.js';
import { haptic } from '../haptics.js';
import { state, addTransaction, updateTransaction, deleteTransaction, restoreTransaction } from '../../data/store.js';
import { activeCategories, categoryMap } from '../../core/categories.js';
import { centsToInput, formatMoney, toCents } from '../../core/money.js';
import { dayLabel, todayISO } from '../../core/dates.js';

const MAX_INT_DIGITS = 8;

/**
 * Open the entry sheet.
 * tx: existing transaction to edit. type: 'expense' | 'income' for a new entry.
 */
export function openEntrySheet({ tx = null, type = 'expense', date = null } = {}) {
  const editing = !!tx;
  const startType = tx?.type || type;
  const s = {
    type: startType,
    amount: tx ? centsToInput(tx.amount) : '',
    categoryId: tx?.categoryId || (startType === 'income' ? lastIncomeCategory() : null),
    note: tx?.note || '',
    date: tx?.date || date || todayISO(),
    business: tx?.business && tx.categoryId !== 'business' ? true : false,
  };

  const sheet = openSheet({
    title: editing ? '编辑记录' : '记一笔',
    size: 'large',
    className: 'sheet-layer--entry',
    actions: editing ? html`<button type="button" class="btn btn--primary btn--small" data-save>保存</button>` : '',
    headerCenter: html`<div class="segmented entry__type" role="tablist" aria-label="类型">
        <button type="button" role="tab" class="segmented__item" data-type="expense">支出</button>
        <button type="button" role="tab" class="segmented__item" data-type="income">收入</button>
      </div>`,
    body: html`<div class="entry"></div>`,
    onMount(el) {
      el.addEventListener('click', onClick);
      el.addEventListener('input', onInput);
      el.addEventListener('change', onInput);
    },
  });
  const root = sheet.body.querySelector('.entry');
  render();
  window.addEventListener('keydown', onKey);
  const origClose = sheet.close;
  sheet.close = (r) => { window.removeEventListener('keydown', onKey); return origClose(r); };

  function hintText() {
    if (s.type === 'income') return s.categoryId ? '确认金额与类型后，点「保存」' : '输入金额，再选择收入类型';
    if (editing) return '选好类别后，点右上角「保存」';
    return s.amount ? '点一个类别就完成' : '输入金额，再点类别就完成';
  }

  function render() {
    const cats = activeCategories(state.categories, s.type);
    const hint = hintText();
    const incomeCat = s.type === 'income' ? cats.find((c) => c.id === s.categoryId) : null;
    root.dataset.kind = s.type;
    sheet.el.querySelectorAll('.entry__type [data-type]').forEach((b) => {
      const on = b.dataset.type === s.type;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    mount(root, html`
      <div class="amount-display ${s.amount ? '' : 'is-empty'}" data-kind="${s.type}" aria-live="polite">
        <span class="amount-display__cur">RM</span><span class="amount-display__value">${amountText()}</span>
      </div>
      <p class="entry__hint">${hint}</p>
      <div class="entry__meta">
        <label class="chip chip--field">
          ${icon('note')}
          <input class="chip__input" type="text" name="note" maxlength="60" placeholder="备注（可选）" value="${s.note}" enterkeyhint="done" autocomplete="off">
        </label>
        <label class="chip chip--date">
          ${icon('calendar')}<span>${dayLabel(s.date)}</span>
          <input class="chip__overlay" type="date" name="date" value="${s.date}" max="2099-12-31" aria-label="日期">
        </label>
        ${s.type === 'expense' ? html`
          <button type="button" class="chip chip--toggle ${s.business || s.categoryId === 'business' ? 'is-on' : ''}" data-business aria-pressed="${s.business}">
            ${icon('business')}<span>创业</span>
          </button>` : ''}
      </div>
      ${s.type === 'income' ? html`
        <button type="button" class="type-picker ${incomeCat ? 'is-set' : ''}" data-pick-type aria-haspopup="dialog">
          ${incomeCat ? catIcon(incomeCat, 'cat-icon--xs') : icon('list')}
          <span class="type-picker__label">类型${incomeCat ? html`<span class="type-picker__value">：${incomeCat.name}</span>` : ''}</span>
          ${icon('chevron-down', 'type-picker__chevron')}
        </button>` : html`
      <div class="cat-grid" role="group" aria-label="类别">
        ${cats.map((c) => html`
          <button type="button" class="cat-grid__item ${s.categoryId === c.id ? 'is-selected' : ''}" data-cat="${c.id}" aria-pressed="${s.categoryId === c.id}">
            ${catIcon(c)}<span class="cat-grid__label">${c.name}</span>
          </button>`)}
      </div>`}
      <div class="keypad" role="group" aria-label="数字键盘">
        ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'].map((k) => html`<button type="button" class="keypad__key" data-key="${k}">${k}</button>`)}
        <button type="button" class="keypad__key keypad__key--fn" data-key="del" aria-label="删除">${icon('backspace')}</button>
      </div>
      ${s.type === 'income' && !editing ? html`<button type="button" class="btn btn--primary btn--large btn--block entry__save" data-save>保存收入</button>` : ''}
      ${editing ? html`<button type="button" class="btn btn--plain btn--danger entry__delete" data-delete>${icon('trash')}删除这笔记录</button>` : ''}
    `);
  }

  function amountText() {
    if (!s.amount) return '0';
    const [i, d] = s.amount.split('.');
    const int = Number(i || '0').toLocaleString('en-MY');
    return d !== undefined ? `${int}.${d}` : int;
  }

  function updateAmount() {
    const box = root.querySelector('.amount-display');
    box.classList.toggle('is-empty', !s.amount);
    box.querySelector('.amount-display__value').textContent = amountText();
    root.querySelector('.entry__hint').textContent = hintText();
  }

  function press(k) {
    let a = s.amount;
    if (k === 'del') a = a.slice(0, -1);
    else if (k === '.') { if (!a.includes('.')) a = (a || '0') + '.'; }
    else {
      const [i, d] = a.split('.');
      if (d !== undefined) { if (d.length < 2) a += k; }
      else if (i === '0') a = k;
      else if ((i || '').length < MAX_INT_DIGITS) a += k;
    }
    if (a === s.amount) { haptic('error'); return; }
    s.amount = a;
    haptic();
    updateAmount();
  }

  function onKey(e) {
    if (e.target.matches('input')) return;
    if (/^[0-9.]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
  }

  function shake() {
    const box = root.querySelector('.amount-display');
    box.classList.remove('is-shaking');
    void box.offsetWidth;
    box.classList.add('is-shaking');
    haptic('error');
  }

  async function onClick(e) {
    const dateInput = e.target.closest('.chip--date input');
    if (dateInput) { try { dateInput.showPicker?.(); } catch { /* native tap already opens it */ } return; }
    const key = e.target.closest('[data-key]');
    if (key) { press(key.dataset.key); return; }

    const t = e.target.closest('[data-type]');
    if (t && t.dataset.type !== s.type) {
      s.type = t.dataset.type;
      s.categoryId = s.type === 'income' ? lastIncomeCategory() : null;
      haptic();
      render();
      return;
    }

    if (e.target.closest('[data-pick-type]')) {
      haptic();
      const cats = activeCategories(state.categories, 'income');
      const picked = await openChoiceSheet({
        title: '收入类型',
        options: cats.map((c) => ({ id: c.id, label: c.name, hint: c.hint, cat: c })),
        value: s.categoryId,
        footer: '可以在「设置 → 类别 → 收入类别」新增或改名。',
      });
      if (picked) { s.categoryId = picked; render(); }
      return;
    }

    if (e.target.closest('[data-business]')) {
      s.business = !s.business;
      haptic();
      render();
      return;
    }

    const cat = e.target.closest('[data-cat]');
    if (cat) {
      s.categoryId = cat.dataset.cat;
      if (editing) { haptic(); render(); return; }
      await save();
      return;
    }

    if (e.target.closest('[data-save]')) { await save(); return; }

    if (e.target.closest('[data-delete]')) {
      const ok = await confirmDialog({ title: '删除这笔记录？', message: `${formatMoney(tx.amount)} · ${dayLabel(tx.date)}`, confirm: '删除', destructive: true });
      if (!ok) return;
      const removed = await deleteTransaction(tx.id);
      sheet.close();
      toast('已删除', { icon: 'trash', action: { label: '撤销', onClick: () => restoreTransaction(removed) } });
    }
  }

  function onInput(e) {
    if (e.target.name === 'note') s.note = e.target.value;
    if (e.target.name === 'date' && e.type === 'change') {
      if (e.target.value) s.date = e.target.value;
      render();
    }
  }

  async function save() {
    const cents = toCents(s.amount);
    if (!cents) { shake(); root.querySelector('.entry__hint').textContent = '先输入金额'; return; }
    if (!s.categoryId) {
      haptic('error');
      root.querySelector('.entry__hint').textContent = s.type === 'income' ? '请先选择收入类型' : '请选择一个类别';
      return;
    }
    const data = { type: s.type, amount: cents, categoryId: s.categoryId, note: s.note, date: s.date, business: s.type === 'expense' && s.business };
    haptic('success');
    if (editing) {
      await updateTransaction(tx.id, data);
      sheet.close();
      toast('已保存', { icon: 'check' });
      return;
    }
    const saved = await addTransaction(data);
    sheet.close();
    const cat = categoryMap(state.categories).get(saved.categoryId);
    const when = saved.date === todayISO() ? '' : ` · ${dayLabel(saved.date)}`;
    toast(`${cat?.name || ''} ${formatMoney(saved.amount)}${when}`, {
      icon: 'check', tone: 'success',
      action: { label: '撤销', onClick: () => deleteTransaction(saved.id) },
    });
  }

  return sheet;
}

/** The income type used most recently (still active), so repeated income is one tap. */
function lastIncomeCategory() {
  const active = new Set(activeCategories(state.categories, 'income').map((c) => c.id));
  let best = null;
  for (const t of state.transactions) {
    if (t.type !== 'income' || !active.has(t.categoryId)) continue;
    if (!best || t.date > best.date || (t.date === best.date && t.createdAt > best.createdAt)) best = t;
  }
  return best?.categoryId || null;
}

/** One-tap logging from a quick pick chip. */
export async function quickAdd(pick) {
  haptic('success');
  const saved = await addTransaction({ type: 'expense', amount: pick.amount, categoryId: pick.categoryId, note: pick.note, business: pick.business });
  const cat = categoryMap(state.categories).get(saved.categoryId);
  toast(`${pick.note || cat?.name || ''} ${formatMoney(saved.amount)}`, {
    icon: 'check', tone: 'success',
    action: { label: '撤销', onClick: () => deleteTransaction(saved.id) },
  });
}
