#!/usr/bin/env node
// Generates SYNTHETIC monthly heat-hotspot CSVs for the prototype viewer.
// The numbers are invented test data with a plausible shape; they are not real hotspots.
//
// Usage:
//   node tools/generate_synthetic.mjs [--geo visor_deptos/deptos.geo.json]
//        [--out visor_deptos/datos] [--from 200101] [--to 202608] [--seed 20260908]
//
// Output contract (same as SEPA's real files): datos/focos_AAAAMM.csv with header
// `in1,focos,anomalia`, one row per department.
// Prototype assumption: anomalia = focos - mean(focos of the same department and
// calendar month over 2001-2020), rounded to one decimal.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_FROM = '200101';
const BASELINE_TO = '202012';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand) {
  // Box-Muller; 1 - rand() avoids log(0).
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

function poisson(rand, lambda) {
  if (lambda <= 0) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gaussian(rand)));
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = rand();
  while (p > limit) {
    k += 1;
    p *= rand();
  }
  return k;
}

export function listMonths(from, to) {
  const months = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(4));
  const end = Number(to);
  while (y * 100 + m <= end) {
    months.push(`${y}${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

function forEachPosition(coords, fn) {
  if (typeof coords[0] === 'number') fn(coords);
  else for (const c of coords) forEachPosition(c, fn);
}

// Department list with bounding-box centre (good enough to assign a region).
export function departmentsFromGeojson(geo) {
  return geo.features
    .map((f) => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      forEachPosition(f.geometry.coordinates, ([x, y]) => {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      });
      return {
        in1: f.properties.in1,
        provincia: f.properties.provincia,
        lon: (minX + maxX) / 2,
        lat: (minY + maxY) / 2,
      };
    })
    .sort((a, b) => a.in1.localeCompare(b.in1));
}

// Seasonal weights by calendar month (Jan..Dec), roughly averaging 1.
const SEASONS = {
  north: [0.3, 0.2, 0.2, 0.3, 0.4, 0.6, 1.0, 1.8, 2.3, 1.9, 0.8, 0.4],
  delta: [0.6, 0.7, 0.8, 0.9, 0.9, 1.0, 1.4, 1.8, 1.5, 1.0, 0.6, 0.5],
  center: [1.2, 1.0, 0.8, 0.7, 0.6, 0.6, 0.8, 1.2, 1.4, 1.3, 1.1, 1.3],
  patagonia: [2.4, 2.1, 1.2, 0.5, 0.2, 0.1, 0.1, 0.1, 0.2, 0.5, 1.0, 1.8],
};

// Mean monthly hotspots for a "typical" department of each region.
const NORTH_HIGH = new Set(['22', '34', '66', '86']); // Chaco, Formosa, Salta, Santiago del Estero
const NORTH_OTHER = new Set(['10', '18', '38', '46', '54', '90']);
const CENTER = new Set(['14', '42', '74', '82']);
const CUYO = new Set(['50', '70']);
const NORTH_PATAGONIA = new Set(['26', '58', '62']);
const SOUTH_PATAGONIA = new Set(['78', '94']);

export function regionOf(dep) {
  const prov = dep.in1.slice(0, 2);
  if (prov === '02') return { season: 'center', base: 0 };
  if (NORTH_HIGH.has(prov)) return { season: 'north', base: 14 };
  if (NORTH_OTHER.has(prov)) return { season: 'north', base: 5 };
  // Parana Delta: southern Entre Rios and the northeastern Buenos Aires islands.
  if (prov === '30' && dep.lat < -32.6) return { season: 'delta', base: 10 };
  if (prov === '06' && dep.lat > -34.6 && dep.lon > -60.6) return { season: 'delta', base: 2.5 };
  if (prov === '30') return { season: 'center', base: 3 };
  if (CENTER.has(prov)) return { season: 'center', base: 2.5 };
  if (CUYO.has(prov)) return { season: 'center', base: 1.2 };
  if (NORTH_PATAGONIA.has(prov)) return { season: 'patagonia', base: 0.8 };
  if (SOUTH_PATAGONIA.has(prov)) return { season: 'patagonia', base: 0.15 };
  return { season: 'center', base: 0.5 }; // Buenos Aires and anything else
}

// A few extreme years per seasonal region (loosely inspired by known fire seasons).
const EXTREME_YEARS = {
  north: { 2007: 2.2, 2012: 1.8, 2020: 2.5, 2022: 2.0 },
  delta: { 2008: 3.5, 2020: 3.0, 2022: 2.5 },
  center: { 2009: 1.8, 2020: 1.7 },
  patagonia: { 2015: 2.5, 2021: 2.0, 2022: 2.2 },
};

// Returns { months, series: { in1: { focos: [...], anomalia: [...] } } }.
export function generateSeries(departments, months, { seed = 20260908 } = {}) {
  const rand = mulberry32(seed);
  const years = [...new Set(months.map((m) => Number(m.slice(0, 4))))];
  const yearFactor = {};
  for (const season of Object.keys(SEASONS)) {
    yearFactor[season] = {};
    for (const y of years) {
      const extreme = EXTREME_YEARS[season][y] ?? 1;
      yearFactor[season][y] = extreme * Math.exp(0.3 * gaussian(rand));
    }
  }

  const series = {};
  for (const dep of departments) {
    const { season, base } = regionOf(dep);
    const depFactor = Math.exp(0.7 * gaussian(rand));
    const focos = months.map((m) => {
      const y = Number(m.slice(0, 4));
      const cm = Number(m.slice(4)) - 1;
      const lambda =
        base * depFactor * SEASONS[season][cm] * yearFactor[season][y] * Math.exp(0.6 * gaussian(rand));
      return poisson(rand, lambda);
    });
    series[dep.in1] = { focos, anomalia: anomalies(months, focos) };
  }
  return { months, series };
}

function anomalies(months, focos) {
  const sum = new Array(12).fill(0);
  const count = new Array(12).fill(0);
  months.forEach((m, i) => {
    if (m >= BASELINE_FROM && m <= BASELINE_TO) {
      const cm = Number(m.slice(4)) - 1;
      sum[cm] += focos[i];
      count[cm] += 1;
    }
  });
  return months.map((m, i) => {
    const cm = Number(m.slice(4)) - 1;
    const mean = count[cm] ? sum[cm] / count[cm] : 0;
    // Round to one decimal; `+ 0` turns -0 into 0.
    return Math.round((focos[i] - mean) * 10) / 10 + 0;
  });
}

export function monthCsv(monthIndex, departments, series) {
  const lines = ['in1,focos,anomalia'];
  for (const dep of departments) {
    const s = series[dep.in1];
    lines.push(`${dep.in1},${s.focos[monthIndex]},${s.anomalia[monthIndex].toFixed(1)}`);
  }
  return lines.join('\n') + '\n';
}

const README = `DATOS SINTETICOS DE PRUEBA

Los archivos focos_AAAAMM.csv de esta carpeta fueron generados por
tools/generate_synthetic.mjs para el prototipo del visor. Son datos inventados
con una forma plausible (estacionalidad y diferencias regionales) y NO
representan focos de calor reales.

Formato: in1,focos,anomalia (una fila por departamento).
Supuesto del prototipo: anomalia = focos - promedio de focos del mismo
departamento y el mismo mes calendario en 2001-2020.

Para usar datos reales, reemplazar estos archivos por los CSV de SEPA con el
mismo nombre y formato. No hace falta cambiar codigo.
`;

export function writeDataset({ departments, from, to, seed, outDir }) {
  const months = listMonths(from, to);
  const { series } = generateSeries(departments, months, { seed });
  mkdirSync(outDir, { recursive: true });
  months.forEach((m, i) => {
    writeFileSync(join(outDir, `focos_${m}.csv`), monthCsv(i, departments, series));
  });
  writeFileSync(join(outDir, 'LEEME.txt'), README);
  return months.length;
}

function parseArgs(argv) {
  const opts = {
    geo: join(repoRoot, 'visor_deptos', 'deptos.geo.json'),
    out: join(repoRoot, 'visor_deptos', 'datos'),
    from: '200101',
    to: '202608',
    seed: '20260908',
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in opts) || argv[i + 1] === undefined) {
      throw new Error(`Unknown or incomplete option: ${argv[i]}`);
    }
    opts[key] = argv[i + 1];
  }
  if (!/^\d{6}$/.test(opts.from) || !/^\d{6}$/.test(opts.to)) throw new Error('--from/--to must be AAAAMM');
  if (!/^\d+$/.test(opts.seed)) throw new Error('--seed must be a non-negative integer');
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const geo = JSON.parse(readFileSync(resolve(opts.geo), 'utf8'));
  const departments = departmentsFromGeojson(geo);
  const t0 = Date.now();
  const n = writeDataset({
    departments,
    from: opts.from,
    to: opts.to,
    seed: Number(opts.seed),
    outDir: resolve(opts.out),
  });
  console.log(
    `Wrote ${n} monthly CSVs x ${departments.length} departments to ${resolve(opts.out)} in ${Date.now() - t0} ms`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
