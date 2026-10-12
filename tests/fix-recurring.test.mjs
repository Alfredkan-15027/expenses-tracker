// Fixed items (固定项目): deleting and adding one back, the editor saving an old copy, restores, 补记 / 改扣款日 /
// 更新固定项目 from 资料检查, and the data check's day, name, business and future-date rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { checkData } from '../src/core/health.js';
import { findManualMatch, generateDue, nextDueDate, repriceRecurring } from '../src/core/recurring.js';
import { DEFAULT_CATEGORIES } from '../src/core/categories.js';
import { sanitizeSettings } from '../src/core/settings.js';
import { todayISO } from '../src/core/dates.js';

// The sheets import the browser-only overlays and haptics modules: swap those two for small stand-ins so the real
// editor and 资料检查 code run here. Every sheet opened is kept in globalThis.__sheets.
const OVERLAYS = `
export function openSheet(opts) {
  const handlers = {};
  const root = { innerHTML: '', querySelector: () => null };
  const api = { closed: false, close() { api.closed = true; opts.onClose?.(); } };
  const sheet = {
    opts, root, api, body: { querySelector: () => root },
    async fire(type, target) { for (const fn of handlers[type] || []) await fn({ target }); },
  };
  opts.onMount?.({ addEventListener: (type, fn) => { (handlers[type] ||= []).push(fn); } }, api);
  (globalThis.__sheets ||= []).push(sheet);
  return sheet;
}
export async function confirmDialog() { return true; }
export async function alertDialog() { return true; }
export function toast() {}
export function closeTopSheet() {}
export function closeAllSheets() {}
`;
const js = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
const STUBS = { '/src/ui/overlays.js': js(OVERLAYS), '/src/ui/haptics.js': js('export function haptic() {}') };
register(js(`
const stubs = ${JSON.stringify(STUBS)};
export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  for (const [tail, url] of Object.entries(stubs)) if (r.url.endsWith(tail)) return { url, shortCircuit: true };
  return r;
}`));
globalThis.document ??= { activeElement: null };

const store = await import('../src/data/store.js');
const { openRecurringEditor } = await import('../src/ui/sheets/recurring.js');
const { openHealthCheck } = await import('../src/ui/sheets/health.js');

let n = 0;
const tx = (date, amount, categoryId = 'food', extra = {}) => ({
  id: `t${++n}`, type: 'expense', amount, categoryId, date, note: '', business: false, createdAt: n, updatedAt: n, ...extra,
});
const okSettings = sanitizeSettings({ expectedIncome: 500000, savingsTarget: 100000, currentSavings: 500000, startDate: '2026-08-01' });
const check = (today, transactions, recurring, kind) => checkData({ categories: DEFAULT_CATEGORIES, settings: okSettings, today, transactions, recurring })
  .filter((i) => !kind || i.kind === kind);

const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const lastSheet = () => globalThis.__sheets.at(-1);
const saveButton = { closest: (s) => (s === '[data-save]' ? {} : null) };
const fixButton = (id) => ({ closest: (s) => (s.includes('[data-fix]') ? { dataset: { fix: id } } : null) });
const entriesOf = (id, ym) => store.state.transactions.filter((x) => x.recurringId === id && x.date.startsWith(ym));

/** In-memory store (demo mode, nothing persisted) holding only the given data, with the clock at `now`. */
async function fresh(t, now, { transactions = [], recurring = [] } = {}) {
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ['Date'], now });
  await store.init({ demo: true });
  store.state.transactions = transactions;
  store.state.recurring = recurring;
  store.state.settings = okSettings;
}

/** Open 资料检查 and tap the fix of the first finding of `kind`. */
async function tapFix(kind) {
  openHealthCheck();
  const sheet = lastSheet();
  const issue = checkData({ ...store.state, today: todayISO() }).find((i) => i.kind === kind);
  assert.ok(issue, `a ${kind} finding to fix`);
  await sheet.fire('click', fixButton(issue.id));
  sheet.api.close();
  return issue;
}

