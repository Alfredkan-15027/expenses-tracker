// Realistic sample data for demo mode (?demo=1). Never written to the real database.
import { DEFAULT_CATEGORIES } from '../core/categories.js';
import { DEFAULT_SETTINGS } from '../core/settings.js';
import { addMonths, dateInMonth, daysInMonth, monthOf, dayOf } from '../core/dates.js';

// Small deterministic PRNG so the demo looks the same every time.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const DAILY = [
  // [categoryId, note, minRM, maxRM, chancePerDay]
  ['food', '早餐 · 咖啡', 6, 12, 0.7],
  ['food', '午餐', 9, 16, 0.9],
  ['food', '晚餐', 10, 22, 0.75],
  ['food', 'GrabFood', 22, 45, 0.1],
  ['transport', 'Grab', 9, 24, 0.22],
  ['groceries', '超市', 25, 90, 0.1],
  ['social', '朋友聚餐', 40, 120, 0.06],
  ['shopping', 'Shopee', 20, 120, 0.035],
  ['business', 'Meta 广告', 50, 150, 0.08],
  ['learning', '书', 30, 80, 0.02],
];

export function buildDemoData(today) {
  const rand = rng(20260923);
  const cur = monthOf(today);
  const transactions = [];
  let n = 0;
  const add = (date, categoryId, rm, note = '', extra = {}) => {
    n += 1;
    transactions.push({
      id: `demo-${n}`, type: 'expense', amount: Math.round(rm * 100), categoryId, date, note,
      business: categoryId === 'business', createdAt: n, updatedAt: n, ...extra,
    });
  };

  for (let back = 5; back >= 0; back -= 1) {
    const ym = addMonths(cur, -back);
    const lastDay = back === 0 ? dayOf(today) : daysInMonth(ym);
    const fixed = (day, ...args) => { if (day <= lastDay) add(dateInMonth(ym, day), ...args); };
    fixed(1, 'housing', 750, '房租', { recurringId: 'demo-rent' });
    fixed(3, 'utilities', 58, '手机月费', { recurringId: 'demo-phone' });
    fixed(3, 'transport', 50, 'My50 地铁卡');
    fixed(5, 'subscriptions', 17.9, 'Spotify');
    fixed(8, 'subscriptions', 84, 'ChatGPT Plus');
    fixed(10, 'family', 300, '给爸妈');
    fixed(15, 'utilities', 45, '电费分摊');
    fixed(20, 'business', 120, 'Canva / 工具订阅', { business: true });
    transactions.push({
      id: `demo-inc-${back}`, type: 'income', amount: 350000, categoryId: 'salary', date: dateInMonth(ym, 1),
      note: '固定收入', business: false, createdAt: 0, updatedAt: 0,
    });
    if (back % 2 === 0) {
      transactions.push({
        id: `demo-inc2-${back}`, type: 'income', amount: Math.round((600 + rand() * 900) * 100), categoryId: 'freelance',
        date: dateInMonth(ym, 18), note: '设计项目', business: false, createdAt: 0, updatedAt: 0,
      });
    }
    // Spending drifts a little month to month so the comparison has something to say.
    const mood = 0.72 + rand() * 0.22;
    for (let d = 1; d <= lastDay; d += 1) {
      const date = dateInMonth(ym, d);
      for (const [cat, note, lo, hi, p] of DAILY) {
        if (rand() < p * mood) add(date, cat, Math.round((lo + rand() * (hi - lo)) * 10) / 10, note);
      }
    }
  }

  return {
    transactions,
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    recurring: [
      { id: 'demo-rent', type: 'expense', amount: 75000, categoryId: 'housing', note: '房租', day: 1, business: false, active: true, startMonth: addMonths(cur, -5), lastMonth: cur },
      { id: 'demo-phone', type: 'expense', amount: 5800, categoryId: 'utilities', note: '手机月费', day: 3, business: false, active: true, startMonth: addMonths(cur, -5), lastMonth: cur },
      { id: 'demo-netflix', type: 'expense', amount: 5500, categoryId: 'subscriptions', note: 'Netflix', day: 28, business: false, active: true, startMonth: cur, lastMonth: null },
    ],
    settings: {
      ...DEFAULT_SETTINGS,
      expectedIncome: 400000,
      savingsTarget: 80000,
      currentSavings: 1250000,
      goalName: '应急金',
      goalAmount: 1800000,
      profile: { housing: 'room', transport: 'public' },
      onboarded: true,
    },
  };
}
