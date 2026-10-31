# Feature: monthly-cron

Locator: `odd/tasks/monthly-cron.md` · Engram mirror `odd/monthly-cron/tasks`. Branch `feat/monthly-cron` (from `feat/firms-engine`).
Delivery: `exception-ok` (one branch, work-unit commits, no PR yet). Runners: `php tools/test/actualizar_mes_test.php`, `node --test "tools/test/*.test.mjs"`, `php tools/test/series_test.php`.

## Specs

- S1 "esto tiene que automatizarse con un cron job en ssh cada mes": a monthly job on SEPA's server writes `datos/focos_AAAAMM.csv` for the previous month with no manual step.
- S2 "ya hay un cron job en los servers del sepa que trae los focos de calor no se si cada 5 dias": the existing 7-day download is not reused (rolling window, gaps unrecoverable); the job uses the FIRMS area API (`MODIS_NRT`, MAP_KEY from `FIRMS_MAP_KEY`).
- S3 PHP CLI only (PHP is the only runtime guaranteed on the server); same output as `tools/compute_anomalies.mjs` for the same month; nothing written on any error.
- S4 Docs: VISOR_FOCOS.md (phase 5, risks), README, CLAUDE.md. Nothing is installed on a remote server from here.

## Tasks

- [x] T1 `visor_deptos/lib/actualizar_mes.php` + `tools/test/actualizar_mes_test.php` + docs (S1–S4). Route: inline.

## Log

- L1 (2026-10-31) User: "bien esto tiene que automatizarse con un cron job en ssh cada mes como crees que es posible hacerlo? ya hay un cron job en los servers del sepa que trae los focos de calor no se si cada 5 dias que los muestra en un mapa interactivo de calor"
- L2 FIRMS area API checked on its docs page: `/api/area/csv/[MAP_KEY]/[SOURCE]/[AREA]/[DAY_RANGE 1-5]/[DATE]`, MAP_KEY required (free), 5000 transactions / 10 min.
- L3 T1 evidence. RED: test fails (script missing). GREEN: 25/25 PHP checks; node 35/35; series_test exit 0; `php -l` clean. Parity: `--csv` with the archive's August 2026 points and the NRT's September 2026 points produces files byte-identical to the Node engine's `focos_202608.csv` and `focos_202609.csv` (0.7 s).
- L4 (2026-10-31) Real API run with the user's MAP_KEY (env var only, never written to a file): 202609 MODIS_NRT, 7114 assigned, 2773 outside (neighbouring countries in the bbox), 9.7 s. Vs the downloaded NRT: 12 more hotspots in 2 departments, 0 class changes. Local PHP had no php.ini (no openssl): fix e81e514 reports the redacted PHP error and the missing extension. Install guide published as an artifact.
- Not done: installing the cron on SEPA's server (needs whoever has SSH access).