// ── Deleting an item and adding it back ─────────────────────────────────────

test('adding back a deleted fixed item finds the charge it already logged this month', async (t) => {
  await fresh(t, at(2026, 10, 12), {
    recurring: [{ id: 'rOld', type: 'expense', amount: 80000, categoryId: 'housing', note: '房租', day: 1, active: true, startMonth: '2026-09', lastMonth: '2026-10' }],
    transactions: [tx('2026-09-01', 80000, 'housing', { recurringId: 'rOld', note: '房租' }), tx('2026-10-01', 80000, 'housing', { recurringId: 'rOld', note: '房租' })],
  });
  await store.deleteRecurring('rOld');
  openRecurringEditor();
  const sheet = lastSheet();
  await sheet.fire('input', { name: 'amount', value: '800' });
  await sheet.fire('change', { name: 'amount' });
  await sheet.fire('input', { name: 'note', value: '房租' });
  await sheet.fire('input', { name: 'day', value: '1' });
  assert.match(sheet.root.innerHTML, /本月已有一笔/); // the switch shows the existing entry and is off
  await sheet.fire('click', saveButton);
  const rent = store.state.transactions.filter((x) => x.categoryId === 'housing' && x.date.startsWith('2026-10'));
  assert.equal(rent.length, 1);
  assert.equal(store.state.recurring[0].lastMonth, '2026-10');
  assert.deepEqual(check(todayISO(), store.state.transactions, store.state.recurring).filter((i) => i.kind.startsWith('fixed')), []);
});

test('an entry left by a deleted fixed item counts as this month\'s charge, and a second one is reported', () => {
  const orphan = tx('2026-10-01', 80000, 'housing', { recurringId: 'rOld', note: '房租' });
  const item = { type: 'expense', categoryId: 'housing', amount: 80000, note: '房租' };
  assert.equal(findManualMatch([orphan], item, '2026-10-12', [])?.id, orphan.id);
  assert.equal(findManualMatch([orphan], item, '2026-10-12', [{ id: 'rOld' }]), null); // still its item's own charge
  assert.equal(findManualMatch([orphan], item, '2026-10-12'), null);                  // no list: hand-typed only
  // Logged again by the new item: one finding, and its fix removes the copy the deleted item left behind
  const rNew = { id: 'rNew', type: 'expense', amount: 80000, categoryId: 'housing', note: '房租', day: 1, active: true, startMonth: '2026-10', lastMonth: '2026-10' };
  const again = tx('2026-10-01', 80000, 'housing', { recurringId: 'rNew', note: '房租' });
  const found = check('2026-10-12', [orphan, again], [rNew], 'fixed-double');
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].fix, { type: 'delete', txId: orphan.id });
  assert.match(found[0].body, /已删除的固定项目/);
  // The orphan alone is this month's record: nothing missing
  assert.deepEqual(check('2026-10-12', [orphan], [{ ...rNew, lastMonth: '2026-10' }], 'fixed-missing'), []);
});

test('the same fixed item logged twice in a month is reported; a charge moved across the month edge is not', () => {
  const phone = { id: 'rPhone', type: 'expense', amount: 5800, categoryId: 'utilities', note: '手机月费', day: 13, active: true, startMonth: '2026-08', lastMonth: '2026-10' };
  const a = tx('2026-10-13', 5800, 'utilities', { recurringId: 'rPhone', note: '手机月费' });
  const b = tx('2026-10-13', 5800, 'utilities', { recurringId: 'rPhone', note: '手机月费' });
  const found = check('2026-10-14', [tx('2026-09-13', 5800, 'utilities', { recurringId: 'rPhone' }), a, b], [phone], 'fixed-double');
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].fix, { type: 'delete', txId: b.id });
  // Gym on the 30th: September's charge posted on 1 Oct, October's on the 30th — two charges, not a double
  const gym = { id: 'rGym', type: 'expense', amount: 15000, categoryId: 'health', note: 'Gym', day: 30, active: true, startMonth: '2026-08', lastMonth: '2026-10' };
  const moved = [tx('2026-10-01', 15000, 'health', { recurringId: 'rGym' }), tx('2026-10-30', 15000, 'health', { recurringId: 'rGym' })];
  assert.deepEqual(check('2026-10-31', moved, [gym], 'fixed-double'), []);
});

