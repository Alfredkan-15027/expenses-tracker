// Reference ranges for a 24-year-old single founder living in Kuala Lumpur.
// All numbers are monthly, in RM (not cents). They are guidance, not rules.
//
// Sources
// 1. EPF Belanjawanku 2024/2025 (released Dec 2024) — Klang Valley, single adult:
//    ~RM1,970/month using public transport, ~RM2,800/month owning a car
//    (includes ~RM260 of savings, so the spending part is ~RM1,700 / ~RM2,540).
// 2. EPF Belanjawanku 2019 category split for a Klang Valley single adult:
//    food 550, housing (room) 300, transport 200 (car: 770), utilities 100,
//    personal care 70, social participation 150, discretionary 130,
//    healthcare 30, annual expenses 90 (car: 140), savings 250.
// 3. Market estimates (2025–2026) for KL: room rental RM400–900,
//    studio / small unit RM1,000–2,200, My50 unlimited rail pass RM50.
// Belanjawanku is a *minimum reasonable* standard, so the "reasonable" ranges
// below start near it and allow headroom for normal KL prices.

export const BENCHMARK_SOURCES = [
  { name: 'EPF Belanjawanku 2024/2025', detail: '巴生谷单身：公共交通约 RM1,970／月，有车约 RM2,800／月（含约 RM260 储蓄）' },
  { name: 'EPF Belanjawanku 2019', detail: '巴生谷单身分类：餐饮 550、住房 300、交通 200（有车 770）、水电 100、个人护理 70、社交 150、自由支配 130、医疗 30' },
  { name: '吉隆坡市场估计 2025–2026', detail: '合租房间 RM400–900、小单位 RM1,000–2,200、My50 无限次地铁卡 RM50' },
];

export const HOUSING_OPTIONS = [
  { id: 'family', label: '住家里' },
  { id: 'room', label: '合租房间' },
  { id: 'unit', label: '整租单位' },
];

export const TRANSPORT_OPTIONS = [
  { id: 'public', label: '公共交通' },
  { id: 'motorcycle', label: '摩托车' },
  { id: 'car', label: '汽车' },
];

export const DEFAULT_PROFILE = { housing: 'room', transport: 'public' };

// [low, high] reasonable monthly range per built-in category id.
const BASE_RANGES = {
  food: [500, 900],
  groceries: [100, 300],
  health: [50, 250],
  family: [0, 500],
  shopping: [50, 300],
  social: [100, 400],
  subscriptions: [20, 120],
  learning: [0, 300],
  other: [0, 150],
};

const HOUSING_RANGES = {
  family: { housing: [0, 400], utilities: [50, 150], food: [300, 700], groceries: [50, 200] },
  room: { housing: [400, 900], utilities: [80, 200] },
  unit: { housing: [1000, 2200], utilities: [150, 350] },
};

const TRANSPORT_RANGES = {
  public: [100, 300],
  motorcycle: [100, 300],
  car: [700, 1300],
};

// Whole-month personal living cost tiers (RM) for room + public transport.
// lean < t[0] ≤ reasonable ≤ t[1] < high ≤ t[2] < over
const BASE_TIERS = [1700, 2800, 3800];
const TIER_SHIFT = {
  housing: { family: -500, room: 0, unit: 800 },
  transport: { public: 0, motorcycle: 0, car: 800 },
};

export function normalizeProfile(profile = {}) {
  return {
    housing: HOUSING_RANGES[profile.housing] ? profile.housing : DEFAULT_PROFILE.housing,
    transport: TRANSPORT_RANGES[profile.transport] ? profile.transport : DEFAULT_PROFILE.transport,
  };
}

/** Map of categoryId → [lowRM, highRM] for the given profile. */
export function categoryRanges(profile) {
  const p = normalizeProfile(profile);
  return {
    ...BASE_RANGES,
    ...HOUSING_RANGES[p.housing],
    transport: TRANSPORT_RANGES[p.transport],
  };
}

/** Personal living cost tiers in RM: [leanBelow, reasonableUpTo, highUpTo]. */
export function livingCostTiers(profile) {
  const p = normalizeProfile(profile);
  const shift = TIER_SHIFT.housing[p.housing] + TIER_SHIFT.transport[p.transport];
  return BASE_TIERS.map((t) => t + shift);
}

export const TIER_LABELS = {
  lean: '精简',
  ok: '合理',
  high: '偏高',
  over: '过高',
};

// Savings-rate guidance for a young founder (share of income kept).
export const SAVINGS_RATE_GOOD = 0.2;
export const SAVINGS_RATE_OK = 0.1;

// Needs / wants guidance adapted from 50/30/20 for KL living costs.
export const NEEDS_SHARE_MAX = 0.6;
export const WANTS_SHARE_MAX = 0.25;

// Emergency fund / personal runway target, in months of living cost.
export const RUNWAY_TARGET_MONTHS = 6;
