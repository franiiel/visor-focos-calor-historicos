#!/usr/bin/env node
// One-time tool: builds visor_deptos/deptos.geo.json from SEPA's DEPTOS-PROV.geojson.
//
// Usage:
//   node tools/build_geometry.mjs [--raw tools/raw] [--out visor_deptos/deptos.geo.json] [--simplify 3%]
//
// Steps:
//   1. Download DEPTOS-PROV.geojson into the raw directory if it is not there yet.
//      The raw file is treated as untrusted data: it is only parsed as JSON, never executed.
//   2. Normalize properties: in1 = LINK zero padded to 5 chars (Buenos Aires codes come
//      unpadded, e.g. "6441"), depto, provincia. The `id` property is never used.
//   3. Run a pinned mapshaper (via npx) to dissolve the multiple polygons of each
//      department into one feature, simplify preserving topology, and reduce precision.
//   4. Validate and report feature count, duplicate/missing codes, and file size.

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Pinned exact version, published 2026-09-09 (more than 14 days before adoption).
const MAPSHAPER = 'mapshaper@0.7.61';
const SOURCE_URL =
  'https://sepa.inta.gob.ar/productos/focos/seccion-focos/data/geoJSON/DEPTOS-PROV.geojson';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const opts = {
    raw: join(repoRoot, 'tools', 'raw'),
    out: join(repoRoot, 'visor_deptos', 'deptos.geo.json'),
    simplify: '3%',
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in opts) || argv[i + 1] === undefined) {
      throw new Error(`Unknown or incomplete option: ${argv[i]}`);
    }
    opts[key] = key === 'simplify' ? argv[i + 1] : resolve(argv[i + 1]);
  }
  return opts;
}

async function download(url, dest) {
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

export function normalizeFeatures(collection) {
  const features = collection.features.map((f) => {
    const link = String(f.properties.LINK ?? '').trim();
    if (!/^\d{4,5}$/.test(link)) {
      throw new Error(`Unexpected LINK value: ${JSON.stringify(f.properties.LINK)}`);
    }
    return {
      type: 'Feature',
      properties: {
        in1: link.padStart(5, '0'),
        depto: String(f.properties.DEPTO ?? '').trim(),
        provincia: String(f.properties.PROVINCIA ?? '').trim(),
      },
      geometry: f.geometry,
    };
  });
  return { type: 'FeatureCollection', features };
}

// Runs npx through the npm CLI bundled with the current Node, without a shell, so
// paths with spaces are passed safely on every platform.
function runNpx(args) {
  const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  const [cmd, cmdArgs] = existsSync(npxCli)
    ? [process.execPath, [npxCli, ...args]]
    : ['npx', args];
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', cwd: repoRoot });
  if (r.status !== 0) throw new Error(`npx ${args.join(' ')} failed with status ${r.status}`);
}

function report(outPath, sourceCodes) {
  const out = JSON.parse(readFileSync(outPath, 'utf8'));
  const codes = out.features.map((f) => f.properties.in1);
  const seen = new Set();
  const duplicates = codes.filter((c) => (seen.has(c) ? true : (seen.add(c), false)));
  const invalid = codes.filter((c) => typeof c !== 'string' || !/^\d{5}$/.test(c));
  const missing = [...sourceCodes].filter((c) => !seen.has(c));
  const extraKeys = out.features.filter(
    (f) => Object.keys(f.properties).sort().join() !== 'depto,in1,provincia',
  ).length;
  const sizeKb = (statSync(outPath).size / 1024).toFixed(1);
  console.log(`Output: ${outPath}`);
  console.log(`Features: ${out.features.length} (source departments: ${sourceCodes.size})`);
  console.log(`Duplicate in1: ${duplicates.length}, invalid in1: ${invalid.length}, missing vs source: ${missing.length}`);
  console.log(`Features with unexpected properties: ${extraKeys}`);
  console.log(`Size: ${sizeKb} KB`);
  if (duplicates.length || invalid.length || missing.length || extraKeys) {
    throw new Error('Geometry validation failed');
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(opts.raw, { recursive: true });
  const rawFile = join(opts.raw, 'DEPTOS-PROV.geojson');
  if (!existsSync(rawFile)) await download(SOURCE_URL, rawFile);

  const source = JSON.parse(readFileSync(rawFile, 'utf8'));
  const normalized = normalizeFeatures(source);
  const sourceCodes = new Set(normalized.features.map((f) => f.properties.in1));
  console.log(`Source features: ${source.features.length}, distinct departments: ${sourceCodes.size}`);

  const prepared = join(opts.raw, 'deptos_normalized.geojson');
  writeFileSync(prepared, JSON.stringify(normalized));
  mkdirSync(dirname(opts.out), { recursive: true });

  runNpx([
    '--yes',
    MAPSHAPER,
    prepared,
    '-dissolve', 'in1', 'copy-fields=depto,provincia',
    '-simplify', opts.simplify, 'keep-shapes',
    '-o', opts.out, 'format=geojson', 'precision=0.0001', 'force',
  ]);

  report(opts.out, sourceCodes);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
