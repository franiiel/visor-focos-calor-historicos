# Feature: firms-engine

Locator: `odd/tasks/firms-engine.md` · Engram mirror `odd/firms-engine/tasks`. Branch `feat/firms-engine` (from `feat/real-data-classes`).
Delivery: `exception-ok` (one branch, work-unit commits, no PR yet). Runners: `node --test "tools/test/*.test.mjs"`, `php tools/test/series_test.php`.

## Specs

- S1 Engine: compute the monthly CSVs from the raw NASA FIRMS points in `DL_FIRE_M-C61_43028/` instead of the hand-filled workbook: "en base a los datos que estan en DL_fire_M calcular en base a las coordenadas las provincias y departamentos y sus calculos osea que el excel es el resultado final de los calculos". Output contract unchanged: `datos/focos_AAAAMM.csv` with `in1,focos,anomalia`. Node stdlib only.
- S2 Statistics per department and calendar month over the `config.json` climatology: "promedio historico, maximo historico, minimo y desvio estandar histórico".
- S3 Classes: "se van a clasificar en 5 clases". Numbering (user decision, L2): the workbook's, 5 = above the maximum … 1 = at or below the minimum, i.e. the existing `anomalyClass()`.
- S4 Validation: the workbook is the expected result ("el excel es el resultado final"); compare counts with `FCXMESXAÑO` and 2026 classes with sheets `ENERO`..`AGO`; "La solapa a utilizar es Estadisticas si hay algo que no entendemos."
- S5 Docs: `VISOR_FOCOS.md` (scope change first), README, CLAUDE.md.
- Assumptions (from the approved plan): no `type`/`confidence` filter (measured totals match the workbook); archive for its months, NRT only after the archive's last date; a department without points in a month counts 0; full `tools/raw/DEPTOS-PROV.geojson`, never the simplified geometry; sample standard deviation (Excel `DESVEST`).

## Tasks

- [x] T1 Engine + stats + tests (S1, S2, S3). Route: inline (one behavior; no writer trigger). Commit: see git log (feat(tools): compute anomalies from FIRMS hotspots).
- [x] T2 Validation against the workbook (S4). Route: inline, scratch script (not versioned). Results in VISOR_FOCOS.md.
- [x] T3 Docs (S5). Route: inline.

## Log

- L1 (2026-10-31) User: "Buenass necesito empezar a implementar el backend/ motor de calculo de anomalias, los excel son las anomalias calculadas a mano por mi tutora pero nosotros tenemos que en base a los datos que estan en DL_fire_M calcular en base a las coordenadas las provincias y departamentos y sus calculos osea que el excel es el resultado final de los calculos, los calculos a realizar son los siguientes qué hay que calcular para ver anomalias? promedio historico, maximo historico, minimo y desvio estandar histórico. se van a clasificar en 5 clases : clase1: mayor al máximo hist, clase 2: entre el max y el promedio hist (+10%), clase 3: entre el promedio (+10%) y el promedio (-10%), clase 4: menor al promedio (-10%), clase 5:  menor al min historico. La solapá a utilziar es Estadisticas si hay algo que no entendemos."
- L2 (2026-10-31) User decision on numbering: "La de la planilla (Recomendado)" (5 = above max … 1 = at or below min).
- L3 Evidence before coding: FIRMS archive monthly totals with no filter vs workbook sums: 200101 8132/8130, 202508 9435/9435, 202309 7026/7020; 202008 32886/22263 (to explain). `ESTADISTICAS` sheet is a test sheet (inconsistent ranges `E2:Y2` vs `E3:Z3`, no stddev); the monthly sheets use the nested-IF rule already in `anomalyClass()`.
- L4 T1 evidence. RED: compute_anomalies.test.mjs fails (module not found). GREEN: node 35/35 (one test bug of mine: points placed inside the fixture hole), PHP series_test exit 0. Differential: convert_excel output before (stash) and after the classifySeries/monthFiles refactor is byte-identical (309 files).
- L5 Real run: 309 CSVs 200101–202609 in 46 s, 2109 of 1.7 M points outside every department, last date 2026-09-30. php -S: listar.php 309 months, serie.php?in1=02001 200 (CABA now has data).
- L6 T2 validation vs workbook (200101–202608): dept-months 143043/149418 equal, 6375 differ (2572 by one, mostly neighbours across a border, e.g. 202601 Gualeguaychú 12/11, Uruguay 8/9). Large diffs are workbook errors: 202008 workbook −10708 (Patiño 1423/2158, Victoria 942/1590); swapped values Lácar/Huiliches 202502, Bermejo/Patiño 202112. 14996 dept-months without a workbook row, engine finds hotspots in 327. 2026 classes 3951/4080; 102 of 129 from a different 2026 count. Added as SEPA questions 8–11.
- Not done: visual browser check; SEPA answers to questions 2, 8–11.
