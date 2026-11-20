#!/usr/bin/env node
// Actualización mensual manual (lo que se empaqueta como procesar_focos.exe, ver tools/build_exe.mjs).
// Toma la descarga de NASA FIRMS que está en la carpeta nasa/, cuenta los focos por departamento,
// clasifica cada mes y escribe datos/<fuente>/<filePrefix>_AAAAMM.csv (uno por mes, como si se
// procesaran de a uno en orden; avisa si el primer o el último mes puede estar incompleto). Debe producir
// exactamente lo mismo que monthly_build de visor_deptos/lib/actualizar_mes.php: mantener ambos sincronizados.
// Si la descarga cubre toda la climatología (p. ej. el archive completo de FIRMS), en cambio rearma
// todos los meses y referencia.csv, con el mismo resultado que tools/compute_anomalies.mjs.
//
// Uso:
//   procesar_focos.exe [--fuente viirs]   (procesa cada nasa/<fuente>/ con descargas nuevas -> datos/<fuente>/,
//                                          ambas junto al ejecutable, con la referencia fija de
//                                          visor_deptos/datos/<fuente>/referencia.csv, al lado o un nivel
//                                          arriba; con --fuente, solo esa)
//   node tools/procesar_mes.mjs --nasa <carpeta> [--fuente modis] [--datos visor_deptos/datos/<fuente>]
//        [--geojson tools/raw/DEPTOS-PROV.geojson] [--config visor_deptos/config.json]
//
// --fuente es un id de `sources` en config.json (por defecto, la primera); define la climatología y la
// carpeta de datos. La descarga tiene que ser de ese sensor.
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

import { buildHistory, findDepartment, monthRange, prepareDepartments, readFirms } from './compute_anomalies.mjs';
import { anomalyClass, sourceConfig } from './convert_excel.mjs';

// referencia.csv (in1,mes,max,promedio,min,…, como la escribe compute_anomalies.mjs) como
// Map<'in1-MM', { max, mean, min }>. Es la referencia fija del período de climatología: el mes nuevo se
// clasifica contra ella y no la modifica. Las filas sin valores (sin datos en el período) se omiten.
function readReference(path, { from, to }) {
  if (!existsSync(path)) {
    throw new Error(`No está ${path}: hace falta para calcular la anomalía (máximo, promedio y mínimo de ${from}–${to})`);
  }
  const lines = readFileSync(path, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
  // Una planilla puede volver a guardarlo con comillas en cada celda: se quitan, como hace fgetcsv en el cron PHP.
  // ponytail: no admite comas dentro de una celda; referencia.csv solo tiene códigos y números.
  const cells = (line) => line.split(',').map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim());
  const header = cells(lines[0]).map((h) => h.toLowerCase());
  const cols = ['in1', 'mes', 'max', 'promedio', 'min'].map((c) => header.indexOf(c));
  if (cols.some((i) => i < 0)) throw new Error(`${path} no tiene las columnas in1,mes,max,promedio,min`);
  const reference = new Map();
  for (const line of lines.slice(1)) {
    const row = cells(line);
    const [in1, mes, ...stats] = cols.map((i) => row[i] ?? '');
    if (!/^\d{5}$/.test(in1) || !/^\d{2}$/.test(mes) || stats.some((s) => s === '' || !Number.isFinite(Number(s)))) continue;
    const [max, mean, min] = stats.map(Number);
    reference.set(`${in1}-${mes}`, { max, mean, min });
  }
  if (!reference.size) throw new Error(`${path} no tiene ninguna fila con referencia`);
  return reference;
}

const PROCESSED = 'procesados';

