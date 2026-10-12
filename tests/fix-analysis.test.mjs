// Regression tests for the 分析 screen: the monthly model, the savings projection, period comparisons, the trend chart
// and what the screen shows next to each verdict.
import test from 'node:test';
import assert from 'node:assert/strict';

// The screen module touches `document` only when it is used (overlays, haptics); a bare stub is enough to render it.
globalThis.document ??= { addEventListener() {}, getElementById() { return null; }, documentElement: { classList: { toggle() {} } } };

const { addDays } = await import('../src/core/dates.js');
const { periodFor, prevPeriod } = await import('../src/core/periods.js');
const { DEFAULT_CATEGORIES } = await import('../src/core/categories.js');
const { sanitizeSettings } = await import('../src/core/settings.js');
const {
  spendingModel, runway, buildInsights, evaluatePeriod, evaluateMonth, comparePeriods, compareMonths,
} = await import('../src/core/analysis.js');
const { trendChart, divergeList } = await import('../src/ui/charts.js');
const { default: screen } = await import('../src/ui/screens/insights.js');

let n = 0;
const tx = (date, amount, categoryId = 'food', extra = {}) => ({
  id: `f${++n}`, type: 'expense', amount, categoryId, date, note: '', business: false, createdAt: n, updatedAt: n, ...extra,
});
const inc = (date, amount, categoryId = 'salary', extra = {}) => tx(date, amount, categoryId, { type: 'income', ...extra });
const RM = (x) => Math.round(x * 100);
/** The same amount every day from `from` to `to` (inclusive). */
const daily = (from, to, amount, categoryId = 'food') => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(tx(d, amount, categoryId));
  return out;
};
const savingsInsight = (list) => list.find((i) => i.icon === 'savings');
const text = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Render the 分析 screen on `today`, showing the period with `key` (default: the running one). */
function render({ txs, settings = {}, recurring = [], categories = DEFAULT_CATEGORIES, investFlows = [] }, today, key = '') {
  const state = { transactions: txs, categories, settings: sanitizeSettings(settings), recurring, investFlows };
  screen.render({ state, today }); // settles the view mode
  const to = key || periodFor(today, { txs, settings: state.settings, today }).key;
  screen.onClick({ target: { closest: (sel) => (sel === '[data-period]' ? { dataset: { period: to }, disabled: false } : null) } }, { rerender() {} });
  return String(screen.render({ state, today }));
}

// ── The monthly model ────────────────────────────────────────────────────────────────────────────────────────────

test('rent paid by hand: a small 住房 fee early in the month does not replace last month\'s rent', () => {
  const txs = [tx('2026-09-28', RM(900), 'housing'), tx('2026-10-03', RM(30), 'housing'), ...daily('2026-09-01', '2026-10-10', RM(30))];
  const m = spendingModel({ txs, recurring: [], today: '2026-10-10', since: '2026-09-01' });
  assert.equal(m.fixedPersonal, RM(900));
  assert.equal(m.byCategory.get('housing'), RM(900));
  assert.equal(m.personalMonthly, RM(1800));
  const rw = runway({ txs, currentSavings: RM(10000), today: '2026-10-10', since: '2026-09-01' });
  assert.equal(rw.months, RM(10000) / RM(1800));
  // A rent that changed is followed as soon as the new one is paid
  const cheaper = [tx('2026-08-28', RM(900), 'housing'), tx('2026-09-28', RM(700), 'housing'), ...daily('2026-08-01', '2026-09-30', RM(30))];
  assert.equal(spendingModel({ txs: cheaper, today: '2026-09-30', since: '2026-08-01' }).fixedPersonal, RM(700));
  // … and last month's deposit does not stay in the rent once this month's rent is paid
  const movedIn = [tx('2026-09-01', RM(1800), 'housing'), tx('2026-09-01', RM(900), 'housing'), tx('2026-10-01', RM(900), 'housing'), ...daily('2026-09-01', '2026-10-10', RM(30))];
  assert.equal(spendingModel({ txs: movedIn, today: '2026-10-10', since: '2026-09-01' }).fixedPersonal, RM(900));
});

