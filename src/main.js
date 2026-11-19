// App shell: routing, the glass dock (with its draggable lens), the top bar, global gestures and lifecycle.
import * as store from './data/store.js';
import * as lock from './data/lock.js';
import { getKV, setKV, deleteKV } from './data/db.js';
import { html, icon, mount } from './ui/html.js';
import { haptic } from './ui/haptics.js';
import { toast, closeAllSheets, confirmDialog } from './ui/overlays.js';
import { animateChanges, markFresh, collapse } from './ui/motion.js';
import { onInfoClick } from './ui/info.js';
import { openEntrySheet, quickAdd } from './ui/sheets/entry.js';
import { showLockScreen } from './ui/sheets/lockscreen.js';
import { openOnboarding } from './ui/sheets/onboarding.js';
import { formatMoney } from './core/money.js';
import { dayLabel, todayISO } from './core/dates.js';
import today from './ui/screens/today.js';
import history from './ui/screens/history.js';
import insights from './ui/screens/insights.js';
import settings, { APP_VERSION } from './ui/screens/settings.js';
import invest from './ui/screens/invest.js';
import * as gdrive from './data/gdrive.js';
import { handleOAuthReturn, runAutoBackup } from './ui/sheets/cloud.js';

const SCREENS = { today, history, insights, invest, settings };
// The dock holds the four places you go every day, with 记一笔 in the middle; 设置 is the gear at the top right.
// Icons only: each carries its name for VoiceOver (aria-label).
const TABS = [
  { id: 'today', label: '今天', icon: 'today' },
  { id: 'history', label: '记录', icon: 'list' },
  { id: 'insights', label: '分析', icon: 'chart' },
  { id: 'invest', label: '投资', icon: 'invest' },
];
const ORDER = ['today', 'history', 'insights', 'invest', 'settings'];

const params = new URLSearchParams(location.search);
// ?demo=1 → sample data with investing started · ?demo=2 → sample data, investing not started yet
const demo = ['1', '2'].includes(params.get('demo')) ? params.get('demo') : false;
const app = { current: 'today', prev: 'today', scroll: {}, lastDay: todayISO(), hiddenAt: 0, locked: false };

const $screen = () => document.getElementById('screen');
const $nav = () => document.getElementById('navbar');
const $dock = () => document.getElementById('dock');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ── Shell ───────────────────────────────────────────────────────────────────

function renderShell() {
  const tab = (t) => html`<a class="dock__item" href="#/${t.id}" data-tab="${t.id}" aria-label="${t.label}">
    <span class="dock__icon">${icon(t.icon)}</span>
  </a>`;
  mount(document.getElementById('app'), html`
    <header class="navbar" id="navbar">
      <div class="navbar__inner">
        <div class="navbar__leading" id="nav-leading"></div>
        <h1 class="navbar__title" id="nav-title"></h1>
        <div class="navbar__trailing" id="nav-trailing"></div>
      </div>
    </header>
    <main class="screen" id="screen" tabindex="-1"></main>
    <nav class="dock" aria-label="主导航">
      <div class="dock__bar" id="dock">
        <span class="dock__lens" aria-hidden="true"></span>
        ${TABS.slice(0, 2).map(tab)}
        <button type="button" class="dock__add" data-action="add" aria-label="记一笔">${icon('plus')}</button>
        ${TABS.slice(2).map(tab)}
      </div>
    </nav>
    ${demo ? html`<div class="demo-flag">演示</div>` : ''}
  `);
  enableDockDrag();
}

// ── The dock's lens ─────────────────────────────────────────────────────────
// A brighter drop of glass sits under the selected tab. Put a finger on the dock and slide: the lens swells and
// follows the finger, the tab under it lifts, and letting go opens that tab — the way the iOS tab bar does it
// (the idea of a tab bar with a raised middle button is CYLTabBarController's; the lens that stretches towards the
// finger is liquid-glass-react's "elasticity", done here with plain CSS variables so it runs on iPhone Safari).

function placeLens() {
  const bar = $dock();
  if (!bar) return;
  const active = bar.querySelector('.dock__item.is-active');
  bar.classList.toggle('has-lens', !!active);
  if (!active) return;
  bar.style.setProperty('--lens-x', `${active.offsetLeft}px`);
  bar.style.setProperty('--lens-w', `${active.offsetWidth}px`);
}

