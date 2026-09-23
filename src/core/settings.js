import { DEFAULT_PROFILE, normalizeProfile } from './benchmarks.js';
import { MAX_CENTS } from './money.js';
import { isValidISODate } from './dates.js';

export const DEFAULT_SETTINGS = {
  expectedIncome: 0,   // cents / month — basis for the daily budget
  savingsTarget: 0,    // cents / month
  currentSavings: 0,   // cents — used for the long-term goal and personal runway
  goalName: '应急金',
  goalAmount: 0,       // cents — long-term savings goal
  profile: { ...DEFAULT_PROFILE },
  onboarded: false,
  startDate: '',       // first day of tracking (ISO) — the first month's budget is prorated from here
  lastBackupAt: 0,     // epoch ms
};

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
  };
}
