// Investment sheets: record money in / out, update market values, holdings, plan settings.
import { html, icon, catIcon, mount, money } from '../html.js';
import { openSheet, toast, confirmDialog } from '../overlays.js';
import { haptic } from '../haptics.js';
import {
  state, subscribe, saveHolding, removeHolding, addFlow, deleteFlow, addValuations, deleteValuation,
  restoreInvestRecord, saveInvestPlan,
} from '../../data/store.js';
import { HOLDING_KINDS, FREQ_OPTIONS, holdingSummary, sanitizeInvest } from '../../core/invest.js';
import { centsToInput, formatMoney, formatPercent, toCents } from '../../core/money.js';
import { dayLabel, isValidISODate, todayISO } from '../../core/dates.js';
import { openChoiceSheet, openMoneySheet, openNumberSheet } from './plan.js';

const kindOf = (id) => HOLDING_KINDS.find((k) => k.id === id) || HOLDING_KINDS[HOLDING_KINDS.length - 1];
export const holdingIcon = (h) => ({ icon: h.kind === 'fixed' ? 'savings' : 'invest', color: kindOf(h.kind).color });
const activeHoldings = () => state.holdings.filter((h) => !h.archived).sort((a, b) => a.order - b.order);

/** Action menu from the "+" button. */
export async function openInvestActions() {
  const hasHoldings = activeHoldings().length > 0;
  const choice = await openChoiceSheet({
    title: '投资记录',
    options: [
      { id: 'in', label: '记录投入', hint: '把钱放进某个持仓', cat: { icon: 'arrow-down', color: 'green' } },
      ...(hasHoldings ? [
        { id: 'value', label: '更新市值', hint: '填入每个持仓现在值多少', cat: { icon: 'trendUp', color: 'blue' } },
        { id: 'out', label: '记录取出', hint: '卖出或提领的金额', cat: { icon: 'arrow-up', color: 'orange' } },
      ] : []),
      { id: 'holding', label: '新增持仓', hint: '例如：指数 ETF、股票、定存', cat: { icon: 'plus', color: 'gray' } },
    ],
  });
  if (choice === 'in' || choice === 'out') openFlowSheet({ type: choice });
  else if (choice === 'value') openValuationSheet();
  else if (choice === 'holding') openHoldingEditor();
}

