// All amounts are stored as integer cents (sen) to avoid floating point drift.

export const CURRENCY = 'RM';
export const MAX_CENTS = 99_999_999_99; // RM 99,999,999.99

const groupFmt = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 0 });

/** Parse user text like "12", "12.5", "1,234.50" into cents. Returns null if invalid. */
export function toCents(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return clampCents(Math.round(input * 100));
  }
  if (typeof input !== 'string') return null;
  const s = input.replace(/[,\s]/g, '').replace(/^RM/i, '');
  if (!/^\d*(\.\d{0,2})?$/.test(s) || s === '' || s === '.') return null;
  const [int, dec = ''] = s.split('.');
  const cents = Number(int || '0') * 100 + Number((dec + '00').slice(0, 2));
  return clampCents(cents);
}

function clampCents(c) {
  if (!Number.isSafeInteger(c) || c < 0) return null;
  return Math.min(c, MAX_CENTS);
}

/** Split cents into display parts: { sign, int: "1,234", dec: "50" }. */
export function moneyParts(cents) {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const int = Math.floor(abs / 100);
  const dec = String(abs % 100).padStart(2, '0');
  return { sign: neg ? '−' : '', int: groupFmt.format(int), dec };
}

/**
 * Format cents as "RM 1,234.50".
 * opts.sign: prefix "+" for positive values. opts.round: whole ringgit (rounded, not cut off).
 */
export function formatMoney(cents, opts = {}) {
  const value = cents ?? 0;
  const plus = opts.sign && value > 0 ? '+' : '';
  if (opts.round) {
    // Whole ringgit, rounded to the nearest (RM 5,429.97 → RM 5,430); never "−RM 0".
    const rm = Math.round(Math.abs(value) / 100);
    return `${value < 0 && rm > 0 ? '−' : plus}${CURRENCY} ${groupFmt.format(rm)}`;
  }
  const { sign, int, dec } = moneyParts(value);
  return `${sign || plus}${CURRENCY} ${int}.${dec}`;
}

/** Compact form for charts: RM 1.2k, RM 850. */
export function formatCompact(cents) {
  const rm = Math.abs(cents) / 100;
  const sign = cents < 0 ? '−' : '';
  if (rm >= 10000) return `${sign}${Math.round(rm / 1000)}k`;
  if (rm >= 1000) return `${sign}${(rm / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${sign}${Math.round(rm)}`;
}

/** Cents → plain editable string ("12.5" stays "12.50"; whole numbers drop decimals). */
export function centsToInput(cents) {
  if (!cents) return '';
  const int = Math.floor(cents / 100);
  const dec = cents % 100;
  return dec ? `${int}.${String(dec).padStart(2, '0')}` : String(int);
}

export function percent(part, whole) {
  if (!whole) return 0;
  return part / whole;
}

export function formatPercent(ratio, digits = 0) {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}
