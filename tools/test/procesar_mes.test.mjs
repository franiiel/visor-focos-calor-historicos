import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { processMonth } from '../procesar_mes.mjs';

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

// Crea <tmp>/datos con el histórico y <tmp>/nasa vacía; ejecuta fn y borra todo al final.
function withFolders(fn) {
  const root = mkdtempSync(join(tmpdir(), 'procesar_mes_test_'));
  const datos = join(root, 'datos');
  const nasa = join(root, 'nasa');
  mkdirSync(datos);
  mkdirSync(nasa);
  // Referencia de enero: 06021 tiene 2 y 4 (max 4, mean 3, min 2); 22007 tiene 1 y 0.
  writeFileSync(join(datos, 'focos_200101.csv'), 'in1,focos,anomalia\n06021,2,1\n22007,1,4\n');
  writeFileSync(join(datos, 'focos_200201.csv'), 'in1,focos,anomalia\n06021,4,4\n22007,0,1\n');
  writeFileSync(join(datos, 'focos_200202.csv'), 'in1,focos,anomalia\n06021,0,1\n22007,0,1\n');
  const run = () => processMonth({ nasaDir: nasa, datosDir: datos, geojson: GEO, config: CONFIG });
  try {
    fn({ datos, nasa, run });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('writes the month in datos/ with every department classified and moves the download', () => {
  withFolders(({ datos, nasa, run }) => {
    writeFileSync(join(nasa, 'fire_archive_M-C61_1.csv'), HEADER + row(0.5, 0.5, '2003-01-10').repeat(5) + row(9, 9, '2003-01-10'));
    assert.deepEqual(run(), { month: '200301', name: 'focos_200301.csv', assigned: 5, outside: 1 });
    assert.equal(readFileSync(join(datos, 'focos_200301.csv'), 'utf8'), 'in1,focos,anomalia\n06021,5,5\n22007,0,1\n');
    assert.deepEqual(readdirSync(nasa), ['procesados']);
    assert.deepEqual(readdirSync(join(nasa, 'procesados')), ['fire_archive_M-C61_1.csv']);
    assert.ok(!readdirSync(datos).some((f) => f.endsWith('.tmp')));
  });
});

test('reads a FIRMS download folder dropped as is and moves it whole', () => {
  withFolders(({ datos, nasa, run }) => {
    const dl = join(nasa, 'DL_FIRE_M-C61_1');
    mkdirSync(dl);
    writeFileSync(join(dl, 'fire_archive_M-C61_1.csv'), HEADER + row(0.5, 0.5, '2003-01-10'));
    writeFileSync(join(dl, 'Readme.txt'), 'FIRMS');
    assert.equal(run().assigned, 1);
    assert.ok(existsSync(join(datos, 'focos_200301.csv')));
    assert.deepEqual(readdirSync(join(nasa, 'procesados', 'DL_FIRE_M-C61_1')).sort(), ['Readme.txt', 'fire_archive_M-C61_1.csv']);
  });
});

test('reprocessing a download with the same name replaces the processed copy', () => {
  withFolders(({ nasa, run }) => {
    for (let i = 0; i < 2; i++) {
      mkdirSync(join(nasa, 'DL_FIRE_x'));
      writeFileSync(join(nasa, 'DL_FIRE_x', 'fire_archive_x.csv'), HEADER + row(0.5, 0.5, '2003-01-10'));
      run();
    }
    assert.deepEqual(readdirSync(join(nasa, 'procesados')), ['DL_FIRE_x']);
  });
});

test('rerunning a month inside the climatology uses its new counts, not its previous file', () => {
  withFolders(({ datos, nasa, run }) => {
    writeFileSync(join(nasa, 'descarga.csv'), HEADER + row(0.5, 0.5, '2002-01-05').repeat(3));
    run();
    // La referencia de enero ahora es 2 y 3: 3 > max 3 es falso, 3 > 2.75 -> clase 4.
    assert.equal(readFileSync(join(datos, 'focos_200201.csv'), 'utf8'), 'in1,focos,anomalia\n06021,3,4\n22007,0,1\n');
  });
});

test('NRT points count only after the last archive day', () => {
  withFolders(({ datos, nasa, run }) => {
    writeFileSync(join(nasa, 'fire_archive_x.csv'), HEADER + row(0.5, 0.5, '2003-01-10'));
    writeFileSync(join(nasa, 'fire_nrt_x.csv'), HEADER + row(0.5, 0.5, '2003-01-10') + row(0.5, 1.1, '2003-01-20'));
    assert.equal(run().assigned, 2);
    assert.equal(readFileSync(join(datos, 'focos_200301.csv'), 'utf8'), 'in1,focos,anomalia\n06021,1,1\n22007,1,4\n');
  });
});

test('other CSVs in datos/ are not taken as downloads', () => {
  withFolders(({ datos, nasa, run }) => {
    writeFileSync(join(datos, 'referencia.csv'), 'in1,mes,max,promedio,min,desvio\n');
    writeFileSync(join(datos, 'otro.csv'), 'a,b\n');
    writeFileSync(join(nasa, 'fire_archive_x.csv'), HEADER + row(0.5, 0.5, '2003-01-10'));
    assert.equal(run().assigned, 1);
    assert.ok(existsSync(join(datos, 'otro.csv')));
  });
});

test('errors leave both folders untouched', async (t) => {
  const cases = [
    ['more than one month', HEADER + row(0.5, 0.5, '2003-01-31') + row(0.5, 0.5, '2003-02-01'), /2003-01 y 2003-02/],
    ['a file without FIRMS columns', 'Invalid MAP_KEY.\n', /descarga\.csv.*latitude/],
    ['a file without hotspots', HEADER, /no tiene focos/],
  ];
  for (const [name, content, message] of cases) {
    await t.test(name, () => {
      withFolders(({ datos, nasa, run }) => {
        writeFileSync(join(nasa, 'descarga.csv'), content);
        const before = [readdirSync(datos), readdirSync(nasa)];
        assert.throws(run, message);
        assert.deepEqual([readdirSync(datos), readdirSync(nasa)], before);
      });
    });
  }
  await t.test('only already processed downloads', () => {
    withFolders(({ nasa, run }) => {
      mkdirSync(join(nasa, 'procesados'));
      writeFileSync(join(nasa, 'procesados', 'viejo.csv'), HEADER + row(0.5, 0.5, '2003-01-10'));
      assert.throws(run, /No hay ningún CSV de NASA en .*nasa/);
    });
  });
  await t.test('missing nasa folder', () => {
    withFolders(({ nasa, run }) => {
      rmSync(nasa, { recursive: true });
      assert.throws(run, /No existe la carpeta .*nasa/);
    });
  });
  await t.test('a monthly CSV without the configured columns', () => {
    withFolders(({ datos, nasa, run }) => {
      writeFileSync(join(datos, 'focos_200101.csv'), 'in1,valor\n06021,1\n');
      writeFileSync(join(nasa, 'descarga.csv'), HEADER + row(0.5, 0.5, '2003-01-10'));
      assert.throws(run, /focos_200101\.csv/);
    });
  });
});