/** Record money going into (or out of) a holding. */
export function openFlowSheet({ type = 'in', holdingId = null } = {}) {
  const holdings = activeHoldings();
  const s = {
    type,
    holdingId: holdingId || holdings[0]?.id || null,
    newName: '',
    newKind: 'etf',
    date: todayISO(),
  };
  const creating = () => !s.holdingId;
  const sheet = openSheet({
    title: type === 'in' ? '记录投入' : '记录取出',
    size: 'large',
    actions: html`<button type="button" class="btn btn--primary btn--small" data-save>保存</button>`,
    body: html`<div class="invest-form"></div>`,
    onMount(el) {
      el.addEventListener('click', async (e) => {
        const t = e.target.closest('[data-flow-type]');
        if (t) {
          s.type = t.dataset.flowType;
          if (s.type === 'out' && !s.holdingId) s.holdingId = holdings[0]?.id || null; // can't withdraw from a new holding
          sheet.setTitle(s.type === 'in' ? '记录投入' : '记录取出');
          haptic(); render(); return;
        }
        const h = e.target.closest('[data-holding]');
        if (h) { s.holdingId = h.dataset.holding || null; haptic(); render(); return; }
        const k = e.target.closest('[data-kind]');
        if (k) { s.newKind = k.dataset.kind; haptic(); render(); return; }
        if (e.target.closest('[data-save]')) await save();
      });
      el.addEventListener('input', (e) => {
        if (e.target.name === 'newName') s.newName = e.target.value;
        if (e.target.name === 'date' && e.target.value) s.date = e.target.value;
        if (e.target.name === 'amount') s.amount = e.target.value;
        if (e.target.name === 'note') s.note = e.target.value;
      });
    },
  });
  const root = sheet.body.querySelector('.invest-form');
  render();

  function render() {
    const focused = document.activeElement?.name;
    mount(root, html`
      <div class="segmented">
        <button type="button" class="segmented__item ${s.type === 'in' ? 'is-active' : ''}" data-flow-type="in">投入</button>
        <button type="button" class="segmented__item ${s.type === 'out' ? 'is-active' : ''}" data-flow-type="out">取出</button>
      </div>
      <div class="form">
        <label class="field field--money"><span class="field__label">金额</span>
          <span class="field__control"><span class="field__prefix">RM</span>
          <input class="field__input" name="amount" type="text" inputmode="decimal" placeholder="0" value="${s.amount || ''}" autocomplete="off"></span></label>
      </div>
      <h3 class="section__title">持仓</h3>
      <div class="chips">
        ${holdings.map((h) => html`<button type="button" class="chip chip--select ${s.holdingId === h.id ? 'is-on' : ''}" data-holding="${h.id}" aria-pressed="${s.holdingId === h.id}">
          ${catIcon(holdingIcon(h), 'cat-icon--xs')}<span>${h.name}</span></button>`)}
        ${s.type === 'in' ? html`<button type="button" class="chip chip--select ${creating() ? 'is-on' : ''}" data-holding="" aria-pressed="${creating()}">${icon('plus')}<span>新持仓</span></button>` : ''}
      </div>
      ${creating() && s.type === 'in' ? html`
        <div class="form">
          <label class="field"><span class="field__label">新持仓名称</span>
            <input class="field__input field__input--text" name="newName" maxlength="30" placeholder="例如：全球指数 ETF" value="${s.newName}" autocomplete="off"></label>
        </div>
        <div class="choice-cards choice-cards--wrap">
          ${HOLDING_KINDS.map((k) => html`<button type="button" class="choice-card ${s.newKind === k.id ? 'is-selected' : ''}" data-kind="${k.id}" aria-pressed="${s.newKind === k.id}">${k.label}</button>`)}
        </div>` : ''}
      <div class="form">
        <label class="field field--inline"><span class="field__label">日期</span>
          <input class="field__select" type="date" name="date" value="${s.date}" max="${todayISO()}"></label>
        <label class="field"><span class="field__label">备注（可选）</span>
          <input class="field__input field__input--text" name="note" maxlength="120" value="${s.note || ''}" placeholder="${s.type === 'in' ? '例如：第一年投入' : '例如：部分卖出'}" autocomplete="off"></label>
      </div>
      <p class="section__footer">投资的钱不算进「支出」，也不会影响「今天还能花」。</p>
    `);
    if (focused) root.querySelector(`[name=${focused}]`)?.focus({ preventScroll: true });
  }

  async function save() {
    const amount = toCents(s.amount || '');
    if (!amount) { haptic('error'); toast('请输入正确的金额', { icon: 'warning', tone: 'error' }); return; }
    if (!isValidISODate(s.date)) { haptic('error'); toast('请选择日期', { icon: 'warning', tone: 'error' }); return; }
    let holdingId = s.holdingId;
    if (!holdingId) {
      const name = s.newName.trim();
      if (!name) { haptic('error'); toast('请输入持仓名称', { icon: 'warning', tone: 'error' }); return; }
      holdingId = (await saveHolding({ name, kind: s.newKind })).id;
    }
    if (s.type === 'out') {
      const sum = holdingSummary(holdingId, state.investFlows, state.valuations, s.date);
      if (amount > sum.value) {
        const ok = await confirmDialog({ title: '取出金额比市值还多', message: `这个持仓目前约 ${formatMoney(sum.value)}。确定要记录取出 ${formatMoney(amount)} 吗？`, confirm: '仍然记录' });
        if (!ok) return;
      }
    }
    await addFlow({ holdingId, type: s.type, amount, date: s.date, note: s.note });
    haptic('success');
    sheet.close();
    toast(`${s.type === 'in' ? '已记录投入' : '已记录取出'} ${formatMoney(amount)}`, { icon: 'check', tone: 'success' });
  }
}

