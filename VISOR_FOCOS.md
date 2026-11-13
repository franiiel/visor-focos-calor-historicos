# Propuesta: visor interactivo de focos de calor por departamento

## Objetivo

Reemplazar (o complementar) la página actual de **anomalía histórica mensual departamental de focos de calor** (`/productos/focos/anomalia_deptos/`), que hoy muestra una imagen por mes, por un **mapa interactivo**: elegir mes, pasar el mouse por un departamento para ver su valor, y hacer clic para ver su serie en el tiempo.

Es un producto **separado de AgroENSO**. Ver "Por qué no va dentro de AgroENSO".

## Situación actual

Relevado desde afuera; el código del proceso que genera las imágenes no es visible.

- Datos: focos de calor MODIS (satélites Aqua y Terra, resolución de 100 ha). La anomalía mensual es una **clase del 1 al 5** que compara los focos del mes con los del mismo mes en 2001–2025 (ver "Datos recibidos de SEPA").
- Publicación: una imagen JPG por mes (`sepaproductos/anomalia_deptos/ad_AAAAMM.jpg`), con dos mapas: anomalía a la izquierda y focos totales acumulados a la derecha. La lista de imágenes se escribe en la página a mano o por PHP (`imagenes.push('ad_202608.jpg')`, …).
- La página tiene filtros de año y mes y una descarga en KML (`descargarkml.php`).
- Se actualiza **todos los meses**.

### Visor de referencia: focos de los últimos 5 días

El sitio ya tiene un visor interactivo de focos (`/productos/focos/seccion-focos/`), desarrollado en el marco del convenio INTA-UNAHUR. Es el antecedente más directo de este proyecto. Relevado desde su código público:

- **No consulta ninguna API desde el navegador.** Lee un CSV estático del propio servidor (`data/raw/firms_latest.csv`). Ese archivo es el CSV público de NASA FIRMS (MODIS C6.1 NRT, Sudamérica, 7 días: `MODIS_C6_1_South_America_7d.csv`), que un proceso del servidor descarga y actualiza automáticamente.
- **La unión foco → departamento se hace en el navegador**, con Turf.js y rbush (punto en polígono) contra `data/geoJSON/DEPTOS-PROV.geojson`.
- **Estructura:** plantilla PHP con el header y el footer del sitio, un punto de entrada JS (`web/index-csv.js`) que carga módulos (`dataManager`, `mapManager`, `tableManager`, `locationManager`) y su CSS. Usa cache-busting con un timestamp generado por PHP.
- Este visor de focos históricos sigue el mismo esquema, así SEPA integra los dos productos de la misma manera.

### Datos recibidos de SEPA

En octubre de 2026 SEPA entregó dos planillas: `ESTADISTICAS-DEPARTAMENTALES2026.xlsx` y `ESTADISTICAS-PROVINCIALES2026.xlsx`. Son libros de trabajo que se completan a mano (tienen tablas dinámicas y hojas de prueba), no un formato de entrega.

**Planilla departamental.** Es la fuente del visor. Se usan dos hojas:

- `FCXMESXAÑO`: focos por año, provincia y departamento, con una columna por mes (`AÑO`, `PROV`, `DEPTO`, `ENE` … `DIC`). Cubre de 2001 a agosto de 2026. Identifica los departamentos solo por nombre.
- `ESTADISTICAS`: un renglón por departamento con `COD_PROV` y `COD_DEPTO`. Juntos forman el código INDEC de 5 dígitos (`06` + `854` = `06854`). Sirve para pasar de nombre a código: los 510 departamentos de `FCXMESXAÑO` se unen sin ambigüedad y todos los códigos existen en la geometría.

Las hojas `ENERO` … `DIC` tienen, para cada departamento, las referencias del mes (máximo, media y mínimo) y la clase de anomalía de 2026. Están completas de enero a agosto.

**La anomalía es una clase, no un número.** SEPA compara los focos del mes con el máximo, la media y el mínimo del mismo mes en 2001–2025:

| Clase | Condición | Lectura |
|---|---|---|
| 5 | focos > máximo | por encima del máximo histórico |
| 4 | focos > media + 10 % | por encima de lo normal |
| 3 | focos > media − 10 % | normal (dentro de ±10 % de la media) |
| 2 | focos > mínimo | por debajo de lo normal |
| 1 | focos ≤ mínimo | igual o por debajo del mínimo histórico |