let dockSwallowsClick = false;
function enableDockDrag() {
  const bar = $dock();
  let pointer = null, startX = 0, dragging = false, under = null;
  const items = () => [...bar.querySelectorAll('.dock__item')];
  const nearest = (x) => items().reduce((best, el) => {
    const r = el.getBoundingClientRect();
    const d = Math.abs(x - (r.left + r.width / 2));
    return !best || d < best.d ? { el, d } : best;
  }, null)?.el;

  bar.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.dock__item')) return;
    pointer = e.pointerId; startX = e.clientX; dragging = false; under = null;
  });
  bar.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointer) return;
    if (!dragging) {
      if (Math.abs(e.clientX - startX) < 8) return;
      dragging = true;
      try { bar.setPointerCapture(pointer); } catch { /* the pointer is already gone */ }
      bar.classList.add('is-dragging', 'has-lens');
    }
    const r = bar.getBoundingClientRect();
    const w = items()[0].offsetWidth;
    bar.style.setProperty('--lens-w', `${w}px`);
    bar.style.setProperty('--lens-x', `${clamp(e.clientX - r.left - w / 2, 5, r.width - w - 5)}px`);
    const el = nearest(e.clientX);
    if (el !== under) {
      under?.classList.remove('is-under');
      el?.classList.add('is-under');
      under = el;
      haptic();
    }
  });
  const end = (e) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    if (!dragging) return;
    dragging = false;
    bar.classList.remove('is-dragging');
    under?.classList.remove('is-under');
    dockSwallowsClick = true;
    setTimeout(() => { dockSwallowsClick = false; }, 350);
    const id = under?.dataset.tab;
    under = null;
    if (id && id !== app.current) location.hash = `#/${id}`;
    else placeLens();
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
  // the dock's own size settles after the styles load and changes with the window: keep the lens under its tab
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (!dragging) placeLens(); }).observe(bar);
  // the click that ends a slide is not a tap on whatever is under the finger
  bar.addEventListener('click', (e) => { if (dockSwallowsClick) { e.preventDefault(); e.stopPropagation(); } }, true);
}

function currentFromHash() {
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  return SCREENS[id] ? id : 'today';
}

function ctx(entering = false) {
  return { state: store.state, today: todayISO(), demo, rerender: render, entering };
}

