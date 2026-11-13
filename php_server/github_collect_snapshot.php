<?php
// =========================================================================
// Water_System2 — Cloud-to-Local Snapshot Collector for GitHub Actions
// Runs every 30 minutes on GitHub's servers WITHOUT needing MySQL or a PC!
// Saves JSON snapshots into cloud_snapshots/YYYY-MM-DD/snapshot_YYYYMMDD_HHMM.json
// =========================================================================

date_default_timezone_set('Asia/Bangkok');

function gh_http_get_json(string $url, array $extraHeaders = [], int $timeoutSec = 25): ?array {
    $ch = curl_init($url);
    $headers = array_merge([
        'Accept: application/json, text/plain, */*',
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Origin: https://lampang.thaiwater.net',
        'Referer: https://lampang.thaiwater.net/'
    ], $extraHeaders);

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeoutSec,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_HTTPHEADER => $headers
    ]);

    $body = curl_exec($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    if ($body === false || $httpCode < 200 || $httpCode >= 300) {
        throw new RuntimeException("HTTP GET failed ({$httpCode}): " . ($err ?: $url));
    }

    $decoded = json_decode($body, true);
    if (!is_array($decoded)) {
        throw new RuntimeException("Invalid JSON response from {$url}");
    }
    return $decoded;
}

function gh_float($val): ?float {
    if ($val === null || $val === '' || $val === '-') return null;
    $clean = str_replace(',', '', trim((string)$val));
    return is_numeric($clean) ? (float)$clean : null;
}

function gh_thai_date(?int $ts = null): string {
    if ($ts === null) $ts = time();
    $thaiMonths = [
        1 => 'มกราคม', 2 => 'กุมภาพันธ์', 3 => 'มีนาคม', 4 => 'เมษายน',
        5 => 'พฤษภาคม', 6 => 'มิถุนายน', 7 => 'กรกฎาคม', 8 => 'สิงหาคม',
        9 => 'กันยายน', 10 => 'ตุลาคม', 11 => 'พฤศจิกายน', 12 => 'ธันวาคม'
    ];
    return (int)date('j', $ts) . ' ' . $thaiMonths[(int)date('n', $ts)] . ' ' . ((int)date('Y', $ts) + 543);
}

$nowTs = time();
$recordedAt = date('Y-m-d H:i:s', $nowTs);
$dateFolder = date('Y-m-d', $nowTs);
$slotId = date('Ymd_Hi', $nowTs);
$thaiDate = gh_thai_date($nowTs);

echo "[GitHub-Collector] Starting Lampang data snapshot at {$recordedAt} (Asia/Bangkok)...\n";

$snapshot = [
    'snapshot_id' => 'gh_' . $slotId,
    'recorded_at' => $recordedAt,
    'thai_date'   => $thaiDate,
    'rainfall'    => [],
    'water'       => [],
    'drought'     => [],
    'pm25'        => [],
    'complaints'  => []
];

// -------------------------------------------------------------------------
// 1. Rainfall (Lampang province_code=52)
// -------------------------------------------------------------------------
$subdistrictRain = [];
$districtRain = [];
try {
    $rainJson = gh_http_get_json('https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/rain24?province_code=52');
    $seen = [];
    foreach (($rainJson['data'] ?? []) as $item) {
        $stationName = trim((string)($item['station']['tele_station_name']['th'] ?? ''));
        if ($stationName === '' || isset($seen[$stationName])) continue;
        $seen[$stationName] = true;

        $tumbon = trim((string)($item['geocode']['tumbon_name']['th'] ?? ''));
        $amphoeRaw = trim((string)($item['geocode']['amphoe_name']['th'] ?? ''));
        $province = trim((string)($item['geocode']['province_name']['th'] ?? 'ลำปาง'));
        $basin = trim((string)($item['basin']['basin_name']['th'] ?? ''));

        $location = "ต.{$tumbon}อ.{$amphoeRaw} {$province}";
        $rainVal = gh_float($item['rain_24h'] ?? 0) ?? 0.0;

        $rainStatus = 'ไม่มีฝน';
        if ($rainVal > 90) $rainStatus = 'ฝนตกหนักมาก';
        elseif ($rainVal > 35) $rainStatus = 'ฝนตกหนัก';
        elseif ($rainVal > 10) $rainStatus = 'ฝนปานกลาง';
        elseif ($rainVal > 0) $rainStatus = 'ฝนเล็กน้อย';

        $dtRaw = trim((string)($item['rainfall_datetime'] ?? ''));
        $measuredTime = $dtRaw !== '' ? substr($dtRaw, 11, 5) . ' น.' : date('H:i', $nowTs) . ' น.';

        $snapshot['rainfall'][] = [
            'station_name'  => mb_substr($stationName, 0, 150),
            'location'      => mb_substr($location, 0, 150),
            'river_basin'   => mb_substr($basin, 0, 100),
            'rain_mm'       => $rainVal,
            'rain_status'   => $rainStatus,
            'measured_time' => $measuredTime,
            'record_date'   => $thaiDate
        ];

        $amphoeKey = 'อำเภอ' . $amphoeRaw;
        if ($amphoeRaw !== '') {
            $districtRain[$amphoeKey][] = $rainVal;
            if ($tumbon !== '') {
                $subdistrictRain["{$tumbon}_{$amphoeKey}"][] = $rainVal;
            }
        }
    }
    echo "  ✅ Rainfall collected: " . count($snapshot['rainfall']) . " stations\n";
} catch (Throwable $e) {
    echo "  ⚠️ Rainfall error: " . $e->getMessage() . "\n";
}

