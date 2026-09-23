// Passcode lock screen and passcode setup.
import { html, icon, mount } from '../html.js';
import { openSheet, confirmDialog, toast } from '../overlays.js';
import { haptic } from '../haptics.js';
import * as lock from '../../data/lock.js';
import { eraseEverything } from '../../data/store.js';

const LEN = 4;

function padMarkup(title, subtitle = '') {
  return html`
    <div class="pin">
      <span class="pin__icon">${icon('lock')}</span>
      <h2 class="pin__title">${title}</h2>
      <p class="pin__subtitle" aria-live="polite">${subtitle}</p>
      <div class="pin__dots" aria-hidden="true">${Array.from({ length: LEN }, () => html`<span class="pin__dot"></span>`)}</div>
      <div class="keypad keypad--pin" role="group" aria-label="密码键盘">
        ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => html`<button type="button" class="keypad__key" data-pin="${k}">${k}</button>`)}
        <span class="keypad__spacer"></span>
        <button type="button" class="keypad__key" data-pin="0">0</button>
        <button type="button" class="keypad__key keypad__key--fn" data-pin="del" aria-label="删除">${icon('backspace')}</button>
      </div>
    </div>`;
}

/** Wire a pin pad inside `el`. onComplete(code) may return false to shake + reset. */
function wirePad(el, onComplete) {
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
    if (busy) return;
    if (k === 'del') { code = code.slice(0, -1); dots(); return; }
    if (code.length >= LEN) return;
    code += k; haptic(); dots();
    if (code.length === LEN) {
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

/** Full-screen lock. Resolves once unlocked. */
export function showLockScreen() {
  return new Promise((resolve) => {
    const layer = document.createElement('div');
    layer.className = 'lock-screen';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    mount(layer, html`${padMarkup('输入密码', '')}<button type="button" class="link lock-screen__forgot" data-forgot>忘记密码？</button>`);
    document.body.appendChild(layer);
    document.documentElement.classList.add('is-locked');
    const sub = layer.querySelector('.pin__subtitle');
    const pad = wirePad(layer, async (code) => {
      const r = await lock.verify(code);
      if (r.ok) {
        haptic('success');
        pad.detach();
        layer.classList.add('is-leaving');
        document.documentElement.classList.remove('is-locked');
        setTimeout(() => layer.remove(), 280);
        resolve();
        return true;
      }
      sub.textContent = r.wait ? `尝试太多次，请 ${Math.ceil(r.wait / 1000)} 秒后再试` : `密码不对，还可以再试 ${r.left} 次`;
      return false;
    });
    layer.querySelector('[data-forgot]').addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: '忘记密码？',
        message: '为了保护资料，密码无法找回。你可以清除这台手机上的所有资料，再用之前的备份还原。',
        confirm: '清除所有资料', destructive: true,
      });
      if (!ok) return;
      const sure = await confirmDialog({ title: '确定清除？', message: '这个操作无法撤销。', confirm: '清除', destructive: true });
      if (!sure) return;
      await lock.disable();
      await eraseEverything();
      location.reload();
    });
  });
}

/** Set a new passcode (enter twice). Resolves true when saved. */
export function setupPin() {
  return new Promise((resolve) => {
    let first = null;
    let saved = false;
    const sheet = openSheet({
      title: '设定密码',
      size: 'large',
      body: padMarkup('输入 4 位新密码', '每次打开 App 都需要输入'),
      onClose: () => { pad.detach(); resolve(saved); },
    });
    const title = sheet.body.querySelector('.pin__title');
    const sub = sheet.body.querySelector('.pin__subtitle');
    const pad = wirePad(sheet.body, async (code) => {
      if (!first) {
        first = code;
        title.textContent = '再输入一次';
        sub.textContent = '确认密码';
        pad.reset(false);
        return true;
      }
      if (code !== first) {
        first = null;
        title.textContent = '输入 4 位新密码';
        sub.textContent = '两次输入不一样，请重新设定';
        return false;
      }
      await lock.setPin(code);
      saved = true;
      haptic('success');
      toast('密码锁已开启', { icon: 'lock', tone: 'success' });
      sheet.close();
      return true;
    });
  });
}

/** Ask for the current passcode before turning the lock off. */
export function confirmPin(title = '输入目前的密码') {
  return new Promise((resolve) => {
    let ok = false;
    const sheet = openSheet({
      title: '关闭密码锁',
      size: 'large',
      body: padMarkup(title, ''),
      onClose: () => { pad.detach(); resolve(ok); },
    });
    const sub = sheet.body.querySelector('.pin__subtitle');
    const pad = wirePad(sheet.body, async (code) => {
      const r = await lock.verify(code);
      if (r.ok) { ok = true; sheet.close(); return true; }
      sub.textContent = r.wait ? `尝试太多次，请 ${Math.ceil(r.wait / 1000)} 秒后再试` : `密码不对，还可以再试 ${r.left} 次`;
      return false;
    });
  });
}
