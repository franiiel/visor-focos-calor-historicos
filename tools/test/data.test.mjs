import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseMonthCsv, splitMonth, monthLabel, createLatestGuard, lustrumStart, lustrumMeans,
} from '../../visor_deptos/data.js';

const COLUMNS = { value: 'focos', anomaly: 'anomalia' };

test('parseMonthCsv keeps in1 as a 5-char string and parses numbers', () => {
  const rows = parseMonthCsv('in1,focos,anomalia\r\n06007,12,-3.5\n38077,0,0.0\n', COLUMNS);
  assert.equal(rows.size, 2);
  assert.deepEqual(rows.get('06007'), { value: 12, anomaly: -3.5 });
  assert.deepEqual(rows.get('38077'), { value: 0, anomaly: 0 });
});

test('parseMonthCsv accepts columns in any order and skips invalid rows', () => {
  const rows = parseMonthCsv('anomalia,in1,focos\n1.5,02007,4\nbad,xx,1\n,10007,\n', COLUMNS);
  assert.deepEqual(rows.get('02007'), { value: 4, anomaly: 1.5 });
  assert.equal(rows.has('xx'), false);
  assert.deepEqual(rows.get('10007'), { value: null, anomaly: null });
});

test('parseMonthCsv reads the configured column names', () => {
  const rows = parseMonthCsv('IN1,Cantidad,anom\n06007,7,2.5\n', { value: 'cantidad', anomaly: 'anom' });
  assert.deepEqual(rows.get('06007'), { value: 7, anomaly: 2.5 });
});

test('parseMonthCsv rejects a file without the configured header', () => {
  assert.throws(() => parseMonthCsv('a,b,c\n1,2,3\n', COLUMNS), /in1,focos,anomalia/);
  assert.throws(
    () => parseMonthCsv('in1,focos,anomalia\n06007,1,0\n', { value: 'cantidad', anomaly: 'anom' }),
    /in1,cantidad,anom/,
  );
});

test('splitMonth and monthLabel', () => {
  assert.deepEqual(splitMonth('202608'), { year: 2026, month: 8 });
  assert.equal(monthLabel('202608'), 'agosto 2026');
});

test('lustrumStart groups years in 5-year blocks from the first year', () => {
  assert.equal(lustrumStart(2001, 2001), 2001);
  assert.equal(lustrumStart(2005, 2001), 2001);
  assert.equal(lustrumStart(2006, 2001), 2006);
  assert.equal(lustrumStart(2026, 2001), 2026);
});

test('lustrumMeans averages each 5-year block, skipping months without data', () => {
  // Un valor por año (enero) alcanza para ejercitar los bloques.
  const months = ['200101', '200301', '200501', '200601', '201001', '201101'];
  const values = [10, null, 20, 4, 6, null];
  assert.deepEqual(lustrumMeans(months, values), [15, 15, 15, 5, 5, null]);
  assert.deepEqual(lustrumMeans([], []), []);
});

test('createLatestGuard marks only the newest token as current', () => {
  const guard = createLatestGuard();
  const first = guard.next();
  assert.equal(guard.isCurrent(first), true);
  const second = guard.next();
  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);
});

test('createLatestGuard instances are independent', () => {
  const a = createLatestGuard();
  const b = createLatestGuard();
  const tokenA = a.next();
  b.next();
  b.next();
  assert.equal(a.isCurrent(tokenA), true);
});

test('createLatestGuard drops a late earlier response', async () => {
  const guard = createLatestGuard();
  const applied = [];
  const request = async (value, delay) => {
    const token = guard.next();
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (guard.isCurrent(token)) applied.push(value);
  };
  await Promise.all([request('old', 20), request('new', 0)]);
  assert.deepEqual(applied, ['new']);
});
