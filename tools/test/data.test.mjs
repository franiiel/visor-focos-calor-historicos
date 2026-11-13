import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseMonthCsv, splitMonth, monthLabel, createLatestGuard, lustrumStart, lustrumMeans, sumSeries,
  monthlyStats, yearValues, chartCsv,
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

test('sumSeries adds the departments of a province, or all of them without a prefix', () => {
  const months = ['202601', '202602', '202603'];
  const data = {
    '06007': { value: [1, null, null] },
    '06014': { value: [2, 3, null] },
    '22007': { value: [10, 20, null] },
  };
  assert.deepEqual(sumSeries(months, data, '06'), [3, 3, null]);
  assert.deepEqual(sumSeries(months, data), [13, 23, null]);
  assert.deepEqual(sumSeries(months, data, '94'), [null, null, null]);
});

test('monthlyStats gives mean, min and max per calendar month inside the period only', () => {
  const months = ['200001', '200101', '200102', '200201', '200202', '202601'];
  const values = [999, 10, 4, 30, null, 999];
  const stats = monthlyStats(months, values, '200101', '202512');
  assert.equal(stats.mean[0], 20);
  assert.equal(stats.min[0], 10);
  assert.equal(stats.max[0], 30);
  assert.deepEqual([stats.mean[1], stats.min[1], stats.max[1]], [4, 4, 4]);
  assert.deepEqual([stats.mean[2], stats.min[2], stats.max[2]], [null, null, null]);
  assert.equal(stats.mean.length, 12);
});

test('yearValues returns the 12 months of a year, null where there is no data', () => {
  const months = ['202512', '202601', '202603'];
  const values = [5, 7, null];
  assert.deepEqual(yearValues(months, values, 2026), [7, null, null, null, null, null, null, null, null, null, null, null]);
  assert.deepEqual(yearValues(months, values, 2025).slice(11), [5]);
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

test('chartCsv writes one column per dataset, blanks for null and rounds to 2 decimals', () => {
  const csv = chartCsv(['200101', '200102'], [
    { label: 'Focos en el mes', data: [3, null] },
    { label: 'Promedio 2001, 2005', data: [12.333333333333334, 0.5] },
    { label: 'Dice "hola"', data: [1, 2] },
  ]);
  assert.equal(csv, 'mes,Focos en el mes,"Promedio 2001, 2005","Dice ""hola"""\n200101,3,12.33,1\n200102,,0.5,2\n');
});
