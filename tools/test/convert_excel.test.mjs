import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';

import { anomalyClass, buildMonthlyRows, convertWorkbook, readXlsxSheets } from '../convert_excel.mjs';

const CONFIG = {
  filePrefix: 'focos',
  columns: { value: 'focos', anomaly: 'anomalia' },
  climatology: { from: '200101', to: '200212' },
};

test('anomalyClass follows the SEPA rule, evaluated from class 5 down', () => {
  const stats = { max: 10, mean: 5, min: 1 }; // normal band: 4.5 .. 5.5
  assert.equal(anomalyClass(11, stats), 5);
  assert.equal(anomalyClass(10, stats), 4); // equal to the maximum is not above it
  assert.equal(anomalyClass(6, stats), 4);
  assert.equal(anomalyClass(5, stats), 3);
  assert.equal(anomalyClass(4, stats), 2);
  assert.equal(anomalyClass(2, stats), 2);
  assert.equal(anomalyClass(1, stats), 1); // equal to the minimum
  assert.equal(anomalyClass(0, stats), 1);
  // Upper edge of the normal band is still normal (strict >).
  assert.equal(anomalyClass(11, { max: 20, mean: 10, min: 0 }), 3);
  // A department that never had hotspots: zero is class 1.
  assert.equal(anomalyClass(0, { max: 0, mean: 0, min: 0 }), 1);
});

const CODES = new Map([['BUENOS AIRES|ALBERTI', '06021'], ['CHACO|ALMIRANTE BROWN', '22007']]);
const months = (ene, feb = null) => [ene, feb, ...new Array(10).fill(null)];

test('buildMonthlyRows averages only the years with a row and skips missing rows', () => {
  const history = [
    { year: 2001, prov: 'BUENOS AIRES', depto: 'ALBERTI', values: months(2, 0) },
    { year: 2002, prov: 'BUENOS AIRES', depto: 'ALBERTI', values: months(4, 0) },
    { year: 2003, prov: 'BUENOS AIRES', depto: 'ALBERTI', values: months(9) }, // outside the reference
    { year: 2001, prov: 'CHACO', depto: 'ALMIRANTE BROWN', values: months(0, 1) },
  ];
  const result = buildMonthlyRows(history, CODES, CONFIG.climatology);
  // 2003-02 is empty in every row, so it is not a month of the dataset.
  assert.deepEqual([...result.keys()], ['200101', '200102', '200201', '200202', '200301']);
  // Alberti January: reference 2 and 4 (mean 3, max 4, min 2).
  assert.deepEqual(result.get('200101'), [['06021', 2, 1], ['22007', 0, 1]]);
  assert.deepEqual(result.get('200201'), [['06021', 4, 4]]);
  // 9 > max 4. Almirante Brown has no 2003 row, so it has no row that month (not zero).
  assert.deepEqual(result.get('200301'), [['06021', 9, 5]]);
  // Almirante Brown February: a single reference year with 1 hotspot is inside the
  // normal band (1 > 0.9). Alberti has 0 in every reference year: 0 is not above 0.
  assert.deepEqual(result.get('200102'), [['06021', 0, 1], ['22007', 1, 3]]);
});

test('buildMonthlyRows leaves the class empty when the month has no reference years', () => {
  const history = [{ year: 2003, prov: 'BUENOS AIRES', depto: 'ALBERTI', values: months(3) }];
  assert.deepEqual(buildMonthlyRows(history, CODES, CONFIG.climatology).get('200301'), [['06021', 3, null]]);
});

test('buildMonthlyRows rejects unknown names and repeated department-years', () => {
  assert.throws(
    () => buildMonthlyRows([{ year: 2001, prov: 'CHACO', depto: 'NOPE', values: months(1) }], CODES, CONFIG.climatology),
    /CHACO \/ NOPE/,
  );
  const row = { year: 2001, prov: 'CHACO', depto: 'ALMIRANTE BROWN', values: months(1) };
  assert.throws(() => buildMonthlyRows([row, row], CODES, CONFIG.climatology), /22007.*2001/);
});

