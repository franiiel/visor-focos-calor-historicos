# Visor de focos de calor por departamento (prototipo)

Mapa interactivo de focos de calor mensuales y su anomalía por departamento de Argentina. Es el prototipo local (fase 2) de la propuesta descrita en [`VISOR_FOCOS.md`](VISOR_FOCOS.md).

Los CSV mensuales se calculan desde los focos de NASA FIRMS con `tools/compute_anomalies.mjs` (ver «Calcular desde los focos de FIRMS»). La planilla departamental de SEPA queda como control, y también se puede convertir con `tools/convert_excel.mjs`. No se versionan. Para probar sin la planilla hay un generador de datos sintéticos.

## Qué incluye

| Ruta | Qué es |
|---|---|
| `visor_deptos/index.php` | Página del visor, con la plantilla de las páginas de producto de SEPA: incluye `includes/nav.php`, `includes/footer.php` y los CSS del sitio desde `$root` (`../../../../`: en el sitio de SEPA la carpeta queda cuatro niveles por debajo de la raíz). Si la carpeta queda a otra profundidad, hay que ajustar `$root`. El texto de `cajaProductos` (el título del producto) está escrito en el HTML, como en las demás páginas de producto. |
| `tools/sepa_local/` | Stubs de `includes/` del sitio para probar la página en local. No se suben. |
| `visor_deptos/app.js`, `app.css` | Lógica (módulo ES) y estilos del visor. |
| `visor_deptos/scales.js`, `data.js` | Funciones puras: escalas de color, leyenda, formato de números, lectura de los CSV y cálculos de los gráficos (promedio por lustro, totales por provincia y país, promedio, máximo y mínimo por mes). |
| `visor_deptos/listar.php` | Lista los meses disponibles en `datos/<fuente>/`. Acepta `fuente` opcional (un `id` de `config.json`; por defecto, la primera fuente). |
| `visor_deptos/serie.php` | Devuelve la serie consolidada de una fuente y la guarda en `cache/serie_<fuente>.json`. Acepta `fuente` e `in1` opcionales (5 dígitos). Sin `in1`, el visor la descarga una vez por fuente para los totales de Argentina y de cada provincia. |
| `visor_deptos/config.json` | Qué muestra el visor: prefijo y columnas de los CSV, textos y las fuentes (MODIS, VIIRS S-NPP), cada una con su período de referencia. Ver «Fuentes y conjunto de datos». |
| `visor_deptos/lib/config.php`, `lib/series.php` | Lectura y validación de `config.json`; lectura de los CSV y armado de la serie. |
| `visor_deptos/deptos.geo.json` | Geometría simplificada de los 532 departamentos (unos 380 KB). |
| `visor_deptos/datos/` | Una carpeta por fuente (`modis/`, `viirs/`) con un CSV por mes: `focos_AAAAMM.csv` (el prefijo lo define `config.json`). |
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

Escribe `visor_deptos/datos/modis/focos_200101.csv` … `focos_202608.csv` (308 archivos, unos 2,6 MB) en menos de un segundo. El resultado es siempre el mismo para la misma semilla (`--seed`, por defecto 20260908). Otras opciones: `--from 200101 --to 202608` y `--out` (otra carpeta, por ejemplo `visor_deptos/datos/viirs`).

Los CSV sintéticos **no se versionan** (están en `.gitignore`): se regeneran rápido y de forma determinista. Son datos inventados con una forma plausible, **no focos reales**, y el visor no los distingue de los de SEPA: usarlos solo para pruebas locales.

`anomalia` es la clase 1–5 de SEPA respecto del mismo mes en 2001–2025, calculada con la misma regla que el conversor (ver «Convertir la planilla de SEPA»).

## Calcular desde los focos de FIRMS

```sh
node tools/build_geometry.mjs   # una vez: descarga DEPTOS-PROV.geojson en tools/raw/
node tools/compute_anomalies.mjs --firms DL_FIRE_M-C61_43028                  # MODIS -> datos/modis/
node tools/compute_anomalies.mjs --fuente viirs --firms DL_FIRE_SV-C2_xxxxx   # VIIRS S-NPP -> datos/viirs/
```

