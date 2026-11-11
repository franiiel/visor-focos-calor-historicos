#!/usr/bin/env node
// Calcula los CSV mensuales del visor a partir de focos crudos de NASA FIRMS (MODIS o VIIRS):
// datos/<fuente>/<filePrefix>_AAAAMM.csv con `in1,<value>,<anomaly>`, más datos/<fuente>/referencia.csv
// con las estadísticas de referencia (máximo, media, mínimo, desviación estándar) por departamento y
// mes calendario.
//
// Uso:
//   node tools/compute_anomalies.mjs --firms DL_FIRE_M-C61_43028
//        [--fuente modis] [--geojson tools/raw/DEPTOS-PROV.geojson] [--config visor_deptos/config.json]
//        [--out visor_deptos/datos/<fuente>]
//
// --fuente es un id de `sources` en config.json (por defecto, la primera); define la climatología y la
// carpeta de salida. La descarga de --firms tiene que ser de ese sensor (p. ej. SV-C2 para viirs).
//
// --firms es una carpeta de descarga de FIRMS: un fire_archive_*.csv y, opcionalmente, un
// fire_nrt_*.csv. Los puntos NRT cuentan solo después del último día del archive. Todo punto
// cuenta (sin filtro de tipo ni de confianza, como en el libro de SEPA). Cada punto se asigna por
// punto en polígono sobre el DEPTOS-PROV.geojson completo (de `node tools/build_geometry.mjs`),
// nunca sobre la geometría simplificada del visor. Un departamento sin puntos en un mes tiene 0.
// La clase es la regla 1-5 de SEPA (ver VISOR_FOCOS.md) respecto de la climatología de config.json.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeFeatures } from './build_geometry.mjs';
import { classifySeries, monthFiles, sourceConfig } from './convert_excel.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- Punto en polígono ----------

// Ray casting par-impar sobre todos los anillos, de modo que los huecos quedan excluidos.
export function inPolygon(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

const bboxOf = (rings) => {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of rings[0]) {
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y);
    b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
  }
  return b;
};
const inBox = (b, x, y) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

// Devuelve [{ in1, parts: [{ bbox, rings }] }] ordenado por in1, una entrada por departamento
// (la fuente tiene varios features para algunos departamentos).
export function prepareDepartments(geojson) {
  const byCode = new Map();
  for (const f of normalizeFeatures(geojson).features) {
    const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const parts = byCode.get(f.properties.in1) ?? [];
    for (const rings of polygons) parts.push({ bbox: bboxOf(rings), rings });
    byCode.set(f.properties.in1, parts);
  }
  return [...byCode].sort(([a], [b]) => a.localeCompare(b)).map(([in1, parts]) => ({ in1, parts }));
}

// ponytail: búsqueda lineal con prefiltro por bbox (suficiente para ~2M puntos); agregar un índice de grilla si se vuelve lento.
export function findDepartment(depts, lon, lat) {
  for (const { in1, parts } of depts) {
    for (const { bbox, rings } of parts) {
      if (inBox(bbox, lon, lat) && inPolygon(lon, lat, rings)) return in1;
    }
  }
  return null;
}

// ---------- CSV de FIRMS ----------

// Devuelve [{ lat, lon, date: 'AAAA-MM-DD' }]. Las columnas se buscan por nombre de encabezado, ya que
// los archivos archive y NRT no tienen las mismas columnas.
export function readFirms(text) {
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(',');
  const [iLat, iLon, iDate] = ['latitude', 'longitude', 'acq_date'].map((name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`FIRMS file has no column ${name}`);
    return i;
  });
  const points = [];
  for (let n = 1; n < lines.length; n++) {
    if (lines[n] === '') continue;
    const c = lines[n].split(',');
    const lat = Number(c[iLat]);
    const lon = Number(c[iLon]);
    const date = c[iDate];
    if (c[iLat] === '' || c[iLon] === '' || !Number.isFinite(lat) || !Number.isFinite(lon) || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
      throw new Error(`Invalid FIRMS row at line ${n + 1}: ${lines[n]}`);
    }
    points.push({ lat, lon, date });
  }
  return points;
}

// ---------- Motor ----------

function monthRange(from, to) {
  const months = [];
  for (let y = Number(from.slice(0, 4)), m = Number(from.slice(4)); `${y}${String(m).padStart(2, '0')}` <= to; m === 12 ? (y++, m = 1) : m++) {
    months.push(`${y}${String(m).padStart(2, '0')}`);
  }
  return months;
}

