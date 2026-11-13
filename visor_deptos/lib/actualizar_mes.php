<?php
// Actualización mensual, ejecutada por cron: calcula datos/<fuente>/<filePrefix>_AAAAMM.csv de un mes a
// partir de los focos de NASA FIRMS de una fuente de config.json (MODIS, VIIRS…), con las mismas reglas
// que tools/compute_anomalies.mjs (ver VISOR_FOCOS.md): cuenta cada punto, punto en polígono contra el
// DEPTOS-PROV.geojson completo, 0 para los departamentos sin puntos, clase 1-5 de SEPA respecto del
// mismo mes calendario de la climatología de esa fuente, leída de los CSV de datos/<fuente>/.
//
// Uso (solo CLI):
//   FIRMS_MAP_KEY=... php lib/actualizar_mes.php --geojson /path/DEPTOS-PROV.geojson
//       [--fuente modis] [--mes AAAAMM] [--source MODIS_NRT] [--csv local.csv] [--config ../config.json]
//       [--datos ../datos/<fuente>]
//
// --fuente es un id de `sources` (por defecto, la primera); --source y --datos toman por defecto su
// firmsSource y su carpeta. --mes toma por defecto el mes anterior. --csv lee un CSV local de FIRMS en lugar de la API.
// Ante cualquier error termina con código 1 y no escribe nada. Compatible con PHP 7.4+, sin dependencias.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/series.php';

const MONTHLY_FIRMS_API = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
// oeste,sur,este,norte: Argentina continental, Tierra del Fuego y Malvinas.
const MONTHLY_BBOX = '-73.6,-55.1,-53.6,-21.7';

// ---------- Punto en polígono ----------

/** Ray casting par-impar sobre todos los anillos, de modo que los huecos quedan excluidos. */
function monthly_in_polygon($x, $y, $rings)
{
    $inside = false;
    foreach ($rings as $ring) {
        $n = count($ring);
        for ($i = 0, $j = $n - 1; $i < $n; $j = $i++) {
            list($xi, $yi) = $ring[$i];
            list($xj, $yj) = $ring[$j];
            if (($yi > $y) !== ($yj > $y) && $x < ($xj - $xi) * ($y - $yi) / ($yj - $yi) + $xi) {
                $inside = !$inside;
            }
        }
    }
    return $inside;
}

/** Devuelve [[in1, [[bbox, rings], ...]], ...] ordenado por in1, una entrada por departamento. */
function monthly_departments($geojson)
{
    $byCode = [];
    foreach ($geojson['features'] as $f) {
        $link = trim((string) ($f['properties']['LINK'] ?? ''));
        if (!preg_match('/^\d{4,5}\z/', $link)) {
            throw new RuntimeException('Unexpected LINK value: ' . json_encode($f['properties']['LINK'] ?? null));
        }
        $in1 = str_pad($link, 5, '0', STR_PAD_LEFT);
        $polygons = $f['geometry']['type'] === 'Polygon' ? [$f['geometry']['coordinates']] : $f['geometry']['coordinates'];
        foreach ($polygons as $rings) {
            $xs = array_column($rings[0], 0);
            $ys = array_column($rings[0], 1);
            $byCode['d' . $in1][] = [[min($xs), min($ys), max($xs), max($ys)], $rings];
        }
    }
    ksort($byCode, SORT_STRING);
    $depts = [];
    foreach ($byCode as $key => $parts) {
        $depts[] = [substr($key, 1), $parts];
    }
    return $depts;
}

// ponytail: recorrido lineal con prefiltro por bbox (un mes son ~30k puntos); agregar un índice de grilla si se vuelve lento.
function monthly_find_department($depts, $lon, $lat)
{
    foreach ($depts as list($in1, $parts)) {
        foreach ($parts as list($b, $rings)) {
            if ($lon >= $b[0] && $lon <= $b[2] && $lat >= $b[1] && $lat <= $b[3] && monthly_in_polygon($lon, $lat, $rings)) {
                return $in1;
            }
        }
    }
    return null;
}

// ---------- Clase ----------

/** La regla de SEPA, con la aritmética de la planilla (MD*10/100), igual que anomalyClass() en tools/. */
function monthly_anomaly_class($value, $s)
{
    $tenth = $s['mean'] * 10 / 100;
    if ($value > $s['max']) return 5;
    if ($value > $s['mean'] + $tenth) return 4;
    if ($value > $s['mean'] - $tenth) return 3;
    if ($value > $s['min']) return 2;
    return 1;
}