// ── The editor saves the item as it is now ──────────────────────────────────

test('saving the editor after a charge was logged while it was open does not log it again', async (t) => {
  await fresh(t, at(2026, 10, 12, 23, 59), {
    recurring: [{ id: 'rPhone', type: 'expense', amount: 5800, categoryId: 'utilities', note: '手机月费', day: 13, active: true, startMonth: '2026-07', lastMonth: '2026-09' }],
  });
  openRecurringEditor(store.state.recurring[0]);
  const sheet = lastSheet();
  t.mock.timers.setTime(at(2026, 10, 13, 0, 0)); // midnight passes with the sheet open: the roll-over logs the 13th
  assert.equal(await store.runRecurring(todayISO()), 1);
  await sheet.fire('input', { name: 'note', value: 'Maxis 月费' });
  await sheet.fire('click', saveButton);
  assert.equal(entriesOf('rPhone', '2026-10').length, 1);
  assert.deepEqual([store.state.recurring[0].note, store.state.recurring[0].lastMonth], ['Maxis 月费', '2026-10']);
});

test('本月也记一笔: the text matches the switch, and a switch no longer shown is not applied', async (t) => {
  await fresh(t, at(2026, 10, 12));
  openRecurringEditor();
  const sheet = lastSheet(); // day defaults to today, so the switch is shown (and on)
  assert.match(sheet.root.innerHTML, /本月 12 号就是今天/);
  assert.match(sheet.root.innerHTML, /关掉它/);
  assert.doesNotMatch(sheet.root.innerHTML, /打开它/);
  await sheet.fire('input', { name: 'amount', value: '150' });
  await sheet.fire('input', { name: 'include', checked: false }); // turned off…
  await sheet.fire('input', { name: 'day', value: '25' });         // …then a later day: the switch disappears
  assert.doesNotMatch(sheet.root.innerHTML, /本月也记一笔/);
  await sheet.fire('click', saveButton);
  const r = store.state.recurring[0];
  assert.equal(r.lastMonth, null); // October's charge on the 25th is still logged
  assert.deepEqual(generateDue([r], '2026-10-25', () => 'g1').created.map((c) => c.date), ['2026-10-25']);
  // Day already past: the text says so and tells when to turn it off
  openRecurringEditor();
  const past = lastSheet();
  await past.fire('input', { name: 'day', value: '5' });
  assert.match(past.root.innerHTML, /本月 5 号已经过了；如果这个月不用付/);
});

test('a new day set in the editor is not flagged against the charge made under the old day', async (t) => {
  await fresh(t, at(2026, 10, 12), {
    recurring: [{ id: 'rRent', type: 'expense', amount: 80000, categoryId: 'housing', note: '房租', day: 1, active: true, startMonth: '2026-09', lastMonth: '2026-10' }],
    transactions: [tx('2026-09-01', 80000, 'housing', { recurringId: 'rRent', note: '房租' }), tx('2026-10-01', 80000, 'housing', { recurringId: 'rRent', note: '房租' })],
  });
  openRecurringEditor(store.state.recurring[0]);
  const sheet = lastSheet();
  await sheet.fire('input', { name: 'day', value: '25' });
  await sheet.fire('click', saveButton);
  assert.equal(store.state.recurring[0].day, 25);
  assert.deepEqual(checkData({ ...store.state, today: todayISO() }).filter((i) => i.kind === 'fixed-day'), []);
  assert.equal(nextDueDate(store.state.recurring[0], todayISO()), '2026-11-25');
});

