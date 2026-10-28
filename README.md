# Visor de focos de calor por departamento (prototipo)

Mapa interactivo de focos de calor mensuales y su anomalía por departamento de Argentina. Es el prototipo local (fase 2) de la propuesta descrita en [`VISOR_FOCOS.md`](VISOR_FOCOS.md).

> **Los datos de este prototipo son sintéticos.** Los genera `tools/generate_synthetic.mjs` con una forma plausible (estacionalidad y diferencias regionales), pero **no representan focos reales**. El visor lo indica con un aviso visible.

## Qué incluye

| Ruta | Qué es |
|---|---|
| `visor_deptos/index.php` | Página del visor. Incluye `partials/header.php` y `partials/footer.php`, que son marcadores de lugar: en la integración se reemplazan por el encabezado y el pie reales del sitio. |
| `visor_deptos/app.js`, `app.css` | Lógica (módulo ES) y estilos del visor. |
| `visor_deptos/scales.js`, `data.js` | Funciones puras: escalas de color, leyenda, formato de números y lectura de los CSV. |
| `visor_deptos/listar.php` | Lista los meses disponibles en `datos/`. No recibe parámetros. |
| `visor_deptos/serie.php` | Devuelve la serie consolidada y la guarda en `cache/serie.json`. Acepta `in1` opcional (5 dígitos). |
| `visor_deptos/config.json` | Conjunto de datos que muestra el visor: prefijo y columnas de los CSV, período de referencia y textos. Ver «Cambiar el conjunto de datos». |
| `visor_deptos/lib/config.php`, `lib/series.php` | Lectura y validación de `config.json`; lectura de los CSV y armado de la serie. |
| `visor_deptos/deptos.geo.json` | Geometría simplificada de los 532 departamentos (unos 380 KB). |
| `visor_deptos/datos/` | Un CSV por mes: `focos_AAAAMM.csv` (el prefijo lo define `config.json`). |
| `tools/` | Herramientas de un solo uso (no se suben al sitio) y pruebas. |

Librerías, con versión fija: Leaflet 1.9.4 (unpkg) y Chart.js 4.5.1 (jsDelivr). Mapa base: Argenmap del IGN, el mismo que usa el visor de focos de los últimos 5 días.

## Requisitos

- Node.js 20 o superior, solo para las herramientas y las pruebas. El visor no usa npm ni paso de build.
- PHP 7.4 o superior para servir el visor.

## Regenerar la geometría

```sh
node tools/build_geometry.mjs
```

Descarga `DEPTOS-PROV.geojson` de SEPA en `tools/raw/` (si no está), normaliza el código `LINK` a 5 dígitos (`in1`), une los polígonos de cada departamento y simplifica con mapshaper 0.7.61 (versión fija, vía `npx`). Muestra la cantidad de departamentos, los códigos duplicados o faltantes y el tamaño del archivo. Opción: `--simplify 3%` (porcentaje de vértices que se conservan).

`tools/raw/` no se versiona: contiene datos descargados.

## Regenerar los datos sintéticos

```sh
node tools/generate_synthetic.mjs
```

Escribe `visor_deptos/datos/focos_200101.csv` … `focos_202608.csv` (308 archivos, unos 2,6 MB) en menos de un segundo. El resultado es siempre el mismo para la misma semilla (`--seed`, por defecto 20260908). Otras opciones: `--from 200101 --to 202608`.

Los CSV sintéticos **no se versionan** (están en `.gitignore`): se regeneran rápido y de forma determinista, y así no se confunden con datos reales.

`anomalia` es la clase 1–5 de SEPA respecto del mismo mes en 2001–2025, calculada con la misma regla que el conversor (ver «Convertir la planilla de SEPA»).

## Convertir la planilla de SEPA

```sh
node tools/convert_excel.mjs --xlsx ESTADISTICAS-DEPARTAMENTALES2026.xlsx
```

