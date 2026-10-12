// Motion that survives re-rendering. Screens are redrawn with innerHTML on every change, so CSS transitions
// alone never play: an element is always born at its final state. After each render, `animateChanges` compares
// the opted-in elements with what the same screen showed last time and plays the change:
//   data-motion="digits"  money whose value changed: the digits pop in one by one   (data-motion-key required)
//   data-motion="ring"    activity ring arc: slides from the old length              (SVG circle, stroke-dashoffset)
//   data-motion="width"   progress fill: slides from the old width
//   data-motion="switch"  checkbox switch: slides from the old side
//   data-motion="row"     list row that wasn't there before: pops in
// One action often redraws twice in a row (an entry saved, then a setting): a change that is still playing is
// carried on into the new elements instead of being cut off.
// The first render of a screen only runs the entrance (CSS under `.screen.is-fresh`, see markFresh).
// Everything is skipped when the iPhone asks for reduced motion.
// Inspired by transitions.dev (Number pop-in) and kinetics.colorion.co (spring timings); written for this app.

const memory = new Map(); // scope → Map(key → { v: last value, anim: { from, at } | null })
const CARRY_MS = 900;     // a change this recent is still playing
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const SLIDE_MS = { ring: 800, width: 650 };
export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const now = () => performance.now();

let freshTimer = 0;
/** Plays the entrance (rings drawing, bars growing, cards rising) for the screen just shown. */
export function markFresh(screenEl) {
  clearTimeout(freshTimer);
  screenEl.classList.remove('is-fresh');
  if (reduceMotion()) return;
  void screenEl.offsetWidth;
  screenEl.classList.add('is-fresh');
  freshTimer = setTimeout(() => screenEl.classList.remove('is-fresh'), 1400);
}

/** Wrap each character of a money figure in a span so the digits can pop in turn (`elapsed` ms already played). */
function popDigits(el, elapsed) {
  let i = 0;
  for (const part of el.querySelectorAll('.money__int, .money__dec')) {
    const text = part.textContent;
    part.textContent = '';
    for (const ch of text) {
      const s = document.createElement('span');
      s.className = 'm-digit';
      s.textContent = ch;
      s.style.setProperty('--i', String(i));
      i += 1;
      part.appendChild(s);
    }
  }
  el.style.setProperty('--elapsed', `${Math.round(elapsed)}ms`);
  el.classList.add('is-popping');
}

function valueOf(el, kind) {
  switch (kind) {
    case 'digits': return el.textContent.replace(/\s+/g, '');
    case 'ring': return el.getAttribute('stroke-dashoffset');
    case 'width': return el.style.width;
    case 'switch': return el.checked;
    default: return true;
  }
}

/** Ring arc or progress fill: from the old value to the one just drawn (Web Animations, so it can resume). */
function slide(el, kind, from, elapsed) {
  const prop = kind === 'ring' ? 'strokeDashoffset' : 'width';
  const to = kind === 'ring' ? `${el.getAttribute('stroke-dashoffset')}px` : el.style.width;
  const start = kind === 'ring' ? `${from}px` : from;
  if (typeof el.animate !== 'function') return;
  el.animate([{ [prop]: start }, { [prop]: to }], { duration: SLIDE_MS[kind], easing: EASE_OUT, delay: -elapsed, fill: 'backwards' });
}

/** Switch: let the browser resolve the old side, then flip, so the knob's CSS transition slides it across. */
function flip(el, from) {
  const to = el.checked;
  el.checked = from;
  void getComputedStyle(el, '::before').transform; // the knob's style at the old side is now settled
  void getComputedStyle(el).backgroundColor;
  el.checked = to;
}

function play(el, kind, anim, t) {
  const elapsed = Math.max(0, t - anim.at);
  if (kind === 'digits') popDigits(el, elapsed);
  else if (kind === 'ring' || kind === 'width') slide(el, kind, anim.from, elapsed);
  else if (kind === 'switch') { if (elapsed === 0) flip(el, anim.from); }
  else if (kind === 'row') {
    el.style.setProperty('--elapsed', `${Math.round(elapsed)}ms`);
    el.classList.add('is-new');
  }
}

/**
 * After a render of `scope` (a screen id): animate what changed since its last render. `first`: the screen was
 * just entered — only remember the values (the entrance animation covers it).
 */
export function animateChanges(root, scope, { first = false } = {}) {
  const prev = memory.get(scope);
  const next = new Map();
  const live = !!prev && !first && !reduceMotion();
  const t = now();
  const newRows = [];
  for (const el of root.querySelectorAll('[data-motion]')) {
    const kind = el.dataset.motion;
    const key = `${kind}:${el.dataset.motionKey ?? ''}`;
    const v = valueOf(el, kind);
    const before = prev?.get(key);
    let anim = null;
    if (live) {
      if (before && before.anim && before.v === v && t - before.anim.at < CARRY_MS) anim = before.anim; // still playing
      else if (kind === 'row') { if (!before) newRows.push(el); }
      else if (before && before.v !== v) anim = { from: before.v, at: t };
    }
    if (anim) play(el, kind, anim, t);
    next.set(key, { v, anim, el });
  }
  // A few new rows are entries just added; a whole new list is a different view (another month): no pop.
  if (newRows.length <= 3) {
    for (const el of newRows) {
      const anim = { from: null, at: t };
      play(el, 'row', anim, t);
      next.get(`row:${el.dataset.motionKey ?? ''}`).anim = anim;
    }
  }
  for (const entry of next.values()) delete entry.el;
  memory.set(scope, next);
}

/** Pop the digit just typed into an amount field (entry keypad). */
export function popLast(container, text, grew) {
  container.textContent = '';
  if (!grew || reduceMotion() || !text) { container.textContent = text; return; }
  container.append(text.slice(0, -1));
  const s = document.createElement('span');
  s.className = 'm-digit m-digit--typed';
  s.textContent = text.slice(-1);
  container.appendChild(s);
}

/** Fold a list row away before it is removed (swipe → 删除). */
export function collapse(el) {
  if (!el || reduceMotion()) return Promise.resolve();
  el.style.height = `${el.getBoundingClientRect().height}px`;
  void el.offsetWidth;
  el.classList.add('is-removing');
  return new Promise((resolve) => setTimeout(resolve, 280));
}
