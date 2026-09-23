// Backup / restore / CSV export. Everything here treats input as untrusted.
import { CATEGORY_ICONS, PALETTE } from './categories.js';
import { isValidISODate, isValidMonth } from './dates.js';
import { MAX_CENTS } from './money.js';
import { sanitizeSettings } from './settings.js';

export const BACKUP_APP = 'expenses-tracker';
export const BACKUP_VERSION = 2; // v2 adds holdings / investFlows / valuations
const MAX_ROWS = 200_000;
const GROUPS = ['need', 'want', 'growth', 'business', 'other'];
const TYPES = ['expense', 'income'];

export function buildBackup({ transactions, categories, recurring, settings, holdings = [], investFlows = [], valuations = [] }, now = Date.now()) {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date(now).toISOString(),
    data: { transactions, categories, recurring, settings, holdings, investFlows, valuations },
  };
}

export function backupFilename(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `expenses-tracker-backup-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}

const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64 && /^[\w-]+$/.test(v);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const amountOk = (v) => Number.isSafeInteger(v) && v > 0 && v <= MAX_CENTS;

function cleanTransaction(t) {
  if (!t || typeof t !== 'object') return null;
  if (!isId(t.id) || !TYPES.includes(t.type) || !amountOk(t.amount) || !isId(t.categoryId) || !isValidISODate(t.date)) return null;
  const ts = Number.isFinite(t.createdAt) ? t.createdAt : 0;
  return {
    id: t.id, type: t.type, amount: t.amount, categoryId: t.categoryId, date: t.date,
    note: str(t.note, 200),
    business: t.type === 'expense' && t.business === true,
    ...(isId(t.recurringId) ? { recurringId: t.recurringId } : {}),
    createdAt: ts,
    updatedAt: Number.isFinite(t.updatedAt) ? t.updatedAt : ts,
  };
}

function cleanCategory(c, i) {
  if (!c || typeof c !== 'object' || !isId(c.id) || !TYPES.includes(c.type)) return null;
  const name = str(c.name, 20).trim();
  if (!name) return null;
  return {
    id: c.id, type: c.type, name,
    hint: str(c.hint, 60),
    icon: CATEGORY_ICONS.includes(c.icon) ? c.icon : 'other',
    color: PALETTE.includes(c.color) ? c.color : 'gray',
    group: GROUPS.includes(c.group) ? c.group : 'other',
    order: Number.isFinite(c.order) ? c.order : i,
    archived: c.archived === true,
    builtin: c.builtin === true,
  };
}

function cleanRecurring(r) {
  if (!r || typeof r !== 'object' || !isId(r.id) || !TYPES.includes(r.type) || !amountOk(r.amount) || !isId(r.categoryId)) return null;
  const day = Number(r.day);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return {
    id: r.id, type: r.type, amount: r.amount, categoryId: r.categoryId,
    note: str(r.note, 200), day,
    business: r.type === 'expense' && r.business === true,
    active: r.active !== false,
    startMonth: isValidMonth(r.startMonth) ? r.startMonth : null,
    lastMonth: isValidMonth(r.lastMonth) ? r.lastMonth : null,
  };
}

const HOLDING_KIND_IDS = ['stock', 'etf', 'fund', 'fixed', 'reit', 'crypto', 'other'];

function cleanHolding(h, i) {
  if (!h || typeof h !== 'object' || !isId(h.id)) return null;
  const name = str(h.name, 30).trim();
  if (!name) return null;
  return {
    id: h.id, name,
    kind: HOLDING_KIND_IDS.includes(h.kind) ? h.kind : 'other',
    note: str(h.note, 80),
    archived: h.archived === true,
    order: Number.isFinite(h.order) ? h.order : i,
    createdAt: Number.isFinite(h.createdAt) ? h.createdAt : 0,
  };
}

function cleanFlow(f) {
  if (!f || typeof f !== 'object' || !isId(f.id) || !isId(f.holdingId) || !['in', 'out'].includes(f.type)
    || !amountOk(f.amount) || !isValidISODate(f.date)) return null;
  return {
    id: f.id, holdingId: f.holdingId, type: f.type, amount: f.amount, date: f.date,
    note: str(f.note, 120), createdAt: Number.isFinite(f.createdAt) ? f.createdAt : 0,
  };
}

function cleanValuation(v) {
  if (!v || typeof v !== 'object' || !isId(v.id) || !isId(v.holdingId) || !isValidISODate(v.date)
    || !Number.isSafeInteger(v.value) || v.value < 0 || v.value > MAX_CENTS) return null;
  return { id: v.id, holdingId: v.holdingId, value: v.value, date: v.date, createdAt: Number.isFinite(v.createdAt) ? v.createdAt : 0 };
}

function cleanList(list, fn) {
  if (!Array.isArray(list)) return { items: [], dropped: 0 };
  const items = [];
  const ids = new Set();
  let dropped = 0;
  list.slice(0, MAX_ROWS).forEach((raw, i) => {
    const v = fn(raw, i);
    if (!v || ids.has(v.id)) { dropped += 1; return; }
    ids.add(v.id);
    items.push(v);
  });
  dropped += Math.max(0, list.length - MAX_ROWS);
  return { items, dropped };
}

/** Parse and validate a backup file's text. Returns { ok, error?, data?, dropped? }. */
export function parseBackup(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, error: '文件不是有效的备份（JSON 格式错误）。' };
  }
  if (!obj || obj.app !== BACKUP_APP || typeof obj.data !== 'object' || obj.data === null) {
    return { ok: false, error: '这不是 Expenses Tracker 的备份文件。' };
  }
  if (!Number.isInteger(obj.version) || obj.version > BACKUP_VERSION) {
    return { ok: false, error: '备份文件来自更新的版本，请先更新 App。' };
  }
  const tx = cleanList(obj.data.transactions, cleanTransaction);
  const cats = cleanList(obj.data.categories, cleanCategory);
  const rec = cleanList(obj.data.recurring, cleanRecurring);
  const hold = cleanList(obj.data.holdings, cleanHolding);
  const holdingIds = new Set(hold.items.map((h) => h.id));
  const flows = cleanList(obj.data.investFlows, (f) => { const c = cleanFlow(f); return c && holdingIds.has(c.holdingId) ? c : null; });
  const vals = cleanList(obj.data.valuations, (v) => { const c = cleanValuation(v); return c && holdingIds.has(c.holdingId) ? c : null; });
  if (!cats.items.length) return { ok: false, error: '备份文件里没有类别资料，无法还原。' };
  return {
    ok: true,
    data: {
      transactions: tx.items,
      categories: cats.items,
      recurring: rec.items,
      settings: sanitizeSettings(obj.data.settings),
      holdings: hold.items,
      investFlows: flows.items,
      valuations: vals.items,
    },
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt.slice(0, 40) : '',
    dropped: tx.dropped + cats.dropped + rec.dropped + hold.dropped + flows.dropped + vals.dropped,
  };
}

// Prevent spreadsheet formula injection and escape quotes.
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(transactions, categories) {
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const header = ['日期', '类型', '类别', '金额 (RM)', '备注', '创业支出', '固定项目'];
  const rows = [...transactions]
    .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1))
    .map((t) => [
      t.date,
      t.type === 'income' ? '收入' : '支出',
      names.get(t.categoryId) || '未分类',
      (t.amount / 100).toFixed(2),
      t.note || '',
      t.business ? '是' : '',
      t.recurringId ? '是' : '',
    ]);
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
