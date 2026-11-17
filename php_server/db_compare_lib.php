<?php
// =========================================================================
// LP-PAO Smart Data — Live Database Comparator (water_systems vs lp_pao_smart_data)
// Compares schema, table row counts, freshness timestamps, and latest
// entity-by-entity fields across all 5 monitoring domains in 1 click.
// Strictly READ-ONLY against reference database (`water_systems`).
// =========================================================================

require_once __DIR__ . '/config.php';

function db_compare_normalize_key(string $s): string {
    $s = trim($s);
    $s = preg_replace('/\s+/u', ' ', $s);
    return mb_strtolower((string)$s, 'UTF-8');
}

function db_compare_values_equal($v1, $v2, string $type = 'text'): bool {
    if ($v1 === null && $v2 === null) return true;
    if ($v1 === null || $v2 === null) {
        // Distinguish null vs empty string for text, but NEVER treat null == 0 for numbers!
        if ($type === 'text') {
            return trim((string)$v1) === trim((string)$v2);
        }
        return false;
    }
    if ($type === 'number') {
        $s1 = trim((string)$v1);
        $s2 = trim((string)$v2);
        if ($s1 === '' && $s2 === '') return true;
        if ($s1 === '' || $s2 === '') return false;
        if (is_numeric($s1) && is_numeric($s2)) {
            return abs((float)$s1 - (float)$s2) <= 0.015;
        }
        return $s1 === $s2;
    }
    $t1 = preg_replace('/\s+/u', ' ', trim((string)$v1));
    $t2 = preg_replace('/\s+/u', ' ', trim((string)$v2));
    return $t1 === $t2;
}

function db_compare_connect_reference(string $refDbName): array {
    $safeRef = preg_replace('/[^a-zA-Z0-9_]/', '', $refDbName) ?: 'water_systems';
    $host = env_val('DB_HOST', 'localhost');
    $port = (int)env_val('DB_PORT', 3306);
    $user = env_val('DB_USER', 'root');
    $pass = env_val('DB_PASS', 'root');

    try {
        $pdo = new PDO(
            "mysql:host={$host};port={$port};dbname={$safeRef};charset=utf8mb4",
            $user,
            $pass,
            [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]
        );
        return ['ok' => true, 'dbName' => $safeRef, 'pdo' => $pdo, 'error' => null];
    } catch (Throwable $e) {
        return ['ok' => false, 'dbName' => $safeRef, 'pdo' => null, 'error' => $e->getMessage()];
    }
}

function db_compare_fetch_latest_map(PDO $pdo, string $table, string $keyCol, array $cols, string $extraWhere = ''): array {
    $colSql = implode(', ', array_map(function ($c) { return "t.`{$c}`"; }, $cols));
    $whereClause = $extraWhere !== '' ? "WHERE {$extraWhere}" : '';
    $sql = "
        SELECT {$colSql}, t.`recorded_at`
        FROM `{$table}` t
        INNER JOIN (
            SELECT `{$keyCol}`, MAX(`id`) AS max_id
            FROM `{$table}`
            {$whereClause}
            GROUP BY `{$keyCol}`
        ) latest ON t.`id` = latest.max_id
    ";
    $rows = $pdo->query($sql)->fetchAll();
    $map = [];
    $latestTs = null;
    foreach ($rows as $r) {
        $rawKey = (string)($r[$keyCol] ?? '');
        $normKey = db_compare_normalize_key($rawKey);
        if ($normKey === '') continue;
        $map[$normKey] = $r;
        $rec = (string)($r['recorded_at'] ?? '');
        if ($rec !== '' && ($latestTs === null || $rec > $latestTs)) {
            $latestTs = $rec;
        }
    }
    return ['map' => $map, 'count' => count($map), 'latestAt' => $latestTs];
}