// ---------- Meses y datos de FIRMS ----------

function monthly_previous_month(DateTimeImmutable $today)
{
    return $today->modify('first day of last month')->format('Ym');
}

/** [[AAAA-MM-DD, días], ...]: la API de FIRMS devuelve como máximo 5 días por solicitud. */
function monthly_windows($month)
{
    $first = DateTimeImmutable::createFromFormat('!Ymd', $month . '01');
    $days = (int) $first->format('t');
    $windows = [];
    for ($d = 1; $d <= $days; $d += 5) {
        $windows[] = [$first->format('Y-m-') . str_pad((string) $d, 2, '0', STR_PAD_LEFT), min(5, $days - $d + 1)];
    }
    return $windows;
}

/** Devuelve [[lat, lon], ...] de los puntos de $month (AAAAMM) en un texto CSV de FIRMS. */
function monthly_parse_firms($text, $month)
{
    $lines = preg_split('/\r?\n/', trim($text));
    $header = str_getcsv($lines[0], ',', '"', '');
    $idx = [];
    foreach (['latitude', 'longitude', 'acq_date'] as $name) {
        $i = array_search($name, $header, true);
        if ($i === false) {
            throw new RuntimeException("FIRMS data has no column $name (got: " . substr($lines[0], 0, 80) . ')');
        }
        $idx[] = $i;
    }
    list($iLat, $iLon, $iDate) = $idx;
    $prefix = substr($month, 0, 4) . '-' . substr($month, 4, 2) . '-';
    $points = [];
    for ($n = 1, $count = count($lines); $n < $count; $n++) {
        $c = explode(',', $lines[$n]);
        $date = $c[$iDate] ?? '';
        if (!is_numeric($c[$iLat] ?? '') || !is_numeric($c[$iLon] ?? '') || !preg_match('/^\d{4}-\d{2}-\d{2}\z/', $date)) {
            throw new RuntimeException('Invalid FIRMS row at line ' . ($n + 1) . ': ' . substr($lines[$n], 0, 80));
        }
        if (strpos($date, $prefix) === 0) {
            $points[] = [(float) $c[$iLat], (float) $c[$iLon]];
        }
    }
    return $points;
}

/** Descarga $month desde la API de área de FIRMS, una solicitud por ventana. */
function monthly_download($month, $source, $key)
{
    $points = [];
    $context = stream_context_create(['http' => ['timeout' => 120, 'ignore_errors' => true]]);
    foreach (monthly_windows($month) as list($date, $days)) {
        $url = MONTHLY_FIRMS_API . "/$key/$source/" . MONTHLY_BBOX . "/$days/$date";
        $text = @file_get_contents($url, false, $context);
        $status = isset($http_response_header[0]) ? $http_response_header[0] : null;
        if ($text === false || $status === null || strpos($status, ' 200') === false) {
            // La URL lleva la MAP_KEY: nunca debe imprimirse.
            $reason = $status ?? str_replace($key, '***', (string) (error_get_last()['message'] ?? 'no response'));
            if (!extension_loaded('openssl')) {
                $reason .= ' (the openssl extension is not loaded: PHP cannot open https URLs)';
            }
            throw new RuntimeException("FIRMS request for $date ($days days) failed: $reason");
        }
        $points = array_merge($points, monthly_parse_firms($text, $month));
    }
    return $points;
}

// ---------- Archivo mensual ----------

/**
 * Cuenta $points por departamento y clasifica el mes. La referencia usa el mismo
 * mes calendario de la climatología a partir de los CSV de $dataDir, salvo el propio archivo de $month:
 * en su lugar se usan sus conteos nuevos cuando está dentro de la climatología.
 * Devuelve [texto csv, asignados, fuera].
 */
function monthly_build($points, $month, $depts, $dataDir, $config)
{
    $counts = [];
    foreach ($depts as list($in1)) {
        $counts[$in1] = 0;
    }
    $outside = 0;
    foreach ($points as list($lat, $lon)) {
        $in1 = monthly_find_department($depts, $lon, $lat);
        if ($in1 === null) {
            $outside++;
        } else {
            $counts[$in1]++;
        }
    }

    $from = $config['climatology']['from'];
    $to = $config['climatology']['to'];
    $reference = [];
    foreach (series_list_csv($dataDir, $config['filePrefix']) as list($m, $path)) {
        if ($m === $month || substr($m, 4) !== substr($month, 4) || $m < $from || $m > $to) {
            continue;
        }
        foreach (series_parse_csv($path, $config) as $in1 => list($value)) {
            if ($value !== null) {
                $reference[$in1][] = $value;
            }
        }
    }
    if ($month >= $from && $month <= $to) {
        foreach ($counts as $in1 => $n) {
            $reference[$in1][] = $n;
        }
    }

    $rows = ['in1,' . $config['columns']['value'] . ',' . $config['columns']['anomaly']];
    foreach ($counts as $in1 => $n) {
        $values = $reference[(string) $in1] ?? [];
        $class = $values
            ? monthly_anomaly_class($n, ['max' => max($values), 'mean' => array_sum($values) / count($values), 'min' => min($values)])
            : '';
        $rows[] = "$in1,$n,$class";
    }
    return [implode("\n", $rows) . "\n", count($points) - $outside, $outside];
}

