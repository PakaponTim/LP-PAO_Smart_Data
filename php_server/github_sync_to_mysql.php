<?php
// =========================================================================
// Water_System2 (Port 7000) — Automatic Cloud-to-MySQL Snapshot Importer
// Syncs snapshots collected by GitHub Actions (while your PC was turned off)
// into local MySQL database `water_system2` without duplicates!
// =========================================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/collectors.php';

function import_single_snapshot_to_mysql(PDO $pdo, array $snap): array {
    ensure_ingest_tables($pdo);
    $snapId = trim((string)($snap['snapshot_id'] ?? ''));
    if ($snapId === '') {
        return ['imported' => false, 'reason' => 'missing_snapshot_id'];
    }

    $batchKey = "cloud_sync:{$snapId}";
    $chk = $pdo->prepare("SELECT batch_id FROM app_ingest_batches WHERE batch_id = ? LIMIT 1");
    $chk->execute([$batchKey]);
    if ($chk->fetch()) {
        return ['imported' => false, 'reason' => 'already_imported', 'batch_id' => $batchKey];
    }

    $recordedAt = $snap['recorded_at'] ?? date('Y-m-d H:i:s');
    $thaiDate   = $snap['thai_date'] ?? format_thai_date(strtotime($recordedAt));

    $counts = [
        'rainfall'   => 0,
        'water'      => 0,
        'drought'    => 0,
        'pm25'       => 0,
        'complaints' => 0
    ];

    $pdo->beginTransaction();
    try {
        // 1. Rainfall
        if (!empty($snap['rainfall']) && is_array($snap['rainfall'])) {
            $stmt = $pdo->prepare("INSERT INTO tbl_rainfall_monitoring
                (station_name, location, river_basin, rain_mm, rain_status, measured_time, record_date, recorded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
            foreach ($snap['rainfall'] as $r) {
                $stmt->execute([
                    $r['station_name'] ?? '',
                    $r['location'] ?? '',
                    $r['river_basin'] ?? '',
                    $r['rain_mm'] ?? 0,
                    $r['rain_status'] ?? 'ไม่มีฝน',
                    $r['measured_time'] ?? '',
                    $r['record_date'] ?? $thaiDate,
                    $recordedAt
                ]);
                $counts['rainfall']++;
            }
        }

        // 2. Water Level
        if (!empty($snap['water']) && is_array($snap['water'])) {
            $stmt = $pdo->prepare("INSERT INTO tbl_water_disaster_monitoring
                (station_name, river, amphoe, province, current_water_level_m, left_bank_level_m, bank_difference_m, trend, status, current_rain_mm, forecast_rain_24h_mm, risk_level, recorded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            foreach ($snap['water'] as $r) {
                $stmt->execute([
                    $r['station_name'] ?? '',
                    $r['river'] ?? '-',
                    $r['amphoe'] ?? 'ลำปาง',
                    $r['province'] ?? 'ลำปาง',
                    $r['current_water_level_m'] ?? null,
                    $r['left_bank_level_m'] ?? null,
                    $r['bank_difference_m'] ?? null,
                    $r['trend'] ?? 'คงที่',
                    $r['status'] ?? 'ปกติ',
                    $r['current_rain_mm'] ?? null,
                    $r['forecast_rain_24h_mm'] ?? null,
                    $r['risk_level'] ?? 'ปกติ',
                    $recordedAt
                ]);
                $counts['water']++;
            }
        }

        // 3. Drought / Dams
        if (!empty($snap['drought']) && is_array($snap['drought'])) {
            $stmt = $pdo->prepare("INSERT INTO tbl_drought_monitoring
                (record_date, dam_type, dam_name, capacity_m_cum, inflow_m_cum, water_volume_m_cum, water_percent, usable_water_m_cum, discharge_m_cum, recorded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            foreach ($snap['drought'] as $r) {
                $stmt->execute([
                    $r['record_date'] ?? $thaiDate,
                    $r['dam_type'] ?? 'อ่างขนาดกลาง',
                    $r['dam_name'] ?? '',
                    $r['capacity_m_cum'] ?? null,
                    $r['inflow_m_cum'] ?? null,
                    $r['water_volume_m_cum'] ?? null,
                    $r['water_percent'] ?? '-',
                    $r['usable_water_m_cum'] ?? null,
                    $r['discharge_m_cum'] ?? null,
                    $recordedAt
                ]);
                $counts['drought']++;
            }
        }

        // 4. PM 2.5
        if (!empty($snap['pm25']) && is_array($snap['pm25'])) {
            $stmt = $pdo->prepare("INSERT INTO tbl_pm25_monitoring
                (record_date, station_name, tambon, amphoe, province, time_label, pm25_value, pm25_avg_24h, air_quality_status, recorded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            foreach ($snap['pm25'] as $r) {
                $stmt->execute([
                    $r['record_date'] ?? $thaiDate,
                    $r['station_name'] ?? '',
                    $r['tambon'] ?? '',
                    $r['amphoe'] ?? '',
                    $r['province'] ?? 'ลำปาง',
                    $r['time_label'] ?? '',
                    $r['pm25_value'] ?? null,
                    $r['pm25_avg_24h'] ?? null,
                    $r['air_quality_status'] ?? 'ดีมาก',
                    $recordedAt
                ]);
                $counts['pm25']++;
            }
        }

        // 5. Complaints
        if (!empty($snap['complaints']) && is_array($snap['complaints'])) {
            $upsertStmt = $pdo->prepare("INSERT INTO tbl_complaints_monitoring
                (ticket_id, state_name, problem_type, description, photo_url, location, org_name, ticket_datetime, satisfaction_stars, is_in_scope, agency_status, recorded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    state_name = VALUES(state_name),
                    problem_type = VALUES(problem_type),
                    description = VALUES(description),
                    photo_url = VALUES(photo_url),
                    location = VALUES(location),
                    org_name = VALUES(org_name),
                    ticket_datetime = VALUES(ticket_datetime),
                    satisfaction_stars = VALUES(satisfaction_stars),
                    is_in_scope = VALUES(is_in_scope),
                    agency_status = VALUES(agency_status),
                    recorded_at = VALUES(recorded_at)");

            foreach ($snap['complaints'] as $r) {
                $org = $r['org_name'] ?? 'อบจ.ลำปาง';
                $st  = $r['state_name'] ?? 'รอรับเรื่อง';
                $isPao = (mb_strpos($org, 'อบจ.ลำปาง') !== false || mb_strpos($org, 'องค์การบริหารส่วนจังหวัดลำปาง') !== false);
                $agency = $isPao ? 'งานที่เป็นสถานะอื่นๆ' : 'สถานะอื่นๆ ของหน่วยงาน';
                if (mb_strpos($st, 'รอรับเรื่อง') !== false) $agency = $isPao ? 'งานที่รับเรื่องร้องเรียน' : 'อบจ.รับมอบหมายงาน';
                elseif (mb_strpos($st, 'ส่งต่อ') !== false) $agency = $isPao ? 'งานส่งต่อ' : 'ส่งต่อให้หน่วยงานอื่นดำเนินการ';
                elseif (mb_strpos($st, 'เสร็จสิ้น') !== false) $agency = $isPao ? 'งานที่ อบจ.ดำเนินการเสร็จ' : 'หน่วยงานอื่นดำเนินการเสร็จ';
                elseif (mb_strpos($st, 'กำลังดำเนินการ') !== false || mb_strpos($st, 'ถูกติดตาม') !== false) $agency = $isPao ? 'งานที่ อบจ.กำลังดำเนินการ' : 'หน่วยงานอื่นกำลังดำเนินการ';
                elseif (mb_strpos($st, 'รับมอบ') !== false) $agency = $isPao ? 'สถานะรับมอบจากหน่วยงานอื่นๆ' : 'สถานะที่หน่วยงานรับมอบจาก อบจ.ลำปาง';

                $upsertStmt->execute([
                    $r['ticket_id'] ?? '',
                    $st,
                    $r['problem_type'] ?? 'ทั่วไป',
                    $r['description'] ?? '',
                    $r['photo_url'] ?? '',
                    $r['location'] ?? '',
                    $org,
                    $r['ticket_datetime'] ?? '',
                    $r['satisfaction_stars'] ?? '',
                    $r['is_in_scope'] ?? 1,
                    $agency,
                    $recordedAt
                ]);
                $counts['complaints']++;
            }
        }

        // Record batch in ledger so it is never imported twice
        $totalRows = array_sum($counts);
        $fp = hash('sha256', $snapId . ':' . $recordedAt . ':' . $totalRows);
        $batchStmt = $pdo->prepare("INSERT INTO app_ingest_batches (batch_id, kind, fingerprint, row_count) VALUES (?, 'cloud_sync', ?, ?)");
        $batchStmt->execute([$batchKey, $fp, $totalRows]);

        $pdo->commit();
        return [
            'imported' => true,
            'snapshot_id' => $snapId,
            'recorded_at' => $recordedAt,
            'counts' => $counts
        ];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

function sync_github_snapshots_to_mysql(): array {
    $pdo = get_db();
    ensure_ingest_tables($pdo);

    $baseDir = WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR . 'cloud_snapshots';
    if (!is_dir($baseDir)) {
        @mkdir($baseDir, 0777, true);
    }

    // Step 1: If git is available and remote origin is configured, try a fast git pull on cloud_snapshots
    $gitExe = 'C:\laragon\bin\git\bin\git.exe';
    if (file_exists($gitExe) && is_dir(WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR . '.git')) {
        $cmd = '"' . $gitExe . '" -C "' . WATER_SYSTEM2_ROOT . '" pull --rebase --autostash origin main 2>&1';
        @exec($cmd, $outLines, $retCode);
    }

    // Step 2: Optional remote GitHub repo fetch via GITHUB_SYNC_REPO (e.g. "username/Water_System2")
    $ghRepo = env_val('GITHUB_SYNC_REPO', '');
    $ghBranch = env_val('GITHUB_SYNC_BRANCH', 'main');
    $ghToken = env_val('GITHUB_SYNC_TOKEN', '');
    if ($ghRepo !== '') {
        try {
            $headers = [];
            if ($ghToken !== '') $headers[] = "Authorization: token {$ghToken}";
            $rawBase = "https://raw.githubusercontent.com/{$ghRepo}/{$ghBranch}/cloud_snapshots";
            $remoteManifest = http_get_json("{$rawBase}/manifest.json", $headers, 15);
            if (!empty($remoteManifest['snapshots']) && is_array($remoteManifest['snapshots'])) {
                foreach ($remoteManifest['snapshots'] as $sid => $meta) {
                    $relPath = $meta['path'] ?? '';
                    if ($relPath === '') continue;
                    $localFile = $baseDir . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relPath);
                    if (!file_exists($localFile)) {
                        $dir = dirname($localFile);
                        if (!is_dir($dir)) @mkdir($dir, 0777, true);
                        $snapData = http_get_json("{$rawBase}/{$relPath}", $headers, 20);
                        if (is_array($snapData)) {
                            file_put_contents($localFile, json_encode($snapData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
                        }
                    }
                }
            }
        } catch (Throwable $e) {
            // Ignore remote fetch errors if offline or not yet pushed
        }
    }

    // Step 3: Scan all local cloud_snapshots/*/*.json files and import any unimported snapshots into MySQL `water_system2`
    $files = glob($baseDir . DIRECTORY_SEPARATOR . '*' . DIRECTORY_SEPARATOR . 'snapshot_*.json') ?: [];
    sort($files);

    $importedList = [];
    $skippedCount = 0;

    foreach ($files as $file) {
        $raw = @file_get_contents($file);
        if (!$raw) continue;
        $snap = json_decode($raw, true);
        if (!is_array($snap)) continue;

        $res = import_single_snapshot_to_mysql($pdo, $snap);
        if (!empty($res['imported'])) {
            $importedList[] = $res;
            add_server_log('GitHubSync-7000', "☁️➡️🗄️ ซิงค์ข้อมูลย้อนหลังจาก GitHub Snapshot ({$res['recorded_at']}) เข้าฐานข้อมูล water_system2 สำเร็จ (น้ำ {$res['counts']['water']}, ฝน {$res['counts']['rainfall']}, เขื่อน {$res['counts']['drought']}, PM2.5 {$res['counts']['pm25']}, ร้องเรียน {$res['counts']['complaints']})");
        } else {
            $skippedCount++;
        }
    }

    if (!empty($importedList)) {
        log_task_run('ซิงค์ข้อมูลจาก GitHub Actions (ขณะปิดเครื่อง)', 'db', 'success', count($importedList), 'นำเข้าข้อมูลย้อนหลัง ' . count($importedList) . ' รอบเวลา เข้าสู่ฐานข้อมูล water_system2 สำเร็จ');
    }

    return [
        'success' => true,
        'importedSnapshotsCount' => count($importedList),
        'alreadySyncedCount' => $skippedCount,
        'imported' => $importedList
    ];
}

if (PHP_SAPI === 'cli' && isset($argv[0]) && realpath($argv[0]) === __FILE__) {
    $res = sync_github_snapshots_to_mysql();
    echo "[GitHub-Sync] Imported: {$res['importedSnapshotsCount']} snapshots | Already synced: {$res['alreadySyncedCount']} snapshots\n";
}

