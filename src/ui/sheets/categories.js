// Manage categories: reorder, rename, recolor, add, hide.
import { html, icon, catIcon, mount } from '../html.js';
import { openSheet, confirmDialog, toast } from '../overlays.js';
import { haptic } from '../haptics.js';
import { state, saveCategory, removeCategory, moveCategory, subscribe } from '../../data/store.js';
import { activeCategories, CATEGORY_ICONS, PALETTE, GROUP_LABELS } from '../../core/categories.js';

export function openCategoryManager() {
  let type = 'expense';
  let unsub = null;
  const sheet = openSheet({
    title: '类别',
    size: 'large',
    actions: html`<button type="button" class="btn btn--glass btn--small" data-new>${icon('plus')}新增</button>`,
    body: html`<div class="cat-manager"></div>`,
    onClose: () => unsub?.(),
    onMount(el) {
      el.addEventListener('click', async (e) => {
        const t = e.target.closest('[data-type]');
        if (t) { type = t.dataset.type; haptic(); render(); return; }
        const mv = e.target.closest('[data-move]');
        if (mv) { haptic(); await moveCategory(mv.dataset.id, Number(mv.dataset.move)); return; }
        const ed = e.target.closest('[data-edit]');
        if (ed) { openCategoryEditor(state.categories.find((c) => c.id === ed.dataset.edit)); return; }
        if (e.target.closest('[data-new]')) { openCategoryEditor(null, type); return; }
        const restore = e.target.closest('[data-unarchive]');
        if (restore) {
          const c = state.categories.find((x) => x.id === restore.dataset.unarchive);
          if (c) { await saveCategory({ ...c, archived: false }); haptic('success'); }
        }
      });
    },
  });
  const root = sheet.body.querySelector('.cat-manager');
  unsub = subscribe(render);
  render();

  function render() {
    const list = activeCategories(state.categories, type);
    const hidden = state.categories.filter((c) => c.type === type && c.archived);
    mount(root, html`
      <div class="segmented" role="tablist">
        <button type="button" class="segmented__item ${type === 'expense' ? 'is-active' : ''}" data-type="expense">支出类别</button>
        <button type="button" class="segmented__item ${type === 'income' ? 'is-active' : ''}" data-type="income">收入类别</button>
      </div>
      <ul class="list">
        ${list.map((c, i) => html`<li class="row row--manage">
          <button type="button" class="row__main" data-edit="${c.id}">
            ${catIcon(c)}
            <span class="row__body"><span class="row__title">${c.name}</span><span class="row__subtitle">${c.hint || (type === 'expense' ? GROUP_LABELS[c.group] : '')}</span></span>
          </button>
          <span class="row__reorder">
            <button type="button" class="btn btn--icon btn--plain" data-move="-1" data-id="${c.id}" aria-label="上移" ${i === 0 ? 'disabled' : ''}>${icon('arrow-up')}</button>
            <button type="button" class="btn btn--icon btn--plain" data-move="1" data-id="${c.id}" aria-label="下移" ${i === list.length - 1 ? 'disabled' : ''}>${icon('arrow-down')}</button>
          </span>
        </li>`)}
      </ul>
      <p class="section__footer">记账时类别按这个顺序排列，把最常用的放在最前面。</p>
      ${hidden.length ? html`
        <h3 class="section__title">已隐藏</h3>
        <ul class="list">
          ${hidden.map((c) => html`<li class="row row--manage">
            <span class="row__main">${catIcon(c)}<span class="row__body"><span class="row__title">${c.name}</span></span></span>
            <button type="button" class="btn btn--plain btn--small" data-unarchive="${c.id}">恢复</button>
          </li>`)}
        </ul>` : ''}
    `);
  }
}

