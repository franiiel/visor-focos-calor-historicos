#!/usr/bin/env node
// Empaqueta tools/procesar_mes.mjs como dist/procesar_focos.exe (Single Executable Application de Node),
// con DEPTOS-PROV.geojson y config.json embebidos. El .exe no necesita Node ni PHP instalados.
//
// Uso (en Windows, porque el ejecutable es una copia del node.exe actual):
//   node tools/build_exe.mjs [--geojson tools/raw/DEPTOS-PROV.geojson] [--config visor_deptos/config.json]

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runNpx } from './build_geometry.mjs';

// Versiones exactas fijadas, publicadas hace más de 14 días.
const ESBUILD = 'esbuild@0.25.12';
const POSTJECT = 'postject@1.0.0-alpha.6';
// Marca que Node busca en su binario para detectar el blob SEA (documentación de Node, «Single executable applications»).
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const opts = {
    geojson: join(repoRoot, 'tools', 'raw', 'DEPTOS-PROV.geojson'),
    config: join(repoRoot, 'visor_deptos', 'config.json'),
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in opts) || argv[i + 1] === undefined) throw new Error(`Unknown or incomplete option: ${argv[i]}`);
    opts[key] = resolve(argv[i + 1]);
  }
  return opts;
}

function main() {
  if (process.platform !== 'win32') throw new Error('Build on Windows: the executable is a copy of the running node.exe');
  const opts = parseArgs(process.argv.slice(2));
  const dist = join(repoRoot, 'dist');
  mkdirSync(dist, { recursive: true });

  // SEA solo admite un script CommonJS. import.meta.url se reemplaza por una URL ficticia para que
  // ninguna comprobación de «módulo principal» de los módulos importados se active dentro del .exe.
  runNpx([
    '--yes', ESBUILD, 'tools/procesar_mes.mjs', '--bundle', '--platform=node', '--format=cjs',
    '--define:import.meta.url="file:///C:/procesar_focos.js"', '--outfile=dist/procesar_focos.cjs', '--log-level=warning',
  ]);
  const seaConfig = join(dist, 'sea-config.json');
  writeFileSync(seaConfig, JSON.stringify({
    main: join(dist, 'procesar_focos.cjs'),
    output: join(dist, 'sea-prep.blob'),
    disableExperimentalSEAWarning: true,
    assets: { geojson: opts.geojson, config: opts.config },
  }, null, 2));
  const r = spawnSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`node --experimental-sea-config failed with status ${r.status}`);

  const exe = join(dist, 'procesar_focos.exe');
  copyFileSync(process.execPath, exe);
  runNpx(['--yes', POSTJECT, exe, 'NODE_SEA_BLOB', join(dist, 'sea-prep.blob'), '--sentinel-fuse', SEA_FUSE]);
  console.log(`Wrote ${exe}. Distribute it with a datos/ folder holding the monthly <filePrefix>_AAAAMM.csv history.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
