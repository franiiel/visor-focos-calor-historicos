<?php
// Carga config.json, la única descripción de los datos que muestra el visor: prefijo de los CSV,
// columnas, etiquetas de las clases de anomalía, textos de la interfaz y la lista de fuentes
// (`sources`: una pestaña por sensor, con sus CSV en datos/<id>/ y su propia climatología).
// Compatible con PHP 7.4+.

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
    foreach (['title', 'unit', 'valueLabel', 'valueTitle', 'anomalyTitle'] as $key) {
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
    $classes = $config['anomalyClasses'] ?? null;
    // Una lista JSON: json_decode da claves 0..4 solo para un arreglo, no para un objeto.
    if (!is_array($classes) || array_keys($classes) !== [0, 1, 2, 3, 4]
        || count(array_filter($classes, 'is_string')) !== 5) {
        throw new VisorConfigException("$name: \"anomalyClasses\" must be a list of 5 strings (classes 1 to 5)");
    }
    $sources = $config['sources'] ?? null;
    if (!is_array($sources) || !$sources || array_keys($sources) !== range(0, count($sources) - 1)) {
        throw new VisorConfigException("$name: \"sources\" must be a non-empty list");
    }
    $month = '/^\d{4}(0[1-9]|1[0-2])\z/';
    $ids = [];
    foreach ($sources as $i => $source) {
        $id = $source['id'] ?? null;
        // El id es el nombre de la carpeta datos/<id>/ y de la caché: nunca puede contener una ruta.
        if (!is_string($id) || !preg_match('/^[a-z0-9_-]+\z/', $id) || isset($ids[$id])) {
            throw new VisorConfigException("$name: sources[$i].id must be unique and match [a-z0-9_-]+");
        }
        $ids[$id] = true;
        foreach (['label', 'note'] as $key) {
            if (!is_string($source[$key] ?? null)) {
                throw new VisorConfigException("$name: sources[$i].$key must be a string");
            }
        }
        if (!is_string($source['firmsSource'] ?? null) || !preg_match('/^[A-Z0-9_]+\z/', $source['firmsSource'])) {
            throw new VisorConfigException("$name: sources[$i].firmsSource must match [A-Z0-9_]+");
        }
        $from = $source['climatology']['from'] ?? null;
        $to = $source['climatology']['to'] ?? null;
        if (!is_string($from) || !is_string($to) || !preg_match($month, $from)
            || !preg_match($month, $to) || $from > $to) {
            throw new VisorConfigException("$name: sources[$i].climatology needs \"from\" <= \"to\" as AAAAMM strings (MM 01-12)");
        }
    }
    return $config;
}

/**
 * La configuración de una fuente: los campos comunes más los de la fuente (id, label, firmsSource,
 * climatology, note), sin la lista `sources`. Sin id, la primera fuente. Null si el id no existe.
 */
function visor_source($config, $id = null)
{
    foreach ($config['sources'] as $source) {
        if ($id === null || $source['id'] === $id) {
            $common = $config;
            unset($common['sources']);
            return array_merge($common, $source);
        }
    }
    return null;
}

/** El encabezado CSV que espera la configuración, p. ej. "in1,focos,anomalia" (para los mensajes de error). */
function visor_expected_header($config)
{
    return 'in1,' . $config['columns']['value'] . ',' . $config['columns']['anomaly'];
}
