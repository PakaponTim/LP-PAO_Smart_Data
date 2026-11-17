<?php
// =========================================================================
// LP-PAO Smart Data (Port 7000) — Automatic Cloud-to-MySQL Snapshot Importer
// Syncs snapshots collected by GitHub Actions (while your PC was turned off)
// into local MySQL database `lp_pao_smart_data` without duplicates!
// =========================================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/collectors.php';
require_once __DIR__ . '/collectors_transform.php';
require_once __DIR__ . '/system_log.php';

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
                    $r['status'] ?? 'น้ำปกติ',
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
                $agency = compute_traffy_agency_status((string)$org, (string)$st);

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
            'imported'      => true,
            'snapshot_id'   => $snapId,
            'recorded_at'   => $recordedAt,
            'counts'        => $counts,
            'module_status' => $snap['module_status'] ?? null
        ];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

function sync_github_snapshots_to_mysql(int $maxImport = 0): array {
    $res = with_file_lock('github_sync', function () use ($maxImport) {
        return _sync_github_snapshots_to_mysql_locked($maxImport);
    }, true);
    if ($res === null) {
        return ['success' => true, 'skipped' => true, 'reason' => 'sync_already_running', 'importedSnapshotsCount' => 0, 'alreadySyncedCount' => 0, 'imported' => []];
    }
    return $res;
}

