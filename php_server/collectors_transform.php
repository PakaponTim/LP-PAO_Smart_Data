<?php
// =========================================================================
// Water_System2 — Shared Pure Data Transformers for All 5 Source APIs
// Zero DB / Network dependency so both collectors.php & github_collect_snapshot.php
// produce 100% identical, verified fields matching lampang.thaiwater.net.
// =========================================================================

if (!function_exists('parse_float_or_null')) {
    function parse_float_or_null($val): ?float {
        if ($val === null || $val === '' || $val === '-') return null;
        $clean = str_replace(',', '', trim((string)$val));
        if (!is_numeric($clean)) return null;
        return (float)$clean;
    }
}

if (!function_exists('transform_thai_date')) {
    function transform_thai_date(?int $timestamp = null): string {
        if ($timestamp === null) $timestamp = time();
        $thaiMonths = [
            1 => 'มกราคม', 2 => 'กุมภาพันธ์', 3 => 'มีนาคม', 4 => 'เมษายน',
            5 => 'พฤษภาคม', 6 => 'มิถุนายน', 7 => 'กรกฎาคม', 8 => 'สิงหาคม',
            9 => 'กันยายน', 10 => 'ตุลาคม', 11 => 'พฤศจิกายน', 12 => 'ธันวาคม'
        ];
        return (int)date('j', $timestamp) . ' ' . $thaiMonths[(int)date('n', $timestamp)] . ' ' . ((int)date('Y', $timestamp) + 543);
    }
}

/**
 * Resolve Thai river basin name from explicit basin object or ThaiWater sub_basin_id.
 */
function resolve_lampang_basin_name(array $item, string $fallback = ''): string {
    $basin = trim((string)($item['basin']['basin_name']['th'] ?? ''));
    if ($basin !== '') return $basin;

    $subBasinId = trim((string)($item['station']['sub_basin_id'] ?? ($item['sub_basin_id'] ?? '')));
    if (strpos($subBasinId, '07') === 0) return 'ลุ่มน้ำวัง';
    if (strpos($subBasinId, '08') === 0) return 'ลุ่มน้ำยม';
    if (strpos($subBasinId, '06') === 0) return 'ลุ่มน้ำกก';

    return $fallback;
}

/**
 * Clean Amphoe name consistently without duplicating trailing province name.
 */
function format_lampang_amphoe(string $amphoeRaw): string {
    $clean = trim(str_replace(['อำเภอ', 'อ.', 'จังหวัดลำปาง', 'จ.ลำปาง'], '', $amphoeRaw));
    $clean = trim(preg_replace('/\s+ลำปาง$/u', '', $clean));
    if ($clean === '') return '';
    return 'อำเภอ' . $clean;
}

/**
 * Normalize upstream timestamp strings into Asia/Bangkok Unix epoch seconds.
 */
function parse_upstream_datetime(?string $raw): ?int {
    $raw = trim((string)$raw);
    if ($raw === '' || $raw === '-') return null;
    $ts = strtotime($raw);
    return ($ts !== false && $ts > 0) ? $ts : null;
}

/**
 * 1. Transform ThaiWater30 provinces/rain24?province_code=52 JSON.
 *
 * @return array{rows:array, subdistrictRainAvg:array, districtRainAvg:array, observations:array}
 */