Las condiciones se evalúan de arriba hacia abajo (fórmula de la planilla: `SI(fc>MAX;5;SI(fc>MD+10%;4;SI(fc>MD-10%;3;SI(fc>MIN;2;1))))`). La media se calcula sobre los años que tienen renglón en `FCXMESXAÑO`: un año sin renglón no cuenta como cero (ver "Preguntas pendientes para SEPA").

**Planilla provincial.** Tiene el mismo esquema por provincia. El visor no la usa, pero sirve de control: la suma de los departamentos de cada provincia tiene que dar el total provincial de cada mes.

## Por qué no va dentro de AgroENSO

| | AgroENSO | Visor de focos |
|---|---|---|
| Pregunta | ¿Cómo afecta el ENSO al rendimiento? | ¿Cuántos focos hubo y cuánto se apartan de lo normal? |
| Cálculo | Pipeline estadístico propio (detrending, Wilcoxon, FDR) | Conteo de focos por departamento y mes, y clase 1–5 contra máximo, media y mínimo históricos |
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
├── config.json          qué datos muestra el visor y de qué fuentes (ver "Configuración")
├── deptos.geo.json      geometría de departamentos (estática)
├── listar.php           devuelve la lista de meses disponibles
├── serie.php            devuelve la serie consolidada (con caché)
├── lib/                 funciones PHP compartidas y actualizar_mes.php del cron (no se acceden desde la web)
├── cache/
│   └── serie_<fuente>.json  generado por serie.php, no se edita a mano
└── datos/
    ├── modis/           una carpeta por fuente (sensor), con el id de config.json
    │   ├── focos_200101.csv
    │   ├── …
    │   └── focos_202608.csv    ← uno nuevo por mes, lo deja el proceso de SEPA
    └── viirs/
        └── focos_AAAAMM.csv    desde 2012 (VIIRS S-NPP)
