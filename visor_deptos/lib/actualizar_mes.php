<?php
// Monthly update, run by cron: computes datos/<filePrefix>_AAAAMM.csv for one month from
// NASA FIRMS MODIS hotspots, with the same rules as tools/compute_anomalies.mjs (see
// VISOR_FOCOS.md): every point counts, point in polygon against the full
// DEPTOS-PROV.geojson, 0 for departments without points, SEPA's class 1-5 against the
// same calendar month of the config.json climatology, read from the CSVs in datos/.
//
// Usage (CLI only):
//   FIRMS_MAP_KEY=... php lib/actualizar_mes.php --geojson /path/DEPTOS-PROV.geojson
//       [--mes AAAAMM] [--source MODIS_NRT] [--csv local.csv] [--config ../config.json] [--datos ../datos]
//
// --mes defaults to the previous month. --csv reads a local FIRMS CSV instead of the API.
// On any error it exits 1 and writes nothing. PHP 7.4+ compatible, no dependencies.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/series.php';

const MONTHLY_FIRMS_API = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
// west,south,east,north: mainland Argentina, Tierra del Fuego and Malvinas.
const MONTHLY_BBOX = '-73.6,-55.1,-53.6,-21.7';

// ---------- Point in polygon ----------

/** Even-odd ray casting over every ring, so holes are excluded. */
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

/** Returns [[in1, [[bbox, rings], ...]], ...] sorted by in1, one entry per department. */
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

// ponytail: linear scan with a bbox prefilter (one month is ~30k points); add a grid index if it gets slow.
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

// ---------- Class ----------

/** SEPA's rule, with the workbook's arithmetic (MD*10/100), as anomalyClass() in tools/. */
function monthly_anomaly_class($value, $s)
{
    $tenth = $s['mean'] * 10 / 100;
    if ($value > $s['max']) return 5;
    if ($value > $s['mean'] + $tenth) return 4;
    if ($value > $s['mean'] - $tenth) return 3;
    if ($value > $s['min']) return 2;
    return 1;
}

// ---------- Months and FIRMS data ----------

function monthly_previous_month(DateTimeImmutable $today)
{
    return $today->modify('first day of last month')->format('Ym');
}

/** [[AAAA-MM-DD, days], ...]: the FIRMS API returns at most 5 days per request. */
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

/** Returns [[lat, lon], ...] of the points of $month (AAAAMM) in a FIRMS CSV text. */
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

/** Downloads $month from the FIRMS area API, one request per window. */
function monthly_download($month, $source, $key)
{
    $points = [];
    $context = stream_context_create(['http' => ['timeout' => 120, 'ignore_errors' => true]]);
    foreach (monthly_windows($month) as list($date, $days)) {
        $url = MONTHLY_FIRMS_API . "/$key/$source/" . MONTHLY_BBOX . "/$days/$date";
        $text = @file_get_contents($url, false, $context);
        $status = isset($http_response_header[0]) ? $http_response_header[0] : 'no response';
        if ($text === false || strpos($status, ' 200') === false) {
            // The URL carries the MAP_KEY: never print it.
            throw new RuntimeException("FIRMS request for $date ($days days) failed: $status");
        }
        $points = array_merge($points, monthly_parse_firms($text, $month));
    }
    return $points;
}

// ---------- Monthly file ----------

/**
 * Counts $points per department and classifies the month. The reference uses the same
 * calendar month of the climatology from the CSVs in $dataDir, except $month's own file:
 * its new counts are used instead when it is inside the climatology.
 * Returns [csv text, assigned, outside].
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
        'source' => 'MODIS_NRT',
        'csv' => null,
        'config' => __DIR__ . '/../config.json',
        'datos' => __DIR__ . '/../datos',
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
    if (!preg_match('/^[A-Z0-9_]+\z/', $opts['source'])) {
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
        $config = visor_config($opts['config']);
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
        // The full geometry is ~13 MB of JSON, more than a default 128M limit holds once decoded.
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
