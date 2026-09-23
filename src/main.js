// App shell: routing, tab bar, scroll-edge nav bar, global gestures and lifecycle.
import * as store from './data/store.js';
import * as lock from './data/lock.js';
import { html, icon, mount } from './ui/html.js';
import { haptic } from './ui/haptics.js';
import { toast, closeAllSheets, confirmDialog } from './ui/overlays.js';
import { openEntrySheet, quickAdd } from './ui/sheets/entry.js';
import { showLockScreen } from './ui/sheets/lockscreen.js';
import { openOnboarding } from './ui/sheets/onboarding.js';
import { formatMoney } from './core/money.js';
import { dayLabel, todayISO } from './core/dates.js';
import today from './ui/screens/today.js';
import history from './ui/screens/history.js';
import insights from './ui/screens/insights.js';
import settings from './ui/screens/settings.js';
import invest from './ui/screens/invest.js';
import * as gdrive from './data/gdrive.js';
import { handleOAuthReturn, runAutoBackup } from './ui/sheets/cloud.js';

const SCREENS = { today, history, insights, invest, settings };
const TABS = [
  { id: 'today', label: '今天', icon: 'today' },
  { id: 'history', label: '记录', icon: 'list' },
  { id: 'insights', label: '分析', icon: 'chart' },
  { id: 'invest', label: '投资', icon: 'invest' },
  { id: 'settings', label: '设置', icon: 'settings' },
];

const params = new URLSearchParams(location.search);
// ?demo=1 → sample data with investing started · ?demo=2 → sample data, investing not started yet
const demo = ['1', '2'].includes(params.get('demo')) ? params.get('demo') : false;
const app = { current: 'today', scroll: {}, lastDay: todayISO(), hiddenAt: 0, locked: false };

const $screen = () => document.getElementById('screen');
const $nav = () => document.getElementById('navbar');

// ── Shell ───────────────────────────────────────────────────────────────────

function renderShell() {
  mount(document.getElementById('app'), html`
    <header class="navbar" id="navbar">
      <div class="navbar__inner">
        <div class="navbar__leading" id="nav-leading"></div>
        <h1 class="navbar__title" id="nav-title"></h1>
        <div class="navbar__trailing" id="nav-trailing"></div>
      </div>
    </header>
    <main class="screen" id="screen" tabindex="-1"></main>
    <nav class="tabbar" aria-label="主导航">
      <div class="tabbar__group">
        ${TABS.map((t) => html`<a class="tabbar__item" href="#/${t.id}" data-tab="${t.id}" aria-label="${t.label}">
          <span class="tabbar__icon">${icon(t.icon)}</span><span class="tabbar__label">${t.label}</span>
        </a>`)}
      </div>
      <button type="button" class="tabbar__add" data-action="add" aria-label="记一笔">${icon('plus')}</button>
    </nav>
    ${demo ? html`<div class="demo-flag">演示模式 · 资料不会保存</div>` : ''}
  `);
}

function currentFromHash() {
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  return SCREENS[id] ? id : 'today';
}

function ctx() {
  return { state: store.state, today: todayISO(), demo, rerender: render };
}

export function render({ keepScroll = true } = {}) {
  if (!store.state.ready) return;
  const screen = SCREENS[app.current];
  const c = ctx();
  const y = window.scrollY;
  mount($screen(), screen.render(c));
  document.getElementById('nav-title').textContent = screen.title;
  mount(document.getElementById('nav-trailing'), screen.navActions?.(c) || '');
  mount(document.getElementById('nav-leading'), screen.navLeading?.(c) || '');
  document.querySelectorAll('.tabbar__item').forEach((a) => {
    const on = a.dataset.tab === app.current;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  screen.afterRender?.($screen(), c);
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
    app.current = next;
    render({ keepScroll: false });
    window.scrollTo(0, app.scroll[next] || 0);
    updateNavbar();
    $screen().classList.remove('is-entering');
    void $screen().offsetWidth;
    $screen().classList.add('is-entering');
  } else {
    render();
  }
}

// iOS 27 scroll edge: the bar is clear at rest and becomes a solid glass bar with a hairline once
// content scrolls underneath, and its compact title appears when the large title scrolls away.
let navTick = false;
function updateNavbar() {
  if (navTick) return;
  navTick = true;
  requestAnimationFrame(() => {
    navTick = false;
    const nav = $nav();
    if (!nav) return;
    const title = document.querySelector('.large-title');
    const navH = nav.offsetHeight;
    const scrolled = window.scrollY > 4;
    const titleGone = title ? title.getBoundingClientRect().bottom < navH - 4 : scrolled;
    nav.classList.toggle('is-scrolled', scrolled);
    nav.classList.toggle('show-title', titleGone);
  });
}

// ── Global actions (event delegation) ───────────────────────────────────────

async function onClick(e) {
  if (app.locked) return;
  if (e.target.closest('#overlay-root')) return; // sheets and alerts handle their own taps
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
  const removed = await store.deleteTransaction(id);
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
});

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // During local development always load fresh files (add ?sw=1 to test offline mode locally).
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (local && !params.has('sw')) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          toast('有新版本可用', { icon: 'sparkles', duration: 10000, action: { label: '更新', onClick: () => location.reload() } });
        }
      });
    });
  }).catch(() => { /* offline support unavailable */ });
}

async function start() {
  renderShell();
  document.addEventListener('click', onClick);
  window.addEventListener('hashchange', navigate);
  window.addEventListener('scroll', updateNavbar, { passive: true });
  window.addEventListener('resize', updateNavbar, { passive: true });
  lock.setMemoryOnly(demo);
  try {
    await store.init({ demo });
  } catch (err) {
    mount($screen(), html`<div class="empty-state empty-state--error">
      ${icon('warning')}<h2>无法打开资料库</h2>
      <p>请确认没有使用「无痕浏览」，然后重新打开 App。</p><p class="empty-state__detail">${String(err?.message || err)}</p>
    </div>`);
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
  if (!(autoLockMs > 0 && away >= 0 && away <= autoLockMs)) await maybeLock();
  store.subscribe(() => render());
  render({ keepScroll: false });
  document.documentElement.classList.add('is-ready');

  if (!store.state.settings.onboarded && !demo) openOnboarding();
  else if (params.get('add') === 'expense' || params.get('add') === 'income') openEntrySheet({ type: params.get('add') });
  if (params.has('add')) window.history.replaceState(null, '', location.pathname + (demo ? `?demo=${demo}` : '') + location.hash);

  if (oauth) await handleOAuthReturn(oauth);
  else runAutoBackup().catch(() => {});

  registerServiceWorker();
}

start();