```

Sigue el mismo esquema que el visor de focos de los últimos 5 días (`/productos/focos/seccion-focos/`) y los visores de `/productos/geosepa/`: plantilla PHP, módulos JS y su CSS. Así el equipo de SEPA lo puede mantener sin aprender nada nuevo.

### Formato de datos propuesto

Un CSV por mes, con una fila por departamento:

```csv
in1,focos,anomalia
06007,12,4
06014,0,1
…
```

- `in1`: código INDEC del departamento (5 dígitos, como texto para no perder el cero inicial). Coincide con el campo `LINK` de `DEPTOS-PROV.geojson` (ver "Geometría"), así el dato se une a la geometría **por código y nunca por nombre**, como en AgroENSO.
- `focos`: focos detectados en el mes.
- `anomalia`: la clase de anomalía de SEPA, un entero del 1 al 5 (ver la tabla de "Datos recibidos de SEPA").

El formato final lo define lo que el proceso de SEPA pueda exportar más fácil. Lo importante es que tenga el código INDEC y los números.

**Serie histórica:** se calcula desde los focos crudos de NASA FIRMS con `tools/compute_anomalies.mjs` (ver «Motor de cálculo desde FIRMS»). La planilla departamental pasa a ser el resultado esperado, con el que se valida el motor. También se puede convertir con `tools/convert_excel.mjs`: lee `FCXMESXAÑO`, pasa de nombre a código con `ESTADISTICAS`, calcula la clase de cada mes con la regla de SEPA y escribe un CSV por mes con este formato. En los dos casos los CSV salen con `in1` y el visor nunca une por nombre.

### Motor de cálculo desde FIRMS

La planilla de SEPA se completa a mano. El motor hace el mismo cálculo desde los datos de origen, una descarga de NASA FIRMS (MODIS C6.1, Argentina: `fire_archive_*.csv` de 2001 en adelante y `fire_nrt_*.csv` para los meses que todavía no están en el archivo histórico):

1. **Fuentes.** Del NRT se toman solo los días posteriores al último del archivo histórico, para no contar dos veces. Se cuentan **todos los focos**, sin filtrar por `type` ni `confidence`: así cierran los totales mensuales de la planilla (agosto de 2025: 9435 focos en FIRMS y en la planilla; enero de 2001: 8132 y 8130).
2. **Departamento de cada foco.** Punto en polígono contra `DEPTOS-PROV.geojson` completo, la misma capa del visor de 5 días. Nunca contra la geometría simplificada del visor, que movería los focos cercanos a los límites. Los focos que no caen en ningún departamento (mar, países vecinos) se descartan: son 2109 de 1,7 millones.
3. **Ceros.** Un departamento sin focos en un mes tiene 0 focos ese mes. Con los datos de origen el cero es real, así que cada mes tiene un renglón por departamento (ver la pregunta 2).
4. **Referencias.** Para cada departamento y mes calendario, en el período `climatology` (2001–2025): máximo, media, mínimo y desvío estándar (muestral, como `DESVEST` de Excel). Se guardan en `datos/referencia.csv`. El desvío no interviene en la clase.
5. **Clase.** La regla de la tabla de «Datos recibidos de SEPA», sin cambios.

Salen los mismos CSV mensuales de «Formato de datos propuesto», así que el visor no cambia. Tarda menos de un minuto.

**Validación contra la planilla** (de enero de 2001 a agosto de 2026):

- Focos por departamento y mes: 143 043 de 149 418 coinciden exactamente (96 %). De los 6375 que no coinciden, 2572 difieren en un solo foco.
- Las diferencias de un foco suelen ser entre departamentos vecinos (enero de 2026: Gualeguaychú 12 en la planilla y 11 en el motor; Uruguay, 8 y 9). Es un foco cerca del límite que queda de distinto lado, señal de que la planilla se arma con otra capa o versión de los límites (ver la pregunta 8).
- Las diferencias grandes son errores de carga de la planilla (ver las preguntas 9 y 10).
- Clases de 2026 contra las hojas `ENERO` … `AGO`: 3951 de 4080 coinciden (96,8 %). De las 129 distintas, 102 vienen de un conteo de 2026 distinto (casi siempre por un foco del límite) y el resto, de las referencias (años sin renglón en la planilla, errores de carga y la hoja `ABRIL`).

**Validación de VIIRS S-NPP** contra la planilla de INTA `analisis-departamentales.xlsx` (hoja `historia`, de 2012 a 2025, y hojas `JUL`, `AGO` y `OCT` de 2026):

- Focos por departamento y mes: 81 937 de 83 580 coinciden exactamente (98 %). Las diferencias grandes son las mismas de MODIS: departamentos con Ñ cuyo código está intercambiado con el de un vecino en la planilla (Campana y Cañuelas, Aluminé y Añelo) y Lácar y Huiliches en febrero de 2025 (ver la pregunta 10).
- Focos de 2026: coinciden en 497, 493 y 502 de 510 departamentos (julio, agosto y octubre). Casi todas las diferencias son esos códigos intercambiados.
- Clases de 2026: julio coincide en 502 de 510. En agosto y octubre coinciden mucho menos (365 y 351) por dos motivos de la planilla: la media usa 13 años en los departamentos sin renglón en algún año (ver la pregunta 2), y la hoja `OCT` usa la referencia de agosto (sus MAX, MD y MIN son iguales a los de `AGO`).

### Configuración del conjunto de datos

El visor no está atado a los focos MODIS. Todo lo que depende de los datos está en un solo archivo, `config.json`, y el código no cambia. Los textos y el formato de los CSV son comunes; cada **fuente** (sensor) de `sources` es una pestaña del visor, con sus CSV en `datos/<id>/` y su propio período de referencia:

```json
{
  "title": "Focos de calor por departamento",
  "filePrefix": "focos",
  "columns": { "value": "focos", "anomaly": "anomalia" },
  "integerValues": true,
  "unit": "focos",
  "valueLabel": "Focos totales",
  "valueTitle": "Focos de calor totales",
  "anomalyTitle": "Anomalía de focos de calor",
  "anomalyClasses": [
    "Igual o por debajo del mínimo histórico",
    "Por debajo del promedio (-10 %)",
    "Promedio",
    "Por encima del promedio (+10 %)",
    "Por encima del máximo histórico"
  ],
  "sources": [
    { "id": "modis", "label": "MODIS", "firmsSource": "MODIS_NRT",
      "climatology": { "from": "200101", "to": "202512" }, "note": "Anomalía: … 2001–2025 …" },
    { "id": "viirs", "label": "VIIRS S-NPP", "firmsSource": "VIIRS_SNPP_NRT",
      "climatology": { "from": "201201", "to": "202512" }, "note": "Anomalía: … 2012–2025 …" }
  ]
}
```

- `filePrefix` y `columns`: nombre de los CSV (`datos/<id>/<filePrefix>_AAAAMM.csv`) y de sus dos columnas numéricas. `in1` es siempre la clave de unión. Con los valores de arriba, el formato es el de "Formato de datos propuesto".
- `integerValues`: `true` para conteos (se redondean a enteros); `false` para conservar decimales.
- `anomalyClasses`: los textos de las clases 1 a 5, en ese orden. Aparecen en la leyenda y en el tooltip.
- `title`, `unit`, `valueLabel`, `valueTitle` y `anomalyTitle`: textos de la página, la leyenda, el tooltip y el gráfico.
- `sources`: las fuentes, en el orden de las pestañas; la primera es la que se abre por defecto (otra se abre con un enlace como `…/#viirs`). Cada una tiene:
  - `id`: nombre de su carpeta en `datos/` (`^[a-z0-9_-]+$`, único).
  - `label`: el texto de la pestaña.
  - `firmsSource`: la fuente de la API de FIRMS que usa el cron (`MODIS_NRT`, `VIIRS_SNPP_NRT`…).
  - `climatology`: período de referencia (AAAAMM, inclusive; el mes va de 01 a 12). MODIS usa el mismo con el que SEPA calcula las clases, 2001–2025; VIIRS S-NPP empieza en 2012, así que usa 2012–2025. El visor lo muestra en la leyenda de la anomalía y en la comparación por año.
  - `note`: texto libre al pie del mapa. Si menciona el período o la unidad, se actualiza a mano junto con `climatology` y `unit`.

