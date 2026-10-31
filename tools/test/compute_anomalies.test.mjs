import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeAnomalies, findDepartment, inPolygon, prepareDepartments, readFirms } from '../compute_anomalies.mjs';
import { referenceStats } from '../convert_excel.mjs';

const square = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const feature = (link, polygons) => ({
  type: 'Feature',
  properties: { LINK: link, DEPTO: 'D', PROVINCIA: 'P' },
  geometry: { type: 'MultiPolygon', coordinates: polygons },
});
// Two departments side by side sharing the x = 1 border; the second has two parts,
// and its first part has a hole.
const GEO = {
  type: 'FeatureCollection',
  features: [
    feature('6021', [[square(0, 0, 1, 1)]]),
    feature('22007', [[square(1, 0, 2, 1), square(1.4, 0.4, 1.6, 0.6)], [square(5, 5, 6, 6)]]),
  ],
};
const CONFIG = {
  filePrefix: 'focos',
  columns: { value: 'focos', anomaly: 'anomalia' },
  climatology: { from: '200101', to: '200212' },
};
const csv = (header, rows) => [header, ...rows].join('\n') + '\n';
const ARCHIVE_HEADER = 'latitude,longitude,brightness,acq_date,confidence,type';
const NRT_HEADER = 'latitude,longitude,brightness,acq_date,confidence';

test('inPolygon handles inside, outside and holes', () => {
  const rings = [square(0, 0, 4, 4), square(1, 1, 2, 2)];
  assert.equal(inPolygon(0.5, 0.5, rings), true);
  assert.equal(inPolygon(5, 0.5, rings), false);
  assert.equal(inPolygon(1.5, 1.5, rings), false); // in the hole
  assert.equal(inPolygon(3, 3, rings), true);
});

test('findDepartment assigns each side of a border and every MultiPolygon part', () => {
  const depts = prepareDepartments(GEO);
  assert.deepEqual(depts.map((d) => d.in1), ['06021', '22007']); // LINK zero padded
  assert.equal(findDepartment(depts, 0.9, 0.5), '06021');
  assert.equal(findDepartment(depts, 1.1, 0.5), '22007');
  assert.equal(findDepartment(depts, 5.5, 5.5), '22007'); // second part
  assert.equal(findDepartment(depts, 1.5, 0.5), null); // hole
  assert.equal(findDepartment(depts, -3, 0.5), null);
});

test('readFirms parses by header name, with or without the type column', () => {
  assert.deepEqual(readFirms(csv(ARCHIVE_HEADER, ['-0.5,1.5,300,2001-01-03,50,0'])), [{ lat: -0.5, lon: 1.5, date: '2001-01-03' }]);
  assert.deepEqual(readFirms(csv(NRT_HEADER, ['0.5,0.5,300,2001-01-03,50'])), [{ lat: 0.5, lon: 0.5, date: '2001-01-03' }]);
  assert.throws(() => readFirms(csv('lat,lon,date', ['0,0,2001-01-01'])), /latitude/);
  assert.throws(() => readFirms(csv(ARCHIVE_HEADER, ['x,0.5,300,2001-01-03,50,0'])), /line 2/);
});

test('computeAnomalies counts every point, fills zeros and classifies against the climatology', () => {
  const archive = csv(ARCHIVE_HEADER, [
    // 2001-01: two in 06021 (any type and confidence counts), one in 22007.
    '0.5,0.5,300,2001-01-03,0,2',
    '0.2,0.2,300,2001-01-20,100,0',
    '0.5,1.1,300,2001-01-03,50,0',
    // 2002-01: four in 06021, none in 22007.
    ...Array(4).fill('0.5,0.5,300,2002-01-10,50,0'),
    // Outside every department (sea, neighbour country): dropped and reported.
    '9,9,300,2002-01-10,50,0',
    // 2003-01: outside the reference period.
    ...Array(5).fill('0.5,0.5,300,2003-01-31,50,0'),
  ]);
  const nrt = csv(NRT_HEADER, [
    '0.5,0.5,300,2003-01-31,50', // same day as the archive's last: already in the archive
    '0.5,1.1,300,2003-02-01,50', // after it: counted
  ]);
  const { files, reference, dropped, lastDate } = computeAnomalies({ archive, nrt, geojson: GEO, config: CONFIG });
  assert.equal(dropped, 1);
  assert.equal(lastDate, '2003-02-01');
  const byName = Object.fromEntries(files.map((f) => [f.name, f.content]));
  // Every month from the first to the last, with every department (0 when no points).
  assert.equal(files.length, 26);
  // 22007 January reference: 1 and 0 (max 1, mean 0.5): 1 is not above the maximum.
  assert.equal(byName['focos_200101.csv'], 'in1,focos,anomalia\n06021,2,1\n22007,1,4\n');
  assert.equal(byName['focos_200102.csv'], 'in1,focos,anomalia\n06021,0,1\n22007,0,1\n');
  // 06021 January reference: 2 and 4 (max 4, mean 3, min 2). 22007: 1 and 0.
  assert.equal(byName['focos_200201.csv'], 'in1,focos,anomalia\n06021,4,4\n22007,0,1\n');
  assert.equal(byName['focos_200301.csv'], 'in1,focos,anomalia\n06021,5,5\n22007,0,1\n');
  assert.equal(byName['focos_200302.csv'], 'in1,focos,anomalia\n06021,0,1\n22007,1,5\n');
  const lines = reference.split('\n');
  assert.equal(lines[0], 'in1,mes,max,promedio,min,desvio');
  assert.equal(lines[1], `06021,01,4,3,2,${Math.SQRT2}`);
  assert.equal(lines[2], '06021,02,0,0,0,0');
  assert.equal(lines.length, 2 * 12 + 2); // header, 12 months per department, final newline
});

test('referenceStats adds the sample standard deviation (Excel STDEV)', () => {
  assert.deepEqual(referenceStats([2, 4, 4, 4, 5, 5, 7, 9]), { max: 9, mean: 5, min: 2, std: Math.sqrt(32 / 7) });
  assert.equal(referenceStats([3]).std, null); // STDEV of one value is #DIV/0!
  assert.equal(referenceStats([]), null);
});
