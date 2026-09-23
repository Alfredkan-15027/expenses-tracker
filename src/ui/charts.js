// Small, dependency-free charts. Colors come from CSS (classes / data-color), never inline hex,
// so the styles layer fully controls the look.
import { html } from './html.js';
import { formatCompact, formatMoney } from '../core/money.js';
import { monthLabel } from '../core/dates.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pct = (v) => `${(clamp(v, 0, 1) * 100).toFixed(2)}%`;

/** Activity-style progress ring. tone: css modifier (spend | save | over …). */
export function ring({ ratio, size = 76, stroke = 10, tone = 'spend', label = '' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = clamp(ratio || 0, 0, 1);
  const mid = size / 2;
  return html`<svg class="ring ring--${tone}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${label}">
    <circle class="ring__track" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"></circle>
    <circle class="ring__value ${v === 0 ? 'is-zero' : ''}" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"
      stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - v)).toFixed(2)}"
      transform="rotate(-90 ${mid} ${mid})"></circle>
  </svg>`;
}

/** Concentric Activity-style rings, outermost first. rings: [{ ratio, tone, label }]. */
export function activityRings(rings, { size = 104, stroke = 13, gap = 3 } = {}) {
  const mid = size / 2;
  return html`<svg class="rings__svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${rings.map((r) => r.label).join('，')}">
    ${rings.map((ring, i) => {
      const r = mid - stroke / 2 - i * (stroke + gap);
      const c = 2 * Math.PI * r;
      const v = clamp(ring.ratio || 0, 0, 1);
      return html`<g class="ring ring--${ring.tone}">
        <circle class="ring__track" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"></circle>
        <circle class="ring__value ${v === 0 ? 'is-zero' : ''}" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"
          stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - v)).toFixed(2)}" transform="rotate(-90 ${mid} ${mid})"></circle>
      </g>`;
    })}
  </svg>`;
}

/** Linear progress with an optional "time elapsed" tick. */
export function progress({ ratio, marker = null, tone = 'spend', label = '' }) {
  return html`<div class="progress progress--${tone} ${ratio > 1 ? 'is-over' : ''}" role="progressbar" aria-label="${label}"
      aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(clamp(ratio, 0, 1) * 100)}">
    <span class="progress__fill" style="width:${pct(ratio)}"></span>
    ${marker !== null ? html`<span class="progress__marker" style="left:${pct(marker)}"></span>` : ''}
  </div>`;
}

/**
 * Part-to-whole bar. segments: [{ id, value, color, label }]. Shows up to `max` segments,
 * the rest fold into one gray "其他" segment.
 */
export function stackBar(segments, { max = 5 } = {}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (!total) return '';
  const sorted = [...segments].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, max);
  const tail = sorted.slice(max).reduce((a, s) => a + s.value, 0);
  if (tail > 0) head.push({ id: '_rest', value: tail, color: 'gray', label: '其余' });
  return html`
    <div class="stackbar" role="img" aria-label="类别占比">
      ${head.map((s) => html`<span class="stackbar__seg" data-color="${s.color}" style="flex-grow:${(s.value / total).toFixed(4)}"></span>`)}
    </div>
    <ul class="legend">
      ${head.map((s) => html`<li class="legend__item"><span class="legend__swatch" data-color="${s.color}"></span>${s.label}<span class="legend__value">${Math.round((s.value / total) * 100)}%</span></li>`)}
    </ul>`;
}

/**
 * Living-cost gauge against tier thresholds (RM). value in cents.
 * Track spans 0 → last threshold × 1.25; four zones: lean / ok / high / over.
 */
export function tierGauge({ value, tiers, label }) {
  const [a, b, c] = tiers;
  const maxRM = c * 1.25;
  const v = value / 100;
  const zones = [
    { tone: 'lean', w: a / maxRM },
    { tone: 'ok', w: (b - a) / maxRM },
    { tone: 'high', w: (c - b) / maxRM },
    { tone: 'over', w: (maxRM - c) / maxRM },
  ];
  const tick = (t) => html`<span class="gauge__tick" style="left:${pct(t / maxRM)}">${t.toLocaleString('en-MY')}</span>`;
  return html`<div class="gauge" role="img" aria-label="${label}">
    <div class="gauge__track">
      ${zones.map((z) => html`<span class="gauge__zone" data-tone="${z.tone}" style="flex-grow:${z.w.toFixed(4)}"></span>`)}
      <span class="gauge__marker" style="left:${pct(v / maxRM)}"><span class="gauge__pin"></span></span>
    </div>
    <div class="gauge__ticks">${tick(a)}${tick(b)}${tick(c)}</div>
  </div>`;
}

/**
 * Apple Health–style monthly bars. rows: [{ ym, expense, income }].
 * Tapping a column updates the readout (handled by the screen via data-trend-i).
 */
export function trendChart(rows, { selected = rows.length - 1, budget = 0 } = {}) {
  const maxVal = Math.max(1, ...rows.map((r) => r.expense), budget);
  const top = niceMax(maxVal);
  const sel = rows[selected];
  return html`<div class="trend" data-trend>
    <div class="trend__readout">
      <span class="trend__caption">${monthLabel(sel.ym)} · 支出</span>
      <span class="trend__value">${formatMoney(sel.expense, { round: true })}</span>
      <span class="trend__sub">收入 ${formatMoney(sel.income, { round: true })}</span>
    </div>
    <div class="trend__plot">
      <div class="trend__grid">
        <span class="trend__gridline" style="bottom:100%"><em>${formatCompact(top)}</em></span>
        <span class="trend__gridline" style="bottom:50%"><em>${formatCompact(top / 2)}</em></span>
        <span class="trend__gridline trend__gridline--base" style="bottom:0"><em>0</em></span>
      </div>
      ${budget > 0 ? html`<span class="trend__budget" style="bottom:${pct(budget / top)}"><em>预算</em></span>` : ''}
      <div class="trend__cols">
        ${rows.map((r, i) => html`<button type="button" class="trend__col ${i === selected ? 'is-selected' : ''}" data-trend-i="${i}"
            aria-label="${monthLabel(r.ym)} 支出 ${formatMoney(r.expense, { round: true })}">
          <span class="trend__bar ${r.expense > budget && budget > 0 ? 'is-over' : ''}" style="height:${pct(r.expense / top)}"></span>
        </button>`)}
      </div>
    </div>
    <div class="trend__axis">${rows.map((r, i) => html`<span class="${i === selected ? 'is-selected' : ''}">${monthLabel(r.ym, false)}</span>`)}</div>
  </div>`;
}

function niceMax(cents) {
  const rm = cents / 100;
  const pow = 10 ** Math.floor(Math.log10(Math.max(rm, 1)));
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const n = steps.find((s) => s * pow >= rm) || 10;
  return n * pow * 100;
}

/** Month-over-month change per category. rows: [{ label, delta, current, previous }]. */
export function divergeList(rows) {
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.delta)));
  return html`<ul class="diverge">
    ${rows.map((r) => {
      const w = pct((Math.abs(r.delta) / maxAbs) * 0.5);
      const up = r.delta > 0;
      return html`<li class="diverge__row">
        <span class="diverge__label">${r.label}</span>
        <span class="diverge__track">
          <span class="diverge__axis"></span>
          <span class="diverge__bar ${up ? 'is-up' : 'is-down'}" style="width:${w}"></span>
        </span>
        <span class="diverge__value ${up ? 'is-up' : 'is-down'}">${up ? '+' : r.delta < 0 ? '−' : ''}${formatCompact(Math.abs(r.delta))}</span>
      </li>`;
    })}
  </ul>`;
}