export function openCategoryEditor(cat, type = 'expense') {
  const editing = !!cat;
  const s = {
    name: cat?.name || '',
    hint: cat?.hint || '',
    icon: cat?.icon || (type === 'income' ? 'otherincome' : 'other'),
    color: cat?.color || 'blue',
    group: cat?.group || 'want',
    type: cat?.type || type,
  };
  const groups = ['need', 'want', 'growth', 'other'];
  const sheet = openSheet({
    title: editing ? '编辑类别' : '新增类别',
    size: 'large',
    actions: html`<button type="button" class="btn btn--primary btn--small" data-save>保存</button>`,
    body: html`<div class="cat-editor"></div>`,
    onMount(el, api) {
      el.addEventListener('input', (e) => {
        if (e.target.name === 'name') { s.name = e.target.value; el.querySelector('.cat-editor__preview .row__title').textContent = s.name || '类别名称'; }
        if (e.target.name === 'hint') s.hint = e.target.value;
      });
      el.addEventListener('click', async (e) => {
        const ic = e.target.closest('[data-icon]');
        if (ic) { s.icon = ic.dataset.icon; haptic(); render(); return; }
        const co = e.target.closest('[data-color]');
        if (co && co.closest('.swatches')) { s.color = co.dataset.color; haptic(); render(); return; }
        const g = e.target.closest('[data-group]');
        if (g) { s.group = g.dataset.group; haptic(); render(); return; }
        if (e.target.closest('[data-save]')) {
          const name = s.name.trim();
          if (!name) { haptic('error'); el.querySelector('input[name=name]').focus(); return; }
          await saveCategory({ ...(cat || {}), name: name.slice(0, 20), hint: s.hint.trim().slice(0, 60), icon: s.icon, color: s.color, group: s.type === 'income' ? 'other' : s.group, type: s.type });
          haptic('success');
          api.close();
          return;
        }
        if (e.target.closest('[data-remove]')) {
          const used = state.transactions.some((t) => t.categoryId === cat.id);
          const ok = await confirmDialog({
            title: `隐藏「${cat.name}」？`,
            message: used ? '以前的记录会保留这个类别，只是记账时不再显示。随时可以恢复。' : '记账时不再显示这个类别。',
            confirm: '隐藏', destructive: true,
          });
          if (!ok) return;
          await removeCategory(cat.id);
          toast('已隐藏', { icon: 'check' });
          api.close();
        }
      });
    },
  });
  const root = sheet.body.querySelector('.cat-editor');
  render();

  function render() {
    const focused = document.activeElement?.name;
    mount(root, html`
      <div class="cat-editor__preview">
        ${catIcon({ icon: s.icon, color: s.color }, 'cat-icon--lg')}
        <span class="row__title">${s.name || '类别名称'}</span>
      </div>
      <div class="form">
        <label class="field"><span class="field__label">名称</span>
          <input class="field__input field__input--text" name="name" maxlength="20" value="${s.name}" placeholder="例如：咖啡" autocomplete="off"></label>
        <label class="field"><span class="field__label">说明（可选）</span>
          <input class="field__input field__input--text" name="hint" maxlength="60" value="${s.hint}" placeholder="例如：Starbucks · ZUS" autocomplete="off"></label>
      </div>
      <h3 class="section__title">颜色</h3>
      <div class="swatches">
        ${PALETTE.map((c) => html`<button type="button" class="swatch ${s.color === c ? 'is-selected' : ''}" data-color="${c}" aria-label="${c}" aria-pressed="${s.color === c}"></button>`)}
      </div>
      <h3 class="section__title">图标</h3>
      <div class="icon-grid">
        ${CATEGORY_ICONS.map((i) => html`<button type="button" class="icon-grid__item ${s.icon === i ? 'is-selected' : ''}" data-icon="${i}" aria-label="${i}" aria-pressed="${s.icon === i}">${icon(i)}</button>`)}
      </div>
      ${s.type === 'expense' ? html`
        <h3 class="section__title">分析时归类为</h3>
        <div class="segmented segmented--wrap">
          ${groups.map((g) => html`<button type="button" class="segmented__item ${s.group === g ? 'is-active' : ''}" data-group="${g}">${GROUP_LABELS[g]}</button>`)}
        </div>` : ''}
      ${editing && cat.id !== 'other' ? html`<button type="button" class="btn btn--plain btn--danger btn--block" data-remove>隐藏这个类别</button>` : ''}
    `);
    if (focused) root.querySelector(`input[name=${focused}]`)?.focus({ preventScroll: true });
  }
}
