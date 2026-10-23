<?php
// Consolidates the monthly CSVs (datos/<filePrefix>_AAAAMM.csv) into one series object
// and caches it as JSON. $config is the array returned by visor_config(), so callers
// load lib/config.php first.
// PHP 7.4+ compatible, no dependencies.
//
// Consolidated shape (all arrays aligned to "months"):
// {
//   "months": ["200101", ...],
//   "data":   { "06007": { "value": [number|null, ...], "anomaly": [float|null, ...] } },
//   "clim":   { "06007": [12 means of value over the climatology period, null if no data] }
// }

/** A monthly CSV that cannot be used. $csvName is the base name only (no directory). */
class SeriesCsvException extends RuntimeException
{
    public $csvName;

    public function __construct($csvName, $message)
    {
        parent::__construct($message);
        $this->csvName = $csvName;
    }
}

/** Returns [AAAAMM => path], sorted by month. $prefix is validated by visor_config(). */
function series_list_csv($dataDir, $prefix)
{
    $files = [];
    foreach (glob($dataDir . '/' . $prefix . '_*.csv') ?: [] as $path) {
        if (preg_match('/^' . preg_quote($prefix, '/') . '_(\d{6})\.csv\z/', basename($path), $m)) {
            $files[$m[1]] = $path;
        }
    }
    ksort($files, SORT_STRING);
    return $files;
}

/** Converts a CSV cell to int/float, or null when empty or not numeric. */
function series_number($text, $asInt)
{
    $text = trim((string) $text);
    if ($text === '' || !is_numeric($text)) {
        return null;
    }
    return $asInt ? (int) round((float) $text) : (float) $text;
}

/**
 * Parses one monthly CSV into [in1 => [value, anomaly]], reading the configured columns.
 * Throws SeriesCsvException (naming only the file, not its directory) when the file
 * cannot be read or lacks a required column, so a broken export is never cached
 * as an empty month.
 */
function series_parse_csv($path, $config)
{
    $rows = [];
    $name = basename($path);
    $valueCol = $config['columns']['value'];
    $anomalyCol = $config['columns']['anomaly'];
    $expected = visor_expected_header($config);
    $fh = @fopen($path, 'r');
    if ($fh === false) {
        throw new SeriesCsvException($name, "Cannot read $name");
    }
    $header = fgetcsv($fh, 0, ",", "\"", "");
    if (!is_array($header)) {
        fclose($fh);
        throw new SeriesCsvException($name, "$name has no header (expected $expected)");
    }
    $header = array_map(function ($h) {
        // Strip a UTF-8 BOM and spaces, compare case-insensitively.
        return strtolower(trim(preg_replace('/^\xEF\xBB\xBF/', '', (string) $h)));
    }, $header);
    $iIn1 = array_search('in1', $header, true);
    $iValue = array_search($valueCol, $header, true);
    $iAnom = array_search($anomalyCol, $header, true);
    if ($iIn1 === false || $iValue === false || $iAnom === false) {
        fclose($fh);
        throw new SeriesCsvException($name, "$name is missing a required column (expected $expected)");
    }
    while (($cells = fgetcsv($fh, 0, ",", "\"", "")) !== false) {
        $in1 = trim((string) ($cells[$iIn1] ?? ''));
        if (!preg_match('/^\d{5}\z/', $in1)) {
            continue;
        }
        $rows[$in1] = [
            series_number($cells[$iValue] ?? '', $config['integerValues']),
            series_number($cells[$iAnom] ?? '', false),
        ];
    }
    fclose($fh);
    return $rows;
}