test('a monthly bill typed in by hand is not multiplied in the first weeks (insurance, money for parents)', () => {
  const txs = [
    tx('2026-10-01', RM(800), 'housing'), tx('2026-10-03', RM(250), 'health'), tx('2026-10-05', RM(500), 'family'),
    ...daily('2026-10-01', '2026-10-20', RM(30)),
  ];
  const day10 = spendingModel({ txs, today: '2026-10-10', since: '2026-10-01' });
  assert.equal(day10.byCategory.get('health'), RM(250));
  assert.equal(day10.byCategory.get('family'), RM(500));
  assert.equal(day10.byCategory.get('food'), RM(900));
  assert.equal(day10.personalMonthly, RM(800) + RM(250) + RM(500) + RM(900));
  const day20 = spendingModel({ txs, today: '2026-10-20', since: '2026-10-01' });
  assert.equal(day20.byCategory.get('health'), RM(250));
  assert.equal(day20.personalMonthly, RM(2450));
  const rw = runway({ txs, currentSavings: RM(15000), today: '2026-10-10', since: '2026-10-01' });
  assert.equal(rw.avg, RM(2450));
});

test('a hand-typed entry stands for a fixed item at most once a month, and only when the item made none', () => {
  const my50 = { id: 'my50', type: 'expense', amount: RM(50), categoryId: 'transport', day: 1, active: true, startMonth: '2026-09', lastMonth: '2026-10' };
  const base = [
    tx('2026-09-01', RM(50), 'transport', { recurringId: 'my50' }), tx('2026-10-01', RM(50), 'transport', { recurringId: 'my50' }),
    ...daily('2026-09-11', '2026-10-10', RM(30)),
  ];
  const reloads = [tx('2026-09-15', RM(50), 'transport'), tx('2026-09-25', RM(50), 'transport'), tx('2026-10-03', RM(50), 'transport'), tx('2026-10-08', RM(50), 'transport')];
  const m = spendingModel({ txs: [...base, ...reloads], recurring: [my50], today: '2026-10-10', since: '2026-09-11' });
  assert.equal(m.byCategory.get('transport'), RM(50) + RM(200)); // the pass + RM 200 of reloads in 30 days
  assert.equal(m.personalMonthly, RM(1150));
  // The item was added with this month's payment already typed in by hand: that one entry is the item
  const added = { ...my50, startMonth: '2026-10', lastMonth: '2026-10' };
  const once = spendingModel({ txs: [tx('2026-10-01', RM(50), 'transport'), ...daily('2026-09-11', '2026-10-10', RM(30))], recurring: [added], today: '2026-10-10', since: '2026-09-11' });
  assert.equal(once.byCategory.get('transport'), RM(50));
  // … but a second one that month is spending
  const twice = spendingModel({ txs: [tx('2026-10-01', RM(50), 'transport'), tx('2026-10-06', RM(50), 'transport'), ...daily('2026-09-11', '2026-10-10', RM(30))], recurring: [added], today: '2026-10-10', since: '2026-09-11' });
  assert.equal(twice.byCategory.get('transport'), RM(100));
});

// ── The savings projection ───────────────────────────────────────────────────────────────────────────────────────

test('the projection counts a fixed salary still to come this month', () => {
  const recurring = [
    { id: 'sal', type: 'income', amount: RM(5000), categoryId: 'salary', day: 25, active: true, startMonth: '2026-09', lastMonth: '2026-09' },
    { id: 'rent', type: 'expense', amount: RM(900), categoryId: 'housing', day: 28, active: true, startMonth: '2026-09', lastMonth: '2026-09' },
  ];
  const txs = [
    inc('2026-09-25', RM(5000), 'salary', { recurringId: 'sal' }), tx('2026-09-28', RM(900), 'housing', { recurringId: 'rent' }),
    inc('2026-10-05', RM(300), 'freelance'), ...daily('2026-09-01', '2026-10-10', RM(40)),
  ];
  const settings = { startDate: '2026-09-01', savingsTarget: RM(1000) };
  const s = savingsInsight(buildInsights({ txs, ym: '2026-10', categories: DEFAULT_CATEGORIES, profile: {}, settings, today: '2026-10-10', recurring }));
  // 300 + 5,000 to come − 400 spent − 900 rent to come − 21 days × 40
  assert.match(s.body, /预计结余 RM 3,160/);
  assert.match(s.body, /固定收入 RM 5,000/);
  assert.match(s.body, /储蓄率约 60%/);
  assert.equal(s.tone, 'good');
  // Nothing recorded yet this month, but the salary is a fixed item: still a projection, not "还没记录本月收入"
  const early = buildInsights({ txs: txs.filter((t) => t.categoryId !== 'freelance'), ym: '2026-10', categories: DEFAULT_CATEGORIES, profile: {}, settings, today: '2026-10-10', recurring });
  assert.match(savingsInsight(early).body, /预计结余 RM 2,860/);
});

