// 设置 — plan, savings, living situation, categories, fixed items, habits, data & privacy.
import { html, icon } from '../html.js';
import { haptic } from '../haptics.js';
import { confirmDialog, toast } from '../overlays.js';
import { saveSettings, eraseEverything } from '../../data/store.js';
import * as lock from '../../data/lock.js';
import { formatMoney } from '../../core/money.js';
import { HOUSING_OPTIONS, TRANSPORT_OPTIONS } from '../../core/benchmarks.js';
import { openPlanSheet, openMoneySheet, openChoiceSheet, openTextSheet } from '../sheets/plan.js';
import { openCategoryManager } from '../sheets/categories.js';
import { openRecurringManager } from '../sheets/recurring.js';
import { openInstallGuide, openReminderGuide, openPrivacySheet, isStandalone } from '../sheets/guides.js';
import { exportBackup, importBackup, exportCSV } from '../sheets/backup.js';
import { setupPin, confirmPin } from '../sheets/lockscreen.js';

export const APP_VERSION = '1.0.0';

let lockOn = false;

const row = ({ action, glyph, color, title, value = '', sub = '', danger = false, chevron = true }) => html`
  <li><button type="button" class="row ${danger ? 'row--danger' : ''}" data-set="${action}">
    ${glyph ? html`<span class="row__glyph-tile" data-color="${color || 'gray'}">${icon(glyph)}</span>` : ''}
    <span class="row__body"><span class="row__title">${title}</span>${sub ? html`<span class="row__subtitle">${sub}</span>` : ''}</span>
    ${value !== '' ? html`<span class="row__detail">${value}</span>` : ''}
    ${chevron ? icon('chevron-right', 'row__chevron') : ''}
  </button></li>`;

const screen = {
  id: 'settings',
  title: '设置',

  render({ state, demo }) {
    const s = state.settings;
    const budget = s.expectedIncome ? Math.max(0, s.expectedIncome - s.savingsTarget) : 0;
    const housing = HOUSING_OPTIONS.find((o) => o.id === s.profile.housing)?.label;
    const transport = TRANSPORT_OPTIONS.find((o) => o.id === s.profile.transport)?.label;
    const activeRec = state.recurring.filter((r) => r.active).length;
    const backupDays = s.lastBackupAt ? Math.floor((Date.now() - s.lastBackupAt) / 86_400_000) : null;

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
        <p class="section__footer">用来计算个人 Runway：不靠收入还能撑几个月。存款变动时记得回来更新。</p>
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
        <h2 class="section__title">资料与隐私</h2>
        <ul class="list">
          ${row({ action: 'backup', glyph: 'upload', color: 'green', title: '立即备份', sub: backupDays === null ? '还没有备份过' : backupDays === 0 ? '今天已备份' : `上次备份：${backupDays} 天前` })}
          ${row({ action: 'restore', glyph: 'download', color: 'blue', title: '从备份还原' })}
          ${row({ action: 'csv', glyph: 'list', color: 'gray', title: '导出 CSV' })}
          <li class="row row--toggle">
            <span class="row__glyph-tile" data-color="gray">${icon('lock')}</span>
            <span class="row__body"><span class="row__title">密码锁</span><span class="row__subtitle">打开 App 或离开超过 1 分钟需输入密码</span></span>
            <input type="checkbox" switch class="switch" data-lock ${lockOn ? 'checked' : ''} ${demo ? 'disabled' : ''} aria-label="密码锁">
          </li>
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

  afterRender(el) {
    lock.isEnabled().then((v) => {
      lockOn = v;
      const t = el.querySelector('[data-lock]');
      if (t) t.checked = v;
    }).catch(() => {});
  },

  async onClick(e, ctx) {
    const lockToggle = e.target.closest('[data-lock]');
    if (lockToggle) {
      e.preventDefault();
      if (ctx.demo) return;
      if (!lockOn) {
        if (await setupPin()) lockOn = true;
      } else if (await confirmPin()) {
        await lock.disable();
        lockOn = false;
        toast('密码锁已关闭', { icon: 'lock' });
      }
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
        const v = await openMoneySheet({ title: '目前存款', label: '现在总共有多少存款', value: s.currentSavings, hint: '包括银行存款、定存等随时可以动用的钱。只存在这台手机。' });
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
      case 'backup': await exportBackup(); break;
      case 'restore': importBackup(); break;
      case 'csv': await exportCSV(); break;
      case 'privacy': openPrivacySheet(); break;
      case 'erase': {
        if (ctx.demo) { toast('演示模式没有真实资料', { icon: 'info' }); break; }
        const ok = await confirmDialog({ title: '清除全部资料？', message: '所有记录、类别、固定项目和设定都会被删除，无法撤销。建议先备份。', confirm: '清除', destructive: true });
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

export default screen;
