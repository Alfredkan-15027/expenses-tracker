// 对账 — the money on hand: what the records say it should be now, what it really is, and what to do with the gap.
import { html, icon, money, mount } from '../html.js';
import { openSheet, toast } from '../overlays.js';
import { haptic } from '../haptics.js';
import { state, saveSettings, addTransaction } from '../../data/store.js';
import { cashOnHand, reconcileGap as gapEntry } from '../../core/analysis.js';
import { formatMoney } from '../../core/money.js';
import { dayLabel, todayISO } from '../../core/dates.js';
import { moneyField, readMoney } from './plan.js';

/** The money on hand now, carried forward by the records (null when it was never filled in). */
export function currentCash(today = todayISO()) {
  return cashOnHand({ txs: state.transactions, settings: state.settings, flows: state.investFlows, today, recurring: state.recurring });
}

export function openCashSheet() {
  const today = todayISO();
  const cash = currentCash(today);
  return new Promise((resolve) => {
    openSheet({
      title: '对账',
      size: 'large',
      actions: html`<button type="button" class="btn btn--primary btn--small" data-save>保存</button>`,
      body: html`<form class="form cash-form" novalidate>
        ${cash ? html`<section class="card cash-recorded">
          <span class="card__eyebrow">${icon('wallet')} 按记录，现在应该有</span>
          <div class="cash-recorded__value">${money(cash.balance, { cls: 'money--large' })}</div>
          <ul class="cash-breakdown">
            <li><span>${dayLabel(cash.at, today)}对账时有</span><span>${formatMoney(cash.base)}</span></li>
            <li><span>之后记的收入</span><span class="is-income">+${formatMoney(cash.income)}</span></li>
            <li><span>之后记的支出</span><span>−${formatMoney(cash.spent)}</span></li>
            ${cash.invested ? html`<li><span>${cash.invested > 0 ? '转进投资' : '从投资取出'}</span><span>${cash.invested > 0 ? '−' : '+'}${formatMoney(Math.abs(cash.invested))}</span></li>` : ''}
          </ul>
        </section>` : html`<p class="callout">${icon('info')}<span>填一次现在手上有多少钱，App 就会按之后记的收入和支出帮你算着走：「今天还能花」不会超过你真正有的钱，下次对账也能看出有没有漏记。</span></p>`}
        ${moneyField({ name: 'real', label: '现在实际有多少', value: 0, hint: '银行、电子钱包和现金里随时能用的钱加起来，存款也算（投资另计）。只存在这台手机。' })}
        ${moneyField({ name: 'kept', label: '其中存款（不动用）', value: state.settings.keptSavings, hint: '这部分不会算进「今天还能花」，只用剩下的钱来算；Runway 仍按全部的钱算。没有就留空。只改存款的话，上面可以不填。' })}
        <p class="cash-split" aria-live="polite" hidden></p>
        <div class="cash-diff" aria-live="polite" hidden></div>
        <fieldset class="cash-choice" hidden>
          <legend class="sr-only">差额怎么处理</legend>
          <label class="cash-choice__row">
            <input type="radio" name="gap" value="record" checked>
            <span><strong data-record-title></strong><span class="cash-choice__sub">补进昨天的记录，结余、分析和预算才会对</span></span>
          </label>
          <label class="cash-choice__row">
            <input type="radio" name="gap" value="skip">
            <span><strong>只更新数字</strong><span class="cash-choice__sub">差额不进记录（例如之前填错了）</span></span>
          </label>
        </fieldset>
      </form>`,
      onClose: () => resolve(),
      onMount(el, api) {
        const form = el.querySelector('form');
        const diffBox = el.querySelector('.cash-diff');
        const choice = el.querySelector('.cash-choice');
        const split = el.querySelector('.cash-split');
        // The savings part must fit inside the total; what is left is the money 今天还能花 may use. With the total left
        // empty only the savings change, so they are held against the money the records say is there now.
        const totalOf = (real, typed) => (typed ? real : cash ? cash.balance : null);
        const keptError = (real, kept, typed) => {
          const total = totalOf(real, typed);
          if (kept === null) return '存款金额不正确（最多两位小数）';
          if (total !== null && kept > total) return typed ? '存款不能比现在实际有的钱多' : `存款不能比按记录现在有的 ${formatMoney(total)} 多`;
          return '';
        };
        const showSplit = (real, kept, typed) => {
          const err = keptError(real, kept, typed);
          const total = totalOf(real, typed);
          split.hidden = !err && !(kept && total !== null);
          split.dataset.tone = err ? 'bad' : '';
          split.textContent = err || (kept && total !== null ? `能用的钱 ${formatMoney(total - kept)}（存款 ${formatMoney(kept)} 不动用）` : '');
          return !err;
        };
        const update = () => {
          const real = readMoney(form.real);
          const typed = form.real.value.trim() !== '';
          showSplit(real, readMoney(form.kept), typed && real !== null);
          if (real === null) {
            diffBox.hidden = false;
            diffBox.dataset.tone = 'bad';
            diffBox.textContent = '请输入正确的金额（最多两位小数）';
            choice.hidden = true;
            return;
          }
          if (!cash || !typed) { diffBox.hidden = true; choice.hidden = true; return; }
          const gap = gapEntry(real, cash.balance, today);
          diffBox.hidden = false;
          if (!gap) {
            diffBox.dataset.tone = 'good';
            mount(diffBox, html`${icon('check')}<span>跟记录对得上。</span>`);
            choice.hidden = true;
            return;
          }
          const less = gap.type === 'expense';
          diffBox.dataset.tone = less ? 'warn' : 'info';
          mount(diffBox, html`${icon(less ? 'warning' : 'info')}<span>${less
            ? `比记录少 ${formatMoney(gap.amount)}：${dayLabel(cash.at, today)}以来大概有这么多支出没记到。`
            : `比记录多 ${formatMoney(gap.amount)}：可能有收入没记到，或者有支出记多了。`}</span>`);
          el.querySelector('[data-record-title]').textContent = less
            ? `记成一笔「没记到的支出」${formatMoney(gap.amount)}`
            : `记成一笔「没记到的收入」${formatMoney(gap.amount)}`;
          choice.hidden = false;
        };
        form.addEventListener('input', update);
        form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
        el.querySelector('[data-save]').addEventListener('click', save);
        setTimeout(() => form.real.focus(), 350);

        let saving = false;
        async function save() {
          const real = readMoney(form.real);
          const kept = readMoney(form.kept);
          const typed = form.real.value.trim() !== '';
          if (saving) return;
          // Only the savings changed (total left empty): keep the last check, update the savings part.
          const onlyKept = !typed && cash;
          if (real === null || (!typed && !onlyKept)) { haptic('error'); form.real.focus(); update(); return; }
          if (keptError(real, kept, typed)) { haptic('error'); form.kept.focus(); update(); return; }
          saving = true;
          if (onlyKept) {
            try {
              await saveSettings({ keptSavings: kept });
            } catch {
              saving = false;
              haptic('error');
              toast('没能保存，请再试一次', { icon: 'warning', tone: 'error' });
              return;
            }
            haptic('success');
            toast(`已更新存款 ${formatMoney(kept, { round: true })}，能用 ${formatMoney(cash.balance - kept, { round: true })}`, { icon: 'check', tone: 'success' });
            api.close();
            return;
          }
          const gap = cash ? gapEntry(real, cash.balance, today) : null;
          const record = gap && form.gap.value === 'record';
          try {
            // The gap entry first: it is dated before today, so it is not counted again on top of the new figure.
            if (record) await addTransaction(gap);
            await saveSettings({ currentSavings: real, keptSavings: kept });
          } catch (err) {
            saving = false;
            haptic('error');
            toast('没能保存，请再试一次', { icon: 'warning', tone: 'error' });
            return;
          }
          haptic('success');
          toast(record
            ? `已对账 · 补记${gap.type === 'expense' ? '支出' : '收入'} ${formatMoney(gap.amount)}`
            : `已对账 · 手上 ${formatMoney(real, { round: true })}${kept ? `，能用 ${formatMoney(real - kept, { round: true })}` : ''}`, { icon: 'check', tone: 'success' });
          api.close();
        }
      },
    });
  });
}
