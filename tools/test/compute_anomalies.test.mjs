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
// Dos departamentos contiguos que comparten el borde x = 1; el segundo tiene dos partes,
// y su primera parte tiene un hueco.
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
  assert.equal(inPolygon(1.5, 1.5, rings), false); // en el hueco
  assert.equal(inPolygon(3, 3, rings), true);
});

test('findDepartment assigns each side of a border and every MultiPolygon part', () => {
  const depts = prepareDepartments(GEO);
  assert.deepEqual(depts.map((d) => d.in1), ['06021', '22007']); // LINK completado con ceros
  assert.equal(findDepartment(depts, 0.9, 0.5), '06021');
  assert.equal(findDepartment(depts, 1.1, 0.5), '22007');
  assert.equal(findDepartment(depts, 5.5, 5.5), '22007'); // segunda parte
  assert.equal(findDepartment(depts, 1.5, 0.5), null); // hueco
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
    // 2001-01: dos en 06021 (cuenta cualquier tipo y confianza), uno en 22007.
    '0.5,0.5,300,2001-01-03,0,2',
    '0.2,0.2,300,2001-01-20,100,0',
    '0.5,1.1,300,2001-01-03,50,0',
    // 2002-01: cuatro en 06021, ninguno en 22007.
    ...Array(4).fill('0.5,0.5,300,2002-01-10,50,0'),
    // Fuera de todo departamento (mar, país limítrofe): se descarta y se informa.
    '9,9,300,2002-01-10,50,0',
    // 2003-01: fuera del período de referencia.
    ...Array(5).fill('0.5,0.5,300,2003-01-31,50,0'),
  ]);
  const nrt = csv(NRT_HEADER, [
    '0.5,0.5,300,2003-01-31,50', // mismo día que el último del archive: ya está en el archive
    '0.5,1.1,300,2003-02-01,50', // posterior: se cuenta
  ]);
  const { files, reference, dropped, lastDate } = computeAnomalies({ archive, nrt, geojson: GEO, config: CONFIG });
  assert.equal(dropped, 1);
  assert.equal(lastDate, '2003-02-01');
  const byName = Object.fromEntries(files.map((f) => [f.name, f.content]));
  // Todos los meses del primero al último, con todos los departamentos (0 cuando no hay puntos).
  assert.equal(files.length, 26);
  // Referencia de enero de 22007: 1 y 0 (max 1, mean 0.5): 1 no supera el máximo.
  assert.equal(byName['focos_200101.csv'], 'in1,focos,anomalia\n06021,2,1\n22007,1,4\n');
  assert.equal(byName['focos_200102.csv'], 'in1,focos,anomalia\n06021,0,1\n22007,0,1\n');
  // Referencia de enero de 06021: 2 y 4 (max 4, mean 3, min 2). 22007: 1 y 0.
  assert.equal(byName['focos_200201.csv'], 'in1,focos,anomalia\n06021,4,4\n22007,0,1\n');
  assert.equal(byName['focos_200301.csv'], 'in1,focos,anomalia\n06021,5,5\n22007,0,1\n');
  assert.equal(byName['focos_200302.csv'], 'in1,focos,anomalia\n06021,0,1\n22007,1,5\n');
  const lines = reference.split('\n');
  assert.equal(lines[0], 'in1,mes,max,promedio,min,desvio');
  assert.equal(lines[1], `06021,01,4,3,2,${Math.SQRT2}`);
  assert.equal(lines[2], '06021,02,0,0,0,0');
  assert.equal(lines.length, 2 * 12 + 2); // encabezado, 12 meses por departamento, salto de línea final
});

test('referenceStats adds the sample standard deviation (Excel STDEV)', () => {
  assert.deepEqual(referenceStats([2, 4, 4, 4, 5, 5, 7, 9]), { max: 9, mean: 5, min: 2, std: Math.sqrt(32 / 7) });
  assert.equal(referenceStats([3]).std, null); // STDEV de un solo valor es #DIV/0!
  assert.equal(referenceStats([]), null);
});