// Procesa la descarga de FIRMS de nasaDir y escribe el mes en datosDir; la referencia se lee de
// historyDir/referencia.csv (por defecto, la misma carpeta; null si no hay de dónde leerla, que solo es
// válido para armar el histórico completo). Devuelve { month, name, assigned, outside }.
// Valida todo antes de escribir: ante un error las carpetas quedan como estaban.
export function processMonth({ nasaDir, datosDir, historyDir = datosDir, geojson, config, log = () => {} }) {
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
  log(`  leyendo ${downloads.join(', ')}…`);
  const points = downloads.filter((f) => !isNrt(f)).flatMap(read);
  const lastArchive = points.reduce((a, p) => (p.date > a ? p.date : a), '');
  // Sin push(...array): con cientos de miles de focos supera el límite de argumentos.
  for (const f of downloads.filter(isNrt)) for (const p of read(f)) if (p.date > lastArchive) points.push(p);
  if (!points.length) throw new Error(`${downloads.join(', ')} no tiene focos`);

  const dates = points.map((p) => p.date).sort();
  const [firstDate, lastDate] = [dates[0], dates.at(-1)];
  // Todos los meses entre el primero y el último: uno sin focos en el medio también se escribe, con ceros.
  const months = monthRange(firstDate.slice(0, 7).replace('-', ''), lastDate.slice(0, 7).replace('-', ''));
  const { from, to } = config.climatology;
  const [first, last] = [months[0], months.at(-1)];
  const ym = (m) => `${m.slice(0, 4)}-${m.slice(4)}`;
  if (first <= from && last >= to) {
    // Una descarga que cubre toda la climatología permite recalcular la referencia desde cero.
    log(`  ${points.length} focos de ${ym(first)} a ${ym(last)}: se rearma el histórico completo (tarda unos minutos)`);
    const { files, reference, dropped } = buildHistory(points, geojson, config, log);
    log(`  escribiendo ${files.length} meses y referencia.csv…`);
    writeAll(datosDir, [...files, { name: 'referencia.csv', content: reference }]);
    moveToProcessed(nasaDir);
    return {
      month: `${first} a ${last}`,
      name: `${files[0].name} … ${files.at(-1).name}`,
      files: files.length,
      rebuilt: true,
      assigned: points.length - dropped,
      outside: dropped,
    };
  }
  // La referencia es fija: un mes del período de climatología solo se rehace con el histórico completo.
  const inside = months.find((m) => m >= from && m <= to);
  if (inside) {
    throw new Error(`${ym(inside)} está dentro del período de referencia (${from}–${to}): solo se procesan meses nuevos; para rehacer el histórico, use una descarga que cubra todo el período`);
  }
  if (!historyDir) {
    throw new Error('No se encontró la carpeta visor_deptos junto al programa ni en la carpeta de arriba: de visor_deptos/datos/<fuente>/referencia.csv se lee la referencia');
  }
  const reference = readReference(join(historyDir, 'referencia.csv'), config.climatology);

  // FIRMS solo trae los días con focos: un mes que empieza después del día 1 o termina antes del último
  // día puede estar incompleto (o ser el mes en curso). Se procesa igual, pero se avisa.
  const dmy = (d) => d.split('-').reverse().join('/');
  log(`  datos del ${dmy(firstDate)} al ${dmy(lastDate)}`);
  if (firstDate.slice(8) !== '01') log(`  AVISO: ${ym(first)} empieza el ${dmy(firstDate)}: puede estar incompleto.`);
  const lastDay = new Date(Date.UTC(Number(lastDate.slice(0, 4)), Number(lastDate.slice(5, 7)), 0)).getUTCDate();
  if (Number(lastDate.slice(8)) !== lastDay) {
    log(`  AVISO: ${ym(last)} termina el ${dmy(lastDate)}: puede estar incompleto (si el mes no terminó, vuelva a procesarlo cuando termine).`);
  }

  log(`  ${points.length} focos de ${months.length === 1 ? ym(first) : `${ym(first)} a ${ym(last)}`}: asignando a departamentos…`);
  const depts = prepareDepartments(geojson);
  const counts = new Map(months.map((m) => [m, new Map(depts.map(({ in1 }) => [in1, 0]))]));
  let outside = 0;
  for (const p of points) {
    const in1 = findDepartment(depts, p.lon, p.lat);
    if (!in1) {
      outside++;
      continue;
    }
    const byDept = counts.get(p.date.slice(0, 4) + p.date.slice(5, 7));
    byDept.set(in1, byDept.get(in1) + 1);
  }

  const files = months.map((month) => {
    const rows = [`in1,${config.columns.value},${config.columns.anomaly}`];
    for (const [in1, n] of counts.get(month)) {
      const stats = reference.get(`${in1}-${month.slice(4)}`);
      rows.push(`${in1},${n},${stats ? anomalyClass(n, stats) : ''}`);
    }
    return { name: `${config.filePrefix}_${month}.csv`, content: rows.join('\n') + '\n' };
  });

  writeAll(datosDir, files);
  moveToProcessed(nasaDir);
  if (files.length === 1) return { month: first, name: files[0].name, assigned: points.length - outside, outside };
  return { month: `${first} a ${last}`, name: `${files[0].name} … ${files.at(-1).name}`, files: files.length, assigned: points.length - outside, outside };
}

// Escribe primero todos los .tmp y recién después los renombra, para no dejar archivos a medias.
function writeAll(datosDir, files) {
  try {
    mkdirSync(datosDir, { recursive: true });
    for (const { name, content } of files) writeFileSync(join(datosDir, `${name}.tmp`), content);
    for (const { name } of files) renameSync(join(datosDir, `${name}.tmp`), join(datosDir, name));
  } catch (err) {
    for (const { name } of files) rmSync(join(datosDir, `${name}.tmp`), { force: true });
    throw new Error(`No se pudo escribir en ${datosDir}: ${err.message}`);
  }
}

// Se mueve todo lo de nasa/ (también el Readme.txt de FIRMS). Una descarga con el mismo nombre que
// otra ya procesada es la misma descarga reprocesada: reemplaza a la copia anterior.
function moveToProcessed(nasaDir) {
  const processed = join(nasaDir, PROCESSED);
  mkdirSync(processed, { recursive: true });
  for (const entry of readdirSync(nasaDir)) {
    if (entry === PROCESSED) continue;
    rmSync(join(processed, entry), { recursive: true, force: true });
    renameSync(join(nasaDir, entry), join(processed, entry));
  }
}