`--fuente` es el `id` de una fuente de `config.json` (por defecto, la primera, `modis`): define la carpeta de salida y el período de referencia. `--firms` es la carpeta de una descarga de NASA FIRMS de ese sensor (MODIS C6.1 o VIIRS S-NPP 375 m, Argentina): un `fire_archive_*.csv` y, si hay, un `fire_nrt_*.csv`. Del NRT se usan solo los días posteriores al último del archivo histórico, para no contar dos veces. Se cuentan todos los focos, sin filtrar por `type` ni `confidence`, como la planilla de SEPA. Cada foco se asigna a su departamento por punto en polígono contra `DEPTOS-PROV.geojson` completo (nunca contra la geometría simplificada del visor) y los que caen fuera de todo departamento (mar, países vecinos) se descartan y se informan.

Escribe en `visor_deptos/datos/<fuente>/` un `focos_AAAAMM.csv` por mes, con todos los departamentos (0 si no hubo focos), y `referencia.csv` (`in1,mes,max,promedio,min,desvio`): las referencias de cada departamento y mes calendario en el período `climatology` de la fuente. El desvío es el muestral, como `DESVEST` de Excel. La clase (1 a 5) usa la misma regla que el conversor de la planilla. Tarda menos de un minuto con 1,7 millones de focos. Opciones: `--geojson`, `--config` y `--out`.

El último mes queda incompleto si la descarga termina antes de fin de mes: el script muestra la fecha del último foco.

## Actualización mensual automática

En el servidor, un cron calcula cada mes el CSV del mes anterior con la API de FIRMS. Usa solo PHP (sin Node):

```sh
FIRMS_MAP_KEY=xxxxxxxx php visor_deptos/lib/actualizar_mes.php --fuente modis --geojson /ruta/DEPTOS-PROV.geojson
```

Líneas de crontab, una por fuente (el día 2 de cada mes a las 4:00 y 4:30; las rutas son las del servidor):

```
FIRMS_MAP_KEY=xxxxxxxx
0 4 2 * * php /ruta/visor_deptos/lib/actualizar_mes.php --fuente modis --geojson /ruta/seccion-focos/data/geoJSON/DEPTOS-PROV.geojson >> /ruta/logs/visor_deptos.log 2>&1
30 4 2 * * php /ruta/visor_deptos/lib/actualizar_mes.php --fuente viirs --geojson /ruta/seccion-focos/data/geoJSON/DEPTOS-PROV.geojson >> /ruta/logs/visor_deptos.log 2>&1
```

- `FIRMS_MAP_KEY`: clave gratuita de <https://firms.modaps.eosdis.nasa.gov/api/map_key/>. Va solo en el entorno del cron, nunca en el repositorio.
- Opciones: `--fuente <id>` (por defecto, la primera de `config.json`), `--mes AAAAMM` (por defecto, el mes anterior), `--source` (por defecto, `firmsSource` de la fuente: `MODIS_NRT` o `VIIRS_SNPP_NRT`; `MODIS_SP` o `VIIRS_SNPP_SP` para los datos definitivos), `--csv archivo.csv` (una descarga local de FIRMS en lugar de la API), `--config` y `--datos` (por defecto, `datos/<fuente>/`).
- Aplica las mismas reglas que `tools/compute_anomalies.mjs` y toma las referencias de los CSV del período `climatology` de `datos/<fuente>/`. Por eso la serie histórica de esa fuente tiene que estar generada antes.
- Si algo falla (red, clave, respuesta que no es un CSV de FIRMS), termina con código 1, escribe el error en stderr y no deja ningún archivo. Si sale bien, escribe una línea con el mes, los focos asignados y los que quedaron fuera de todo departamento.
- Solo corre desde la línea de comandos. Está en `lib/`, que no se sirve por web.

## Actualización mensual manual (`procesar_focos.exe`)

Para una PC con Windows sin Node ni PHP. Se entrega `procesar_focos.exe` junto a dos carpetas:

```
procesar_focos.exe
nasa/
  modis/  <- acá se copia la descarga MODIS de FIRMS
  viirs/  <- acá se copia la descarga VIIRS S-NPP de FIRMS
datos/
  modis/  <- histórico focos_AAAAMM.csv (para la anomalía) y el mes nuevo, lo que se sube al visor
  viirs/  <- lo mismo para VIIRS S-NPP
```

