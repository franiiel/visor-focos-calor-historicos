import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  mulberry32,
  listMonths,
  departmentsFromGeojson,
  generateSeries,
  writeDataset,
} from '../generate_synthetic.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const geoPath = join(repoRoot, 'visor_deptos', 'deptos.geo.json');
const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
const departments = departmentsFromGeojson(geo);

test('mulberry32 is deterministic and in [0, 1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const c = mulberry32(43);
  const seqA = Array.from({ length: 5 }, () => a());
  const seqB = Array.from({ length: 5 }, () => b());
  const seqC = Array.from({ length: 5 }, () => c());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
});

test('listMonths covers 2001-01 to 2026-08 inclusive', () => {
  const months = listMonths('200101', '202608');
  assert.equal(months.length, 26 * 12 - 4);
  assert.equal(months[0], '200101');
  assert.equal(months[11], '200112');
  assert.equal(months[12], '200201');
  assert.equal(months.at(-1), '202608');
});

test('departmentsFromGeojson returns one entry per feature with centroid', () => {
  assert.equal(departments.length, geo.features.length);
  for (const d of departments) {
    assert.match(d.in1, /^\d{5}$/);
    assert.ok(d.lat < -20 && d.lat > -56, `lat out of range for ${d.in1}`);
    assert.ok(d.lon < -50 && d.lon > -75, `lon out of range for ${d.in1}`);
  }
});

test('generateSeries is deterministic for a seed', () => {
  const months = listMonths('200101', '200312');
  const sample = departments.slice(0, 40);
  const a = generateSeries(sample, months, { seed: 7 });
  const b = generateSeries(sample, months, { seed: 7 });
  const c = generateSeries(sample, months, { seed: 8 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('written dataset follows the CSV contract', () => {
  const out = mkdtempSync(join(tmpdir(), 'focos-'));
  try {
    writeDataset({ departments, from: '200101', to: '202608', seed: 1, outDir: out });
    const files = readdirSync(out).filter((f) => /^focos_\d{6}\.csv$/.test(f)).sort();
    assert.equal(files.length, 308);
    assert.equal(files[0], 'focos_200101.csv');
    assert.equal(files.at(-1), 'focos_202608.csv');
    // datos/LEEME.txt está versionado, no se genera.
    assert.ok(!existsSync(join(out, 'LEEME.txt')));

    const expectedCodes = departments.map((d) => d.in1).sort();
    const classes = new Set();
    let zeros = 0;
    let rows = 0;
    let maxFocos = 0;
    for (const file of files) {
      const month = file.slice(6, 12);
      const lines = readFileSync(join(out, file), 'utf8').trimEnd().split('\n');
      assert.equal(lines[0], 'in1,focos,anomalia');
      const body = lines.slice(1);
      assert.equal(body.length, departments.length, `row count in ${file}`);
      const codes = [];
      for (const line of body) {
        const [in1, focos, anomalia, extra] = line.split(',');
        assert.equal(extra, undefined);
        assert.match(in1, /^\d{5}$/);
        assert.match(focos, /^\d+$/);
        assert.match(anomalia, /^[1-5]$/);
        // Dentro de la referencia 2001-2025 ningún mes puede superar su propio máximo.
        if (month <= '202512') assert.notEqual(anomalia, '5', `class 5 inside the reference in ${file}`);
        classes.add(anomalia);
        codes.push(in1);
        rows += 1;
        if (focos === '0') zeros += 1;
        maxFocos = Math.max(maxFocos, Number(focos));
      }
      assert.deepEqual(codes.sort(), expectedCodes, `codes in ${file}`);
    }
    assert.deepEqual([...classes].sort(), ['1', '2', '3', '4', '5']);
    assert.ok(zeros / rows > 0.3, 'expected many zero months');
    assert.ok(maxFocos > 100, 'expected some high-intensity months');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
