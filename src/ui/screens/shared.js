// Pieces shared by several screens.
import { html, icon, catIcon, money, facts } from '../html.js';
import { addMonths, dayLabel, monthLabel, toISODate } from '../../core/dates.js';

/** "14:32" when the entry was typed in on the day it is dated (a back-dated or automatic entry has no time). */
export function timeOf(t) {
  if (!t.createdAt || t.recurringId) return '';
  const d = new Date(t.createdAt);
  if (Number.isNaN(d.getTime()) || toISODate(d) !== t.date) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * A transaction row with swipe-to-delete: what it was, then "类别 · 昨天 14:32" in one quiet line, the amount on the
 * right. `today`: for 今天 / 昨天; showDate: false leaves the day out for entries dated today.
 */
export function txRow(t, cat, { today = '', showDate = true } = {}) {
  const title = t.note || cat.name;
  const day = showDate || t.date !== today ? dayLabel(t.date, today || undefined) : '';
  const when = [day, timeOf(t)].filter(Boolean).join(' ');
  return html`<li class="swipe" data-motion="row" data-motion-key="${t.id}">
    <button type="button" class="swipe__action" data-action="delete-tx" data-id="${t.id}" aria-label="删除">${icon('trash')}<span>删除</span></button>
    <div class="swipe__content">
      <button type="button" class="row row--tx" data-action="edit-tx" data-id="${t.id}">
        ${catIcon(cat)}
        <span class="row__body">
          <span class="row__title">${title}</span>
          <span class="row__subtitle">
            ${facts(t.note ? cat.name : '', when)}
            ${t.business ? html`<span class="tag tag--business">创业</span>` : ''}
            ${t.recurringId ? html`<span class="tag tag--fixed">固定</span>` : ''}
          </span>
        </span>
        <span class="row__value ${t.type === 'income' ? 'is-income' : ''}">${money(t.type === 'income' ? t.amount : -t.amount, { sign: t.type === 'income' })}</span>
      </button>
    </div>
  </li>`;
}

/** One capsule of glass: ‹ label › — back, "return to now", forward. */
function switcher({ aria, prev, label, next, attr }) {
  return html`<div class="switcher" role="group" aria-label="${aria}">
    <button type="button" class="switcher__btn" ${attr}="${prev.key}" aria-label="${prev.label}">${icon('chevron-left')}</button>
    <button type="button" class="switcher__label" ${attr}="${label.key}" aria-label="${label.aria}">${label.text}</button>
    <button type="button" class="switcher__btn" ${attr}="${next.key}" aria-label="${next.label}" ${next.can ? '' : 'disabled'}>${icon('chevron-right')}</button>
  </div>`;
}

/** ‹ 2026年9月 › month switcher. */
export function monthSwitcher(ym, current) {
  return switcher({
    aria: '切换月份', attr: 'data-month',
    prev: { key: addMonths(ym, -1), label: '上个月' },
    label: { key: current, text: monthLabel(ym), aria: '回到本月' },
    next: { key: addMonths(ym, 1), label: '下个月', can: ym < current },
  });
}

/** Previous / current / next switcher for a budget period (month or pay cycle). */
export function periodSwitcher(p, { prevKey, nextKey, currentKey, canNext }) {
  const cycle = p.kind === 'cycle';
  return switcher({
    aria: cycle ? '切换收入周期' : '切换月份', attr: 'data-period',
    prev: { key: prevKey, label: cycle ? '上一期' : '上个月' },
    label: { key: currentKey, text: p.label, aria: cycle ? '回到本期' : '回到本月' },
    next: { key: nextKey, label: cycle ? '下一期' : '下个月', can: canNext },
  });
}

/** Status pill used in analysis: icon + label, never color alone. */
export function statusBadge(status) {
  const map = {
    lean: ['info', 'arrow-down', '精简'],
    ok: ['good', 'check', '合理'],
    pace: ['warn', 'clock', '速度偏快'],
    high: ['warn', 'arrow-up', '偏高'],
    over: ['bad', 'warning', '过高'],
    none: ['muted', 'other', '—'],
  };
  const [tone, ic, label] = map[status] || map.none;
  return html`<span class="badge" data-tone="${tone}">${icon(ic)}${label}</span>`;
}