function monthly_args($argv)
{
    $opts = [
        'geojson' => null,
        'mes' => null,
        'fuente' => null,
        'source' => null,
        'csv' => null,
        'config' => __DIR__ . '/../config.json',
        'datos' => null,
    ];
    for ($i = 1; $i < count($argv); $i += 2) {
        $key = preg_replace('/^--/', '', $argv[$i]);
        if (!array_key_exists($key, $opts) || !isset($argv[$i + 1])) {
            throw new RuntimeException("Unknown or incomplete option: {$argv[$i]}");
        }
        $opts[$key] = $argv[$i + 1];
    }
    $opts['mes'] = $opts['mes'] ?? monthly_previous_month(new DateTimeImmutable('now'));
    if (!preg_match('/^\d{4}(0[1-9]|1[0-2])\z/', $opts['mes'])) {
        throw new RuntimeException("Invalid --mes {$opts['mes']} (expected AAAAMM)");
    }
    if ($opts['source'] !== null && !preg_match('/^[A-Z0-9_]+\z/', $opts['source'])) {
        throw new RuntimeException("Invalid --source {$opts['source']}");
    }
    if ($opts['geojson'] === null) {
        throw new RuntimeException('Missing --geojson <DEPTOS-PROV.geojson>');
    }
    return $opts;
}

function monthly_main($argv)
{
    try {
        $opts = monthly_args($argv);
        $month = $opts['mes'];
        $config = visor_source(visor_config($opts['config']), $opts['fuente']);
        if ($config === null) {
            throw new RuntimeException("Unknown --fuente {$opts['fuente']} (not in sources of {$opts['config']})");
        }
        $opts['source'] = $opts['source'] ?? $config['firmsSource'];
        $opts['datos'] = $opts['datos'] ?? __DIR__ . '/../datos/' . $config['id'];
        if ($opts['csv'] !== null) {
            $text = @file_get_contents($opts['csv']);
            if ($text === false) {
                throw new RuntimeException("Cannot read {$opts['csv']}");
            }
            $points = monthly_parse_firms($text, $month);
            $origin = basename($opts['csv']);
        } else {
            $key = (string) getenv('FIRMS_MAP_KEY');
            if (!preg_match('/^[A-Za-z0-9]+\z/', $key)) {
                throw new RuntimeException('Set FIRMS_MAP_KEY (free key from https://firms.modaps.eosdis.nasa.gov/api/map_key/)');
            }
            $points = monthly_download($month, $opts['source'], $key);
            $origin = $opts['source'];
        }
        // La geometría completa ocupa ~13 MB de JSON, más de lo que admite un límite predeterminado de 128M una vez decodificada.
        ini_set('memory_limit', '1G');
        $geojson = json_decode((string) @file_get_contents($opts['geojson']), true);
        if (!is_array($geojson) || !isset($geojson['features'])) {
            throw new RuntimeException("Cannot read {$opts['geojson']} as GeoJSON");
        }
        list($csv, $assigned, $outside) = monthly_build($points, $month, monthly_departments($geojson), $opts['datos'], $config);

        $name = "{$config['filePrefix']}_$month.csv";
        $tmp = "{$opts['datos']}/$name.tmp";
        if (file_put_contents($tmp, $csv) === false || !rename($tmp, "{$opts['datos']}/$name")) {
            @unlink($tmp);
            throw new RuntimeException("Cannot write $name in {$opts['datos']}");
        }
        echo date('Y-m-d H:i:s') . " $month ($origin): $assigned assigned, $outside outside every department -> $name\n";
        return 0;
    } catch (Throwable $e) {
        fwrite(STDERR, date('Y-m-d H:i:s') . ' Error: ' . $e->getMessage() . "\n");
        return 1;
    }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    exit(monthly_main($argv));
}
