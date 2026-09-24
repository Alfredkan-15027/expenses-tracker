// Data check: finds records and settings that would make the analysis wrong (duplicates, missed or
// double-counted fixed items, odd dates and amounts, missing plan numbers). Pure — runs on the phone only.
import { dateInMonth, dayLabel, dayOf, monthOf, monthLabel } from './dates.js';
import { categoryMap } from './categories.js';
import { trackingStart } from './analysis.js';
import { formatMoney } from './money.js';

const DAY_TOLERANCE = 3;            // a fixed item paid within ±2 days of its set day is fine
const BIG_MULTIPLE = 5;             // an amount this many times the category's usual one is worth a look
const BIG_MIN = 20_000;             // … but only from RM 200 up
const HUGE = 2_000_000;             // any single entry of RM 20,000+ (a slipped extra 0?)

const near = (a, b) => Math.abs(a - b) <= Math.max(100, Math.round(b * 0.05));

function median(list) {
  const s = [...list].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Returns [{ id, level: 'warn'|'info', kind, title, body, txIds, fix? }], most important first.
 * `fix` describes a one-tap repair the UI can offer: { type, … }.
 * Findings whose id is in settings.healthIgnored are left out.
 */
export function checkData({ transactions: txs, categories, recurring = [], settings = {}, today }) {
  const out = [];
  const cats = categoryMap(categories);
  const catName = (id) => cats.get(id)?.name || '未分类';
  const cur = monthOf(today);
  const manual = txs.filter((t) => !t.recurringId);

  // 1. The same entry twice (same day, kind, category, amount and note).
  const groups = new Map();
  for (const t of manual) {
    const k = [t.date, t.type, t.categoryId, t.amount, (t.note || '').trim()].join('|');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const t = g[0];
    out.push({
      id: `dup:${g.map((x) => x.id).sort().join(',')}`, level: 'warn', kind: 'duplicate',
      title: `可能重复：${catName(t.categoryId)} ${formatMoney(t.amount)} × ${g.length}`,
      body: `${dayLabel(t.date, today)}有 ${g.length} 笔一模一样的记录${t.note ? `（${t.note}）` : ''}。如果只花了一次，删掉多出来的。`,
      txIds: g.map((x) => x.id), fix: { type: 'delete', txId: g[g.length - 1].id },
    });
  }

  // 2. A fixed item logged automatically AND typed in by hand in the same month.
  for (const t of txs.filter((x) => x.recurringId)) {
    const m = manual.find((u) => u.type === t.type && u.categoryId === t.categoryId
      && monthOf(u.date) === monthOf(t.date) && near(u.amount, t.amount));
    if (!m) continue;
    out.push({
      id: `fixdup:${t.id}:${m.id}`, level: 'warn', kind: 'fixed-double',
      title: `${t.note || catName(t.categoryId)} 可能记了两次`,
      body: `${monthLabel(monthOf(t.date), false)}已由固定项目自动记了 ${formatMoney(t.amount)}，同月又有一笔手动记录 ${formatMoney(m.amount)}。`,
      txIds: [t.id, m.id], fix: { type: 'delete', txId: m.id },
    });
  }

  // 3. Entries dated in the future.
  const future = txs.filter((t) => t.date > today);
  if (future.length) {
    out.push({
      id: `future:${future.map((t) => t.id).sort().join(',')}`, level: 'warn', kind: 'future',
      title: `${future.length} 笔记录的日期在未来`,
      body: '可能选错了日期。未来的记录会被算进那个月，现在不会出现在「今天」和本月分析里。',
      txIds: future.map((t) => t.id),
    });
  }

  // 4. Categories that don't fit the entry (e.g. an expense filed under an income type) or no longer exist.
  const misfiled = txs.filter((t) => { const c = cats.get(t.categoryId); return !c || c.type !== t.type; });
  if (misfiled.length) {
    out.push({
      id: `category:${misfiled.map((t) => t.id).sort().join(',')}`, level: 'warn', kind: 'category',
      title: `${misfiled.length} 笔记录的类别不对`,
      body: '类别不存在，或把支出放进了收入类别（反之亦然），分析时会显示为「未分类」。点一下重新选类别。',
      txIds: misfiled.map((t) => t.id),
    });
  }

  // 5. Fixed items: this month's entry missing, or the set day differs from the real charge day.
  for (const r of recurring) {
    if (!r.active) continue;
    const due = dateInMonth(cur, r.day);
    const own = txs.filter((t) => t.recurringId === r.id);
    const name = r.note || catName(r.categoryId);
    if (due <= today && (!r.startMonth || r.startMonth <= cur)) {
      const logged = own.some((t) => monthOf(t.date) === cur)
        || manual.some((u) => u.type === r.type && u.categoryId === r.categoryId && monthOf(u.date) === cur && near(u.amount, r.amount));
      if (!logged) {
        out.push({
          id: `missing:${r.id}:${cur}`, level: 'info', kind: 'fixed-missing',
          title: `本月没有「${name}」的记录`,
          body: `固定项目设在每月 ${r.day} 号（${formatMoney(r.amount)}），这个月还没有记录。如果已经付了，补记一笔；如果这个月不用付，可以忽略。`,
          txIds: [], fix: { type: 'add-fixed', recurringId: r.id, date: due },
        });
      }
    }
    // Marked as done for this month, but nothing was recorded this month (e.g. last month's charge was
    // linked to it): this month's charge would never be logged or reserved.
    if (due > today && r.lastMonth && r.lastMonth >= cur && (!r.startMonth || r.startMonth <= cur)) {
      const logged = own.some((t) => monthOf(t.date) === cur)
        || manual.some((u) => u.type === r.type && u.categoryId === r.categoryId && monthOf(u.date) === cur && near(u.amount, r.amount));
      if (!logged) {
        out.push({
          id: `skipped:${r.id}:${cur}`, level: 'info', kind: 'fixed-skipped',
          title: `「${name}」${dayLabel(due, today)}不会自动记账`,
          body: `这个固定项目被标记为本月已记过，但本月没有它的记录${own.length ? `（最近一笔在${dayLabel(own.map((t) => t.date).sort().pop(), today)}）` : ''}，所以到时不会自动记上，「今天还能花」也不会预留这 ${formatMoney(r.amount)}。如果这个月照常扣款，点一下恢复。`,
          txIds: [], fix: { type: 'unskip', recurringId: r.id },
        });
      }
    }
    const last = own.sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (last) {
      const expected = dateInMonth(monthOf(last.date), r.day);
      const realDay = dayOf(last.date);
      if (Math.abs(dayOf(expected) - realDay) >= DAY_TOLERANCE) {
        out.push({
          id: `day:${r.id}:${realDay}`, level: 'info', kind: 'fixed-day',
          title: `「${name}」的扣款日可能不是 ${r.day} 号`,
          body: `最近一笔记在${dayLabel(last.date, today)}。把固定项目改成每月 ${realDay} 号，「今天还能花」才会在对的时间预留这笔钱。`,
          txIds: [last.id], fix: { type: 'set-day', recurringId: r.id, day: realDay },
        });
      }
    }
  }

  // 6. Entries before tracking started (a month with only stray records).
  const start = trackingStart(settings, txs);
  if (start) {
    const early = txs.filter((t) => monthOf(t.date) < monthOf(start));
    if (early.length && early.length <= 5) {
      const months = [...new Set(early.map((t) => monthOf(t.date)))].sort();
      out.push({
        id: `early:${early.map((t) => t.id).sort().join(',')}`, level: 'info', kind: 'before-start',
        title: `${months.map((m) => monthLabel(m, false)).join('、')}只有 ${early.length} 笔记录`,
        body: `你从 ${monthLabel(monthOf(start), false)}开始完整记账，之前的月份不会用来算 Runway 和月份比较。如果是日期记错了，点一下修改。`,
        txIds: early.map((t) => t.id),
      });
    }
  }

  // 7. Amounts far above what is usual for the category (a slipped extra 0?).
  const byCat = new Map();
  for (const t of manual) {
    if (t.type !== 'expense') continue;
    if (!byCat.has(t.categoryId)) byCat.set(t.categoryId, []);
    byCat.get(t.categoryId).push(t);
  }
  const big = [];
  for (const list of byCat.values()) {
    for (const t of list) {
      const others = list.filter((x) => x !== t).map((x) => x.amount);
      const usual = others.length >= 5 ? median(others) : 0;
      if (t.amount >= HUGE || (usual && t.amount >= BIG_MIN && t.amount > usual * BIG_MULTIPLE)) big.push(t);
    }
  }
  for (const t of big) {
    out.push({
      id: `big:${t.id}:${t.amount}`, level: 'info', kind: 'big',
      title: `金额比平常大很多：${catName(t.categoryId)} ${formatMoney(t.amount)}`,
      body: `${dayLabel(t.date, today)}${t.note ? `「${t.note}」` : ''}。如果金额没错可以忽略；多输了一个 0 就点一下修改。`,
      txIds: [t.id],
    });
  }

  // 8. Plan numbers the analysis depends on.
  if (!settings.expectedIncome) {
    out.push({
      id: 'plan:income', level: 'info', kind: 'settings', title: '还没设定预计每月收入',
      body: '「今天还能花」目前只按已记录的收入计算，月初会显示偏少。', txIds: [], fix: { type: 'plan' },
    });
  } else if (settings.savingsTarget >= settings.expectedIncome) {
    out.push({
      id: 'plan:target', level: 'warn', kind: 'settings', title: '存款目标不低于收入',
      body: `存款目标 ${formatMoney(settings.savingsTarget, { round: true })} 不低于预计收入 ${formatMoney(settings.expectedIncome, { round: true })}，每天能花的会是 0。`,
      txIds: [], fix: { type: 'plan' },
    });
  }
  if (!settings.currentSavings) {
    out.push({
      id: 'plan:savings', level: 'info', kind: 'settings', title: '还没填目前存款',
      body: '填了才能算出 Runway（不靠收入还能撑几个月）。', txIds: [], fix: { type: 'savings' },
    });
  }

  const ignored = new Set(settings.healthIgnored || []);
  const rank = { warn: 0, info: 1 };
  return out.filter((i) => !ignored.has(i.id)).sort((a, b) => rank[a.level] - rank[b.level]);
}

/** First and last record date, for the summary line. */
export function checkedRange(txs) {
  if (!txs.length) return null;
  const dates = txs.map((t) => t.date).sort();
  return { from: dates[0], to: dates[dates.length - 1] };
}