test('under pay cycles, a fixed salary inside the pay window starts the next cycle: it is not this one\'s income', () => {
  const settings = { startDate: '2026-09-15', payCycle: { enabled: true, from: 15, to: 20 } };
  const recurring = [{ id: 'sal', type: 'income', amount: RM(5000), categoryId: 'salary', day: 15, active: true, startMonth: '2026-09', lastMonth: '2026-09' }];
  const txs = [inc('2026-09-15', RM(5000), 'salary', { recurringId: 'sal' }), ...daily('2026-09-15', '2026-10-10', RM(40))];
  const p = periodFor('2026-10-10', { txs, settings: sanitizeSettings(settings), today: '2026-10-10' });
  assert.equal(p.end, '2026-10-19');
  const s = savingsInsight(buildInsights({ txs, period: p, categories: DEFAULT_CATEGORIES, profile: {}, settings: sanitizeSettings(settings), today: '2026-10-10', recurring }));
  assert.match(s.body, /预计结余 RM 3,600/); // 5,000 − 26 days × 40 − 9 days × 40
  assert.doesNotMatch(s.body, /固定收入/);
});

test('the projection sets aside rent paid by hand that is still to come, but not once it is paid', () => {
  const settings = { startDate: '2026-09-01', savingsTarget: RM(3500) };
  const common = [inc('2026-10-01', RM(5000)), ...daily('2026-09-01', '2026-10-10', RM(30))];
  const before = buildInsights({ txs: [tx('2026-09-28', RM(900), 'housing'), ...common], ym: '2026-10', categories: DEFAULT_CATEGORIES, profile: {}, settings, today: '2026-10-10' });
  assert.match(savingsInsight(before).body, /预计结余 RM 3,170/); // 5,000 − 300 − 21 × 30 − 900 rent on the 28th
  assert.match(savingsInsight(before).body, /还差 RM 330/);
  const paid = buildInsights({ txs: [tx('2026-09-01', RM(900), 'housing'), tx('2026-10-01', RM(900), 'housing'), ...common], ym: '2026-10', categories: DEFAULT_CATEGORIES, profile: {}, settings, today: '2026-10-10' });
  assert.match(savingsInsight(paid).body, /预计结余 RM 3,170/); // already in this month's spending: not again
});

// ── Finished and partly tracked periods ──────────────────────────────────────────────────────────────────────────

test('a finished pay cycle shows the 30-day figure its category badge was judged on', () => {
  const settings = sanitizeSettings({ startDate: '2026-01-01', payCycle: { enabled: true, from: 15, to: 20 } });
  const txs = [inc('2026-01-20', RM(5000)), tx('2026-01-25', RM(800)), inc('2026-02-15', RM(5000)), tx('2026-02-20', RM(100))];
  const p = periodFor('2026-01-25', { txs, settings, today: '2026-03-20' });
  assert.equal(p.days, 26);
  const ev = evaluatePeriod({ txs, period: p, categories: DEFAULT_CATEGORIES, profile: {}, today: '2026-03-20', startDate: '2026-01-01' });
  const food = ev.rows.find((r) => r.categoryId === 'food');
  assert.equal(food.status, 'high');
  assert.equal(food.per30, Math.round(RM(800) * 30 / 26));
  const ins = buildInsights({ txs, period: p, categories: DEFAULT_CATEGORIES, profile: {}, settings, today: '2026-03-20' });
  const flag = ins.find((i) => i.icon === 'food');
  assert.match(flag.title, /餐饮 RM 923／30 天/);
  assert.match(flag.body, /按 30 天换算/);
  const page = text(render({ txs, settings }, '2026-03-20', '2026-01-20'));
  assert.match(page, /按 30 天约 RM 923/);
});