Lee las hojas `FCXMESXAÑO` (focos por año, provincia y departamento) y `ESTADISTICAS` (código de cada departamento) y escribe un `focos_AAAAMM.csv` por mes en `visor_deptos/datos/`. La unión por nombre se hace solo acá: los CSV salen con `in1`. La clase de anomalía (1 a 5) se calcula con la regla de SEPA contra el período `climatology` de `config.json`. Un departamento sin fila en un año no tiene fila ese mes; la media de referencia usa solo los años con dato, como la planilla. Opciones: `--config` y `--out`.

Si un departamento aparece dos veces en el mismo año, o un nombre no está en `ESTADISTICAS`, el conversor se detiene y lo nombra. Usa solo la biblioteca estándar de Node.

## Pruebas

```sh
node --test "tools/test/*.test.mjs"
php tools/test/series_test.php
```

Las pruebas de Node cubren las escalas y el formato (`scales.js`), la lectura de CSV y el control de pedidos superpuestos (`data.js`), el conversor (regla de clases, media sobre los años con dato, nombres desconocidos o repetidos y lectura de un `.xlsx` de prueba) y el generador (determinismo y formato de los archivos). La prueba de PHP no usa frameworks: cubre `lib/series.php` (forma de la serie, prefijo y columnas configurados, huella de la carpeta `datos/` y de la configuración, reutilización del caché y error ante un CSV sin las columnas requeridas), la validación de `config.json` y las respuestas de `listar.php` y `serie.php` (forma del JSON y códigos 400, 404 y 500), que corre como subprocesos sobre una copia temporal. Termina con código 0 si todo pasa.

## Servir el visor

Con PHP instalado:

```sh
php -S localhost:8000 -t visor_deptos
```

y abrir <http://localhost:8000/>. Antes hay que generar los datos (ver arriba). La carpeta `visor_deptos/cache/` debe permitir escritura al proceso de PHP; si no la permite, `serie.php` arma la serie en cada pedido sin guardarla.

## Reemplazar los datos sintéticos por los de SEPA

1. Borrar los `focos_*.csv` sintéticos de `visor_deptos/datos/`.
2. Generar los CSV desde la planilla (ver «Convertir la planilla de SEPA») o copiar los de SEPA con el mismo nombre (`focos_AAAAMM.csv`) y las columnas `in1,focos,anomalia`. `in1` es el código INDEC de 5 dígitos, con el cero inicial; `anomalia` es la clase 1 a 5.
3. No hace falta tocar código: `listar.php` detecta los meses y `serie.php` rearma el caché cuando cambia algún CSV.
4. Quitar el aviso de datos sintéticos de `index.php`.

Los departamentos sin fila en un mes se muestran en gris como «sin dato».

## Cambiar el conjunto de datos

El visor puede mostrar otra serie mensual por departamento con la misma forma (un valor y su clase de anomalía 1 a 5), por ejemplo focos VIIRS, sin tocar código:

1. Dejar en `visor_deptos/datos/` los CSV nuevos, con el nombre `<prefijo>_AAAAMM.csv` y una columna `in1` (código INDEC de 5 dígitos).
2. Editar `visor_deptos/config.json`: `filePrefix` (el prefijo), `columns.value` y `columns.anomaly` (nombres de las columnas, en minúsculas), `integerValues` (`true` para conteos), `climatology` (período de referencia), `anomalyClasses` (los 5 textos de las clases, de la 1 a la 5) y los textos (`title`, `unit`, `valueLabel`, `valueTitle`, `anomalyTitle`, `note`). `note` es texto libre: si nombra el período de referencia o la unidad, actualizalo junto con `climatology` y `unit`, porque no se arma solo.
3. Recargar la página. `serie.php` rearma el caché solo, porque su huella incluye la configuración.

Si `config.json` no es válido, la página y los dos endpoints responden un error 500 que nombra `config.json`; el detalle queda en el log de PHP. La descripción completa está en `VISOR_FOCOS.md` («Configuración del conjunto de datos»).