Las dos fuentes no se mezclan: cada una tiene sus CSV, su caché y su climatología, porque VIIRS detecta más focos que MODIS (mayor resolución) y comparar un mes VIIRS con una referencia MODIS daría anomalías falsas. Una fuente sin CSV todavía se muestra con el aviso «Todavía no hay datos de …» y el mapa gris.

Para agregar una fuente (por ejemplo NOAA-20), se agrega un elemento a `sources` y se dejan sus CSV en `datos/<id>/`. El caché de `serie.php` se regenera solo, porque su huella incluye la configuración. Si `config.json` falta o no es válido (por ejemplo, un prefijo o un `id` con `/` o `..`), los tres puntos de entrada responden un error 500 que lo nombra: no hay valores por defecto ocultos en el código, así que `config.json` se sube siempre junto con el resto de los archivos. Se acepta guardado con o sin BOM UTF-8.

La escala de los valores está pensada para conteos (reserva una clase para el cero); una variable continua puede necesitar otros cortes. La de la anomalía es fija: un color por clase.

### Geometría

Se parte de la capa que ya usa el visor de 5 días: `seccion-focos/data/geoJSON/DEPTOS-PROV.geojson` (fuente INDEC 2005, todos los departamentos del país). Se simplifica **una sola vez** a unos cientos de KB y queda como archivo estático.

- **Clave de unión: `LINK`**, que es el código INDEC de 5 dígitos como texto (por ejemplo, `"38077"`). **No usar `id`**, que viene sin el cero inicial (`"3877"`). También trae `COD_PROV`, `COD_DEPTO`, `DEPTO` y `PROVINCIA` para el tooltip.
- **Hay que simplificarla:** el archivo original pesa unos 13 MB. Sirve para el punto en polígono del visor de 5 días, pero es demasiado pesado para un mapa coroplético.
- **Ventaja frente a la capa del IGN:** es la misma geometría que ya usa SEPA, lo que reduce las diferencias de códigos entre productos. Conviene confirmar con SEPA que es la misma capa con la que el proceso mensual asigna departamentos.
- **No sirve la de AgroENSO tal cual:** `build_geometry()` la recorta a los departamentos con datos de cultivos, es decir, a la zona agrícola. Justo quedan afuera Patagonia, el Delta o el Chaco seco, donde hay muchos focos.
- Para simplificarla se puede reutilizar `simplify_geojson` de `build_map.py`, copiándola a un script de un solo uso. No conviene que un proyecto dependa del otro por unas pocas líneas.
- AgroENSO necesitó una tabla de correcciones de códigos (`DEPTO_CODE_FIX`) para algunos departamentos cuyo código no coincidía entre fuentes. Si los datos de SEPA usan otra versión de los códigos, puede hacer falta algo parecido: hay que revisar qué departamentos quedan sin unir.

### Lista de meses: `listar.php`

