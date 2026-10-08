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
| `visor_deptos/lib/series.php` | Lectura de los CSV y armado de la serie, usado por `serie.php`. |
| `visor_deptos/deptos.geo.json` | Geometría simplificada de los 532 departamentos (unos 380 KB). |
| `visor_deptos/datos/` | Un CSV por mes: `focos_AAAAMM.csv`. |
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

Supuesto del prototipo: `anomalia = focos − promedio de focos del mismo departamento y el mismo mes calendario en 2001–2020`. La definición final la establece SEPA.

## Pruebas

```sh
node --test "tools/test/*.test.mjs"
```

Cubren las escalas y el formato (`scales.js`), la lectura de CSV (`data.js`) y el generador (determinismo y formato de los archivos). Los archivos PHP no tienen pruebas automáticas.

## Servir el visor

Con PHP instalado:

```sh
php -S localhost:8000 -t visor_deptos
```

y abrir <http://localhost:8000/>. Antes hay que generar los datos (ver arriba). La carpeta `visor_deptos/cache/` debe permitir escritura al proceso de PHP; si no la permite, `serie.php` arma la serie en cada pedido sin guardarla.

## Reemplazar los datos sintéticos por los de SEPA

1. Borrar los `focos_*.csv` sintéticos de `visor_deptos/datos/` y el aviso `LEEME.txt`.
2. Copiar los CSV de SEPA con el mismo nombre (`focos_AAAAMM.csv`) y las columnas `in1,focos,anomalia`. `in1` es el código INDEC de 5 dígitos, con el cero inicial.
3. No hace falta tocar código: `listar.php` detecta los meses y `serie.php` rearma el caché cuando cambia algún CSV.
4. Quitar el aviso de datos sintéticos de `index.php`.

Los departamentos sin fila en un mes se muestran en gris como «sin dato».