test('a finished first month: catch-up entries from before the start date count once, not extrapolated', () => {
  const txs = [tx('2026-09-04', RM(600), 'health'), tx('2026-09-04', RM(300), 'shopping'), ...daily('2026-09-21', '2026-09-30', RM(40))];
  const ev = evaluateMonth({ txs, ym: '2026-09', categories: DEFAULT_CATEGORIES, profile: {}, today: '2026-10-05', startDate: '2026-09-21' });
  assert.equal(ev.isPartial, true);
  assert.equal(ev.projected, RM(600) + RM(300) + RM(400) * 3);
  assert.equal(ev.tier, 'ok');
  assert.equal(ev.rows.find((r) => r.categoryId === 'shopping').status, 'ok'); // RM 300 once, not "速度偏快"
});

test('a period that ended before tracking started is not judged', () => {
  const settings = { startDate: '2026-09-23', expectedIncome: RM(5000) };
  const txs = [
    tx('2026-08-30', RM(28.3), 'subscriptions', { recurringId: 'r' }), inc('2026-08-25', RM(5000)),
    tx('2026-09-24', RM(30)), tx('2026-09-25', RM(30)),
  ];
  const ev = evaluateMonth({ txs, ym: '2026-08', categories: DEFAULT_CATEGORIES, profile: {}, today: '2026-10-05', startDate: '2026-09-23' });
  assert.equal(ev.untracked, true);
  assert.ok(ev.rows.every((r) => r.status === 'none'));
  const ins = buildInsights({ txs, ym: '2026-08', categories: DEFAULT_CATEGORIES, profile: {}, settings, today: '2026-10-05' });
  assert.equal(ins.length, 1);
  assert.equal(ins[0].tone, 'info');
  assert.match(ins[0].title, /开始记账之前/);
  const page = text(render({ txs, settings }, '2026-10-05', '2026-08'));
  assert.doesNotMatch(page, /精简|储蓄率 99%|生活费很精简|储蓄率健康/);
  assert.match(page, /储蓄率 —/);
});

// ── Comparisons ──────────────────────────────────────────────────────────────────────────────────────────────────

test('a running period longer than the previous one compares the same first days, without scaling the previous one', () => {
  const settings = sanitizeSettings({ startDate: '2026-01-01', payCycle: { enabled: true, from: 15, to: 20 } });
  const txs = [
    inc('2026-01-20', RM(5000)), tx('2026-01-21', RM(900), 'housing'), ...daily('2026-01-20', '2026-02-14', RM(30)),
    inc('2026-02-15', RM(5000)), tx('2026-02-16', RM(900), 'housing'), ...daily('2026-02-15', '2026-03-18', RM(30)),
  ];
  const ctx = { txs, settings, today: '2026-03-18' };
  const cur = periodFor('2026-03-18', ctx);
  const cmp = comparePeriods(txs, cur, prevPeriod(cur, ctx), DEFAULT_CATEGORIES, '2026-01-01', '2026-03-18');
  assert.equal(cmp.sameDays, 26);
  const housing = cmp.rows.find((r) => r.categoryId === 'housing');
  assert.equal(housing.previous, RM(900));
  assert.equal(housing.delta, 0);
  assert.equal(cmp.delta, 0);
  // Calendar months: March against a 28-day February
  const months = [tx('2026-02-01', RM(900), 'housing'), ...daily('2026-02-01', '2026-02-28', RM(30)), tx('2026-03-01', RM(900), 'housing'), ...daily('2026-03-01', '2026-03-30', RM(30))];
  const mar = compareMonths(months, '2026-03', DEFAULT_CATEGORIES, '2026-02-01', '2026-03-30');
  assert.equal(mar.sameDays, 28);
  assert.equal(mar.rows.find((r) => r.categoryId === 'housing').delta, 0);
});

test('a change under RM 0.50 is no change: no "−RM 0", no "−0%", and the insight says 持平', () => {
  const txs = [tx('2026-08-05', RM(500.40)), tx('2026-09-05', RM(500))];
  const settings = { startDate: '2026-08-01' };
  const ins = buildInsights({ txs, ym: '2026-09', categories: DEFAULT_CATEGORIES, profile: {}, settings, today: '2026-10-05' });
  const mom = ins.find((i) => i.title === '与上月相比');
  assert.match(mom.body, /总支出和上个月持平/);
  assert.doesNotMatch(mom.body, /−0%|-0%|少 RM 0/);
  const page = text(render({ txs, settings }, '2026-10-05', '2026-09'));
  assert.doesNotMatch(page, /−RM 0|-0%|餐饮 −0/);
  // Exactly the same on the first day of a running month
  const same = [tx('2026-09-01', RM(1500), 'housing'), tx('2026-10-01', RM(1500), 'housing')];
  const first = buildInsights({ txs: same, ym: '2026-10', categories: DEFAULT_CATEGORIES, profile: {}, settings, today: '2026-10-01' });
  assert.match(first.find((i) => i.title === '与上月相比').body, /前 1 天的总支出和上个月同期持平/);
  assert.doesNotMatch(String(divergeList([{ label: '交通', delta: -30, current: 0, previous: 30 }])), /−0/);
});

