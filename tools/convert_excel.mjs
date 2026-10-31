#!/usr/bin/env node
// Converts SEPA's department workbook (ESTADISTICAS-DEPARTAMENTALES*.xlsx) into the
// viewer's monthly CSVs: datos/<filePrefix>_AAAAMM.csv with `in1,<value>,<anomaly>`.
//
// Usage:
//   node tools/convert_excel.mjs --xlsx ESTADISTICAS-DEPARTAMENTALES2026.xlsx
//        [--config visor_deptos/config.json] [--out visor_deptos/datos]
//
// Reads two sheets: FCXMESXAÑO (hotspots per year, province and department name, one
// column per month) and ESTADISTICAS (COD_PROV + COD_DEPTO per name). The anomaly is
// SEPA's class 1-5 (see VISOR_FOCOS.md), computed against the config.json climatology.
// Node stdlib only: the .xlsx zip and its XML are read directly.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HISTORY_SHEET = 'FCXMESXAÑO';
const CODES_SHEET = 'ESTADISTICAS';
const MONTH_HEADERS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

// ---------- .xlsx reading ----------

// Returns Map<entry name, Buffer> for a zip without zip64 or encryption.
function readZip(buf) {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('Not a zip file (.xlsx expected)');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const skip = nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method === 8) entries.set(name, inflateRawSync(data));
    else if (method === 0) entries.set(name, data);
    p += 46 + skip;
  }
  return entries;
}

function decodeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
  });
}

const attr = (tag, name) => decodeXml(tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? '');
const texts = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join('');

