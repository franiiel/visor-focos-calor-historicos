# Feature: synthetic-prototype

Locator: `odd/tasks/synthetic-prototype.md` · Engram mirror `odd/synthetic-prototype/tasks`: **PENDING** (Engram server unavailable this session).

## Objective

Local prototype of the department hotspot viewer (phase 2 of `VISOR_FOCOS.md`), runnable without SEPA data or SEPA server access, using synthetic monthly CSVs that follow the exact data contract.

## Why

Validate design (map, layers, tooltip, series chart, PHP endpoints) before the meeting with SEPA, so the meeting discusses something tangible. Swapping synthetic CSVs for real ones must require no code changes.

## Scope / constraints

- Stack per `CLAUDE.md`: PHP template + ES-module JS + CSS, no framework, no build, no DB. Pinned CDN versions (Leaflet 1.9.4, Chart.js).
- Data contract: `visor_deptos/datos/focos_AAAAMM.csv`, columns `in1,focos,anomalia`, `in1` = 5-digit INDEC code = `LINK` in `DEPTOS-PROV.geojson`.
- Synthetic data clearly labeled as test data in the UI.
- Anomaly unit is undefined by SEPA; prototype assumption: `focos − mean(same month, 2001–2020)`.
- One-time tools (geometry simplification, data generation) live in `tools/`, are not deployed, and may use Node + npx.
- Delivery strategy: `exception-ok` — local repository with no remote; no PRs. Forecast ~1000 authored lines.

## Tasks

- [x] T1 Geometry: download `DEPTOS-PROV.geojson`, simplify with mapshaper to `visor_deptos/deptos.geo.json` (properties `in1`, `depto`, `provincia`). Route: delegated (writer, 2+ non-trivial files).
- [x] T2 Synthetic data generator (seeded, deterministic, seasonal/regional) writing 2001-01..2026-08 CSVs + node tests. Route: delegated.
- [x] T3 `listar.php` and `serie.php` (cached consolidated series, optional validated `in1`, 2001–2020 monthly climatology). Route: delegated (written); verified inline with PHP 8.3.
- [x] T4 Viewer: `index.php` with header/footer partials, `app.js`, `app.css`, pure `scales.js` with node tests. Route: delegated (written); verified inline in headless Chrome; basemap fix inline.
- [x] T5 Docs: README run instructions, `CLAUDE.md` commands. Route: delegated.

## Acceptance criteria

- `node --test "tools/test/*.test.mjs"` passes. (`node --test tools/test` with a bare directory fails in Node 24: it is resolved as a module path.)
- Every department in the geometry has a row in every monthly CSV.
- With PHP available, `php -S localhost:8000 -t visor_deptos` serves a working viewer.

## Progress / evidence

Environment: Windows, Node v24.19.0, npm 11.17.0, no PHP. No commits (git identity not configured).

T1 Geometry
- Source: 731 features, 532 distinct departments. `LINK` is unpadded for Buenos Aires (e.g. `"6441"`) and repeated across multi-part departments (e.g. `94014` ×57); `LINK == COD_PROV*1000+COD_DEPTO` for all features. Normalized with `padStart(5,'0')` and dissolved by `in1`.
- mapshaper pinned to `0.7.61` (published 2026-09-09; 0.7.67+ are newer than the 14-day cutoff of 2026-09-24).
- `node tools/build_geometry.mjs`: `Dissolved 731 features into 532 features`, `Repaired 2 intersections`, 532 features, 0 duplicate / 0 invalid / 0 missing `in1`, 380.6 KB (389,744 bytes) at `-simplify 3% keep-shapes`, `precision=0.0001`. (8% gave 769.6 KB.)