function db_compare_domain_specs(): array {
    return [
        'water' => [
            'label'      => 'ระดับน้ำ (Water Level)',
            'table'      => 'tbl_water_disaster_monitoring',
            'keyCol'     => 'station_name',
            'where'      => "station_name NOT LIKE '%Test%'",
            'fields'     => [
                ['col' => 'river',                'label' => 'แม่น้ำ/ลุ่มน้ำ', 'type' => 'text',   'core' => true],
                ['col' => 'amphoe',               'label' => 'อำเภอ',          'type' => 'text',   'core' => false],
                ['col' => 'current_water_level_m','label' => 'ระดับน้ำ (ม.)',  'type' => 'number', 'core' => true],
                ['col' => 'left_bank_level_m',    'label' => 'ตลิ่งซ้าย (ม.)', 'type' => 'number', 'core' => true],
                ['col' => 'bank_difference_m',    'label' => 'ต่างจากตลิ่ง',  'type' => 'number', 'core' => true],
                ['col' => 'trend',                'label' => 'แนวโน้ม',        'type' => 'text',   'core' => true],
                ['col' => 'status',               'label' => 'สถานะน้ำ',       'type' => 'text',   'core' => true],
                ['col' => 'current_rain_mm',      'label' => 'ฝนปัจจุบัน',     'type' => 'number', 'core' => false],
                ['col' => 'forecast_rain_24h_mm', 'label' => 'ฝนสะสม 3 วัน',   'type' => 'number', 'core' => false],
                ['col' => 'risk_level',           'label' => 'ระดับความเสี่ยง', 'type' => 'text',   'core' => false],
            ],
        ],
        'rainfall' => [
            'label'      => 'ปริมาณน้ำฝน (Rainfall)',
            'table'      => 'tbl_rainfall_monitoring',
            'keyCol'     => 'station_name',
            'where'      => "station_name NOT LIKE '%Test%'",
            'fields'     => [
                ['col' => 'location',      'label' => 'ที่ตั้ง',        'type' => 'text',   'core' => false],
                ['col' => 'river_basin',   'label' => 'ลุ่มน้ำ',        'type' => 'text',   'core' => false],
                ['col' => 'rain_mm',       'label' => 'ปริมาณฝน (มม.)','type' => 'number', 'core' => true],
                ['col' => 'rain_status',   'label' => 'สถานะฝน',       'type' => 'text',   'core' => true],
                ['col' => 'measured_time', 'label' => 'เวลาตรวจวัด',   'type' => 'text',   'core' => false],
            ],
        ],
        'drought' => [
            'label'      => 'อ่างเก็บน้ำ/ภัยแล้ง (Drought)',
            'table'      => 'tbl_drought_monitoring',
            'keyCol'     => 'dam_name',
            'where'      => "dam_name NOT LIKE '%Test%'",
            'fields'     => [
                ['col' => 'dam_type',          'label' => 'ประเภทอ่าง',    'type' => 'text',   'core' => true],
                ['col' => 'capacity_m_cum',    'label' => 'ความจุ (ล้าน ม³)','type' => 'number', 'core' => true],
                ['col' => 'water_volume_m_cum','label' => 'กักเก็บ (ล้าน ม³)','type' => 'number', 'core' => true],
                ['col' => 'water_percent',     'label' => '% ปริมาณน้ำ',   'type' => 'text',   'core' => true],
                ['col' => 'usable_water_m_cum','label' => 'ใช้การได้',     'type' => 'number', 'core' => false],
                ['col' => 'inflow_m_cum',      'label' => 'น้ำไหลเข้า',     'type' => 'number', 'core' => true],
                ['col' => 'discharge_m_cum',   'label' => 'ระบายออก',      'type' => 'number', 'core' => true],
            ],
        ],
        'pm25' => [
            'label'      => 'ฝุ่น PM 2.5',
            'table'      => 'tbl_pm25_monitoring',
            'keyCol'     => 'station_name',
            'where'      => "station_name NOT LIKE '%Test%'",
            'fields'     => [
                ['col' => 'tambon',             'label' => 'ตำบล',             'type' => 'text',   'core' => true],
                ['col' => 'amphoe',             'label' => 'อำเภอ',            'type' => 'text',   'core' => true],
                ['col' => 'pm25_value',         'label' => 'PM 2.5 รายชั่วโมง', 'type' => 'number', 'core' => true],
                ['col' => 'pm25_avg_24h',       'label' => 'PM 2.5 เฉลี่ย 24h','type' => 'number', 'core' => false],
                ['col' => 'air_quality_status', 'label' => 'คุณภาพอากาศ',      'type' => 'text',   'core' => true],
                ['col' => 'time_label',         'label' => 'เวลาตรวจวัด',      'type' => 'text',   'core' => false],
            ],
        ],
        'complaints' => [
            'label'      => 'เรื่องร้องเรียน Traffy',
            'table'      => 'tbl_complaints_monitoring',
            'keyCol'     => 'ticket_id',
            'where'      => "(is_in_scope = 1 OR is_in_scope IS NULL) AND ticket_id NOT LIKE '%TEST%'",
            'fields'     => [
                ['col' => 'state_name',     'label' => 'สถานะเรื่อง',    'type' => 'text', 'core' => true],
                ['col' => 'agency_status',  'label' => 'หมวดหน่วยงาน',   'type' => 'text', 'core' => true],
                ['col' => 'problem_type',   'label' => 'ประเภทปัญหา',    'type' => 'text', 'core' => true],
                ['col' => 'org_name',       'label' => 'หน่วยงานรับผิดชอบ','type' => 'text', 'core' => true],
                ['col' => 'ticket_datetime','label' => 'วันเวลาแจ้ง',     'type' => 'text', 'core' => false],
            ],
        ],
    ];
}