// Lo que corre el .exe: procesa cada fuente de config.json que tiene una descarga nueva en
// <root>/nasa/<id>/ (sin distinguir mayúsculas). Lee la referencia de visor_deptos/datos/<id>/referencia.csv
// (junto a root o un nivel arriba) y escribe el mes solo en <root>/datos/<id>/: visor_deptos/ nunca se modifica.
// Con fuente, solo esa. Devuelve [{ id, datosDir, ...resultado de processMonth } | { id, error }]: el
// error de una fuente no impide procesar las demás.
export function processSources({ root, geojson, configText, fuente = null, log = () => {} }) {
  // visor_deptos/ junto al programa o en la carpeta de arriba (p. ej. el .exe en dist/ dentro del repositorio).
  // Solo hace falta para leer la referencia: el histórico completo se arma sin ella (ver processMonth).
  const visorDir = [join(root, 'visor_deptos'), join(dirname(root), 'visor_deptos')].find((d) => existsSync(d));
  const nasaRoot = join(root, 'nasa');
  const entries = existsSync(nasaRoot) ? readdirSync(nasaRoot) : [];
  const ids = fuente ? [sourceConfig(configText, fuente).id] : JSON.parse(configText.replace(/^﻿/, '')).sources.map((s) => s.id);
  const nasaDirOf = (id) => join(nasaRoot, entries.find((e) => e.toLowerCase() === id) ?? id);
  const pending = fuente ? ids : ids.filter((id) => hasDownloads(nasaDirOf(id)));
  if (!pending.length) throw new Error(`No hay descargas nuevas en ${ids.map((id) => `nasa/${id}`).join(' ni en ')}`);
  return pending.map((id) => {
    const config = sourceConfig(configText, id);
    const datosDir = join(root, 'datos', id);
    const historyDir = visorDir ? join(visorDir, 'datos', id) : null;
    try {
      log(`${id}: procesando ${nasaDirOf(id)}${historyDir ? ` con la referencia de ${historyDir}` : ''}`);
      return { id, datosDir, ...processMonth({ nasaDir: nasaDirOf(id), datosDir, historyDir, geojson, config, log }) };
    } catch (err) {
      return { id, error: err.message };
    }
  });
}

const hasDownloads = (dir) =>
  existsSync(dir) && readdirSync(dir, { recursive: true }).some((f) => f.toLowerCase().endsWith('.csv') && f.split(sep)[0] !== PROCESSED);

// ---------- CLI ----------

// En el .exe solo se acepta --fuente: el resto va embebido o está junto al ejecutable.
function parseArgs(argv, isExe) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const opts = isExe
    ? { fuente: null }
    : {
      nasa: null,
      fuente: null,
      datos: null,
      geojson: join(repoRoot, 'tools', 'raw', 'DEPTOS-PROV.geojson'),
      config: join(repoRoot, 'visor_deptos', 'config.json'),
    };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in opts) || argv[i + 1] === undefined) throw new Error(`Unknown or incomplete option: ${argv[i]}`);
    opts[key] = argv[i + 1];
  }
  if (!isExe && !opts.nasa) throw new Error('Missing --nasa <folder with the FIRMS download>');
  return { ...opts, repoRoot };
}

function main() {
  const opts = parseArgs(process.argv.slice(2), sea.isSea());
  if (sea.isSea()) {
    // La geometría y config.json van embebidos en el .exe; nasa/<fuente>/ y datos/<fuente>/ están junto al
    // ejecutable, y visor_deptos/ (solo lectura) al lado o un nivel arriba.
    return processSources({
      root: dirname(process.execPath),
      geojson: JSON.parse(sea.getAsset('geojson', 'utf8').replace(/^﻿/, '')),
      configText: sea.getAsset('config', 'utf8'),
      fuente: opts.fuente,
      log: console.log,
    });
  }
  const config = sourceConfig(readFileSync(resolve(opts.config), 'utf8'), opts.fuente);
  const datosDir = resolve(opts.datos ?? join(opts.repoRoot, 'visor_deptos', 'datos', config.id));
  return [{
    id: config.id,
    datosDir,
    ...processMonth({
      nasaDir: resolve(opts.nasa),
      datosDir,
      geojson: JSON.parse(readFileSync(resolve(opts.geojson), 'utf8').replace(/^﻿/, '')),
      config,
      log: console.log,
    }),
  }];
}

// En el .exe, process.argv[1] es el ejecutable: por eso se usa sea.isSea().
if (sea.isSea() || (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  let code = 0;
  try {
    for (const { id, error, month, name, files, rebuilt, assigned, outside, datosDir } of main()) {
      if (error) {
        console.error(`${id}: Error: ${error}`);
        code = 1;
        continue;
      }
      const where = files ? `${files} meses${rebuilt ? ' y referencia.csv' : ''} en ${datosDir} (${name})` : join(datosDir, name);
      console.log(`${id} ${month}: ${assigned} focos asignados, ${outside} fuera de todo departamento -> ${where}`);
      console.log(`${id}: la descarga de NASA se movió a procesados/.`);
    }
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
