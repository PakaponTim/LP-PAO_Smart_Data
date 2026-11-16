<?php
// =========================================================================
// Water_System2 — Cloud-to-Local Snapshot Collector for GitHub Actions
// Runs every 30 minutes on GitHub's servers WITHOUT needing MySQL or a PC!
// Uses shared pure transformers in collectors_transform.php so snapshots match
// lampang.thaiwater.net & direct collectors 100%, and tracks per-module status.
// =========================================================================

date_default_timezone_set('Asia/Bangkok');

require_once __DIR__ . '/collectors_transform.php';

function gh_build_curl_handle(string $url, array $extraHeaders = [], int $timeoutSec = 25) {
    $ch = curl_init($url);
    $headers = array_merge([
        'Accept: application/json, text/plain, */*',
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Origin: https://lampang.thaiwater.net',
        'Referer: https://lampang.thaiwater.net/'
    ], $extraHeaders);

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeoutSec,
        CURLOPT_CONNECTTIMEOUT => min(10, $timeoutSec),
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_HTTPHEADER     => $headers
    ]);
    return $ch;
}

function gh_http_get_json_multi(array $requests): array {
    $mh = curl_multi_init();
    $handles = [];
    $startTimes = [];
    $results = [];

    foreach ($requests as $key => $cfg) {
        $to = (int)($cfg['timeout'] ?? 25);
        $ch = gh_build_curl_handle($cfg['url'], $cfg['headers'] ?? [], $to);
        $handles[$key] = $ch;
        $startTimes[$key] = microtime(true);
        curl_multi_add_handle($mh, $ch);
    }

    $running = null;
    do {
        $status = curl_multi_exec($mh, $running);
        if ($running > 0) {
            curl_multi_select($mh, 0.2);
        }
    } while ($running > 0 && $status === CURLM_OK);

    foreach ($handles as $key => $ch) {
        $body = curl_multi_getcontent($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $durMs = (int)round(((float)curl_getinfo($ch, CURLINFO_TOTAL_TIME) ?: (microtime(true) - $startTimes[$key])) * 1000);
        $err = curl_error($ch);

        if ($body === false || $httpCode < 200 || $httpCode >= 300) {
            $results[$key] = [
                'ok'         => false,
                'data'       => null,
                'error'      => "HTTP ({$httpCode}): " . ($err ?: $requests[$key]['url']),
                'httpCode'   => $httpCode,
                'durationMs' => $durMs
            ];
        } else {
            $decoded = json_decode($body, true);
            if (!is_array($decoded)) {
                $results[$key] = [
                    'ok'         => false,
                    'data'       => null,
                    'error'      => 'Invalid JSON response',
                    'httpCode'   => $httpCode,
                    'durationMs' => $durMs
                ];
            } else {
                $results[$key] = [
                    'ok'         => true,
                    'data'       => $decoded,
                    'error'      => null,
                    'httpCode'   => $httpCode,
                    'durationMs' => $durMs
                ];
            }
        }
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
    }
    curl_multi_close($mh);
    return $results;
}

$nowTs = time();
$recordedAt = date('Y-m-d H:i:s', $nowTs);
$dateFolder = date('Y-m-d', $nowTs);
$slotId = date('Ymd_Hi', $nowTs);
$thaiDate = transform_thai_date($nowTs);

echo "[GitHub-Collector] Starting Lampang parallel snapshot at {$recordedAt} (Asia/Bangkok)...\n";

$requests = [
    'rain'       => ['url' => 'https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/rain24?province_code=52', 'timeout' => 25],
    'rain3d'     => ['url' => 'https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/rain3d?province_code=52', 'timeout' => 25],
    'water'      => ['url' => 'https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/waterlevel?province_code=52', 'timeout' => 25],
    'drought'    => ['url' => 'https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/dam?province_code=52', 'timeout' => 25],
    'pm25'       => ['url' => 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/thaiwater/weather', 'timeout' => 35],
    'complaints' => [
        'url'     => 'https://publicapi.traffy.in.th/teamchadchart-stat-api/geojson/v1?text=%E0%B8%A5%E0%B8%B3%E0%B8%9B%E0%B8%B2%E0%B8%87',
        'headers' => ['Origin: https://citydata.traffy.in.th', 'Referer: https://citydata.traffy.in.th/'],
        'timeout' => 14
    ]
];

$responses = gh_http_get_json_multi($requests);

// Retry PM2.5 once if initial national weather payload timed out
if (empty($responses['pm25']['ok'])) {
    echo "  ⏳ Retrying PM 2.5 API (initial timeout/error: {$responses['pm25']['error']})...\n";
    $retry = gh_http_get_json_multi([
        'pm25' => ['url' => 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/thaiwater/weather', 'timeout' => 45]
    ]);
    $responses['pm25'] = $retry['pm25'];
}

$snapshot = [
    'snapshot_id'   => 'gh_' . $slotId,
    'recorded_at'   => $recordedAt,
    'thai_date'     => $thaiDate,
    'module_status' => [],
    'rainfall'      => [],
    'water'         => [],
    'drought'       => [],
    'pm25'          => [],
    'complaints'    => []
];

// 1. Rainfall (rain24)
$rainResult = ['rows' => [], 'subdistrictRainAvg' => [], 'districtRainAvg' => [], 'observations' => []];
if (!empty($responses['rain']['ok'])) {
    $rainResult = transform_rainfall_items($responses['rain']['data'], $nowTs);
    $snapshot['rainfall'] = $rainResult['rows'];
    $snapshot['module_status']['rainfall'] = [
        'ok'         => true,
        'count'      => count($snapshot['rainfall']),
        'durationMs' => $responses['rain']['durationMs'],
        'error'      => null
    ];
    echo "  ✅ Rainfall collected: " . count($snapshot['rainfall']) . " stations\n";
} else {
    $snapshot['module_status']['rainfall'] = [
        'ok'         => false,
        'count'      => 0,
        'durationMs' => $responses['rain']['durationMs'] ?? 0,
        'error'      => $responses['rain']['error'] ?? 'Unknown error'
    ];
    echo "  ⚠️ Rainfall error: {$snapshot['module_status']['rainfall']['error']}\n";
}

// 1b. Rainfall 3-day map (optional enrichment)
$rain3dResult = [];
if (!empty($responses['rain3d']['ok'])) {
    $rain3dResult = transform_rain3d_maps($responses['rain3d']['data']);
    echo "  ✅ Rain3D mapped: {$rain3dResult['count']} stations\n";
} else {
    echo "  ℹ️ Rain3D skipped: " . ($responses['rain3d']['error'] ?? 'timeout') . "\n";
}

// 2. Water Level
if (!empty($responses['water']['ok'])) {
    $waterRes = transform_water_level_items($responses['water']['data'], $rainResult, $rain3dResult);
    $snapshot['water'] = $waterRes['rows'];
    $snapshot['module_status']['water'] = [
        'ok'         => true,
        'count'      => count($snapshot['water']),
        'durationMs' => $responses['water']['durationMs'],
        'error'      => null
    ];
    echo "  ✅ Water level collected: " . count($snapshot['water']) . " stations\n";
} else {
    $snapshot['module_status']['water'] = [
        'ok'         => false,
        'count'      => 0,
        'durationMs' => $responses['water']['durationMs'] ?? 0,
        'error'      => $responses['water']['error'] ?? 'Unknown error'
    ];
    echo "  ⚠️ Water level error: {$snapshot['module_status']['water']['error']}\n";
}

// 3. Drought / Dams (Large + Medium + Small)
if (!empty($responses['drought']['ok'])) {
    $droughtRes = transform_drought_items($responses['drought']['data'], $nowTs);
    $snapshot['drought'] = $droughtRes['rows'];
    $snapshot['module_status']['drought'] = [
        'ok'         => true,
        'count'      => count($snapshot['drought']),
        'durationMs' => $responses['drought']['durationMs'],
        'error'      => null
    ];
    echo "  ✅ Drought/Dams collected: " . count($snapshot['drought']) . " reservoirs\n";
} else {
    $snapshot['module_status']['drought'] = [
        'ok'         => false,
        'count'      => 0,
        'durationMs' => $responses['drought']['durationMs'] ?? 0,
        'error'      => $responses['drought']['error'] ?? 'Unknown error'
    ];
    echo "  ⚠️ Drought error: {$snapshot['module_status']['drought']['error']}\n";
}

// 4. PM 2.5
if (!empty($responses['pm25']['ok'])) {
    $pmRes = transform_pm25_items($responses['pm25']['data'], $nowTs);
    $snapshot['pm25'] = $pmRes['rows'];
    $snapshot['module_status']['pm25'] = [
        'ok'         => true,
        'count'      => count($snapshot['pm25']),
        'durationMs' => $responses['pm25']['durationMs'],
        'error'      => null
    ];
    echo "  ✅ PM 2.5 collected: " . count($snapshot['pm25']) . " stations\n";
} else {
    $snapshot['module_status']['pm25'] = [
        'ok'         => false,
        'count'      => 0,
        'durationMs' => $responses['pm25']['durationMs'] ?? 0,
        'error'      => $responses['pm25']['error'] ?? 'Unknown error'
    ];
    echo "  ⚠️ PM 2.5 error: {$snapshot['module_status']['pm25']['error']}\n";
}

// 5. Complaints (Traffy Fondue)
if (!empty($responses['complaints']['ok'])) {
    $snapshot['complaints'] = transform_traffy_complaints($responses['complaints']['data'], 60);
    $snapshot['module_status']['complaints'] = [
        'ok'         => true,
        'count'      => count($snapshot['complaints']),
        'durationMs' => $responses['complaints']['durationMs'],
        'error'      => null
    ];
    echo "  ✅ Complaints collected: " . count($snapshot['complaints']) . " tickets\n";
} else {
    $snapshot['module_status']['complaints'] = [
        'ok'         => false,
        'count'      => 0,
        'durationMs' => $responses['complaints']['durationMs'] ?? 0,
        'error'      => $responses['complaints']['error'] ?? 'Unknown error'
    ];
    echo "  ⚠️ Complaints error: {$snapshot['module_status']['complaints']['error']}\n";
}

// Write snapshot JSON file into cloud_snapshots/YYYY-MM-DD/
$baseDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'cloud_snapshots';
$dayDir = $baseDir . DIRECTORY_SEPARATOR . $dateFolder;
if (!is_dir($dayDir)) {
    mkdir($dayDir, 0777, true);
}

$filename = "snapshot_{$slotId}.json";
$relPath = "{$dateFolder}/{$filename}";
$fullPath = $dayDir . DIRECTORY_SEPARATOR . $filename;

file_put_contents($fullPath, json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

// Update manifest.json
$manifestPath = $baseDir . DIRECTORY_SEPARATOR . 'manifest.json';
$manifest = ['updated_at' => $recordedAt, 'snapshots' => []];
if (file_exists($manifestPath)) {
    $loaded = json_decode((string)file_get_contents($manifestPath), true);
    if (is_array($loaded) && isset($loaded['snapshots']) && is_array($loaded['snapshots'])) {
        $manifest = $loaded;
    }
}
$manifest['updated_at'] = $recordedAt;
$manifest['snapshots'][$snapshot['snapshot_id']] = [
    'id'            => $snapshot['snapshot_id'],
    'recorded_at'   => $recordedAt,
    'path'          => $relPath,
    'module_status' => $snapshot['module_status'],
    'counts'        => [
        'water'      => count($snapshot['water']),
        'rainfall'   => count($snapshot['rainfall']),
        'drought'    => count($snapshot['drought']),
        'pm25'       => count($snapshot['pm25']),
        'complaints' => count($snapshot['complaints'])
    ]
];

if (count($manifest['snapshots']) > 500) {
    $manifest['snapshots'] = array_slice($manifest['snapshots'], -500, null, true);
}
file_put_contents($manifestPath, json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

echo "[GitHub-Collector] 🎉 Saved snapshot: cloud_snapshots/{$relPath}\n";