// ── Restore ─────────────────────────────────────────────────────────────────

test('restoring a backup logs the fixed items that came due since it was made', async (t) => {
  await fresh(t, at(2026, 10, 12));
  const rent = { id: 'rRent', type: 'expense', amount: 80000, categoryId: 'housing', note: '房租', day: 1, active: true, startMonth: '2026-08', lastMonth: '2026-09' };
  await store.replaceAllData({
    transactions: [tx('2026-09-01', 80000, 'housing', { recurringId: 'rRent', note: '房租' })],
    categories: DEFAULT_CATEGORIES.filter((c) => c.id !== 'business'), // a built-in the backup doesn't have
    recurring: [rent], settings: okSettings,
  });
  assert.deepEqual(entriesOf('rRent', '2026-10').map((x) => x.date), ['2026-10-01']);
  assert.equal(store.state.recurring[0].lastMonth, '2026-10');
  assert.ok(store.state.categories.some((c) => c.id === 'business'));
  assert.deepEqual(checkData({ ...store.state, today: todayISO() }).filter((i) => i.kind === 'fixed-missing'), []);
});

test('补记 from 资料检查 never leaves a charge the item will log again', async (t) => {
  // Not logged yet by the item itself (lastMonth is last month): 补记 lets the item log it, once
  await fresh(t, at(2026, 10, 12), {
    recurring: [{ id: 'rRent', type: 'expense', amount: 80000, categoryId: 'housing', note: '房租', day: 1, active: true, startMonth: '2026-08', lastMonth: '2026-09' }],
  });
  await tapFix('fixed-missing');
  assert.equal(store.state.transactions.filter((x) => x.date.startsWith('2026-10')).length, 1);
  assert.equal(await store.runRecurring(todayISO()), 0);
  assert.equal(store.state.transactions.filter((x) => x.date.startsWith('2026-10')).length, 1);
  // Already marked done (its entry was deleted): added by hand, and still only once
  await fresh(t, at(2026, 10, 12), {
    recurring: [{ id: 'rRent', type: 'expense', amount: 80000, categoryId: 'housing', note: '房租', day: 1, active: true, startMonth: '2026-08', lastMonth: '2026-10' }],
  });
  await tapFix('fixed-missing');
  assert.equal(await store.runRecurring(todayISO()), 0);
  assert.equal(store.state.transactions.filter((x) => x.date.startsWith('2026-10')).length, 1);
});

// ── Charge day across a month boundary ──────────────────────────────────────

test('a charge a day or two off its set day across the month edge is not a wrong day or a missing month', () => {
  // Gym on the 30th, September's charge posted on 1 Oct
  const gym = { id: 'rGym', type: 'expense', amount: 15000, categoryId: 'health', note: 'Gym', day: 30, active: true, startMonth: '2026-08', lastMonth: '2026-09' };
  const late = [tx('2026-08-30', 15000, 'health', { recurringId: 'rGym' }), tx('2026-10-01', 15000, 'health', { recurringId: 'rGym' })];
  assert.deepEqual(check('2026-10-02', late, [gym]).filter((i) => i.kind.startsWith('fixed')), []);
  // Rent on the 1st, October's paid on 30 Sep
  const rent = { id: 'rRent', type: 'expense', amount: 80000, categoryId: 'housing', note: '房租', day: 1, active: true, startMonth: '2026-08', lastMonth: '2026-10' };
  const early = [tx('2026-09-01', 80000, 'housing', { recurringId: 'rRent' }), tx('2026-09-30', 80000, 'housing', { recurringId: 'rRent' })];
  assert.deepEqual(check('2026-10-03', early, [rent]).filter((i) => i.kind.startsWith('fixed')), []);
  // …also when it was typed in by hand (and that is not September's double either)
  const typed = [tx('2026-09-01', 80000, 'housing', { recurringId: 'rRent' }), tx('2026-09-30', 80000, 'housing', { note: '房租' })];
  assert.deepEqual(check('2026-10-03', typed, [rent]).filter((i) => i.kind.startsWith('fixed')), []);
  // A real change (25th → 1st) is still found
  const phone = { id: 'rPhone', type: 'expense', amount: 5800, categoryId: 'utilities', note: '手机月费', day: 25, active: true, startMonth: '2026-08', lastMonth: '2026-09' };
  const moved = [tx('2026-08-25', 5800, 'utilities', { recurringId: 'rPhone' }), tx('2026-10-01', 5800, 'utilities', { recurringId: 'rPhone' })];
  const found = check('2026-10-12', moved, [phone], 'fixed-day');
  assert.equal(found.length, 1);
  assert.equal(found[0].fix.day, 1);
});