/** Update the market value of every holding at once. */
export function openValuationSheet({ only = null } = {}) {
  const holdings = activeHoldings().filter((h) => !only || h.id === only);
  const today = todayISO();
  let date = today;
  const sheet = openSheet({
    title: '更新市值',
    size: 'large',
    actions: html`<button type="button" class="btn btn--primary btn--small" data-save>保存</button>`,
    body: html`<div class="invest-form">
      <p class="callout">${icon('info')}<span>打开券商或银行 App，把每个持仓「现在值多少」填进来。没有变化的可以留空。</span></p>
      <ul class="list list--values">
        ${holdings.map((h) => {
          const sum = holdingSummary(h.id, state.investFlows, state.valuations, today);
          return html`<li class="row row--value">
            ${catIcon(holdingIcon(h))}
            <span class="row__body"><span class="row__title">${h.name}</span>
              <span class="row__subtitle">目前记录 ${formatMoney(sum.value, { round: true })}${sum.lastValuationDate ? ` · ${dayLabel(sum.lastValuationDate)}更新` : ' · 尚未更新'}</span></span>
            <input class="value-input" name="v-${h.id}" data-holding="${h.id}" type="text" inputmode="decimal" placeholder="${centsToInput(sum.value) || '0'}" autocomplete="off" aria-label="${h.name} 现在的市值">
          </li>`;
        })}
      </ul>
      <label class="field field--inline"><span class="field__label">日期</span>
        <input class="field__select" type="date" name="date" value="${today}" max="${today}"></label>
    </div>`,
    onMount(el, api) {
      el.addEventListener('input', (e) => { if (e.target.name === 'date' && e.target.value) date = e.target.value; });
      el.querySelector('[data-save]').addEventListener('click', async () => {
        const entries = [];
        for (const input of el.querySelectorAll('.value-input')) {
          const raw = input.value.trim();
          if (!raw) continue;
          const v = toCents(raw);
          if (v === null) { haptic('error'); input.focus(); toast('有金额格式不正确', { icon: 'warning', tone: 'error' }); return; }
          entries.push({ holdingId: input.dataset.holding, value: v });
        }
        if (!entries.length) { haptic('error'); toast('至少填一个持仓的市值', { icon: 'info' }); return; }
        await addValuations(entries, date);
        haptic('success');
        api.close();
        toast(`已更新 ${entries.length} 个持仓的市值`, { icon: 'check', tone: 'success' });
      });
    },
  });
  return sheet;
}