El visor necesita saber qué meses hay. `listar.php?fuente=<id>` lista la carpeta `datos/<id>/` y devuelve los meses encontrados (`["200101", …]`), con el prefijo de `config.json`; sin `fuente`, usa la primera fuente. El único parámetro **no es una ruta**: se compara contra la lista de `id` de `config.json` y cualquier otro valor (`..`, `../datos`, `MODIS`, un arreglo) responde 400. Así se evita el riesgo de que alguien pida otra carpeta (el problema posible que se observó en `listar_archivos_MNC.php`). El prefijo y los `id` vienen de un archivo del servidor, no del pedido, y además se validan (`^[a-z0-9_-]+$`) antes de usarlos en la búsqueda de archivos.

### Serie histórica: `serie.php`

El gráfico de un departamento necesita todos sus meses. Si el navegador tuviera que leer un CSV por mes, para dibujar **un solo gráfico** bajaría unos 300 archivos (2001–2026). Por eso:

- Los CSV mensuales en `datos/<id>/` siguen siendo el **contrato con el proceso de SEPA**: el formato no cambia, solo la carpeta (los de MODIS van en `datos/modis/`).
- `serie.php?fuente=<id>` (misma validación que `listar.php`) arma un `cache/serie_<id>.json` por fuente con todos los departamentos y meses (`{ "months": [...], "data": { "06007": { "value": [...], "anomaly": [...] } }, "clim": {...} }`). Lo regenera solo cuando cambia la carpeta `datos/<id>/` o `config.json`: guarda junto al caché una huella de la configuración y de los CSV (nombre, tamaño y fecha de modificación de cada archivo) y la compara en cada pedido. Así detecta archivos nuevos, borrados o reescritos dentro del mismo segundo. El resto del tiempo devuelve el archivo ya armado. Si un CSV no tiene las columnas configuradas (por defecto `in1,focos,anomalia`), responde un error 500 que nombra el archivo, en lugar de tomarlo como un mes vacío.
- **Sin `in1`** devuelve la serie completa de la fuente y el navegador la carga una sola vez. Si el tamaño lo exige, se puede filtrar por departamento con `serie.php?in1=XXXXX`, validando el parámetro con `^\d{5}$` antes de usarlo. Esa respuesta es `{ "in1", "months", "value", "anomaly", "clim" }`: las claves son genéricas y no dependen del nombre de las columnas en `config.json`.

### Funcionalidades del visor

1. Selectores de año y mes (por defecto, el último disponible).
2. Mapa coroplético con dos capas a elegir, **anomalía** y **focos totales**, que son los dos mapas de la imagen actual. La anomalía con una leyenda fija de cinco colores, uno por clase (de "igual o por debajo del mínimo histórico" a "por encima del máximo histórico"), y los totales con escala secuencial.
3. Al pasar el mouse: nombre del departamento, provincia y valor. En la capa de anomalía, el texto de la clase.
4. Filtros opcionales de **provincia** y **departamento**. Sin filtro, el visor funciona igual: se hace clic en el mapa. Elegir una provincia acerca el mapa a ella, remarca sus departamentos y habilita la lista de sus departamentos; hacer clic en un departamento del mapa actualiza los dos filtros. "Todas" vuelve al país entero.
5. Gráfico con la serie mensual, de 2001 en adelante, del área elegida:
   - sin selección, el **total de Argentina**;
   - con una provincia, el **total de la provincia**;
   - con un departamento (por filtro o clic en el mapa), la **serie del departamento**.

   Los totales suman los focos de los departamentos de cada mes; un mes en que ninguno tiene dato queda sin dato. Se calculan en el navegador a partir de la respuesta completa de `serie.php`, que se descarga una sola vez (unos 750 KB sin comprimir). Si ese tamaño llega a ser un problema, se puede agregar un parámetro de provincia validado con `^\d{2}$`. La clase de anomalía existe solo por departamento, así que en los totales el texto del panel muestra solo los focos.

   Un botón con ícono **amplía el gráfico** a casi toda la pantalla; el mismo botón o la tecla Esc lo vuelven a su lugar.

   El gráfico muestra:
   - **Focos del mes:** la cantidad de cada mes. Un mes sin dato corta la línea.
   - **Promedio por lustro:** una línea horizontal por cada bloque de cinco años, contados desde el primer año de la serie (2001–2005, 2006–2010, …). Es el promedio de los focos mensuales del bloque, solo con los meses que tienen dato. El último bloque puede estar incompleto (por ejemplo, 2026): su promedio usa los meses disponibles.
   - **Mes seleccionado:** un punto que acompaña a los selectores de año y mes.

   Arriba del gráfico, un texto resume el mes elegido: focos y, para un departamento, su clase de anomalía.

   El gráfico **no muestra la clase** ni el promedio de referencia de cada mes (el de ese mismo mes calendario en el período `climatology`). La clase depende de la banda de ±10 % alrededor de esa media mensual y del mínimo y el máximo históricos, que no se dibujan. Las líneas de lustro muestran la tendencia de largo plazo, no la referencia de la clase: un mes por encima de su lustro puede ser "Normal" o incluso estar por debajo del promedio de su mes. La clase se lee en el texto del panel o en el mapa.
