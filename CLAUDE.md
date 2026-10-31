# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Local prototype with **real data**: monthly CSVs are computed (gitignored) from raw NASA FIRMS hotspots with `tools/compute_anomalies.mjs`; SEPA's department workbook (hand-filled by the tutor) is the expected result used for validation, and `tools/convert_excel.mjs` still converts it; `tools/generate_synthetic.mjs` makes test data when the workbook is not available. Viewer in `visor_deptos/`, one-time tools and tests in `tools/`. `VISOR_FOCOS.md` is the design document (in Spanish) and the source of truth. Read it before proposing or writing anything, and keep it updated when decisions change. It is the project's proposal to SEPA (INTA), so changes to scope or architecture belong there first. `README.md` (Spanish) has run instructions; task progress lives in `odd/tasks/`.

The PHP endpoints have been verified locally with PHP 8.3 (`listar.php`, `serie.php` status codes, cache reuse and rebuild).

## Commands

```sh
node tools/build_geometry.mjs          # download + simplify geometry -> visor_deptos/deptos.geo.json (pinned mapshaper via npx)
node tools/generate_synthetic.mjs      # synthetic CSVs -> visor_deptos/datos/ (deterministic, gitignored)
node tools/compute_anomalies.mjs --firms DL_FIRE_M-C61_43028  # FIRMS points -> visor_deptos/datos/ (needs tools/raw/DEPTOS-PROV.geojson from build_geometry)
node tools/convert_excel.mjs --xlsx ESTADISTICAS-DEPARTAMENTALES2026.xlsx  # SEPA workbook -> visor_deptos/datos/
node --test "tools/test/*.test.mjs"    # unit tests (a bare directory argument does not work in Node 24)
php tools/test/series_test.php         # PHP tests for lib/series.php (plain PHP, exit code 0/1)
php -S localhost:8000 -t visor_deptos  # serve the viewer (needs PHP 7.4+)
```

No lint or build step; files are deployed as-is.

## What this is

An interactive choropleth map of monthly heat-hotspot counts and anomalies per Argentine department. It replaces the static monthly JPGs at `https://sepa.inta.gob.ar/productos/focos/anomalia_deptos/`. It is deployed inside the SEPA website, which is why PHP is required.

It is a separate product from AgroENSO. Don't reuse its pipeline or couple the two projects. Copy small helpers (e.g. `simplify_geojson`) instead of importing them.

## Architecture constraints (from the design doc)

- **Mirror the existing SEPA viewer** at `/productos/focos/seccion-focos/` (same INTA-UNAHUR agreement): a PHP template with the site header and footer, ES-module JS, plain CSS. No framework, no npm, no build step, no database. Files are edited and uploaded as-is.
- **Data contract with SEPA:** one CSV per month in `datos/focos_AAAAMM.csv` with columns `in1,focos,anomalia`. SEPA's monthly process drops these files; the viewer must pick them up with no code changes.
- **Dataset config:** `visor_deptos/config.json` (validated by `lib/config.php`) holds everything dataset-specific: CSV prefix, value/anomaly column names, integer rounding, climatology period and UI texts. Its defaults are the SEPA contract above. Never hardcode those in code; internally the two columns are always `value` and `anomaly`. One dataset per installation.
- **Join key:** `in1` is the 5-digit INDEC department code, stored as a string so the leading zero is kept. It matches `LINK` in SEPA's `DEPTOS-PROV.geojson`. Never join by `id` (it has no zero padding) or by name.
- **PHP endpoints:**
  - `listar.php` takes no parameters and lists the available months.
  - `serie.php` builds and caches `cache/serie.json`, regenerating it when the fingerprint (sha1 of the config plus every CSV's name, size and mtime) differs from the one stored in the cache. A CSV without the configured columns is a 500 error naming the file, never an empty month. An invalid `config.json` is a 500 naming it, on every entry point.
  - Any parameter an endpoint does accept must be strictly validated (e.g. `^\d{5}$`). Path or URI inputs are a known weak spot on the SEPA site (`listar_archivos_MNC.php`, `descargarkml.php`).
- **Pin CDN library versions** (Leaflet 1.9.4, Chart.js). The existing SEPA viewers load Leaflet unversioned; don't copy that.
- The geometry is generated once from `DEPTOS-PROV.geojson` (~13 MB, too heavy as-is), simplified and stored as a static file.

## Language

Documents for SEPA are written in neutral Spanish. Code, identifiers, and comments are in English.
