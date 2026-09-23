// Google Drive backup flows (connect, back up, restore, disconnect), the recovery key, and the automatic check.
import { html, icon, mount } from '../html.js';
import { openSheet, toast, confirmDialog, alertDialog } from '../overlays.js';
import { haptic } from '../haptics.js';
import { state, snapshot, saveSettings, replaceAllData } from '../../data/store.js';
import * as gdrive from '../../data/gdrive.js';
import {
  setupBackupKey, adoptBackupKey, hasBackupKey, backupToDrive, decryptWithLocalKey, decryptWithRecoveryKey,
} from '../../data/cloudbackup.js';
import { newRecoveryKey, normalizeRecoveryKey, isEnvelope } from '../../core/crypto.js';
import { parseBackup } from '../../core/backup.js';
import { backupDue } from '../../core/settings.js';
import { openChoiceSheet } from './plan.js';

const hasUserData = () => state.transactions.length > 0 || state.holdings.length > 0;

// ── Recovery key ────────────────────────────────────────────────────────────

/** Show a new recovery key, then have it typed / pasted back. Resolves with the key, or null if cancelled. */
export function createRecoveryKey({ title = '恢复密钥' } = {}) {
  const key = newRecoveryKey();
  return new Promise((resolve) => {
    let result = null;
    let step = 'show';
    const sheet = openSheet({
      title,
      size: 'large',
      body: html`<div class="recovery"></div>`,
      onClose: () => resolve(result),
      onMount(el) {
        el.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-rk]');
          if (!b) return;
          const act = b.dataset.rk;
          if (act === 'copy') {
            try {
              await navigator.clipboard.writeText(key);
              haptic('success');
              toast('已拷贝恢复密钥', { icon: 'check', tone: 'success' });
            } catch {
              toast('无法拷贝，请手动抄下来', { icon: 'warning', tone: 'error' });
            }
          } else if (act === 'share') {
            try { await navigator.share({ text: `Expenses Tracker 恢复密钥：${key}` }); } catch { /* cancelled */ }
          } else if (act === 'next') {
            step = 'confirm'; haptic(); render();
            root.querySelector('[name=rk]')?.focus();
          } else if (act === 'back') {
            step = 'show'; render();
          }
        });
        el.addEventListener('submit', (e) => { e.preventDefault(); confirm(); });
      },
    });
    const root = sheet.body.querySelector('.recovery');
    render();

    function confirm() {
      if (normalizeRecoveryKey(root.querySelector('[name=rk]')?.value) !== key) {
        haptic('error');
        root.querySelector('.recovery__error').textContent = '和刚才的恢复密钥不一样，请检查后再输入。';
        return;
      }
      result = key;
      haptic('success');
      sheet.close();
    }

    function render() {
      if (step === 'show') {
        mount(root, html`
          <div class="recovery__intro">
            <span class="recovery__icon">${icon('key')}</span>
            <p>Google Drive 上的备份会用这把恢复密钥加密。只有你持有它，Google 和其他人都无法读取你的资料。</p>
          </div>
          <div class="recovery-key" role="group" aria-label="恢复密钥 ${key}">${key.split('-').map((g) => html`<span>${g}</span>`)}</div>
          <div class="action-row">
            <button type="button" class="btn btn--glass btn--small" data-rk="copy">${icon('note')}拷贝</button>
            <button type="button" class="btn btn--glass btn--small" data-rk="share">${icon('share')}存储到…</button>
          </div>
          <p class="callout">${icon('info')}<span>请存在安全的地方，例如「密码」App 或上锁的备忘录。换新手机时要用它还原；弄丢了，已有的 Google Drive 备份就打不开（在这台手机上可以随时换一把新的）。</span></p>
          <button type="button" class="btn btn--primary btn--block" data-rk="next">我已保存，下一步</button>
        `);
      } else {
        mount(root, html`
          <form class="recovery__form" novalidate>
            <p>为确认已经保存好，请输入或粘贴刚才的恢复密钥。</p>
            <div class="form">
              <label class="field"><span class="field__label">恢复密钥</span>
                <input class="field__input field__input--text recovery__input" name="rk" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-…"></label>
            </div>
            <p class="recovery__error" aria-live="polite"></p>
            <button type="submit" class="btn btn--primary btn--block">确认</button>
            <button type="button" class="btn btn--plain btn--block" data-rk="back">再看一次恢复密钥</button>
          </form>
        `);
      }
    }
  });
}

