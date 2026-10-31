<?php
// Consolida los CSV mensuales (datos/<filePrefix>_AAAAMM.csv) en un único objeto de serie
// y lo guarda en caché como JSON. $config es el arreglo que devuelve visor_config(), por lo que quien lo llame
// debe cargar lib/config.php primero.
// Compatible con PHP 7.4+, sin dependencias.
//
// Estructura consolidada (todos los arreglos alineados con "months"):
// {
//   "months": ["200101", ...],
//   "data":   { "06007": { "value": [number|null, ...], "anomaly": [float|null, ...] } },
//   "clim":   { "06007": [12 medias de value en el período de climatología, null si no hay datos] }
// }

/** Un CSV mensual inutilizable. $csvName es solo el nombre base (sin directorio). */
class SeriesCsvException extends RuntimeException
{
    public $csvName;

    public function __construct($csvName, $message)
    {
        parent::__construct($message);
        $this->csvName = $csvName;
    }
}

/**
 * Devuelve [[AAAAMM, path], ...] ordenado por mes, con el mes como cadena. Se usan pares
 * en lugar de claves AAAAMM porque PHP convierte las claves de cadena numéricas en enteros.
 * $prefix lo valida visor_config().
 */
function series_list_csv($dataDir, $prefix)
{
    $files = [];
    foreach (glob($dataDir . '/' . $prefix . '_*.csv') ?: [] as $path) {
        if (preg_match('/^' . preg_quote($prefix, '/') . '_(\d{6})\.csv\z/', basename($path), $m)) {
            $files[] = [$m[1], $path];
        }
    }
    usort($files, function ($a, $b) {
        return strcmp($a[0], $b[0]);
    });
    return $files;
}

/** Convierte una celda CSV a int/float, o a null cuando está vacía o no es numérica. */
function series_number($text, $asInt)
{
    $text = trim((string) $text);
    if ($text === '' || !is_numeric($text)) {
        return null;
    }
    return $asInt ? (int) round((float) $text) : (float) $text;
}

/**
 * Interpreta un CSV mensual como [in1 => [value, anomaly]], leyendo las columnas configuradas.
 * Lanza SeriesCsvException (que nombra solo el archivo, no su directorio) cuando el archivo
 * no se puede leer o le falta una columna obligatoria, para que una exportación defectuosa nunca se guarde en caché
 * como un mes vacío.
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
        // Se quitan el BOM UTF-8 y los espacios, y se compara sin distinguir mayúsculas.
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

/** Construye el arreglo de la serie consolidada a partir de todos los CSV de $dataDir. */
function series_build($dataDir, $config)
{
    $files = series_list_csv($dataDir, $config['filePrefix']);
    $climFrom = $config['climatology']['from'];
    $climTo = $config['climatology']['to'];
    $months = array_column($files, 0);
    $n = count($months);

    $perMonth = [];
    $codes = [];
    foreach (array_column($files, 1) as $path) {
        $rows = series_parse_csv($path, $config);
        $perMonth[] = $rows;
        foreach ($rows as $in1 => $_) {
            $codes[(string) $in1] = true;
        }
    }
    // Se vuelve a completar a 5 caracteres: los códigos sin cero inicial se convierten en claves enteras en los arreglos de PHP.
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
        // Las propiedades de stdClass conservan las claves del tipo "06007" como cadenas en json_encode.
        $data->{$in1} = ['value' => $values, 'anomaly' => $anom];
        $clim->{$in1} = $means;
    }
    return ['months' => $months, 'data' => $data, 'clim' => $clim];
}

/**
 * Huella de la configuración y del directorio de datos: sha1 sobre la configuración y los
 * "name:size:mtime" ordenados de cada CSV mensual. Cualquier edición de config.json reconstruye la caché, incluso
 * una que solo cambia un texto de la interfaz; es barato y mantiene simple la regla.
 * A diferencia de una simple comparación de mtime (resolución de 1 segundo), también cambia cuando un archivo
 * se reescribe dentro del mismo segundo con otro tamaño, o cuando se agrega
 * o se quita un archivo (incluidos los archivos copiados que conservan un mtime antiguo).
 */
function series_data_fingerprint($dataDir, $config)
{
    clearstatcache();
    $parts = [json_encode($config)];
    foreach (array_column(series_list_csv($dataDir, $config['filePrefix']), 1) as $path) {
        $parts[] = basename($path) . ':' . (int) @filesize($path) . ':' . (int) @filemtime($path);
    }
    return sha1(implode("\n", $parts));
}

/**
 * Devuelve la serie consolidada como cadena JSON. El archivo de caché guarda la huella
 * de los datos en su primera línea y el JSON a continuación; se sirve solo cuando la
 * huella almacenada es igual a la actual. La huella se toma antes de leer los
 * CSV, así que un archivo modificado durante una construcción hace que la siguiente solicitud reconstruya.
 * Si no se puede escribir la caché, igual se devuelve el JSON recién construido.
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

    // series_build lanza una excepción ante un CSV defectuoso, así que nunca se guarda en caché un resultado parcial.
    $json = json_encode(series_build($dataDir, $config));
    if ($json === false) {
        throw new RuntimeException('json_encode failed: ' . json_last_error_msg());
    }

    // Escritura atómica: archivo temporal en el mismo directorio y luego rename sobre la caché.
    $dir = dirname($cacheFile);
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    // tempnam recurre en silencio al directorio temporal del sistema, así que primero se verifica que se pueda escribir.
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