/** Builds the consolidated series array from every CSV in $dataDir. */
function series_build($dataDir, $config)
{
    $files = series_list_csv($dataDir, $config['filePrefix']);
    $climFrom = $config['climatology']['from'];
    $climTo = $config['climatology']['to'];
    $months = array_keys($files);
    // Month keys are 6-digit strings; PHP turns them into int array keys, so cast back.
    $months = array_map('strval', $months);
    $n = count($months);

    $perMonth = [];
    $codes = [];
    foreach ($files as $path) {
        $rows = series_parse_csv($path, $config);
        $perMonth[] = $rows;
        foreach ($rows as $in1 => $_) {
            $codes[(string) $in1] = true;
        }
    }
    // Pad back to 5 chars: codes without a leading zero become int keys in PHP arrays.
    $codeList = array_map(function ($c) {
        return str_pad((string) $c, 5, '0', STR_PAD_LEFT);
    }, array_keys($codes));
    sort($codeList, SORT_STRING);

    $data = new stdClass();
    $clim = new stdClass();
    foreach ($codeList as $in1) {
        $values = array_fill(0, $n, null);
        $anom = array_fill(0, $n, null);
        $sum = array_fill(0, 12, 0);
        $cnt = array_fill(0, 12, 0);
        for ($i = 0; $i < $n; $i++) {
            if (!isset($perMonth[$i][$in1])) {
                continue;
            }
            list($v, $a) = $perMonth[$i][$in1];
            $values[$i] = $v;
            $anom[$i] = $a;
            $month = $months[$i];
            if ($v !== null && $month >= $climFrom && $month <= $climTo) {
                $cm = (int) substr($month, 4, 2) - 1;
                $sum[$cm] += $v;
                $cnt[$cm]++;
            }
        }
        $means = [];
        for ($m = 0; $m < 12; $m++) {
            $means[] = $cnt[$m] > 0 ? round($sum[$m] / $cnt[$m], 2) : null;
        }
        // stdClass properties keep "06007"-style keys as strings in json_encode.
        $data->{$in1} = ['value' => $values, 'anomaly' => $anom];
        $clim->{$in1} = $means;
    }
    return ['months' => $months, 'data' => $data, 'clim' => $clim];
}

/**
 * Fingerprint of the config and the data directory: sha1 over the config and the sorted
 * "name:size:mtime" of every monthly CSV. Any config.json edit rebuilds the cache, even
 * one that only changes a UI text; that is cheap and keeps the rule simple.
 * Unlike a plain mtime comparison (1-second resolution), it also changes when a file
 * is rewritten within the same second with a different size, or when a file is added
 * or removed (including files copied with an old preserved mtime).
 */
function series_data_fingerprint($dataDir, $config)
{
    clearstatcache();
    $parts = [json_encode($config)];
    foreach (series_list_csv($dataDir, $config['filePrefix']) as $path) {
        $parts[] = basename($path) . ':' . (int) @filesize($path) . ':' . (int) @filemtime($path);
    }
    return sha1(implode("\n", $parts));
}

/**
 * Returns the consolidated series as a JSON string. The cache file holds the data
 * fingerprint on its first line and the JSON after it; it is served only when the
 * stored fingerprint equals the current one. The fingerprint is taken before the
 * CSVs are read, so a file changed during a build makes the next request rebuild.
 * If the cache cannot be written, the freshly built JSON is still returned.
 */
function series_cached_json($dataDir, $cacheFile, $config)
{
    $fingerprint = series_data_fingerprint($dataDir, $config);
    if (is_file($cacheFile)) {
        $raw = file_get_contents($cacheFile);
        $nl = $raw === false ? false : strpos($raw, "\n");
        if ($nl !== false && substr($raw, 0, $nl) === $fingerprint) {
            $json = substr($raw, $nl + 1);
            if ($json !== '') {
                return $json;
            }
        }
    }

    // series_build throws on a broken CSV, so a partial result is never cached.
    $json = json_encode(series_build($dataDir, $config));
    if ($json === false) {
        throw new RuntimeException('json_encode failed: ' . json_last_error_msg());
    }

    // Atomic write: temp file in the same directory, then rename over the cache.
    $dir = dirname($cacheFile);
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    // tempnam silently falls back to the system temp dir, so check writability first.
    $tmp = is_writable($dir) ? @tempnam($dir, 'serie_') : false;
    if ($tmp !== false && file_put_contents($tmp, $fingerprint . "\n" . $json) !== false) {
        @chmod($tmp, 0644);
        if (!@rename($tmp, $cacheFile)) {
            @unlink($tmp);
            error_log('serie.php: could not replace cache file ' . $cacheFile);
        }
    } else {
        if ($tmp !== false) {
            @unlink($tmp);
        }
        error_log('serie.php: cache directory not writable: ' . $dir);
    }
    return $json;
}
