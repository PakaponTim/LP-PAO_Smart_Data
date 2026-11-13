<?php
// =========================================================================
// Water_System2 (Port 7000) — Direct API Collectors (Replaces Chrome Extensions)
// Pulls directly from:
//   1. https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/rain24?province_code=52
//   2. https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/waterlevel?province_code=52
//   3. https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/dam?province_code=52
//   4. https://api-v3.thaiwater.net/api/v1/thaiwater30/public/thaiwater/weather
//   5. https://publicapi.traffy.in.th/teamchadchart-stat-api/geojson/v1?text=%E0%B8%A5%E0%B8%B3%E0%B8%9B%E0%B8%B2%E0%B8%87
// =========================================================================

require_once __DIR__ . '/config.php';

function http_get_json(string $url, array $extraHeaders = [], int $timeoutSec = 25): ?array {
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

function parse_float_or_null($val): ?float {
    if ($val === null || $val === '' || $val === '-') return null;
    $clean = str_replace(',', '', trim((string)$val));
    if (!is_numeric($clean)) return null;
    return (float)$clean;
}

function record_ingest_batch(PDO $pdo, string $kind, array $payload): string {
    ensure_ingest_tables($pdo);
    $batchId = $kind . ':php7000-' . date('YmdHis') . '-' . substr(bin2hex(random_bytes(4)), 0, 8);
    $fingerprint = hash('sha256', json_encode($payload, JSON_UNESCAPED_UNICODE));
    $stmt = $pdo->prepare("INSERT INTO app_ingest_batches (batch_id, kind, fingerprint, row_count) VALUES (?, ?, ?, ?)");
    $stmt->execute([$batchId, $kind, $fingerprint, count($payload)]);
    return $batchId;
}

// =========================================================================
// 1. Direct Collector: Rainfall (199+ Stations in Lampang)
// =========================================================================
function collect_rainfall_direct(bool $standaloneLog = true): array {
    $pdo = get_db();
    if ($standaloneLog) {
        add_server_log('DirectAPI-7000', '⏳ เริ่มดึงข้อมูลปริมาณน้ำฝน จ.ลำปาง โดยตรงจาก ThaiWater30 API (ไม่ต้องใช้ Extension)...');
    }

    $json = http_get_json('https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/rain24?province_code=52');
    $items = $json['data'] ?? [];
    if (empty($items)) {
        throw new RuntimeException('ไม่พบข้อมูลสถานีน้ำฝนจาก ThaiWater30 API');
    }

    $subdistrictRain = [];
    $districtRain = [];
    $rowsToInsert = [];
    $seenStations = [];
    $thaiDate = format_thai_date();

    foreach ($items as $item) {
        $stationName = trim((string)($item['station']['tele_station_name']['th'] ?? ''));
        if ($stationName === '' || isset($seenStations[$stationName])) continue;
        $seenStations[$stationName] = true;

        $tumbon = trim((string)($item['geocode']['tumbon_name']['th'] ?? ''));
        $amphoeRaw = trim((string)($item['geocode']['amphoe_name']['th'] ?? ''));
        $province = trim((string)($item['geocode']['province_name']['th'] ?? 'ลำปาง'));
        $basin = trim((string)($item['basin']['basin_name']['th'] ?? ''));

        $location = "ต.{$tumbon}อ.{$amphoeRaw} {$province}";
        $rainVal = parse_float_or_null($item['rain_24h'] ?? 0);
        if ($rainVal === null) $rainVal = 0.0;

        $rainStatus = 'ไม่มีฝน';
        if ($rainVal > 90) $rainStatus = 'ฝนตกหนักมาก';
        elseif ($rainVal > 35) $rainStatus = 'ฝนตกหนัก';
        elseif ($rainVal > 10) $rainStatus = 'ฝนปานกลาง';
        elseif ($rainVal > 0) $rainStatus = 'ฝนเล็กน้อย';

        $dtRaw = trim((string)($item['rainfall_datetime'] ?? ''));
        $measuredTime = $dtRaw !== '' ? substr($dtRaw, 11, 5) . ' น.' : date('H:i') . ' น.';

        $rowsToInsert[] = [
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

    $pdo->beginTransaction();
    try {
        $batchId = record_ingest_batch($pdo, 'rainfall', $rowsToInsert);
        $stmt = $pdo->prepare("INSERT INTO tbl_rainfall_monitoring
            (station_name, location, river_basin, rain_mm, rain_status, measured_time, record_date, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW())");
        foreach ($rowsToInsert as $r) {
            $stmt->execute([
                $r['station_name'],
                $r['location'],
                $r['river_basin'],
                $r['rain_mm'],
                $r['rain_status'],
                $r['measured_time'],
                $r['record_date']
            ]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    $subAvg = [];
    foreach ($subdistrictRain as $k => $arr) {
        $subAvg[$k] = array_sum($arr) / count($arr);
    }
    $distAvg = [];
    foreach ($districtRain as $k => $arr) {
        $distAvg[$k] = array_sum($arr) / count($arr);
    }

    $count = count($rowsToInsert);
    add_server_log('DirectAPI-7000', "✅ บันทึกข้อมูลน้ำฝน จ.ลำปาง สำเร็จ {$count} สถานี ลง MySQL (Batch: {$batchId})");
    if ($standaloneLog) {
        log_task_run('ดึงข้อมูลน้ำฝน', 'db', 'success', $count, "Direct API บันทึกลง MySQL สำเร็จ {$count} สถานี; batch: {$batchId}");
    }

    return [
        'success' => true,
        'count' => $count,
        'batchId' => $batchId,
        'subdistrictRainAvg' => $subAvg,
        'districtRainAvg' => $distAvg
    ];
}

// =========================================================================
// 2. Direct Collector: Water Level + Rainfall Mapping (25 Stations in Lampang)
// =========================================================================
function collect_water_level_direct(string $mode = 'db'): array {
    $pdo = get_db();
    add_server_log('DirectAPI-7000', "⏳ เริ่มดึงข้อมูลระดับน้ำและปริมาณน้ำฝน จ.ลำปาง ผ่าน Direct API ({$mode})...");

    // Step 1: Collect rainfall & build subdistrict/district rain maps
    $rainResult = ['subdistrictRainAvg' => [], 'districtRainAvg' => [], 'count' => 0];
    try {
        $rainResult = collect_rainfall_direct(false);
    } catch (Throwable $rainErr) {
        add_server_log('DirectAPI-7000', '⚠️ ดึงข้อมูลน้ำฝนเบื้องต้นไม่สำเร็จ ใช้ค่าเริ่มต้น: ' . $rainErr->getMessage());
    }

    // Step 2: Fetch Water Level from ThaiWater30 API
    $json = http_get_json('https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/waterlevel?province_code=52');
    $items = $json['data'] ?? [];
    if (empty($items)) {
        throw new RuntimeException('ไม่พบข้อมูลระดับน้ำจาก ThaiWater30 API');
    }

    $rowsToInsert = [];
    $seenStations = [];

    foreach ($items as $item) {
        $stationName = trim((string)($item['station']['tele_station_name']['th'] ?? ''));
        if ($stationName === '' || isset($seenStations[$stationName])) continue;
        $seenStations[$stationName] = true;

        $river = trim((string)($item['river_name'] ?? ($item['basin']['basin_name']['th'] ?? '-')));
        $tumbon = trim((string)($item['geocode']['tumbon_name']['th'] ?? ''));
        $amphoeRaw = trim((string)($item['geocode']['amphoe_name']['th'] ?? ''));
        $province = trim((string)($item['geocode']['province_name']['th'] ?? 'ลำปาง'));
        $amphoeFull = $amphoeRaw !== '' ? "อำเภอ{$amphoeRaw} {$province}" : $province;
        $amphoeKey = $amphoeRaw !== '' ? "อำเภอ{$amphoeRaw}" : '';

        $wlCurrent = parse_float_or_null($item['waterlevel_msl'] ?? null);
        $wlPrev = parse_float_or_null($item['waterlevel_msl_previous'] ?? null);
        $minBank = parse_float_or_null($item['station']['min_bank'] ?? ($item['station']['left_bank'] ?? null));

        $bankDiff = null;
        if ($minBank !== null && $wlCurrent !== null) {
            $bankDiff = round($minBank - $wlCurrent, 2);
        }

        // Trend calculation
        $trend = 'คงที่';
        if ($wlCurrent !== null && $wlPrev !== null) {
            $delta = $wlCurrent - $wlPrev;
            if ($delta > 0.01) $trend = 'เพิ่มขึ้น';
            elseif ($delta < -0.01) $trend = 'ลดลง';
        }

        // Status mapping from situation_level / storage_percent
        $sitLevel = (int)($item['situation_level'] ?? 0);
        $storagePct = parse_float_or_null($item['storage_percent'] ?? null);
        $status = 'ปกติ';
        if ($bankDiff !== null && $bankDiff <= 0) {
            $status = 'น้ำล้นตลิ่ง';
        } elseif ($sitLevel === 5 || ($storagePct !== null && $storagePct > 100)) {
            $status = 'น้ำล้นตลิ่ง';
        } elseif ($sitLevel === 4 || ($storagePct !== null && $storagePct >= 70)) {
            $status = 'น้ำมาก';
        } elseif ($sitLevel === 1 || ($storagePct !== null && $storagePct <= 10)) {
            $status = 'น้ำน้อยวิกฤต';
        } elseif ($sitLevel === 2 || ($storagePct !== null && $storagePct < 30)) {
            $status = 'น้ำน้อย';
        }

        // Map rainfall from subdistrict / district
        $currentRain = null;
        $subKey = "{$tumbon}_{$amphoeKey}";
        if (isset($rainResult['subdistrictRainAvg'][$subKey])) {
            $currentRain = round($rainResult['subdistrictRainAvg'][$subKey], 2);
        } elseif ($amphoeKey !== '' && isset($rainResult['districtRainAvg'][$amphoeKey])) {
            $currentRain = round($rainResult['districtRainAvg'][$amphoeKey], 2);
        }

        $forecastRain = null;
        $riskLevel = $currentRain === null ? 'ไม่มีข้อมูลฝน' : 'ปกติ';
        if ($currentRain !== null) {
            if ($currentRain > 90) $riskLevel = 'วิกฤตสีแดง';
            elseif ($currentRain > 35) $riskLevel = 'เฝ้าระวัง';
        }

        $rowsToInsert[] = [
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
            'forecast_rain_24h_mm'  => $forecastRain,
            'risk_level'            => $riskLevel
        ];
    }

    $pdo->beginTransaction();
    try {
        $batchId = record_ingest_batch($pdo, 'water', $rowsToInsert);
        $stmt = $pdo->prepare("INSERT INTO tbl_water_disaster_monitoring
            (station_name, river, amphoe, province, current_water_level_m, left_bank_level_m, bank_difference_m, trend, status, current_rain_mm, forecast_rain_24h_mm, risk_level, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())");
        foreach ($rowsToInsert as $r) {
            $stmt->execute([
                $r['station_name'],
                $r['river'],
                $r['amphoe'],
                $r['province'],
                $r['current_water_level_m'],
                $r['left_bank_level_m'],
                $r['bank_difference_m'],
                $r['trend'],
                $r['status'],
                $r['current_rain_mm'],
                $r['forecast_rain_24h_mm'],
                $r['risk_level']
            ]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    $count = count($rowsToInsert);
    $msg = "DB: committed ({$count} สถานีน้ำ + {$rainResult['count']} สถานีฝน); Direct API; batch: {$batchId}";
    add_server_log('DirectAPI-7000', "✅ ดึงข้อมูลระดับน้ำ จ.ลำปาง สำเร็จ {$count} สถานี บันทึกลง MySQL เรียบร้อยแล้ว");
    log_task_run('ดึงข้อมูลระดับน้ำ', $mode, 'success', $count, $msg);

    return [
        'success' => true,
        'count' => $count,
        'rainfallCount' => $rainResult['count'],
        'batchId' => $batchId
    ];
}

// =========================================================================
// 3. Direct Collector: Drought / Dam Storage (36 Dams in Lampang)
// =========================================================================
function collect_drought_direct(string $mode = 'db'): array {
    $pdo = get_db();
    add_server_log('DirectAPI-7000', "⏳ เริ่มดึงข้อมูลอ่างเก็บน้ำ/ภัยแล้ง จ.ลำปาง ผ่าน Direct API ({$mode})...");

    $json = http_get_json('https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/dam?province_code=52');
    $data = $json['data'] ?? [];
    if (empty($data)) {
        throw new RuntimeException('ไม่พบข้อมูลอ่างเก็บน้ำจาก ThaiWater30 API');
    }

    $thaiDate = format_thai_date();
    $rowsToInsert = [];
    $seenDams = [];

    // 1. Large Dams (dam_daily)
    foreach (($data['dam_daily'] ?? []) as $item) {
        $pc = (string)($item['geocode']['province_code'] ?? '');
        $pn = (string)($item['geocode']['province_name']['th'] ?? '');
        if ($pc !== '52' && mb_strpos($pn, 'ลำปาง') === false) continue;

        $rawName = trim((string)($item['dam']['dam_name']['th'] ?? ''));
        if ($rawName === '') continue;
        $damName = (mb_strpos($rawName, 'อ่าง') === 0) ? $rawName : 'อ่าง' . $rawName;
        if (isset($seenDams[$damName])) continue;
        $seenDams[$damName] = true;

        $cap = parse_float_or_null($item['dam']['normal_storage'] ?? ($item['dam_storage_cap'] ?? null));
        $inflow = parse_float_or_null($item['dam_inflow'] ?? null);
        $vol = parse_float_or_null($item['dam_storage'] ?? null);
        $pctVal = parse_float_or_null($item['dam_storage_percent'] ?? null);
        $usable = parse_float_or_null($item['dam_uses_water'] ?? null);
        $released = parse_float_or_null($item['dam_released'] ?? null);

        $pctStr = $pctVal !== null ? round($pctVal) . '%' : '-';

        $rowsToInsert[] = [
            'record_date'        => $thaiDate,
            'dam_type'           => 'อ่างขนาดใหญ่',
            'dam_name'           => mb_substr($damName, 0, 100),
            'capacity_m_cum'     => $cap,
            'inflow_m_cum'       => $inflow,
            'water_volume_m_cum' => $vol,
            'water_percent'      => $pctStr,
            'usable_water_m_cum' => $usable,
            'discharge_m_cum'    => $released
        ];
    }

    // 2. Medium Dams (dam_medium)
    foreach (($data['dam_medium'] ?? []) as $item) {
        $pc = (string)($item['geocode']['province_code'] ?? '');
        $pn = (string)($item['geocode']['province_name']['th'] ?? '');
        if ($pc !== '52' && mb_strpos($pn, 'ลำปาง') === false) continue;

        $damName = trim((string)($item['dam']['dam_name']['th'] ?? ''));
        if ($damName === '' || $damName === 'แม่มอก') continue; // แม่มอก is already in dam_daily
        if (isset($seenDams[$damName])) continue;

        $vol = parse_float_or_null($item['dam_storage'] ?? null);
        $pctVal = parse_float_or_null($item['dam_storage_percent'] ?? null);
        // Skip inactive placeholder entries that have neither storage volume nor percentage
        if ($vol === null && $pctVal === null) continue;

        $seenDams[$damName] = true;
        $cap = parse_float_or_null($item['dam']['normal_storage'] ?? null);
        $inflow = parse_float_or_null($item['dam_inflow'] ?? null);
        $usable = parse_float_or_null($item['dam_uses_water'] ?? null);
        $released = parse_float_or_null($item['dam_released'] ?? null);
        $pctStr = $pctVal !== null ? round($pctVal) . '%' : '-';

        $rowsToInsert[] = [
            'record_date'        => $thaiDate,
            'dam_type'           => 'อ่างขนาดกลาง',
            'dam_name'           => mb_substr($damName, 0, 100),
            'capacity_m_cum'     => $cap,
            'inflow_m_cum'       => $inflow,
            'water_volume_m_cum' => $vol,
            'water_percent'      => $pctStr,
            'usable_water_m_cum' => $usable,
            'discharge_m_cum'    => $released
        ];
    }

    // 3. Small Telemetry Dams (dam_small_tele)
    foreach (($data['dam_small_tele'] ?? []) as $item) {
        $pc = (string)($item['geocode']['province_code'] ?? '');
        $pn = (string)($item['geocode']['province_name']['th'] ?? '');
        if ($pc !== '52' && mb_strpos($pn, 'ลำปาง') === false) continue;

        $damName = trim((string)($item['dam']['smalldam_name']['th'] ?? ($item['dam']['dam_name']['th'] ?? '')));
        if ($damName === '' || isset($seenDams[$damName])) continue;

        $vol = parse_float_or_null($item['volume'] ?? ($item['dam_storage'] ?? null));
        $pctVal = parse_float_or_null($item['percent_storage'] ?? ($item['dam_storage_percent'] ?? null));
        if ($vol === null && $pctVal === null) continue;

        $seenDams[$damName] = true;
        $cap = parse_float_or_null($item['dam']['normal_storage'] ?? ($item['dam_storage_cap'] ?? null));
        $pctStr = $pctVal !== null ? round($pctVal) . '%' : '-';

        $rowsToInsert[] = [
            'record_date'        => $thaiDate,
            'dam_type'           => 'อ่างขนาดเล็ก',
            'dam_name'           => mb_substr($damName, 0, 100),
            'capacity_m_cum'     => $cap,
            'inflow_m_cum'       => null,
            'water_volume_m_cum' => $vol,
            'water_percent'      => $pctStr,
            'usable_water_m_cum' => null,
            'discharge_m_cum'    => null
        ];
    }

    if (empty($rowsToInsert)) {
        throw new RuntimeException('ไม่พบรายการอ่างเก็บน้ำในจังหวัดลำปางที่มีข้อมูล');
    }

    $pdo->beginTransaction();
    try {
        $batchId = record_ingest_batch($pdo, 'drought', $rowsToInsert);
        $stmt = $pdo->prepare("INSERT INTO tbl_drought_monitoring
            (record_date, dam_type, dam_name, capacity_m_cum, inflow_m_cum, water_volume_m_cum, water_percent, usable_water_m_cum, discharge_m_cum, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())");
        foreach ($rowsToInsert as $r) {
            $stmt->execute([
                $r['record_date'],
                $r['dam_type'],
                $r['dam_name'],
                $r['capacity_m_cum'],
                $r['inflow_m_cum'],
                $r['water_volume_m_cum'],
                $r['water_percent'],
                $r['usable_water_m_cum'],
                $r['discharge_m_cum']
            ]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    $count = count($rowsToInsert);
    $msg = "DB: committed ({$count} อ่างเก็บน้ำ); Direct API; batch: {$batchId}";
    add_server_log('DirectAPI-7000', "✅ ดึงข้อมูลอ่างเก็บน้ำ/ภัยแล้ง จ.ลำปาง สำเร็จ {$count} แห่ง บันทึกลง MySQL เรียบร้อยแล้ว");
    log_task_run('ดึงข้อมูลภัยแล้ง', $mode, 'success', $count, $msg);

    return [
        'success' => true,
        'count' => $count,
        'batchId' => $batchId
    ];
}

// =========================================================================
// 4. Direct Collector: PM 2.5 Air Quality (~33 Stations in Lampang)
// =========================================================================
function collect_pm25_direct(string $mode = 'db'): array {
    $pdo = get_db();
    add_server_log('DirectAPI-7000', "⏳ เริ่มดึงข้อมูลคุณภาพอากาศ PM 2.5 จ.ลำปาง ผ่าน Direct API ({$mode})...");

    $json = http_get_json('https://api-v3.thaiwater.net/api/v1/thaiwater30/public/thaiwater/weather');
    $items = $json['pm25']['data'] ?? [];
    if (empty($items)) {
        throw new RuntimeException('ไม่พบข้อมูล PM 2.5 จาก ThaiWater30 Weather API');
    }

    $thaiDate = format_thai_date();
    $rowsToInsert = [];
    $seenStations = [];

    foreach ($items as $item) {
        $pc = (string)($item['geocode']['province_code'] ?? '');
        $pn = (string)($item['geocode']['province_name']['th'] ?? '');
        if ($pc !== '52' && mb_strpos($pn, 'ลำปาง') === false) continue;

        $stationName = trim((string)($item['station']['tele_station_name']['th'] ?? ''));
        if ($stationName === '' || isset($seenStations[$stationName])) continue;
        $seenStations[$stationName] = true;

        $tambon = trim((string)($item['geocode']['tumbon_name']['th'] ?? ''));
        $amphoeRaw = trim((string)($item['geocode']['amphoe_name']['th'] ?? ''));
        $amphoe = $amphoeRaw !== '' ? (mb_strpos($amphoeRaw, 'อำเภอ') === 0 ? $amphoeRaw : 'อำเภอ' . $amphoeRaw) : 'อำเภอเมืองลำปาง';

        $dtRaw = trim((string)($item['pm25_datetime'] ?? ''));
        $timeLabel = $dtRaw !== '' ? substr($dtRaw, 11, 5) . ' น.' : date('H:i') . ' น.';

        $pmVal = parse_float_or_null($item['pm25_value'] ?? null);
        $pmAvg = parse_float_or_null($item['pm25_avg_24h'] ?? ($item['pm25_value'] ?? null));
        if ($pmVal === null) continue;

        $status = 'ไม่ทราบค่า';
        if ($pmVal <= 15.0) $status = 'ดีมาก';
        elseif ($pmVal <= 25.0) $status = 'ดี';
        elseif ($pmVal <= 37.5) $status = 'ปานกลาง';
        elseif ($pmVal <= 75.0) $status = 'เริ่มมีผลต่อสุขภาพ';
        else $status = 'มีผลกระทบต่อสุขภาพ';

        $rowsToInsert[] = [
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

    if (empty($rowsToInsert)) {
        throw new RuntimeException('ไม่พบสถานีตรวจวัด PM 2.5 ในจังหวัดลำปาง');
    }

    $pdo->beginTransaction();
    try {
        $batchId = record_ingest_batch($pdo, 'pm25', $rowsToInsert);
        $stmt = $pdo->prepare("INSERT INTO tbl_pm25_monitoring
            (record_date, station_name, tambon, amphoe, province, time_label, pm25_value, pm25_avg_24h, air_quality_status, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())");
        foreach ($rowsToInsert as $r) {
            $stmt->execute([
                $r['record_date'],
                $r['station_name'],
                $r['tambon'],
                $r['amphoe'],
                $r['province'],
                $r['time_label'],
                $r['pm25_value'],
                $r['pm25_avg_24h'],
                $r['air_quality_status']
            ]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    $count = count($rowsToInsert);
    $msg = "DB: committed ({$count} สถานี PM 2.5); Direct API; batch: {$batchId}";
    add_server_log('DirectAPI-7000', "✅ ดึงข้อมูล PM 2.5 จ.ลำปาง สำเร็จ {$count} สถานี บันทึกลง MySQL เรียบร้อยแล้ว");
    log_task_run('ดึงข้อมูล PM 2.5', $mode, 'success', $count, $msg);

    return [
        'success' => true,
        'count' => $count,
        'batchId' => $batchId
    ];
}

// =========================================================================
// 5. Direct Collector: Traffy Fondue Complaints (Lampang Public GeoJSON API)
// =========================================================================
function fetch_traffy_timeline_direct(string $ticketId): ?array {
    $url = 'https://publicapi.traffy.in.th/teamchadchart-stat-api/detail-timeline/v1?ticket_id=' . rawurlencode($ticketId);
    try {
        return http_get_json($url, [
            'Origin: https://bangkok.traffy.in.th',
            'Referer: https://bangkok.traffy.in.th/'
        ], 12);
    } catch (Throwable $e) {
        return null;
    }
}

function collect_complaints_direct(string $mode = 'db'): array {
    $pdo = get_db();
    add_server_log('DirectAPI-7000', "⏳ เริ่มดึงข้อมูลเรื่องร้องเรียน Traffy Fondue จ.ลำปาง ผ่าน Direct Public API (ไม่ต้องล็อกอิน/ไม่ต้องใช้ Extension)...");

    $url = 'https://publicapi.traffy.in.th/teamchadchart-stat-api/geojson/v1?text=%E0%B8%A5%E0%B8%B3%E0%B8%9B%E0%B8%B2%E0%B8%87';
    $json = http_get_json($url, [
        'Origin: https://bangkok.traffy.in.th',
        'Referer: https://bangkok.traffy.in.th/'
    ], 30);

    $features = $json['features'] ?? [];
    if (empty($features)) {
        throw new RuntimeException('ไม่พบข้อมูลเรื่องร้องเรียนจาก Traffy Public API');
    }

    $prepared = [];
    $seenTickets = [];

    foreach ($features as $f) {
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

        // Problem type array or string
        $problemType = 'ทั่วไป';
        if (!empty($props['problem_type_abdul']) && is_array($props['problem_type_abdul'])) {
            $firstType = trim((string)($props['problem_type_abdul'][0] ?? ''));
            if ($firstType !== '') $problemType = $firstType;
        } elseif (!empty($props['type']) && is_string($props['type'])) {
            $cleanType = trim($props['type'], "{} \t\n\r");
            if ($cleanType !== '') $problemType = explode(',', $cleanType)[0];
        }

        // Organization array or string
        $orgName = 'อบจ.ลำปาง';
        if (!empty($props['org']) && is_array($props['org'])) {
            $orgName = implode(', ', array_filter(array_map('trim', $props['org'])));
        } elseif (!empty($props['org_action']) && is_array($props['org_action'])) {
            $orgName = implode(', ', array_filter(array_map('trim', $props['org_action'])));
        }
        if ($orgName === '') $orgName = 'อบจ.ลำปาง';

        $desc = trim((string)($props['description'] ?? ''));
        $photoUrl = trim((string)($props['photo_url'] ?? ($props['after_photo'] ?? '')));
        $timestampStr = trim((string)($props['timestamp'] ?? ''));
        $stars = isset($props['star']) && $props['star'] !== null && $props['star'] !== '' ? '⭐ ' . $props['star'] : '';

        $prepared[] = [
            'ticket_id'          => mb_substr($ticketId, 0, 50),
            'state_name'         => mb_substr($stateName, 0, 100),
            'problem_type'       => mb_substr($problemType, 0, 150),
            'description'        => $desc,
            'photo_url'          => $photoUrl,
            'location'           => $address,
            'org_name'           => $orgName,
            'ticket_datetime'    => mb_substr($timestampStr, 0, 100),
            'satisfaction_stars' => mb_substr($stars, 0, 50),
            'is_in_scope'        => 1
        ];

        // Cap per-fetch batch to 60 latest Lampang tickets to keep response fast
        if (count($prepared) >= 60) break;
    }

    if (empty($prepared)) {
        throw new RuntimeException('ไม่พบเรื่องร้องเรียนในเขตจังหวัดลำปางจาก Traffy API');
    }

    // Check existing rows for timeline caching (fetch timeline for new/changed tickets up to 5 per run to stay fast)
    $timelineFetches = 0;
    $checkStmt = $pdo->prepare("SELECT state_name, raw_timeline FROM tbl_complaints_monitoring WHERE ticket_id = ? LIMIT 1");
    foreach ($prepared as &$row) {
        $checkStmt->execute([$row['ticket_id']]);
        $existing = $checkStmt->fetch();
        $timeline = $existing['raw_timeline'] ?? null;
        if ((!$existing || ($existing['state_name'] !== $row['state_name'] && $row['state_name'] !== 'เสร็จสิ้น')) && $timelineFetches < 5) {
            $tlData = fetch_traffy_timeline_direct($row['ticket_id']);
            if ($tlData !== null) {
                $timeline = json_encode($tlData, JSON_UNESCAPED_UNICODE);
            }
            $timelineFetches++;
        }
        $row['raw_timeline'] = $timeline;
    }
    unset($row);

    $pdo->beginTransaction();
    try {
        $batchId = record_ingest_batch($pdo, 'complaints', $prepared);
        $selectExisting = $pdo->prepare("SELECT state_name, org_name FROM tbl_complaints_monitoring WHERE ticket_id = ? LIMIT 1");
        $upsertStmt = $pdo->prepare("INSERT INTO tbl_complaints_monitoring
            (ticket_id, state_name, problem_type, description, photo_url, location, org_name, ticket_datetime, satisfaction_stars, raw_timeline, is_in_scope, agency_status, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                state_name = VALUES(state_name),
                problem_type = VALUES(problem_type),
                description = VALUES(description),
                photo_url = VALUES(photo_url),
                location = VALUES(location),
                org_name = VALUES(org_name),
                ticket_datetime = VALUES(ticket_datetime),
                satisfaction_stars = VALUES(satisfaction_stars),
                raw_timeline = COALESCE(VALUES(raw_timeline), raw_timeline),
                is_in_scope = VALUES(is_in_scope),
                agency_status = VALUES(agency_status),
                recorded_at = NOW()");
        $eventStmt = $pdo->prepare("INSERT INTO app_complaint_events (ticket_id, state_name, org_name, batch_id) VALUES (?, ?, ?, ?)");

        foreach ($prepared as $r) {
            $selectExisting->execute([$r['ticket_id']]);
            $old = $selectExisting->fetch();

            $isPao = (mb_strpos($r['org_name'], 'อบจ.ลำปาง') !== false || mb_strpos($r['org_name'], 'องค์การบริหารส่วนจังหวัดลำปาง') !== false);
            $st = $r['state_name'];
            $agency = $isPao ? 'งานที่เป็นสถานะอื่นๆ' : 'สถานะอื่นๆ ของหน่วยงาน';
            if (mb_strpos($st, 'รอรับเรื่อง') !== false) {
                $agency = $isPao ? 'งานที่รับเรื่องร้องเรียน' : 'อบจ.รับมอบหมายงาน';
            } elseif (mb_strpos($st, 'ส่งต่อ') !== false) {
                $agency = $isPao ? 'งานส่งต่อ' : 'ส่งต่อให้หน่วยงานอื่นดำเนินการ';
            } elseif (mb_strpos($st, 'เสร็จสิ้น') !== false) {
                $agency = $isPao ? 'งานที่ อบจ.ดำเนินการเสร็จ' : 'หน่วยงานอื่นดำเนินการเสร็จ';
            } elseif (mb_strpos($st, 'กำลังดำเนินการ') !== false || mb_strpos($st, 'ถูกติดตาม') !== false) {
                $agency = $isPao ? 'งานที่ อบจ.กำลังดำเนินการ' : 'หน่วยงานอื่นกำลังดำเนินการ';
            } elseif (mb_strpos($st, 'รับมอบ') !== false) {
                $agency = $isPao ? 'สถานะรับมอบจากหน่วยงานอื่นๆ' : 'สถานะที่หน่วยงานรับมอบจาก อบจ.ลำปาง';
            }

            $upsertStmt->execute([
                $r['ticket_id'],
                $r['state_name'],
                $r['problem_type'],
                $r['description'],
                $r['photo_url'],
                $r['location'],
                $r['org_name'],
                $r['ticket_datetime'],
                $r['satisfaction_stars'],
                $r['raw_timeline'],
                $r['is_in_scope'],
                $agency
            ]);

            if (!$old || $old['state_name'] !== $r['state_name'] || $old['org_name'] !== $r['org_name']) {
                $eventStmt->execute([$r['ticket_id'], $r['state_name'], $r['org_name'], $batchId]);
            }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    $count = count($prepared);
    $msg = "DB: committed ({$count} เรื่องร้องเรียน); Direct API; batch: {$batchId}";
    add_server_log('DirectAPI-7000', "✅ ดึงข้อมูลเรื่องร้องเรียน Traffy Fondue จ.ลำปาง สำเร็จ {$count} รายการ บันทึกลง MySQL เรียบร้อยแล้ว");
    log_task_run('ดึงข้อมูลเรื่องร้องเรียน', $mode, 'success', $count, $msg);

    return [
        'success' => true,
        'count' => $count,
        'batchId' => $batchId
    ];
}

