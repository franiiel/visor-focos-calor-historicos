import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeAnomalies } from '../compute_anomalies.mjs';
import { processMonth, processSources } from '../procesar_mes.mjs';

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

test('a download covering the whole climatology rebuilds every month like compute_anomalies', () => {
  withFolders(({ datos, nasa, run }) => {
    const archive = HEADER + row(0.5, 0.5, '2001-01-03').repeat(2) + row(0.5, 1.1, '2002-01-09') + row(9, 9, '2002-06-01');
    const nrt = HEADER + row(0.5, 0.5, '2002-06-01') + row(0.5, 0.5, '2003-01-10').repeat(4);
    writeFileSync(join(nasa, 'fire_archive_x.csv'), archive);
    writeFileSync(join(nasa, 'fire_nrt_x.csv'), nrt);
    const expected = computeAnomalies({ archive, nrt, geojson: GEO, config: CONFIG });
    const logged = [];
    const result = processMonth({ nasaDir: nasa, datosDir: datos, geojson: GEO, config: CONFIG, log: (m) => logged.push(m) });
    assert.ok(logged.some((m) => m.includes('se rearma el histórico completo')) && logged.some((m) => m.includes('100 %')), logged.join(' | '));
    assert.deepEqual(result, { month: '200101 a 200301', name: 'focos_200101.csv … focos_200301.csv', files: 25, assigned: 7, outside: 1 });
    for (const { name, content } of expected.files) assert.equal(readFileSync(join(datos, name), 'utf8'), content);
    assert.equal(readFileSync(join(datos, 'referencia.csv'), 'utf8'), expected.reference);
    assert.deepEqual(readdirSync(join(nasa, 'procesados')), ['fire_archive_x.csv', 'fire_nrt_x.csv']);
    assert.ok(!readdirSync(datos).some((f) => f.endsWith('.tmp')));
  });
});

test('a download of several months writes each month as if they were processed one by one', () => {
  const dec = row(0.5, 0.5, '2002-12-15') + row(0.5, 0.5, '2002-12-31');
  const feb = row(0.5, 1.1, '2003-02-01') + row(0.5, 0.5, '2003-02-10');
  const names = ['focos_200212.csv', 'focos_200301.csv', 'focos_200302.csv'];
  let oneByOne;
  withFolders(({ datos, nasa, run }) => {
    // Enero, de a uno, solo con un foco fuera de todo departamento: todo en cero.
    for (const rows of [dec, row(9, 9, '2003-01-05'), feb]) {
      writeFileSync(join(nasa, 'descarga.csv'), HEADER + rows);
      run();
    }
    oneByOne = names.map((f) => readFileSync(join(datos, f), 'utf8'));
  });
  withFolders(({ datos, nasa }) => {
    writeFileSync(join(nasa, 'fire_archive_x.csv'), HEADER + dec + feb);
    const logged = [];
    const result = processMonth({ nasaDir: nasa, datosDir: datos, geojson: GEO, config: CONFIG, log: (m) => logged.push(m) });
    assert.deepEqual(result, { month: '200212 a 200302', name: 'focos_200212.csv … focos_200302.csv', files: 3, assigned: 4, outside: 0 });
    // Enero no tiene focos en la descarga: igual se escribe, con ceros.
    assert.deepEqual(names.map((f) => readFileSync(join(datos, f), 'utf8')), oneByOne);
    assert.ok(logged.includes('  datos del 15/12/2002 al 10/02/2003'), logged.join(' | '));
    assert.ok(logged.some((m) => m.startsWith('  AVISO: 2002-12 empieza el 15/12/2002')), logged.join(' | '));
    assert.ok(logged.some((m) => m.startsWith('  AVISO: 2003-02 termina el 10/02/2003')), logged.join(' | '));
    assert.deepEqual(readdirSync(join(nasa, 'procesados')), ['fire_archive_x.csv']);
  });
});

test('a complete month logs no warning', () => {
  withFolders(({ nasa, datos }) => {
    writeFileSync(join(nasa, 'x.csv'), HEADER + row(0.5, 0.5, '2003-01-01') + row(0.5, 0.5, '2003-01-31'));
    const logged = [];
    processMonth({ nasaDir: nasa, datosDir: datos, geojson: GEO, config: CONFIG, log: (m) => logged.push(m) });
    assert.ok(!logged.some((m) => m.includes('AVISO')), logged.join(' | '));
  });
});

test('processSources runs every source with a download in nasa/<id> and skips the empty ones', () => {
  const root = mkdtempSync(join(tmpdir(), 'procesar_sources_test_'));
  try {
    const configText = JSON.stringify({ ...CONFIG, climatology: undefined, sources: [
      { id: 'modis', climatology: CONFIG.climatology },
      { id: 'viirs', climatology: CONFIG.climatology },
    ] });
    mkdirSync(join(root, 'nasa', 'modis'), { recursive: true });
    mkdirSync(join(root, 'nasa', 'VIIRS'), { recursive: true });
    writeFileSync(join(root, 'nasa', 'VIIRS', 'fire_archive_x.csv'), HEADER + row(0.5, 0.5, '2003-01-10'));
    const results = processSources({ root, geojson: GEO, configText });
    assert.deepEqual(results.map((r) => [r.id, r.error ?? r.name]), [['viirs', 'focos_200301.csv']]);
    assert.ok(existsSync(join(root, 'datos', 'viirs', 'focos_200301.csv')));
    assert.ok(!existsSync(join(root, 'datos', 'modis')));
    assert.throws(() => processSources({ root, geojson: GEO, configText }), /No hay descargas nuevas en nasa\/modis ni en nasa\/viirs/);
    assert.match(processSources({ root, geojson: GEO, configText, fuente: 'modis' })[0].error, /No hay ningún CSV de NASA/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('errors leave both folders untouched', async (t) => {
  const cases = [
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
