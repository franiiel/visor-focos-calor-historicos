# Feature: real-data-classes

Locator: `odd/tasks/real-data-classes.md` · Engram mirror `odd/real-data-classes/tasks`. Branch `feat/real-data-classes` (from `feat/configurable-dataset`).
Delivery: `exception-ok` (one branch, work-unit commits, no PR yet). Runners: `node --test "tools/test/*.test.mjs"`, `php tools/test/series_test.php`.

## Specs

- S1 Converter: one-time tool in `tools/` that reads `ESTADISTICAS-DEPARTAMENTALES2026.xlsx` (sheets `FCXMESXAÑO` + `ESTADISTICAS`) and writes `datos/focos_AAAAMM.csv` with `in1,focos,anomalia`. "La unión por nombre queda dentro de esa conversión: los CSV salen con `in1`". No new dependencies (no Python on this machine; Node stdlib only).
- S2 Class rule, as in `VISOR_FOCOS.md`: `SI(fc>MAX;5;SI(fc>MD+10%;4;SI(fc>MD-10%;3;SI(fc>MIN;2;1))))`, MAX/MD/MIN of the same calendar month over the `config.json` climatology period, averaging only years that have a row ("un año sin renglón no cuenta como cero"). Must reproduce SEPA's own 2026 classes (sheets `ENERO`..`AGO`).
- S3 Viewer: "La anomalía con una leyenda fija de cinco colores, uno por clase"; tooltip shows the class text; texts come from `config.json` `anomalyClasses` (validated by `lib/config.php`, 5 strings); `climatology` 200101–202512.
- S4 Synthetic generator keeps working with the new contract (anomalia = class 1–5).
- S5 Docs: README, CLAUDE.md commands, `datos/LEEME.txt`; remove the synthetic-data banner (README "Reemplazar los datos sintéticos por los de SEPA").

## Tasks

- [x] T1 Converter + tests (S1, S2). Route: inline. Commit d8a09f0. Runs on the real workbook only after the duplicate-year decision (L3).
- [x] T2 Viewer classes, config, PHP validation, generator, tests (S3, S4). Route: inline. Commit a808017.
- [~] T3 Docs (S5) done in a808017. Banner removal pending: real CSVs cannot be generated until L3 is decided.

## Log

- L1 (2026-10-28) User: "Bueno vamos a implementarlo ahora" — implement the design recorded in `VISOR_FOCOS.md` (commit 57abce5).
- L2 Route: inline. No writer trigger: units depend on each other (T2 consumes the class contract T1 defines); no parallelism reason.
- L3 T1 evidence. RED: module not found. GREEN: 6/6 converter tests (two expectations of mine were wrong: one reference year with value v gives class 3, since v > 0.9·v). On the real workbook the converter stops: `Department 22021 has more than one row for 2020`. Four rows carry a wrong year (their position is inside another year's block): 9679 "2020" in the 2021 block and 10189 "2020" in the 2022 block (Comandante Fernández, Chaco), 9639 "2022" (San Pedro, Buenos Aires) and 9759 "2022" (San Roque, Corrientes), both in the 2021 block. Decision pending with the user.
- L4 Scratch verification (rows re-yeared by block, climatology 2001–2025): 309 months, 200101–202609. 2026 classes vs SEPA sheets ENERO..AGO: 4072/4080 equal. All 8 differences are in ABRIL, whose references use 2001–2024 for 460 of 510 departments (SEPA sheet error; e.g. 18056 April 2025 = 70 left out of MAX). Province check vs ESTADISTICAS-PROVINCIALES: 173/7107 province-months differ, 169 of them in 2021–2022 (e.g. Entre Ríos 202112: departments 717, province 476). Question for SEPA.
- L5 T2 evidence. RED: scales tests fail (`anomalyLabel` not exported), generator contract test fails, PHP fatal on missing `anomalyClasses`. GREEN: node 29/29, PHP 61 checks exit 0, `node --check` app.js/scales.js, `php -l` config.php. Integration (`php -S`, synthetic data regenerated): index 200 with the 5 labels embedded, `serie.php?in1=06007` 200 with integer classes. Not done: visual browser check of the legend.
- L6 RDD: `review assess --base-ref 8540791 --committed-only` (untracked xlsx excluded) → medium, `under_budget`, review not due.