test('改扣款日 does not log the month the newest charge already stands for', async (t) => {
  await fresh(t, at(2026, 10, 12), {
    recurring: [{ id: 'rPhone', type: 'expense', amount: 5800, categoryId: 'utilities', note: '手机月费', day: 25, active: true, startMonth: '2026-08', lastMonth: '2026-09' }],
    transactions: [tx('2026-08-25', 5800, 'utilities', { recurringId: 'rPhone' }), tx('2026-10-01', 5800, 'utilities', { recurringId: 'rPhone' })],
  });
  await tapFix('fixed-day');
  const r = store.state.recurring[0];
  assert.deepEqual([r.day, r.lastMonth], [1, '2026-10']);
  assert.equal(entriesOf('rPhone', '2026-10').length, 1);
  assert.equal(nextDueDate(r, todayISO()), '2026-11-01');
  assert.deepEqual(checkData({ ...store.state, today: todayISO() }).filter((i) => i.kind.startsWith('fixed')), []);
});

// ── 更新固定项目 ─────────────────────────────────────────────────────────────

test('after 更新固定项目 the data check does not propose the old day straight back', async (t) => {
  await fresh(t, at(2026, 10, 12), {
    recurring: [{ id: 'rPro', type: 'expense', amount: 9990, categoryId: 'subscriptions', note: 'Claude Pro 订阅', day: 20, active: true, startMonth: '2026-08', lastMonth: '2026-09' }],
    transactions: [tx('2026-09-20', 9990, 'subscriptions', { recurringId: 'rPro', note: 'Claude Pro 订阅' }), tx('2026-10-05', 59990, 'subscriptions', { note: 'Claude Max 订阅' })],
  });
  const issue = await tapFix('fixed-changed');
  assert.equal(issue.fix.date, '2026-10-05');
  const r = store.state.recurring[0];
  assert.deepEqual([r.amount, r.day, r.lastMonth], [59990, 5, '2026-10']);
  assert.deepEqual(checkData({ ...store.state, today: todayISO() }).filter((i) => i.kind.startsWith('fixed')), []);
  assert.equal(nextDueDate(r, todayISO()), '2026-11-05');
});

test('the price-change check works for a fixed item filed under 创业支出 with the switch left off', () => {
  // The editor saves business: false; addTransaction stores business: true for anything in 创业支出
  const pro = { id: 'rPro', type: 'expense', amount: 9990, categoryId: 'business', note: 'Claude Pro 订阅', day: 20, business: false, active: true, startMonth: '2026-08', lastMonth: '2026-09' };
  const txs = [
    tx('2026-09-20', 9990, 'business', { recurringId: 'rPro', note: 'Claude Pro 订阅' }),
    tx('2026-10-05', 59990, 'business', { note: 'Claude Max 订阅', business: true }),
  ];
  assert.equal(check('2026-10-12', txs, [pro], 'fixed-changed').length, 1);
  // A personal entry is still not taken for a business item
  const personal = [txs[0], tx('2026-10-05', 59990, 'subscriptions', { note: 'Claude Max 订阅' })];
  assert.equal(check('2026-10-12', personal, [{ ...pro, categoryId: 'subscriptions', business: true }], 'fixed-changed').length, 0);
});

