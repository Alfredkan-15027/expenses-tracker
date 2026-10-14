// 说明 — the small print, folded away. The explanation under a card or section stays hidden until the ⓘ beside its
// title is tapped (an insight in 重点 unfolds when the insight itself is tapped), so every screen shows its figures
// first. What was unfolded stays unfolded while the app runs (screens are redrawn on every change); the next start
// shows everything folded again.
// The panel opens in place, without a redraw, so its CSS transition plays: the height unfolds (grid rows 0fr → 1fr)
// while the text fades and sharpens in — after motion-primitives' Disclosure and transitions.dev's expand; styles in
// components.css (.info-btn, .info-panel). Folded panels are inert: VoiceOver and Tab skip them.
import { html, icon } from './html.js';
import { haptic } from './haptics.js';

const open = new Set();

export const isOpen = (id) => open.has(id);

/** The ⓘ that unfolds panel `id`. */
export function infoButton(id, label = '说明') {
  return html`<button type="button" class="info-btn" data-info="${id}" aria-expanded="${open.has(id) ? 'true' : 'false'}" aria-controls="info-${id}" aria-label="${label}">${icon('info')}</button>`;
}

/** Attributes for any other control that unfolds panel `id` (an insight row). */
export const infoAttrs = (id) => html`data-info="${id}" aria-expanded="${open.has(id) ? 'true' : 'false'}" aria-controls="info-${id}"`;

/** The folded explanation `id`. */
export function infoPanel(id, content, cls = '') {
  const on = open.has(id);
  return html`<div class="info-panel ${cls}" id="info-${id}" ${on ? 'data-open' : 'inert'}><div class="info-panel__inner"><div class="info-panel__box">${content}</div></div></div>`;
}

/** A tap anywhere on the page: unfold / fold when it was on an ⓘ (or an insight). True when it was. */
export function onInfoClick(e) {
  const btn = e.target.closest('[data-info]');
  if (!btn) return false;
  const id = btn.dataset.info;
  const on = !open.has(id);
  if (on) open.add(id); else open.delete(id);
  haptic();
  for (const b of document.querySelectorAll('[data-info]')) {
    if (b.dataset.info === id) b.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  const panel = document.getElementById(`info-${id}`);
  if (panel) {
    panel.toggleAttribute('data-open', on);
    panel.toggleAttribute('inert', !on);
  }
  return true;
}
