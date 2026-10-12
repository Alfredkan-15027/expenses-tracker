import { DEFAULT_PROFILE, normalizeProfile } from './benchmarks.js';
import { MAX_CENTS } from './money.js';
import { isValidISODate, toISODate } from './dates.js';
import { daysBetween } from './periods.js';
import { DEFAULT_INVEST, sanitizeInvest } from './invest.js';

export const DEFAULT_SETTINGS = {
  expectedIncome: 0,   // cents / month — basis for the daily budget
  savingsTarget: 0,    // cents / month
  currentSavings: 0,   // cents — money on hand when last filled in (对账); carried forward by the records, see cashOnHand
  currentSavingsAt: '', // ISO date it was last filled in
  currentSavingsTs: 0,  // epoch ms it was last filled in — entries logged later that same day count after it
  goalName: '应急金',
  goalAmount: 0,       // cents — long-term savings goal
  profile: { ...DEFAULT_PROFILE },
  onboarded: false,
  startDate: '',       // first day of tracking (ISO) — the first month's budget is prorated from here
  lastBackupAt: 0,     // epoch ms — last backup of any kind
  backupFreq: 'weekly',   // off | daily | weekly | monthly
  backupDest: 'icloud',   // icloud (Save to Files) | gdrive (encrypted, app-private Drive folder)
  gdriveConnected: false,
  lastGdriveBackupAt: 0,
  invest: { ...DEFAULT_INVEST },
  budgetIncludesBusiness: false, // business spending counts against 今天还能花 / the period budget (off: tracked, but outside it)
  healthIgnored: [],   // data-check findings the user marked as fine (issue ids)
  // Budget period: calendar months, or pay cycles starting when 薪水 / 创业收入 arrives inside the window.
  payCycle: { enabled: false, from: 15, to: 20 },
};

export const BACKUP_FREQS = [
  { id: 'off', label: '关闭', days: 0 },
  { id: 'daily', label: '每日', days: 1 },
  { id: 'weekly', label: '每周', days: 7 },
  { id: 'monthly', label: '每月', days: 30 },
];

/** Is an automatic backup due? `now` in epoch ms. */
export function backupDue(settings, now = Date.now()) {
  const f = BACKUP_FREQS.find((x) => x.id === settings.backupFreq);
  if (!f || !f.days) return false;
  const last = settings.backupDest === 'gdrive' ? settings.lastGdriveBackupAt : settings.lastBackupAt;
  if (!last) return true;
  // A little slack so "daily" doesn't drift later every day.
  return now - last >= f.days * 86_400_000 - 2 * 3_600_000;
}

/**
 * Calendar days since a backup made at `ts` (epoch ms), by the local date like dayLabel: last night 23:30 is
 * 1 (昨天) this evening, not 0 elapsed 24-hour blocks. Null when there is none. (backupDue stays on elapsed time.)
 */
export function backupAgeDays(ts, now = Date.now()) {
  if (!ts) return null;
  return Math.max(0, daysBetween(toISODate(new Date(ts)), toISODate(new Date(now))));
}

/** "今天" / "昨天" / "3 天前" for a backup made at `ts`; "还没有备份过" when there is none. */
export function backupAgeText(ts, now = Date.now()) {
  const d = backupAgeDays(ts, now);
  return d === null ? '还没有备份过' : d === 0 ? '今天' : d === 1 ? '昨天' : `${d} 天前`;
}

const dayNum = (v, d) => (Number.isInteger(v) && v >= 1 && v <= 31 ? v : d);

function sanitizePayCycle(c) {
  const from = dayNum(c?.from, 15);
  const to = Math.max(from, dayNum(c?.to, 20));
  return { enabled: c?.enabled === true, from, to };
}

const cents = (v) => (Number.isSafeInteger(v) && v >= 0 ? Math.min(v, MAX_CENTS) : 0);
const text = (v, max, fallback = '') => (typeof v === 'string' ? v.trim().slice(0, max) : fallback);

/** Whitelist + type-check settings (used on load and on backup import). */
export function sanitizeSettings(raw = {}) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    expectedIncome: cents(s.expectedIncome),
    savingsTarget: cents(s.savingsTarget),
    currentSavings: cents(s.currentSavings),
    currentSavingsAt: isValidISODate(s.currentSavingsAt) ? s.currentSavingsAt : '',
    currentSavingsTs: Number.isFinite(s.currentSavingsTs) && s.currentSavingsTs > 0 ? s.currentSavingsTs : 0,
    goalName: text(s.goalName, 20, DEFAULT_SETTINGS.goalName) || DEFAULT_SETTINGS.goalName,
    goalAmount: cents(s.goalAmount),
    profile: normalizeProfile(s.profile),
    onboarded: s.onboarded === true,
    startDate: isValidISODate(s.startDate) ? s.startDate : '',
    lastBackupAt: Number.isFinite(s.lastBackupAt) && s.lastBackupAt > 0 ? s.lastBackupAt : 0,
    backupFreq: BACKUP_FREQS.some((f) => f.id === s.backupFreq) ? s.backupFreq : DEFAULT_SETTINGS.backupFreq,
    backupDest: s.backupDest === 'gdrive' ? 'gdrive' : 'icloud',
    gdriveConnected: s.gdriveConnected === true,
    lastGdriveBackupAt: Number.isFinite(s.lastGdriveBackupAt) && s.lastGdriveBackupAt > 0 ? s.lastGdriveBackupAt : 0,
    invest: sanitizeInvest(s.invest),
    payCycle: sanitizePayCycle(s.payCycle),
    budgetIncludesBusiness: s.budgetIncludesBusiness === true,
    healthIgnored: Array.isArray(s.healthIgnored)
      ? [...new Set(s.healthIgnored.filter((x) => typeof x === 'string' && x.length <= 200))].slice(-300)
      : [],
  };
}
