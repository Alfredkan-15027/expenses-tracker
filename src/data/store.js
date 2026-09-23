// App state held in memory, persisted to IndexedDB (or kept in memory only in demo mode).
import * as db from './db.js';
import { DEFAULT_CATEGORIES } from '../core/categories.js';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../core/settings.js';
import { generateDue } from '../core/recurring.js';
import { todayISO } from '../core/dates.js';
import { newId } from '../core/ids.js';

export const state = {
  ready: false,
  demo: false,
  persisted: false,
  transactions: [],
  categories: [],
  recurring: [],
  settings: { ...DEFAULT_SETTINGS },
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(reason) {
  for (const fn of listeners) fn(reason);
}

// Persistence layer — swapped for no-ops in demo mode so nothing touches the real database.
let persist = {
  putTx: (items) => db.putMany('transactions', items),
  delTx: (ids) => db.deleteMany('transactions', ids),
  putCat: (items) => db.putMany('categories', items),
  delCat: (ids) => db.deleteMany('categories', ids),
  putRec: (items) => db.putMany('recurring', items),
  delRec: (ids) => db.deleteMany('recurring', ids),
  settings: (s) => db.setKV('settings', s),
  replaceAll: (data) => db.replaceAll(data),
  clearAll: () => db.clearAll(),
};

export async function init({ demo = false } = {}) {
  state.demo = demo;
  if (demo) {
    const noop = async () => {};
    persist = Object.fromEntries(Object.keys(persist).map((k) => [k, noop]));
    const { buildDemoData } = await import('./demo.js');
    Object.assign(state, buildDemoData(todayISO()));
  } else {
    const [transactions, categories, recurring, settings] = await Promise.all([
      db.getAll('transactions'), db.getAll('categories'), db.getAll('recurring'), db.getKV('settings'),
    ]);
    state.transactions = transactions;
    state.recurring = recurring;
    state.settings = sanitizeSettings(settings || DEFAULT_SETTINGS);
    state.categories = categories;
    // First launch, or a new built-in category shipped in an update (built-ins are archived, never deleted).
    const have = new Set(categories.map((c) => c.id));
    const missing = DEFAULT_CATEGORIES.filter((c) => !have.has(c.id));
    if (missing.length) {
      state.categories = [...categories, ...missing];
      await persist.putCat(missing);
    }
    // Older profiles have no start date: use the first record (or today) so budgets prorate correctly.
    if (state.settings.onboarded && !state.settings.startDate) {
      const first = transactions.reduce((m, t) => (!m || t.date < m ? t.date : m), '');
      state.settings = sanitizeSettings({ ...state.settings, startDate: first || todayISO() });
      await persist.settings(state.settings);
    }
    db.requestPersistence().then((ok) => { state.persisted = ok; });
  }
  await runRecurring();
  state.ready = true;
  emit('init');
}

/** Generate any fixed items that came due (called at launch and when the app returns to foreground). */
export async function runRecurring(today = todayISO()) {
  const { created, updated } = generateDue(state.recurring, today, newId);
  if (!created.length && !updated.length) return 0;
  state.transactions.push(...created);
  const byId = new Map(updated.map((r) => [r.id, r]));
  state.recurring = state.recurring.map((r) => byId.get(r.id) || r);
  await Promise.all([persist.putTx(created), persist.putRec(updated)]);
  if (state.ready) emit('recurring');
  return created.length;
}

// ── Transactions ────────────────────────────────────────────────────────────

export async function addTransaction(input) {
  const now = Date.now();
  const t = {
    id: newId(),
    type: input.type,
    amount: input.amount,
    categoryId: input.categoryId,
    date: input.date || todayISO(),
    note: (input.note || '').trim().slice(0, 200),
    business: input.type === 'expense' && (!!input.business || input.categoryId === 'business'),
    createdAt: now,
    updatedAt: now,
  };
  state.transactions.push(t);
  await persist.putTx([t]);
  emit('tx');
  return t;
}

export async function updateTransaction(id, patch) {
  const i = state.transactions.findIndex((t) => t.id === id);
  if (i < 0) return null;
  const prev = state.transactions[i];
  const next = { ...prev, ...patch, updatedAt: Date.now() };
  next.note = (next.note || '').trim().slice(0, 200);
  next.business = next.type === 'expense' && (!!next.business || next.categoryId === 'business');
  state.transactions[i] = next;
  await persist.putTx([next]);
  emit('tx');
  return next;
}

export async function deleteTransaction(id) {
  const t = state.transactions.find((x) => x.id === id);
  if (!t) return null;
  state.transactions = state.transactions.filter((x) => x.id !== id);
  await persist.delTx([id]);
  emit('tx');
  return t;
}

/** Put back a transaction exactly as it was (undo). */
export async function restoreTransaction(t) {
  if (state.transactions.some((x) => x.id === t.id)) return;
  state.transactions.push(t);
  await persist.putTx([t]);
  emit('tx');
}

// ── Settings ────────────────────────────────────────────────────────────────

export async function saveSettings(patch) {
  state.settings = sanitizeSettings({ ...state.settings, ...patch });
  await persist.settings(state.settings);
  emit('settings');
}

// ── Categories ──────────────────────────────────────────────────────────────

export async function saveCategory(cat) {
  const exists = state.categories.find((c) => c.id === cat.id);
  let next;
  if (exists) {
    next = { ...exists, ...cat };
    state.categories = state.categories.map((c) => (c.id === cat.id ? next : c));
  } else {
    const maxOrder = Math.max(0, ...state.categories.map((c) => c.order));
    next = { archived: false, builtin: false, hint: '', ...cat, id: cat.id || newId(), order: maxOrder + 1 };
    state.categories.push(next);
  }
  await persist.putCat([next]);
  emit('categories');
  return next;
}

/** Categories with history are archived (hidden) so old records keep their name; unused custom ones are deleted. */
export async function removeCategory(id) {
  const used = state.transactions.some((t) => t.categoryId === id) || state.recurring.some((r) => r.categoryId === id);
  const cat = state.categories.find((c) => c.id === id);
  if (!cat) return;
  if (used || cat.builtin) {
    await saveCategory({ ...cat, archived: true });
  } else {
    state.categories = state.categories.filter((c) => c.id !== id);
    await persist.delCat([id]);
    emit('categories');
  }
}

export async function moveCategory(id, dir) {
  const cat = state.categories.find((c) => c.id === id);
  if (!cat) return;
  const list = state.categories.filter((c) => c.type === cat.type && !c.archived).sort((a, b) => a.order - b.order);
  const i = list.findIndex((c) => c.id === id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const changed = list.map((c, k) => ({ ...c, order: k }));
  const byId = new Map(changed.map((c) => [c.id, c]));
  state.categories = state.categories.map((c) => byId.get(c.id) || c);
  await persist.putCat(changed);
  emit('categories');
}

// ── Recurring ───────────────────────────────────────────────────────────────

export async function saveRecurring(r) {
  const exists = state.recurring.some((x) => x.id === r.id);
  state.recurring = exists ? state.recurring.map((x) => (x.id === r.id ? r : x)) : [...state.recurring, r];
  await persist.putRec([r]);
  await runRecurring();
  emit('recurring');
}

export async function deleteRecurring(id) {
  state.recurring = state.recurring.filter((r) => r.id !== id);
  await persist.delRec([id]);
  emit('recurring');
}

// ── Backup / reset ──────────────────────────────────────────────────────────

export async function replaceAllData(data) {
  await persist.replaceAll(data);
  state.transactions = data.transactions;
  state.categories = data.categories;
  state.recurring = data.recurring;
  state.settings = sanitizeSettings(data.settings);
  emit('restore');
}

export async function eraseEverything() {
  await persist.clearAll();
  state.transactions = [];
  state.recurring = [];
  state.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  state.settings = { ...DEFAULT_SETTINGS };
  await persist.putCat(state.categories);
  emit('restore');
}

export function snapshot() {
  return {
    transactions: state.transactions,
    categories: state.categories,
    recurring: state.recurring,
    settings: state.settings,
  };
}