/** Create or edit a holding. */
export function openHoldingEditor(holding = null) {
  const s = { name: holding?.name || '', kind: holding?.kind || 'etf', note: holding?.note || '' };
  const sheet = openSheet({
    title: holding ? '编辑持仓' : '新增持仓',
    size: 'large',
    actions: html`<button type="button" class="btn btn--primary btn--small" data-save>保存</button>`,
    body: html`<div class="invest-form"></div>`,
    onMount(el, api) {
      el.addEventListener('input', (e) => {
        if (e.target.name === 'name') s.name = e.target.value;
        if (e.target.name === 'note') s.note = e.target.value;
      });
      el.addEventListener('click', async (e) => {
        const k = e.target.closest('[data-kind]');
        if (k) { s.kind = k.dataset.kind; haptic(); render(); return; }
        if (e.target.closest('[data-save]')) {
          if (!s.name.trim()) { haptic('error'); el.querySelector('[name=name]').focus(); return; }
          await saveHolding({ ...(holding || {}), name: s.name, kind: s.kind, note: s.note.trim().slice(0, 80) });
          haptic('success');
          api.close();
          return;
        }
        if (e.target.closest('[data-remove]')) {
          const used = state.investFlows.some((f) => f.holdingId === holding.id)
            || state.valuations.some((v) => v.holdingId === holding.id);
          const today = todayISO();
          const left = holdingSummary(holding.id, state.investFlows, state.valuations, today).value;
          // A hidden holding must not keep counting in the total: whatever it is still worth is recorded as sold.
          const ok = await confirmDialog({
            title: `移除「${holding.name}」？`,
            message: !used ? '这个持仓还没有任何记录，会直接删除。'
              : left > 0 ? `它目前记录的市值是 ${formatMoney(left)}。移除时会记一笔「全部取出」，不再算进总市值；历史记录与回报计算会保留。如果是记错了，请先在持仓详情里删除那些记录。`
              : '有记录的持仓会被隐藏，历史记录与回报计算都会保留。',
            confirm: left > 0 ? '全部取出并移除' : '移除', destructive: true,
          });
          if (!ok) return;
          if (used && left > 0) await addFlow({ holdingId: holding.id, type: 'out', amount: left, date: today, note: '移除持仓：全部取出' });
          await removeHolding(holding.id);
          api.close();
          toast('已移除', { icon: 'check' });
        }
      });
    },
  });
  const root = sheet.body.querySelector('.invest-form');
  render();
  function render() {
    const focused = document.activeElement?.name;
    mount(root, html`
      <div class="form">
        <label class="field"><span class="field__label">名称</span>
          <input class="field__input field__input--text" name="name" maxlength="30" placeholder="例如：全球指数 ETF" value="${s.name}" autocomplete="off"></label>
      </div>
      <h3 class="section__title">类型</h3>
      <div class="choice-cards choice-cards--wrap">
        ${HOLDING_KINDS.map((k) => html`<button type="button" class="choice-card ${s.kind === k.id ? 'is-selected' : ''}" data-kind="${k.id}" aria-pressed="${s.kind === k.id}">${k.label}</button>`)}
      </div>
      <div class="form">
        <label class="field"><span class="field__label">备注（可选）</span>
          <input class="field__input field__input--text" name="note" maxlength="80" placeholder="例如：券商名称、账户" value="${s.note}" autocomplete="off"></label>
      </div>
      ${holding ? html`<button type="button" class="btn btn--plain btn--danger btn--block" data-remove>移除这个持仓</button>` : ''}
    `);
    if (focused) root.querySelector(`[name=${focused}]`)?.focus({ preventScroll: true });
  }
}