function transform_rainfall_items(array $json, ?int $nowTs = null): array {
    if ($nowTs === null) $nowTs = time();
    $items = $json['data'] ?? [];
    $thaiDate = transform_thai_date($nowTs);

    $rows = [];
    $seenStations = [];
    $subdistrictRain = [];
    $districtRain = [];
    $observations = [];

    foreach ($items as $item) {
        $stationName = trim((string)($item['station']['tele_station_name']['th'] ?? ''));
        if ($stationName === '' || isset($seenStations[$stationName])) continue;
        $seenStations[$stationName] = true;

        $tumbon = trim((string)($item['geocode']['tumbon_name']['th'] ?? ''));
        $amphoeRaw = trim((string)($item['geocode']['amphoe_name']['th'] ?? ''));
        $basin = resolve_lampang_basin_name($item, '');

        $locParts = [];
        if ($tumbon !== '') $locParts[] = "ต.{$tumbon}";
        if ($amphoeRaw !== '') $locParts[] = "อ.{$amphoeRaw}";
        $location = !empty($locParts) ? implode(' ', $locParts) : 'จ.ลำปาง';

        $rainVal = parse_float_or_null($item['rain_24h'] ?? 0);
        if ($rainVal === null) $rainVal = 0.0;

        // Match lampang.thaiwater.net/rainfall table labels & historical DB categories
        $rainStatus = 'ไม่มีฝน';
        if ($rainVal > 90) $rainStatus = 'ฝนตกหนักมาก';
        elseif ($rainVal > 35) $rainStatus = 'หนัก';
        elseif ($rainVal > 10) $rainStatus = 'ปานกลาง';
        elseif ($rainVal > 0) $rainStatus = 'เล็กน้อย';

        $dtRaw = trim((string)($item['rainfall_datetime'] ?? ''));
        $measuredTime = (strlen($dtRaw) >= 16) ? substr($dtRaw, 11, 5) . ' น.' : date('H:i', $nowTs) . ' น.';

        $rows[] = [
            'station_name'  => mb_substr($stationName, 0, 150),
            'location'      => mb_substr($location, 0, 150),
            'river_basin'   => mb_substr($basin, 0, 100),
            'rain_mm'       => $rainVal,
            'rain_status'   => $rainStatus,
            'measured_time' => $measuredTime,
            'record_date'   => $thaiDate
        ];

        $observations[] = [
            'station' => $stationName,
            'datetime' => $dtRaw,
            'ts' => parse_upstream_datetime($dtRaw),
            'value' => $rainVal
        ];

        $amphoeKey = format_lampang_amphoe($amphoeRaw);
        if ($amphoeKey !== '') {
            $districtRain[$amphoeKey][] = $rainVal;
            if ($tumbon !== '') {
                $subdistrictRain["{$tumbon}_{$amphoeKey}"][] = $rainVal;
            }
        }
    }

    $subAvg = [];
    foreach ($subdistrictRain as $k => $arr) {
        $subAvg[$k] = array_sum($arr) / count($arr);
    }
    $distAvg = [];
    foreach ($districtRain as $k => $arr) {
        $distAvg[$k] = array_sum($arr) / count($arr);
    }

    return [
        'rows' => $rows,
        'subdistrictRainAvg' => $subAvg,
        'districtRainAvg' => $distAvg,
        'observations' => $observations
    ];
}

/**
 * Transform ThaiWater30 provinces/rain3d?province_code=52 JSON into subdistrict & district 3-day accumulation maps.
 *
 * @return array{subdistrictRain3dAvg:array, districtRain3dAvg:array, districtRain3dMax:array, count:int}
 */
function transform_rain3d_maps(array $json): array {
    $items = $json['data'] ?? [];
    $sub = [];
    $dist = [];
    $seen = [];

    foreach ($items as $item) {
        $stationName = trim((string)($item['station']['tele_station_name']['th'] ?? ''));
        if ($stationName === '' || isset($seen[$stationName])) continue;
        $seen[$stationName] = true;

        $val = parse_float_or_null($item['rain_3d'] ?? null);
        if ($val === null) continue;

        $tumbon = trim((string)($item['geocode']['tumbon_name']['th'] ?? ''));
        $amphoeKey = format_lampang_amphoe((string)($item['geocode']['amphoe_name']['th'] ?? ''));
        if ($amphoeKey !== '') {
            $dist[$amphoeKey][] = $val;
            if ($tumbon !== '') {
                $sub["{$tumbon}_{$amphoeKey}"][] = $val;
            }
        }
    }

    $subAvg = [];
    foreach ($sub as $k => $arr) {
        $subAvg[$k] = round(array_sum($arr) / count($arr), 2);
    }
    $distAvg = [];
    $distMax = [];
    foreach ($dist as $k => $arr) {
        $distAvg[$k] = round(array_sum($arr) / count($arr), 2);
        $distMax[$k] = round(max($arr), 2);
    }

    return [
        'subdistrictRain3dAvg' => $subAvg,
        'districtRain3dAvg' => $distAvg,
        'districtRain3dMax' => $distMax,
        'count' => count($seen)
    ];
}

