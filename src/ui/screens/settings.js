// 设置 — plan, savings, living situation, bookkeeping, security, backup & privacy.
import { html, icon } from '../html.js';
import { haptic } from '../haptics.js';
import { confirmDialog, toast, alertDialog } from '../overlays.js';
import { saveSettings, eraseEverything } from '../../data/store.js';
import * as lock from '../../data/lock.js';
import { formatMoney } from '../../core/money.js';
import { BACKUP_FREQS } from '../../core/settings.js';
import { HOUSING_OPTIONS, TRANSPORT_OPTIONS } from '../../core/benchmarks.js';
import { openPlanSheet, openMoneySheet, openChoiceSheet, openTextSheet } from '../sheets/plan.js';
import { openCategoryManager } from '../sheets/categories.js';
import { openRecurringManager } from '../sheets/recurring.js';
import { openInstallGuide, openReminderGuide, openPrivacySheet, isStandalone } from '../sheets/guides.js';
import { exportBackup, importBackup, exportCSV } from '../sheets/backup.js';
import { connectDrive, disconnectDrive, backupNowToDrive, restoreFromDriveFlow, changeRecoveryKey } from '../sheets/cloud.js';
import { setupPin, confirmPin } from '../sheets/lockscreen.js';
import { hasBackupKey } from '../../data/cloudbackup.js';

export const APP_VERSION = '1.1.2';

let lockInfo = { enabled: false, pinLength: 6, autoLockMs: 60_000, biometric: false };
let faceIdAvailable = false;
let hasDriveKey = false;

const row = ({ action, glyph, color, title, value = '', sub = '', danger = false, chevron = true }) => html`
  <li><button type="button" class="row ${danger ? 'row--danger' : ''}" data-set="${action}">
    ${glyph ? html`<span class="row__glyph-tile" data-color="${color || 'gray'}">${icon(glyph)}</span>` : ''}
    <span class="row__body"><span class="row__title">${title}</span>${sub ? html`<span class="row__subtitle">${sub}</span>` : ''}</span>
    ${value !== '' ? html`<span class="row__detail">${value}</span>` : ''}
    ${chevron ? icon('chevron-right', 'row__chevron') : ''}
  </button></li>`;

const toggleRow = ({ attr, glyph, color, title, sub, checked, disabled }) => html`
  <li class="row row--toggle">
    <span class="row__glyph-tile" data-color="${color}">${icon(glyph)}</span>
    <span class="row__body"><span class="row__title">${title}</span>${sub ? html`<span class="row__subtitle">${sub}</span>` : ''}</span>
    <input type="checkbox" switch class="switch" data-toggle="${attr}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} aria-label="${title}">
  </li>`;

function daysAgo(ts) {
  if (!ts) return null;
  return Math.floor((Date.now() - ts) / 86_400_000);
}

const agoText = (ts) => {
  const d = daysAgo(ts);
  return d === null ? '还没有备份过' : d === 0 ? '今天' : `${d} 天前`;
};