/** Draw the current screen. `entering`: it was just opened (plays its entrance instead of the change motion). */
export function render({ keepScroll = true, entering = false } = {}) {
  if (!store.state.ready) return;
  const screen = SCREENS[app.current];
  const c = ctx(entering);
  const y = window.scrollY;
  const settings = app.current === 'settings';
  document.documentElement.dataset.screen = app.current; // the canvas light and the dock follow the page (screens.css)
  const gear = settings ? '' : html`<a class="btn btn--icon btn--glass" href="#/settings" aria-label="设置">${icon('settings')}</a>`;
  const back = settings ? html`<button type="button" class="btn btn--icon btn--glass" data-back aria-label="返回">${icon('chevron-left')}</button>` : '';
  // A page that fails to draw must not take the rest of the app down with it: the data is untouched.
  try {
    mount($screen(), screen.render(c));
    document.getElementById('nav-title').textContent = screen.title;
    mount(document.getElementById('nav-trailing'), html`${screen.navActions?.(c) || ''}${gear}`);
    mount(document.getElementById('nav-leading'), html`${back}${screen.navLeading?.(c) || ''}`);
    screen.afterRender?.($screen(), c);
    // Motion is decoration: if it ever fails, the page it decorates must still be there.
    try {
      animateChanges($screen(), app.current, { first: entering });
      if (entering) markFresh($screen());
    } catch { /* drawn without motion */ }
  } catch (err) {
    document.getElementById('nav-title').textContent = screen.title;
    mount(document.getElementById('nav-trailing'), gear);
    mount(document.getElementById('nav-leading'), back);
    mount($screen(), html`<div class="panel panel--page"><div class="empty-state empty-state--error">
      ${icon('warning')}<h2>这一页没能显示</h2>
      <p>你的资料没有受影响。可以先看看别的页面，或重新载入。</p>
      <p class="empty-state__detail">${String(err?.message || err)}</p>
      <button type="button" class="btn btn--primary" data-reload>重新载入</button>
    </div></div>`);
  }
  document.querySelectorAll('.dock__item').forEach((a) => {
    const on = a.dataset.tab === app.current;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  placeLens();
  if (keepScroll) window.scrollTo(0, y);
  updateNavbar();
}

function navigate() {
  // An OAuth return that arrives without a full page load: consume it (and strip the token) first.
  if (/(^#|&)(access_token|error)=/.test(location.hash)) {
    gdrive.consumeRedirect().then((r) => { navigate(); if (r) handleOAuthReturn(r); }).catch(() => {});
    return;
  }
  const next = currentFromHash();
  if (next !== app.current) {
    app.scroll[app.current] = window.scrollY;
    // the new page arrives from the side it lives on in the dock; 设置 rises from below
    const from = ORDER.indexOf(app.current);
    const to = ORDER.indexOf(next);
    $screen().dataset.dir = next === 'settings' || app.current === 'settings' ? 'none' : to > from ? 'forward' : 'back';
    if (next === 'settings') app.prev = app.current;
    app.current = next;
    render({ keepScroll: false, entering: true });
    window.scrollTo(0, app.scroll[next] || 0);
    updateNavbar();
    $screen().classList.remove('is-entering');
    void $screen().offsetWidth;
    $screen().classList.add('is-entering');
  } else {
    render();
  }
}

// Scrolling: the panel slides up over the scene. The scene sinks back as it is covered (--scroll, 0 → 1); once the
// panel reaches the top bar, the bar gets its soft blurred edge and shows the page's name.
let navTick = false;
function updateNavbar() {
  if (navTick) return;
  navTick = true;
  requestAnimationFrame(() => {
    navTick = false;
    const nav = $nav();
    if (!nav) return;
    const el = $screen();
    const scene = el.querySelector('.scene');
    const panel = el.querySelector('.panel');
    const navH = nav.offsetHeight;
    let under = window.scrollY > 4;
    if (scene && panel) {
      under = panel.getBoundingClientRect().top <= navH + 2;
      el.style.setProperty('--scroll', clamp(window.scrollY / Math.max(1, scene.offsetHeight - navH), 0, 1).toFixed(3));
    } else {
      el.style.setProperty('--scroll', '0');
    }
    nav.classList.toggle('is-scrolled', under);
    nav.classList.toggle('show-title', under);
  });
}

// ── Global actions (event delegation) ───────────────────────────────────────

async function onClick(e) {
  if (app.locked) return;
  if (e.target.closest('#overlay-root')) return; // sheets and alerts handle their own taps
  if (e.target.closest('[data-reload]')) { location.reload(); return; }
  if (onInfoClick(e)) return; // ⓘ: unfold / fold an explanation in place
  if (e.target.closest('[data-back]')) { haptic(); location.hash = `#/${app.prev || 'today'}`; return; }
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    haptic();
    if (tab.dataset.tab === app.current) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    return;
  }
  const a = e.target.closest('[data-action]');
  if (a) {
    const { action } = a.dataset;
    if (action === 'add') { haptic(); openEntrySheet({ type: a.dataset.type || 'expense' }); return; }
    if (action === 'edit-tx') {
      if (swipe.consumeClick()) return;
      const tx = store.state.transactions.find((t) => t.id === a.dataset.id);
      if (tx) openEntrySheet({ tx });
      return;
    }
    if (action === 'delete-tx') { await deleteTx(a.dataset.id); return; }
    if (action === 'quick') {
      const pick = today.picks?.[Number(a.dataset.i)];
      if (pick) await quickAdd(pick);
      return;
    }
  }
  const screen = SCREENS[app.current];
  screen.onClick?.(e, ctx());
}

async function deleteTx(id) {
  const t = store.state.transactions.find((x) => x.id === id);
  if (!t) return;
  if (t.recurringId) {
    const ok = await confirmDialog({
      title: '删除这笔固定支出？',
      message: '只会删除这一个月的记录，固定项目本身不受影响（可在「设置 → 固定项目」管理）。',
      confirm: '删除', destructive: true,
    });
    if (!ok) { swipe.closeAll(); return; }
  }
  haptic('success');
  await collapse(document.querySelector(`.swipe__action[data-id="${CSS.escape(id)}"]`)?.closest('.swipe'));
  let removed;
  try {
    removed = await store.deleteTransaction(id);
  } catch (err) {
    render(); // unfold the row again: nothing was deleted
    throw err;
  }
  if (!removed) { render(); return; }
  toast(`已删除 ${formatMoney(removed.amount)} · ${dayLabel(removed.date)}`, {
    icon: 'trash', action: { label: '撤销', onClick: () => store.restoreTransaction(removed) },
  });
}

// ── Swipe-to-delete rows ────────────────────────────────────────────────────

const swipe = (() => {
  const ACTION_W = 84;
  let row = null, startX = 0, startY = 0, dx = 0, mode = null, open = null, justSwiped = false;

  const setX = (el, x, animate) => {
    const content = el.querySelector('.swipe__content');
    el.classList.toggle('is-animating', !!animate);
    if (x) el.classList.add('is-swiping');
    else if (animate) content.addEventListener('transitionend', () => { if (!content.style.transform) el.classList.remove('is-swiping'); }, { once: true });
    else el.classList.remove('is-swiping');
    content.style.transform = x ? `translateX(${x}px)` : '';
  };
  const closeAll = () => { if (open) { setX(open, 0, true); open.classList.remove('is-open'); open = null; } };

  document.addEventListener('pointerdown', (e) => {
    const r = e.target.closest('.swipe');
    if (open && r !== open) closeAll();
    if (!r || e.target.closest('.swipe__action')) return;
    row = r; startX = e.clientX; startY = e.clientY; dx = 0; mode = null;
  }, { passive: true });

  document.addEventListener('pointermove', (e) => {
    if (!row) return;
    const mx = e.clientX - startX, my = e.clientY - startY;
    if (!mode) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      mode = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (mode === 'y') { row = null; return; }
    }
    const base = row.classList.contains('is-open') ? -ACTION_W : 0;
    dx = Math.min(0, base + mx);
    if (dx < -ACTION_W) dx = -ACTION_W + (dx + ACTION_W) * 0.35; // rubber band
    setX(row, dx, false);
  }, { passive: true });

  const end = () => {
    if (!row) return;
    if (mode === 'x') {
      justSwiped = true;
      setTimeout(() => { justSwiped = false; }, 350);
      const width = row.offsetWidth;
      if (dx < -width * 0.55) {
        const id = row.querySelector('.swipe__action')?.dataset.id;
        setX(row, 0, true);
        row.classList.remove('is-open');
        open = null;
        if (id) deleteTx(id);
      } else if (dx < -ACTION_W / 2) {
        setX(row, -ACTION_W, true); row.classList.add('is-open'); open = row; haptic();
      } else {
        setX(row, 0, true); row.classList.remove('is-open'); if (open === row) open = null;
      }
    }
    row = null; mode = null;
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);

  // The click that follows a swipe gesture is swallowed; a tap on an open row closes it instead of editing.
  const consumeClick = () => {
    if (justSwiped) return true;
    if (open) { closeAll(); return true; }
    return false;
  };
  return { closeAll, consumeClick };
})();

// ── Lifecycle ───────────────────────────────────────────────────────────────

async function maybeLock() {
  if (demo || !(await lock.isEnabled())) return;
  app.locked = true;
  closeAllSheets();
  await showLockScreen();
  app.locked = false;
}

// A write that did not reach the phone's storage (full, or the database was closed): say so instead of failing quietly.
const DB_ERRORS = new Set(['QuotaExceededError', 'InvalidStateError', 'UnknownError', 'TransactionInactiveError', 'DataError', 'ConstraintError', 'ReadOnlyError', 'VersionError']);
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  if (!DB_ERRORS.has(r?.name) && r?.message !== 'Transaction aborted') return;
  e.preventDefault();
  toast(r?.name === 'QuotaExceededError' ? '手机存储空间不足，没能保存' : '没能保存，请再试一次', { icon: 'warning', tone: 'error', duration: 6000 });
});