/**
 * 2. Transform ThaiWater30 provinces/waterlevel?province_code=52 JSON.
 *
 * @return array{rows:array, observations:array}
 */
function transform_water_level_items(array $json, array $rain24Result, array $rain3dResult = []): array {
    $items = $json['data'] ?? [];
    $rows = [];
    $seenStations = [];
    $observations = [];

    foreach ($items as $item) {
        $stationName = trim((string)($item['station']['tele_station_name']['th'] ?? ''));
        if ($stationName === '' || isset($seenStations[$stationName])) continue;
        $seenStations[$stationName] = true;

        // Historical table in tbl_water_disaster_monitoring uses main basin name (ลุ่มน้ำวัง / ลุ่มน้ำยม)
        $basinName = resolve_lampang_basin_name($item, '');
        $riverName = trim((string)($item['river_name'] ?? ''));
        $river = $basinName !== '' ? $basinName : ($riverName !== '' ? $riverName : '-');

        $tumbon = trim((string)($item['geocode']['tumbon_name']['th'] ?? ''));
        $amphoeRaw = trim((string)($item['geocode']['amphoe_name']['th'] ?? ''));
        $province = trim((string)($item['geocode']['province_name']['th'] ?? 'ลำปาง'));
        $amphoeClean = format_lampang_amphoe($amphoeRaw);
        $amphoeOut = $amphoeClean !== '' ? $amphoeClean : $province;

        $wlCurrent = parse_float_or_null($item['waterlevel_msl'] ?? null);
        $wlPrev = parse_float_or_null($item['waterlevel_msl_previous'] ?? null);
        $minBank = parse_float_or_null($item['station']['min_bank'] ?? ($item['station']['left_bank'] ?? null));

        $bankDiff = parse_float_or_null($item['diff_wl_bank'] ?? null);
        if ($bankDiff === null && $minBank !== null && $wlCurrent !== null) {
            $bankDiff = round($minBank - $wlCurrent, 2);
        } elseif ($bankDiff !== null && $minBank !== null && $wlCurrent !== null) {
            $bankDiff = round($minBank - $wlCurrent, 2);
        }

        $trend = 'คงที่';
        if ($wlCurrent !== null && $wlPrev !== null) {
            $delta = $wlCurrent - $wlPrev;
            if ($delta > 0.01) $trend = 'เพิ่มขึ้น';
            elseif ($delta < -0.01) $trend = 'ลดลง';
        }

        $sitLevel = (int)($item['situation_level'] ?? 0);
        $storagePct = parse_float_or_null($item['storage_percent'] ?? null);

        // Match ThaiWater WL SCALE + lampang.thaiwater.net/wl + historical DB values
        $status = 'น้ำปกติ';
        if ($wlCurrent === null && $sitLevel === 0) {
            $status = 'ไม่มีข้อมูล';
        } elseif (($bankDiff !== null && $bankDiff <= 0) || $sitLevel === 5 || ($storagePct !== null && $storagePct > 100)) {
            $status = 'น้ำล้นตลิ่ง';
        } elseif ($sitLevel === 4 || ($sitLevel === 0 && $storagePct !== null && $storagePct > 70)) {
            $status = 'น้ำมาก';
        } elseif ($sitLevel === 1 || ($sitLevel === 0 && $storagePct !== null && $storagePct <= 10)) {
            $status = 'น้ำน้อยวิกฤต';
        } elseif ($sitLevel === 2 || ($sitLevel === 0 && $storagePct !== null && $storagePct <= 30)) {
            $status = 'น้ำน้อย';
        }

        $subKey = "{$tumbon}_{$amphoeClean}";
        $currentRain = null;
        if (isset($rain24Result['subdistrictRainAvg'][$subKey])) {
            $currentRain = round($rain24Result['subdistrictRainAvg'][$subKey], 2);
        } elseif ($amphoeClean !== '' && isset($rain24Result['districtRainAvg'][$amphoeClean])) {
            $currentRain = round($rain24Result['districtRainAvg'][$amphoeClean], 2);
        }

        // Legacy slot `forecast_rain_24h_mm` holds 3-day accumulated rainfall from rain3d API
        $forecastRain3d = null;
        if (isset($rain3dResult['subdistrictRain3dAvg'][$subKey])) {
            $forecastRain3d = $rain3dResult['subdistrictRain3dAvg'][$subKey];
        } elseif ($amphoeClean !== '' && isset($rain3dResult['districtRain3dAvg'][$amphoeClean])) {
            $forecastRain3d = $rain3dResult['districtRain3dAvg'][$amphoeClean];
        }

        $riskLevel = $currentRain === null ? 'ไม่มีข้อมูลฝน' : 'ปกติ';
        if ($currentRain !== null) {
            if ($currentRain > 90) $riskLevel = 'วิกฤตสีแดง';
            elseif ($currentRain > 35) $riskLevel = 'เฝ้าระวัง';
        }

        $dtRaw = trim((string)($item['waterlevel_datetime'] ?? ''));
        $observations[] = [
            'station' => $stationName,
            'datetime' => $dtRaw,
            'ts' => parse_upstream_datetime($dtRaw),
            'value' => $wlCurrent
        ];

        $rows[] = [
            'station_name'          => mb_substr($stationName, 0, 150),
            'river'                 => mb_substr($river, 0, 100),
            'amphoe'                => mb_substr($amphoeOut, 0, 100),
            'province'              => mb_substr($province, 0, 50),
            'current_water_level_m' => $wlCurrent,
            'left_bank_level_m'     => $minBank,
            'bank_difference_m'     => $bankDiff,
            'trend'                 => $trend,
            'status'                => $status,
            'current_rain_mm'       => $currentRain,
            'forecast_rain_24h_mm'  => $forecastRain3d,
            'risk_level'            => $riskLevel
        ];
    }

    return [
        'rows' => $rows,
        'observations' => $observations
    ];
}

