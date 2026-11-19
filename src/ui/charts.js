// Small, dependency-free charts. Colours come from CSS (classes / data-color / data-tone), never inline hex,
// so the styles layer fully controls the look.
//   progress      a capsule meter, with an optional "time gone" tick
//   dayBars       one bar per day of a period or month (the skyline): spending day by day
//   donut         part-to-whole ring with the total in the middle
//   stackBar      part-to-whole bar with a legend
//   dial          half-circle gauge with a needle, against tier thresholds
//   goalArc       a wide arc of progress towards a target, with a "time gone" tick
//   trendChart    the last few periods as bars
//   divergeList   change per category against the period before
//   projectionChart  investment projection band, target and actual line
import { html } from './html.js';
import { formatCompact, formatMoney, sharePercents } from '../core/money.js';
import { monthLabel } from '../core/dates.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pct = (v) => `${(clamp(v, 0, 1) * 100).toFixed(2)}%`;
const f1 = (n) => n.toFixed(1);

/** Linear progress with an optional "time elapsed" tick. */
export function progress({ ratio, marker = null, tone = 'spend', label = '', key = '' }) {
  return html`<div class="progress progress--${tone} ${ratio > 1 ? 'is-over' : ''}" role="progressbar" aria-label="${label}"
      aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(clamp(ratio, 0, 1) * 100)}">
    <span class="progress__fill" style="width:${pct(ratio)}" ${key ? html`data-motion="width" data-motion-key="${key}"` : ''}></span>
    ${marker !== null ? html`<span class="progress__marker" style="left:${pct(marker)}"></span>` : ''}
  </div>`;
}

/**
 * The skyline: one bar per day. days: [{ date, value (cents), state: 'past' | 'today' | 'future', title }].
 * limit (cents): a line the bars are held against (the daily allowance); bars above it are marked over.
 * selected: a date drawn as picked. tappable: bars are buttons carrying data-day.
 */
export function dayBars(days, { limit = 0, selected = '', tappable = false, label = '' } = {}) {
  const max = Math.max(1, limit * 1.6, ...days.map((d) => d.value));
  // A day far above the rest (rent) would flatten every other bar: the scale is eased with a square root.
  const scale = (v) => Math.sqrt(Math.max(0, v) / max);
  const col = (d, i) => {
    const cls = `daybars__col is-${d.state} ${limit > 0 && d.value > limit ? 'is-over' : ''} ${d.date === selected ? 'is-selected' : ''} ${d.value > 0 ? '' : 'is-empty'}`;
    const style = `--h:${(scale(d.value) * 100).toFixed(1)}%;--i:${i}`;
    return tappable
      ? html`<button type="button" class="${cls}" style="${style}" data-day="${d.date}" aria-label="${d.title}" aria-pressed="${d.date === selected}" ${d.state === 'future' ? 'disabled' : ''}><i></i></button>`
      : html`<span class="${cls}" style="${style}"><i></i></span>`;
  };
  return html`<div class="daybars" ${tappable ? html`role="group"` : html`role="img"`} aria-label="${label}">
    ${limit > 0 ? html`<span class="daybars__limit" style="bottom:${(scale(limit) * 100).toFixed(1)}%"></span>` : ''}
    ${days.map(col)}
  </div>`;
}

/** Up to `max` segments, largest first; the rest fold into one grey "其余". */
function topSegments(segments, max) {
  const sorted = [...segments].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, max);
  const tail = sorted.slice(max).reduce((a, s) => a + s.value, 0);
  if (tail > 0) head.push({ id: '_rest', value: tail, color: 'gray', label: '其余' });
  return head;
}

/**
 * Part-to-whole ring. segments: [{ id, value, color, label }]; `center`: html shown in the middle.
 * Each arc is a circle whose dash is its share (pathLength = 100, so the numbers are percents).
 */
export function donut(segments, { max = 6, center = '', label = '类别占比' } = {}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (!total) return '';
  const head = topSegments(segments, max);
  const GAP = head.length > 1 ? 1.4 : 0;
  let at = 0;
  const arcs = head.map((s) => {
    const share = (s.value / total) * 100;
    const len = Math.max(0.6, share - GAP);
    const arc = html`<circle class="donut__seg" data-color="${s.color}" cx="60" cy="60" r="47" pathLength="100"
      stroke-dasharray="${len.toFixed(2)} ${(100 - len).toFixed(2)}" stroke-dashoffset="${(-at - GAP / 2).toFixed(2)}"></circle>`;
    at += share;
    return arc;
  });
  return html`<div class="donut">
    <svg class="donut__svg" viewBox="0 0 120 120" role="img" aria-label="${label}">
      <circle class="donut__track" cx="60" cy="60" r="47"></circle>
      <g transform="rotate(-90 60 60)">${arcs}</g>
    </svg>
    <div class="donut__center">${center}</div>
  </div>`;
}

