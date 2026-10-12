// All amounts are stored as integer cents (sen) to avoid floating point drift.

export const CURRENCY = 'RM';
export const MAX_CENTS = 99_999_999_99; // RM 99,999,999.99

const groupFmt = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 0 });

/**
 * Commas in a typed number: thousands grouping ("1,234.50") is dropped, and a lone decimal comma ("12,50" — the
 * decimal keypad types one on iPhones set to such a region) becomes a point. Anything else is left as typed, so a
 * comma or space still inside ("12,3,4", "1 2") fails the caller's format check instead of being glued together.
 */
export function normalizeNumberText(text) {
  const s = String(text).trim();
  if (/^-?\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) return s.replace(/,/g, '');
  if (/^-?\d+,\d{1,2}$/.test(s)) return s.replace(',', '.');
  return s;
}

/** Parse user text like "12", "12.5", "1,234.50", "12,50" into cents. Returns null if invalid. */
export function toCents(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return clampCents(Math.round(input * 100));
  }
  if (typeof input !== 'string') return null;
  const s = normalizeNumberText(input.trim().replace(/^RM\s*/i, ''));
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
    // Whole ringgit, rounded to the nearest (RM 5,429.97 → RM 5,430); never "−RM 0" (or "+RM 0").
    const rm = Math.round(Math.abs(value) / 100);
    return `${rm === 0 ? '' : value < 0 ? '−' : plus}${CURRENCY} ${groupFmt.format(rm)}`;
  }
  const { sign, int, dec } = moneyParts(value);
  return `${sign || plus}${CURRENCY} ${int}.${dec}`;
}

// Cents rounded to whole ringgit the way formatMoney(…, { round: true }) shows them.
const wholeRinggit = (cents) => Math.sign(cents) * Math.round(Math.abs(cents) / 100) * 100;

/**
 * The rest of a total once one part is taken out, in whole ringgit, for lines that show a total and its parts
 * ("RM 1,535：个人 RM 1,234 + 创业 RM 301"). Rounding every part on its own misses the shown total about a quarter of
 * the time; here the total and the given part keep their usual rounding and the rest takes the difference (it moves
 * by less than RM 1). Returns cents in whole ringgit, for formatMoney(…, { round: true }).
 */
export function roundedRest(total, part) {
  return wholeRinggit(total) - wholeRinggit(part);
}

/**
 * Compact form for charts: 1.2k, 850. Rounded first, then the sign and the unit follow the rounded value
 * (RM 999.60 → "1k", never "1000"; 30 sen → "0", never "−0"). opts.sign: prefix "+" for positive values.
 */
export function formatCompact(cents, opts = {}) {
  const abs = Math.abs(cents);
  const rm = Math.round(abs / 100);
  if (rm === 0) return '0';
  const sign = cents < 0 ? '−' : opts.sign ? '+' : '';
  if (rm < 1000) return `${sign}${rm}`;
  const tenths = Math.round(abs / 10_000); // in 0.1k
  return tenths < 100 ? `${sign}${tenths / 10}k` : `${sign}${Math.round(abs / 100_000)}k`;
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

/**
 * "12%". Rounded first, so a tiny negative ratio shows "0%", never "-0%"; negatives use "−" like money.
 * opts.sign: prefix "+" for positive values.
 */
export function formatPercent(ratio, digits = 0, opts = {}) {
  if (!Number.isFinite(ratio)) return '—';
  const text = Math.abs(ratio * 100).toFixed(digits);
  if (Number(text) === 0) return `${text}%`;
  return `${ratio < 0 ? '−' : opts.sign ? '+' : ''}${text}%`;
}

/**
 * Whole percents for the parts of one whole (category shares…), rounded so they add up to 100: largest
 * remainder, each share moves by less than one point. Rounding each on its own gives 33 · 33 · 33 = 99.
 * A zero total gives all 0.
 */
export function sharePercents(values) {
  const total = values.reduce((a, v) => a + v, 0);
  if (!(total > 0)) return values.map(() => 0);
  const exact = values.map((v) => (v * 100) / total);
  const out = exact.map(Math.floor);
  let left = 100 - out.reduce((a, v) => a + v, 0);
  const order = exact.map((v, i) => i).sort((a, b) => (exact[b] - out[b]) - (exact[a] - out[a]) || values[b] - values[a] || a - b);
  for (const i of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}
