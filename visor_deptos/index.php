<?php
// Visor departamental de focos de calor, con la plantilla de las páginas de producto del sitio de SEPA:
// el menú, el pie de página y los estilos del sitio se incluyen desde $root.

// $root es relativo a esta carpeta, que en el sitio de SEPA queda cuatro niveles por debajo de la raíz.
// Si la carpeta se mueve a otra profundidad, hay que ajustarlo. SEPA_ROOT solo se define en local,
// para usar los stubs de tools/sepa_local/.
$root = getenv('SEPA_ROOT') ?: '../../../../';
$seccion = 'Productos';

// Invalidación de caché: la versión cambia cada vez que cambia el archivo.
function asset_version($file)
{
    $t = @filemtime(__DIR__ . '/' . $file);
    return $t ? (string) $t : '0';
}

require __DIR__ . '/lib/config.php';
try {
    $config = visor_config(__DIR__ . '/config.json');
} catch (VisorConfigException $e) {
    error_log('index.php: ' . $e->getMessage());
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Configuración inválida: config.json.';
    exit;
}

function h($text)
{
    return htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
}

header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html class="no-js" lang="es">
    <head>
        <meta charset="utf-8">
        <title>SEPA | <?php echo h($config['title']); ?></title>
        <meta name="description" content="<?php echo h($config['title']); ?>: mapa interactivo mensual por departamento">
        <?php include($root . 'includes/keywords.php'); ?>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta property="og:image" content="<?php echo $root; ?>img/thumb.png">
        <link rel="shortcut icon" href="<?php echo $root; ?>favicon.ico">
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href='https://fonts.googleapis.com/css?family=Roboto:700|Roboto+Condensed:400,700' rel='stylesheet' type='text/css'>
        <link rel="stylesheet" href="<?php echo $root; ?>css/normalize.min.css">
        <link rel="stylesheet" href="<?php echo $root; ?>css/main.css">
        <link rel="stylesheet" href="<?php echo $root; ?>css/extras.css">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
              integrity="sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H"
              crossorigin="anonymous">
        <link rel="stylesheet" href="app.css?v=<?php echo asset_version('app.css'); ?>">
        <script src="<?php echo $root; ?>js/vendor/modernizr-2.6.2-respond-1.1.0.min.js"></script>
        <?php include ($root . 'includes/analytics.php') ?>
</head>

<body>

<div id="sitio">

<!--  TOP -->
<?php include ($root . 'includes/nav.php') ?>


<!-- CONTENIDOS -->
    <div class="fondo extras">
        <div class="caja">

            <div class="cajaProductos">

                <h2><a href="<?php echo $root; ?>productos/" class="seccion">Anomalías mensuales</a><br>
                Frecuencia y anomalía histórica mensual de focos de calor</h2>
                <p>Muestra cómo cambia la frecuencia de focos de calor mensualmente desde el 2001 hasta la actualidad en función de medidas estadísticas (promedio, máximo, mínimos) de la serie histórica registrada para cada departamento y provincia de Argentina.

                <br><br>
                <span>
                Fuentes: Focos de calor FIRMS (Fire Information for Resource Management System).
                <br>
                <br>Consultas: <a href="mailto:fischer.maria@inta.gob.ar">fischer.maria@inta.gob.ar</a></span>

                <br><br>
                </p>

            </div>

            <div class="clearfix"></div>

<main class="visor" id="visor">
  <p class="visor-subtitle" id="map-title" aria-live="polite">Cargando datos…</p>

  <form class="visor-controls" id="controls" onsubmit="return false;">
    <label>Año
      <select id="sel-year" disabled></select>
    </label>
    <label>Mes
      <select id="sel-month" disabled></select>
    </label>
    <label>Provincia
      <select id="sel-prov" disabled><option value="">Todas</option></select>
    </label>
    <label>Departamento
      <select id="sel-depto" disabled><option value="">Todos</option></select>
    </label>
    <div class="visor-layer-row">
      <fieldset class="visor-layer">
        <legend>Capa</legend>
        <label><input type="radio" name="layer" value="anomaly" checked> Anomalía</label>
        <label><input type="radio" name="layer" value="value"> <?php echo h($config['valueLabel']); ?></label>
      </fieldset>
      <div class="visor-tabs" id="sources" role="group" aria-label="Sensor">
<?php foreach ($config['sources'] as $i => $source): ?>
        <button type="button" data-source="<?php echo h($source['id']); ?>"
                aria-pressed="<?php echo $i === 0 ? 'true' : 'false'; ?>"><?php echo h($source['label']); ?></button>