// ── Verdict texts ────────────────────────────────────────────────────────────────────────────────────────────────

test('the running period\'s needs / wants share uses the same monthly estimate as the verdict', () => {
  const recurring = [
    { id: 'rent', type: 'expense', amount: RM(900), categoryId: 'housing', day: 5, active: true, startMonth: '2026-09', lastMonth: '2026-09' },
    { id: 'nf', type: 'expense', amount: RM(55), categoryId: 'subscriptions', day: 1, active: true, startMonth: '2026-09', lastMonth: '2026-10' },
  ];
  const txs = [
    tx('2026-09-01', RM(55), 'subscriptions', { recurringId: 'nf' }), tx('2026-09-05', RM(900), 'housing', { recurringId: 'rent' }),
    tx('2026-10-01', RM(55), 'subscriptions', { recurringId: 'nf' }), ...daily('2026-09-01', '2026-10-02', RM(30)),
  ];
  const ins = buildInsights({ txs, ym: '2026-10', categories: DEFAULT_CATEGORIES, profile: {}, settings: { startDate: '2026-09-01' }, today: '2026-10-02', recurring });
  assert.ok(!ins.some((i) => i.title === '享受型开销占比偏高'), '3% of a month is not "too high"');
  // The other way round: a RM 40-a-day social habit after rent was paid
  const rent1 = [{ ...recurring[0], day: 1, lastMonth: '2026-10' }];
  const habit = [
    tx('2026-09-01', RM(900), 'housing', { recurringId: 'rent' }), tx('2026-10-01', RM(900), 'housing', { recurringId: 'rent' }),
    ...daily('2026-09-01', '2026-10-02', RM(30)), ...daily('2026-09-01', '2026-10-02', RM(40), 'social'),
  ];
  const b = buildInsights({ txs: habit, ym: '2026-10', categories: DEFAULT_CATEGORIES, profile: {}, settings: { startDate: '2026-09-01' }, today: '2026-10-02', recurring: rent1 });
  const w = b.find((i) => i.title === '享受型开销占比偏高');
  assert.ok(w, 'about 40% of a month goes to wants');
  assert.match(w.body, /按每月估算/);
});

test('the verdict does not claim every category is in range when the overrun is in one without a range', () => {
  const categories = [...DEFAULT_CATEGORIES, { id: 'c_car', type: 'expense', name: '车贷', icon: 'car', color: 'red', group: 'need', order: 99, archived: false }];
  const txs = [tx('2026-09-05', RM(1200), 'c_car'), tx('2026-09-01', RM(800), 'housing'), tx('2026-09-02', RM(800)), tx('2026-09-03', RM(250), 'transport')];
  const ins = buildInsights({ txs, ym: '2026-09', categories, profile: {}, settings: {}, today: '2026-10-05' });
  assert.equal(ins[0].title, '生活费偏高');
  assert.doesNotMatch(ins[0].body, /每个类别都还在参考区间内/);
  assert.match(ins[0].body, /车贷（RM 1,200）/);
});

// ── The screen ───────────────────────────────────────────────────────────────────────────────────────────────────

test('the 钱花在哪一类 card uses personal spending, like the insight (business is counted apart)', () => {
  const txs = [tx('2026-09-02', RM(1300)), tx('2026-09-03', RM(800), 'shopping'), tx('2026-09-04', RM(2000), 'business', { business: true })];
  const settings = { startDate: '2026-09-01' };
  const ins = buildInsights({ txs, ym: '2026-09', categories: DEFAULT_CATEGORIES, profile: {}, settings, today: '2026-10-05' });
  assert.match(ins.find((i) => i.title === '享受型开销占比偏高').body, /38%/);
  const html = render({ txs, settings }, '2026-10-05', '2026-09');
  const card = text(html.slice(html.indexOf('card--groups')));
  assert.match(card, /生活享受 38%/);
  assert.match(card, /必要开销 62%/);
  assert.match(card, /创业投入 RM 2,000 另计/);
  assert.doesNotMatch(card, /创业投入 49%/);
  // The category bar's legend is on the same base as the rows (购物 38% of personal spending)
  assert.match(text(html), /购物 38%/);
});

