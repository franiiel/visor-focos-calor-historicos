<?php
// Loads config.json, the single description of the dataset the viewer shows (CSV
// prefix, columns, climatology period, anomaly class labels and UI texts). PHP 7.4+ compatible.

/** An unusable config.json. The message names the file only, never its directory. */
class VisorConfigException extends RuntimeException
{
}

/** Returns the validated config as an associative array, or throws VisorConfigException. */
function visor_config($file)
{
    $name = basename($file);
    $raw = @file_get_contents($file);
    // Windows editors often save a UTF-8 BOM, which json_decode rejects.
    $config = $raw === false ? null : json_decode(preg_replace('/^\xEF\xBB\xBF/', '', $raw), true);
    if (!is_array($config)) {
        throw new VisorConfigException("$name is missing or is not valid JSON");
    }
    foreach (['title', 'unit', 'valueLabel', 'valueTitle', 'anomalyTitle', 'note'] as $key) {
        if (!is_string($config[$key] ?? null)) {
            throw new VisorConfigException("$name: \"$key\" must be a string");
        }
    }
    // The prefix becomes part of a glob pattern and of the CSV URLs.
    if (!is_string($config['filePrefix'] ?? null) || !preg_match('/^[a-z0-9_-]+\z/', $config['filePrefix'])) {
        throw new VisorConfigException("$name: \"filePrefix\" must match [a-z0-9_-]+");
    }
    $value = $config['columns']['value'] ?? null;
    $anomaly = $config['columns']['anomaly'] ?? null;
    // Lowercase only: CSV headers are compared case-insensitively after lowercasing.
    foreach ([$value, $anomaly] as $column) {
        if (!is_string($column) || !preg_match('/^[a-z0-9_]+\z/', $column) || $column === 'in1') {
            throw new VisorConfigException("$name: \"columns\" needs \"value\" and \"anomaly\" names matching [a-z0-9_]+, other than in1");
        }
    }
    if ($value === $anomaly) {
        throw new VisorConfigException("$name: \"columns.value\" and \"columns.anomaly\" must differ");
    }
    if (!is_bool($config['integerValues'] ?? null)) {
        throw new VisorConfigException("$name: \"integerValues\" must be true or false");
    }
    $from = $config['climatology']['from'] ?? null;
    $to = $config['climatology']['to'] ?? null;
    $month = '/^\d{4}(0[1-9]|1[0-2])\z/';
    if (!is_string($from) || !is_string($to) || !preg_match($month, $from)
        || !preg_match($month, $to) || $from > $to) {
        throw new VisorConfigException("$name: \"climatology\" needs \"from\" <= \"to\" as AAAAMM strings (MM 01-12)");
    }
    $classes = $config['anomalyClasses'] ?? null;
    // A JSON list: json_decode gives keys 0..4 only for an array, not for an object.
    if (!is_array($classes) || array_keys($classes) !== [0, 1, 2, 3, 4]
        || count(array_filter($classes, 'is_string')) !== 5) {
        throw new VisorConfigException("$name: \"anomalyClasses\" must be a list of 5 strings (classes 1 to 5)");
    }
    return $config;
}

/** The CSV header the config expects, e.g. "in1,focos,anomalia" (for error messages). */
function visor_expected_header($config)
{
    return 'in1,' . $config['columns']['value'] . ',' . $config['columns']['anomaly'];
}
