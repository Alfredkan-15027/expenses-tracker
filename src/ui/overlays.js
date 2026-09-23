// Bottom sheets, alerts and toasts in the iOS style.
import { html, icon, mount } from './html.js';
import { haptic } from './haptics.js';

const root = () => document.getElementById('overlay-root');
const stack = [];
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

function syncScrollLock() {
  document.documentElement.classList.toggle('has-overlay', stack.length > 0);
}

// ── Sheet ───────────────────────────────────────────────────────────────────

/**
 * Open a bottom sheet.
 * opts: { title, body (html), actions (html for header right), headerCenter (html replacing the visible title),
 *         size: 'large'|'medium'|'auto'|'full',
 *         className, onMount(el, api), onClose(), dismissible }
 */
export function openSheet(opts) {
  const layer = document.createElement('div');
  layer.className = `sheet-layer ${opts.className || ''}`;
  const titleId = `sheet-title-${Date.now()}`;
  mount(layer, html`
    <div class="sheet-backdrop" data-sheet-dismiss></div>
    <section class="sheet sheet--${opts.size || 'large'}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="sheet__grab" data-sheet-drag><span class="sheet__grabber"></span></div>
      <header class="sheet__header" data-sheet-drag>
        <button class="btn btn--icon btn--glass sheet__close" type="button" data-sheet-close aria-label="关闭">${icon('close')}</button>
        ${opts.headerCenter
          ? html`<div class="sheet__center"><h2 class="sheet__title sr-only" id="${titleId}">${opts.title || ''}</h2>${opts.headerCenter}</div>`
          : html`<h2 class="sheet__title" id="${titleId}">${opts.title || ''}</h2>`}
        <div class="sheet__actions">${opts.actions || ''}</div>
      </header>
      <div class="sheet__body">${opts.body || ''}</div>
    </section>`);
  root().appendChild(layer);
  const sheet = layer.querySelector('.sheet');
  let closed = false;

  const api = {
    el: sheet,
    layer,
    body: sheet.querySelector('.sheet__body'),
    setTitle(t) { sheet.querySelector('.sheet__title').textContent = t; },
    setActions(h) { mount(sheet.querySelector('.sheet__actions'), h); },
    async close(result) {
      if (closed) return;
      closed = true;
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      stack[stack.length - 1]?.layer?.classList.remove('is-behind');
      syncScrollLock();
      layer.classList.remove('is-open');
      sheet.style.transform = '';
      await wait(reduceMotion() ? 0 : 380);
      layer.remove();
      opts.onClose?.(result);
    },
  };

  layer.addEventListener('click', (e) => {
    if (e.target.closest('[data-sheet-close]')) api.close();
    else if (e.target.matches('[data-sheet-dismiss]') && opts.dismissible !== false) api.close();
  });
  enableDrag(sheet, api, opts);

  stack[stack.length - 1]?.layer?.classList.add('is-behind');
  stack.push(api);
  syncScrollLock();
  opts.onMount?.(sheet, api);
  nextFrame().then(() => layer.classList.add('is-open'));
  return api;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Drag the grabber / header downward to dismiss, like UIKit sheets.
function enableDrag(sheet, api, opts) {
  let startY = 0, dy = 0, startT = 0, dragging = false;
  sheet.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('[data-sheet-drag]') || e.target.closest('button, input, select, textarea, a')) return;
    dragging = true; startY = e.clientY; startT = e.timeStamp; dy = 0;
    sheet.setPointerCapture(e.pointerId);
    sheet.classList.add('is-dragging');
  });
  sheet.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('is-dragging');
    const v = dy / Math.max(1, e.timeStamp - startT);
    if (opts.dismissible !== false && (dy > 140 || (dy > 40 && v > 0.6))) api.close();
    else sheet.style.transform = '';
  };
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
}

export function closeTopSheet() {
  const top = stack[stack.length - 1];
  if (top) { top.close(); return true; }
  return false;
}

export function closeAllSheets() {
  for (const s of [...stack]) s.close();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeTopSheet();
});

// ── Alert / confirm ─────────────────────────────────────────────────────────

/**
 * iOS-style alert. buttons: [{ label, role: 'cancel'|'destructive'|'default', value }]
 * Resolves with the chosen button's value. container: where to attach it (default: the overlay root, which is
 * hidden while the app is locked — alerts shown from the lock screen pass the lock layer instead).
 */
export function alertDialog({ title, message, buttons = [{ label: '好', value: true }], container = null }) {
  return new Promise((resolve) => {
    const layer = document.createElement('div');
    layer.className = 'alert-layer';
    mount(layer, html`
      <div class="alert-backdrop"></div>
      <div class="alert" role="alertdialog" aria-modal="true">
        <div class="alert__text">
          <h2 class="alert__title">${title}</h2>
          ${message ? html`<p class="alert__message">${message}</p>` : ''}
        </div>
        <div class="alert__buttons ${buttons.length > 2 ? 'is-stacked' : ''}">
          ${buttons.map((b, i) => html`<button type="button" class="alert__btn alert__btn--${b.role || 'default'}" data-i="${i}">${b.label}</button>`)}
        </div>
      </div>`);
    (container || root()).appendChild(layer);
    stack.push({ close: () => finish(buttons.find((b) => b.role === 'cancel')?.value ?? false) });
    syncScrollLock();
    nextFrame().then(() => layer.classList.add('is-open'));
    function finish(value) {
      stack.pop();
      syncScrollLock();
      layer.classList.remove('is-open');
      setTimeout(() => layer.remove(), reduceMotion() ? 0 : 220);
      resolve(value);
    }
    layer.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) finish(buttons[Number(b.dataset.i)].value);
    });
    layer.querySelector('.alert__btn:last-child')?.focus({ preventScroll: true });
  });
}

export function confirmDialog({ title, message, confirm = '确定', cancel = '取消', destructive = false, container = null }) {
  return alertDialog({
    title, message, container,
    buttons: [
      { label: cancel, role: 'cancel', value: false },
      { label: confirm, role: destructive ? 'destructive' : 'default', value: true },
    ],
  });
}

// ── Toast ───────────────────────────────────────────────────────────────────

let toastTimer = null;

/** toast('已记录', { action: { label: '撤销', onClick }, tone: 'success'|'error', duration }) */
export function toast(message, { action, tone = 'default', duration = 3800, icon: ic } = {}) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    root().appendChild(el);
  }
  el.dataset.tone = tone;
  mount(el, html`
    ${ic ? html`<span class="toast__icon">${icon(ic)}</span>` : ''}
    <span class="toast__text">${message}</span>
    ${action ? html`<button type="button" class="toast__action">${action.label}</button>` : ''}`);
  const btn = el.querySelector('.toast__action');
  if (btn) btn.onclick = () => { hide(); action.onClick(); haptic(); };
  clearTimeout(toastTimer);
  requestAnimationFrame(() => el.classList.add('is-visible'));
  toastTimer = setTimeout(hide, duration);
  function hide() {
    el.classList.remove('is-visible');
  }
}