$subAvg = [];
foreach ($subdistrictRain as $k => $arr) $subAvg[$k] = array_sum($arr) / count($arr);
$distAvg = [];
foreach ($districtRain as $k => $arr) $distAvg[$k] = array_sum($arr) / count($arr);

// -------------------------------------------------------------------------
// 2. Water Level (Lampang province_code=52)
// -------------------------------------------------------------------------
try {
    $wlJson = gh_http_get_json('https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/waterlevel?province_code=52');
    $seen = [];
    foreach (($wlJson['data'] ?? []) as $item) {
        $stationName = trim((string)($item['station']['tele_station_name']['th'] ?? ''));
        if ($stationName === '' || isset($seen[$stationName])) continue;
        $seen[$stationName] = true;

        $river = trim((string)($item['river_name'] ?? ($item['basin']['basin_name']['th'] ?? '-')));
        $tumbon = trim((string)($item['geocode']['tumbon_name']['th'] ?? ''));
        $amphoeRaw = trim((string)($item['geocode']['amphoe_name']['th'] ?? ''));
        $province = trim((string)($item['geocode']['province_name']['th'] ?? 'ลำปาง'));
        $amphoeFull = $amphoeRaw !== '' ? "อำเภอ{$amphoeRaw} {$province}" : $province;
        $amphoeKey = $amphoeRaw !== '' ? "อำเภอ{$amphoeRaw}" : '';

        $wlCurrent = gh_float($item['waterlevel_msl'] ?? null);
        $wlPrev = gh_float($item['waterlevel_msl_previous'] ?? null);
        $minBank = gh_float($item['station']['min_bank'] ?? ($item['station']['left_bank'] ?? null));
        $bankDiff = ($minBank !== null && $wlCurrent !== null) ? round($minBank - $wlCurrent, 2) : null;

        $trend = 'คงที่';
        if ($wlCurrent !== null && $wlPrev !== null) {
            $delta = $wlCurrent - $wlPrev;
            if ($delta > 0.01) $trend = 'เพิ่มขึ้น';
            elseif ($delta < -0.01) $trend = 'ลดลง';
        }

        $sitLevel = (int)($item['situation_level'] ?? 0);
        $storagePct = gh_float($item['storage_percent'] ?? null);
        $status = 'ปกติ';
        if ($bankDiff !== null && $bankDiff <= 0) $status = 'น้ำล้นตลิ่ง';
        elseif ($sitLevel === 5 || ($storagePct !== null && $storagePct > 100)) $status = 'น้ำล้นตลิ่ง';
        elseif ($sitLevel === 4 || ($storagePct !== null && $storagePct >= 70)) $status = 'น้ำมาก';
        elseif ($sitLevel === 1 || ($storagePct !== null && $storagePct <= 10)) $status = 'น้ำน้อยวิกฤต';
        elseif ($sitLevel === 2 || ($storagePct !== null && $storagePct < 30)) $status = 'น้ำน้อย';

        $currentRain = null;
        $subKey = "{$tumbon}_{$amphoeKey}";
        if (isset($subAvg[$subKey])) $currentRain = round($subAvg[$subKey], 2);
        elseif ($amphoeKey !== '' && isset($distAvg[$amphoeKey])) $currentRain = round($distAvg[$amphoeKey], 2);

        $riskLevel = $currentRain === null ? 'ไม่มีข้อมูลฝน' : 'ปกติ';
        if ($currentRain !== null) {
            if ($currentRain > 90) $riskLevel = 'วิกฤตสีแดง';
            elseif ($currentRain > 35) $riskLevel = 'เฝ้าระวัง';
        }

        $snapshot['water'][] = [
            'station_name'          => mb_substr($stationName, 0, 150),
            'river'                 => mb_substr($river, 0, 100),
            'amphoe'                => mb_substr($amphoeFull, 0, 100),
            'province'              => mb_substr($province, 0, 50),
            'current_water_level_m' => $wlCurrent,
            'left_bank_level_m'     => $minBank,
            'bank_difference_m'     => $bankDiff,
            'trend'                 => $trend,
            'status'                => $status,
            'current_rain_mm'       => $currentRain,
            'forecast_rain_24h_mm'  => null,
            'risk_level'            => $riskLevel
        ];
    }
    echo "  ✅ Water level collected: " . count($snapshot['water']) . " stations\n";
} catch (Throwable $e) {
    echo "  ⚠️ Water level error: " . $e->getMessage() . "\n";
}