function compare_databases_full(string $refDbName = 'water_systems', string $domainFilter = 'all', bool $onlyDiff = false): array {
    $t0 = microtime(true);
    $pdoNew = get_db();
    $newDbName = env_val('DB_NAME', 'lp_pao_smart_data');

    $refConn = db_compare_connect_reference($refDbName);
    if (empty($refConn['ok']) || !($refConn['pdo'] instanceof PDO)) {
        return [
            'success'    => false,
            'refDbName'  => $refConn['dbName'],
            'newDbName'  => $newDbName,
            'error'      => "ไม่สามารถเชื่อมต่อฐานข้อมูลต้นแบบ `{$refConn['dbName']}`: " . ($refConn['error'] ?? 'ไม่พบฐานข้อมูล'),
        ];
    }
    /** @var PDO $pdoRef */
    $pdoRef = $refConn['pdo'];
    $refDb  = $refConn['dbName'];

    // 1. Table & Schema Comparison
    $refTables = $pdoRef->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
    $newTables = $pdoNew->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
    $allTables = array_values(array_unique(array_merge($refTables, $newTables)));
    sort($allTables);

    $tableComparisons = [];
    foreach ($allTables as $tbl) {
        $inRef = in_array($tbl, $refTables, true);
        $inNew = in_array($tbl, $newTables, true);

        $refRows = $inRef ? (int)$pdoRef->query("SELECT COUNT(*) FROM `{$tbl}`")->fetchColumn() : null;
        $newRows = $inNew ? (int)$pdoNew->query("SELECT COUNT(*) FROM `{$tbl}`")->fetchColumn() : null;

        $refCols = $inRef ? $pdoRef->query("SHOW COLUMNS FROM `{$tbl}`")->fetchAll(PDO::FETCH_COLUMN) : [];
        $newCols = $inNew ? $pdoNew->query("SHOW COLUMNS FROM `{$tbl}`")->fetchAll(PDO::FETCH_COLUMN) : [];

        $missingInNew = array_values(array_diff($refCols, $newCols));
        $extraInNew   = array_values(array_diff($newCols, $refCols));

        $refLatest = ($inRef && in_array('recorded_at', $refCols, true))
            ? ($pdoRef->query("SELECT MAX(recorded_at) FROM `{$tbl}`")->fetchColumn() ?: null)
            : (($inRef && in_array('created_at', $refCols, true)) ? ($pdoRef->query("SELECT MAX(created_at) FROM `{$tbl}`")->fetchColumn() ?: null) : null);
        $newLatest = ($inNew && in_array('recorded_at', $newCols, true))
            ? ($pdoNew->query("SELECT MAX(recorded_at) FROM `{$tbl}`")->fetchColumn() ?: null)
            : (($inNew && in_array('created_at', $newCols, true)) ? ($pdoNew->query("SELECT MAX(created_at) FROM `{$tbl}`")->fetchColumn() ?: null) : null);

        $lagMin = null;
        if ($refLatest && $newLatest) {
            $lagMin = (int)round((strtotime((string)$newLatest) - strtotime((string)$refLatest)) / 60);
        }

        $schemaStatus = 'matched';
        if (!$inRef) $schemaStatus = 'only_in_new';
        elseif (!$inNew) $schemaStatus = 'missing_in_new';
        elseif (!empty($missingInNew) || !empty($extraInNew)) $schemaStatus = 'col_diff';

        $tableComparisons[] = [
            'table'        => $tbl,
            'inRef'        => $inRef,
            'inNew'        => $inNew,
            'refRows'      => $refRows,
            'newRows'      => $newRows,
            'rowDiff'      => ($refRows !== null && $newRows !== null) ? ($newRows - $refRows) : null,
            'refLatestAt'  => $refLatest,
            'newLatestAt'  => $newLatest,
            'timeLagMin'   => $lagMin,
            'missingCols'  => $missingInNew,
            'extraCols'    => $extraInNew,
            'schemaStatus' => $schemaStatus,
        ];
    }

    // 2. Domain Entity-by-Entity Latest Snapshot Comparison
    $specs = db_compare_domain_specs();
    $domainsOut = [];
    $totalEntities = 0;
    $totalExactMatches = 0;
    $totalCoreMatches = 0;

    foreach ($specs as $dKey => $spec) {
        if ($domainFilter !== 'all' && $domainFilter !== $dKey) continue;
        $tbl = $spec['table'];
        if (!in_array($tbl, $refTables, true) || !in_array($tbl, $newTables, true)) {
            $domainsOut[$dKey] = [
                'domain'      => $dKey,
                'label'       => $spec['label'],
                'error'       => "ไม่พบตาราง `{$tbl}` ในฐานข้อมูลทั้งสองฝั่ง",
                'matchPct'    => 0,
                'coreMatchPct'=> 0,
                'items'       => [],
            ];
            continue;
        }

        $colNames = array_merge([$spec['keyCol']], array_map(function ($f) { return $f['col']; }, $spec['fields']));
        $refSet = db_compare_fetch_latest_map($pdoRef, $tbl, $spec['keyCol'], $colNames, $spec['where']);
        $newSet = db_compare_fetch_latest_map($pdoNew, $tbl, $spec['keyCol'], $colNames, $spec['where']);

        $allKeys = array_values(array_unique(array_merge(array_keys($refSet['map']), array_keys($newSet['map']))));
        sort($allKeys);

        $matchedEntities = 0;
        $coreMatchedEntities = 0;
        $mismatchedEntities = 0;
        $coreDiffEntities = 0;
        $onlyRefCount = 0;
        $onlyNewCount = 0;
        $items = [];
        $fieldDiffSummary = [];

        foreach ($allKeys as $k) {
            $rRef = $refSet['map'][$k] ?? null;
            $rNew = $newSet['map'][$k] ?? null;
            $displayKey = (string)(($rNew[$spec['keyCol']] ?? null) ?: ($rRef[$spec['keyCol']] ?? $k));
            $hasCoreDiff = false;

            if ($rRef && !$rNew) {
                $onlyRefCount++;
                $status = 'only_in_ref';
                $diffs = [];
            } elseif (!$rRef && $rNew) {
                $onlyNewCount++;
                $status = 'only_in_new';
                $diffs = [];
            } else {
                $diffs = [];
                foreach ($spec['fields'] as $f) {
                    $c = $f['col'];
                    $isCore = !empty($f['core']);
                    $v1 = $rRef[$c] ?? null;
                    $v2 = $rNew[$c] ?? null;
                    if (!db_compare_values_equal($v1, $v2, $f['type'])) {
                        if ($isCore) $hasCoreDiff = true;
                        $diffs[] = [
                            'col'   => $c,
                            'label' => $f['label'],
                            'core'  => $isCore,
                            'ref'   => $v1,
                            'new'   => $v2,
                        ];
                        $fieldDiffSummary[$c] = ($fieldDiffSummary[$c] ?? 0) + 1;
                    }
                }
                if (!$hasCoreDiff) {
                    $coreMatchedEntities++;
                } else {
                    $coreDiffEntities++;
                }
                if (empty($diffs)) {
                    $matchedEntities++;
                    $status = 'match';
                } else {
                    $mismatchedEntities++;
                    $status = 'diff';
                }
            }

            if ($onlyDiff && $status === 'match') {
                continue;
            }

            $items[] = [
                'key'         => $displayKey,
                'status'      => $status,
                'hasCoreDiff' => $hasCoreDiff,
                'refRecorded' => $rRef['recorded_at'] ?? null,
                'newRecorded' => $rNew['recorded_at'] ?? null,
                'refData'     => $rRef,
                'newData'     => $rNew,
                'diffs'       => $diffs,
            ];
        }

        $commonCount = $matchedEntities + $mismatchedEntities;
        $matchPct = $commonCount > 0 ? round(($matchedEntities / $commonCount) * 100, 1) : 0.0;
        $coreMatchPct = $commonCount > 0 ? round(($coreMatchedEntities / $commonCount) * 100, 1) : 0.0;
        $totalEntities += $commonCount;
        $totalExactMatches += $matchedEntities;
        $totalCoreMatches += $coreMatchedEntities;

        $domainsOut[$dKey] = [
            'domain'             => $dKey,
            'label'              => $spec['label'],
            'table'              => $tbl,
            'fields'             => $spec['fields'],
            'refCount'           => $refSet['count'],
            'newCount'           => $newSet['count'],
            'refLatestAt'        => $refSet['latestAt'],
            'newLatestAt'        => $newSet['latestAt'],
            'commonCount'        => $commonCount,
            'matchedCount'       => $matchedEntities,
            'coreMatchedCount'   => $coreMatchedEntities,
            'coreDiffCount'      => $coreDiffEntities,
            'mismatchedCount'    => $mismatchedEntities,
            'onlyInRefCount'     => $onlyRefCount,
            'onlyInNewCount'     => $onlyNewCount,
            'matchPct'           => $matchPct,
            'coreMatchPct'       => $coreMatchPct,
            'fieldDiffCounts'    => $fieldDiffSummary,
            'items'              => $items,
        ];
    }

    $overallMatchPct = $totalEntities > 0 ? round(($totalExactMatches / $totalEntities) * 100, 1) : 0.0;
    $overallCorePct  = $totalEntities > 0 ? round(($totalCoreMatches / $totalEntities) * 100, 1) : 0.0;

    return [
        'success'          => true,
        'comparedAt'       => date('Y-m-d H:i:s'),
        'elapsedMs'        => (int)round((microtime(true) - $t0) * 1000),
        'refDbName'        => $refDb,
        'newDbName'        => $newDbName,
        'overallMatchPct'  => $overallMatchPct,
        'overallCorePct'   => $overallCorePct,
        'totalCompared'    => $totalEntities,
        'totalMatched'     => $totalExactMatches,
        'totalCoreMatched' => $totalCoreMatches,
        'tables'           => $tableComparisons,
        'domains'          => $domainsOut,
    ];
}

