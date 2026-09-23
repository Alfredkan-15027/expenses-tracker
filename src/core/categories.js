// Default categories tuned for daily life in Kuala Lumpur.
// `icon` is a symbol id in assets/icons/sprite.svg, `color` is a palette token name
// (styles map data-color="orange" → var(--c-orange)).
// `group` drives the needs / wants analysis: need | want | growth | business | other.

export const PALETTE = [
  'red', 'orange', 'yellow', 'green', 'mint', 'teal', 'cyan',
  'blue', 'indigo', 'purple', 'pink', 'brown', 'gray',
];

export const CATEGORY_ICONS = [
  'food', 'coffee', 'groceries', 'transport', 'car', 'housing', 'utilities', 'phone',
  'health', 'family', 'gift', 'shopping', 'social', 'subscriptions', 'learning',
  'business', 'travel', 'pet', 'sport', 'beauty', 'game', 'other',
  'salary', 'bizincome', 'freelance', 'otherincome',
];

export const GROUP_LABELS = {
  need: '必要开销',
  want: '生活享受',
  growth: '自我投资',
  business: '创业投入',
  other: '其他',
};

export const DEFAULT_CATEGORIES = [
  // Expenses
  { id: 'food', type: 'expense', name: '餐饮', hint: '三餐 · 外卖 · 饮料', icon: 'food', color: 'orange', group: 'need' },
  { id: 'groceries', type: 'expense', name: '日用杂货', hint: '超市 · 日用品 · 个人护理', icon: 'groceries', color: 'green', group: 'need' },
  { id: 'transport', type: 'expense', name: '交通', hint: 'Grab · LRT/MRT · 油费 · Toll · 停车', icon: 'transport', color: 'blue', group: 'need' },
  { id: 'housing', type: 'expense', name: '住房', hint: '房租 · 管理费', icon: 'housing', color: 'indigo', group: 'need' },
  { id: 'utilities', type: 'expense', name: '水电网络', hint: 'TNB · 水费 · Wi-Fi · 手机月费', icon: 'utilities', color: 'yellow', group: 'need' },
  { id: 'health', type: 'expense', name: '健康', hint: '诊所 · 药 · 保险 · 健身', icon: 'health', color: 'red', group: 'need' },
  { id: 'family', type: 'expense', name: '家庭人情', hint: '给父母 · 红包 · 礼物', icon: 'family', color: 'pink', group: 'need' },
  { id: 'shopping', type: 'expense', name: '购物', hint: '衣服 · 电子产品 · 网购', icon: 'shopping', color: 'purple', group: 'want' },
  { id: 'social', type: 'expense', name: '娱乐社交', hint: '聚会 · 电影 · 旅行 · 兴趣', icon: 'social', color: 'teal', group: 'want' },
  { id: 'subscriptions', type: 'expense', name: '订阅', hint: 'Netflix · Spotify · iCloud · App', icon: 'subscriptions', color: 'cyan', group: 'want' },
  { id: 'learning', type: 'expense', name: '学习成长', hint: '书 · 课程 · 活动门票', icon: 'learning', color: 'brown', group: 'growth' },
  { id: 'business', type: 'expense', name: '创业支出', hint: '工具 · 广告 · 注册 · 设备', icon: 'business', color: 'mint', group: 'business' },
  { id: 'other', type: 'expense', name: '其他', hint: '暂时不知道放哪里', icon: 'other', color: 'gray', group: 'other' },
  // Income
  { id: 'salary', type: 'income', name: '薪水', hint: '固定收入', icon: 'salary', color: 'green', group: 'other' },
  { id: 'bizincome', type: 'income', name: '创业收入', hint: '公司分红 · 营业收入', icon: 'bizincome', color: 'mint', group: 'business' },
  { id: 'freelance', type: 'income', name: '项目兼职', hint: 'Freelance · 接案', icon: 'freelance', color: 'blue', group: 'other' },
  { id: 'otherincome', type: 'income', name: '其他收入', hint: '红包 · 退款 · 奖金', icon: 'otherincome', color: 'gray', group: 'other' },
].map((c, i) => ({ ...c, order: i, archived: false, builtin: true }));

export function categoryMap(categories) {
  const map = new Map();
  for (const c of categories) map.set(c.id, c);
  return map;
}

export function activeCategories(categories, type) {
  return categories
    .filter((c) => c.type === type && !c.archived)
    .sort((a, b) => a.order - b.order);
}

/** Fallback shown when a transaction references a category that no longer exists. */
export function unknownCategory(type = 'expense') {
  return { id: '_unknown', type, name: '未分类', icon: 'other', color: 'gray', group: 'other', order: 999 };
}
