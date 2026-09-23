import { DEFAULT_PROFILE, normalizeProfile } from './benchmarks.js';
import { MAX_CENTS } from './money.js';
import { isValidISODate } from './dates.js';
import { DEFAULT_INVEST, sanitizeInvest } from './invest.js';

export const DEFAULT_SETTINGS = {
  expectedIncome: 0,   // cents / month — basis for the daily budget
  savingsTarget: 0,    // cents / month
  currentSavings: 0,   // cents — used for the long-term goal and personal runway
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

const cents = (v) => (Number.isSafeInteger(v) && v >= 0 ? Math.min(v, MAX_CENTS) : 0);
const text = (v, max, fallback = '') => (typeof v === 'string' ? v.trim().slice(0, max) : fallback);

/** Whitelist + type-check settings (used on load and on backup import). */
export function sanitizeSettings(raw = {}) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    expectedIncome: cents(s.expectedIncome),
    savingsTarget: cents(s.savingsTarget),
    currentSavings: cents(s.currentSavings),
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
  };
}
