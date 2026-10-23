# Propuesta: visor interactivo de focos de calor por departamento

## Objetivo

Reemplazar (o complementar) la página actual de **anomalía histórica mensual departamental de focos de calor** (`/productos/focos/anomalia_deptos/`), que hoy muestra una imagen por mes, por un **mapa interactivo**: elegir mes, pasar el mouse por un departamento para ver su valor, y hacer clic para ver su serie en el tiempo.

Es un producto **separado de AgroENSO**. Ver "Por qué no va dentro de AgroENSO".

## Situación actual

Relevado desde afuera; el código del proceso que genera las imágenes no es visible.

- Datos: focos de calor MODIS (satélites Aqua y Terra, resolución de 100 ha). La anomalía mensual se calcula respecto de la serie 2001–2020.
- Publicación: una imagen JPG por mes (`sepaproductos/anomalia_deptos/ad_AAAAMM.jpg`), con dos mapas: anomalía a la izquierda y focos totales acumulados a la derecha. La lista de imágenes se escribe en la página a mano o por PHP (`imagenes.push('ad_202608.jpg')`, …).
- La página tiene filtros de año y mes y una descarga en KML (`descargarkml.php`).
- Se actualiza **todos los meses**.

### Visor de referencia: focos de los últimos 5 días

El sitio ya tiene un visor interactivo de focos (`/productos/focos/seccion-focos/`), desarrollado en el marco del convenio INTA-UNAHUR. Es el antecedente más directo de este proyecto. Relevado desde su código público:

- **No consulta ninguna API desde el navegador.** Lee un CSV estático del propio servidor (`data/raw/firms_latest.csv`). Ese archivo es el CSV público de NASA FIRMS (MODIS C6.1 NRT, Sudamérica, 7 días: `MODIS_C6_1_South_America_7d.csv`), que un proceso del servidor descarga y actualiza automáticamente.
- **La unión foco → departamento se hace en el navegador**, con Turf.js y rbush (punto en polígono) contra `data/geoJSON/DEPTOS-PROV.geojson`.
- **Estructura:** plantilla PHP con el header y el footer del sitio, un punto de entrada JS (`web/index-csv.js`) que carga módulos (`dataManager`, `mapManager`, `tableManager`, `locationManager`) y su CSS. Usa cache-busting con un timestamp generado por PHP.
- Este visor de focos históricos sigue el mismo esquema, así SEPA integra los dos productos de la misma manera.

## Por qué no va dentro de AgroENSO

| | AgroENSO | Visor de focos |
|---|---|---|
| Pregunta | ¿Cómo afecta el ENSO al rendimiento? | ¿Cuántos focos hubo y cuánto se apartan de lo normal? |
| Cálculo | Pipeline estadístico propio (detrending, Wilcoxon, FDR) | Ninguno: los números ya los calcula SEPA |
| Actualización | Una vez por campaña | Todos los meses |
| Quién actualiza | Quien corre el pipeline de Python | El proceso mensual de SEPA |
| Cobertura | Zona agrícola de AR, BR y UY | Todos los departamentos de Argentina |

Mezclarlos confundiría la app y la Nota Metodológica de AgroENSO. Y el visor quedaría atado a un pipeline que no necesita.

## Idea central: engancharse al proceso mensual que ya existe

Si cada mes hubiera que correr un script aparte, armar un archivo y subirlo, el visor dejaría de actualizarse en pocos meses. El proceso de SEPA que hoy genera `ad_AAAAMM.jpg` ya tiene los números por departamento, porque con ellos pinta el mapa. La propuesta es que **ese mismo proceso deje también un archivo de datos por mes** en una carpeta, y que el visor lo lea solo. El trabajo mensual queda igual que hoy: generar y subir.

## Propuesta técnica

### Estructura

```
/productos/focos/visor_deptos/        ← ubicación a definir con SEPA
├── index.php            plantilla con el header y el footer del sitio
├── app.js               lógica del visor (módulo ES)
├── app.css
├── deptos.geo.json      geometría de departamentos (estática)
├── listar.php           devuelve la lista de meses disponibles
├── serie.php            devuelve la serie consolidada (con caché)
├── cache/
│   └── serie.json       generado por serie.php, no se edita a mano
└── datos/
    ├── focos_200101.csv
    ├── …
    └── focos_202608.csv    ← uno nuevo por mes, lo deja el proceso de SEPA
```