1. Descargar de NASA FIRMS los focos de Argentina de los meses nuevos (uno o varios) en CSV (si viene en `.zip`, descomprimirlo).
2. Copiar la descarga en la carpeta de su sensor, `nasa/modis/` o `nasa/viirs/`: los CSV sueltos o la carpeta `DL_FIRE_*` entera, tal como viene.
3. Hacer doble clic en `procesar_focos.exe`. Procesa cada carpeta de `nasa/` que tenga una descarga nueva, escribe `datos/<fuente>/focos_AAAAMM.csv` y mueve la descarga a `nasa/<fuente>/procesados/`. Con `--fuente <id>` (desde una consola) procesa solo esa fuente.
4. Subir `focos_AAAAMM.csv` a la carpeta `datos/<fuente>/` del visor.

**Histórico completo.** Si la descarga cubre toda la climatología de la fuente (por ejemplo, el archive de VIIRS desde 2012 más el NRT), en lugar de un mes rearma todos los meses de la descarga y `referencia.csv`, igual que `tools/compute_anomalies.mjs`. Sirve para armar `datos/<fuente>/` la primera vez. El último mes de la descarga puede estar incompleto: conviene volver a procesarlo cuando termine.

Si la descarga trae varios meses, escribe uno por mes, igual que si se procesaran de a uno en orden; un mes sin focos en el medio sale con ceros. Muestra la fecha del primer y del último foco, y avisa (sin dejar de procesarlo) si el primer mes empieza después del día 1 o el último termina antes de fin de mes, porque puede estar incompleto: por ejemplo, el mes en curso. Si no es un CSV de FIRMS o falta algún CSV del histórico, muestra el error de esa fuente y no escribe ni mueve nada de ella. Da exactamente el mismo archivo que `actualizar_mes.php --csv`. Para probarlo sin compilar: `node tools/procesar_mes.mjs --nasa <carpeta> [--fuente <id>] [--datos <carpeta>]` (además acepta `--geojson` y `--config`).

Compilarlo (en Windows, necesita `tools/raw/DEPTOS-PROV.geojson`; usa esbuild y postject con versión fija vía npx):

```sh
node tools/build_exe.mjs   # -> dist/procesar_focos.exe, con la geometría y config.json embebidos
```

El ejecutable es una copia de `node.exe` con el script adentro, por eso pesa ~100 MB y su firma digital queda inválida: Windows puede mostrar un aviso la primera vez. Si cambia `config.json`, hay que volver a compilarlo.

## Convertir la planilla de SEPA

```sh
node tools/convert_excel.mjs --xlsx ESTADISTICAS-DEPARTAMENTALES2026.xlsx
```

Lee las hojas `FCXMESXAÑO` (focos por año, provincia y departamento) y `ESTADISTICAS` (código de cada departamento) y escribe un `focos_AAAAMM.csv` por mes en `visor_deptos/datos/modis/` (la planilla es MODIS). La unión por nombre se hace solo acá: los CSV salen con `in1`. La clase de anomalía (1 a 5) se calcula con la regla de SEPA contra el período `climatology` de la fuente. Un departamento sin fila en un año no tiene fila ese mes; la media de referencia usa solo los años con dato, como la planilla. Opciones: `--fuente`, `--config` y `--out`.

Si un nombre no está en `ESTADISTICAS`, el conversor se detiene y lo nombra. Si un departamento tiene más de una fila en el mismo año, ese año queda sin dato y el conversor lo lista en un aviso: no adivina cuál es la fila correcta. La planilla de 2026 tiene tres casos (San Pedro 2022, San Roque 2022 y Comandante Fernández 2020), porque algunas filas tienen el año mal cargado. Usa solo la biblioteca estándar de Node.

## Pruebas

```sh
node --test "tools/test/*.test.mjs"
php tools/test/series_test.php
php tools/test/actualizar_mes_test.php
```