// -------------------------------------------------------------------------
// 3. Drought / Dam Storage (Lampang province_code=52)
// -------------------------------------------------------------------------
try {
    $damJson = gh_http_get_json('https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/dam?province_code=52');
    $data = $damJson['data'] ?? [];
    $seenDams = [];

    foreach (($data['dam_daily'] ?? []) as $item) {
        $pc = (string)($item['geocode']['province_code'] ?? '');
        $pn = (string)($item['geocode']['province_name']['th'] ?? '');
        if ($pc !== '52' && mb_strpos($pn, 'ลำปาง') === false) continue;
        $rawName = trim((string)($item['dam']['dam_name']['th'] ?? ''));
        if ($rawName === '') continue;
        $damName = (mb_strpos($rawName, 'อ่าง') === 0) ? $rawName : 'อ่าง' . $rawName;
        if (isset($seenDams[$damName])) continue;
        $seenDams[$damName] = true;

        $pctVal = gh_float($item['dam_storage_percent'] ?? null);
        $snapshot['drought'][] = [
            'record_date'        => $thaiDate,
            'dam_type'           => 'อ่างขนาดใหญ่',
            'dam_name'           => mb_substr($damName, 0, 100),
            'capacity_m_cum'     => gh_float($item['dam']['normal_storage'] ?? ($item['dam_storage_cap'] ?? null)),
            'inflow_m_cum'       => gh_float($item['dam_inflow'] ?? null),
            'water_volume_m_cum' => gh_float($item['dam_storage'] ?? null),
            'water_percent'      => $pctVal !== null ? round($pctVal) . '%' : '-',
            'usable_water_m_cum' => gh_float($item['dam_uses_water'] ?? null),
            'discharge_m_cum'    => gh_float($item['dam_released'] ?? null)
        ];
    }

    foreach (($data['dam_medium'] ?? []) as $item) {
        $pc = (string)($item['geocode']['province_code'] ?? '');
        $pn = (string)($item['geocode']['province_name']['th'] ?? '');
        if ($pc !== '52' && mb_strpos($pn, 'ลำปาง') === false) continue;
        $damName = trim((string)($item['dam']['dam_name']['th'] ?? ''));
        if ($damName === '' || $damName === 'แม่มอก' || isset($seenDams[$damName])) continue;
        $vol = gh_float($item['dam_storage'] ?? null);
        $pctVal = gh_float($item['dam_storage_percent'] ?? null);
        if ($vol === null && $pctVal === null) continue;
        $seenDams[$damName] = true;

        $snapshot['drought'][] = [
            'record_date'        => $thaiDate,
            'dam_type'           => 'อ่างขนาดกลาง',
            'dam_name'           => mb_substr($damName, 0, 100),
            'capacity_m_cum'     => gh_float($item['dam']['normal_storage'] ?? null),
            'inflow_m_cum'       => gh_float($item['dam_inflow'] ?? null),
            'water_volume_m_cum' => $vol,
            'water_percent'      => $pctVal !== null ? round($pctVal) . '%' : '-',
            'usable_water_m_cum' => gh_float($item['dam_uses_water'] ?? null),
            'discharge_m_cum'    => gh_float($item['dam_released'] ?? null)
        ];
    }

    foreach (($data['dam_small_tele'] ?? []) as $item) {
        $pc = (string)($item['geocode']['province_code'] ?? '');
        $pn = (string)($item['geocode']['province_name']['th'] ?? '');
        if ($pc !== '52' && mb_strpos($pn, 'ลำปาง') === false) continue;
        $damName = trim((string)($item['dam']['smalldam_name']['th'] ?? ($item['dam']['dam_name']['th'] ?? '')));
        if ($damName === '' || isset($seenDams[$damName])) continue;
        $vol = gh_float($item['volume'] ?? ($item['dam_storage'] ?? null));
        $pctVal = gh_float($item['percent_storage'] ?? ($item['dam_storage_percent'] ?? null));
        if ($vol === null && $pctVal === null) continue;
        $seenDams[$damName] = true;

        $snapshot['drought'][] = [
            'record_date'        => $thaiDate,
            'dam_type'           => 'อ่างขนาดเล็ก',
            'dam_name'           => mb_substr($damName, 0, 100),
            'capacity_m_cum'     => gh_float($item['dam']['normal_storage'] ?? ($item['dam_storage_cap'] ?? null)),
            'inflow_m_cum'       => null,
            'water_volume_m_cum' => $vol,
            'water_percent'      => $pctVal !== null ? round($pctVal) . '%' : '-',
            'usable_water_m_cum' => null,
            'discharge_m_cum'    => null
        ];
    }
    echo "  ✅ Drought/Dam collected: " . count($snapshot['drought']) . " dams\n";
} catch (Throwable $e) {
    echo "  ⚠️ Drought error: " . $e->getMessage() . "\n";
}