// Minimal .xlsx writer for fixtures: a zip with deflated entries (CRC is not checked).
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const raw = Buffer.from(text);
    const data = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const cell = (ref, v) => (typeof v === 'string' ? `<c r="${ref}" t="s"><v>${v.slice(1)}</v></c>` : `<c r="${ref}"><v>${v}</v></c>`);
const row = (r, cells) => `<row r="${r}">${cells.map(([col, v]) => cell(`${col}${r}`, v)).join('')}</row>`;
const sheet = (rows) => `<worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`;
const MONTH_COLS = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];

// Shared strings are referenced as '#<index>'.
function fixtureWorkbook() {
  const strings = ['AÑO', 'PROV', 'DEPTO', 'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC',
    'COD_PROV', 'COD_DEPTO', 'BUENOS AIRES', 'CAÑUELAS &amp; CO', '06'];
  const s = (text) => `#${strings.indexOf(text)}`;
  const historyHeader = row(1, [['A', s('AÑO')], ['B', s('PROV')], ['C', s('DEPTO')],
    ...MONTH_COLS.map((col, i) => [col, s(strings[3 + i])])]);
  const history = sheet([
    historyHeader,
    row(2, [['A', 2001], ['B', s('BUENOS AIRES')], ['C', s('CAÑUELAS &amp; CO')], ['D', 3], ['E', 1]]),
    row(3, [['A', 2002], ['B', s('BUENOS AIRES')], ['C', s('CAÑUELAS &amp; CO')], ['D', 5]]),
  ]);
  // COD_PROV as text, COD_DEPTO as a number without zero padding.
  const codes = sheet([
    row(1, [['A', s('COD_PROV')], ['B', s('COD_DEPTO')], ['C', s('PROV')], ['D', s('DEPTO')]]),
    row(2, [['A', s('06')], ['B', 7], ['C', s('BUENOS AIRES')], ['D', s('CAÑUELAS &amp; CO')]]),
  ]);
  return zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="ESTADISTICAS" sheetId="1" r:id="rId2"/>' +
      '<sheet name="FCXMESXAÑO" sheetId="2" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships>' +
      '<Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet9.xml"/>' +
      '<Relationship Target="/xl/worksheets/sheet3.xml" Id="rId2" Type="x/worksheet"/></Relationships>',
    'xl/sharedStrings.xml': `<sst>${strings.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet9.xml': history,
    'xl/worksheets/sheet3.xml': codes,
  });
}

test('readXlsxSheets resolves sheets by name and decodes shared strings', () => {
  const sheets = readXlsxSheets(fixtureWorkbook(), ['ESTADISTICAS']);
  assert.deepEqual(sheets.ESTADISTICAS, [['COD_PROV', 'COD_DEPTO', 'PROV', 'DEPTO'], ['06', '7', 'BUENOS AIRES', 'CAÑUELAS & CO']]);
  assert.throws(() => readXlsxSheets(fixtureWorkbook(), ['NOPE']), /NOPE/);
});

test('convertWorkbook writes one CSV per month with the configured names', () => {
  const files = convertWorkbook(fixtureWorkbook(), CONFIG);
  assert.deepEqual(files, [
    // January reference 3 and 5: 3 is the minimum (class 1), 5 is above mean + 10 % (class 4).
    { name: 'focos_200101.csv', content: 'in1,focos,anomalia\n06007,3,1\n' },
    { name: 'focos_200102.csv', content: 'in1,focos,anomalia\n06007,1,3\n' },
    { name: 'focos_200201.csv', content: 'in1,focos,anomalia\n06007,5,4\n' },
  ]);
  const custom = convertWorkbook(fixtureWorkbook(), { ...CONFIG, filePrefix: 'viirs', columns: { value: 'n', anomaly: 'clase' } });
  assert.equal(custom[0].name, 'viirs_200101.csv');
  assert.equal(custom[0].content, 'in1,n,clase\n06007,3,1\n');
});
