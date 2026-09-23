// First launch: 3 short steps — welcome, monthly plan, living situation.
import { html, icon, mount } from '../html.js';
import { openSheet } from '../overlays.js';
import { haptic } from '../haptics.js';
import { state, saveSettings } from '../../data/store.js';
import { HOUSING_OPTIONS, TRANSPORT_OPTIONS } from '../../core/benchmarks.js';
import { centsToInput, formatMoney, toCents } from '../../core/money.js';
import { todayISO } from '../../core/dates.js';
import { isIOS, isStandalone, openInstallGuide } from './guides.js';

export function openOnboarding() {
  const s = {
    step: 0,
    income: centsToInput(state.settings.expectedIncome),
    target: centsToInput(state.settings.savingsTarget),
    housing: state.settings.profile.housing,
    transport: state.settings.profile.transport,
  };
  const sheet = openSheet({
    title: '',
    size: 'full',
    className: 'sheet-layer--onboarding',
    dismissible: false,
    body: html`<div class="onboarding"></div>`,
    onMount(el) {
      el.querySelector('.sheet__close').hidden = true;
      el.addEventListener('input', (e) => {
        if (e.target.name === 'income') s.income = e.target.value;
        if (e.target.name === 'target') s.target = e.target.value;
        if (e.target.name === 'income' || e.target.name === 'target') updatePreview();
      });
      el.addEventListener('click', async (e) => {
        const h = e.target.closest('[data-housing]');
        if (h) { s.housing = h.dataset.housing; haptic(); render(); return; }
        const t = e.target.closest('[data-transport]');
        if (t) { s.transport = t.dataset.transport; haptic(); render(); return; }
        if (e.target.closest('[data-install]')) { openInstallGuide(); return; }
        if (e.target.closest('[data-next]')) { await next(); return; }
        if (e.target.closest('[data-back]')) { s.step -= 1; haptic(); render(); }
      });
    },
  });
  const root = sheet.body.querySelector('.onboarding');
  render();

  function money(v) { return v.trim() ? toCents(v) : 0; }

  function updatePreview() {
    const p = root.querySelector('.plan-preview');
    if (!p) return;
    root.querySelector('[data-next]').textContent = s.income.trim() ? '下一步' : '先跳过';
    const inc = money(s.income), tgt = money(s.target);
    if (inc === null || tgt === null) { p.textContent = '请输入正确的金额'; p.dataset.tone = 'bad'; return; }
    if (!inc) { p.textContent = '可以先跳过，之后在「设置」填写。'; p.dataset.tone = 'info'; return; }
    if (tgt > inc) { p.textContent = '存款目标比收入还高。'; p.dataset.tone = 'bad'; return; }
    p.dataset.tone = 'info';
    p.textContent = `每月可支配 ${formatMoney(inc - tgt, { round: true })}，平均每天约 ${formatMoney(Math.floor((inc - tgt) / 30), { round: true })}`;
  }

  async function next() {
    if (s.step === 1) {
      const inc = money(s.income), tgt = money(s.target);
      if (inc === null || tgt === null || (inc && tgt > inc)) { haptic('error'); updatePreview(); return; }
    }
    if (s.step < 2) { s.step += 1; haptic(); render(); return; }
    haptic('success');
    await saveSettings({
      expectedIncome: money(s.income) || 0,
      savingsTarget: money(s.target) || 0,
      profile: { housing: s.housing, transport: s.transport },
      onboarded: true,
      startDate: state.settings.startDate || todayISO(),
    });
    sheet.close();
    if (isIOS() && !isStandalone()) setTimeout(openInstallGuide, 450);
  }

  function render() {
    const dots = html`<div class="onboarding__dots">${[0, 1, 2].map((i) => html`<span class="${i === s.step ? 'is-active' : ''}"></span>`)}</div>`;
    let body;
    if (s.step === 0) {
      const inSafari = isIOS() && !isStandalone();
      body = html`
        ${inSafari ? html`<button type="button" class="banner banner--warn" data-install>
          <span class="banner__icon">${icon('add-home')}</span>
          <span class="banner__text"><strong>建议先添加到主屏幕</strong><span>在 Safari 里记的资料不会出现在主屏幕 App 里。点这里看 4 步安装方法。</span></span>
          ${icon('chevron-right', 'banner__chevron')}
        </button>` : ''}
        <div class="onboarding__hero">
          <img class="onboarding__appicon" src="assets/icons/icon-512.png" alt="" width="96" height="96">
          <h1 class="onboarding__title">Expenses Tracker</h1>
          <p class="onboarding__lead">看清每一分钱去了哪里</p>
        </div>
        <ul class="features">
          <li><span class="features__icon" data-color="orange">${icon('plus')}</span><div><strong>3 秒记一笔</strong><p>输入金额，点一下类别，就完成。</p></div></li>
          <li><span class="features__icon" data-color="blue">${icon('today')}</span><div><strong>每天知道还能花多少</strong><p>按收入和存款目标，自动算出今天的额度。</p></div></li>
          <li><span class="features__icon" data-color="green">${icon('chart')}</span><div><strong>对照吉隆坡同龄创业者</strong><p>每月告诉你哪里合理、哪里花多了。</p></div></li>
          <li><span class="features__icon" data-color="gray">${icon('shield')}</span><div><strong>资料只在这台手机</strong><p>没有账号、没有服务器、不会上传。</p></div></li>
        </ul>`;
    } else if (s.step === 1) {
      body = html`
        <div class="onboarding__head"><h1 class="onboarding__title">每月计划</h1><p class="onboarding__lead">用来算出你每天可以花多少</p></div>
        <div class="form">
          <label class="field field--money"><span class="field__label">预计每月收入</span>
            <span class="field__control"><span class="field__prefix">RM</span>
            <input class="field__input" name="income" type="text" inputmode="decimal" placeholder="例如 4000" value="${s.income}" autocomplete="off"></span>
            <span class="field__hint">收入不固定？填一个保守的数字。</span></label>
          <label class="field field--money"><span class="field__label">每月存款目标</span>
            <span class="field__control"><span class="field__prefix">RM</span>
            <input class="field__input" name="target" type="text" inputmode="decimal" placeholder="例如 800" value="${s.target}" autocomplete="off"></span>
            <span class="field__hint">创业期建议至少存下收入的 20%。</span></label>
          <p class="plan-preview"></p>
        </div>`;
    } else {
      body = html`
        <div class="onboarding__head"><h1 class="onboarding__title">你的情况</h1><p class="onboarding__lead">让吉隆坡的参考标准更贴近你</p></div>
        <h3 class="section__title">住房</h3>
        <div class="choice-cards">
          ${HOUSING_OPTIONS.map((o) => html`<button type="button" class="choice-card ${s.housing === o.id ? 'is-selected' : ''}" data-housing="${o.id}" aria-pressed="${s.housing === o.id}">${o.label}</button>`)}
        </div>
        <h3 class="section__title">主要交通</h3>
        <div class="choice-cards">
          ${TRANSPORT_OPTIONS.map((o) => html`<button type="button" class="choice-card ${s.transport === o.id ? 'is-selected' : ''}" data-transport="${o.id}" aria-pressed="${s.transport === o.id}">${o.label}</button>`)}
        </div>
        <p class="section__footer">之后可以在「设置」修改。</p>`;
    }
    mount(root, html`
      <div class="onboarding__content">${body}</div>
      <div class="onboarding__footer">
        ${dots}
        <button type="button" class="btn btn--primary btn--large btn--block" data-next>${s.step === 0 ? '开始' : s.step === 1 ? (s.income.trim() ? '下一步' : '先跳过') : '完成'}</button>
        ${s.step > 0 ? html`<button type="button" class="btn btn--plain btn--block" data-back>上一步</button>` : ''}
      </div>`);
    updatePreview();
  }
}