// -------------------------------------------------------------------------
// 4. PM 2.5 Air Quality (Lampang province_code=52)
// -------------------------------------------------------------------------
try {
    $pmJson = gh_http_get_json('https://api-v3.thaiwater.net/api/v1/thaiwater30/public/thaiwater/weather');
    $seen = [];
    foreach (($pmJson['pm25']['data'] ?? []) as $item) {
        $pc = (string)($item['geocode']['province_code'] ?? '');
        $pn = (string)($item['geocode']['province_name']['th'] ?? '');
        if ($pc !== '52' && mb_strpos($pn, 'ลำปาง') === false) continue;
        $stationName = trim((string)($item['station']['tele_station_name']['th'] ?? ''));
        if ($stationName === '' || isset($seen[$stationName])) continue;
        $seen[$stationName] = true;

        $tambon = trim((string)($item['geocode']['tumbon_name']['th'] ?? ''));
        $amphoeRaw = trim((string)($item['geocode']['amphoe_name']['th'] ?? ''));
        $amphoe = $amphoeRaw !== '' ? (mb_strpos($amphoeRaw, 'อำเภอ') === 0 ? $amphoeRaw : 'อำเภอ' . $amphoeRaw) : 'อำเภอเมืองลำปาง';

        $dtRaw = trim((string)($item['pm25_datetime'] ?? ''));
        $timeLabel = $dtRaw !== '' ? substr($dtRaw, 11, 5) . ' น.' : date('H:i', $nowTs) . ' น.';

        $pmVal = gh_float($item['pm25_value'] ?? null);
        $pmAvg = gh_float($item['pm25_avg_24h'] ?? ($item['pm25_value'] ?? null));
        if ($pmVal === null) continue;

        $status = 'ไม่ทราบค่า';
        if ($pmVal <= 15.0) $status = 'ดีมาก';
        elseif ($pmVal <= 25.0) $status = 'ดี';
        elseif ($pmVal <= 37.5) $status = 'ปานกลาง';
        elseif ($pmVal <= 75.0) $status = 'เริ่มมีผลต่อสุขภาพ';
        else $status = 'มีผลกระทบต่อสุขภาพ';

        $snapshot['pm25'][] = [
            'record_date'        => $thaiDate,
            'station_name'       => mb_substr($stationName, 0, 150),
            'tambon'             => mb_substr($tambon, 0, 100),
            'amphoe'             => mb_substr($amphoe, 0, 100),
            'province'           => 'ลำปาง',
            'time_label'         => mb_substr($timeLabel, 0, 50),
            'pm25_value'         => $pmVal,
            'pm25_avg_24h'       => $pmAvg,
            'air_quality_status' => $status
        ];
    }
    echo "  ✅ PM 2.5 collected: " . count($snapshot['pm25']) . " stations\n";
} catch (Throwable $e) {
    echo "  ⚠️ PM 2.5 error: " . $e->getMessage() . "\n";
}