test('a future-dated entry does not drive a price change, and a later lastMonth is respected', () => {
  const pro = { id: 'rPro', type: 'expense', amount: 9990, categoryId: 'subscriptions', note: 'Claude Pro 订阅', day: 20, active: true, startMonth: '2026-08', lastMonth: '2026-09' };
  const txs = [tx('2026-09-20', 9990, 'subscriptions', { recurringId: 'rPro', note: 'Claude Pro 订阅' }), tx('2026-11-08', 59990, 'subscriptions', { note: 'Claude Max 订阅' })];
  assert.deepEqual(check('2026-10-12', txs, [pro], 'fixed-changed'), []);
  // Even when applied, a future date can't mark a month that hasn't come
  const updated = repriceRecurring(pro, { amount: 59990, note: 'Claude Max 订阅', date: '2026-11-08' }, '2026-10-12');
  assert.equal(updated.lastMonth, '2026-10');
  assert.equal(generateDue([updated], '2026-11-08', () => 'g1').created.length, 1);
  // An item already marked done for a later month: the next charge shown is the one that will be logged
  assert.equal(nextDueDate({ ...pro, day: 8, lastMonth: '2026-11' }, '2026-10-12'), '2026-12-08');
});

// ── Different bills in the same category ────────────────────────────────────

test('a different bill of a similar amount in the same category is not a double, and does not hide a missing one', () => {
  const unifi = { id: 'rUnifi', type: 'expense', amount: 12900, categoryId: 'utilities', note: 'Unifi 宽带', day: 1, active: true, startMonth: '2026-08', lastMonth: '2026-10' };
  const maxis = { id: 'rMaxis', type: 'expense', amount: 12800, categoryId: 'utilities', note: 'Maxis 手机', day: 5, active: true, startMonth: '2026-08', lastMonth: '2026-10' };
  const auto = tx('2026-10-01', 12900, 'utilities', { recurringId: 'rUnifi', note: 'Unifi 宽带' });
  // Maxis bill typed by hand next to the Unifi charge: not a double
  assert.deepEqual(check('2026-10-12', [auto, tx('2026-10-05', 12800, 'utilities', { note: 'Maxis 手机' })], [unifi], 'fixed-double'), []);
  assert.deepEqual(check('2026-10-12', [auto, tx('2026-10-05', 12500, 'utilities', { note: 'TNB 电费' })], [unifi], 'fixed-double'), []);
  // A real double is still found
  assert.equal(check('2026-10-12', [auto, tx('2026-10-02', 12900, 'utilities', { note: 'Unifi 宽带' })], [unifi], 'fixed-double').length, 1);
  // Maxis's October charge is missing: a hand-typed Unifi or TNB bill does not count as it
  for (const other of [tx('2026-10-02', 12900, 'utilities', { note: 'Unifi 宽带' }), tx('2026-10-03', 12500, 'utilities', { note: 'TNB 电费' }), tx('2026-10-02', 12900, 'utilities', { note: '宽带' })]) {
    const missing = check('2026-10-12', [auto, other], [unifi, maxis], 'fixed-missing');
    assert.deepEqual(missing.map((i) => i.title), ['本月没有「Maxis 手机」的记录'], other.note);
  }
  // The editor's "already recorded" check goes by the name too
  const item = { type: 'expense', categoryId: 'utilities', amount: 12900, note: 'Unifi 宽带' };
  assert.equal(findManualMatch([tx('2026-10-05', 12800, 'utilities', { note: 'Maxis 手机' })], item, '2026-10-12'), null);
  assert.ok(findManualMatch([tx('2026-10-05', 12900, 'utilities', { note: 'unifi' })], item, '2026-10-12'));
  assert.ok(findManualMatch([tx('2026-10-05', 12900, 'utilities', { note: '' })], item, '2026-10-12'));
});
