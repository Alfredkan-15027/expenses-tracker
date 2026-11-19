// 今天's scene: real water. Its level is the share of today's allowance that is still there.
// A row of springs makes the surface (each column is pulled back to rest and tugs on its neighbours), so the water
// sloshes when the level changes, when a finger touches it, and settles by itself. On top of that: two slow swells
// so it is never dead still, a darker wave behind for depth, shafts of light, and a few bubbles.
// Screens are redrawn with innerHTML on every change, which replaces the <canvas>; the simulation lives here, in the
// module, and is handed the new canvas (attachWater) — the water carries on from where it was.
// Colours come from CSS (--water-* in tokens.css). Nothing runs while the page is hidden, covered by the panel or by
// a sheet, while a finger slides along the dock (holdWater), or when the iPhone asks for reduced motion (then one
// still frame is drawn).

const N = 84;                 // columns across the width
const SPRING = 26;            // pull back to rest
const DAMPING = 2.6;
const SPREAD = 520;           // how hard a column tugs on its neighbours
const LEVEL_SPRING = 30;
const LEVEL_DAMPING = 6.4;
const FULL = 0.76;            // a full day's allowance fills this much of the scene
const LOW = 0.2;              // … and the last ringgit still shows this much
const EMPTY = 0.135;          // nothing left: a shallow rest of water just above the panel (in the warning colour)

const s = {
  canvas: null, ctx: null, w: 0, h: 0, dpr: 1,
  y: new Float32Array(N), v: new Float32Array(N),
  level: 0, lv: 0, target: 0,
  t: 0, last: 0, raf: 0,
  bubbles: [], drops: [],
  colors: null, observer: null,
};

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const fillOf = (level) => EMPTY + (level <= 0 ? 0 : (LOW - EMPTY) * Math.min(1, level * 12) + (FULL - LOW) * Math.min(1, level));

function readColors() {
  const cs = getComputedStyle(s.canvas);
  const get = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  s.colors = {
    top: get('--water-top', 'rgba(74,150,255,0.5)'),
    bottom: get('--water-bottom', 'rgba(22,196,236,0.7)'),
    back: get('--water-back', 'rgba(60,116,255,0.3)'),
    line: get('--water-line', 'rgba(255,255,255,0.9)'),
    glint: get('--water-glint', 'rgba(255,255,255,0.4)'),
  };
}

function resize() {
  const c = s.canvas;
  if (!c) return;
  const rect = c.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (w !== c.width || h !== c.height) { c.width = w; c.height = h; }
  s.w = w; s.h = h; s.dpr = dpr;
}

/** The surface height (px from the top) at column i, for the wave layer `layer` (0 front, 1 back). */
function surfaceAt(i, base, layer = 0) {
  const x = i / (N - 1);
  const k = s.dpr;
  const swell = layer === 0
    ? Math.sin(x * 7.2 + s.t * 1.15) * 3.2 + Math.sin(x * 15.5 - s.t * 1.9) * 1.5
    : Math.sin(x * 6.1 - s.t * 0.9 + 1.7) * 4.4 + Math.sin(x * 12.3 + s.t * 1.4) * 1.8;
  return base + (s.y[i] * (layer ? 0.6 : 1) + swell) * k - (layer ? 7 * k : 0);
}

