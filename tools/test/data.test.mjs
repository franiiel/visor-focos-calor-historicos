import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseMonthCsv, splitMonth, monthLabel } from '../../visor_deptos/data.js';

test('parseMonthCsv keeps in1 as a 5-char string and parses numbers', () => {
  const rows = parseMonthCsv('in1,focos,anomalia\r\n06007,12,-3.5\n38077,0,0.0\n');
  assert.equal(rows.size, 2);
  assert.deepEqual(rows.get('06007'), { focos: 12, anomalia: -3.5 });
  assert.deepEqual(rows.get('38077'), { focos: 0, anomalia: 0 });
});

test('parseMonthCsv accepts columns in any order and skips invalid rows', () => {
  const rows = parseMonthCsv('anomalia,in1,focos\n1.5,02007,4\nbad,xx,1\n,10007,\n');
  assert.deepEqual(rows.get('02007'), { focos: 4, anomalia: 1.5 });
  assert.equal(rows.has('xx'), false);
  assert.deepEqual(rows.get('10007'), { focos: null, anomalia: null });
});

test('parseMonthCsv rejects a file without the required header', () => {
  assert.throws(() => parseMonthCsv('a,b,c\n1,2,3\n'), /in1/);
});

test('splitMonth and monthLabel', () => {
  assert.deepEqual(splitMonth('202608'), { year: 2026, month: 8 });
  assert.equal(monthLabel('202608'), 'agosto 2026');
});