// -------------------------------------------------------------------------
// 5. Traffy Fondue Complaints (Lampang Public GeoJSON API)
// -------------------------------------------------------------------------
try {
    $traffyUrl = 'https://publicapi.traffy.in.th/teamchadchart-stat-api/geojson/v1?text=%E0%B8%A5%E0%B8%B3%E0%B8%9B%E0%B8%B2%E0%B8%87';
    $traffyJson = gh_http_get_json($traffyUrl, [
        'Origin: https://bangkok.traffy.in.th',
        'Referer: https://bangkok.traffy.in.th/'
    ], 30);

    $seenTickets = [];
    foreach (($traffyJson['features'] ?? []) as $f) {
        $props = $f['properties'] ?? [];
        $province = trim((string)($props['province'] ?? ''));
        $address = trim((string)($props['address'] ?? ''));
        if ($province !== 'ลำปาง' && mb_strpos($province, 'ลำปาง') === false && mb_strpos($address, 'ลำปาง') === false) {
            continue;
        }
        $ticketId = trim((string)($props['ticket_id'] ?? ''));
        if ($ticketId === '' || isset($seenTickets[$ticketId])) continue;
        $seenTickets[$ticketId] = true;

        $stateName = trim((string)($props['state'] ?? ($props['state_type_latest'] ?? 'รอรับเรื่อง')));
        $problemType = 'ทั่วไป';
        if (!empty($props['problem_type_abdul']) && is_array($props['problem_type_abdul'])) {
            $firstType = trim((string)($props['problem_type_abdul'][0] ?? ''));
            if ($firstType !== '') $problemType = $firstType;
        } elseif (!empty($props['type']) && is_string($props['type'])) {
            $cleanType = trim($props['type'], "{} \t\n\r");
            if ($cleanType !== '') $problemType = explode(',', $cleanType)[0];
        }

        $orgName = 'อบจ.ลำปาง';
        if (!empty($props['org']) && is_array($props['org'])) {
            $orgName = implode(', ', array_filter(array_map('trim', $props['org'])));
        } elseif (!empty($props['org_action']) && is_array($props['org_action'])) {
            $orgName = implode(', ', array_filter(array_map('trim', $props['org_action'])));
        }
        if ($orgName === '') $orgName = 'อบจ.ลำปาง';

        $stars = isset($props['star']) && $props['star'] !== null && $props['star'] !== '' ? '⭐ ' . $props['star'] : '';

        $snapshot['complaints'][] = [
            'ticket_id'          => mb_substr($ticketId, 0, 50),
            'state_name'         => mb_substr($stateName, 0, 100),
            'problem_type'       => mb_substr($problemType, 0, 150),
            'description'        => trim((string)($props['description'] ?? '')),
            'photo_url'          => trim((string)($props['photo_url'] ?? ($props['after_photo'] ?? ''))),
            'location'           => $address,
            'org_name'           => $orgName,
            'ticket_datetime'    => mb_substr(trim((string)($props['timestamp'] ?? '')), 0, 100),
            'satisfaction_stars' => mb_substr($stars, 0, 50),
            'is_in_scope'        => 1
        ];

        if (count($snapshot['complaints']) >= 60) break;
    }
    echo "  ✅ Complaints collected: " . count($snapshot['complaints']) . " tickets\n";
} catch (Throwable $e) {
    echo "  ⚠️ Complaints error: " . $e->getMessage() . "\n";
}

// -------------------------------------------------------------------------
// Write snapshot JSON file into cloud_snapshots/YYYY-MM-DD/
// -------------------------------------------------------------------------
$baseDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'cloud_snapshots';
$dayDir = $baseDir . DIRECTORY_SEPARATOR . $dateFolder;
if (!is_dir($dayDir)) {
    mkdir($dayDir, 0777, true);
}

$filename = "snapshot_{$slotId}.json";
$relPath = "{$dateFolder}/{$filename}";
$fullPath = $dayDir . DIRECTORY_SEPARATOR . $filename;

file_put_contents($fullPath, json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

// Update manifest.json (keeps index of snapshots so local server can sync via HTTP or Git)
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
    'id'          => $snapshot['snapshot_id'],
    'recorded_at' => $recordedAt,
    'path'        => $relPath,
    'counts'      => [
        'water'      => count($snapshot['water']),
        'rainfall'   => count($snapshot['rainfall']),
        'drought'    => count($snapshot['drought']),
        'pm25'       => count($snapshot['pm25']),
        'complaints' => count($snapshot['complaints'])
    ]
];

// Keep last 500 snapshot entries in manifest (~10 days of 30-min intervals)
if (count($manifest['snapshots']) > 500) {
    $manifest['snapshots'] = array_slice($manifest['snapshots'], -500, null, true);
}
file_put_contents($manifestPath, json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

echo "[GitHub-Collector] 🎉 Saved snapshot: cloud_snapshots/{$relPath}\n";