6. **Comparación por año**, debajo del mapa, para la misma área del gráfico anterior (Argentina, provincia o departamento). Los años se agregan de a uno desde una lista desplegable, sin límite; cada año elegido aparece como una etiqueta con su color y una × para quitarlo, y vuelve a la lista. Al empezar está elegido el último año. El gráfico va de enero a diciembre y muestra:
   - **Cada año elegido:** sus focos de cada mes, como puntos unidos por una línea, con un color propio que no cambia mientras el año siga elegido. Los primeros 8 usan una paleta categórica apta para daltonismo; desde el noveno, los colores se generan girando el tono y ya no están verificados. Con muchos años el gráfico se vuelve difícil de leer: queda a criterio de quien los elige.
   - **Promedio, máximo y mínimo históricos:** para cada mes calendario, sobre los años del período `climatology` (2001–2025) que tienen dato. Son los mismos valores con los que se calculan las clases de anomalía de un departamento; en los totales se calculan sobre la suma. Promedio en línea negra continua; máximo y mínimo en gris discontinuo.

   Sin ningún año marcado, el gráfico se oculta.
7. Se mantienen las descargas actuales (JPG y KML) para quien las use.

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

1. **Reunión con la responsable del producto.** Confirmar la idea y responder las "Preguntas pendientes para SEPA". La primera define cómo funciona la operación mensual (fase 5).
2. **Prototipo local** con la geometría y dos o tres meses de datos de ejemplo. Se valida el diseño antes de tocar el sitio.
3. **Carga de la serie histórica** (2001 en adelante) desde la planilla departamental, con el script de conversión de `tools/`, y control contra la planilla provincial.
4. **Integración en el sitio:** plantilla con el header y el footer, ubicación definitiva y link desde el menú de productos.
5. **Operación mensual:** un cron del servidor de SEPA deja el CSV del mes de cada fuente en `datos/<id>/` (ver «Actualización mensual automática»). El visor lo muestra solo, sin tocar código.

### Actualización mensual automática

La serie histórica se genera una sola vez con el motor de Node (`tools/compute_anomalies.mjs`). Después, cada mes, `lib/actualizar_mes.php` calcula solo el mes nuevo. Es PHP de línea de comandos porque PHP es lo único que seguro está en el servidor:

```
FIRMS_MAP_KEY=xxxxxxxx
0 4 2 * * php /ruta/visor_deptos/lib/actualizar_mes.php --fuente modis --geojson /ruta/seccion-focos/data/geoJSON/DEPTOS-PROV.geojson >> /ruta/logs/visor_deptos.log 2>&1
30 4 2 * * php /ruta/visor_deptos/lib/actualizar_mes.php --fuente viirs --geojson /ruta/seccion-focos/data/geoJSON/DEPTOS-PROV.geojson >> /ruta/logs/visor_deptos.log 2>&1
```