/**
 * 3. Transform ThaiWater30 provinces/dam?province_code=52 JSON (36 dams in Lampang).
 *
 * @return array{rows:array, observations:array}
 */
function transform_drought_items(array $json, ?int $nowTs = null): array {
    if ($nowTs === null) $nowTs = time();
    $data = $json['data'] ?? [];
    $thaiDate = transform_thai_date($nowTs);

    $rows = [];
    $seenDams = [];
    $observations = [];

    foreach (($data['dam_daily'] ?? []) as $item) {
        $pc = (string)($item['geocode']['province_code'] ?? '');
        $pn = (string)($item['geocode']['province_name']['th'] ?? '');
        if ($pc !== '52' && mb_strpos($pn, 'ลำปาง') === false) continue;

        $rawName = trim((string)($item['dam']['dam_name']['th'] ?? ''));
        if ($rawName === '') continue;
        $damName = (mb_strpos($rawName, 'อ่าง') === 0) ? $rawName : 'อ่าง' . $rawName;
        if (isset($seenDams[$damName])) continue;
        $seenDams[$damName] = true;

        $pctVal = parse_float_or_null($item['dam_storage_percent'] ?? null);
        $dtRaw = trim((string)($item['dam_date'] ?? ''));
        $observations[] = [
            'station' => $damName,
            'datetime' => $dtRaw,
            'ts' => parse_upstream_datetime($dtRaw),
            'value' => parse_float_or_null($item['dam_storage'] ?? null)
        ];

        $rows[] = [
            'record_date'        => $thaiDate,
            'dam_type'           => 'อ่างขนาดใหญ่',
            'dam_name'           => mb_substr($damName, 0, 100),
            'capacity_m_cum'     => parse_float_or_null($item['dam']['normal_storage'] ?? ($item['dam_storage_cap'] ?? null)),
            'inflow_m_cum'       => parse_float_or_null($item['dam_inflow'] ?? null),
            'water_volume_m_cum' => parse_float_or_null($item['dam_storage'] ?? null),
            'water_percent'      => $pctVal !== null ? round($pctVal) . '%' : '-',
            'usable_water_m_cum' => parse_float_or_null($item['dam_uses_water'] ?? null),
            'discharge_m_cum'    => parse_float_or_null($item['dam_released'] ?? null)
        ];
    }

    foreach (($data['dam_medium'] ?? []) as $item) {
        $pc = (string)($item['geocode']['province_code'] ?? '');
        $pn = (string)($item['geocode']['province_name']['th'] ?? '');
        if ($pc !== '52' && mb_strpos($pn, 'ลำปาง') === false) continue;

        $damName = trim((string)($item['dam']['dam_name']['th'] ?? ''));
        if ($damName === '' || $damName === 'แม่มอก' || isset($seenDams[$damName])) continue;

        $vol = parse_float_or_null($item['dam_storage'] ?? null);
        $pctVal = parse_float_or_null($item['dam_storage_percent'] ?? null);
        if ($vol === null && $pctVal === null) continue;

        $seenDams[$damName] = true;
        $dtRaw = trim((string)($item['dam_date'] ?? ''));
        $observations[] = [
            'station' => $damName,
            'datetime' => $dtRaw,
            'ts' => parse_upstream_datetime($dtRaw),
            'value' => $vol
        ];

        $rows[] = [
            'record_date'        => $thaiDate,
            'dam_type'           => 'อ่างขนาดกลาง',
            'dam_name'           => mb_substr($damName, 0, 100),
            'capacity_m_cum'     => parse_float_or_null($item['dam']['normal_storage'] ?? null),
            'inflow_m_cum'       => parse_float_or_null($item['dam_inflow'] ?? null),
            'water_volume_m_cum' => $vol,
            'water_percent'      => $pctVal !== null ? round($pctVal) . '%' : '-',
            'usable_water_m_cum' => parse_float_or_null($item['dam_uses_water'] ?? null),
            'discharge_m_cum'    => parse_float_or_null($item['dam_released'] ?? null)
        ];
    }

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
        $dtRaw = trim((string)($item['smalldam_datetime'] ?? ''));
        $observations[] = [
            'station' => $damName,
            'datetime' => $dtRaw,
            'ts' => parse_upstream_datetime($dtRaw),
            'value' => $vol
        ];

        $rows[] = [
            'record_date'        => $thaiDate,
            'dam_type'           => 'อ่างขนาดเล็ก',
            'dam_name'           => mb_substr($damName, 0, 100),
            'capacity_m_cum'     => parse_float_or_null($item['dam']['normal_storage'] ?? ($item['dam_storage_cap'] ?? null)),
            'inflow_m_cum'       => null,
            'water_volume_m_cum' => $vol,
            'water_percent'      => $pctVal !== null ? round($pctVal) . '%' : '-',
            'usable_water_m_cum' => null,
            'discharge_m_cum'    => null
        ];
    }

    return [
        'rows' => $rows,
        'observations' => $observations
    ];
}