Las pruebas de Node cubren las escalas y el formato (`scales.js`), la lectura de CSV, el control de pedidos superpuestos y los cálculos de los gráficos (`data.js`), el conversor (regla de clases, media y desvío sobre los años con dato, nombres desconocidos o repetidos y lectura de un `.xlsx` de prueba), el motor de FIRMS (punto en polígono con huecos y multipolígonos, NRT solo después del archivo histórico, ceros y referencias) y el generador (determinismo y formato de los archivos). La prueba de PHP no usa frameworks: cubre `lib/series.php` (forma de la serie, prefijo y columnas configurados, huella de la carpeta de datos y de la configuración, reutilización del caché y error ante un CSV sin las columnas requeridas), la validación de `config.json` (incluidas las fuentes) y las respuestas de `listar.php` y `serie.php` (forma del JSON, una carpeta y un caché por fuente, `fuente` fuera de la lista y códigos 400, 404 y 500), que corre como subprocesos sobre una copia temporal. Termina con código 0 si todo pasa.

## Servir el visor

Con PHP instalado:

```sh
SEPA_ROOT=../tools/sepa_local/ php -S localhost:8000 -t visor_deptos
```

y abrir <http://localhost:8000/>. `SEPA_ROOT` apunta los `include` del menú y del pie de página a los stubs locales; en el servidor de SEPA no se define. En PowerShell: `$env:SEPA_ROOT='../tools/sepa_local/'; php -S localhost:8000 -t visor_deptos`. Antes hay que generar los datos (ver arriba). La carpeta `visor_deptos/cache/` debe permitir escritura al proceso de PHP; si no la permite, `serie.php` arma la serie en cada pedido sin guardarla.

## Actualizar los datos

1. Si quedaron CSV sintéticos, borrar los `focos_*.csv` de `visor_deptos/datos/modis/`.
2. Generar los CSV desde FIRMS (ver «Calcular desde los focos de FIRMS»), desde la planilla (ver «Convertir la planilla de SEPA») o copiar los de SEPA en la carpeta de su fuente (`datos/modis/`, `datos/viirs/`) con el mismo nombre (`focos_AAAAMM.csv`) y las columnas `in1,focos,anomalia`. `in1` es el código INDEC de 5 dígitos, con el cero inicial; `anomalia` es la clase 1 a 5.
3. No hace falta tocar código: `listar.php` detecta los meses y `serie.php` rearma el caché cuando cambia algún CSV.

Los departamentos sin fila en un mes se muestran en gris como «sin dato».

## Fuentes y conjunto de datos

Cada fuente de `sources` en `config.json` es una pestaña del visor (hoy MODIS, 2001–2025, y VIIRS S-NPP, 2012–2025). Cada una tiene sus CSV en `datos/<id>/`, su caché y su período de referencia: las fuentes no se mezclan. Una fuente sin CSV se muestra con el aviso «Todavía no hay datos de …». El enlace `…/#viirs` abre directamente esa pestaña.

Para agregar una fuente (por ejemplo NOAA-20), sin tocar código:

1. Agregar a `sources` un elemento con `id` (nombre de la carpeta, `[a-z0-9_-]`), `label` (texto de la pestaña), `firmsSource` (fuente de la API de FIRMS, por ejemplo `VIIRS_NOAA20_NRT`), `climatology` (período de referencia) y `note` (texto al pie; es libre, así que si nombra el período hay que actualizarlo a mano).
2. Dejar sus CSV en `visor_deptos/datos/<id>/`.
3. Recargar la página. `serie.php` rearma el caché solo, porque su huella incluye la configuración.

Para mostrar otra serie con la misma forma (un valor y su clase de anomalía 1 a 5), se editan los campos comunes: `filePrefix` (el prefijo), `columns.value` y `columns.anomaly` (nombres de las columnas, en minúsculas), `integerValues` (`true` para conteos), `anomalyClasses` (los 5 textos de las clases, de la 1 a la 5) y los textos (`title`, `unit`, `valueLabel`, `valueTitle`, `anomalyTitle`).

Si `config.json` no es válido, la página y los dos endpoints responden un error 500 que nombra `config.json`; el detalle queda en el log de PHP. La descripción completa está en `VISOR_FOCOS.md` («Configuración del conjunto de datos»).