- **Cuándo:** el día 2 de cada mes a las 4:00, una línea por fuente. Calcula el mes anterior, cuando el NRT de FIRMS ya está completo.
- **Fuente:** `--fuente <id>` elige la fuente de `config.json` (por defecto, la primera): de ella salen la carpeta `datos/<id>/`, la climatología y la fuente de FIRMS (`firmsSource`).
- **De dónde saca los focos:** de la API de área de FIRMS (`MODIS_NRT` o `VIIRS_SNPP_NRT`, recuadro de Argentina, pedidos de 5 días como máximo). Necesita un MAP_KEY, que es gratuito y va en la variable `FIRMS_MAP_KEY`, nunca en el código.
- **Por qué no usa el archivo del visor de 5 días:** `firms_latest.csv` es una ventana de 7 días que se pisa en cada descarga. Para armar un mes habría que acumularlo, y si el cron se corta más de una semana el mes queda incompleto sin forma de recuperarlo. La API, en cambio, devuelve cualquier mes pasado.
- **Mismas reglas que el motor:** todos los focos, `DEPTOS-PROV.geojson` completo (el mismo archivo que ya usa el visor de 5 días), 0 para los departamentos sin focos y clase contra el mismo mes de la climatología de la fuente (2001–2025 en MODIS), que se lee de los CSV de `datos/<id>/`. Para agosto y septiembre de 2026 da exactamente los mismos archivos que el motor de Node.
- **Sin meses a medias:** si un pedido falla, la clave no es válida o la respuesta no es un CSV de FIRMS, termina con código 1, deja el error en el log y no escribe nada. El archivo se escribe con un nombre temporal y se renombra al final.
- **Rehacer un mes:** `--mes AAAAMM`. Con `--csv archivo.csv` lee una descarga hecha a mano en lugar de usar la API.
- **NRT y datos definitivos:** el NRT puede diferir un poco de los datos definitivos (`MODIS_SP`), que FIRMS publica dos o tres meses después. Si SEPA quiere los definitivos, alcanza con una segunda línea en el cron: `--source MODIS_SP --mes <de hace tres meses>`. Rehacer un mes de 2001–2025 no recalcula las clases de los otros meses: para eso se vuelve a correr el motor de Node.

### Actualización mensual manual

Si el cron no se puede instalar, el mes se puede calcular a mano en una PC con Windows, sin instalar nada: se descarga de FIRMS el CSV MODIS del mes, se lo copia (o la carpeta de la descarga entera) en `nasa/modis/`, junto a `procesar_focos.exe`, y se hace doble clic. El programa escribe `datos/modis/focos_AAAAMM.csv`, que después se sube a `datos/modis/` del visor, y mueve la descarga a `nasa/modis/procesados/`. Para VIIRS se copia el CSV VIIRS S-NPP en `nasa/viirs/` y el programa escribe en `datos/viirs/`; con las dos carpetas cargadas, un doble clic procesa ambas. Una descarga que cubre toda la climatología de la fuente (el archive completo de FIRMS) rearma en cambio todos los meses y `referencia.csv`, con el mismo resultado que `tools/compute_anomalies.mjs`: así se arma el histórico la primera vez. Así `datos/` tiene solo lo que va al visor. Aplica las mismas reglas que el cron y da el mismo archivo. La carpeta de la fuente tiene que tener el histórico (para la referencia: 2001–2025 en MODIS, 2012–2025 en VIIRS). Si la descarga trae varios meses, escribe uno por mes, con el mismo resultado que procesarlos de a uno en orden. Como FIRMS solo trae los días con focos, no se puede saber con certeza si un mes está completo: el programa muestra la fecha del primer y del último foco y avisa si el primer mes empieza después del día 1 o el último termina antes de fin de mes (por ejemplo, el mes en curso), para volver a procesarlo cuando termine. Es un paso manual mensual, justo lo que el cron evita (ver «Idea central»), así que conviene usarlo solo mientras no haya cron.

## Riesgos

- **Formato de entrega mensual sin definir.** Los datos existen (ver "Datos recibidos de SEPA"), pero hoy viven en una planilla que se completa a mano, y PHP no lee `.xlsx` sin una librería externa. Lo ideal es que SEPA exporte cada mes el CSV en el formato acordado. Si no puede, alguien tiene que correr el script de conversión todos los meses, y eso es justo lo que el diseño busca evitar (ver "Idea central"). El motor de FIRMS saca la planilla del medio, y el cron mensual (ver «Actualización mensual automática») saca el paso manual. Falta que SEPA instale el cron, saque un MAP_KEY de FIRMS y confirme que el servidor puede consultar la API (ya descarga de FIRMS el CSV del visor de 5 días).
- **Continuidad de MODIS.** Terra y Aqua llevan más de 20 años en órbita y se acercan al fin de su misión, y el sitio ya publica productos con VIIRS. Por eso el visor muestra cada sensor en su pestaña (MODIS y VIIRS S-NPP, ver «Configuración del conjunto de datos»): cuando MODIS deje de publicarse, VIIRS sigue sin cambios de código. La serie VIIRS es más corta (desde 2012), así que su referencia de anomalía cubre menos años.
- **Mantenimiento.** Si nadie del equipo de SEPA toma el visor como propio, se desactualiza. Por eso sigue el formato de sus otros visores.
- **`descargarkml.php` acepta cualquier valor en `uri`.** Con `?uri=x` responde 200 con un KML. No se exploró más, pero conviene revisarlo con el mismo criterio que `listar_archivos_MNC.php` antes de enlazarlo desde el visor nuevo.

