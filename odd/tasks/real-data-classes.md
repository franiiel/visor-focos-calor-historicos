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

- [ ] T1 Converter + tests (S1, S2). Route: inline.
- [ ] T2 Viewer classes, config, PHP validation, generator, tests (S3, S4). Route: inline.
- [ ] T3 Docs and banner (S5). Route: inline.

## Log

- L1 (2026-10-28) User: "Bueno vamos a implementarlo ahora" — implement the design recorded in `VISOR_FOCOS.md` (commit 57abce5).
- L2 Route: inline. No writer trigger: units depend on each other (T2 consumes the class contract T1 defines); no parallelism reason.
