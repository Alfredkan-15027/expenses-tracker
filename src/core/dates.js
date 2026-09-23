// Dates are stored as local calendar strings: "YYYY-MM-DD"; months as "YYYY-MM".

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const pad = (n) => String(n).padStart(2, '0');

export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(now = new Date()) {
  return toISODate(now);
}

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
}

export function isValidISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseISO(s);
  return toISODate(d) === s;
}

export function isValidMonth(s) {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function monthOf(iso) {
  return iso.slice(0, 7);
}

export function dayOf(iso) {
  return Number(iso.slice(8, 10));
}

export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** Months from a to b inclusive (a <= b). */
export function monthRange(a, b) {
  const out = [];
  for (let m = a; m <= b && out.length < 600; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** Build an ISO date inside month ym, clamping the day (e.g. 31 → 30 in Sept). */
export function dateInMonth(ym, day) {
  const d = Math.min(Math.max(1, day), daysInMonth(ym));
  return `${ym}-${pad(d)}`;
}

export function monthLabel(ym, withYear = true) {
  const [y, m] = ym.split('-').map(Number);
  return withYear ? `${y}年${m}月` : `${m}月`;
}

export function weekday(iso) {
  return WEEKDAYS[parseISO(iso).getDay()];
}

/** "今天" / "昨天" / "9月21日" (+ year if not current year). */
export function dayLabel(iso, today = todayISO()) {
  if (iso === today) return '今天';
  if (iso === addDays(today, -1)) return '昨天';
  if (iso === addDays(today, 1)) return '明天';
  const [y, m, d] = iso.split('-').map(Number);
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return sameYear ? `${m}月${d}日` : `${y}年${m}月${d}日`;
}

export function longDateLabel(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}月${d}日 ${weekday(iso)}`;
}

export function timeGreeting(now = new Date()) {
  const h = now.getHours();
  if (h < 5) return '夜深了';
  if (h < 12) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}
