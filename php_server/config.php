<?php
// =========================================================================
// Water_System2 — Server & Local Configuration (Zero-Admin Drop-in Ready)
// Works both on Server Subfolder (http://server/Water_System2/) and Port 7000
// =========================================================================

date_default_timezone_set('Asia/Bangkok');

define('LP_PAO_PORT', 7000);
define('LP_PAO_ROOT', dirname(__DIR__));
define('LP_PAO_UI_DIR', LP_PAO_ROOT . DIRECTORY_SEPARATOR . 'backend_ui');
define('LP_PAO_RUNTIME_DIR', LP_PAO_ROOT . DIRECTORY_SEPARATOR . 'runtime' . DIRECTORY_SEPARATOR . 'php_7000');

function ensure_runtime_htaccess(string $dir): void {
    if (!is_dir($dir)) @mkdir($dir, 0777, true);
    $ht = $dir . DIRECTORY_SEPARATOR . '.htaccess';
    if (!file_exists($ht)) {
        @file_put_contents($ht, "<Files \"*\">\n  <IfModule mod_authz_core.c>\n    Require all denied\n  </IfModule>\n  <IfModule !mod_authz_core.c>\n    Order allow,deny\n    Deny from all\n  </IfModule>\n</Files>\n");
    }
}

ensure_runtime_htaccess(dirname(LP_PAO_RUNTIME_DIR));
ensure_runtime_htaccess(LP_PAO_RUNTIME_DIR);

// Load .env if present
$envFile = LP_PAO_ROOT . DIRECTORY_SEPARATOR . '.env';
$ENV_VARS = [];
if (file_exists($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || strpos($line, '#') === 0) continue;
        $parts = explode('=', $line, 2);
        if (count($parts) === 2) {
            $ENV_VARS[trim($parts[0])] = trim($parts[1], " \t\n\r\0\x0B\"'");
        }
    }
}

// Also allow overriding DB config via runtime/php_7000/db_config.json (from server_setup.php)
$dbOverrideFile = LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'db_config.json';
if (file_exists($dbOverrideFile)) {
    $dbOverride = json_decode((string)@file_get_contents($dbOverrideFile), true);
    if (is_array($dbOverride)) {
        foreach ($dbOverride as $k => $v) {
            if ($v !== '' && $v !== null) $ENV_VARS[$k] = (string)$v;
        }
    }
}

function env_val($key, $default = '') {
    global $ENV_VARS;
    if (isset($ENV_VARS[$key]) && $ENV_VARS[$key] !== '') return $ENV_VARS[$key];
    $val = getenv($key);
    return ($val !== false && $val !== '') ? $val : $default;
}

define('AUTH_ENFORCE', env_val('WATER_PHP_AUTH_ENFORCE', '0') === '1');
define('SESSION_COOKIE_NAME', 'water_session_7000');

function get_db(): PDO {
    static $pdo = null;
    if ($pdo !== null) {
        try {
            $pdo->query('SELECT 1');
            return $pdo;
        } catch (Exception $e) {
            $pdo = null;
        }
    }
    $host = env_val('DB_HOST', 'localhost');
    $port = (int)env_val('DB_PORT', 3306);
    $db   = env_val('DB_NAME', 'water_system2');
    $user = env_val('DB_USER', 'root');
    $pass = env_val('DB_PASS', 'root');

    $opts = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];

    try {
        $dsn = "mysql:host={$host};port={$port};dbname={$db};charset=utf8mb4";
        $pdo = new PDO($dsn, $user, $pass, $opts);
    } catch (PDOException $e) {
        // If database does not exist yet on the Server (SQLSTATE 42000 / 1049), create it automatically!
        if (strpos($e->getMessage(), '1049') !== false || stripos($e->getMessage(), 'Unknown database') !== false) {
            $rootDsn = "mysql:host={$host};port={$port};charset=utf8mb4";
            $tmpPdo = new PDO($rootDsn, $user, $pass, $opts);
            $safeDb = preg_replace('/[^a-zA-Z0-9_]/', '', $db);
            $tmpPdo->exec("CREATE DATABASE IF NOT EXISTS `{$safeDb}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
            $tmpPdo = null;
            $pdo = new PDO("mysql:host={$host};port={$port};dbname={$safeDb};charset=utf8mb4", $user, $pass, $opts);
        } else {
            throw $e;
        }
    }

    ensure_all_tables($pdo, $db);
    return $pdo;
}