const maxDate = (points) => points.reduce((a, p) => (p.date > a ? p.date : a), '');
const cell = (v) => (v === null ? '' : String(v));

// archive, nrt: textos CSV de FIRMS (nrt puede ser null). Devuelve { files, reference (texto
// CSV), dropped (puntos fuera de todo departamento), lastDate }.
export function computeAnomalies({ archive, nrt, geojson, config }) {
  const points = readFirms(archive);
  const lastArchive = maxDate(points);
  if (nrt) points.push(...readFirms(nrt).filter((p) => p.date > lastArchive));
  if (!points.length) throw new Error('FIRMS files have no points');

  const depts = prepareDepartments(geojson);
  const months = monthRange(
    points.reduce((a, p) => (p.date < a ? p.date : a), points[0].date).slice(0, 7).replace('-', ''),
    maxDate(points).slice(0, 7).replace('-', ''),
  );
  const series = new Map(depts.map(({ in1 }) => [in1, new Map(months.map((m) => [m, 0]))]));
  let dropped = 0;
  for (const p of points) {
    const in1 = findDepartment(depts, p.lon, p.lat);
    if (!in1) {
      dropped++;
      continue;
    }
    const byMonth = series.get(in1);
    const month = p.date.slice(0, 4) + p.date.slice(5, 7);
    byMonth.set(month, byMonth.get(month) + 1);
  }

  const { byMonth, reference } = classifySeries(series, config.climatology);
  const refRows = [];
  for (const [in1, stats] of reference) {
    stats.forEach((s, i) => {
      const mm = String(i + 1).padStart(2, '0');
      refRows.push([in1, mm, ...(s ? [s.max, s.mean, s.min, s.std] : [null, null, null, null])].map(cell).join(','));
    });
  }
  return {
    files: monthFiles(byMonth, config),
    reference: ['in1,mes,max,promedio,min,desvio', ...refRows].join('\n') + '\n',
    dropped,
    lastDate: maxDate(points),
  };
}

// ---------- CLI ----------

function parseArgs(argv) {
  const opts = {
    firms: null,
    fuente: null,
    geojson: join(repoRoot, 'tools', 'raw', 'DEPTOS-PROV.geojson'),
    config: join(repoRoot, 'visor_deptos', 'config.json'),
    out: null,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in opts) || argv[i + 1] === undefined) {
      throw new Error(`Unknown or incomplete option: ${argv[i]}`);
    }
    opts[key] = argv[i + 1];
  }
  if (!opts.firms) throw new Error('Missing --firms <FIRMS download folder>');
  return opts;
}

// El único archivo de dir que coincide con prefix, o null si es opcional y no está.
function pick(dir, prefix, optional) {
  const found = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.csv'));
  if (found.length > 1) throw new Error(`More than one ${prefix}*.csv in ${dir}`);
  if (!found.length && !optional) throw new Error(`No ${prefix}*.csv in ${dir}`);
  return found.length ? join(dir, found[0]) : null;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dir = resolve(opts.firms);
  const archivePath = pick(dir, 'fire_archive_', false);
  const nrtPath = pick(dir, 'fire_nrt_', true);
  let geojson;
  try {
    geojson = JSON.parse(readFileSync(resolve(opts.geojson), 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read ${opts.geojson} (run node tools/build_geometry.mjs to download it): ${err.message}`);
  }
  const config = sourceConfig(readFileSync(resolve(opts.config), 'utf8'), opts.fuente);
  const { files, reference, dropped, lastDate } = computeAnomalies({
    archive: readFileSync(archivePath, 'utf8'),
    nrt: nrtPath && readFileSync(nrtPath, 'utf8'),
    geojson,
    config,
  });
  const out = resolve(opts.out ?? join(repoRoot, 'visor_deptos', 'datos', config.id));
  mkdirSync(out, { recursive: true });
  for (const { name, content } of files) writeFileSync(join(out, name), content);
  writeFileSync(join(out, 'referencia.csv'), reference);
  console.log(`Wrote ${files.length} monthly CSVs (${files[0].name} … ${files.at(-1).name}) and referencia.csv to ${out}`);
  console.log(`Last hotspot date: ${lastDate} (a month after it is incomplete). Points outside every department: ${dropped}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