document.addEventListener('visibilitychange', async () => {
  const root = document.documentElement;
  if (document.visibilityState === 'hidden') {
    app.hiddenAt = Date.now();
    // Keep amounts out of the iOS app switcher snapshot when the passcode lock is on.
    if (!demo && (await lock.isEnabled())) root.classList.add('is-concealed');
    return;
  }
  const away = app.hiddenAt ? Date.now() - app.hiddenAt : 0;
  if (app.hiddenAt && !app.locked && !demo && (await lock.isEnabled()) && away > (await lock.getAutoLockMs())) {
    root.classList.add('is-locked'); // stays hidden until the passcode is entered
    root.classList.remove('is-concealed');
    await maybeLock();
  }
  root.classList.remove('is-concealed');
  const t = todayISO();
  const added = await store.runRecurring(t);
  if (t !== app.lastDay || added) { app.lastDay = t; render(); }
  runAutoBackup().catch(() => {});
  checkForUpdate();
  showUpdateToast();
});

// A phone left open overnight: roll over to the new day (fixed items due, today's allowance) without a tap.
setInterval(async () => {
  if (document.visibilityState !== 'visible' || app.locked || !store.state.ready) return;
  const t = todayISO();
  if (t === app.lastDay) return;
  app.lastDay = t;
  await store.runRecurring(t);
  render();
}, 60_000);