T2 Synthetic data
- RED: `node --test "tools/test/*.test.mjs"` → 3 files fail with `ERR_MODULE_NOT_FOUND` (generator, `scales.js`, `data.js` not yet written).
- GREEN: generator tests 5/5 pass after implementing `tools/generate_synthetic.mjs`.
- `node tools/generate_synthetic.mjs`: 308 CSVs × 532 departments in ~0.9 s; `visor_deptos/datos/` = 2.6 MB (309 files incl. `LEEME.txt`).
- Determinism: SHA-256 of all CSVs identical across two runs (`3ce2b5d3…bdc6`).
- Join check: `focos_200101.csv` and `focos_202608.csv` each have 532 codes; 0 geometry codes missing from CSV, 0 CSV codes missing from geometry.
- Decision: generated `focos_*.csv` are gitignored (fast, deterministic, avoids confusion with real data); `LEEME.txt` is versioned.

T3 PHP
- `listar.php` copied verbatim from `VISOR_FOCOS.md`. `serie.php` + `lib/series.php`: shape `{months, data:{in1:{focos,anomalia}}, clim:{in1:[12]}}`; `?in1=` validated with `/^\d{5}\z/` (400 on invalid, 404 unknown), returns `{in1, months, focos, anomalia, clim}`; cache rebuilt when any CSV or the `datos/` directory is newer; atomic temp+rename write; falls back to uncached output if `cache/` is not writable. `cache/.htaccess` and `lib/.htaccess` deny direct access.
- Exception to test-first: no PHP runtime, so no runnable test. Pending: run `php -l` on all PHP files and exercise `listar.php`, `serie.php`, `serie.php?in1=06007`, `?in1=abc` (400), `?in1=99999` (404).

T4 Viewer
- RED: see T2 (`scales.js`/`data.js` missing). GREEN: `node --test "tools/test/*.test.mjs"` → 21 tests, 21 pass, 0 fail.
- `node --check` OK for `app.js`, `scales.js`, `data.js`.
- SRI hashes computed from the downloaded pinned files (Leaflet 1.9.4 JS/CSS, Chart.js 4.5.1 `chart.umd.min.js`).
- Pending: manual browser check (map, layers, tooltip, chart, phone width) once PHP is available.

T5 Docs
- `README.md` (Spanish), `CLAUDE.md` status + Commands updated.

T3/T4 verification (PHP 8.3.33 installed via `winget install PHP.PHP.8.3`, served with `php -S localhost:8000 -t visor_deptos`)
- `php -l`: no syntax errors in all 6 PHP files.
- `listar.php`: 308 months, `200101` … `202608`.
- `serie.php`: 200, 1,128,739 bytes; first build ~1.4 s, cached ~0.2 s. No rebuild when nothing changed; rebuild after `touch datos/focos_202608.csv`.
- `serie.php?in1=06007`: 308 months, aligned `focos`/`anomalia`, 12 `clim` values.
- Validation: `abc` → 400, `99999` → 404, `06007%0A` → 400, `in1[]=1` → 400, `060071` → 400. No PHP warnings in the server log.
- `cache/` and `lib/` are reachable under `php -S`, because the built-in server ignores `.htaccess`. Under Apache the `.htaccess` deny applies; check this at integration. `lib/series.php` outputs nothing when requested directly.
- Headless Chrome (puppeteer-core 23.11.1, scratchpad only):
  - 532 department paths, default month agosto 2026, synthetic-data banner shown.
  - Hover tooltip: "PERGAMINO / BUENOS AIRES / Anomalía…".
  - Click: panel and Chart.js chart with 3 datasets of 308 points.
  - Layer toggle switches the legend to totals.
  - Year/month change updates the title, and the chart marker moves to the selected month.
  - At 375 px: no horizontal scroll.
  - Only console error: `favicon.ico` 404 (the real SEPA header provides it).
- Bug found and fixed: the CARTO basemap rendered "API KEY REQUIRED" watermarks. Switched to the IGN Argenmap TMS, the same one used by `seccion-focos`; re-checked visually. README updated.

## Next step

Configure the git identity so the work-unit commits can be made; then integration questions for SEPA (real CSV export, anomaly unit, header/footer, Apache `.htaccess`).
