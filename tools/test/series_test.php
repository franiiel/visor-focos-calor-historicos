<?php
// Plain-PHP tests for visor_deptos/lib/series.php (no framework).
// Run: php tools/test/series_test.php  -> exit code 0 when every check passes.

require __DIR__ . '/../../visor_deptos/lib/series.php';

$failures = 0;
$checks = 0;

function check($name, $ok)
{
    global $failures, $checks;
    $checks++;
    if ($ok) {
        echo "ok   - $name\n";
    } else {
        $failures++;
        echo "FAIL - $name\n";
    }
}

function make_dir()
{
    $dir = sys_get_temp_dir() . '/series_test_' . bin2hex(random_bytes(6));
    mkdir($dir . '/datos', 0755, true);
    return $dir;
}

function remove_dir($dir)
{
    foreach (array_merge(glob($dir . '/*/*') ?: [], glob($dir . '/*') ?: []) as $path) {
        is_dir($path) ? @rmdir($path) : @unlink($path);
    }
    @rmdir($dir);
}

function write_csv($dataDir, $month, $body)
{
    $path = $dataDir . "/focos_$month.csv";
    file_put_contents($path, $body);
    return $path;
}

function fingerprint_or_null($dataDir)
{
    clearstatcache();
    return function_exists('series_data_fingerprint') ? series_data_fingerprint($dataDir) : null;
}

$csvA = "in1,focos,anomalia\n06007,10,1.5\n38077,2,-0.5\n";
$csvB = "in1,focos,anomalia\n06007,20,2.5\n38077,4,-1.0\n";

// --- Normal build shape -------------------------------------------------------
$root = make_dir();
$data = $root . '/datos';
write_csv($data, '200101', $csvA);
write_csv($data, '200102', "in1,focos,anomalia\n06007,5,0\n");
$series = series_build($data);
check('build: months sorted as strings', $series['months'] === ['200101', '200102']);
check('build: focos aligned to months', $series['data']->{'06007'}['focos'] === [10, 5]);
check('build: missing month is null', $series['data']->{'38077'}['focos'] === [2, null]);
check('build: anomalia parsed as float', $series['data']->{'06007'}['anomalia'] === [1.5, 0.0]);
check('build: clim has 12 entries', count($series['clim']->{'06007'}) === 12);
check('build: clim January mean', $series['clim']->{'06007'}[0] === 10.0);
check('build: clim without data is null', $series['clim']->{'06007'}[5] === null);
remove_dir($root);

// --- Fingerprint --------------------------------------------------------------
$root = make_dir();
$data = $root . '/datos';
$path = write_csv($data, '200101', $csvA);
$mtime = filemtime($path);
$fp1 = fingerprint_or_null($data);
check('fingerprint: function exists and returns a string', is_string($fp1) && $fp1 !== '');
check('fingerprint: stable when nothing changed', $fp1 !== null && fingerprint_or_null($data) === $fp1);

write_csv($data, '200101', $csvA . "02007,1,0\n");
touch($path, $mtime);
check('fingerprint: changes with same mtime but different size', $fp1 !== null && fingerprint_or_null($data) !== $fp1);

write_csv($data, '200101', $csvA);
touch($path, $mtime);
$fpBase = fingerprint_or_null($data);
$extra = write_csv($data, '200102', $csvA);
check('fingerprint: changes when a file is added', $fpBase !== null && fingerprint_or_null($data) !== $fpBase);
unlink($extra);
check('fingerprint: back to base when the file is removed', $fpBase !== null && fingerprint_or_null($data) === $fpBase);
remove_dir($root);

// --- Cache behaviour ----------------------------------------------------------
$root = make_dir();
$data = $root . '/datos';
$cache = $root . '/cache/serie.json';
$path = write_csv($data, '200101', $csvA);
$mtime = filemtime($path);

$json1 = series_cached_json($data, $cache);
check('cache: first call returns the built series', json_decode($json1)->data->{'06007'}->focos === [10]);
check('cache: file written', is_file($cache));

// Tamper with the cached payload only; a reused cache returns the tampered value.
$raw = file_get_contents($cache);
file_put_contents($cache, str_replace('"focos":[10]', '"focos":[777]', $raw));
$json2 = series_cached_json($data, $cache);
check('cache: reused when nothing changed', strpos($json2, '[777]') !== false);

// Same mtime, different content (and size): must rebuild.
write_csv($data, '200101', $csvB . "02007,1,0\n");
touch($path, $mtime);
@touch($data, $mtime);
touch($cache, $mtime + 5); // cache looks newer than every CSV
clearstatcache();
$json3 = series_cached_json($data, $cache);
check('cache: rebuilt when a CSV changes with the same mtime', json_decode($json3)->data->{'06007'}->focos === [20]);
check('cache: served JSON is plain series JSON', is_array(json_decode($json3, true)['months'] ?? null));
remove_dir($root);

// --- Bad header ---------------------------------------------------------------
$root = make_dir();
$data = $root . '/datos';
$cache = $root . '/cache/serie.json';
write_csv($data, '200101', $csvA);
write_csv($data, '200102', "in1,focos,anomaly\n06007,5,0\n");
$thrown = null;
try {
    series_cached_json($data, $cache);
} catch (RuntimeException $e) {
    $thrown = $e;
}
check('bad header: throws RuntimeException', $thrown !== null);
check('bad header: message names the file', $thrown !== null && strpos($thrown->getMessage(), 'focos_200102.csv') !== false);
check('bad header: message does not expose the directory', $thrown !== null && strpos($thrown->getMessage(), $data) === false);
check('bad header: no cache written', !is_file($cache));
remove_dir($root);

echo "\n$checks checks, $failures failed\n";
exit($failures === 0 ? 0 : 1);
