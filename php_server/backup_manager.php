<?php
// =========================================================================
// Water_System2 — Disaster Recovery, Local DB Spool & Auto MySQL Backup
//   1) Local Disk Spool: buffers API rows on disk when MySQL is unreachable
//      and flushes automatically to MySQL via app_ingest_batches deduplication
//   2) Full MySQL Dump (.sql.gz): pure PHP PDO exporter across all 10 tables
//      (no exec()/mysqldump needed), with retention cleanup & SMTP off-site send
//   3) Cloud Snapshot Fallback Loader: serves latest GitHub/local snapshot
//      when MySQL is completely down
// =========================================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/collectors_transform.php';

function db_spool_dir(): string {
    $dir = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'db_spool';
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }
    return $dir;
}

function db_backup_dir(): string {
    $dir = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'backups';
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }
    return $dir;
}

function db_spool_count(): int {
    $files = glob(db_spool_dir() . DIRECTORY_SEPARATOR . 'spool_*.json');
    return is_array($files) ? count($files) : 0;
}

/**
 * Save transformed rows onto local disk when MySQL write fails temporarily.
 * Uses the exact same schema as github_sync_to_mysql::import_single_snapshot_to_mysql().
 */
function db_spool_enqueue_module(string $module, array $rows, ?string $recordedAt = null): array {
    $validModules = ['rainfall', 'water', 'drought', 'pm25', 'complaints'];
    if (!in_array($module, $validModules, true) || empty($rows)) {
        return ['spooled' => false, 'reason' => 'invalid_or_empty'];
    }

    $ts = time();
    $rec = $recordedAt ?: date('Y-m-d H:i:s', $ts);
    $snapId = 'spool_' . $module . '_' . date('Ymd_His', $ts) . '_' . substr(bin2hex(random_bytes(3)), 0, 6);

    $payload = [
        'snapshot_id' => $snapId,
        'recorded_at' => $rec,
        'thai_date'   => transform_thai_date($ts),
        'module'      => $module,
        'rainfall'    => $module === 'rainfall' ? $rows : [],
        'water'       => $module === 'water' ? $rows : [],
        'drought'     => $module === 'drought' ? $rows : [],
        'pm25'        => $module === 'pm25' ? $rows : [],
        'complaints'  => $module === 'complaints' ? $rows : [],
    ];

    $file = db_spool_dir() . DIRECTORY_SEPARATOR . $snapId . '.json';
    $ok = write_json_file($file, $payload);
    if ($ok) {
        add_server_log('DB-Spool', "💾 DB ขัดข้องชั่วคราว — พักข้อมูล [{$module}] (" . count($rows) . " แถว) ลงไฟล์ Spool {$snapId} เรียบร้อย");
    }

    return [
        'spooled' => $ok,
        'id'      => $snapId,
        'file'    => basename($file),
        'rows'    => count($rows),
    ];
}

/**
 * Flush queued disk spool files into MySQL as soon as DB recovers.
 */
function flush_db_spool(int $maxFiles = 20): array {
    $files = glob(db_spool_dir() . DIRECTORY_SEPARATOR . 'spool_*.json') ?: [];
    if (empty($files)) {
        return ['flushed' => 0, 'remaining' => 0, 'errors' => []];
    }

    $res = with_file_lock('db_spool_flush', function () use ($maxFiles) {
        require_once __DIR__ . '/github_sync_to_mysql.php';
        $files = glob(db_spool_dir() . DIRECTORY_SEPARATOR . 'spool_*.json') ?: [];
        sort($files);
        if (empty($files)) {
            return ['flushed' => 0, 'remaining' => 0, 'errors' => []];
        }

        $pdo = get_db();
        $flushed = 0;
        $rowsTotal = 0;
        $errors = [];

        foreach ($files as $idx => $file) {
            if ($idx >= $maxFiles) break;
            $raw = @file_get_contents($file);
            $snap = $raw ? json_decode($raw, true) : null;
            if (!is_array($snap) || empty($snap['snapshot_id'])) {
                @unlink($file);
                continue;
            }
            try {
                $imp = import_single_snapshot_to_mysql($pdo, $snap);
                if (!empty($imp['imported']) || ($imp['reason'] ?? '') === 'already_imported') {
                    @unlink($file);
                    if (!empty($imp['imported'])) {
                        $flushed++;
                        $rowsTotal += array_sum($imp['counts'] ?? []);
                    }
                }
            } catch (Throwable $e) {
                $errors[] = basename($file) . ': ' . $e->getMessage();
                break; // DB still down; stop early and keep remaining spool files intact
            }
        }

        $remaining = db_spool_count();
        if ($flushed > 0) {
            add_server_log('DB-Spool', "✅ ฐานข้อมูลกลับมาแล้ว — เทข้อมูลค้างจาก Local Spool {$flushed} ไฟล์ ({$rowsTotal} แถว) เข้า MySQL สำเร็จ");
            if (function_exists('sys_log_record')) {
                sys_log_record([
                    'module'         => 'db_spool',
                    'action'         => 'Flush Local DB Spool',
                    'status'         => empty($errors) ? 'success' : 'partial',
                    'trigger_source' => 'system',
                    'row_count'      => $rowsTotal,
                    'summary'        => "กู้คืนข้อมูลจาก Local Spool {$flushed} ไฟล์ ({$rowsTotal} แถว) คงเหลือ {$remaining} ไฟล์",
                    'error_detail'   => empty($errors) ? null : implode(' | ', $errors),
                ]);
            }
        }

        return ['flushed' => $flushed, 'rowsTotal' => $rowsTotal, 'remaining' => $remaining, 'errors' => $errors];
    }, true);

    return is_array($res) ? $res : ['flushed' => 0, 'remaining' => db_spool_count(), 'skipped' => true, 'errors' => []];
}

