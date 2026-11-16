<?php
// =========================================================================
// Water_System2 — Server & Local Configuration (Zero-Admin Drop-in Ready)
// Works both on Server Subfolder (http://server/Water_System2/) and Port 7000
// =========================================================================

date_default_timezone_set('Asia/Bangkok');

define('WATER_SYSTEM2_PORT', 7000);
define('WATER_SYSTEM2_ROOT', dirname(__DIR__));
define('WATER_SYSTEM2_UI_DIR', WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR . 'backend_ui');
define('WATER_SYSTEM2_RUNTIME_DIR', WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR . 'runtime' . DIRECTORY_SEPARATOR . 'php_7000');

if (!is_dir(WATER_SYSTEM2_RUNTIME_DIR)) {
    @mkdir(WATER_SYSTEM2_RUNTIME_DIR, 0777, true);
}

// Load .env if present
$envFile = WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR . '.env';
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
$dbOverrideFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'db_config.json';
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

    $flagFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'schema_ready_' . preg_replace('/[^a-zA-Z0-9_]/', '', $dbName) . '.flag';
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
    @file_put_contents($flagFile, date('c'));
    $checked = true;
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

function add_server_log(string $source, string $message): string {
    $datetimeStr = format_iso_datetime();
    $logStr = "[{$datetimeStr}] [{$source}] {$message}";

    $eventsFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'socketio_events.json';
    $eventsData = read_json_file($eventsFile, ['seq' => 0, 'events' => []]);
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
    write_json_file($eventsFile, ['seq' => $seq, 'events' => $events]);

    $logsFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'recent_logs.json';
    $logs = read_json_file($logsFile, []);
    array_unshift($logs, $logStr);
    if (count($logs) > 50) {
        $logs = array_slice($logs, 0, 50);
    }
    write_json_file($logsFile, $logs);

    $fetchLogPath = WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR . 'fetch_history.log';
    @file_put_contents($fetchLogPath, $logStr . PHP_EOL, FILE_APPEND);

    return $logStr;
}

function get_recent_logs(): array {
    $logsFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'recent_logs.json';
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
    $histPath = WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR . 'task_history.json';
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
    $histPath = WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR . 'task_history.json';
    $hist = get_task_history();
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

    if ($key !== '') {
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

    write_json_file($histPath, $hist);

    $stateFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'runtime_state.json';
    $state = read_json_file($stateFile, []);
    if ($status === 'success') {
        $state['lastDataReceived'] = time();
        if ($key === 'waterLevel') $state['lastWLDataReceived'] = time();
        if ($key === 'drought') $state['lastDroughtDataReceived'] = time();
        if ($key === 'pm25') $state['lastPM25DataReceived'] = time();
        if ($key === 'complaints') $state['lastComplaintsDataReceived'] = time();
    }
    write_json_file($stateFile, $state);
}

function get_app_config(): array {
    $configPath = WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR . 'config.json';
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
        if (empty($default['notifications']['smtp']['pass']) && env_val('SMTP_PASS') !== '') {
            $default['notifications']['smtp']['pass'] = env_val('SMTP_PASS');
        }
        if (empty($default['notifications']['smtp']['user']) && env_val('SMTP_USER') !== '') {
            $default['notifications']['smtp']['user'] = env_val('SMTP_USER');
        }
    }
    return $default;
}

function save_app_config(array $cfg) {
    $configPath = WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR . 'config.json';
    $toSave = $cfg;
    if (isset($toSave['notifications']['smtp']['pass'])) {
        $toSave['notifications']['smtp']['pass'] = '';
    }
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
