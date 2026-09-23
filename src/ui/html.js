// Safe-by-default HTML templating: every interpolated value is escaped unless it is
// itself produced by html`` (or raw()). This keeps user notes / imported data from
// ever being interpreted as markup.
import { moneyParts, CURRENCY } from '../core/money.js';

class SafeHTML {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const escape = (v) => String(v).replace(/[&<>"'`]/g, (c) => ESC[c]);

function toHTML(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof SafeHTML) return v.s;
  if (Array.isArray(v)) return v.map(toHTML).join('');
  return escape(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += toHTML(values[i]) + strings[i + 1];
  return new SafeHTML(out);
}

/** Trust a string as markup. Only for constants authored in this codebase. */
export const raw = (s) => new SafeHTML(s);

export const SPRITE = 'assets/icons/sprite.svg';

export function icon(name, cls = '') {
  return html`<svg class="icon ${cls}" aria-hidden="true" focusable="false"><use href="${SPRITE}#i-${name}"></use></svg>`;
}

/** Category badge: colored rounded tile with the category glyph. */
export function catIcon(cat, size = '') {
  return html`<span class="cat-icon ${size}" data-color="${cat.color}">${icon(cat.icon)}</span>`;
}

/** Money with separately styleable currency / integer / decimals. */
export function money(cents, { sign = false, cls = '' } = {}) {
  const p = moneyParts(cents);
  const plus = sign && cents > 0 ? '+' : '';
  return html`<span class="money ${cls}"><span class="money__sign">${p.sign || plus}</span><span class="money__cur">${CURRENCY}</span><span class="money__int">${p.int}</span><span class="money__dec">.${p.dec}</span></span>`;
}

export function mount(el, content) {
  el.innerHTML = toHTML(content);
}