// ── Updates ─────────────────────────────────────────────────────────────────
// The app opens from the offline cache, so a new version is downloaded in the background and only runs on the
// next load. The worker that takes over reports its version; if the page is still running older code, offer a
// one-tap reload. Asking (instead of listening for the worker's arrival) works even when the new worker took
// over while the lock screen was still up.

let swReg = null;
let updateWaiting = false;
let lastUpdateCheck = 0;
const UPDATE_CHECK_EVERY = 10 * 60_000;
const RELOAD_MARK = 'reloadUnlocked';
const RELOAD_GRACE_MS = 20_000;

function askWorkerVersion() {
  navigator.serviceWorker?.controller?.postMessage('version');
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // During local development always load fresh files (add ?sw=1 to test offline mode locally).
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (local && !params.has('sw')) return;
  navigator.serviceWorker.addEventListener('message', (e) => {
    const v = e.data?.version;
    if (typeof v === 'string' && v !== `v${APP_VERSION}`) { updateWaiting = true; showUpdateToast(); }
  });
  navigator.serviceWorker.addEventListener('controllerchange', askWorkerVersion);
  navigator.serviceWorker.register('sw.js').then((reg) => { swReg = reg; askWorkerVersion(); }).catch(() => { /* offline support unavailable */ });
}

/** Look for a newer version when the app comes back to the foreground (iPhone only checks on a cold start). */
function checkForUpdate() {
  if (!swReg || Date.now() - lastUpdateCheck < UPDATE_CHECK_EVERY) return;
  lastUpdateCheck = Date.now();
  swReg.update().catch(() => {});
}

function showUpdateToast() {
  if (!updateWaiting || app.locked || !store.state.ready || document.documentElement.classList.contains('is-locked')) return;
  updateWaiting = false;
  toast('有新版本可用', { icon: 'sparkles', duration: 12000, action: { label: '更新', onClick: applyUpdate } });
}

async function applyUpdate() {
  // The reload starts the app fresh, which would ask for the passcode again; tell it this is the same unlocked visit.
  if (!demo && !app.locked) await setKV(RELOAD_MARK, Date.now()).catch(() => {});
  location.reload();
}

/** True when this load was started by applyUpdate a moment ago (and consumes the mark). */
async function takeReloadMark() {
  if (demo) return false;
  try {
    const at = await getKV(RELOAD_MARK);
    if (at === undefined) return false;
    await deleteKV(RELOAD_MARK);
    return Number.isFinite(at) && Date.now() - at >= 0 && Date.now() - at < RELOAD_GRACE_MS;
  } catch {
    return false;
  }
}

async function start() {
  renderShell();
  registerServiceWorker();
  document.addEventListener('click', onClick);
  window.addEventListener('hashchange', navigate);
  window.addEventListener('scroll', updateNavbar, { passive: true });
  window.addEventListener('resize', () => { updateNavbar(); placeLens(); }, { passive: true });
  lock.setMemoryOnly(demo);
  try {
    await store.init({ demo });
  } catch (err) {
    mount($screen(), html`<div class="panel panel--page"><div class="empty-state empty-state--error">
      ${icon('warning')}<h2>无法打开资料库</h2>
      <p>请确认没有使用「无痕浏览」，然后重新打开 App。</p><p class="empty-state__detail">${String(err?.message || err)}</p>
    </div></div>`);
    return;
  }
  // Returning from Google's sign-in page: read (and strip) the token from the URL before routing.
  const oauth = demo ? null : await gdrive.consumeRedirect().catch(() => null);
  app.current = currentFromHash();
  // Unlock first so no amount is ever painted behind the passcode screen. A verified return from a Google
  // sign-in this app started counts like a short app switch: within the auto-lock delay (measured from the
  // user's last touch in the unlocked app), no second unlock.
  const away = oauth?.presentAt ? Date.now() - oauth.presentAt : Infinity;
  const autoLockMs = await lock.getAutoLockMs().catch(() => 0);
  const resumed = await takeReloadMark();
  if (!resumed && !(autoLockMs > 0 && away >= 0 && away <= autoLockMs)) await maybeLock();
  store.subscribe(() => render());
  render({ keepScroll: false, entering: true });
  document.documentElement.classList.add('is-ready');

  if (!store.state.settings.onboarded && !demo) openOnboarding();
  else if (params.get('add') === 'expense' || params.get('add') === 'income') openEntrySheet({ type: params.get('add') });
  if (params.has('add')) window.history.replaceState(null, '', location.pathname + (demo ? `?demo=${demo}` : '') + location.hash);

  if (oauth) await handleOAuthReturn(oauth);
  else runAutoBackup().catch(() => {});
  showUpdateToast();
}

start();