function _sync_github_snapshots_to_mysql_locked(int $maxImport = 0): array {
    $pdo = get_db();
    ensure_ingest_tables($pdo);

    $baseDir = LP_PAO_ROOT . DIRECTORY_SEPARATOR . 'cloud_snapshots';
    $cacheDir = LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'cloud_cache';
    if (!is_dir($cacheDir)) {
        @mkdir($cacheDir, 0777, true);
    }

    $ghRepo = env_val('GITHUB_SYNC_REPO', 'PakaponTim/LP-PAO_Smart_Data');
    $ghBranch = env_val('GITHUB_SYNC_BRANCH', 'main');
    $ghToken = env_val('GITHUB_SYNC_TOKEN', '');
    if ($ghRepo !== '') {
        try {
            $apiHeaders = ['Accept: application/vnd.github.raw+json'];
            $rawHeaders = [];
            if ($ghToken !== '') {
                $apiHeaders[] = "Authorization: token {$ghToken}";
                $rawHeaders[] = "Authorization: token {$ghToken}";
            }

            $fetchManifestFromRepo = function (string $repo) use ($ghBranch, $ghToken, $apiHeaders, $rawHeaders): array {
                $manifestUrl = "https://api.github.com/repos/{$repo}/contents/cloud_snapshots/manifest.json?ref=" . rawurlencode($ghBranch);
                $rawBase = "https://raw.githubusercontent.com/{$repo}/{$ghBranch}/cloud_snapshots";
                if ($ghToken === '') {
                    try {
                        $m = http_get_json("{$rawBase}/manifest.json?ts=" . time(), $rawHeaders, 12);
                    } catch (Throwable $e) {
                        $m = http_get_json($manifestUrl, $apiHeaders, 12);
                    }
                } else {
                    try {
                        $m = http_get_json($manifestUrl, $apiHeaders, 12);
                    } catch (Throwable $e) {
                        $m = http_get_json("{$rawBase}/manifest.json?ts=" . time(), $rawHeaders, 12);
                    }
                }
                return ['manifest' => $m, 'repo' => $repo, 'rawBase' => $rawBase];
            };

            try {
                $fetched = $fetchManifestFromRepo($ghRepo);
            } catch (Throwable $primaryErr) {
                if (strcasecmp($ghRepo, 'PakaponTim/LP-PAO_Smart_Data') === 0) {
                    $fetched = $fetchManifestFromRepo('PakaponTim/Water_System2');
                } else {
                    throw $primaryErr;
                }
            }
            $ghRepo = $fetched['repo'];
            $rawBase = $fetched['rawBase'];
            $remoteManifest = $fetched['manifest'];

            $downloaded = 0;
            if (!empty($remoteManifest['snapshots']) && is_array($remoteManifest['snapshots'])) {
                foreach ($remoteManifest['snapshots'] as $sid => $meta) {
                    $relPath = $meta['path'] ?? '';
                    if ($relPath === '') continue;
                    $relOs = str_replace('/', DIRECTORY_SEPARATOR, $relPath);
                    $gitFile = $baseDir . DIRECTORY_SEPARATOR . $relOs;
                    $cacheFile = $cacheDir . DIRECTORY_SEPARATOR . $relOs;
                    // Store downloaded snapshots in git-ignored runtime/cloud_cache so git pull --rebase never hits untracked file conflicts!
                    if (!file_exists($gitFile) && !file_exists($cacheFile)) {
                        if ($maxImport > 0 && $downloaded >= $maxImport) {
                            break;
                        }
                        $dir = dirname($cacheFile);
                        if (!is_dir($dir)) @mkdir($dir, 0777, true);
                        if ($ghToken === '') {
                            try {
                                $snapData = http_get_json("{$rawBase}/{$relPath}", $rawHeaders, 15);
                            } catch (Throwable $e) {
                                $snapData = http_get_json("https://api.github.com/repos/{$ghRepo}/contents/cloud_snapshots/{$relPath}?ref=" . rawurlencode($ghBranch), $apiHeaders, 15);
                            }
                        } else {
                            try {
                                $snapData = http_get_json("https://api.github.com/repos/{$ghRepo}/contents/cloud_snapshots/{$relPath}?ref=" . rawurlencode($ghBranch), $apiHeaders, 15);
                            } catch (Throwable $e) {
                                $snapData = http_get_json("{$rawBase}/{$relPath}", $rawHeaders, 15);
                            }
                        }
                        if (is_array($snapData)) {
                            file_put_contents($cacheFile, json_encode($snapData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
                            $downloaded++;
                        }
                    }
                }
            }
        } catch (Throwable $e) {
            sys_log_record([
                'module'         => 'github_sync',
                'action'         => 'Fetch Remote Manifest',
                'status'         => 'warning',
                'trigger_source' => 'github_sync',
                'row_count'      => 0,
                'summary'        => 'ไม่สามารถดึง manifest จาก GitHub ได้ชั่วคราว (ใช้ไฟล์แคชในเครื่องแทน)',
                'error_detail'   => $e->getMessage(),
            ]);
        }
    }

    // Step 3: Scan both git cloud_snapshots/ and git-ignored runtime/cloud_cache/ cleanly
    $gitFiles = is_dir($baseDir) ? (glob($baseDir . DIRECTORY_SEPARATOR . '*' . DIRECTORY_SEPARATOR . 'snapshot_*.json') ?: []) : [];
    $cacheFiles = is_dir($cacheDir) ? (glob($cacheDir . DIRECTORY_SEPARATOR . '*' . DIRECTORY_SEPARATOR . 'snapshot_*.json') ?: []) : [];
    $files = array_merge($gitFiles, $cacheFiles);
    usort($files, function ($a, $b) {
        return strcmp(basename($a), basename($b));
    });

    $importedList = [];
    $skippedCount = 0;

    foreach ($files as $file) {
        if ($maxImport > 0 && count($importedList) >= $maxImport) {
            break;
        }
        $raw = @file_get_contents($file);
        if (!$raw) continue;
        $snap = json_decode($raw, true);
        if (!is_array($snap)) continue;

        $res = import_single_snapshot_to_mysql($pdo, $snap);
        if (!empty($res['imported'])) {
            $importedList[] = $res;
            $c = $res['counts'];
            $modStatus = $res['module_status'] ?? null;
            $hasModFail = false;
            $modNotes = [];
            if (is_array($modStatus)) {
                foreach ($modStatus as $mKey => $mInfo) {
                    if (empty($mInfo['ok'])) {
                        $hasModFail = true;
                        $modNotes[] = "{$mKey}: " . ($mInfo['error'] ?? 'ล้มเหลว');
                    }
                }
            }
            $slotHm = substr((string)$res['recorded_at'], 11, 5);
            add_server_log('GitHubSync-7000', "☁️➡️🗄️ ซิงค์ข้อมูลย้อนหลังจาก GitHub Snapshot ({$res['recorded_at']}) เข้าฐานข้อมูล lp_pao_smart_data สำเร็จ (น้ำ {$c['water']}, ฝน {$c['rainfall']}, เขื่อน {$c['drought']}, PM2.5 {$c['pm25']}, ร้องเรียน {$c['complaints']})");
            sys_log_record([
                'module'         => 'github_sync',
                'action'         => 'Import Cloud Snapshot',
                'status'         => $hasModFail ? 'partial' : 'success',
                'trigger_source' => 'github_sync',
                'scheduled_slot' => $slotHm,
                'started_at'     => $res['recorded_at'],
                'finished_at'    => date('Y-m-d H:i:s'),
                'row_count'      => array_sum($c),
                'summary'        => "ซิงค์ Snapshot {$res['snapshot_id']} (น้ำ {$c['water']}, ฝน {$c['rainfall']}, เขื่อน {$c['drought']}, PM2.5 {$c['pm25']}, ร้องเรียน {$c['complaints']})",
                'error_detail'   => $hasModFail ? implode(' | ', $modNotes) : null,
                'meta'           => ['snapshot_id' => $res['snapshot_id'], 'counts' => $c, 'module_status' => $modStatus],
            ]);
        } else {
            $skippedCount++;
        }
    }

    if (!empty($importedList)) {
        log_task_run('ซิงค์ข้อมูลจาก GitHub Actions (ขณะปิดเครื่อง)', 'db', 'success', count($importedList), 'นำเข้าข้อมูลย้อนหลัง ' . count($importedList) . ' รอบเวลา เข้าสู่ฐานข้อมูล lp_pao_smart_data สำเร็จ');
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