function export_db_compare_csv(string $refDbName = 'water_systems'): string {
    $res = compare_databases_full($refDbName, 'all', false);
    $csv = "\xEF\xBB\xBF";
    if (empty($res['success'])) {
        $csv .= "Error," . str_replace('"', '""', (string)($res['error'] ?? 'Unknown')) . "\n";
        return $csv;
    }

    $csv .= "รายงานเปรียบเทียบฐานข้อมูล,{$res['refDbName']} vs {$res['newDbName']},เวลาเปรียบเทียบ,{$res['comparedAt']},ตรงกันรวม,{$res['overallMatchPct']}%\n\n";
    $csv .= "ด้านข้อมูล,สถานี/รหัสอ้างอิง,ผลเปรียบเทียบ,ฟิลด์ที่ไม่ตรง,ค่าฝั่ง {$res['refDbName']} (ตัวสมบูรณ์),ค่าฝั่ง {$res['newDbName']} (ตัวใหม่),เวลาบันทึกตัวเก่า,เวลาบันทึกตัวใหม่\n";

    foreach (($res['domains'] ?? []) as $dKey => $dInfo) {
        foreach (($dInfo['items'] ?? []) as $it) {
            if ($it['status'] === 'match') {
                $csv .= sprintf("\"%s\",\"%s\",\"ตรงกัน 100%%\",\"-\",\"-\",\"-\",\"%s\",\"%s\"\n",
                    $dInfo['label'], str_replace('"', '""', $it['key']),
                    $it['refRecorded'] ?? '', $it['newRecorded'] ?? ''
                );
            } elseif ($it['status'] === 'only_in_ref' || $it['status'] === 'only_in_new') {
                $lbl = $it['status'] === 'only_in_ref' ? "มีเฉพาะใน {$res['refDbName']}" : "มีเฉพาะใน {$res['newDbName']}";
                $csv .= sprintf("\"%s\",\"%s\",\"%s\",\"-\",\"-\",\"-\",\"%s\",\"%s\"\n",
                    $dInfo['label'], str_replace('"', '""', $it['key']), $lbl,
                    $it['refRecorded'] ?? '', $it['newRecorded'] ?? ''
                );
            } else {
                foreach ($it['diffs'] as $df) {
                    $csv .= sprintf("\"%s\",\"%s\",\"ค่าต่างกัน\",\"%s (%s)\",\"%s\",\"%s\",\"%s\",\"%s\"\n",
                        $dInfo['label'],
                        str_replace('"', '""', $it['key']),
                        str_replace('"', '""', $df['label']),
                        $df['col'],
                        str_replace('"', '""', $df['ref'] === null ? 'NULL' : (string)$df['ref']),
                        str_replace('"', '""', $df['new'] === null ? 'NULL' : (string)$df['new']),
                        $it['refRecorded'] ?? '',
                        $it['newRecorded'] ?? ''
                    );
                }
            }
        }
    }
    return $csv;
}