/**
 * List existing full MySQL backup archives sorted newest-first.
 */
function list_db_backups(): array {
    $files = glob(db_backup_dir() . DIRECTORY_SEPARATOR . 'water_system2_backup_*.sql*') ?: [];
    usort($files, function ($a, $b) {
        return (@filemtime($b) ?: 0) - (@filemtime($a) ?: 0);
    });
    $out = [];
    foreach ($files as $f) {
        $bytes = @filesize($f) ?: 0;
        $mtime = @filemtime($f) ?: time();
        $out[] = [
            'filename'   => basename($f),
            'sizeBytes'  => $bytes,
            'sizeKb'     => round($bytes / 1024, 1),
            'sizeMb'     => round($bytes / 1048576, 2),
            'createdAt'  => date('Y-m-d H:i:s', $mtime),
            'compressed' => (substr($f, -3) === '.gz'),
        ];
    }
    return $out;
}

/**
 * Dump every table in water_system2 cleanly using pure PHP PDO unbuffered streaming + gzopen (O(1) RAM).
 */
function run_full_mysql_backup(bool $sendEmail = false, string $triggerSource = 'manual'): array {
    $res = with_file_lock('db_backup', function () use ($sendEmail, $triggerSource) {
        @set_time_limit(300);
        @ini_set('memory_limit', '256M');

        $t0 = microtime(true);
        $startedAt = date('Y-m-d H:i:s');
        $pdo = get_db();
        $dbName = env_val('DB_NAME', 'water_system2');

        $tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
        if (empty($tables)) {
            throw new RuntimeException('ไม่พบตารางในฐานข้อมูลสำหรับสำรอง');
        }

        $stamp = date('Ymd_His');
        $useGzip = function_exists('gzopen');
        $ext = $useGzip ? 'sql.gz' : 'sql';
        $filename = "water_system2_backup_{$stamp}.{$ext}";
        $targetPath = db_backup_dir() . DIRECTORY_SEPARATOR . $filename;
        $tmpPath = $targetPath . '.tmp.' . getmypid();

        $fp = $useGzip ? @gzopen($tmpPath, 'wb6') : @fopen($tmpPath, 'wb');
        if (!$fp) {
            throw new RuntimeException('ไม่สามารถเปิดไฟล์สำรองฐานข้อมูลเพื่อเขียนลงดิสก์ได้');
        }
        $writeLine = function (string $chunk) use ($fp, $useGzip) {
            if ($useGzip) {
                gzwrite($fp, $chunk);
            } else {
                fwrite($fp, $chunk);
            }
        };

        $totalRows = 0;
        $wasBuffered = true;
        try {
            $writeLine("-- Water_System2 Full MySQL Backup\n");
            $writeLine("-- Database: `{$dbName}` | Generated: " . date('Y-m-d H:i:s') . " (Asia/Bangkok)\n");
            $writeLine("SET NAMES utf8mb4;\n");
            $writeLine("SET FOREIGN_KEY_CHECKS = 0;\n\n");

            // Load schema and column metadata first while buffered queries are enabled
            $tableDefs = [];
            foreach ($tables as $tbl) {
                $safeTbl = str_replace('`', '', (string)$tbl);
                $createRow = $pdo->query("SHOW CREATE TABLE `{$safeTbl}`")->fetch(PDO::FETCH_NUM);
                $tableDefs[] = [
                    'name'      => $safeTbl,
                    'createSql' => ($createRow && !empty($createRow[1])) ? $createRow[1] : null,
                ];
            }

            // Stream table rows using unbuffered MySQL cursor to avoid exhausting PHP RAM on large tables
            if (defined('PDO::MYSQL_ATTR_USE_BUFFERED_QUERY')) {
                $wasBuffered = (bool)$pdo->getAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY);
                $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);
            }

            foreach ($tableDefs as $def) {
                $safeTbl = $def['name'];
                if ($def['createSql']) {
                    $writeLine("-- Table: `{$safeTbl}`\n");
                    $writeLine("DROP TABLE IF EXISTS `{$safeTbl}`;\n");
                    $writeLine($def['createSql'] . ";\n\n");
                }

                $stmt = $pdo->query("SELECT * FROM `{$safeTbl}`");
                $cols = [];
                $colCount = $stmt->columnCount();
                for ($i = 0; $i < $colCount; $i++) {
                    $meta = $stmt->getColumnMeta($i);
                    $cols[] = '`' . str_replace('`', '', (string)($meta['name'] ?? "col{$i}")) . '`';
                }
                $colList = implode(', ', $cols);

                $batchValues = [];
                while ($row = $stmt->fetch(PDO::FETCH_NUM)) {
                    $escaped = [];
                    foreach ($row as $val) {
                        $escaped[] = ($val === null) ? 'NULL' : $pdo->quote((string)$val);
                    }
                    $batchValues[] = '(' . implode(', ', $escaped) . ')';
                    $totalRows++;

                    if (count($batchValues) >= 150) {
                        $writeLine("INSERT INTO `{$safeTbl}` ({$colList}) VALUES\n  " . implode(",\n  ", $batchValues) . ";\n");
                        $batchValues = [];
                    }
                }
                $stmt->closeCursor();
                if (!empty($batchValues)) {
                    $writeLine("INSERT INTO `{$safeTbl}` ({$colList}) VALUES\n  " . implode(",\n  ", $batchValues) . ";\n");
                }
                $writeLine("\n");
            }

            $writeLine("SET FOREIGN_KEY_CHECKS = 1;\n");
        } finally {
            if (defined('PDO::MYSQL_ATTR_USE_BUFFERED_QUERY')) {
                try { $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, $wasBuffered); } catch (Throwable $e) {}
            }
            if ($useGzip) {
                @gzclose($fp);
            } else {
                @fclose($fp);
            }
        }

        if (!@rename($tmpPath, $targetPath)) {
            @copy($tmpPath, $targetPath);
            @unlink($tmpPath);
        }

        $fileBytes = @filesize($targetPath) ?: 0;
        $fileKb = round($fileBytes / 1024, 1);

        // Enforce retention policy (default 14 days, always keep at least 3 newest files)
        $keepDays = max(3, (int)env_val('DB_BACKUP_RETENTION_DAYS', '14'));
        $cutoffTs = time() - ($keepDays * 86400);
        $allBackups = glob(db_backup_dir() . DIRECTORY_SEPARATOR . 'water_system2_backup_*.sql*') ?: [];
        usort($allBackups, function ($a, $b) {
            return (@filemtime($b) ?: 0) - (@filemtime($a) ?: 0);
        });
        $prunedCount = 0;
        foreach ($allBackups as $idx => $bf) {
            if ($idx >= 3 && ((@filemtime($bf) ?: time()) < $cutoffTs)) {
                if (@unlink($bf)) $prunedCount++;
            }
        }

        // Optional Off-site Email Attachment Backup
        $emailResult = null;
        if ($sendEmail) {
            require_once __DIR__ . '/notifier.php';
            $cfg = get_app_config();
            $smtp = $cfg['notifications']['smtp'] ?? [];
            $rcps = $pdo->query("SELECT email, name FROM tbl_alert_recipients WHERE is_active = 1 AND receive_email = 1")->fetchAll();
            if (empty($rcps) && !empty($smtp['user'])) {
                $rcps = [['email' => $smtp['user'], 'name' => 'System Admin']];
            }
            if ($fileBytes > 18 * 1048576) {
                $emailResult = ['success' => false, 'error' => 'ไฟล์ใหญ่เกิน 18 MB (เกินขีดจำกัดแนบ Gmail)'];
            } else {
                $attContent = @file_get_contents($targetPath);
                $html = "<div style=\"font-family:sans-serif;line-height:1.6\">"
                    . "<h3>💾 Water_System2 Off-site Database Backup</h3>"
                    . "<p>แนบไฟล์สำรองฐานข้อมูล <b>{$dbName}</b> (ครบทั้ง " . count($tables) . " ตาราง / " . number_format($totalRows) . " แถว)</p>"
                    . "<ul><li><b>ไฟล์:</b> {$filename} ({$fileKb} KB)</li><li><b>เวลาสร้าง:</b> {$startedAt} (ICT)</li></ul>"
                    . "</div>";
                $attMime = ($ext === 'sql.gz') ? 'application/gzip' : 'application/sql';
                $emailResult = php_smtp_send_email(
                    $smtp,
                    $rcps,
                    "💾 [Water_System2] Off-site MySQL Backup ({$filename})",
                    $html,
                    [['filename' => $filename, 'content' => (string)$attContent, 'mime' => $attMime]]
                );
            }
        }

        $durMs = (int)round((microtime(true) - $t0) * 1000);
        $summary = "สำรองฐานข้อมูล {$dbName} ครบ " . count($tables) . " ตาราง (" . number_format($totalRows) . " แถว -> {$filename}, {$fileKb} KB)";
        if ($emailResult !== null) {
            $summary .= !empty($emailResult['success']) ? ' | ส่ง Off-site Email สำเร็จ' : ' | ส่ง Email ไม่สำเร็จ: ' . ($emailResult['error'] ?? '');
        }
        add_server_log('Backup', "✅ {$summary}");

        if (function_exists('sys_log_record')) {
            sys_log_record([
                'module'         => 'backup',
                'action'         => 'Full MySQL Backup (' . strtoupper($ext) . ')',
                'status'         => ($emailResult === null || !empty($emailResult['success'])) ? 'success' : 'partial',
                'trigger_source' => $triggerSource,
                'started_at'     => $startedAt,
                'finished_at'    => date('Y-m-d H:i:s'),
                'duration_ms'    => $durMs,
                'row_count'      => $totalRows,
                'summary'        => $summary,
                'meta'           => ['filename' => $filename, 'sizeKb' => $fileKb, 'tables' => count($tables), 'pruned' => $prunedCount],
            ]);
        }

        return [
            'success'     => true,
            'filename'    => $filename,
            'path'        => $targetPath,
            'tables'      => count($tables),
            'rows'        => $totalRows,
            'sizeBytes'   => $fileBytes,
            'sizeKb'      => $fileKb,
            'durationMs'  => $durMs,
            'pruned'      => $prunedCount,
            'emailResult' => $emailResult,
        ];
    }, true);

    return is_array($res) ? $res : ['success' => false, 'error' => 'Backup task already running'];
}