/** Holding detail: summary, quick actions and full history with delete. */
export function openHoldingDetail(id) {
  let unsub = null;
  const sheet = openSheet({
    title: '持仓',
    size: 'large',
    actions: html`<button type="button" class="btn btn--glass btn--small" data-edit>编辑</button>`,
    body: html`<div class="holding-detail"></div>`,
    onClose: () => unsub?.(),
    onMount(el) {
      el.addEventListener('click', async (e) => {
        const h = state.holdings.find((x) => x.id === id);
        if (!h) return;
        if (e.target.closest('[data-edit]')) { openHoldingEditor(h); return; }
        const a = e.target.closest('[data-act]');
        if (a) {
          if (a.dataset.act === 'in' || a.dataset.act === 'out') openFlowSheet({ type: a.dataset.act, holdingId: id });
          if (a.dataset.act === 'value') openValuationSheet({ only: id });
          return;
        }
        const del = e.target.closest('[data-del]');
        if (del) {
          const [kind, rid] = del.dataset.del.split(':');
          const ok = await confirmDialog({ title: kind === 'flow' ? '删除这笔记录？' : '删除这次市值更新？', confirm: '删除', destructive: true });
          if (!ok) return;
          const removed = kind === 'flow' ? await deleteFlow(rid) : await deleteValuation(rid);
          if (removed) toast('已删除', { icon: 'trash', action: { label: '撤销', onClick: () => restoreInvestRecord(kind === 'flow' ? 'flow' : 'valuation', removed) } });
        }
      });
    },
  });
  const root = sheet.body.querySelector('.holding-detail');
  unsub = subscribe(render);
  render();

  function render() {
    const h = state.holdings.find((x) => x.id === id);
    if (!h) { sheet.close(); return; }
    sheet.setTitle(h.name);
    const sum = holdingSummary(id, state.investFlows, state.valuations, todayISO());
    const history = [
      ...state.investFlows.filter((f) => f.holdingId === id).map((f) => ({ kind: 'flow', ...f })),
      ...state.valuations.filter((v) => v.holdingId === id).map((v) => ({ kind: 'valuation', ...v })),
    ].sort((a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1));
    mount(root, html`
      <div class="holding-detail__head">
        ${catIcon(holdingIcon(h), 'cat-icon--lg')}
        <span class="holding-detail__kind">${kindOf(h.kind).label}${h.note ? ` · ${h.note}` : ''}${h.archived ? ' · 已移除' : ''}</span>
      </div>
      <div class="stat-grid">
        <div class="stat"><span class="stat__label">目前市值</span><span class="stat__value">${formatMoney(sum.value, { round: true })}</span></div>
        <div class="stat"><span class="stat__label">${sum.withdrawn ? '累计投入' : '投入本金'}</span><span class="stat__value">${formatMoney(sum.invested, { round: true })}</span>
          ${sum.withdrawn ? html`<span class="stat__note">已取出 ${formatMoney(sum.withdrawn, { round: true })}</span>` : ''}</div>
        <div class="stat"><span class="stat__label">盈亏</span><span class="stat__value ${sum.gain < 0 ? 'is-negative' : 'is-income'}">${formatMoney(sum.gain, { round: true, sign: true })}</span></div>
        <div class="stat"><span class="stat__label">回报</span><span class="stat__value">${sum.gainRatio === null ? '—' : formatPercent(sum.gainRatio, 1)}</span></div>
      </div>
      ${h.archived ? '' : html`<div class="action-row">
        <button type="button" class="btn btn--glass btn--small" data-act="in">${icon('arrow-down')}投入</button>
        <button type="button" class="btn btn--glass btn--small" data-act="value">${icon('trendUp')}更新市值</button>
        <button type="button" class="btn btn--glass btn--small" data-act="out">${icon('arrow-up')}取出</button>
      </div>`}
      <h3 class="section__title">记录</h3>
      ${history.length ? html`<ul class="list">
        ${history.map((r) => html`<li class="row row--history">
          <span class="row__body">
            <span class="row__title">${r.kind === 'valuation' ? '市值更新' : r.type === 'in' ? '投入' : '取出'}${r.note ? ` · ${r.note}` : ''}</span>
            <span class="row__subtitle">${dayLabel(r.date)}</span>
          </span>
          <span class="row__value ${r.kind === 'flow' && r.type === 'in' ? 'is-income' : ''}">${r.kind === 'valuation' ? money(r.value) : money(r.type === 'in' ? r.amount : -r.amount, { sign: true })}</span>
          <button type="button" class="btn btn--icon btn--plain row__delete" data-del="${r.kind}:${r.id}" aria-label="删除">${icon('trash')}</button>
        </li>`)}
      </ul>` : html`<p class="muted">还没有记录。</p>`}
    `);
  }
}