/** Ask for a saved recovery key. check(key) → true, or an error message to show. Resolves with the key or null. */
function askRecoveryKey({ title = '输入恢复密钥', message, check }) {
  return new Promise((resolve) => {
    let result = null;
    let busy = false;
    const sheet = openSheet({
      title,
      size: 'large',
      onClose: () => resolve(result),
      body: html`<form class="recovery recovery__form" novalidate>
        <div class="recovery__intro">
          <span class="recovery__icon">${icon('key')}</span>
          <p>${message}</p>
        </div>
        <div class="form">
          <label class="field"><span class="field__label">恢复密钥</span>
            <input class="field__input field__input--text recovery__input" name="rk" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-…"></label>
        </div>
        <p class="recovery__error" aria-live="polite"></p>
        <button type="submit" class="btn btn--primary btn--block">还原</button>
      </form>`,
      onMount(el) {
        el.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (busy) return;
          const err = el.querySelector('.recovery__error');
          const k = normalizeRecoveryKey(el.querySelector('[name=rk]').value);
          if (!k) { haptic('error'); err.textContent = '恢复密钥是 28 个英文字母和数字，例如 K7QM-2XNP-……'; return; }
          busy = true;
          err.textContent = '正在解密…';
          const r = await check(k);
          busy = false;
          if (r === true) { result = k; sheet.close(); return; }
          haptic('error');
          err.textContent = r || '恢复密钥不正确';
        });
      },
    });
  });
}

/** Replace the recovery key used for future backups. */
export async function changeRecoveryKey() {
  const ok = await confirmDialog({
    title: '更换恢复密钥？',
    message: '之后的备份会用新的恢复密钥加密。Google Drive 上已有的备份仍然需要旧的恢复密钥才能打开。',
    confirm: '更换',
  });
  if (!ok) return;
  const rk = await createRecoveryKey({ title: '新的恢复密钥' });
  if (!rk) return;
  await setupBackupKey(rk);
  toast('已更换恢复密钥', { icon: 'key', tone: 'success' });
  if (state.settings.gdriveConnected && hasUserData()) await backupNowToDrive({ interactive: true });
}

// ── Connect / back up / restore ─────────────────────────────────────────────

/**
 * Turn on Google Drive backup: sign in with Google first; the recovery key is set up on return (see
 * finishConnect), so a phone that should restore an existing backup never gets a key it will not use.
 */
export async function connectDrive({ switchDest = true } = {}) {
  if (state.demo) { toast('演示模式不能连接 Google Drive', { icon: 'info' }); return; }
  if (switchDest) await saveSettings({ backupDest: 'gdrive' });
  if (gdrive.hasToken()) { // still signed in from earlier in this visit: no need to leave the app
    if ((await finishConnect()) === 'ready') await backupNowToDrive({ interactive: false, announce: '已连接 Google Drive，并完成第一次加密备份' });
    return;
  }
  await gdrive.beginAuth('connect'); // leaves the app for Google's sign-in page
}

