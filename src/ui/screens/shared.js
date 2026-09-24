// Pieces shared by several screens.
import { html, icon, catIcon, money } from '../html.js';
import { addMonths, dayLabel, monthLabel } from '../../core/dates.js';

/** A transaction row with swipe-to-delete. */
export function txRow(t, cat, { showDate = false } = {}) {
  const title = t.note || cat.name;
  const sub = [t.note ? cat.name : null, showDate ? dayLabel(t.date) : null].filter(Boolean).join(' · ');
  return html`<li class="swipe">
    <button type="button" class="swipe__action" data-action="delete-tx" data-id="${t.id}" aria-label="删除">${icon('trash')}<span>删除</span></button>
    <div class="swipe__content">
      <button type="button" class="row row--tx" data-action="edit-tx" data-id="${t.id}">
        ${catIcon(cat)}
        <span class="row__body">
          <span class="row__title">${title}</span>
          <span class="row__subtitle">
            ${sub}
            ${t.business ? html`<span class="tag tag--business">创业</span>` : ''}
            ${t.recurringId ? html`<span class="tag tag--fixed">固定</span>` : ''}
          </span>
        </span>
        <span class="row__value ${t.type === 'income' ? 'is-income' : ''}">${money(t.type === 'income' ? t.amount : -t.amount, { sign: t.type === 'income' })}</span>
      </button>
    </div>
  </li>`;
}

/** ‹ 2026年9月 › month switcher. */
export function monthSwitcher(ym, current) {
  const canNext = ym < current;
  return html`<div class="month-switch" role="group" aria-label="切换月份">
    <button type="button" class="btn btn--icon btn--glass" data-month="${addMonths(ym, -1)}" aria-label="上个月">${icon('chevron-left')}</button>
    <button type="button" class="month-switch__label" data-month="${current}" aria-label="回到本月">${monthLabel(ym)}</button>
    <button type="button" class="btn btn--icon btn--glass" data-month="${addMonths(ym, 1)}" aria-label="下个月" ${canNext ? '' : 'disabled'}>${icon('chevron-right')}</button>
  </div>`;
}

/** Previous / current / next switcher for a budget period (month or pay cycle). */
export function periodSwitcher(p, { prevKey, nextKey, currentKey, canNext }) {
  const cycle = p.kind === 'cycle';
  return html`<div class="month-switch" role="group" aria-label="${cycle ? '切换收入周期' : '切换月份'}">
    <button type="button" class="btn btn--icon btn--glass" data-period="${prevKey}" aria-label="${cycle ? '上一期' : '上个月'}">${icon('chevron-left')}</button>
    <button type="button" class="month-switch__label" data-period="${currentKey}" aria-label="${cycle ? '回到本期' : '回到本月'}">${p.label}</button>
    <button type="button" class="btn btn--icon btn--glass" data-period="${nextKey}" aria-label="${cycle ? '下一期' : '下个月'}" ${canNext ? '' : 'disabled'}>${icon('chevron-right')}</button>
  </div>`;
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
