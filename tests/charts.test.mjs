// The trend chart's bars must measure the same thing as the budget line they are held against.
import test from 'node:test';
import assert from 'node:assert/strict';
import { trendChart } from '../src/ui/charts.js';

const rows = [{ ym: '2026-09-15', label: '9月15日 – 10月19日', tick: '9/15', income: 542997, expense: 407379, personal: 260000, business: 147379 }];

test('with business spending outside the budget, bars show personal spending and the budget line is not "over"', () => {
  const html = String(trendChart(rows, { budget: 400000, personalOnly: true }));
  assert.match(html, /个人支出/);
  assert.match(html, /RM 2,600/);
  assert.match(html, /另有创业 RM 1,474/);
  assert.doesNotMatch(html, /is-over/);
});

test('with business spending inside the budget, bars show everything and go over when it does', () => {
  const html = String(trendChart(rows, { budget: 400000 }));
  assert.match(html, /· 支出/);
  assert.match(html, /RM 4,074/);
  assert.match(html, /is-over/);
  assert.doesNotMatch(html, /另有创业/);
});