/** Back from Google after 'connect': offer existing backups to an empty phone, else make sure a key exists. */
async function finishConnect() {
  await saveSettings({ backupDest: 'gdrive' });
  // A phone without records (e.g. a new iPhone): restore instead of starting a new key and backup history.
  if (!hasUserData()) {
    let files = [];
    try { files = await gdrive.listBackups(); } catch { /* offer nothing */ }
    if (files.length) {
      const go = await confirmDialog({
        title: 'Google Drive 里已有备份',
        message: `找到 ${files.length} 份备份。这台手机还没有资料，要现在用恢复密钥还原吗？`,
        confirm: '还原', cancel: '稍后',
      });
      if (go) await restoreFromDriveFlow({ files });
      return 'restore';
    }
  }
  if (!(await hasBackupKey())) {
    const rk = await createRecoveryKey({ title: '设定恢复密钥' });
    if (!rk) {
      toast('没有设定恢复密钥，Google Drive 备份还没开启', { icon: 'info', duration: 5000 });
      return 'cancelled';
    }
    toast('正在准备加密…', { icon: 'lock', duration: 2500 });
    await setupBackupKey(rk);
  }
  await saveSettings({ gdriveConnected: true });
  if (!hasUserData()) {
    toast('已连接 Google Drive，开始记账后会自动加密备份', { icon: 'check', tone: 'success' });
    return 'empty';
  }
  return 'ready';
}

/** Handle the return from Google's sign-in page (result of gdrive.consumeRedirect()). */
export async function handleOAuthReturn(result) {
  if (!result) return;
  if (result.retry) { await gdrive.beginAuth(result.action, { returnHash: result.returnHash, present: result.presentAt }); return; }
  if (!result.ok) {
    await alertDialog({ title: 'Google Drive 没有连接', message: result.error });
    return;
  }
  if (result.action === 'restore') { await restoreFromDriveFlow(); return; }
  if (result.action === 'connect' && (await finishConnect()) !== 'ready') return;
  const r = await backupNowToDrive({
    interactive: false,
    announce: result.action === 'connect' ? '已连接 Google Drive，并完成第一次加密备份' : null,
  });
  if (r === 'needs-auth') {
    toast('Google 授权没有生效，请在「设置 → 备份」再试一次', { icon: 'warning', tone: 'error', duration: 6000 });
  }
}

/**
 * Back up to Drive now. interactive: allowed to set up the key / leave for Google sign-in.
 * Returns 'done' | 'needs-auth' | 'error' | 'no-key' | 'empty'.
 */
export async function backupNowToDrive({ interactive = true, announce = null } = {}) {
  if (state.demo) return 'error';
  if (!(await hasBackupKey())) {
    if (interactive) await connectDrive({ switchDest: false });
    return 'no-key';
  }
  if (!hasUserData()) {
    if (interactive) toast('还没有需要备份的资料', { icon: 'info' });
    return 'empty';
  }
  const reauth = () => gdrive.beginAuth('backup', { returnHash: location.hash || '#/today', silent: !!state.settings.gdriveConnected });
  if (!gdrive.hasToken()) {
    if (interactive) await reauth();
    return 'needs-auth';
  }
  try {
    await backupToDrive(snapshot());
    const now = Date.now();
    await saveSettings({ lastGdriveBackupAt: now, lastBackupAt: now, gdriveConnected: true });
    haptic('success');
    toast(announce || '已加密备份到 Google Drive', { icon: 'check', tone: 'success' });
    return 'done';
  } catch (err) {
    if (err.code === 'auth') {
      if (interactive) await reauth();
      return 'needs-auth';
    }
    toast(err.code === 'no-key' ? '请重新连接 Google Drive' : '备份没有成功，请检查网络后再试', { icon: 'warning', tone: 'error' });
    return 'error';
  }
}

