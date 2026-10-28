import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MISSING_COLOR,
  ANOMALY_COLORS,
  niceCeil,
  countBreaks,
  classIndex,
  buildScale,
  colorFor,
  legendItems,
  formatNumber,
  anomalyLabel,
} from '../../visor_deptos/scales.js';

const LABELS = ['mínimo', 'debajo', 'normal', 'encima', 'máximo'];

test('niceCeil rounds up to 1, 2, 2.5 or 5 times a power of ten', () => {
  assert.equal(niceCeil(0.7), 1);
  assert.equal(niceCeil(1), 1);
  assert.equal(niceCeil(1.3), 2);
  assert.equal(niceCeil(2.2), 2.5);
  assert.equal(niceCeil(3), 5);
  assert.equal(niceCeil(7), 10);
  assert.equal(niceCeil(120), 200);
});

test('countBreaks are ascending nice numbers starting above zero', () => {
  const values = [0, 0, 0, 1, 2, 3, 5, 8, 13, 40, 90, 300, 1200];
  const breaks = countBreaks(values);
  assert.ok(breaks.length >= 2 && breaks.length <= 6);
  assert.ok(breaks[0] >= 1);
  for (let i = 1; i < breaks.length; i++) assert.ok(breaks[i] > breaks[i - 1]);
});

test('countBreaks handles all-zero input', () => {
  assert.deepEqual(countBreaks([0, 0]), [1]);
});

test('classIndex counts breaks strictly below the value', () => {
  const breaks = [-10, -5, -1, 1, 5, 10];
  assert.equal(classIndex(-20, breaks), 0);
  assert.equal(classIndex(-10, breaks), 0);
  assert.equal(classIndex(0, breaks), 3);
  assert.equal(classIndex(1, breaks), 3);
  assert.equal(classIndex(7, breaks), 5);
  assert.equal(classIndex(99, breaks), 6);
});

test('anomaly scale has one fixed colour per class 1-5', () => {
  // The values do not move the classes: the same scale for any month.
  const scale = buildScale('anomaly', [1, 1, 2], LABELS);
  assert.deepEqual(scale.colors, ANOMALY_COLORS);
  assert.equal(ANOMALY_COLORS.length, 5);
  for (let c = 1; c <= 5; c++) assert.equal(colorFor(c, scale), ANOMALY_COLORS[c - 1]);
  for (const v of [0, 6, 2.5, -1, null, NaN]) assert.equal(colorFor(v, scale), MISSING_COLOR);
});

test('anomalyLabel gives the configured text of a class', () => {
  assert.equal(anomalyLabel(1, LABELS), 'mínimo');
  assert.equal(anomalyLabel(5, LABELS), 'máximo');
  for (const v of [0, 6, 2.5, null, undefined]) assert.equal(anomalyLabel(v, LABELS), 'sin dato');
});

test('count scale gives zero its own class', () => {
  const scale = buildScale('value', [0, 1, 4, 30, 200]);
  assert.equal(colorFor(0, scale), scale.colors[0]);
  assert.notEqual(colorFor(1, scale), scale.colors[0]);
  assert.equal(scale.colors.length, scale.breaks.length + 1);
});

test('missing values use the missing colour', () => {
  const scale = buildScale('value', [0, 3]);
  assert.equal(colorFor(null, scale), MISSING_COLOR);
  assert.equal(colorFor(undefined, scale), MISSING_COLOR);
  assert.equal(colorFor(NaN, scale), MISSING_COLOR);
});

test('legendItems has one item per class plus sin dato', () => {
  const items = legendItems(buildScale('anomaly', [], LABELS));
  assert.deepEqual(items.map((i) => i.label), [...LABELS, 'Sin dato']);
  assert.deepEqual(items.map((i) => i.color), [...ANOMALY_COLORS, MISSING_COLOR]);
  const counts = legendItems(buildScale('value', [0, 5, 50]));
  assert.equal(counts[0].label, '0');
  assert.equal(counts.at(-1).label, 'Sin dato');
});

test('formatNumber uses comma decimals and dot thousands', () => {
  assert.equal(formatNumber(1234), '1.234');
  assert.equal(formatNumber(3.5, 1), '3,5');
  assert.equal(formatNumber(-1234.25, 1), '−1.234,3');
  assert.equal(formatNumber(0, 1), '0,0');
});