/**
 * Part-to-whole bar. segments: [{ id, value, color, label }]. Shows up to `max` segments,
 * the rest fold into one gray "其余" segment.
 */
export function stackBar(segments, { max = 5 } = {}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (!total) return '';
  const head = topSegments(segments, max);
  const shares = sharePercents(head.map((s) => s.value)); // add up to 100%
  return html`
    <div class="stackbar" role="img" aria-label="类别占比">
      ${head.map((s) => html`<span class="stackbar__seg" data-color="${s.color}" style="flex-grow:${(s.value / total).toFixed(4)}"></span>`)}
    </div>
    <ul class="legend">
      ${head.map((s, i) => html`<li class="legend__item"><span class="legend__swatch" data-color="${s.color}"></span>${s.label}<span class="legend__value">${shares[i]}%</span></li>`)}
    </ul>`;
}

// A point on a circle; angles in degrees, 0° at 3 o'clock, clockwise (screen coordinates).
const polar = (cx, cy, r, deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
function arcPath(cx, cy, r, from, to) {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  return `M${f1(x1)} ${f1(y1)}A${r} ${r} 0 ${Math.abs(to - from) > 180 ? 1 : 0} ${to > from ? 1 : 0} ${f1(x2)} ${f1(y2)}`;
}

/**
 * Living-cost dial against tier thresholds (RM). value in cents.
 * A half circle from 0 to the last threshold × 1.25, in four zones (lean / ok / high / over), with a needle.
 */
export function dial({ value, tiers, label }) {
  const [a, b, c] = tiers;
  const maxRM = c * 1.25;
  const v = clamp(value / 100 / maxRM, 0, 1);
  const CX = 130, CY = 108, R = 88;
  const deg = (t) => 180 + clamp(t, 0, 1) * 180; // 180° (left) → 360° (right), over the top
  const GAP = 1.6;
  const zones = [['lean', 0, a], ['ok', a, b], ['high', b, c], ['over', c, maxRM]];
  const tick = (t) => {
    const at = deg(t / maxRM);
    const [x, y] = polar(CX, CY, R + 13, at);
    // labels left of the top read towards the left, right of it towards the right, so none sits on the arc
    return html`<text class="dial__tick" x="${f1(x)}" y="${f1(y + 3)}" text-anchor="${at < 255 ? 'end' : at > 285 ? 'start' : 'middle'}">${t.toLocaleString('en-MY')}</text>`;
  };
  return html`<div class="dial" role="img" aria-label="${label}">
    <svg class="dial__svg" viewBox="0 0 260 124">
      ${zones.map(([tone, from, to], i) => html`<path class="dial__zone" data-tone="${tone}"
        d="${arcPath(CX, CY, R, deg(from / maxRM) + (i ? GAP : 0), deg(to / maxRM) - (i < 3 ? GAP : 0))}"></path>`)}
      ${tick(a)}${tick(b)}${tick(c)}
      <g class="dial__needle" style="--to:${(v * 180 - 90).toFixed(1)}deg" transform="rotate(${(v * 180 - 90).toFixed(1)} ${CX} ${CY})">
        <path d="M${CX - 4} ${CY}L${CX} ${CY - R + 16}L${CX + 4} ${CY}Z"></path>
      </g>
      <circle class="dial__hub" cx="${CX}" cy="${CY}" r="7"></circle>
    </svg>
  </div>`;
}

/**
 * A wide arc of progress (the investment goal). ratio: 0 → 1 done; marker: 0 → 1 of the time gone (null: none).
 * `center`: html inside the arc.
 */
export function goalArc({ ratio, marker = null, tone = 'save', label = '', center = '' }) {
  const CX = 150, CY = 150, R = 128, FROM = 150, SWEEP = 240;
  const v = clamp(ratio || 0, 0, 1);
  const d = arcPath(CX, CY, R, FROM, FROM + SWEEP);
  const [mx1, my1] = polar(CX, CY, R - 13, FROM + SWEEP * clamp(marker ?? 0, 0, 1));
  const [mx2, my2] = polar(CX, CY, R + 13, FROM + SWEEP * clamp(marker ?? 0, 0, 1));
  return html`<div class="goal-arc goal-arc--${tone}">
    <svg class="goal-arc__svg" viewBox="0 0 300 236" role="img" aria-label="${label}">
      <defs><linearGradient id="goal-arc-paint" x1="0" y1="1" x2="1" y2="0">
        <stop class="goal-arc__stop" offset="0"></stop><stop class="goal-arc__stop goal-arc__stop--end" offset="1"></stop>
      </linearGradient></defs>
      <path class="goal-arc__track" d="${d}"></path>
      <path class="goal-arc__value ${v === 0 ? 'is-zero' : ''}" d="${d}" pathLength="100" stroke-dasharray="100 100"
        stroke-dashoffset="${(100 * (1 - v)).toFixed(2)}" style="--c:100px" data-motion="ring" data-motion-key="goal-arc"></path>
      ${marker !== null ? html`<line class="goal-arc__marker" x1="${f1(mx1)}" y1="${f1(my1)}" x2="${f1(mx2)}" y2="${f1(my2)}"></line>` : ''}
    </svg>
    <div class="goal-arc__center">${center}</div>
  </div>`;
}

/**
 * The last few periods as bars. rows: [{ ym, expense, income, budget? }].
 * Each bar is marked over against its own `budget` (default: `budget`, which is also where the 预算 line is drawn —
 * pass it only when it is every bar's budget).
 * Tapping a column updates the readout (handled by the screen via data-trend-i).
 */
export function trendChart(rows, { selected = rows.length - 1, budget = 0, personalOnly = false } = {}) {
  // personalOnly: the bars measure personal spending (business spending is outside the budget they are held against).
  const value = (r) => (personalOnly ? r.personal : r.expense);
  const limit = (r) => r.budget ?? budget;
  const what = personalOnly ? '个人支出' : '支出';
  // Headroom above the budget line so its label never sits on the top value.
  const maxVal = Math.max(1, ...rows.map(value), budget * 1.15);
  const top = niceMax(maxVal);
  const sel = rows[selected];
  const budgetAt = budget > 0 ? budget / top : -1;
  // A value label within ~15% of the budget line would collide with 「预算」: leave it out.
  const gridLabel = (at, text) => (Math.abs(at - budgetAt) < 0.15 ? '' : html`<em>${text}</em>`);
  return html`<div class="trend" data-trend>
    <div class="trend__readout">
      <span class="trend__caption">${sel.label || monthLabel(sel.ym)} · ${what}</span>
      <span class="trend__value">${formatMoney(value(sel), { round: true })}</span>
      <span class="trend__sub">收入 ${formatMoney(sel.income, { round: true })}${personalOnly && sel.business > 0 ? ` · 另有创业 ${formatMoney(sel.business, { round: true })}` : ''}${sel.partial ? ' · 这一期只记录了一部分' : ''}</span>
    </div>
    <div class="trend__plot">
      <div class="trend__grid">
        <span class="trend__gridline" style="bottom:100%">${gridLabel(1, formatCompact(top))}</span>
        <span class="trend__gridline" style="bottom:50%">${gridLabel(0.5, formatCompact(top / 2))}</span>
        <span class="trend__gridline trend__gridline--base" style="bottom:0">${gridLabel(0, '0')}</span>
      </div>
      ${budget > 0 ? html`<span class="trend__budget" style="bottom:${pct(budgetAt)}"><em>预算</em></span>` : ''}
      <div class="trend__cols">
        ${rows.map((r, i) => html`<button type="button" class="trend__col ${i === selected ? 'is-selected' : ''}" data-trend-i="${i}"
            aria-label="${r.label || monthLabel(r.ym)} ${what} ${formatMoney(value(r), { round: true })}${r.partial ? '（只记录了一部分）' : ''}">
          <span class="trend__bar ${value(r) > limit(r) && limit(r) > 0 ? 'is-over' : ''} ${r.partial ? 'is-partial' : ''}" style="height:${pct(value(r) / top)};--i:${i}"></span>
        </button>`)}
      </div>
    </div>
    <div class="trend__axis">${rows.map((r, i) => html`<span class="${i === selected ? 'is-selected' : ''}">${r.tick || r.short || monthLabel(r.ym, false)}</span>`)}</div>
  </div>`;
}

function niceMax(cents) {
  const rm = cents / 100;
  const pow = 10 ** Math.floor(Math.log10(Math.max(rm, 1)));
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const n = steps.find((s) => s * pow >= rm) || 10;
  return n * pow * 100;
}

/** RM amounts in 万 (10k) for tight chart labels: 1,750,000 → "175万". */
export function formatWan(cents) {
  const rm = cents / 100;
  if (rm >= 10_000) return `${(rm / 10_000).toFixed(rm >= 1_000_000 ? 0 : 1).replace(/\.0$/, '')}万`;
  return `${Math.round(rm).toLocaleString('en-MY')}`;
}

/**
 * Investment projection: shaded band between the low / high return assumptions, the target line,
 * and the actual portfolio value so far. Values in cents; t in years from the plan start.
 * band: [{ t, low, high }], actual: [{ t, value }], years: plan length, yearLabel(t) → axis text.
 */
export function projectionChart({ band, actual = [], target, years, yearLabel, todayT = null }) {
  const W = 340, H = 204, L = 4, R = 48, T = 14, B = 26;
  const pw = W - L - R, ph = H - T - B;
  const maxV = Math.max(target * 1.12, ...band.map((p) => p.high), ...actual.map((p) => p.value), 1);
  const x = (t) => L + (Math.min(Math.max(t, 0), years) / years) * pw;
  const y = (v) => T + ph - (Math.max(0, v) / maxV) * ph;
  const pts = (arr, key) => arr.map((p) => `${x(p.t).toFixed(1)},${y(p[key] ?? p.value).toFixed(1)}`).join(' ');
  const area = band.length > 1 ? `${pts(band, 'high')} ${pts([...band].reverse(), 'low')}` : '';
  const step = years > 12 ? 5 : years > 6 ? 2 : 1;
  const ticks = [];
  for (let t = 0; t <= years; t += step) ticks.push(t);
  if (ticks[ticks.length - 1] !== years) ticks.push(years);
  const grid = [0, target / 2, target];
  const last = band[band.length - 1];
  return html`<figure class="projection">
    <svg class="projection__svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="投资预测图：目标 ${formatWan(target)}，预测区间与实际走势">
      <defs><linearGradient id="projection-paint" x1="0" y1="0" x2="1" y2="0">
        <stop class="projection__stop" offset="0"></stop><stop class="projection__stop projection__stop--end" offset="1"></stop>
      </linearGradient></defs>
      ${grid.map((g) => html`<line class="projection__grid" x1="${L}" x2="${W - R}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}"></line>
        <text class="projection__ylabel" x="${W - R + 7}" y="${(y(g) + 3.5).toFixed(1)}">${g === target ? `目标 ${formatWan(g)}` : formatWan(g)}</text>`)}
      <line class="projection__target" x1="${L}" x2="${W - R}" y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}"></line>
      ${area ? html`<polygon class="projection__band" points="${area}"></polygon>
        <polyline class="projection__edge projection__edge--high" points="${pts(band, 'high')}"></polyline>
        <polyline class="projection__edge projection__edge--low" points="${pts(band, 'low')}"></polyline>
        <circle class="projection__end" cx="${x(last.t).toFixed(1)}" cy="${y(last.high).toFixed(1)}" r="3"></circle>
        <circle class="projection__end" cx="${x(last.t).toFixed(1)}" cy="${y(last.low).toFixed(1)}" r="3"></circle>` : ''}
      ${todayT !== null ? html`<line class="projection__today" x1="${x(todayT).toFixed(1)}" x2="${x(todayT).toFixed(1)}" y1="${T}" y2="${T + ph}"></line>` : ''}
      ${actual.length > 1 ? html`<polyline class="projection__actual" points="${pts(actual, 'value')}"></polyline>` : ''}
      ${actual.length ? html`<circle class="projection__dot" cx="${x(actual[actual.length - 1].t).toFixed(1)}" cy="${y(actual[actual.length - 1].value).toFixed(1)}" r="4.5"></circle>` : ''}
      ${ticks.map((t) => html`<text class="projection__xlabel" x="${x(t).toFixed(1)}" y="${H - 7}" text-anchor="${t === 0 ? 'start' : t === years ? 'end' : 'middle'}">${yearLabel(t)}</text>`)}
    </svg>
    <figcaption class="legend legend--projection">
      <span class="legend__item"><span class="legend__swatch legend__swatch--band"></span>预测区间</span>
      ${actual.length ? html`<span class="legend__item"><span class="legend__swatch legend__swatch--actual"></span>实际市值</span>` : ''}
      <span class="legend__item"><span class="legend__swatch legend__swatch--target"></span>目标</span>
    </figcaption>
  </figure>`;
}

/** Change per category against the period before. rows: [{ label, delta, current, previous }]. */
export function divergeList(rows) {
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.delta)));
  return html`<ul class="diverge">
    ${rows.map((r, i) => {
      const w = pct((Math.abs(r.delta) / maxAbs) * 0.5);
      const up = r.delta > 0;
      return html`<li class="diverge__row" style="--i:${i}">
        <span class="diverge__label">${r.label}</span>
        <span class="diverge__track">
          <span class="diverge__axis"></span>
          <span class="diverge__bar ${up ? 'is-up' : 'is-down'}" style="width:${w}"></span>
        </span>
        <span class="diverge__value ${up ? 'is-up' : 'is-down'}">${formatCompact(r.delta, { sign: true })}</span>
      </li>`;
    })}
  </ul>`;
}