/** Pick a Drive backup, open it (with this phone's key or the recovery key), then replace local data. */
export async function restoreFromDriveFlow({ files = null } = {}) {
  if (state.demo) { toast('演示模式不能还原', { icon: 'info' }); return; }
  const reauth = () => gdrive.beginAuth('restore', { returnHash: '#/settings', silent: !!state.settings.gdriveConnected });
  if (!files) {
    if (!gdrive.hasToken()) { await reauth(); return; }
    try {
      files = await gdrive.listBackups();
    } catch (err) {
      if (err.code === 'auth') { await reauth(); return; }
      toast('无法读取 Google Drive，请检查网络', { icon: 'warning', tone: 'error' });
      return;
    }
  }
  if (!files.length) { await alertDialog({ title: '没有找到备份', message: '这个 Google 帐号里还没有 Expenses Tracker 的备份。' }); return; }
  const fmt = (iso) => new Date(iso).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
  const id = await openChoiceSheet({
    title: '选择备份',
    options: files.map((f, i) => ({ id: f.id, label: fmt(f.createdTime), hint: i === 0 ? '最新' : '' })),
    value: null,
    footer: `只保留最近 ${gdrive.KEEP_BACKUPS} 份。`,
  });
  if (!id) return;
  let envelope;
  try {
    envelope = JSON.parse(await gdrive.downloadBackup(id));
  } catch {
    toast('下载失败，请再试一次', { icon: 'warning', tone: 'error' });
    return;
  }
  if (!isEnvelope(envelope)) { await alertDialog({ title: '无法还原', message: '这份文件不是加密备份。' }); return; }
  if (envelope.v !== 2) { await alertDialog({ title: '无法还原', message: '这份备份来自测试版本，格式已经不再支持。' }); return; }

  let text = await decryptWithLocalKey(envelope);
  let adopt = null;
  if (!text) {
    const key = await askRecoveryKey({
      message: '这份备份需要做备份时保存的恢复密钥（28 个字母和数字）。',
      check: async (k) => {
        try {
          const r = await decryptWithRecoveryKey(k, envelope);
          text = r.text;
          adopt = r.key;
          return true;
        } catch (err) {
          return err.code === 'bad-secret' ? '恢复密钥不正确，请再检查一次' : '无法解密这份备份';
        }
      },
    });
    if (!key || !text) return;
  }
  const parsed = parseBackup(text);
  if (!parsed.ok) { await alertDialog({ title: '无法还原', message: parsed.error }); return; }
  const d = parsed.data;
  const ok = await confirmDialog({
    title: '用这份备份取代目前的资料？',
    message: `${d.transactions.length} 笔记录 · ${d.holdings.length} 个持仓 · ${d.categories.length} 个类别\n\n目前手机里的资料会被完全取代。`,
    confirm: '还原', destructive: true,
  });
  if (!ok) return;
  // Keep backing up to Drive from this phone with the same recovery key.
  const replacedKey = !!adopt && (await hasBackupKey());
  if (adopt) await adoptBackupKey(adopt, envelope);
  await replaceAllData({ ...d, settings: { ...d.settings, onboarded: true, backupDest: 'gdrive', gdriveConnected: true } });
  haptic('success');
  toast(parsed.dropped ? `已还原（略过 ${parsed.dropped} 笔无效资料）` : '已还原', { icon: 'check', tone: 'success' });
  if (replacedKey) {
    await alertDialog({
      title: '恢复密钥已切换',
      message: '之后的备份会使用你刚才输入的恢复密钥。之前在这台手机上设定的那一把不再用于新的备份。',
    });
  }
}

export async function disconnectDrive() {
  const ok = await confirmDialog({
    title: '中断 Google Drive 连接？',
    message: '之后不再备份到 Google Drive，备份位置会改回 iCloud。已上传的加密备份会留在你的 Google Drive（隐藏的 App 资料夹），可在 Google Drive 网页版「设置 → 管理应用程序」删除。',
    confirm: '中断连接', destructive: true,
  });
  if (!ok) return;
  gdrive.forgetToken();
  await saveSettings({ backupDest: 'icloud', gdriveConnected: false });
  toast('已中断 Google Drive 连接', { icon: 'check' });
}

/**
 * Called when the app opens or returns to the foreground. Backs up silently when a Google session from this
 * visit is still valid; otherwise the Today screen shows a one-tap banner.
 */
export async function runAutoBackup() {
  const s = state.settings;
  if (state.demo || !backupDue(s) || !hasUserData()) return;
  if (s.backupDest === 'gdrive' && s.gdriveConnected && gdrive.hasToken() && (await hasBackupKey())) {
    await backupNowToDrive({ interactive: false });
  }
}
