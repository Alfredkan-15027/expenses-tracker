// Small form sheets: monthly plan, single money value, single choice, text.
import { html, icon, catIcon } from '../html.js';
import { openSheet } from '../overlays.js';
import { haptic } from '../haptics.js';
import { state, saveSettings } from '../../data/store.js';
import { centsToInput, formatMoney, toCents } from '../../core/money.js';

export function moneyField({ name, label, value, hint }) {
  return html`<label class="field field--money">
    <span class="field__label">${label}</span>
    <span class="field__control">
      <span class="field__prefix">RM</span>
      <input class="field__input" name="${name}" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${centsToInput(value)}" enterkeyhint="done">
    </span>
    ${hint ? html`<span class="field__hint">${hint}</span>` : ''}
  </label>`;
}

export function readMoney(input) {
  const v = input.value.trim();
  if (!v) return 0;
  return toCents(v);
}

/** Monthly plan: expected income + savings target, with a live preview of the monthly budget. */
export function openPlanSheet() {
  const s = state.settings;
  return new Promise((resolve) => {
    const sheet = openSheet({
      title: '每月计划',
      size: 'medium',
      actions: html`<button type="button" class="btn btn--primary btn--small" data-save>保存</button>`,
      body: html`<form class="form" novalidate>
        ${moneyField({ name: 'income', label: '预计每月收入', value: s.expectedIncome, hint: '收入不固定的话，填一个保守的数字。留空则按当月实际记录的收入计算。' })}
        ${moneyField({ name: 'target', label: '每月存款目标', value: s.savingsTarget, hint: '创业期建议至少存下收入的 20%。' })}
        <div class="plan-preview" aria-live="polite"></div>
      </form>`,
      onClose: () => resolve(),
      onMount(el, api) {
        const form = el.querySelector('form');
        const preview = el.querySelector('.plan-preview');
        const update = () => {
          const inc = readMoney(form.income);
          const tgt = readMoney(form.target);
          if (inc === null || tgt === null) { preview.innerHTML = ''; preview.textContent = '请输入正确的金额（最多两位小数）'; preview.dataset.tone = 'bad'; return; }
          preview.dataset.tone = inc && tgt > inc ? 'bad' : 'info';
          if (!inc) { preview.textContent = '未填收入时，每日额度会按本月已记录的收入计算。'; return; }
          const budget = Math.max(0, inc - tgt);
          const rate = inc ? Math.round((tgt / inc) * 100) : 0;
          preview.textContent = tgt > inc
            ? '存款目标比收入还高，请调整。'
            : `每月可支配 ${formatMoney(budget, { round: true })} · 存款占收入 ${rate}% · 平均每天约 ${formatMoney(Math.floor(budget / 30), { round: true })}`;
        };
        form.addEventListener('input', update);
        form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
        update();
        async function save() {
          const inc = readMoney(form.income);
          const tgt = readMoney(form.target);
          if (inc === null || tgt === null || (inc && tgt > inc)) { haptic('error'); update(); return; }
          haptic('success');
          await saveSettings({ expectedIncome: inc, savingsTarget: tgt });
          api.close();
        }
        el.querySelector('[data-save]').addEventListener('click', save);
      },
    });
    return sheet;
  });
}

/** Edit one money value. Resolves with cents, or null when cancelled. */
export function openMoneySheet({ title, label, value, hint }) {
  return new Promise((resolve) => {
    let result = null;
    openSheet({
      title,
      size: 'auto',
      actions: html`<button type="button" class="btn btn--primary btn--small" data-save>保存</button>`,
      body: html`<form class="form" novalidate>${moneyField({ name: 'v', label, value, hint })}<p class="form__error" aria-live="polite"></p></form>`,
      onClose: () => resolve(result),
      onMount(el, api) {
        const form = el.querySelector('form');
        const save = () => {
          const v = readMoney(form.v);
          if (v === null) { haptic('error'); el.querySelector('.form__error').textContent = '请输入正确的金额（最多两位小数）'; return; }
          result = v;
          haptic('success');
          api.close();
        };
        form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
        el.querySelector('[data-save]').addEventListener('click', save);
      },
    });
  });
}

