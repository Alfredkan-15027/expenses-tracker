// Data check: finds records and settings that would make the analysis wrong (duplicates, missed or
// double-counted fixed items, odd dates and amounts, missing plan numbers). Pure — runs on the phone only.
import { addMonths, dateInMonth, dayLabel, dayOf, monthOf, monthLabel } from './dates.js';
import { categoryMap } from './categories.js';
import { isBusiness, isBusinessItem, trackingStart } from './analysis.js';
import { daysBetween, payCycle } from './periods.js';
import { firstWord, nearAmount as near, sameBill } from './recurring.js';
import { formatMoney } from './money.js';

const DAY_TOLERANCE = 3;            // a fixed item paid within ±2 days of its set day is fine
const DOUBLE_DAYS = 15;             // one fixed item charged twice this close together in a month: logged twice
const BIG_MULTIPLE = 5;             // an amount this many times the category's usual one is worth a look
const BIG_MIN = 20_000;             // … but only from RM 200 up
const HUGE = 2_000_000;             // any single entry of RM 20,000+ (a slipped extra 0?)
const RECONCILE_DAYS = 30;          // money on hand last checked this long ago → suggest checking it again

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

  // 2. A fixed item logged automatically AND typed in by hand in the same month — or left behind by a fixed item
  //    that was deleted (its entries stay) and then added again.
  const items = new Map(recurring.map((r) => [r.id, r]));
  const loose = txs.filter((t) => !t.recurringId || !items.has(t.recurringId)); // typed in, or its item is gone
  const lastOf = new Map(); // deleted item → its newest entry
  for (const t of loose) {
    if (t.recurringId && !(lastOf.get(t.recurringId)?.date >= t.date)) lastOf.set(t.recurringId, t);
  }
  const claimed = new Set(); // entries already reported as the double of a fixed item's charge
  for (const t of txs.filter((x) => x.recurringId)) {
    // An entry within the tolerance of the item's day in the month before or after is that month's charge (rent for
    // the 1st paid on 30 Sep), not this one's double.
    const day = items.get(t.recurringId)?.day ?? dayOf(t.date);
    const nextOrPrev = (d) => [-1, 1].some((k) => Math.abs(daysBetween(d, dateInMonth(addMonths(monthOf(t.date), k), day))) < DAY_TOLERANCE);
    // A deleted item's entry doubles only the first charge of an item added back that month (its own last charge):
    // items that ran side by side were separate bills.
    const readded = (u) => lastOf.get(u.recurringId) === u && items.get(t.recurringId)?.startMonth === monthOf(t.date);
    const m = loose.find((u) => monthOf(u.date) === monthOf(t.date) && sameBill(u, t) && !nextOrPrev(u.date)
      && (!u.recurringId || readded(u)));
    if (!m) continue;
    claimed.add(m.id);
    out.push({
      id: `fixdup:${t.id}:${m.id}`, level: 'warn', kind: 'fixed-double',
      title: `${t.note || catName(t.categoryId)} 可能记了两次`,
      body: `${monthLabel(monthOf(t.date), false)}已由固定项目自动记了 ${formatMoney(t.amount)}，同月又有一笔${m.recurringId ? '已删除的固定项目留下的' : '手动'}记录 ${formatMoney(m.amount)}。`,
      txIds: [t.id, m.id], fix: { type: 'delete', txId: m.id },
    });
  }
  // … or logged twice by the item itself (e.g. a charge logged while its editor was open, then saved over).
  const byItem = new Map();
  for (const t of txs) {
    if (!t.recurringId) continue;
    const k = `${t.recurringId}|${monthOf(t.date)}`;
    if (!byItem.has(k)) byItem.set(k, []);
    byItem.get(k).push(t);
  }
  for (const g of byItem.values()) {
    g.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < g.length; i += 1) {
      const a = g[i - 1];
      const b = g[i];
      // Two charges a month apart can share a month (one posted a day late): only close ones are a double.
      if (daysBetween(a.date, b.date) >= DOUBLE_DAYS || !near(b.amount, a.amount)) continue;
      const extra = (b.createdAt || 0) >= (a.createdAt || 0) ? b : a;
      out.push({
        id: `fixdup:${a.id}:${b.id}`, level: 'warn', kind: 'fixed-double',
        title: `${a.note || catName(a.categoryId)} 可能记了两次`,
        body: `${monthLabel(monthOf(a.date), false)}这个固定项目自动记了两笔：${dayLabel(a.date, today)} ${formatMoney(a.amount)}、${dayLabel(b.date, today)} ${formatMoney(b.amount)}。如果实际只有一笔，删掉多出来的。`,
        txIds: [a.id, b.id], fix: { type: 'delete', txId: extra.id },
      });
    }
  }

  // 3. Entries dated in the future. Those inside the running period already count in 今天 and the analysis;
  // with pay cycles, a future-dated income starts no cycle before its day.
  const future = txs.filter((t) => t.date > today);
  if (future.length) {
    const cycle = !!payCycle(settings);
    out.push({
      id: `future:${future.map((t) => t.id).sort().join(',')}`, level: 'warn', kind: 'future',
      title: `${future.length} 笔记录的日期在未来`,
      body: cycle
        ? '可能选错了日期。日期还在本期内的，现在就已算进「今天」和本期分析；更晚的要到那一期才算。未来日期的薪水／创业收入也要到那天才会开始新的一期。'
        : '可能选错了日期。日期还在本月内的，现在就已算进「今天」和本月分析；更晚的要到那个月才算。',
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
    const word = firstWord(r.note);
    // This month's charge is recorded when an entry falls in this month, or within the tolerance of the set day just
    // across the month edge (rent for the 1st paid on 30 Sep). An entry not made by the item must be this bill: not
    // already another fixed charge's double, and not named after another fixed item.
    const forThisMonth = (d) => monthOf(d) === cur || Math.abs(daysBetween(d, due)) < DAY_TOLERANCE;
    const otherWords = new Set(recurring.filter((x) => x.id !== r.id && x.active).map((x) => firstWord(x.note)).filter((w) => w && w !== word));
    const logged = own.some((t) => forThisMonth(t.date))
      || loose.some((u) => forThisMonth(u.date) && sameBill(u, r) && !claimed.has(u.id) && !otherWords.has(firstWord(u.note)));
    if (due <= today && (!r.startMonth || r.startMonth <= cur) && !logged) {
      out.push({
        id: `missing:${r.id}:${cur}`, level: 'info', kind: 'fixed-missing',
        title: `本月没有「${name}」的记录`,
        body: `固定项目设在每月 ${r.day} 号（${formatMoney(r.amount)}），这个月还没有记录。如果已经付了，补记一笔；如果这个月不用付，可以忽略。`,
        txIds: [], fix: { type: 'add-fixed', recurringId: r.id, date: due },
      });
    }
    // Marked as done for this month, but nothing was recorded this month (e.g. last month's charge was
    // linked to it): this month's charge would never be logged or reserved.
    if (due > today && r.lastMonth && r.lastMonth >= cur && (!r.startMonth || r.startMonth <= cur) && !logged) {
      out.push({
        id: `skipped:${r.id}:${cur}`, level: 'info', kind: 'fixed-skipped',
        title: `「${name}」${dayLabel(due, today)}不会自动记账`,
        body: `这个固定项目被标记为本月已记过，但本月没有它的记录${own.length ? `（最近一笔在${dayLabel(own.map((t) => t.date).sort().pop(), today)}）` : ''}，所以到时不会自动记上，「今天还能花」也不会预留这 ${formatMoney(r.amount)}。如果这个月照常扣款，点一下恢复。`,
        txIds: [], fix: { type: 'unskip', recurringId: r.id },
      });
    }
    const last = own.sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    // A newer hand-typed entry that looks like the same service at another amount: the plan or price changed, but
    // the fixed item still logs (and reserves, and counts toward runway) the old amount. Not from a future date
    // (likely a typo, flagged above): it would mark a month that hasn't come.
    if (word && r.type === 'expense') {
      const after = last ? last.date : `${r.startMonth || cur}-01`;
      const others = recurring.filter((x) => x.id !== r.id && x.active);
      const changed = manual
        .filter((u) => u.type === r.type && u.categoryId === r.categoryId && isBusiness(u) === isBusinessItem(r)
          && u.date > after && u.date <= today && firstWord(u.note) === word && !near(u.amount, r.amount)
          && !others.some((x) => x.categoryId === u.categoryId && near(u.amount, x.amount)))
        .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      if (changed) {
        out.push({
          id: `fixchg:${r.id}:${changed.id}`, level: 'info', kind: 'fixed-changed',
          title: `「${name}」可能已经改成「${changed.note}」`,
          body: `固定项目还是每月 ${formatMoney(r.amount)}（${r.day} 号），但${dayLabel(changed.date, today)}你另外记了「${changed.note}」${formatMoney(changed.amount)}。如果是升级或涨价，把固定项目改成新的金额，每月才会自动记对，Runway 也才会准；如果是另外一笔，可以忽略。`,
          txIds: [changed.id],
          fix: { type: 'update-fixed', recurringId: r.id, amount: changed.amount, note: changed.note, date: changed.date },
        });
      }
    }
    // The newest charge since the day was last set (a day just changed has no charge on it yet), measured to the
    // nearest month's set day: a charge for the 1st paid on 30 Sep is a day early, not 29 days off.
    const ref = own.find((t) => t.date <= today && (!r.daySince || t.date >= r.daySince));
    if (ref) {
      const gap = Math.min(...[-1, 0, 1].map((k) => Math.abs(daysBetween(ref.date, dateInMonth(addMonths(monthOf(ref.date), k), r.day)))));
      const realDay = dayOf(ref.date);
      if (gap >= DAY_TOLERANCE) {
        out.push({
          id: `day:${r.id}:${realDay}`, level: 'info', kind: 'fixed-day',
          title: `「${name}」的扣款日可能不是 ${r.day} 号`,
          body: `最近一笔记在${dayLabel(ref.date, today)}。把固定项目改成每月 ${realDay} 号，「今天还能花」才会在对的时间预留这笔钱。`,
          // `month`: under the new day that charge stands for its own month, so the fix must not log that month again
          txIds: [ref.id], fix: { type: 'set-day', recurringId: r.id, day: realDay, month: monthOf(ref.date) },
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
  if (!settings.currentSavings && !settings.currentSavingsAt) {
    out.push({
      id: 'plan:savings', level: 'info', kind: 'settings', title: '还没填手上有多少钱',
      body: '填一次，App 就会按之后的收入和支出帮你算着走：「今天还能花」不会超过你真正有的钱，下次对账也能发现漏记。Runway 也要靠它。',
      txIds: [], fix: { type: 'savings' },
    });
  } else if (settings.currentSavingsAt && daysBetween(settings.currentSavingsAt, today) >= RECONCILE_DAYS) {
    out.push({
      id: `plan:reconcile:${settings.currentSavingsAt}`, level: 'info', kind: 'settings',
      title: `已经 ${daysBetween(settings.currentSavingsAt, today)} 天没对账`,
      body: `上次是${dayLabel(settings.currentSavingsAt, today)}。看一下银行和电子钱包现在一共有多少，填进去就能知道这段时间有没有漏记。`,
      txIds: [], fix: { type: 'savings' },
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