/** Plan settings: target, years, return range, frequency, planned contribution, start condition, start date. */
export function openPlanEditor() {
  let unsub = null;
  const sheet = openSheet({
    title: '投资计划',
    size: 'large',
    body: html`<div class="plan-editor"></div>`,
    onClose: () => unsub?.(),
    onMount(el) {
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-plan]');
        if (!b) return;
        haptic();
        const p = sanitizeInvest(state.settings.invest);
        switch (b.dataset.plan) {
          case 'target': {
            const v = await openMoneySheet({ title: '目标金额', label: '想累积到多少', value: p.target });
            if (v) await saveInvestPlan({ target: v });
            break;
          }
          case 'years': {
            const v = await openNumberSheet({ title: '年限', label: '从开始投资起算几年', value: p.years, suffix: '年', min: 1, max: 50, decimals: 0 });
            if (v !== null) await saveInvestPlan({ years: v });
            break;
          }
          case 'low': {
            const v = await openNumberSheet({ title: '保守回报假设', label: '每年回报（较低）', value: +(p.rateLow * 100).toFixed(2), suffix: '%', min: 0, max: 30 });
            if (v === null) break;
            // Keep the value just typed; move the other end of the range along instead of swapping them.
            await saveInvestPlan({ rateLow: v / 100, rateHigh: Math.max(p.rateHigh, v / 100) });
            if (v / 100 > p.rateHigh) toast(`乐观假设也调整为 ${v}%`, { icon: 'info' });
            break;
          }
          case 'high': {
            const v = await openNumberSheet({ title: '乐观回报假设', label: '每年回报（较高）', value: +(p.rateHigh * 100).toFixed(2), suffix: '%', min: 0, max: 30 });
            if (v === null) break;
            await saveInvestPlan({ rateHigh: v / 100, rateLow: Math.min(p.rateLow, v / 100) });
            if (v / 100 < p.rateLow) toast(`保守假设也调整为 ${v}%`, { icon: 'info' });
            break;
          }
          case 'freq': {
            const v = await openChoiceSheet({ title: '投入频率', options: FREQ_OPTIONS.map((f) => ({ id: f.id, label: f.label })), value: p.freq });
            if (v) await saveInvestPlan({ freq: v });
            break;
          }
          case 'planned': {
            const v = await openMoneySheet({ title: '计划每次投入', label: `每次（${FREQ_OPTIONS.find((f) => f.id === p.freq).label}）`, value: p.planned, hint: '留空或填 0：自动使用「按保守回报率也能达标」所需的金额。' });
            if (v !== null) await saveInvestPlan({ planned: v });
            break;
          }
          case 'trigger': {
            const v = await openMoneySheet({ title: '开始条件', label: '月收入达到多少时开始投资', value: p.triggerIncome, hint: '填 0 表示不追踪开始条件。' });
            if (v !== null) await saveInvestPlan({ triggerIncome: v });
            break;
          }
          case 'start': {
            const first = state.investFlows.filter((f) => f.type === 'in').reduce((m, f) => (!m || f.date < m ? f.date : m), '');
            const v = await openChoiceSheet({
              title: '开始日期',
              options: [
                { id: 'auto', label: '第一次投入的日期', hint: first ? dayLabel(first) : '还没有投入记录' },
                { id: 'today', label: '今天', hint: dayLabel(todayISO()) },
              ],
              value: p.startDate ? (p.startDate === todayISO() ? 'today' : '') : 'auto',
            });
            if (v === 'auto') await saveInvestPlan({ startDate: '' });
            if (v === 'today') await saveInvestPlan({ startDate: todayISO() });
            break;
          }
          default: break;
        }
      });
    },
  });
  const root = sheet.body.querySelector('.plan-editor');
  unsub = subscribe(render);
  render();

  function render() {
    const p = sanitizeInvest(state.settings.invest);
    const row = (key, glyph, color, title, value) => html`<li><button type="button" class="row" data-plan="${key}">
      <span class="row__glyph-tile" data-color="${color}">${icon(glyph)}</span>
      <span class="row__body"><span class="row__title">${title}</span></span>
      <span class="row__detail">${value}</span>${icon('chevron-right', 'row__chevron')}</button></li>`;
    mount(root, html`
      <ul class="list">
        ${row('target', 'target', 'blue', '目标金额', formatMoney(p.target, { round: true }))}
        ${row('years', 'clock', 'indigo', '年限', `${p.years} 年`)}
        ${row('low', 'trendDown', 'orange', '保守回报假设', `${(p.rateLow * 100).toFixed(1).replace(/\.0$/, '')}%`)}
        ${row('high', 'trendUp', 'green', '乐观回报假设', `${(p.rateHigh * 100).toFixed(1).replace(/\.0$/, '')}%`)}
      </ul>
      <ul class="list">
        ${row('freq', 'subscriptions', 'teal', '投入频率', FREQ_OPTIONS.find((f) => f.id === p.freq).label)}
        ${row('planned', 'wallet', 'purple', '计划每次投入', p.planned ? formatMoney(p.planned, { round: true }) : '自动（按目标计算）')}
      </ul>
      <ul class="list">
        ${row('trigger', 'salary', 'mint', '开始条件：月收入', p.triggerIncome ? formatMoney(p.triggerIncome, { round: true }) : '不追踪')}
        ${row('start', 'calendar', 'gray', '开始日期', p.startDate ? dayLabel(p.startDate) : '第一次投入的日期')}
      </ul>
      <p class="section__footer">回报率是你的假设，不是保证。实际回报可能更高、更低，也可能亏损。这是规划工具，不构成投资建议。</p>
    `);
  }
}