function tracePath(ctx, base, layer) {
  const step = s.w / (N - 1);
  ctx.beginPath();
  ctx.moveTo(0, surfaceAt(0, base, layer));
  for (let i = 1; i < N; i += 1) {
    const x0 = (i - 1) * step;
    const y0 = surfaceAt(i - 1, base, layer);
    const x1 = i * step;
    const y1 = surfaceAt(i, base, layer);
    ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  ctx.lineTo(s.w, surfaceAt(N - 1, base, layer));
}

function draw() {
  const { ctx, w, h, dpr, colors } = s;
  ctx.clearRect(0, 0, w, h);
  const fill = fillOf(s.level);
  if (fill <= 0.004) return;
  const base = h * (1 - fill);

  // the wave behind
  tracePath(ctx, base, 1);
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.fillStyle = colors.back;
  ctx.fill();

  // the water
  tracePath(ctx, base, 0);
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  const g = ctx.createLinearGradient(0, base - 10 * dpr, 0, h);
  g.addColorStop(0, colors.top);
  g.addColorStop(1, colors.bottom);
  ctx.fillStyle = g;
  ctx.fill();

  // light through the water: slow slanted shafts, and bubbles
  ctx.save();
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i += 1) {
    const cx = ((i * 0.37 + 0.12 + Math.sin(s.t * 0.11 + i * 2.1) * 0.08) % 1) * w;
    const width = (60 + i * 26) * dpr;
    const shaft = ctx.createLinearGradient(cx - width, 0, cx + width, 0);
    shaft.addColorStop(0, 'rgba(255,255,255,0)');
    shaft.addColorStop(0.5, colors.glint);
    shaft.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = 0.16 + 0.07 * Math.sin(s.t * 0.6 + i * 1.3);
    ctx.fillStyle = shaft;
    ctx.beginPath();
    ctx.moveTo(cx - width, base - 20 * dpr);
    ctx.lineTo(cx + width, base - 20 * dpr);
    ctx.lineTo(cx + width - 90 * dpr, h);
    ctx.lineTo(cx - width - 90 * dpr, h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const b of s.bubbles) {
    const a = Math.min(1, b.life * 3) * Math.min(1, (b.y - base) / (26 * dpr));
    if (a <= 0) continue;
    ctx.globalAlpha = a * 0.55;
    ctx.beginPath();
    ctx.arc(b.x + Math.sin(b.life * 5 + b.seed) * 3 * dpr, b.y, b.r * dpr, 0, Math.PI * 2);
    ctx.fillStyle = colors.glint;
    ctx.fill();
  }
  ctx.restore();

  // the surface: a soft band of light, then a fine bright line
  tracePath(ctx, base, 0);
  ctx.lineWidth = 7 * dpr;
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = colors.line;
  ctx.stroke();
  ctx.lineWidth = 1.6 * dpr;
  ctx.globalAlpha = 0.9;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // drops thrown up by a touch
  for (const d of s.drops) {
    ctx.globalAlpha = Math.max(0, Math.min(1, d.life * 2.4));
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r * dpr, 0, Math.PI * 2);
    ctx.fillStyle = colors.line;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function step(dt) {
  s.t += dt;
  // the level follows its target on a spring, so a change arrives with a little overshoot
  s.lv += ((s.target - s.level) * LEVEL_SPRING - s.lv * LEVEL_DAMPING) * dt;
  s.level = Math.max(0, s.level + s.lv * dt);
  // the surface
  const { y, v } = s;
  for (let i = 0; i < N; i += 1) {
    const left = y[i > 0 ? i - 1 : i];
    const right = y[i < N - 1 ? i + 1 : i];
    v[i] += (-SPRING * y[i] - DAMPING * v[i] + SPREAD * (left + right - 2 * y[i])) * dt;
  }
  for (let i = 0; i < N; i += 1) y[i] += v[i] * dt;
  // bubbles
  const fill = fillOf(s.level);
  const base = s.h * (1 - fill);
  if (fill > 0.24 && s.bubbles.length < 14 && Math.random() < dt * 1.7) {
    s.bubbles.push({ x: Math.random() * s.w, y: s.h + 6 * s.dpr, r: 1.2 + Math.random() * 2.6, vy: (26 + Math.random() * 34) * s.dpr, life: 0, seed: Math.random() * 9 });
  }
  for (const b of s.bubbles) { b.y -= b.vy * dt; b.life += dt; }
  s.bubbles = s.bubbles.filter((b) => b.y > base + 4 * s.dpr);
  for (const d of s.drops) { d.vy += 900 * s.dpr * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt; }
  s.drops = s.drops.filter((d) => d.life > 0 && d.y < s.h);
}

function covered() {
  // the panel has slid over (nearly) the whole scene, or a sheet / alert lies over the page
  const cssH = s.h / s.dpr;
  return window.scrollY > cssH * 0.94 || document.documentElement.classList.contains('has-overlay');
}

let held = false;
/** Keep the water still (it stays as drawn) while something else needs every frame; false lets it move again. */
export function holdWater(on) {
  held = !!on;
  if (!held) start();
}

function frame(now) {
  s.raf = 0;
  if (!s.canvas || !s.canvas.isConnected || document.hidden) return;
  const dt = Math.min(0.034, Math.max(0.001, (now - (s.last || now)) / 1000));
  s.last = now;
  if (!held && !covered()) {
    // two smaller steps keep the springs stable at 30 fps
    step(dt / 2); step(dt / 2);
    draw();
  }
  s.raf = requestAnimationFrame(frame);
}

function start() {
  if (s.raf || !s.canvas) return;
  if (reduceMotion()) { s.level = s.target; s.lv = 0; s.y.fill(0); s.v.fill(0); draw(); return; }
  s.last = 0;
  s.raf = requestAnimationFrame(frame);
}

/** Come to rest at the target level at once, without playing the way there. */
export function settleWater() {
  s.level = s.target; s.lv = 0; s.y.fill(0); s.v.fill(0);
  if (s.canvas?.isConnected) draw();
}

/** Disturb the surface at x (0 → 1 across the width): a touch, or a coin dropping in. */
export function splash(x, force = 1) {
  if (!s.canvas || reduceMotion()) return;
  const i = Math.max(1, Math.min(N - 2, Math.round(x * (N - 1))));
  for (let k = -3; k <= 3; k += 1) {
    const j = i + k;
    if (j >= 0 && j < N) s.v[j] += force * 150 * (1 - Math.abs(k) / 4);
  }
  const base = s.h * (1 - fillOf(s.level));
  if (fillOf(s.level) > 0.02) {
    for (let k = 0; k < 6; k += 1) {
      s.drops.push({
        x: x * s.w + (Math.random() - 0.5) * 16 * s.dpr, y: base,
        vx: (Math.random() - 0.5) * 180 * s.dpr, vy: -(170 + Math.random() * 190) * s.dpr * Math.min(1.4, force),
        r: 1.4 + Math.random() * 2, life: 0.75,
      });
    }
  }
  start();
}

/**
 * Show the water in `canvas` at `level` (0 → 1 of today's allowance left). `fresh`: the page was just opened — the
 * water rises from empty. Otherwise it moves from where it was, with a slosh when the level changed.
 */
export function attachWater(canvas, { level = 0, fresh = false } = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') return;
  const first = !s.canvas;
  s.canvas = canvas;
  s.ctx = canvas.getContext('2d');
  resize();
  readColors();
  const target = Math.max(0, Math.min(1, level));
  if (first || fresh) { s.level = 0; s.lv = 0; s.y.fill(0); s.v.fill(0); }
  if (Math.abs(target - s.target) > 0.002 && !first && !fresh) {
    // money went out (or came back): the whole surface rocks, and something drops in
    const dir = target < s.target ? 1 : -1;
    for (let i = 0; i < N; i += 1) s.v[i] += dir * Math.sin((i / (N - 1)) * Math.PI * 2) * 70;
    s.target = target;
    if (dir > 0) splash(0.3 + Math.random() * 0.4, 1.35);
  }
  s.target = target;
  if (s.observer) s.observer.disconnect();
  if (typeof ResizeObserver === 'function') {
    s.observer = new ResizeObserver(() => { resize(); if (reduceMotion()) draw(); });
    s.observer.observe(canvas);
  }
  canvas.onpointerdown = (e) => {
    const r = canvas.getBoundingClientRect();
    const surface = r.top + r.height * (1 - fillOf(s.level));
    if (e.clientY > surface - 28) splash((e.clientX - r.left) / r.width, 1);
  };
  start();
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('scroll', () => { if (!s.raf) start(); }, { passive: true });
    if (typeof matchMedia === 'function') {
      matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (s.canvas?.isConnected) { readColors(); if (reduceMotion()) draw(); } });
    }
  }
}