const screen = {
  id: 'settings',
  title: '设置',

  render({ state, demo }) {
    const s = state.settings;
    const budget = s.expectedIncome ? Math.max(0, s.expectedIncome - s.savingsTarget) : 0;
    const housing = HOUSING_OPTIONS.find((o) => o.id === s.profile.housing)?.label;
    const transport = TRANSPORT_OPTIONS.find((o) => o.id === s.profile.transport)?.label;
    const activeRec = state.recurring.filter((r) => r.active).length;
    const autoLockLabel = lock.AUTO_LOCK_OPTIONS.find((o) => o.id === lockInfo.autoLockMs)?.label || '1 分钟';
    const freqLabel = BACKUP_FREQS.find((f) => f.id === s.backupFreq)?.label || '每周';
    const drive = s.backupDest === 'gdrive';

    return html`
      <header class="screen__header">
        <h1 class="large-title">设置</h1>
      </header>

      <section class="section">
        <h2 class="section__title">每月计划</h2>
        <ul class="list">
          ${row({ action: 'income', glyph: 'salary', color: 'green', title: '预计每月收入', value: s.expectedIncome ? formatMoney(s.expectedIncome, { round: true }) : '未设定' })}
          ${row({ action: 'target', glyph: 'target', color: 'blue', title: '每月存款目标', value: s.savingsTarget ? formatMoney(s.savingsTarget, { round: true }) : '未设定' })}
        </ul>
        <p class="section__footer">${budget ? `每月可支配 ${formatMoney(budget, { round: true })}（收入 − 存款目标），「今天还能花」按这个数字计算。` : '填入收入后，「今天」页会显示每天还能花多少。'}</p>
      </section>

      <section class="section">
        <h2 class="section__title">储蓄</h2>
        <ul class="list">
          ${row({ action: 'savings', glyph: 'savings', color: 'pink', title: '目前存款', value: s.currentSavings ? formatMoney(s.currentSavings, { round: true }) : '未填写' })}
          ${row({ action: 'goal', glyph: 'sparkles', color: 'orange', title: '长期目标', value: s.goalAmount ? `${s.goalName} ${formatMoney(s.goalAmount, { round: true })}` : '未设定' })}
        </ul>
        <p class="section__footer">用来计算个人 Runway：不靠收入还能撑几个月。投资另外在「投资」页管理。</p>
      </section>

      <section class="section">
        <h2 class="section__title">我的情况</h2>
        <ul class="list">
          ${row({ action: 'housing', glyph: 'housing', color: 'indigo', title: '住房', value: housing })}
          ${row({ action: 'transport', glyph: 'transport', color: 'blue', title: '主要交通', value: transport })}
        </ul>
        <p class="section__footer">用来调整「吉隆坡 24 岁创业者」的参考标准。</p>
      </section>

      <section class="section">
        <h2 class="section__title">记账</h2>
        <ul class="list">
          ${row({ action: 'categories', glyph: 'list', color: 'orange', title: '类别', sub: '排序、改名、新增' })}
          ${row({ action: 'recurring', glyph: 'subscriptions', color: 'cyan', title: '固定项目', sub: '房租、月费、订阅、薪水', value: activeRec ? `${activeRec} 个` : '' })}
          ${row({ action: 'reminder', glyph: 'bell', color: 'red', title: '每日提醒', sub: '用 iPhone 自带功能，免费又安全' })}
          ${!isStandalone() ? row({ action: 'install', glyph: 'add-home', color: 'gray', title: '添加到主屏幕' }) : ''}
        </ul>
      </section>

      <section class="section">
        <h2 class="section__title">安全</h2>
        <ul class="list">
          ${toggleRow({ attr: 'lock', glyph: 'lock', color: 'gray', title: '密码锁', sub: lockInfo.enabled ? `${lockInfo.pinLength} 位密码` : '打开 App 需要输入 6 位密码', checked: lockInfo.enabled, disabled: demo })}
          ${lockInfo.enabled ? html`
            ${faceIdAvailable ? toggleRow({ attr: 'faceid', glyph: 'faceid', color: 'green', title: 'Face ID 解锁', sub: '失败时可以改用密码', checked: lockInfo.biometric }) : ''}
            ${row({ action: 'autolock', glyph: 'clock', color: 'indigo', title: '自动上锁', value: autoLockLabel, sub: '离开 App 多久后需要重新解锁' })}
            ${row({ action: 'changepin', glyph: 'note', color: 'gray', title: lockInfo.pinLength === 6 ? '更改密码' : '改为 6 位密码' })}
          ` : ''}
        </ul>
        ${lockInfo.enabled && !faceIdAvailable ? html`<p class="section__footer">这个设备目前无法使用 Face ID。请从主屏幕图标打开 App，并确认 iPhone 已设定 Face ID。</p>` : ''}
      </section>

      <section class="section">
        <h2 class="section__title">备份</h2>
        <ul class="list">
          ${row({ action: 'backupfreq', glyph: 'subscriptions', color: 'teal', title: '自动备份', value: freqLabel, sub: '打开 App 时检查，到时间就提醒你一键备份' })}
          ${row({ action: 'backupdest', glyph: drive ? 'cloud' : 'upload', color: drive ? 'blue' : 'green', title: '备份位置', value: drive ? 'Google Drive' : 'iCloud 云盘' })}
          ${drive ? html`
            ${row({ action: 'drivebackup', glyph: 'cloud', color: 'blue', title: s.gdriveConnected ? '立即备份到 Google Drive' : '连接 Google Drive', sub: s.gdriveConnected ? `上次：${agoText(s.lastGdriveBackupAt)} · 已用恢复密钥加密` : '先用只有你持有的恢复密钥加密，再上传' })}
            ${hasDriveKey ? row({ action: 'recoverykey', glyph: 'key', color: 'orange', title: '恢复密钥', sub: '换新手机还原时需要；可以更换' }) : ''}
            ${s.gdriveConnected ? row({ action: 'drivedisconnect', title: '中断 Google Drive 连接', danger: true, chevron: false }) : ''}
          ` : html`
            ${row({ action: 'backup', glyph: 'upload', color: 'green', title: '立即备份', sub: `上次：${agoText(s.lastBackupAt)} · 分享菜单选「存储到文件」` })}
          `}
        </ul>
        <ul class="list">
          ${row({ action: 'driverestore', glyph: 'cloud', color: 'indigo', title: '从 Google Drive 还原', sub: '换新手机时用，需要恢复密钥' })}
          ${row({ action: 'restore', glyph: 'download', color: 'blue', title: '从备份文件还原' })}
          ${row({ action: 'csv', glyph: 'list', color: 'gray', title: '导出 CSV' })}
          ${row({ action: 'privacy', glyph: 'shield', color: 'green', title: '隐私说明' })}
        </ul>
      </section>

      <section class="section">
        <ul class="list">
          ${row({ action: 'erase', title: '清除全部资料', danger: true, chevron: false })}
        </ul>
        <p class="section__footer section__footer--center">Expenses Tracker ${APP_VERSION} · 仅供个人使用<br>所有资料只存在这台设备</p>
      </section>
    `;
  },

  afterRender(el, ctx) {
    Promise.all([lock.getInfo(), lock.biometricAvailable(), ctx.demo ? false : hasBackupKey()]).then(([info, bio, key]) => {
      const nextFaceId = bio && !ctx.demo;
      const changed = JSON.stringify(info) !== JSON.stringify(lockInfo) || nextFaceId !== faceIdAvailable || key !== hasDriveKey;
      lockInfo = info;
      faceIdAvailable = nextFaceId;
      hasDriveKey = key;
      if (changed) ctx.rerender();
    }).catch(() => {});
  },

  async onClick(e, ctx) {
    const t = e.target.closest('[data-toggle]');
    if (t) {
      e.preventDefault();
      if (ctx.demo) { toast('演示模式不能更改安全设定', { icon: 'info' }); return; }
      await onToggle(t.dataset.toggle, ctx);
      lockInfo = await lock.getInfo();
      ctx.rerender();
      return;
    }
    const b = e.target.closest('[data-set]');
    if (!b) return;
    haptic();
    const s = ctx.state.settings;
    switch (b.dataset.set) {
      case 'income':
      case 'target':
        await openPlanSheet();
        break;
      case 'savings': {
        const v = await openMoneySheet({ title: '目前存款', label: '现在总共有多少存款', value: s.currentSavings, hint: '包括银行存款、定存等随时可以动用的钱（投资另计）。只存在这台手机。' });
        if (v !== null) await saveSettings({ currentSavings: v });
        break;
      }
      case 'goal': {
        const name = await openTextSheet({ title: '长期目标', label: '目标名称', value: s.goalName, placeholder: '例如：应急金、买电脑' });
        if (name === null) break;
        const v = await openMoneySheet({ title: name, label: '目标金额', value: s.goalAmount, hint: '建议先存够 6 个月生活费作为应急金。' });
        if (v !== null) await saveSettings({ goalName: name, goalAmount: v });
        break;
      }
      case 'housing': {
        const v = await openChoiceSheet({ title: '住房情况', options: HOUSING_OPTIONS, value: s.profile.housing });
        if (v) await saveSettings({ profile: { ...s.profile, housing: v } });
        break;
      }
      case 'transport': {
        const v = await openChoiceSheet({ title: '主要交通方式', options: TRANSPORT_OPTIONS, value: s.profile.transport });
        if (v) await saveSettings({ profile: { ...s.profile, transport: v } });
        break;
      }
      case 'categories': openCategoryManager(); break;
      case 'recurring': openRecurringManager(); break;
      case 'reminder': openReminderGuide(); break;
      case 'install': openInstallGuide(); break;
      case 'autolock': {
        const v = await openChoiceSheet({ title: '自动上锁', options: lock.AUTO_LOCK_OPTIONS, value: lockInfo.autoLockMs, footer: '离开 App（切到别的 App 或锁上手机）超过这个时间，回来时需要重新解锁。' });
        if (v !== null) { await lock.setAutoLock(v); lockInfo = await lock.getInfo(); ctx.rerender(); }
        break;
      }
      case 'changepin': {
        if (!(await confirmPin({ sheetTitle: '更改密码' }))) break;
        const pin = await setupPin({ title: '设定新的 6 位密码' });
        if (pin) {
          lockInfo = await lock.getInfo();
          ctx.rerender();
        }
        break;
      }
      case 'backupfreq': {
        const v = await openChoiceSheet({
          title: '自动备份',
          options: BACKUP_FREQS.map((f) => ({ id: f.id, label: f.label })),
          value: s.backupFreq,
          footer: 'iPhone 不允许网页 App 在背景运行，所以会在你打开 App 时检查。到时间了，「今天」页会提醒你：iCloud 点一下存到「文件」；Google Drive 点一下会短暂跳到 Google 确认，再自动回来完成备份。',
        });
        if (v) await saveSettings({ backupFreq: v });
        break;
      }
      case 'backupdest': {
        const v = await openChoiceSheet({
          title: '备份位置',
          options: [
            { id: 'icloud', label: 'iCloud 云盘', hint: '到时间时提醒你，点一下用「存储到文件」保存', cat: { icon: 'upload', color: 'green' } },
            { id: 'gdrive', label: 'Google Drive（加密）', hint: '用只有你持有的恢复密钥加密，到时间一键完成', cat: { icon: 'cloud', color: 'blue' } },
          ],
          value: s.backupDest,
        });
        if (v === 'gdrive' && s.backupDest !== 'gdrive') await connectDrive({ switchDest: true });
        else if (v === 'icloud') await saveSettings({ backupDest: 'icloud' });
        break;
      }
      case 'drivebackup':
        if (!s.gdriveConnected) await connectDrive({ switchDest: false });
        else await backupNowToDrive({ interactive: true });
        break;
      case 'driverestore': await restoreFromDriveFlow(); break;
      case 'recoverykey': await changeRecoveryKey(); break;
      case 'drivedisconnect': await disconnectDrive(); break;
      case 'backup': await exportBackup(); break;
      case 'restore': importBackup(); break;
      case 'csv': await exportCSV(); break;
      case 'privacy': openPrivacySheet(); break;
      case 'erase': {
        if (ctx.demo) { toast('演示模式没有真实资料', { icon: 'info' }); break; }
        const ok = await confirmDialog({ title: '清除全部资料？', message: '所有记录、投资、类别、固定项目和设定都会被删除，无法撤销。建议先备份。', confirm: '清除', destructive: true });
        if (!ok) break;
        const sure = await confirmDialog({ title: '最后确认', message: '真的要删除全部资料吗？', confirm: '全部删除', destructive: true });
        if (!sure) break;
        await lock.disable();
        await eraseEverything();
        location.reload();
        break;
      }
      default: break;
    }
  },
};

async function onToggle(which, ctx) {
  if (which === 'lock') {
    if (!lockInfo.enabled) {
      await setupPin();
      return;
    }
    if (await confirmPin({ sheetTitle: '关闭密码锁' })) {
      await lock.disable();
      toast('密码锁已关闭', { icon: 'lock' });
    }
    return;
  }
  if (which === 'faceid') {
    if (lockInfo.biometric) {
      await lock.disableBiometric();
      toast('已关闭 Face ID 解锁', { icon: 'faceid' });
      return;
    }
    try {
      await lock.enableBiometric();
      haptic('success');
      toast('Face ID 解锁已开启', { icon: 'faceid', tone: 'success' });
    } catch (err) {
      if (err?.name !== 'NotAllowedError') {
        await alertDialog({ title: '无法开启 Face ID', message: '请从主屏幕图标打开 App，并确认 iPhone 已设定 Face ID，也允许 Safari 使用「密码与通行密钥」。' });
      }
    }
  }
}

export default screen;