<?php endforeach; ?>
      </div>
    </div>
  </form>

  <div class="visor-error" id="error" role="alert" hidden></div>

  <div class="visor-layout">
    <div class="visor-map-wrap">
      <div id="map" class="visor-map" aria-label="Mapa de departamentos"></div>
      <div class="visor-legend" id="legend" aria-label="Referencias"></div>
    </div>

    <aside class="visor-panel" id="panel">
      <div class="visor-panel-head">
        <h2 id="panel-title">Distribución histórica mensual — Argentina</h2>
        <div class="visor-panel-actions">
          <button type="button" class="visor-icon-btn" popovertarget="chart-download"
                  aria-label="Descargar" title="Descargar">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>
          </button>
          <div class="visor-download-menu" id="chart-download" popover>
            <button type="button" id="chart-csv">Datos (CSV)</button>
            <button type="button" id="chart-png">Imagen (PNG)</button>
          </div>
          <button type="button" class="visor-icon-btn" id="chart-expand" aria-pressed="false"
                  aria-label="Ampliar gráfico" title="Ampliar gráfico">
            <svg class="icon-expand" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
            <svg class="icon-collapse" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>
          </button>
        </div>
      </div>
      <p id="panel-info" class="visor-hint">Cargando serie…</p>
      <p class="visor-hint">Elija una provincia o un departamento en el mapa para ver su serie.</p>
      <div class="visor-chart-wrap">
        <canvas id="chart" aria-label="Serie mensual de <?php echo h($config['unit']); ?>" role="img"></canvas>
      </div>
    </aside>

  <section class="visor-years" id="years" aria-labelledby="years-title">
    <div class="visor-panel-head">
      <h2 id="years-title">Distribución mensual por año seleccionado — Argentina</h2>
      <div class="visor-panel-actions">
        <button type="button" class="visor-icon-btn" popovertarget="years-download"
                aria-label="Descargar" title="Descargar">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>
        </button>
        <div class="visor-download-menu" id="years-download" popover>
          <button type="button" id="years-csv">Datos (CSV)</button>
          <button type="button" id="years-png">Imagen (PNG)</button>
        </div>
        <button type="button" class="visor-icon-btn" id="years-expand" aria-pressed="false"
                aria-label="Ampliar gráfico" title="Ampliar gráfico">
          <svg class="icon-expand" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
          <svg class="icon-collapse" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>
        </button>
      </div>
    </div>
    <div class="visor-years-filter">
      <label>Agregar año
        <select id="years-add"></select>
      </label>
      <ul class="visor-years-chips" id="years-chips" aria-label="Años elegidos"></ul>
    </div>
    <p class="visor-hint" id="years-hint"></p>
    <div class="visor-chart-wrap" id="years-chart-wrap" hidden>
      <canvas id="years-chart" aria-label="<?php echo h($config['unit']); ?> por mes de los años elegidos, con el promedio, el máximo y el mínimo históricos" role="img"></canvas>
    </div>
  </section>
  </div>

  <p class="visor-note" id="note"><?php echo h($config['sources'][0]['note']); ?></p>
  <p class="visor-note">Visor de focos de calor para la plataforma SEPA del INTA, realizado en el
    marco del convenio INTA–UNAHUR para la materia Práctica Profesional Supervisada.
    Desarrollador: Franco Uriel Cerantonio.</p>
</main>

<script type="application/json" id="visor-config"><?php
echo json_encode($config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE);
?></script>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        integrity="sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH"
        crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js"
        integrity="sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ"
        crossorigin="anonymous"></script>
<script>
// Los menús de descarga usan popover (Baseline desde 2025): el polyfill se carga solo en navegadores sin soporte.
if (!Object.prototype.hasOwnProperty.call(HTMLElement.prototype, 'popover')) {
  var popoverPolyfill = document.createElement('script');
  popoverPolyfill.src = 'https://cdn.jsdelivr.net/npm/@oddbird/popover-polyfill@0.7.3/dist/popover.iife.min.js';
  popoverPolyfill.integrity = 'sha384-INwTyeGJ4Bk/YHI/urvNEearyioRlcY0f49uACR8MxYAtulvd/xSYR4b3746TPPL';
  popoverPolyfill.crossOrigin = 'anonymous';
  document.head.appendChild(popoverPolyfill);
}
</script>
<script type="module" src="app.js?v=<?php echo asset_version('app.js'); ?>"></script>

            <div class="clearfix"></div>
        </div><!-- /CAJA -->
    </div><!-- /FONDO -->

<!-- FOOTER -->
    <?php include ($root . 'includes/footer.php') ?>
<!--  end sitio -->
</div>
        <!--  -->
        <script src="//ajax.googleapis.com/ajax/libs/jquery/1.10.1/jquery.min.js"></script>
        <script>window.jQuery || document.write('<script src="<?php echo $root; ?>js/vendor/jquery-1.10.1.min.js"><\/script>')</script>
        <script src="<?php echo $root; ?>js/main.js"></script>

</body>
</html>