function ensure_all_tables(PDO $pdo, string $dbName = 'water_system2'): void {
    static $checked = false;
    if ($checked) return;

    $flagFile = LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'schema_ready_v2_' . preg_replace('/[^a-zA-Z0-9_]/', '', $dbName) . '.flag';
    if (file_exists($flagFile)) {
        $checked = true;
        return;
    }

    $pdo->exec("CREATE TABLE IF NOT EXISTS `tbl_water_disaster_monitoring` (
      `id` bigint(20) NOT NULL AUTO_INCREMENT,
      `station_name` varchar(150) NOT NULL,
      `river` varchar(100) DEFAULT NULL,
      `amphoe` varchar(100) NOT NULL,
      `province` varchar(50) DEFAULT 'ลำปาง',
      `current_water_level_m` decimal(6,2) DEFAULT NULL,
      `left_bank_level_m` decimal(6,2) DEFAULT NULL,
      `bank_difference_m` decimal(6,2) DEFAULT NULL,
      `trend` varchar(50) DEFAULT NULL,
      `status` varchar(50) DEFAULT NULL,
      `current_rain_mm` decimal(5,2) DEFAULT NULL,
      `forecast_rain_24h_mm` decimal(5,2) DEFAULT NULL,
      `risk_level` varchar(50) DEFAULT NULL,
      `recorded_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
      `created_add` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      `updated_add` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`),
      KEY `idx_amphoe` (`amphoe`),
      KEY `idx_risk_level` (`risk_level`),
      KEY `idx_station_recorded` (`station_name`,`recorded_at`),
      KEY `idx_recorded_at` (`recorded_at`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS `tbl_rainfall_monitoring` (
      `id` bigint(20) NOT NULL AUTO_INCREMENT,
      `station_name` varchar(150) NOT NULL,
      `location` varchar(150) DEFAULT NULL,
      `river_basin` varchar(100) DEFAULT NULL,
      `rain_mm` decimal(6,2) DEFAULT NULL,
      `rain_status` varchar(50) DEFAULT NULL,
      `measured_time` varchar(50) DEFAULT NULL,
      `record_date` varchar(100) DEFAULT NULL,
      `recorded_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
      `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`),
      KEY `idx_station` (`station_name`),
      KEY `idx_station_recorded` (`station_name`,`recorded_at`),
      KEY `idx_recorded_at` (`recorded_at`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS `tbl_drought_monitoring` (
      `id` bigint(20) NOT NULL AUTO_INCREMENT,
      `record_date` varchar(100) NOT NULL,
      `recorded_at` datetime NOT NULL,
      `dam_type` varchar(100) DEFAULT NULL,
      `dam_name` varchar(100) NOT NULL,
      `capacity_m_cum` decimal(12,4) DEFAULT NULL,
      `inflow_m_cum` decimal(12,4) DEFAULT NULL,
      `water_volume_m_cum` decimal(12,4) DEFAULT NULL,
      `water_percent` varchar(20) DEFAULT NULL,
      `usable_water_m_cum` decimal(12,4) DEFAULT NULL,
      `discharge_m_cum` decimal(12,4) DEFAULT NULL,
      `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`),
      KEY `idx_dam_recorded` (`dam_name`,`recorded_at`),
      KEY `idx_recorded_at` (`recorded_at`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS `tbl_pm25_monitoring` (
      `id` bigint(20) NOT NULL AUTO_INCREMENT,
      `record_date` varchar(100) NOT NULL,
      `recorded_at` datetime NOT NULL,
      `station_name` varchar(150) NOT NULL,
      `tambon` varchar(100) DEFAULT NULL,
      `amphoe` varchar(100) NOT NULL,
      `province` varchar(50) DEFAULT 'ลำปาง',
      `time_label` varchar(50) DEFAULT NULL,
      `pm25_value` decimal(6,2) DEFAULT NULL,
      `pm25_avg_24h` decimal(6,2) DEFAULT NULL,
      `air_quality_status` varchar(100) DEFAULT NULL,
      `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`),
      KEY `idx_station_recorded` (`station_name`,`recorded_at`),
      KEY `idx_recorded_at` (`recorded_at`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS `tbl_complaints_monitoring` (
      `id` int(11) NOT NULL AUTO_INCREMENT,
      `ticket_id` varchar(50) NOT NULL,
      `state_name` varchar(100) NOT NULL,
      `problem_type` varchar(150) DEFAULT NULL,
      `description` text,
      `photo_url` text,
      `location` text,
      `org_name` text,
      `agency_status` varchar(100) DEFAULT NULL,
      `ticket_datetime` varchar(100) DEFAULT NULL,
      `satisfaction_stars` varchar(50) DEFAULT NULL,
      `raw_timeline` longtext,
      `is_in_scope` tinyint(1) DEFAULT '1',
      `recorded_at` datetime NOT NULL,
      `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`),
      UNIQUE KEY `ticket_id` (`ticket_id`),
      KEY `idx_state` (`state_name`),
      KEY `idx_recorded_at` (`recorded_at`),
      KEY `idx_created_at` (`created_at`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS `tbl_alert_notifications` (
      `id` int(11) NOT NULL AUTO_INCREMENT,
      `alert_type` enum('water','rainfall','drought','pm25','complaints') NOT NULL,
      `alert_level` enum('info','warning','critical') NOT NULL,
      `alert_title` varchar(255) NOT NULL,
      `alert_message` text NOT NULL,
      `trigger_value` varchar(100) DEFAULT NULL,
      `threshold_value` varchar(100) DEFAULT NULL,
      `station_name` varchar(150) DEFAULT NULL,
      `recipients_sent` text,
      `email_status` enum('sent','failed','skipped') DEFAULT 'skipped',
      `email_error` text,
      `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS `tbl_alert_recipients` (
      `id` int(11) NOT NULL AUTO_INCREMENT,
      `name` varchar(100) NOT NULL,
      `position` varchar(100) NOT NULL,
      `email` varchar(255) NOT NULL,
      `alert_level_min` enum('info','warning','critical') DEFAULT 'warning',
      `is_active` tinyint(1) DEFAULT '1',
      `notify_water` tinyint(1) DEFAULT '1',
      `notify_drought` tinyint(1) DEFAULT '1',
      `notify_pm25` tinyint(1) DEFAULT '1',
      `notify_complaints` tinyint(1) DEFAULT '1',
      `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
      `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    ensure_ingest_tables($pdo);
    ensure_system_logs_table($pdo);
    @file_put_contents($flagFile, date('c'));
    $checked = true;
}

function ensure_system_logs_table(PDO $pdo) {
    static $ensured = false;
    if ($ensured) return;
    $pdo->exec("CREATE TABLE IF NOT EXISTS `tbl_system_logs` (
        `id` bigint(20) NOT NULL AUTO_INCREMENT,
        `run_group_id` varchar(64) DEFAULT NULL,
        `module` varchar(32) NOT NULL,
        `action` varchar(120) NOT NULL,
        `status` enum('running','success','partial','warning','failed') NOT NULL DEFAULT 'success',
        `trigger_source` varchar(32) NOT NULL DEFAULT 'system',
        `scheduled_slot` varchar(16) DEFAULT NULL,
        `started_at` datetime NOT NULL,
        `finished_at` datetime DEFAULT NULL,
        `duration_ms` int(11) NOT NULL DEFAULT 0,
        `row_count` int(11) NOT NULL DEFAULT 0,
        `summary` varchar(500) NOT NULL,
        `error_detail` text,
        `meta_json` longtext,
        `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (`id`),
        KEY `idx_syslog_module_time` (`module`, `started_at`),
        KEY `idx_syslog_status_time` (`status`, `started_at`),
        KEY `idx_syslog_slot_time` (`scheduled_slot`, `started_at`),
        KEY `idx_syslog_group` (`run_group_id`),
        KEY `idx_syslog_started` (`started_at`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $ensured = true;
}

function ensure_ingest_tables(PDO $pdo) {
    static $ensured = false;
    if ($ensured) return;
    $pdo->exec("CREATE TABLE IF NOT EXISTS app_ingest_batches (
        batch_id VARCHAR(128) PRIMARY KEY,
        kind VARCHAR(20) NOT NULL,
        fingerprint CHAR(64) NOT NULL,
        row_count INT NOT NULL,
        committed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ingest_kind_time (kind, committed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS app_complaint_events (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        ticket_id VARCHAR(50) NOT NULL,
        state_name VARCHAR(100),
        org_name TEXT,
        observed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        batch_id VARCHAR(128) NOT NULL,
        INDEX idx_ticket_time (ticket_id, observed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $ensured = true;
}

function format_iso_datetime($timestamp = null): string {
    if ($timestamp === null) $timestamp = time();
    if (is_string($timestamp)) $timestamp = strtotime($timestamp);
    if (!$timestamp) return 'ยังไม่เคยบันทึก';
    return date('Y-m-d H:i:s', $timestamp);
}

function format_thai_date($timestamp = null): string {
    if ($timestamp === null) $timestamp = time();
    $thaiMonths = [
        1 => 'มกราคม', 2 => 'กุมภาพันธ์', 3 => 'มีนาคม', 4 => 'เมษายน',
        5 => 'พฤษภาคม', 6 => 'มิถุนายน', 7 => 'กรกฎาคม', 8 => 'สิงหาคม',
        9 => 'กันยายน', 10 => 'ตุลาคม', 11 => 'พฤศจิกายน', 12 => 'ธันวาคม'
    ];
    $d = (int)date('j', $timestamp);
    $m = $thaiMonths[(int)date('n', $timestamp)];
    $y = (int)date('Y', $timestamp) + 543;
    return "{$d} {$m} {$y}";
}

function read_json_file(string $path, array $default = []): array {
    if (!file_exists($path)) return $default;
    $raw = @file_get_contents($path);
    if ($raw === false || $raw === '') return $default;
    $data = json_decode($raw, true);
    return is_array($data) ? $data : $default;
}

function write_json_file(string $path, array $data): bool {
    $dir = dirname($path);
    if (!is_dir($dir)) @mkdir($dir, 0777, true);
    $tmp = $path . '.tmp.' . getmypid() . '.' . mt_rand(1000, 9999);
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if (@file_put_contents($tmp, $json, LOCK_EX) !== false) {
        if (@rename($tmp, $path)) return true;
        if (@copy($tmp, $path)) {
            @unlink($tmp);
            return true;
        }
        @unlink($tmp);
    }
    return @file_put_contents($path, $json, LOCK_EX) !== false;
}

function with_file_lock(string $lockName, callable $callback, bool $nonBlocking = false) {
    $lockDir = LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'locks';
    if (!is_dir($lockDir)) @mkdir($lockDir, 0777, true);
    $safeName = preg_replace('/[^a-zA-Z0-9_.-]/', '_', $lockName);
    $lockFile = $lockDir . DIRECTORY_SEPARATOR . $safeName . '.lock';
    $fp = @fopen($lockFile, 'c+');
    if (!$fp) {
        return $nonBlocking ? null : $callback();
    }
    $flags = $nonBlocking ? (LOCK_EX | LOCK_NB) : LOCK_EX;
    if (!@flock($fp, $flags)) {
        @fclose($fp);
        return null;
    }
    try {
        return $callback();
    } finally {
        @flock($fp, LOCK_UN);
        @fclose($fp);
    }
}

function update_json_file_atomic(string $path, array $default, callable $mutator) {
    return with_file_lock('json_' . md5($path), function () use ($path, $default, $mutator) {
        $data = read_json_file($path, $default);
        $updated = $mutator($data);
        if (is_array($updated)) {
            write_json_file($path, $updated);
            return $updated;
        }
        return $data;
    }, false);
}

function rotate_log_if_needed(string $logPath, int $maxBytes = 5242880, int $maxArchives = 3): void {
    clearstatcache(true, $logPath);
    if (!file_exists($logPath)) return;
    $size = @filesize($logPath);
    if ($size === false || $size < $maxBytes) return;

    with_file_lock('rotate_' . md5($logPath), function () use ($logPath, $maxBytes, $maxArchives) {
        clearstatcache(true, $logPath);
        if (!file_exists($logPath) || (@filesize($logPath) ?: 0) < $maxBytes) return;
        for ($i = $maxArchives; $i >= 1; $i--) {
            $old = "{$logPath}.{$i}";
            if ($i === $maxArchives) {
                @unlink($old);
            } else {
                $next = "{$logPath}." . ($i + 1);
                if (file_exists($old)) @rename($old, $next);
            }
        }
        @rename($logPath, "{$logPath}.1");
    }, false);
}

function add_server_log(string $source, string $message): string {
    $datetimeStr = format_iso_datetime();
    $logStr = "[{$datetimeStr}] [{$source}] {$message}";

    $eventsFile = LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'socketio_events.json';
    update_json_file_atomic($eventsFile, ['seq' => 0, 'events' => []], function (array $eventsData) use ($logStr) {
        $seq = (int)($eventsData['seq'] ?? 0) + 1;
        $events = $eventsData['events'] ?? [];
        $events[] = [
            'seq' => $seq,
            'event' => 'server_log',
            'data' => $logStr,
            'ts' => microtime(true)
        ];
        if (count($events) > 120) {
            $events = array_slice($events, -120);
        }
        return ['seq' => $seq, 'events' => $events];
    });

    $logsFile = LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'recent_logs.json';
    update_json_file_atomic($logsFile, [], function (array $logs) use ($logStr) {
        array_unshift($logs, $logStr);
        if (count($logs) > 50) {
            $logs = array_slice($logs, 0, 50);
        }
        return $logs;
    });

    $fetchLogPath = LP_PAO_ROOT . DIRECTORY_SEPARATOR . 'fetch_history.log';
    rotate_log_if_needed($fetchLogPath, 5242880, 3);
    @file_put_contents($fetchLogPath, $logStr . PHP_EOL, FILE_APPEND | LOCK_EX);

    return $logStr;
}

function get_recent_logs(): array {
    $logsFile = LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'recent_logs.json';
    $logs = read_json_file($logsFile, []);
    if (empty($logs)) {
        $logs = [
            '[' . format_iso_datetime() . '] [Water_System2] 🚀 ระบบ PHP + Socket.IO + Direct API Collector พร้อมทำงานบน Server',
            '[' . format_iso_datetime() . '] [Water_System2] 🛡️ เชื่อมต่อฐานข้อมูล MySQL (' . env_val('DB_NAME', 'water_system2') . ') และระบบซิงค์ข้อมูลอัตโนมัติเรียบร้อย'
        ];
        write_json_file($logsFile, $logs);
    }
    return $logs;
}

function get_task_history(): array {
    $histPath = LP_PAO_ROOT . DIRECTORY_SEPARATOR . 'task_history.json';
    $defaultStats = [
        'waterLevel' => [
            'lastFetchSuccess' => null,
            'lastFetchStatus' => 'Pending',
            'lastFetchMessage' => 'ระบบพร้อมทำงาน (Direct API)',
            'lastFetchMode' => 'Database',
            'rowCountSaved' => 0
        ],
        'drought' => [
            'lastFetchSuccess' => null,
            'lastFetchStatus' => 'Pending',
            'lastFetchMessage' => 'ระบบพร้อมทำงาน (Direct API)',
            'lastFetchMode' => 'Database',
            'rowCountSaved' => 0
        ],
        'pm25' => [
            'lastFetchSuccess' => null,
            'lastFetchStatus' => 'Pending',
            'lastFetchMessage' => 'ระบบพร้อมทำงาน (Direct API)',
            'lastFetchMode' => 'Database',
            'rowCountSaved' => 0
        ],
        'complaints' => [
            'lastFetchSuccess' => null,
            'lastFetchStatus' => 'Pending',
            'lastFetchMessage' => 'ระบบพร้อมทำงาน (Direct API)',
            'lastFetchMode' => 'Database',
            'rowCountSaved' => 0
        ]
    ];
    $data = read_json_file($histPath, []);
    return [
        'completedTasks' => isset($data['completedTasks']) && is_array($data['completedTasks']) ? $data['completedTasks'] : [],
        'projectStats' => isset($data['projectStats']) && is_array($data['projectStats']) ? array_merge($defaultStats, $data['projectStats']) : $defaultStats
    ];
}

function log_task_run(string $projectName, string $mode, string $status, int $count, string $message) {
    $histPath = LP_PAO_ROOT . DIRECTORY_SEPARATOR . 'task_history.json';
    $timeStr = format_iso_datetime();

    $key = '';
    if (mb_strpos($projectName, 'ระดับน้ำ') !== false || stripos($projectName, 'water') !== false || mb_strpos($projectName, 'น้ำฝน') !== false) {
        $key = 'waterLevel';
    } elseif (mb_strpos($projectName, 'ภัยแล้ง') !== false || stripos($projectName, 'drought') !== false) {
        $key = 'drought';
    } elseif (stripos($projectName, 'pm') !== false) {
        $key = 'pm25';
    } elseif (mb_strpos($projectName, 'ร้องเรียน') !== false || stripos($projectName, 'complaint') !== false) {
        $key = 'complaints';
    }

    update_json_file_atomic($histPath, ['completedTasks' => [], 'projectStats' => get_task_history()['projectStats']], function (array $hist) use ($projectName, $mode, $status, $count, $message, $timeStr, $key) {
        if (!isset($hist['completedTasks']) || !is_array($hist['completedTasks'])) $hist['completedTasks'] = [];
        if (!isset($hist['projectStats']) || !is_array($hist['projectStats'])) $hist['projectStats'] = get_task_history()['projectStats'];

        if ($key !== '' && isset($hist['projectStats'][$key])) {
            $hist['projectStats'][$key]['lastFetchStatus'] = ($status === 'success') ? 'Success' : 'Failed';
            $hist['projectStats'][$key]['lastFetchMessage'] = $message;
            $hist['projectStats'][$key]['lastFetchMode'] = ($mode === 'db') ? 'Database' : 'Excel';
            if ($status === 'success') {
                $hist['projectStats'][$key]['lastFetchSuccess'] = $timeStr;
                $hist['projectStats'][$key]['rowCountSaved'] = (int)($hist['projectStats'][$key]['rowCountSaved'] ?? 0) + $count;
            }
        }

        $newTask = [
            'id' => 'T-' . round(microtime(true) * 1000) . '-' . mt_rand(100, 999),
            'projectName' => $projectName,
            'taskType' => 'เก็บข้อมูลลง ' . ($mode === 'db' ? 'Database (Direct API)' : 'Excel (Direct API)'),
            'status' => $status,
            'timestamp' => $timeStr,
            'count' => $count,
            'details' => $message
        ];

        array_unshift($hist['completedTasks'], $newTask);
        if (count($hist['completedTasks']) > 50) {
            $hist['completedTasks'] = array_slice($hist['completedTasks'], 0, 50);
        }
        return $hist;
    });

    $stateFile = LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'runtime_state.json';
    update_json_file_atomic($stateFile, [], function (array $state) use ($status, $key) {
        if ($status === 'success') {
            $state['lastDataReceived'] = time();
            if ($key === 'waterLevel') $state['lastWLDataReceived'] = time();
            if ($key === 'drought') $state['lastDroughtDataReceived'] = time();
            if ($key === 'pm25') $state['lastPM25DataReceived'] = time();
            if ($key === 'complaints') $state['lastComplaintsDataReceived'] = time();
        }
        return $state;
    });
}

function get_app_config(): array {
    $configPath = LP_PAO_ROOT . DIRECTORY_SEPARATOR . 'config.json';
    $default = [
        'scheduledTasks' => ['06:00', '12:00', '18:00'],
        'isScheduleActive' => ['water' => true, 'drought' => true, 'pm25' => true, 'complaints' => true],
        'notifications' => [
            'enabled' => true,
            'smtp' => [
                'host' => env_val('SMTP_HOST', 'smtp.gmail.com'),
                'port' => (int)env_val('SMTP_PORT', 587),
                'secure' => env_val('SMTP_SECURE', 'false') === 'true',
                'user' => env_val('SMTP_USER', ''),
                'pass' => env_val('SMTP_PASS', '')
            ],
            'alertActive' => ['water' => true, 'rainfall' => true, 'drought' => true, 'pm25' => true, 'complaints' => true],
            'cooldownMinutes' => 120
        ]
    ];
    $loaded = read_json_file($configPath, []);
    if (isset($loaded['scheduledTasks']) && is_array($loaded['scheduledTasks'])) {
        $default['scheduledTasks'] = $loaded['scheduledTasks'];
    }
    if (isset($loaded['isScheduleActive'])) {
        if (is_bool($loaded['isScheduleActive'])) {
            $b = $loaded['isScheduleActive'];
            $default['isScheduleActive'] = ['water' => $b, 'drought' => $b, 'pm25' => $b, 'complaints' => $b];
        } elseif (is_array($loaded['isScheduleActive'])) {
            $default['isScheduleActive'] = array_merge($default['isScheduleActive'], $loaded['isScheduleActive']);
        }
    }
    if (isset($loaded['notifications']) && is_array($loaded['notifications'])) {
        $default['notifications'] = array_replace_recursive($default['notifications'], $loaded['notifications']);
    }

    // Load SMTP/LINE/Traffy secrets saved via Web UI (stored outside config.json inside runtime/)
    $secretsPath = LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'notification_secrets.json';
    $secrets = read_json_file($secretsPath, []);
    if (!empty($secrets['smtp_user'])) $default['notifications']['smtp']['user'] = $secrets['smtp_user'];
    if (!empty($secrets['smtp_pass'])) $default['notifications']['smtp']['pass'] = $secrets['smtp_pass'];
    if (!empty($secrets['line_channel_token']) || env_val('LINE_CHANNEL_TOKEN') !== '') {
        $default['notifications']['line'] = [
            'channelToken' => !empty($secrets['line_channel_token']) ? $secrets['line_channel_token'] : env_val('LINE_CHANNEL_TOKEN', ''),
            'targetId'     => !empty($secrets['line_target_id']) ? $secrets['line_target_id'] : env_val('LINE_TARGET_ID', '')
        ];
    }
    $default['traffyAuth'] = [
        'cookie' => (string)($secrets['traffy_cookie'] ?? env_val('TRAFFY_COOKIE', '')),
        'token'  => (string)($secrets['traffy_token'] ?? env_val('TRAFFY_TOKEN', '')),
        'orgId'  => (string)($secrets['traffy_org_id'] ?? env_val('TRAFFY_ORG_ID', '')),
        'updatedAt' => (string)($secrets['traffy_updated_at'] ?? '')
    ];

    if (empty($default['notifications']['smtp']['pass']) && env_val('SMTP_PASS') !== '') {
        $default['notifications']['smtp']['pass'] = env_val('SMTP_PASS');
    }
    if (empty($default['notifications']['smtp']['user']) && env_val('SMTP_USER') !== '') {
        $default['notifications']['smtp']['user'] = env_val('SMTP_USER');
    }
    return $default;
}

function save_app_config(array $cfg) {
    $secretsPath = LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'notification_secrets.json';
    $secrets = read_json_file($secretsPath, []);
    if (!empty($cfg['notifications']['smtp']['user'])) {
        $secrets['smtp_user'] = $cfg['notifications']['smtp']['user'];
    }
    if (!empty($cfg['notifications']['smtp']['pass'])) {
        $secrets['smtp_pass'] = $cfg['notifications']['smtp']['pass'];
    }
    if (!empty($cfg['notifications']['line']['channelToken'])) {
        $secrets['line_channel_token'] = $cfg['notifications']['line']['channelToken'];
    }
    if (isset($cfg['notifications']['line']['targetId']) && $cfg['notifications']['line']['targetId'] !== '') {
        $secrets['line_target_id'] = $cfg['notifications']['line']['targetId'];
    }
    if (isset($cfg['traffyAuth']) && is_array($cfg['traffyAuth'])) {
        if (array_key_exists('cookie', $cfg['traffyAuth'])) {
            $secrets['traffy_cookie'] = trim((string)$cfg['traffyAuth']['cookie']);
        }
        if (array_key_exists('token', $cfg['traffyAuth'])) {
            $secrets['traffy_token'] = trim((string)$cfg['traffyAuth']['token']);
        }
        if (array_key_exists('orgId', $cfg['traffyAuth'])) {
            $secrets['traffy_org_id'] = trim((string)$cfg['traffyAuth']['orgId']);
        }
        $secrets['traffy_updated_at'] = format_iso_datetime();
    }
    write_json_file($secretsPath, $secrets);

    $configPath = LP_PAO_ROOT . DIRECTORY_SEPARATOR . 'config.json';
    $toSave = $cfg;
    if (isset($toSave['notifications']['smtp']['pass'])) {
        $toSave['notifications']['smtp']['pass'] = '';
    }
    unset($toSave['notifications']['line'], $toSave['traffyAuth']);
    write_json_file($configPath, $toSave);
}

function DATA_DEFINITIONS(): array {
    return [
        'version' => '2026-09-07.1',
        'timezone' => 'Asia/Bangkok',
        'recorded_at' => 'เวลาที่ระบบบันทึกข้อมูล ไม่ใช่เวลาที่สถานีตรวจวัด',
        'rainfall_accum_3d_mm' => 'ฝนสะสมย้อนหลัง 3 วันจาก widget ระดับอำเภอ; คอลัมน์เก่า forecast_rain_24h_mm ใช้เก็บค่านี้ใน scraper ที่ตรวจพบ ไม่ใช่พยากรณ์',
        'current_rain_mm' => 'ฝนที่จับคู่จากพื้นที่ของสถานี ไม่ใช่เครื่องวัดฝนที่สถานีระดับน้ำเสมอไป',
        'drought_daily_volume' => 'ผลรวมค่าล่าสุดต่ออ่างต่อวัน หน่วยล้านลูกบาศก์เมตร ไม่รวมหลายรอบของอ่างเดิม',
        'complaints' => 'นับเรื่องที่ระบบพบครั้งแรกในช่วงเวลา พร้อมสถานะล่าสุด; ประวัติสถานะเริ่มตั้งแต่ติดตั้งรุ่นนี้',
        'water_projection' => 'ภาพจำลองจากประวัติและสมมติฐาน ไม่ใช่พยากรณ์ที่ผ่านการตรวจสอบ',
        'missing_values' => 'null หมายถึงไม่มีข้อมูล; 0 หมายถึงตรวจได้ศูนย์'
    ];
}

// =========================================================================
// Domain & Failover Domain Configuration (domain_config.json)
// =========================================================================

function normalize_domain_base_url(string $url): string {
    $u = trim($url);
    if ($u === '') return '';
    if (!preg_match('#^https?://#i', $u)) {
        $scheme = (stripos($u, 'localhost') === 0 || strpos($u, '127.0.0.1') === 0) ? 'http://' : 'https://';
        $u = $scheme . ltrim($u, '/');
    }
    $u = rtrim($u, '/');
    $u = preg_replace('#/(index\.html|index\.php|cron\.php|server_setup\.php|endpoint\.php)$#i', '', $u);
    return rtrim((string)$u, '/');
}

function is_active_public_domain(string $url): bool {
    $u = normalize_domain_base_url($url);
    if ($u === '' || !filter_var($u, FILTER_VALIDATE_URL)) {
        return false;
    }
    $host = strtolower((string)parse_url($u, PHP_URL_HOST));
    if ($host === '' || in_array($host, ['localhost', '127.0.0.1', '::1', 'your-domain.com', 'backup-water.your-domain.com', 'water.your-domain.com', 'example.com'], true)) {
        return false;
    }
    if (substr($host, -15) === 'your-domain.com' || substr($host, -11) === 'example.com') {
        return false;
    }
    return true;
}

function get_domain_config(): array {
    $cfgPath = LP_PAO_ROOT . DIRECTORY_SEPARATOR . 'domain_config.json';
    $default = [
        'primary_domain'            => 'https://water.your-domain.com/Water_System2',
        'backup_domain'             => 'https://backup-water.your-domain.com/Water_System2',
        'local_dev_url'             => 'http://127.0.0.1:7000',
        'extra_allowed_origins'     => [],
        'allowed_extension_ids'     => [],
        'failover_auto_ping_backup' => true,
        'notes'                     => 'เปลี่ยน primary_domain เมื่อย้ายโดเมนหลัก และใส่ backup_domain เพื่อใช้เป็นโดเมนสำรองตัวที่ 2'
    ];
    $loaded = read_json_file($cfgPath, []);
    if (is_array($loaded)) {
        $default = array_merge($default, $loaded);
    }

    // Optional .env overrides
    if (env_val('PRIMARY_DOMAIN') !== '') {
        $default['primary_domain'] = env_val('PRIMARY_DOMAIN');
    }
    if (env_val('BACKUP_DOMAIN') !== '') {
        $default['backup_domain'] = env_val('BACKUP_DOMAIN');
    }
    if (env_val('EXTRA_ALLOWED_ORIGINS') !== '') {
        $extras = array_values(array_filter(array_map('trim', explode(',', env_val('EXTRA_ALLOWED_ORIGINS')))));
        $default['extra_allowed_origins'] = $extras;
    }
    if (env_val('ALLOWED_EXTENSION_IDS') !== '') {
        $extIds = array_values(array_filter(array_map('trim', explode(',', strtolower(env_val('ALLOWED_EXTENSION_IDS'))))));
        $default['allowed_extension_ids'] = $extIds;
    }

    $primary = normalize_domain_base_url((string)($default['primary_domain'] ?? ''));
    $backup  = normalize_domain_base_url((string)($default['backup_domain'] ?? ''));
    $local   = normalize_domain_base_url((string)($default['local_dev_url'] ?? 'http://127.0.0.1:7000')) ?: 'http://127.0.0.1:7000';

    $buildSet = function (string $base): array {
        $active = is_active_public_domain($base);
        return [
            'base'      => $base,
            'active'    => $active,
            'dashboard' => $base !== '' ? "{$base}/index.html" : '',
            'cron'      => $base !== '' ? "{$base}/cron.php" : '',
            'health'    => $base !== '' ? "{$base}/endpoint.php?r=/api/health" : '',
            'setup'     => $base !== '' ? "{$base}/server_setup.php" : '',
            'emergency' => $base !== '' ? "{$base}/emergency_cloud.html" : '',
        ];
    };

    $default['primary_domain'] = $primary;
    $default['backup_domain']  = $backup;
    $default['local_dev_url']  = $local;
    $default['failover_auto_ping_backup'] = !isset($default['failover_auto_ping_backup']) || !empty($default['failover_auto_ping_backup']);
    $default['resolved'] = [
        'primary' => $buildSet($primary),
        'backup'  => $buildSet($backup),
    ];
    return $default;
}

function save_domain_config(array $input): array {
    $current = get_domain_config();
    $primary = array_key_exists('primary_domain', $input)
        ? normalize_domain_base_url((string)$input['primary_domain'])
        : ($current['primary_domain'] ?? '');
    $backup = array_key_exists('backup_domain', $input)
        ? normalize_domain_base_url((string)$input['backup_domain'])
        : ($current['backup_domain'] ?? '');
    $local = array_key_exists('local_dev_url', $input)
        ? (normalize_domain_base_url((string)$input['local_dev_url']) ?: 'http://127.0.0.1:7000')
        : ($current['local_dev_url'] ?? 'http://127.0.0.1:7000');

    $extras = $current['extra_allowed_origins'] ?? [];
    if (array_key_exists('extra_allowed_origins', $input)) {
        if (is_string($input['extra_allowed_origins'])) {
            $extras = array_values(array_filter(array_map('normalize_domain_base_url', explode(',', $input['extra_allowed_origins']))));
        } elseif (is_array($input['extra_allowed_origins'])) {
            $extras = array_values(array_filter(array_map('normalize_domain_base_url', array_map('strval', $input['extra_allowed_origins']))));
        }
    }

    $extIds = $current['allowed_extension_ids'] ?? [];
    if (array_key_exists('allowed_extension_ids', $input)) {
        $rawList = is_string($input['allowed_extension_ids'])
            ? explode(',', $input['allowed_extension_ids'])
            : (is_array($input['allowed_extension_ids']) ? array_map('strval', $input['allowed_extension_ids']) : []);
        $extIds = array_values(array_filter(array_map(function ($v) {
            $id = strtolower(trim($v));
            return preg_match('/^[a-p]{32}$/', $id) ? $id : '';
        }, $rawList)));
    }

    $toSave = [
        'primary_domain'            => $primary,
        'backup_domain'             => $backup,
        'local_dev_url'             => $local,
        'extra_allowed_origins'     => $extras,
        'allowed_extension_ids'     => $extIds,
        'failover_auto_ping_backup' => array_key_exists('failover_auto_ping_backup', $input) ? !empty($input['failover_auto_ping_backup']) : !empty($current['failover_auto_ping_backup']),
        'notes'                     => (string)($current['notes'] ?? 'แก้ไขไฟล์นี้หรือผ่าน server_setup.php เมื่อเปลี่ยนโดเมนหรือเพิ่มโดเมนสำรอง'),
    ];
    $cfgPath = LP_PAO_ROOT . DIRECTORY_SEPARATOR . 'domain_config.json';
    write_json_file($cfgPath, $toSave);
    return get_domain_config();
}

function extract_url_origin(string $url): string {
    $u = normalize_domain_base_url($url);
    if ($u === '') return '';
    $p = parse_url($u);
    if (empty($p['scheme']) || empty($p['host'])) return '';
    return strtolower($p['scheme']) . '://' . strtolower($p['host']) . (isset($p['port']) ? ':' . $p['port'] : '');
}

function get_allowed_cors_origins(): array {
    $origins = [
        'http://localhost:7000',
        'http://127.0.0.1:7000',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'https://lampang.thaiwater.net',
        'https://citydata.traffy.in.th',
    ];
    $dCfg = get_domain_config();
    foreach ([$dCfg['primary_domain'] ?? '', $dCfg['backup_domain'] ?? '', $dCfg['local_dev_url'] ?? ''] as $u) {
        $org = extract_url_origin((string)$u);
        if ($org !== '') $origins[] = $org;
    }
    foreach (($dCfg['extra_allowed_origins'] ?? []) as $eu) {
        $org = extract_url_origin((string)$eu);
        if ($org !== '') $origins[] = $org;
    }
    return array_values(array_unique($origins));
}

require_once __DIR__ . '/security.php';