/**
 * Triggered once per 24h from housekeeping or scheduler.
 */
function run_daily_db_backup_if_due(): array {
    $stateFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'runtime_state.json';
    $now = time();
    $st = read_json_file($stateFile, []);
    $lastBackup = (int)($st['lastDbBackupAt'] ?? 0);
    if (($now - $lastBackup) < 86400) {
        return ['ran' => false, 'reason' => 'cooldown_24h'];
    }

    update_json_file_atomic($stateFile, [], function (array $s) use ($now) {
        $s['lastDbBackupAt'] = $now;
        return $s;
    });

    $sendOffsite = (env_val('DB_BACKUP_OFFSITE_EMAIL', '0') === '1');
    return run_full_mysql_backup($sendOffsite, 'system');
}

/**
 * Load latest cloud snapshot (local cache first, remote raw GitHub fallback) for emergency failover.
 */
function get_latest_cloud_snapshot_bundle(): array {
    $baseDir = WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR . 'cloud_snapshots';
    $files = is_dir($baseDir) ? (glob($baseDir . DIRECTORY_SEPARATOR . '*' . DIRECTORY_SEPARATOR . 'snapshot_*.json') ?: []) : [];
    sort($files);
    if (!empty($files)) {
        $latest = end($files);
        $raw = @file_get_contents($latest);
        $decoded = $raw ? json_decode($raw, true) : null;
        if (is_array($decoded)) {
            $decoded['_source'] = 'local_cloud_snapshot';
            $decoded['_file'] = str_replace(WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR, '', $latest);
            return $decoded;
        }
    }

    // Fetch live from raw.githubusercontent.com if local cache empty
    $ghRepo = env_val('GITHUB_SYNC_REPO', 'PakaponTim/Water_System2');
    $ghBranch = env_val('GITHUB_SYNC_BRANCH', 'main');
    if ($ghRepo !== '') {
        $rawBase = "https://raw.githubusercontent.com/{$ghRepo}/{$ghBranch}/cloud_snapshots";
        try {
            $manifest = http_get_json("{$rawBase}/manifest.json?ts=" . time(), [], 10);
            if (!empty($manifest['snapshots']) && is_array($manifest['snapshots'])) {
                $keys = array_keys($manifest['snapshots']);
                sort($keys);
                $lastKey = end($keys);
                $relPath = $manifest['snapshots'][$lastKey]['path'] ?? '';
                if ($relPath !== '') {
                    $snap = http_get_json("{$rawBase}/{$relPath}", [], 12);
                    if (is_array($snap)) {
                        $snap['_source'] = 'remote_github_raw';
                        $snap['_file'] = $relPath;
                        return $snap;
                    }
                }
            }
        } catch (Throwable $e) {
            // ignore
        }
    }

    return [];
}