/**
 * 4. Transform ThaiWater30 public/thaiwater/weather JSON for PM 2.5 (province_code=52).
 * Keeps pm25_avg_24h strictly null when station does not report a 24h average.
 *
 * @return array{rows:array, observations:array}
 */
function transform_pm25_items(array $json, ?int $nowTs = null): array {
    if ($nowTs === null) $nowTs = time();
    $items = $json['pm25']['data'] ?? [];
    $thaiDate = transform_thai_date($nowTs);

    $rows = [];
    $seenStations = [];
    $observations = [];

    foreach ($items as $item) {
        $pc = (string)($item['geocode']['province_code'] ?? '');
        $pn = (string)($item['geocode']['province_name']['th'] ?? '');
        if ($pc !== '52' && mb_strpos($pn, 'ลำปาง') === false) continue;

        $stationName = trim((string)($item['station']['tele_station_name']['th'] ?? ''));
        if ($stationName === '' || isset($seenStations[$stationName])) continue;
        $seenStations[$stationName] = true;

        $tambon = trim((string)($item['geocode']['tumbon_name']['th'] ?? ''));
        $amphoeRaw = trim((string)($item['geocode']['amphoe_name']['th'] ?? ''));
        $amphoe = format_lampang_amphoe($amphoeRaw);
        if ($amphoe === '') $amphoe = 'อำเภอเมืองลำปาง';

        $dtRaw = trim((string)($item['pm25_datetime'] ?? ''));
        $timeLabel = (strlen($dtRaw) >= 16) ? substr($dtRaw, 11, 5) . ' น.' : date('H:i', $nowTs) . ' น.';

        $pmVal = parse_float_or_null($item['pm25_value'] ?? null);
        // Faithfully preserve null if upstream API does not provide a 24h rolling average
        $pmAvg = parse_float_or_null($item['pm25_avg_24h'] ?? null);
        if ($pmVal === null) continue;

        $status = 'ไม่ทราบค่า';
        if ($pmVal <= 15.0) $status = 'ดีมาก';
        elseif ($pmVal <= 25.0) $status = 'ดี';
        elseif ($pmVal <= 37.5) $status = 'ปานกลาง';
        elseif ($pmVal <= 75.0) $status = 'เริ่มมีผลต่อสุขภาพ';
        else $status = 'มีผลกระทบต่อสุขภาพ';

        $observations[] = [
            'station' => $stationName,
            'datetime' => $dtRaw,
            'ts' => parse_upstream_datetime($dtRaw),
            'value' => $pmVal
        ];

        $rows[] = [
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

    return [
        'rows' => $rows,
        'observations' => $observations
    ];
}

/**
 * Compute Lampang PAO agency classification without mislabeling non-PAO tickets.
 */
function compute_traffy_agency_status(string $orgName, string $stateName): string {
    $isPao = (mb_strpos($orgName, 'อบจ.ลำปาง') !== false || mb_strpos($orgName, 'องค์การบริหารส่วนจังหวัดลำปาง') !== false);
    if (mb_strpos($stateName, 'รอรับเรื่อง') !== false) {
        return $isPao ? 'งานที่รับเรื่องร้องเรียน' : 'หน่วยงานอื่นรอรับเรื่อง';
    }
    if (mb_strpos($stateName, 'ส่งต่อ') !== false) {
        return $isPao ? 'งานส่งต่อ' : 'ส่งต่อให้หน่วยงานอื่นดำเนินการ';
    }
    if (mb_strpos($stateName, 'เสร็จสิ้น') !== false) {
        return $isPao ? 'งานที่ อบจ.ดำเนินการเสร็จ' : 'หน่วยงานอื่นดำเนินการเสร็จ';
    }
    if (mb_strpos($stateName, 'กำลังดำเนินการ') !== false || mb_strpos($stateName, 'ถูกติดตาม') !== false) {
        return $isPao ? 'งานที่ อบจ.กำลังดำเนินการ' : 'หน่วยงานอื่นกำลังดำเนินการ';
    }
    if (mb_strpos($stateName, 'รับมอบ') !== false) {
        return $isPao ? 'สถานะรับมอบจากหน่วยงานอื่นๆ' : 'สถานะที่หน่วยงานรับมอบจาก อบจ.ลำปาง';
    }
    return $isPao ? 'งานที่เป็นสถานะอื่นๆ' : 'สถานะอื่นๆ ของหน่วยงาน';
}

/**
 * 5. Transform Traffy GeoJSON (features[]) OR PostgREST feed rows ([...]) into normalized complaints.
 */
function transform_traffy_complaints(array $json, int $limit = 60): array {
    $isGeoJson = isset($json['features']) && is_array($json['features']);
    $items = $isGeoJson ? $json['features'] : (array_values($json));
    $prepared = [];
    $seenTickets = [];

    foreach ($items as $f) {
        if (!is_array($f)) continue;
        $props = ($isGeoJson && isset($f['properties']) && is_array($f['properties'])) ? $f['properties'] : $f;

        $orgName = '';
        if (!empty($props['org']) && is_array($props['org'])) {
            $orgName = implode(', ', array_filter(array_map('trim', $props['org'])));
        } elseif (!empty($props['org_action']) && is_array($props['org_action'])) {
            $orgName = implode(', ', array_filter(array_map('trim', $props['org_action'])));
        } elseif (!empty($props['fd_reported_tos']) && is_array($props['fd_reported_tos'])) {
            $orgNames = [];
            foreach ($props['fd_reported_tos'] as $oItem) {
                if (is_array($oItem) && !empty($oItem['name'])) $orgNames[] = trim((string)$oItem['name']);
                elseif (is_string($oItem)) $orgNames[] = trim($oItem);
            }
            $orgName = implode(', ', array_filter($orgNames));
        } elseif (!empty($props['org_name'])) {
            $orgName = trim((string)$props['org_name']);
        }
        if ($orgName === '') $orgName = 'อบจ.ลำปาง';

        $province = trim((string)($props['province'] ?? ''));
        $address  = trim((string)($props['address'] ?? ''));
        $district = trim((string)($props['district'] ?? ''));
        $combinedGeo = $province . ' ' . $address . ' ' . $district . ' ' . $orgName;
        if (mb_strpos($combinedGeo, 'ลำปาง') === false) {
            continue;
        }

        $ticketId = trim((string)($props['ticket_id'] ?? ($props['ticket_id_main'] ?? ($props['id'] ?? ''))));
        if ($ticketId === '' || isset($seenTickets[$ticketId])) continue;
        $seenTickets[$ticketId] = true;

        $stateName = trim((string)($props['state'] ?? ($props['state_name'] ?? ($props['state_type_latest'] ?? ($props['issue_status_name'] ?? 'รอรับเรื่อง')))));
        if ($stateName === '') $stateName = 'รอรับเรื่อง';

        $problemType = 'ทั่วไป';
        if (!empty($props['problem_type_abdul']) && is_array($props['problem_type_abdul'])) {
            $firstType = trim((string)($props['problem_type_abdul'][0] ?? ''));
            if ($firstType !== '') $problemType = $firstType;
        } elseif (!empty($props['issue_category_name'])) {
            $problemType = trim((string)$props['issue_category_name']);
        } elseif (!empty($props['type']) && is_string($props['type'])) {
            $cleanType = trim($props['type'], "{} \t\n\r");
            if ($cleanType !== '') $problemType = explode(',', $cleanType)[0];
        }

        $desc = trim((string)($props['description'] ?? ''));
        $photoUrl = trim((string)($props['photo_url'] ?? ($props['after_photo'] ?? ($props['photo'] ?? ''))));
        $timestampStr = trim((string)($props['timestamp'] ?? ($props['last_activity'] ?? '')));
        $stars = isset($props['star']) && $props['star'] !== null && $props['star'] !== '' ? '⭐ ' . $props['star'] : '';
        $fullLoc = $address !== '' ? $address : trim("{$district} {$province}");

        $prepared[] = [
            'ticket_id'          => mb_substr($ticketId, 0, 50),
            'state_name'         => mb_substr($stateName, 0, 100),
            'problem_type'       => mb_substr($problemType, 0, 150),
            'description'        => $desc,
            'photo_url'          => $photoUrl,
            'location'           => $fullLoc,
            'org_name'           => $orgName,
            'ticket_datetime'    => mb_substr($timestampStr, 0, 100),
            'satisfaction_stars' => mb_substr($stars, 0, 50),
            'is_in_scope'        => 1
        ];

        if (count($prepared) >= $limit) break;
    }

    return $prepared;
}

/**
 * Normalize rows submitted directly from the Chrome Extension (04ext_TraffyLP).
 */
function normalize_traffy_extension_rows(array $rows): array {
    $prepared = [];
    $seen = [];
    foreach ($rows as $row) {
        if (!is_array($row)) continue;
        $ticketId = trim((string)($row['ticket_id'] ?? ''));
        if ($ticketId === '' || strlen($ticketId) > 50 || isset($seen[$ticketId])) continue;
        $seen[$ticketId] = true;

        $stateName = trim((string)($row['state_name'] ?? 'รอรับเรื่อง')) ?: 'รอรับเรื่อง';
        $orgName = trim((string)($row['org_name'] ?? 'อบจ.ลำปาง')) ?: 'อบจ.ลำปาง';

        $prepared[] = [
            'ticket_id'          => mb_substr($ticketId, 0, 50),
            'state_name'         => mb_substr($stateName, 0, 100),
            'problem_type'       => mb_substr(trim((string)($row['problem_type'] ?? 'ทั่วไป')) ?: 'ทั่วไป', 0, 150),
            'description'        => trim((string)($row['description'] ?? '')),
            'photo_url'          => trim((string)($row['photo_url'] ?? '')),
            'location'           => trim((string)($row['location'] ?? '')),
            'org_name'           => $orgName,
            'ticket_datetime'    => mb_substr(trim((string)($row['ticket_datetime'] ?? '')), 0, 100),
            'satisfaction_stars' => mb_substr(trim((string)($row['satisfaction_stars'] ?? '')), 0, 50),
            'is_in_scope'        => isset($row['is_in_scope']) ? (int)$row['is_in_scope'] : 1
        ];
    }
    return $prepared;
}

/**
 * Scrub Thai Citizen IDs, phone numbers, email addresses, LINE IDs, and HTML tags.
 */
function transform_scrub_pii_text(string $text, int $maxLen = 200): string {
    $clean = strip_tags($text);
    $clean = preg_replace('/\s+/u', ' ', trim($clean));
    if ($clean === '') return '';

    $clean = preg_replace('/(?<!\d)\d{1}[-\s]?\d{4}[-\s]?\d{5}[-\s]?\d{2}[-\s]?\d(?!\d)/u', '[สงวนเลขบัตร]', $clean);
    $clean = preg_replace('/(?<!\d)\d{13}(?!\d)/u', '[สงวนเลขบัตร]', $clean);
    $clean = preg_replace('/(?<!\d)(?:\+66|0)[2689](?:[-.\s]?\d){7,8}(?!\d)/u', '[สงวนเบอร์โทร]', $clean);
    $clean = preg_replace('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', '[สงวนอีเมล]', $clean);
    $clean = preg_replace('/https?:\/\/line\.me\/\S+/i', '[สงวนลิงก์ไลน์]', $clean);
    $clean = preg_replace('/(?:line\s*(?:id)?|ไอดีไลน์|ไลน์)\s*[:=@]?\s*[a-zA-Z0-9._\-]{3,}/iu', '[สงวนไอดีไลน์]', $clean);

    if (mb_strlen($clean, 'UTF-8') > $maxLen) {
        return mb_substr($clean, 0, $maxLen - 3, 'UTF-8') . '...';
    }
    return $clean;
}

/**
 * Redact PII inside Traffy complaint arrays before storing into public cloud_snapshots or serving fallback JSON.
 */
function sanitize_traffy_rows_zero_pii(array $rows): array {
    $out = [];
    foreach ($rows as $r) {
        if (!is_array($r)) continue;
        $copy = $r;
        $copy['description'] = transform_scrub_pii_text((string)($r['description'] ?? ''), 240);
        $copy['location']    = transform_scrub_pii_text((string)($r['location'] ?? ''), 150);
        unset($copy['raw_timeline'], $copy['reporter_phone'], $copy['reporter_email'], $copy['reporter_name']);
        $out[] = $copy;
    }
    return $out;
}
