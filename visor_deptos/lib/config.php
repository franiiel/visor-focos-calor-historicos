<?php
// Carga config.json, la única descripción del conjunto de datos que muestra el visor (prefijo
// de los CSV, columnas, período de climatología, etiquetas de las clases de anomalía y textos de la interfaz). Compatible con PHP 7.4+.

/** Un config.json inutilizable. El mensaje nombra solo el archivo, nunca su directorio. */
class VisorConfigException extends RuntimeException
{
}

/** Devuelve la configuración validada como arreglo asociativo, o lanza VisorConfigException. */
function visor_config($file)
{
    $name = basename($file);
    $raw = @file_get_contents($file);
    // Los editores de Windows suelen guardar un BOM UTF-8, que json_decode rechaza.
    $config = $raw === false ? null : json_decode(preg_replace('/^\xEF\xBB\xBF/', '', $raw), true);
    if (!is_array($config)) {
        throw new VisorConfigException("$name is missing or is not valid JSON");
    }
    foreach (['title', 'unit', 'valueLabel', 'valueTitle', 'anomalyTitle', 'note'] as $key) {
        if (!is_string($config[$key] ?? null)) {
            throw new VisorConfigException("$name: \"$key\" must be a string");
        }
    }
    // El prefijo pasa a formar parte de un patrón glob y de las URL de los CSV.
    if (!is_string($config['filePrefix'] ?? null) || !preg_match('/^[a-z0-9_-]+\z/', $config['filePrefix'])) {
        throw new VisorConfigException("$name: \"filePrefix\" must match [a-z0-9_-]+");
    }
    $value = $config['columns']['value'] ?? null;
    $anomaly = $config['columns']['anomaly'] ?? null;
    // Solo minúsculas: los encabezados del CSV se comparan sin distinguir mayúsculas, después de pasarlos a minúsculas.
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
    // Una lista JSON: json_decode da claves 0..4 solo para un arreglo, no para un objeto.
    if (!is_array($classes) || array_keys($classes) !== [0, 1, 2, 3, 4]
        || count(array_filter($classes, 'is_string')) !== 5) {
        throw new VisorConfigException("$name: \"anomalyClasses\" must be a list of 5 strings (classes 1 to 5)");
    }
    return $config;
}

/** El encabezado CSV que espera la configuración, p. ej. "in1,focos,anomalia" (para los mensajes de error). */
function visor_expected_header($config)
{
    return 'in1,' . $config['columns']['value'] . ',' . $config['columns']['anomaly'];
}