function colIndex(ref) {
  return [...ref.replace(/\d+/g, '')].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

// Returns { [sheetName]: rows }, where a row is an array of cell texts ('' when empty).
export function readXlsxSheets(buf, names) {
  const zip = readZip(buf);
  const read = (path) => zip.get(path)?.toString('utf8');
  const shared = [...(read('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const targets = new Map(
    [...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]),
  );
  const sheetIds = new Map(
    [...read('xl/workbook.xml').matchAll(/<sheet\s[^>]*>/g)].map((m) => [attr(m[0], 'name'), attr(m[0], 'r:id')]),
  );
  const result = {};
  for (const name of names) {
    const target = targets.get(sheetIds.get(name));
    if (!target) throw new Error(`Sheet "${name}" not found in the workbook`);
    const xml = read(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    result[name] = [...xml.matchAll(/<row[\s>][\s\S]*?<\/row>/g)].map((r) => {
      const cells = [];
      for (const c of r[0].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const body = c[2] ?? '';
        const value = /\st="inlineStr"/.test(` ${c[1]}`) ? texts(body) : decodeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
        cells[colIndex(attr(` ${c[1]}`, 'r'))] = /\st="s"/.test(` ${c[1]}`) ? shared[Number(value)] : value;
      }
      return Array.from(cells, (v) => (v ?? '').trim());
    });
  }
  return result;
}

// ---------- Classes ----------

// SEPA's rule: SI(fc>MAX;5;SI(fc>MD+10%;4;SI(fc>MD-10%;3;SI(fc>MIN;2;1)))).
// The band uses the workbook's arithmetic (MD*10/100) so edge cases match it.
export function anomalyClass(focos, { max, mean, min }) {
  const tenth = (mean * 10) / 100;
  if (focos > max) return 5;
  if (focos > mean + tenth) return 4;
  if (focos > mean - tenth) return 3;
  if (focos > min) return 2;
  return 1;
}

// Reference statistics of the values present for one department and calendar month.
// std is the sample standard deviation, as Excel's STDEV (null with a single value).
export function referenceStats(values) {
  if (!values.length) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const std = values.length > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1)) : null;
  return { max: Math.max(...values), mean, min: Math.min(...values), std };
}

// series: Map<in1, Map<AAAAMM, value>>. Returns { byMonth: Map<AAAAMM, [[in1, value,
// class|null], ...]> sorted by month and in1, reference: Map<in1, [12 × stats|null]> }.
// The reference of each calendar month uses the values inside the climatology period.
export function classifySeries(series, climatology) {
  const result = new Map();
  const references = new Map();
  for (const in1 of [...series.keys()].sort()) {
    const byMonth = series.get(in1);
    const reference = Array.from({ length: 12 }, (_, i) => {
      const mm = String(i + 1).padStart(2, '0');
      return referenceStats([...byMonth].filter(([m]) => m.endsWith(mm) && m >= climatology.from && m <= climatology.to).map(([, v]) => v));
    });
    references.set(in1, reference);
    for (const [month, focos] of byMonth) {
      const ref = reference[Number(month.slice(4)) - 1];
      if (!result.has(month)) result.set(month, []);
      result.get(month).push([in1, focos, ref ? anomalyClass(focos, ref) : null]);
    }
  }
  return { byMonth: new Map([...result].sort(([a], [b]) => a.localeCompare(b))), reference: references };
}

// history: [{ year, prov, depto, values: [12 × number|null] }]; codes: Map<"PROV|DEPTO", in1>.
// Returns { byMonth: Map<AAAAMM, [[in1, focos, class|null], ...]> sorted by month and
// in1, skipped: ["in1 PROV / DEPTO year (n rows)", ...] }. A department without a row
// (or an empty cell) has no row that month, and the reference statistics use only the
// years that have a value, as the workbook does. A department with more than one row
// for a year is ambiguous (the workbook has rows with a mistyped year), so that year
// is left without data and reported instead of guessing which row is right.
export function buildMonthlyRows(history, codes, climatology) {
  const rowsByYear = new Map(); // "in1|year" -> rows
  const unknown = new Set();
  for (const row of history) {
    const in1 = codes.get(`${row.prov}|${row.depto}`);
    if (!in1) {
      unknown.add(`${row.prov} / ${row.depto}`);
      continue;
    }
    const key = `${in1}|${row.year}`;
    rowsByYear.set(key, [...(rowsByYear.get(key) ?? []), row]);
  }
  if (unknown.size) throw new Error(`Departments without a code in ${CODES_SHEET}: ${[...unknown].join(', ')}`);

  const series = new Map(); // in1 -> Map<AAAAMM, focos>
  const skipped = [];
  for (const [key, rows] of rowsByYear) {
    const in1 = key.split('|')[0];
    const { year, prov, depto, values } = rows[0];
    if (rows.length > 1) {
      skipped.push(`${in1} ${prov} / ${depto} ${year} (${rows.length} rows)`);
      continue;
    }
    if (!series.has(in1)) series.set(in1, new Map());
    values.forEach((v, i) => {
      if (v !== null) series.get(in1).set(`${year}${String(i + 1).padStart(2, '0')}`, v);
    });
  }

  return { byMonth: classifySeries(series, climatology).byMonth, skipped: skipped.sort() };
}

// ---------- Workbook -> CSV files ----------

function columns(header, wanted, sheet) {
  return wanted.map((name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Sheet "${sheet}" has no column ${name}`);
    return i;
  });
}

function count(text, where) {
  if (text === '') return null;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Not a hotspot count: "${text}" (${where})`);
  return n;
}

// Returns { files: [{ name, content }] for every month, skipped } (see buildMonthlyRows).
export function convertWorkbook(buf, config) {
  const sheets = readXlsxSheets(buf, [HISTORY_SHEET, CODES_SHEET]);

  const [codeHeader, ...codeRows] = sheets[CODES_SHEET];
  const [iProvCode, iDeptoCode, iProvName, iDeptoName] = columns(codeHeader, ['COD_PROV', 'COD_DEPTO', 'PROV', 'DEPTO'], CODES_SHEET);
  const codes = new Map();
  for (const r of codeRows) {
    if (!/^\d{1,2}$/.test(r[iProvCode] ?? '') || !/^\d{1,3}$/.test(r[iDeptoCode] ?? '')) continue; // totals, blanks
    codes.set(`${r[iProvName]}|${r[iDeptoName]}`, r[iProvCode].padStart(2, '0') + r[iDeptoCode].padStart(3, '0'));
  }

  const [histHeader, ...histRows] = sheets[HISTORY_SHEET];
  const [iYear, iProv, iDepto, ...iMonths] = columns(histHeader, ['AÑO', 'PROV', 'DEPTO', ...MONTH_HEADERS], HISTORY_SHEET);
  const history = histRows
    .filter((r) => /^\d{4}$/.test(r[iYear] ?? ''))
    .map((r) => ({
      year: Number(r[iYear]),
      prov: r[iProv],
      depto: r[iDepto],
      values: iMonths.map((i, m) => count(r[i] ?? '', `${r[iYear]} ${r[iProv]} / ${r[iDepto]} ${MONTH_HEADERS[m]}`)),
    }));

  const { byMonth, skipped } = buildMonthlyRows(history, codes, config.climatology);
  return { files: monthFiles(byMonth, config), skipped };
}

// byMonth (see classifySeries) -> [{ name: '<filePrefix>_AAAAMM.csv', content }].
export function monthFiles(byMonth, config) {
  const header = `in1,${config.columns.value},${config.columns.anomaly}`;
  return [...byMonth].map(([month, rows]) => ({
    name: `${config.filePrefix}_${month}.csv`,
    content: [header, ...rows.map(([in1, focos, cls]) => `${in1},${focos},${cls ?? ''}`)].join('\n') + '\n',
  }));
}

function parseArgs(argv) {
  const opts = {
    xlsx: null,
    config: join(repoRoot, 'visor_deptos', 'config.json'),
    out: join(repoRoot, 'visor_deptos', 'datos'),
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in opts) || argv[i + 1] === undefined) {
      throw new Error(`Unknown or incomplete option: ${argv[i]}`);
    }
    opts[key] = argv[i + 1];
  }
  if (!opts.xlsx) throw new Error('Missing --xlsx <ESTADISTICAS-DEPARTAMENTALES.xlsx>');
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  // Strip a UTF-8 BOM, as lib/config.php does.
  const config = JSON.parse(readFileSync(resolve(opts.config), 'utf8').replace(/^﻿/, ''));
  const { files, skipped } = convertWorkbook(readFileSync(resolve(opts.xlsx)), config);
  const out = resolve(opts.out);
  mkdirSync(out, { recursive: true });
  for (const { name, content } of files) writeFileSync(join(out, name), content);
  console.log(`Wrote ${files.length} monthly CSVs (${files[0]?.name} … ${files.at(-1)?.name}) to ${out}`);
  if (skipped.length) {
    console.warn(`Warning: ${skipped.length} department-years have more than one row and were left without data:`);
    for (const s of skipped) console.warn(`  ${s}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