## Preguntas pendientes para SEPA

1. **¿En qué formato y cada cuánto se van a entregar los datos de cada mes?** Lo ideal es un CSV por mes con `in1,focos,anomalia` (ver "Formato de datos propuesto").
2. **¿Un departamento sin renglón en un año significa cero focos?** De 2001 a 2020 cada año tiene entre 450 y 490 departamentos de 510. Hoy la media de referencia se calcula solo con los años que tienen renglón. Por ejemplo, Alberti (Buenos Aires) en enero tiene 24 años con datos: su media es 10 / 24 = 0,42, y sería 10 / 25 = 0,40 si el año faltante contara como cero. Ese cálculo sube la media y puede cambiar la clase. El conversor de la planilla replica ese cálculo. El motor de FIRMS cuenta el cero, porque con los datos de origen un mes sin focos es un cero real: de los 14 996 departamento-mes sin renglón en la planilla, el motor encuentra focos en solo 327. ¿Se acepta este criterio?
3. **¿Se acepta la referencia 2001–2025 para clasificar los meses de esos mismos años?** En los meses históricos, el año clasificado forma parte de su propia referencia. Es el criterio de la planilla, pero conviene dejarlo explícito en la nota del visor.
4. **¿Las comunas de la Ciudad de Buenos Aires (`02001` a `02021`) y el departamento `94021` quedan sin datos?** Están en la geometría pero no en la planilla. El motor de FIRMS les calcula focos (casi siempre 0).
5. **Años mal cargados en `FCXMESXAÑO`.** Cuatro filas tienen un año que no coincide con el bloque donde están: Comandante Fernández (Chaco) figura tres veces en 2020 (filas 9184, 9679 y 10189), y San Pedro (Buenos Aires) y San Roque (Corrientes) figuran dos veces en 2022 (filas 9639 y 9759, dentro del bloque de 2021). El conversor deja esos departamentos sin dato en esos años y los informa, sin adivinar cuál es la fila correcta. Al corregir la planilla, alcanza con volver a convertirla.
6. **La hoja `ABRIL` usa 2001–2024 como referencia.** Las demás hojas de 2026 usan 2001–2025. Por eso 8 departamentos tienen en abril una clase distinta de la que calcula el visor (por ejemplo, General Alvear, Mendoza: sus 70 focos de abril de 2025 no entran en el máximo de la hoja).
7. **La suma de los departamentos no coincide con la planilla provincial en 2021–2022.** De 7107 meses por provincia, 173 no coinciden, y 169 son de esos dos años (por ejemplo, Entre Ríos en diciembre de 2021: 717 focos sumando los departamentos y 476 en la planilla provincial). ¿Cuál de las dos planillas es la correcta para esos años?
8. **¿Con qué capa se asigna cada foco a su departamento?** El motor usa `DEPTOS-PROV.geojson` (INDEC 2005). Con esa capa, el 96 % de los departamento-mes coincide con la planilla, y la mayoría de las diferencias es un foco que queda del otro lado del límite entre dos vecinos.
9. **Agosto de 2020 tiene 10 708 focos menos en la planilla que en FIRMS** (22 263 contra 32 886), concentrados en Formosa y el Delta: Patiño (Formosa) tiene 1423 focos en la planilla y 2158 en el motor, y Victoria (Entre Ríos), 942 y 1590. Los demás meses cierran con una diferencia de pocos focos.
10. **Valores que parecen intercambiados entre departamentos.** En febrero de 2025, Lácar (Neuquén) tiene 0 focos en la planilla y 662 en el motor, y Huiliches tiene 650 y 0. En diciembre de 2021 pasa algo parecido en Formosa: Bermejo tiene 773 en la planilla y 90 en el motor, y Patiño, 101 y 777.
11. **¿Desvío estándar muestral o poblacional?** La planilla no lo calcula. El motor usa el muestral (`DESVEST`). Si se prefiere el poblacional (`DESVEST.P`), es un cambio de una línea.