Sigue el mismo esquema que el visor de focos de los últimos 5 días (`/productos/focos/seccion-focos/`) y los visores de `/productos/geosepa/`: plantilla PHP, módulos JS y su CSS. Así el equipo de SEPA lo puede mantener sin aprender nada nuevo.

### Formato de datos propuesto

Un CSV por mes, con una fila por departamento:

```csv
in1,focos,anomalia
06007,12,-3.5
06014,0,-1.2
…
```

- `in1`: código INDEC del departamento (5 dígitos, como texto para no perder el cero inicial). Coincide con el campo `LINK` de `DEPTOS-PROV.geojson` (ver "Geometría"), así el dato se une a la geometría **por código y nunca por nombre**, como en AgroENSO.
- `focos`: focos detectados en el mes.
- `anomalia`: la anomalía tal como la calcula SEPA. Hay que definir la unidad: diferencia, porcentaje o desvíos.

El formato final lo define lo que el proceso de SEPA pueda exportar más fácil. Lo importante es que tenga el código INDEC y los números.

**Serie histórica:** para que el gráfico por departamento tenga sentido, hace falta cargar una vez los meses desde 2001 en el mismo formato.

### Geometría

Se parte de la capa que ya usa el visor de 5 días: `seccion-focos/data/geoJSON/DEPTOS-PROV.geojson` (fuente INDEC 2005, todos los departamentos del país). Se simplifica **una sola vez** a unos cientos de KB y queda como archivo estático.

- **Clave de unión: `LINK`**, que es el código INDEC de 5 dígitos como texto (por ejemplo, `"38077"`). **No usar `id`**, que viene sin el cero inicial (`"3877"`). También trae `COD_PROV`, `COD_DEPTO`, `DEPTO` y `PROVINCIA` para el tooltip.
- **Hay que simplificarla:** el archivo original pesa unos 13 MB. Sirve para el punto en polígono del visor de 5 días, pero es demasiado pesado para un mapa coroplético.
- **Ventaja frente a la capa del IGN:** es la misma geometría que ya usa SEPA, lo que reduce las diferencias de códigos entre productos. Conviene confirmar con SEPA que es la misma capa con la que el proceso mensual asigna departamentos.
- **No sirve la de AgroENSO tal cual:** `build_geometry()` la recorta a los departamentos con datos de cultivos, es decir, a la zona agrícola. Justo quedan afuera Patagonia, el Delta o el Chaco seco, donde hay muchos focos.
- Para simplificarla se puede reutilizar `simplify_geojson` de `build_map.py`, copiándola a un script de un solo uso. No conviene que un proyecto dependa del otro por unas pocas líneas.
- AgroENSO necesitó una tabla de correcciones de códigos (`DEPTO_CODE_FIX`) para algunos departamentos cuyo código no coincidía entre fuentes. Si los datos de SEPA usan otra versión de los códigos, puede hacer falta algo parecido: hay que revisar qué departamentos quedan sin unir.

### Lista de meses: `listar.php`

El visor necesita saber qué meses hay. `listar.php` **no recibe ningún parámetro**: lista la carpeta `datos/` y devuelve los meses encontrados. Sin parámetros no hay nada que validar, y se evita el riesgo de que alguien pida otra carpeta (el problema posible que se observó en `listar_archivos_MNC.php`).

```php
<?php
header('Content-Type: application/json');
$meses = [];
foreach (glob(__DIR__ . '/datos/focos_*.csv') ?: [] as $f) {
    if (preg_match('/focos_(\d{6})\.csv\z/', $f, $m)) $meses[] = $m[1];
}
sort($meses);
echo json_encode($meses);
```

### Serie histórica: `serie.php`

El gráfico de un departamento necesita todos sus meses. Si el navegador tuviera que leer un CSV por mes, para dibujar **un solo gráfico** bajaría unos 300 archivos (2001–2026). Por eso:

- Los CSV mensuales en `datos/` siguen siendo el **contrato con el proceso de SEPA**: no cambia nada para quien los genera.
- `serie.php` arma un único `cache/serie.json` con todos los departamentos y meses (`{ "06007": { "200101": [focos, anomalia], … }, … }`). Lo regenera solo cuando cambia la carpeta `datos/`: guarda junto al caché una huella de los CSV (nombre, tamaño y fecha de modificación de cada archivo) y la compara en cada pedido. Así detecta archivos nuevos, borrados o reescritos dentro del mismo segundo. El resto del tiempo devuelve el archivo ya armado. Si un CSV no tiene las columnas `in1,focos,anomalia`, responde un error 500 que nombra el archivo, en lugar de tomarlo como un mes vacío.
- **Tampoco recibe parámetros:** devuelve la serie completa y el navegador la carga una sola vez. Si el tamaño lo exige, se puede filtrar por departamento con `serie.php?in1=XXXXX`, validando el parámetro con `^\d{5}$` antes de usarlo.

### Funcionalidades del visor

1. Selectores de año y mes (por defecto, el último disponible).
2. Mapa coroplético con dos capas a elegir, **anomalía** y **focos totales**, que son los dos mapas de la imagen actual. La anomalía con escala divergente (menos focos / normal / más focos) y los totales con escala secuencial.
3. Al pasar el mouse: nombre del departamento, provincia y valor.
4. Al hacer clic: gráfico con la serie mensual del departamento y su promedio histórico como referencia.
5. Se mantienen las descargas actuales (JPG y KML) para quien las use.

### Librerías

| Necesidad | Qué usar | Por qué |
|---|---|---|
| Mapa | Leaflet 1.9.4, **con versión fija** en la URL | Es la que ya usa el sitio, pero hoy se carga sin versión (también en `seccion-focos`: `unpkg.com/leaflet/dist/…`): una versión mayor nueva publicada en el CDN puede romper los visores. |
| Gráfico por departamento | Chart.js, **con versión fija** | SEPA ya lo usa en `geosepa`. |
| Todo lo demás | JS y PHP sin librerías | Sin framework ni paso de build: se edita y se sube, como el resto del sitio. |

### Qué no hace falta

- Base de datos: los CSV en una carpeta alcanzan y son fáciles de revisar a mano.
- Un backend más allá de `listar.php` y `serie.php`.
- Una API externa consultada desde el navegador: el visor de 5 días tampoco la usa, porque trabaja con archivos que el servidor descarga y guarda.
- Un framework de front, npm o paso de build.
- El pipeline de Python de AgroENSO.

## Fases

1. **Reunión con la responsable del producto.** Confirmar la idea y responder las preguntas de `PREGUNTAS_REUNION.md`. La primera es bloqueante: si el proceso mensual no puede exportar los números, este plan cambia.
2. **Prototipo local** con la geometría y dos o tres meses de datos de ejemplo. Se valida el diseño antes de tocar el sitio.
3. **Carga de la serie histórica** (2001 en adelante) y revisión de los departamentos que no se unen por código.
4. **Integración en el sitio:** plantilla con el header y el footer, ubicación definitiva y link desde el menú de productos.
5. **Operación mensual:** el proceso de SEPA deja el CSV del mes en `datos/` junto con la JPG. El visor lo muestra solo, sin tocar código.

## Riesgos

- **Que el proceso no pueda exportar datos.** Habría que reconstruirlos desde las fuentes y el proyecto crece mucho. El camino ya está probado en el visor de 5 días: focos de NASA FIRMS unidos por punto en polígono con `DEPTOS-PROV.geojson`. Pero para la historia hay que usar el **archivo histórico de MODIS estándar**, no el NRT, que es preliminar. Además, la línea base 2001–2020 se procesa una sola vez, y hay que confirmar que SEPA cuenta los focos con el mismo criterio (por ejemplo, el umbral de confianza).
- **Continuidad de MODIS.** Terra y Aqua llevan más de 20 años en órbita y se acercan al fin de su misión, y el sitio ya publica productos con VIIRS. Conviene decidir desde el principio con qué sensor se arma el visor, o que la columna de datos indique el sensor.
- **Mantenimiento.** Si nadie del equipo de SEPA toma el visor como propio, se desactualiza. Por eso sigue el formato de sus otros visores.
- **`descargarkml.php` acepta cualquier valor en `uri`.** Con `?uri=x` responde 200 con un KML. No se exploró más, pero conviene revisarlo con el mismo criterio que `listar_archivos_MNC.php` antes de enlazarlo desde el visor nuevo.