test('a category the running period flags is listed in 类别明细, even with nothing spent on it yet', () => {
  const txs = [tx('2026-09-10', RM(1200), 'shopping'), ...daily('2026-09-01', '2026-10-03', RM(20))];
  const html = render({ txs, settings: { startDate: '2026-09-01' } }, '2026-10-03');
  const list = text(html.slice(html.indexOf('类别明细'), html.indexOf('card--groups')));
  assert.match(list, /购物/);
  assert.match(list, /每月约 RM 1,091/);
});

test('the benchmark note and the runway parts add up to the total shown', () => {
  const recurring = [
    { id: 'rent', type: 'expense', amount: RM(800), categoryId: 'housing', day: 12, active: true, startMonth: '2026-09', lastMonth: '2026-09' },
    { id: 'ph', type: 'expense', amount: RM(49.5), categoryId: 'utilities', day: 12, active: true, startMonth: '2026-09', lastMonth: '2026-09' },
  ];
  const txs = [
    tx('2026-09-12', RM(800), 'housing', { recurringId: 'rent' }), tx('2026-09-12', RM(49.5), 'utilities', { recurringId: 'ph' }),
    tx('2026-09-20', RM(120.5)), inc('2026-09-15', RM(3000)),
  ];
  const page = text(render({ txs, settings: { startDate: '2026-09-11', currentSavings: RM(9000) }, recurring }, '2026-10-10'));
  assert.match(page, /RM 970/);
  assert.match(page, /个人固定项目 RM 850 \+ 日常开销 RM 120/);
  assert.match(page, /（固定项目 RM 850 \+ 日常开销 RM 120，/); // the runway card
  assert.doesNotMatch(page, /RM 121/);
});

test('runway shows the figure its verdict is judged on: 5.96 months is 5.9, short of 6', () => {
  const txs = daily('2026-09-11', '2026-10-10', RM(100)); // RM 3,000 a month
  const show = (savings) => {
    const html = render({ txs, settings: { startDate: '2026-09-11', currentSavings: savings } }, '2026-10-10');
    return { tone: html.match(/card--runway" data-tone="(\w+)"/)[1], page: text(html.slice(html.indexOf('个人 Runway'))) };
  };
  const short = show(RM(17890));
  assert.match(short.page, /5\.9 个月/);
  assert.equal(short.tone, 'warn');
  const full = show(RM(18000));
  assert.match(full.page, /6\.0 个月/);
  assert.match(full.page, /已达到 6 个月的安全线/);
  assert.equal(full.tone, 'good');
  assert.equal(show(RM(8890)).page.match(/([\d.]+) 个月/)[1], '2.9');
});

test('trend bars are each held against their own period\'s budget', () => {
  const rows = [
    { ym: '2026-08', label: '2026年8月', income: RM(6000), expense: RM(4500), personal: RM(4500), business: 0, budget: RM(5500) },
    { ym: '2026-09', label: '2026年9月', income: RM(3000), expense: RM(2600), personal: RM(2600), business: 0, budget: RM(2500) },
  ];
  const chart = String(trendChart(rows, { personalOnly: true }));
  assert.equal((chart.match(/is-over/g) || []).length, 1); // September only
  assert.doesNotMatch(chart, /trend__budget/);             // budgets differ: no single line
  // On the screen, without expected income: August is judged against August's income
  const txs = [inc('2026-08-01', RM(6000)), tx('2026-08-05', RM(4500)), inc('2026-09-01', RM(3000)), tx('2026-09-05', RM(2000))];
  const html = render({ txs, settings: { startDate: '2026-08-01', savingsTarget: RM(500) } }, '2026-09-20');
  assert.doesNotMatch(html, /is-over/);
  assert.doesNotMatch(html, /trend__budget/);
  // With expected income the line is the same for every period and is drawn
  const planned = render({ txs, settings: { startDate: '2026-08-01', savingsTarget: RM(500), expectedIncome: RM(4000) } }, '2026-09-20');
  assert.match(planned, /trend__budget/);
  assert.equal((planned.match(/trend__bar is-over/g) || []).length, 1); // August's RM 4,500 against RM 3,500
});
