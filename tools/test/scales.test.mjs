import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MISSING_COLOR,
  niceCeil,
  anomalyBreaks,
  countBreaks,
  classIndex,
  buildScale,
  colorFor,
  legendItems,
  formatNumber,
  formatAnomaly,
} from '../../visor_deptos/scales.js';

test('niceCeil rounds up to 1, 2, 2.5 or 5 times a power of ten', () => {
  assert.equal(niceCeil(0.7), 1);
  assert.equal(niceCeil(1), 1);
  assert.equal(niceCeil(1.3), 2);
  assert.equal(niceCeil(2.2), 2.5);
  assert.equal(niceCeil(3), 5);
  assert.equal(niceCeil(7), 10);
  assert.equal(niceCeil(120), 200);
});

test('anomalyBreaks are symmetric around zero and ascending', () => {
  const values = [-40, -12, -3, -0.5, 0, 0, 0.2, 4, 15, 30];
  const breaks = anomalyBreaks(values);
  assert.equal(breaks.length, 6);
  for (let i = 0; i < breaks.length; i++) {
    assert.equal(breaks[i], -breaks[breaks.length - 1 - i]);
    if (i > 0) assert.ok(breaks[i] > breaks[i - 1]);
  }
  assert.ok(breaks[3] > 0);
});

test('anomalyBreaks has a minimum span when all values are zero', () => {
  const breaks = anomalyBreaks([0, 0, 0]);
  assert.ok(breaks.at(-1) >= 1);
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

test('anomaly scale maps zero to the neutral middle colour', () => {
  const scale = buildScale('anomalia', [-20, -5, 0, 5, 20]);
  assert.equal(scale.colors.length, scale.breaks.length + 1);
  assert.equal(colorFor(0, scale), scale.colors[3]);
  assert.notEqual(colorFor(-20, scale), colorFor(20, scale));
});

test('count scale gives zero its own class', () => {
  const scale = buildScale('focos', [0, 1, 4, 30, 200]);
  assert.equal(colorFor(0, scale), scale.colors[0]);
  assert.notEqual(colorFor(1, scale), scale.colors[0]);
  assert.equal(scale.colors.length, scale.breaks.length + 1);
});

test('missing values use the missing colour', () => {
  const scale = buildScale('focos', [0, 3]);
  assert.equal(colorFor(null, scale), MISSING_COLOR);
  assert.equal(colorFor(undefined, scale), MISSING_COLOR);
  assert.equal(colorFor(NaN, scale), MISSING_COLOR);
});

test('legendItems has one item per class plus sin dato, with Spanish labels', () => {
  const scale = buildScale('anomalia', [-20, 0, 20]);
  const items = legendItems(scale);
  assert.equal(items.length, scale.colors.length + 1);
  assert.equal(items.at(-1).label, 'Sin dato');
  assert.equal(items.at(-1).color, MISSING_COLOR);
  assert.ok(items.some((i) => /normal/i.test(i.label)));
  const counts = legendItems(buildScale('focos', [0, 5, 50]));
  assert.equal(counts[0].label, '0');
});

test('formatNumber uses comma decimals and dot thousands', () => {
  assert.equal(formatNumber(1234), '1.234');
  assert.equal(formatNumber(3.5, 1), '3,5');
  assert.equal(formatNumber(-1234.25, 1), '−1.234,3');
  assert.equal(formatNumber(0, 1), '0,0');
});

test('formatAnomaly adds an explicit sign', () => {
  assert.equal(formatAnomaly(3.5), '+3,5');
  assert.equal(formatAnomaly(-1.2), '−1,2');
  assert.equal(formatAnomaly(0), '0,0');
});