/** Edit a short text. Resolves with the string, or null when cancelled. */
export function openTextSheet({ title, label, value, maxLength = 20, placeholder = '' }) {
  return new Promise((resolve) => {
    let result = null;
    openSheet({
      title,
      size: 'auto',
      actions: html`<button type="button" class="btn btn--primary btn--small" data-save>保存</button>`,
      body: html`<form class="form" novalidate><label class="field">
          <span class="field__label">${label}</span>
          <input class="field__input field__input--text" name="v" type="text" maxlength="${maxLength}" value="${value}" placeholder="${placeholder}" autocomplete="off" enterkeyhint="done">
        </label></form>`,
      onClose: () => resolve(result),
      onMount(el, api) {
        const form = el.querySelector('form');
        const save = () => {
          const v = form.v.value.trim();
          if (!v) { haptic('error'); form.v.focus(); return; }
          result = v;
          api.close();
        };
        form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
        el.querySelector('[data-save]').addEventListener('click', save);
      },
    });
  });
}

/** iOS-style single choice list with a checkmark. Resolves with the chosen id, or null. */
export function openChoiceSheet({ title, options, value, footer = '' }) {
  return new Promise((resolve) => {
    let result = null;
    openSheet({
      title,
      size: 'auto',
      body: html`<ul class="list list--choices">
          ${options.map((o) => html`<li><button type="button" class="row row--choice ${o.id === value ? 'is-selected' : ''}" data-choice="${o.id}">
            ${o.cat ? catIcon(o.cat) : ''}
            <span class="row__body"><span class="row__title">${o.label}</span>${o.hint ? html`<span class="row__subtitle">${o.hint}</span>` : ''}</span>
            ${o.id === value ? icon('check', 'row__check') : ''}
          </button></li>`)}
        </ul>
        ${footer ? html`<p class="section__footer">${footer}</p>` : ''}`,
      onClose: () => resolve(result),
      onMount(el, api) {
        el.addEventListener('click', (e) => {
          const b = e.target.closest('[data-choice]');
          if (!b) return;
          const opt = options.find((o) => String(o.id) === b.dataset.choice);
          result = opt ? opt.id : b.dataset.choice;
          haptic();
          api.close();
        });
      },
    });
  });
}

/** Edit a number (e.g. a percentage). Resolves with the number, or null when cancelled. */
export function openNumberSheet({ title, label, value, suffix = '', hint = '', min = -Infinity, max = Infinity, decimals = 2 }) {
  return new Promise((resolve) => {
    let result = null;
    openSheet({
      title,
      size: 'auto',
      actions: html`<button type="button" class="btn btn--primary btn--small" data-save>保存</button>`,
      body: html`<form class="form" novalidate>
        <label class="field field--money"><span class="field__label">${label}</span>
          <span class="field__control">
            <input class="field__input" name="v" type="text" inputmode="decimal" autocomplete="off" value="${value ?? ''}" enterkeyhint="done">
            ${suffix ? html`<span class="field__prefix">${suffix}</span>` : ''}
          </span>
          ${hint ? html`<span class="field__hint">${hint}</span>` : ''}
        </label><p class="form__error" aria-live="polite"></p></form>`,
      onClose: () => resolve(result),
      onMount(el, api) {
        const form = el.querySelector('form');
        const save = () => {
          const raw = form.v.value.trim().replace(/,/g, '');
          const n = Number(raw);
          if (!raw || !Number.isFinite(n) || n < min || n > max) {
            haptic('error');
            el.querySelector('.form__error').textContent = `请输入 ${min} 到 ${max} 之间的数字`;
            return;
          }
          result = Math.round(n * 10 ** decimals) / 10 ** decimals;
          api.close();
        };
        form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
        el.querySelector('[data-save]').addEventListener('click', save);
      },
    });
  });
}
