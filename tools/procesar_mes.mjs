#!/usr/bin/env node
// Actualización mensual manual (lo que se empaqueta como procesar_focos.exe, ver tools/build_exe.mjs).
// Toma la descarga de NASA FIRMS MODIS de un mes que está en la carpeta nasa/, cuenta los focos por
// departamento, clasifica el mes y escribe datos/<filePrefix>_AAAAMM.csv. Debe producir exactamente lo
// mismo que monthly_build de visor_deptos/lib/actualizar_mes.php: mantener ambos sincronizados.
//
// Uso:
//   procesar_focos.exe                         (usa nasa/ y datos/ junto al ejecutable)
//   node tools/procesar_mes.mjs --nasa <carpeta> [--datos visor_deptos/datos]
//        [--geojson tools/raw/DEPTOS-PROV.geojson] [--config visor_deptos/config.json]
//
// Todo .csv de nasa/, también dentro de subcarpetas (la carpeta DL_FIRE_* de FIRMS se puede dejar tal
// como viene), es una descarga de FIRMS; los fire_nrt_* cuentan solo después del último día de los
// demás (misma regla que compute_anomalies.mjs). Al terminar, todo lo que había en nasa/ se mueve a
// nasa/procesados/ para que no se mezcle con la descarga del mes siguiente.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import sea from 'node:sea';
import { fileURLToPath } from 'node:url';

import { findDepartment, prepareDepartments, readFirms } from './compute_anomalies.mjs';
import { anomalyClass } from './convert_excel.mjs';

// [in1, valor] de un CSV mensual, con la misma lectura que series_parse_csv de lib/series.php.
function readMonthValues(text, name, config) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const [iIn1, iValue, iAnom] = ['in1', config.columns.value, config.columns.anomaly].map((c) => header.indexOf(c));
  if (iIn1 < 0 || iValue < 0 || iAnom < 0) {
    throw new Error(`${name} no tiene las columnas in1,${config.columns.value},${config.columns.anomaly}`);
  }
  const values = [];
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const in1 = (c[iIn1] ?? '').trim();
    const text = (c[iValue] ?? '').trim();
    if (!/^\d{5}$/.test(in1) || text === '' || !Number.isFinite(Number(text))) continue;
    values.push([in1, config.integerValues ? Math.round(Number(text)) : Number(text)]);
  }
  return values;
}

const PROCESSED = 'procesados';

