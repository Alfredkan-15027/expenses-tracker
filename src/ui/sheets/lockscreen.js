// Passcode lock screen (with Face ID), passcode setup and passcode check.
import { html, icon, mount } from '../html.js';
import { openSheet, confirmDialog, toast } from '../overlays.js';
import { haptic } from '../haptics.js';
import * as lock from '../../data/lock.js';
import { eraseEverything } from '../../data/store.js';

function padMarkup({ title, subtitle = '', length, faceId = false }) {
  return html`
    <div class="pin">
      <span class="pin__icon">${icon('lock')}</span>
      <h2 class="pin__title">${title}</h2>
      <p class="pin__subtitle" aria-live="polite">${subtitle}</p>
      <div class="pin__dots" data-length="${length}" aria-hidden="true">${Array.from({ length }, () => html`<span class="pin__dot"></span>`)}</div>
      <div class="keypad keypad--pin" role="group" aria-label="密码键盘">
        ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => html`<button type="button" class="keypad__key" data-pin="${k}">${k}</button>`)}
        ${faceId
          ? html`<button type="button" class="keypad__key keypad__key--fn keypad__key--faceid" data-faceid aria-label="使用 Face ID 解锁">${icon('faceid')}</button>`
          : html`<span class="keypad__spacer"></span>`}
        <button type="button" class="keypad__key" data-pin="0">0</button>
        <button type="button" class="keypad__key keypad__key--fn" data-pin="del" aria-label="删除">${icon('backspace')}</button>
      </div>
    </div>`;
}

/** Wire a pin pad inside `el`. onComplete(code) may return false to shake + reset. */
function wirePad(el, length, onComplete) {
  let code = '';
  let busy = false;
  const dots = () => el.querySelectorAll('.pin__dot').forEach((d, i) => d.classList.toggle('is-filled', i < code.length));
  const reset = (shake) => {
    code = '';
    dots();
    if (shake) {
      const box = el.querySelector('.pin__dots');
      box.classList.remove('is-shaking'); void box.offsetWidth; box.classList.add('is-shaking');
      haptic('error');
    }
  };
  const press = async (k) => {
    if (busy || el.querySelector('.alert-layer')) return; // an alert on top of the pad takes the keys
    if (k === 'del') { code = code.slice(0, -1); dots(); return; }
    if (code.length >= length) return;
    code += k; haptic(); dots();
    if (code.length === length) {
      busy = true;
      const ok = await onComplete(code);
      busy = false;
      if (ok === false) reset(true);
    }
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pin]');
    if (b) press(b.dataset.pin);
  });
  const onKey = (e) => {
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
  };
  window.addEventListener('keydown', onKey);
  return { reset, detach: () => window.removeEventListener('keydown', onKey) };
}

const waitText = (r) => (r.wait ? `尝试太多次，请 ${Math.ceil(r.wait / 1000)} 秒后再试` : `密码不对，还可以再试 ${r.left} 次`);

/** Full-screen lock. Resolves once unlocked. */
export async function showLockScreen() {
  const info = await lock.getInfo();
  const faceId = info.biometric && (await lock.biometricAvailable());
  return new Promise((resolve) => {
    const layer = document.createElement('div');
    layer.className = 'lock-screen';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    mount(layer, html`${padMarkup({ title: '输入密码', length: info.pinLength, faceId })}<button type="button" class="link lock-screen__forgot" data-forgot>忘记密码？</button>`);
    document.body.appendChild(layer);
    document.documentElement.classList.add('is-locked');
    const sub = layer.querySelector('.pin__subtitle');
    let done = false;
    const unlock = () => {
      if (done) return;
      done = true;
      haptic('success');
      pad.detach();
      // Face ID can succeed while the "forgot passcode" alert is open: dismiss it (as cancel) with the lock.
      layer.querySelectorAll('.alert__btn--cancel').forEach((b) => b.click());
      layer.classList.add('is-leaving');
      document.documentElement.classList.remove('is-locked');
      setTimeout(() => layer.remove(), 280);
      resolve();
    };
    const pad = wirePad(layer, info.pinLength, async (code) => {
      const r = await lock.verify(code);
      if (r.ok) { unlock(); return true; }
      sub.textContent = waitText(r);
      return false;
    });
    const tryFaceId = async () => {
      const r = await lock.unlockWithBiometric();
      if (r.ok) unlock();
      else if (r.reason !== 'cancelled') sub.textContent = 'Face ID 未能解锁，请输入密码';
    };
    layer.querySelector('[data-faceid]')?.addEventListener('click', tryFaceId);
    // iOS may require a tap before Face ID can start; if the automatic attempt is refused, the Face ID key remains.
    if (faceId) setTimeout(tryFaceId, 250);
    layer.querySelector('[data-forgot]').addEventListener('click', async () => {
      if (layer.querySelector('.alert-layer')) return;
      // Alerts go inside the lock layer: the normal overlay root is hidden while locked.
      const ok = await confirmDialog({
        container: layer,
        title: '忘记密码？',
        message: '为了保护资料，密码无法找回。你可以清除这台手机上的所有资料，再用之前的备份还原。',
        confirm: '清除所有资料', destructive: true,
      });
      if (!ok || done) return;
      const sure = await confirmDialog({ container: layer, title: '确定清除？', message: '这个操作无法撤销。', confirm: '清除', destructive: true });
      if (!sure || done) return;
      await lock.disable();
      await eraseEverything();
      location.reload();
    });
  });
}

/** Set a new 6-digit passcode (enter twice). Resolves with the passcode, or null if cancelled. */
export function setupPin({ title = '设定 6 位密码' } = {}) {
  const length = lock.PIN_LENGTH;
  return new Promise((resolve) => {
    let first = null;
    let saved = null;
    const sheet = openSheet({
      title: '设定密码',
      size: 'large',
      body: padMarkup({ title, subtitle: '每次打开 App 都需要输入', length }),
      onClose: () => { pad.detach(); resolve(saved); },
    });
    const titleEl = sheet.body.querySelector('.pin__title');
    const sub = sheet.body.querySelector('.pin__subtitle');
    const pad = wirePad(sheet.body, length, async (code) => {
      if (!first) {
        first = code;
        titleEl.textContent = '再输入一次';
        sub.textContent = '确认密码';
        pad.reset(false);
        return true;
      }
      if (code !== first) {
        first = null;
        titleEl.textContent = title;
        sub.textContent = '两次输入不一样，请重新设定';
        return false;
      }
      await lock.setPin(code);
      saved = code;
      haptic('success');
      toast('密码已设定', { icon: 'lock', tone: 'success' });
      sheet.close();
      return true;
    });
  });
}

/** Ask for the current app passcode. Resolves with the passcode when correct, or null. */
export async function confirmPin({ sheetTitle = '验证密码', title = '输入目前的密码' } = {}) {
  const info = await lock.getInfo();
  return new Promise((resolve) => {
    let result = null;
    const sheet = openSheet({
      title: sheetTitle,
      size: 'large',
      body: padMarkup({ title, length: info.pinLength }),
      onClose: () => { pad.detach(); resolve(result); },
    });
    const sub = sheet.body.querySelector('.pin__subtitle');
    const pad = wirePad(sheet.body, info.pinLength, async (code) => {
      const r = await lock.verify(code);
      if (r.ok) { result = code; sheet.close(); return true; }
      sub.textContent = waitText(r);
      return false;
    });
  });
}
