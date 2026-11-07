import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { processFolder } from '../procesar_mes.mjs';

const square = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const feature = (link, polygons) => ({
  type: 'Feature',
  properties: { LINK: link },
  geometry: { type: 'MultiPolygon', coordinates: polygons },
});
// Mismo caso que tools/test/actualizar_mes_test.php.
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
  integerValues: true,
  climatology: { from: '200101', to: '200212' },
};
const HEADER = 'latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight\n';
const row = (lat, lon, date) => `${lat},${lon},300,1,1,${date},0100,Terra,MODIS,50,6.1NRT,280,10,N\n`;

function makeDatos() {
  const dir = mkdtempSync(join(tmpdir(), 'procesar_mes_test_'));
  // Referencia de enero: 06021 tiene 2 y 4 (max 4, mean 3, min 2); 22007 tiene 1 y 0.
  writeFileSync(join(dir, 'focos_200101.csv'), 'in1,focos,anomalia\n06021,2,1\n22007,1,4\n');
  writeFileSync(join(dir, 'focos_200201.csv'), 'in1,focos,anomalia\n06021,4,4\n22007,0,1\n');
  writeFileSync(join(dir, 'focos_200202.csv'), 'in1,focos,anomalia\n06021,0,1\n22007,0,1\n');
  return dir;
}
const run = (dir) => processFolder(dir, { geojson: GEO, config: CONFIG });

test('writes the month with every department classified and moves the NASA file', () => {
  const dir = makeDatos();
  try {
    writeFileSync(join(dir, 'fire_archive_M-C61_1.csv'), HEADER + row(0.5, 0.5, '2003-01-10').repeat(5) + row(9, 9, '2003-01-10'));
    const result = run(dir);
    assert.deepEqual(result, { month: '200301', name: 'focos_200301.csv', assigned: 5, outside: 1 });
    assert.equal(readFileSync(join(dir, 'focos_200301.csv'), 'utf8'), 'in1,focos,anomalia\n06021,5,5\n22007,0,1\n');
    assert.deepEqual(readdirSync(join(dir, 'procesados')), ['fire_archive_M-C61_1.csv']);
    assert.ok(!existsSync(join(dir, 'fire_archive_M-C61_1.csv')));
    assert.ok(!readdirSync(dir).some((f) => f.endsWith('.tmp')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rerunning a month inside the climatology uses its new counts, not its previous file', () => {
  const dir = makeDatos();
  try {
    writeFileSync(join(dir, 'nasa.csv'), HEADER + row(0.5, 0.5, '2002-01-05').repeat(3));
    run(dir);
    // La referencia de enero ahora es 2 y 3: 3 > max 3 es falso, 3 > 2.75 -> clase 4.
    assert.equal(readFileSync(join(dir, 'focos_200201.csv'), 'utf8'), 'in1,focos,anomalia\n06021,3,4\n22007,0,1\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('NRT points count only after the last archive day', () => {
  const dir = makeDatos();
  try {
    writeFileSync(join(dir, 'fire_archive_x.csv'), HEADER + row(0.5, 0.5, '2003-01-10'));
    writeFileSync(join(dir, 'fire_nrt_x.csv'), HEADER + row(0.5, 0.5, '2003-01-10') + row(0.5, 1.1, '2003-01-20'));
    assert.equal(run(dir).assigned, 2);
    assert.equal(readFileSync(join(dir, 'focos_200301.csv'), 'utf8'), 'in1,focos,anomalia\n06021,1,1\n22007,1,4\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('errors leave the folder untouched', async (t) => {
  const cases = [
    ['more than one month', HEADER + row(0.5, 0.5, '2003-01-31') + row(0.5, 0.5, '2003-02-01'), /2003-01 y 2003-02/],
    ['a file without FIRMS columns', 'Invalid MAP_KEY.\n', /nasa\.csv.*latitude/],
    ['a file without hotspots', HEADER, /no tiene focos/],
  ];
  for (const [name, content, message] of cases) {
    await t.test(name, () => {
      const dir = makeDatos();
      try {
        writeFileSync(join(dir, 'nasa.csv'), content);
        const before = readdirSync(dir);
        assert.throws(() => run(dir), message);
        assert.deepEqual(readdirSync(dir), before);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
  await t.test('no NASA file', () => {
    const dir = makeDatos();
    try {
      mkdirSync(join(dir, 'procesados'));
      writeFileSync(join(dir, 'procesados', 'viejo.csv'), HEADER + row(0.5, 0.5, '2003-01-10'));
      assert.throws(() => run(dir), /No hay ningún CSV de NASA/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  await t.test('a monthly CSV without the configured columns', () => {
    const dir = makeDatos();
    try {
      writeFileSync(join(dir, 'focos_200101.csv'), 'in1,valor\n06021,1\n');
      writeFileSync(join(dir, 'nasa.csv'), HEADER + row(0.5, 0.5, '2003-01-10'));
      assert.throws(() => run(dir), /focos_200101\.csv/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