// Procesa la descarga de FIRMS de nasaDir y escribe el mes en datosDir. Devuelve { month, name,
// assigned, outside }. Valida todo antes de escribir: ante un error las carpetas quedan como estaban.
export function processMonth({ nasaDir, datosDir, geojson, config }) {
  if (!existsSync(nasaDir)) throw new Error(`No existe la carpeta ${nasaDir}: créela y copie ahí la descarga de NASA`);
  const downloads = readdirSync(nasaDir, { recursive: true })
    .filter((f) => f.toLowerCase().endsWith('.csv') && f.split(sep)[0] !== PROCESSED)
    .sort();
  if (!downloads.length) throw new Error(`No hay ningún CSV de NASA en ${nasaDir}`);

  const isNrt = (f) => basename(f).startsWith('fire_nrt');
  const read = (f) => {
    try {
      return readFirms(readFileSync(join(nasaDir, f), 'utf8'));
    } catch (err) {
      throw new Error(`${f}: ${err.message}`);
    }
  };
  const points = downloads.filter((f) => !isNrt(f)).flatMap(read);
  const lastArchive = points.reduce((a, p) => (p.date > a ? p.date : a), '');
  for (const f of downloads.filter(isNrt)) points.push(...read(f).filter((p) => p.date > lastArchive));
  if (!points.length) throw new Error(`${downloads.join(', ')} no tiene focos`);

  const months = [...new Set(points.map((p) => p.date.slice(0, 7)))].sort();
  if (months.length > 1) {
    throw new Error(`La descarga tiene focos de ${months.slice(0, -1).join(', ')} y ${months.at(-1)}: descargue un solo mes`);
  }
  const month = months[0].replace('-', '');

  const depts = prepareDepartments(geojson);
  const counts = new Map(depts.map(({ in1 }) => [in1, 0]));
  let outside = 0;
  for (const p of points) {
    const in1 = findDepartment(depts, p.lon, p.lat);
    if (in1) counts.set(in1, counts.get(in1) + 1);
    else outside++;
  }

  // Referencia: el mismo mes calendario dentro de la climatología, sin el archivo previo de este mes;
  // si el mes cae dentro de la climatología, entran sus conteos nuevos.
  const { from, to } = config.climatology;
  const reference = new Map();
  const add = (in1, v) => reference.set(in1, [...(reference.get(in1) ?? []), v]);
  const monthly = new RegExp(`^${config.filePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d{6})\\.csv$`);
  for (const f of readdirSync(datosDir).sort()) {
    const m = f.match(monthly)?.[1];
    if (!m || m === month || m.slice(4) !== month.slice(4) || m < from || m > to) continue;
    for (const [in1, v] of readMonthValues(readFileSync(join(datosDir, f), 'utf8'), f, config)) add(in1, v);
  }
  if (month >= from && month <= to) for (const [in1, n] of counts) add(in1, n);

  const rows = [`in1,${config.columns.value},${config.columns.anomaly}`];
  for (const [in1, n] of counts) {
    const values = reference.get(in1);
    const cls = values
      ? anomalyClass(n, { max: Math.max(...values), mean: values.reduce((a, b) => a + b, 0) / values.length, min: Math.min(...values) })
      : '';
    rows.push(`${in1},${n},${cls}`);
  }

  const name = `${config.filePrefix}_${month}.csv`;
  const tmp = join(datosDir, `${name}.tmp`);
  try {
    writeFileSync(tmp, rows.join('\n') + '\n');
    renameSync(tmp, join(datosDir, name));
  } catch (err) {
    rmSync(tmp, { force: true });
    throw new Error(`No se pudo escribir ${name} en ${datosDir}: ${err.message}`);
  }
  // Se mueve todo lo de nasa/ (también el Readme.txt de FIRMS). Una descarga con el mismo nombre que
  // otra ya procesada es la misma descarga reprocesada: reemplaza a la copia anterior.
  const processed = join(nasaDir, PROCESSED);
  mkdirSync(processed, { recursive: true });
  for (const entry of readdirSync(nasaDir)) {
    if (entry === PROCESSED) continue;
    rmSync(join(processed, entry), { recursive: true, force: true });
    renameSync(join(nasaDir, entry), join(processed, entry));
  }
  return { month, name, assigned: points.length - outside, outside };
}

// ---------- CLI ----------

function parseArgs(argv) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const opts = {
    nasa: null,
    datos: join(repoRoot, 'visor_deptos', 'datos'),
    geojson: join(repoRoot, 'tools', 'raw', 'DEPTOS-PROV.geojson'),
    config: join(repoRoot, 'visor_deptos', 'config.json'),
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in opts) || argv[i + 1] === undefined) throw new Error(`Unknown or incomplete option: ${argv[i]}`);
    opts[key] = argv[i + 1];
  }
  if (!opts.nasa) throw new Error('Missing --nasa <folder with the FIRMS download>');
  return opts;
}

// Se quita un BOM UTF-8, como hace lib/config.php.
const parseJson = (text) => JSON.parse(text.replace(/^﻿/, ''));

function main() {
  if (sea.isSea()) {
    // La geometría y config.json van embebidos en el .exe; nasa/ y datos/ están junto al ejecutable.
    const here = dirname(process.execPath);
    return processMonth({
      nasaDir: join(here, 'nasa'),
      datosDir: join(here, 'datos'),
      geojson: parseJson(sea.getAsset('geojson', 'utf8')),
      config: parseJson(sea.getAsset('config', 'utf8')),
    });
  }
  const opts = parseArgs(process.argv.slice(2));
  return processMonth({
    nasaDir: resolve(opts.nasa),
    datosDir: resolve(opts.datos),
    geojson: parseJson(readFileSync(resolve(opts.geojson), 'utf8')),
    config: parseJson(readFileSync(resolve(opts.config), 'utf8')),
  });
}

// En el .exe, process.argv[1] es el ejecutable: por eso se usa sea.isSea().
if (sea.isSea() || (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  let code = 0;
  try {
    const { month, name, assigned, outside } = main();
    console.log(`${month}: ${assigned} focos asignados, ${outside} fuera de todo departamento -> datos/${name}`);
    console.log('La descarga de NASA se movió a nasa/procesados/.');
  } catch (err) {
    console.error(`Error: ${err.message}`);
    code = 1;
  }
  if (sea.isSea()) {
    // Con doble clic la consola se cierra al terminar: se espera Enter para que se pueda leer el resultado.
    createInterface({ input: process.stdin, output: process.stdout }).question('\nPresione Enter para salir...', () => process.exit(code));
  } else {
    process.exitCode = code;
  }
}
