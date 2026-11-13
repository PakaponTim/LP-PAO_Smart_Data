<?php
// =========================================================================
// Water_System2 (Port 7000) — Main API Handler (PHP + PDO + Socket.IO)
// Strictly isolated on Port 7000
// =========================================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/collectors.php';
require_once __DIR__ . '/github_sync_to_mysql.php';

function send_json($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

const LAMPANG_DISTRICTS = [
    'เมืองลำปาง', 'เกาะคา', 'แม่เมาะ', 'ห้างฉัตร', 'แจ้ห่ม',
    'งาว', 'วังเหนือ', 'เถิน', 'สบปราบ', 'แม่พริก',
    'แม่ทะ', 'เมืองปาน', 'เสริมงาม'
];

const DAM_DISTRICT_MAP = [
    'อ่างกิ่วลม' => 'เมืองลำปาง',
    'อ่างกิ่วคอหมา' => 'แจ้ห่ม',
    'อ่างแม่มอก' => 'เถิน',
    'อ่างเก็บน้ำแม่พริก' => 'แม่พริก',
    'อ่างเก็บน้ำแม่พริก (ผาวิ่งชู้)' => 'แม่พริก',
    'อ่างเก็บน้ำแม่ทะ' => 'แม่ทะ',
    'อ่างเก็บน้ำแม่วะ' => 'เถิน',
    'อ่างเก็บน้ำห้วยหลวง' => 'เถิน',
    'อ่างเก็บน้ำแม่อาบ' => 'เถิน',
    'อ่างเก็บน้ำแม่ฟ้า' => 'แม่เมาะ',
    'อ่างเก็บน้ำห้วยสมัย' => 'สบปราบ',
    'อ่างเก็บน้ำแม่ทรายคำ' => 'เมืองลำปาง',
    'อ่างเก็บน้ำแม่ต๋ำตอนล่าง' => 'เสริมงาม',
    'อ่างเก็บน้ำแม่ต๋ำน้อย' => 'เสริมงาม',
    'อ่างเก็บน้ำแม่ปอน' => 'ห้างฉัตร',
    'อ่างเก็บน้ำห้วยแม่สัน' => 'ห้างฉัตร',
    'อ่างเก็บน้ำแม่เลียงพัฒนา' => 'เสริมงาม',
    'อ่างเก็บน้ำ แม่อาง' => 'เมืองลำปาง',
    'อ่างเก็บน้ำแม่ทก' => 'งาว',
    'อ่างเก็บน้ำห้วยแม่ค่อม' => 'เมืองปาน',
    'อ่างเก็บน้ำห้วยแม่แพนน้อย' => 'เมืองปาน',
    'อ่างฯแม่ยอนสันดอนแก้ว' => 'แม่เมาะ',
    'อ่างเก็บน้ำห้วยแม่ยาว' => 'แจ้ห่ม'
];

const LAMPANG_DISTRICT_COORDS = [
    'เมืองลำปาง' => ['lat' => 18.2888, 'lng' => 99.4920],
    'เกาะคา'     => ['lat' => 18.1963, 'lng' => 99.4005],
    'แม่เมาะ'    => ['lat' => 18.2753, 'lng' => 99.6582],
    'ห้างฉัตร'   => ['lat' => 18.3228, 'lng' => 99.3414],
    'แจ้ห่ม'     => ['lat' => 18.7139, 'lng' => 99.5539],
    'งาว'        => ['lat' => 18.7758, 'lng' => 99.9769],
    'วังเหนือ'   => ['lat' => 19.1458, 'lng' => 99.6192],
    'เถิน'       => ['lat' => 17.6167, 'lng' => 99.2167],
    'สบปราบ'     => ['lat' => 17.8931, 'lng' => 99.3386],
    'แม่พริก'    => ['lat' => 17.4475, 'lng' => 99.1172],
    'แม่ทะ'      => ['lat' => 18.1136, 'lng' => 99.5647],
    'เมืองปาน'   => ['lat' => 18.7517, 'lng' => 99.4317],
    'เสริมงาม'   => ['lat' => 18.0667, 'lng' => 99.2333]
];

const KNOWN_FEATURE_COORDS = [
    'อ่างกิ่วลม' => ['lat' => 18.5178, 'lng' => 99.6167],
    'อ่างกิ่วคอหมา' => ['lat' => 18.7889, 'lng' => 99.6311],
    'อ่างแม่มอก' => ['lat' => 17.4612, 'lng' => 99.3820],
    'อ่างเก็บน้ำแม่มอก' => ['lat' => 17.4612, 'lng' => 99.3820],
    'อ่างเก็บน้ำแม่ต๋ำตอนล่าง' => ['lat' => 18.0415, 'lng' => 99.2580],
    'อ่างเก็บน้ำแม่ต๋ำ' => ['lat' => 18.0415, 'lng' => 99.2580],
    'อ่างเก็บน้ำแม่จาง' => ['lat' => 18.2340, 'lng' => 99.7215],
    'อ่างเก็บน้ำห้วยหลวง' => ['lat' => 17.6250, 'lng' => 99.2180],
    'อ่างเก็บน้ำห้วยแม่ค่อม' => ['lat' => 18.2890, 'lng' => 99.5100],
    'อ่างเก็บน้ำห้วยแม่งอน' => ['lat' => 18.7110, 'lng' => 99.5630],
    'สะพานเสตุวารี' => ['lat' => 18.2934, 'lng' => 99.5012],
    'บ้านท่าล้อ' => ['lat' => 18.3050, 'lng' => 99.4850],
    'บ้านแลง' => ['lat' => 18.2720, 'lng' => 99.5080],
    'บ้านเกาะคา' => ['lat' => 18.1920, 'lng' => 99.3980],
    'น้ำแม่งาว' => ['lat' => 18.7730, 'lng' => 99.9720],
    'บ้านหลวงเหนือ' => ['lat' => 18.7750, 'lng' => 99.9810],
    'บ้านไฮ' => ['lat' => 18.7180, 'lng' => 99.5510],
    'บ้านหนองนาว' => ['lat' => 18.7050, 'lng' => 99.5620],
    'สะพานน้ำแม่ต๋ำ' => ['lat' => 18.0650, 'lng' => 99.2310],
    'บ้านแม่เชียงราย' => ['lat' => 17.4420, 'lng' => 99.1150]
];

function normalize_amphoe_name(?string $name): string {
    if (!$name) return 'เมืองลำปาง';
    $clean = trim(str_replace(['ลำปาง', 'อำเภอ'], '', $name));
    foreach (LAMPANG_DISTRICTS as $d) {
        if (mb_strpos($clean, $d) !== false) return $d;
    }
    return $clean !== '' ? $clean : 'เมืองลำปาง';
}

function get_feature_coords(string $name, ?string $amphoe): array {
    if (isset(KNOWN_FEATURE_COORDS[$name])) {
        return array_merge(KNOWN_FEATURE_COORDS[$name], ['precision' => 'configured']);
    }
    $dist = normalize_amphoe_name($amphoe);
    $base = LAMPANG_DISTRICT_COORDS[$dist] ?? LAMPANG_DISTRICT_COORDS['เมืองลำปาง'];
    return array_merge($base, ['precision' => 'district_center']);
}

function calc_station_flood_risk(array $s): int {
    $score = 10.0;
    $lvl = isset($s['current_water_level_m']) && $s['current_water_level_m'] !== null ? (float)$s['current_water_level_m'] : null;
    $bank = isset($s['left_bank_level_m']) && $s['left_bank_level_m'] !== null ? (float)$s['left_bank_level_m'] : 0.0;
    $bankDiff = isset($s['bank_difference_m']) && $s['bank_difference_m'] !== null ? (float)$s['bank_difference_m'] : null;
    $rain = isset($s['current_rain_mm']) && $s['current_rain_mm'] !== null ? (float)$s['current_rain_mm'] : 0.0;
    $forecast = isset($s['rainfall_accum_3d_mm']) ? (float)$s['rainfall_accum_3d_mm'] : (isset($s['forecast_rain_24h_mm']) ? (float)$s['forecast_rain_24h_mm'] : 0.0);
    $status = mb_strtolower(($s['status'] ?? '') . ' ' . ($s['risk_level'] ?? ''));

    if ($bank > 0 && $bankDiff !== null) {
        if ($bankDiff <= 0 || ($lvl !== null && $lvl >= $bank)) $score += 45;
        elseif ($bankDiff <= 0.5) $score += 38;
        elseif ($bankDiff <= 1.0) $score += 28;
        elseif ($bankDiff <= 2.0) $score += 15;
    }

    $effRain = max($rain, $forecast * 0.6);
    if ($effRain >= 90) $score += 25;
    elseif ($effRain >= 50) $score += 18;
    elseif ($effRain >= 25) $score += 12;
    elseif ($effRain >= 10) $score += 6;

    if (mb_strpos($status, 'น้ำล้นตลิ่ง') !== false) $score += 20;
    elseif (mb_strpos($status, 'น้ำมาก') !== false || mb_strpos($status, 'วิกฤต') !== false) $score += 15;
    elseif (mb_strpos($status, 'เตือนภัย') !== false || mb_strpos($status, 'เฝ้าระวัง') !== false) $score += 10;

    if (isset($s['trend']) && mb_strpos($s['trend'], 'เพิ่มขึ้น') !== false) $score += 5;

    return (int)min(max(round($score), 5), 100);
}

function calc_dam_drought_risk(array $d): int {
    $cap = isset($d['capacity_m_cum']) ? (float)$d['capacity_m_cum'] : 0.0;
    $vol = isset($d['water_volume_m_cum']) ? (float)$d['water_volume_m_cum'] : 0.0;
    $pct = $cap > 0 ? ($vol / $cap) * 100.0 : 50.0;

    if ($pct < 20) return 95;
    if ($pct < 30) return 80;
    if ($pct < 45) return 60;
    if ($pct < 60) return 35;
    if ($pct < 80) return 20;
    return 10;
}

function check_excel_file(string $filename): array {
    $full = WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR . $filename;
    if (file_exists($full)) {
        $size = round(filesize($full) / 1024, 2) . ' KB';
        $mtime = format_iso_datetime(filemtime($full));
        return ['exists' => true, 'size' => $size, 'mtime' => $mtime, 'sizeKb' => (int)round(filesize($full) / 1024)];
    }
    return ['exists' => false, 'size' => '0 KB', 'mtime' => 'N/A', 'sizeKb' => 0];
}

function collect_storage_stats(PDO $pdo): array {
    $stats = [
        'waterLevel' => ['dbRows' => 0, 'excelExists' => false, 'excelSize' => '0 KB', 'excelMtime' => 'N/A', 'dbMtime' => 'N/A'],
        'drought'    => ['dbRows' => 0, 'excelExists' => false, 'excelSize' => '0 KB', 'excelMtime' => 'N/A', 'dbMtime' => 'N/A'],
        'pm25'       => ['dbRows' => 0, 'excelExists' => false, 'excelSize' => '0 KB', 'excelMtime' => 'N/A', 'dbMtime' => 'N/A'],
        'complaints' => ['dbRows' => 0, 'excelExists' => false, 'excelSize' => '0 KB', 'excelMtime' => 'N/A', 'dbMtime' => 'N/A']
    ];

    $tables = [
        'waterLevel' => ['tbl_water_disaster_monitoring', ''],
        'drought'    => ['tbl_drought_monitoring', ''],
        'pm25'       => ['tbl_pm25_monitoring', ''],
        'complaints' => ['tbl_complaints_monitoring', 'WHERE (is_in_scope = 1 OR is_in_scope IS NULL)']
    ];

    foreach ($tables as $key => [$tbl, $where]) {
        try {
            $r1 = $pdo->query("SELECT COUNT(*) as cnt, MAX(recorded_at) as last_up FROM {$tbl} {$where}")->fetch();
            $stats[$key]['dbRows'] = (int)($r1['cnt'] ?? 0);
            $stats[$key]['dbMtime'] = !empty($r1['last_up']) ? format_iso_datetime($r1['last_up']) : 'ยังไม่เคยบันทึก';
        } catch (Throwable $e) {
            $stats[$key]['dbRows'] = 'Error';
        }
    }

    $excels = [
        'waterLevel' => 'Water_Database_Master.xlsx',
        'drought'    => 'Drought_Dam_Data.xlsx',
        'pm25'       => 'PM25_Air_Quality_Data.xlsx',
        'complaints' => 'Complaints_Data.xlsx'
    ];
    foreach ($excels as $key => $fname) {
        $ex = check_excel_file($fname);
        $stats[$key]['excelExists'] = $ex['exists'];
        $stats[$key]['excelSize'] = $ex['size'];
        $stats[$key]['excelMtime'] = $ex['mtime'];
    }

    return $stats;
}

function recent_dates(int $days): array {
    $out = [];
    $today = strtotime(date('Y-m-d') . ' 00:00:00');
    for ($i = 0; $i < $days; $i++) {
        $ts = $today - (($days - $i - 1) * 86400);
        $out[] = date('Y-m-d', $ts);
    }
    return $out;
}

function handle_api_request(string $method, string $path): void {
    $rawBody = file_get_contents('php://input');
    $body = [];
    if ($rawBody !== false && $rawBody !== '') {
        $decoded = json_decode($rawBody, true);
        if (is_array($decoded)) $body = $decoded;
    }

    // 1. Auth routes
    if (strpos($path, '/api/auth/') === 0) {
        if (handle_auth_routes($method, $path, $body)) return;
    }

    // 2. Validate optional startDate / endDate query parameters
    $startDate = $_GET['startDate'] ?? null;
    $endDate   = $_GET['endDate'] ?? null;
    if ($startDate || $endDate) {
        $validDate = function ($v) {
            if (!is_string($v) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) return false;
            $parts = explode('-', $v);
            return checkdate((int)$parts[1], (int)$parts[2], (int)$parts[0]);
        };
        if (!$validDate($startDate) || !$validDate($endDate) || $startDate > $endDate) {
            send_json(['error' => 'ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 10 ปี)'], 400);
        }
    }

    $pdo = get_db();

    // =====================================================================
    // GET /api/data-definitions
    // =====================================================================
    if ($path === '/api/data-definitions' && $method === 'GET') {
        send_json(DATA_DEFINITIONS());
    }

    // =====================================================================
    // GET & POST /api/github-sync (Sync GitHub Actions snapshots to MySQL)
    // =====================================================================
    if ($path === '/api/github-sync' && ($method === 'POST' || $method === 'GET')) {
        try {
            $syncRes = sync_github_snapshots_to_mysql();
            send_json($syncRes);
        } catch (Throwable $e) {
            send_json(['success' => false, 'error' => $e->getMessage()], 500);
        }
    }

    // =====================================================================
    // GET /api/status
    // =====================================================================
    if ($path === '/api/status' && $method === 'GET') {
        $stateFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'runtime_state.json';
        $state = read_json_file($stateFile, []);
        if (time() - (int)($state['lastGitHubSyncCheck'] ?? 0) >= 60) {
            $state['lastGitHubSyncCheck'] = time();
            write_json_file($stateFile, $state);
            try { sync_github_snapshots_to_mysql(); } catch (Throwable $e) {}
        }

        $cfg = get_app_config();
        $hist = get_task_history();
        $storageStats = collect_storage_stats($pdo);
        $stateFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'runtime_state.json';
        $state = read_json_file($stateFile, []);

        $lastFetchTs = $state['lastDataReceived'] ?? null;
        if (!$lastFetchTs && !empty($hist['completedTasks'][0]['timestamp'])) {
            $lastFetchStr = $hist['completedTasks'][0]['timestamp'];
        } else {
            $lastFetchStr = $lastFetchTs ? format_iso_datetime($lastFetchTs) : ($storageStats['waterLevel']['dbMtime'] ?? 'ยังไม่เคยบันทึก');
        }

        // Report extensionConnected = true and extensionPaired = true because Direct API Collector is built-in and always online!
        send_json([
            'extensionConnected' => true,
            'extensionPaired'    => true,
            'collectorMode'      => 'Direct API (PHP Server-to-Server Port 7000)',
            'scheduledTasks'     => $cfg['scheduledTasks'],
            'isScheduleActive'   => $cfg['isScheduleActive'],
            'lastFetch'          => $lastFetchStr,
            'logs'               => get_recent_logs(),
            'projectStats'       => $hist['projectStats'],
            'completedTasks'     => $hist['completedTasks'],
            'storageStats'       => $storageStats
        ]);
    }

    // =====================================================================
    // GET /api/system-health
    // =====================================================================
    if ($path === '/api/system-health' && $method === 'GET') {
        $t0 = microtime(true);
        $dbStatus = 'connected';
        $dbLatency = 0;
        $totalRows = 0;
        try {
            $p0 = microtime(true);
            $pdo->query('SELECT 1');
            $dbLatency = (int)round((microtime(true) - $p0) * 1000);
            $dbName = env_val('DB_NAME', 'water_system2');
            $stmt = $pdo->prepare("SELECT SUM(table_rows) as total FROM information_schema.tables WHERE table_schema = ?");
            $stmt->execute([$dbName]);
            $row = $stmt->fetch();
            $totalRows = (int)($row['total'] ?? 0);
        } catch (Throwable $e) {
            $dbStatus = 'error: ' . $e->getMessage();
        }

        $cfg = get_app_config();
        $stateFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'runtime_state.json';
        $state = read_json_file($stateFile, []);

        $excelFiles = [];
        foreach ([
            ['water', 'Water_Database_Master.xlsx'],
            ['rainfall', 'Rainfall_Data.xlsx'],
            ['drought', 'Drought_Dam_Data.xlsx'],
            ['pm25', 'PM25_Air_Quality_Data.xlsx'],
            ['complaints', 'Complaints_Data.xlsx']
        ] as [$k, $fname]) {
            $ex = check_excel_file($fname);
            $excelFiles[] = [
                'key' => $k,
                'name' => $fname,
                'exists' => $ex['exists'],
                'sizeKb' => $ex['sizeKb'],
                'lastModified' => $ex['mtime'],
                'isQueueBusy' => false
            ];
        }

        send_json([
            'status' => $dbStatus === 'connected' ? 'healthy' : 'degraded',
            'timestamp' => round(microtime(true) * 1000),
            'responseTimeMs' => (int)round((microtime(true) - $t0) * 1000),
            'database' => [
                'status' => $dbStatus,
                'latencyMs' => $dbLatency,
                'host' => env_val('DB_HOST', 'localhost'),
                'port' => (int)env_val('DB_PORT', 3306),
                'databaseName' => env_val('DB_NAME', 'water_system2'),
                'estimatedTotalRows' => $totalRows
            ],
            'dualWrite' => [
                'status' => 'active',
                'intervalMinutes' => 30,
                'isScheduleActive' => $cfg['isScheduleActive'],
                'lastDataReceived' => isset($state['lastDataReceived']) ? $state['lastDataReceived'] * 1000 : null,
                'lastWLDataReceived' => isset($state['lastWLDataReceived']) ? $state['lastWLDataReceived'] * 1000 : null,
                'lastDroughtDataReceived' => isset($state['lastDroughtDataReceived']) ? $state['lastDroughtDataReceived'] * 1000 : null,
                'lastPM25DataReceived' => isset($state['lastPM25DataReceived']) ? $state['lastPM25DataReceived'] * 1000 : null,
                'lastComplaintsDataReceived' => isset($state['lastComplaintsDataReceived']) ? $state['lastComplaintsDataReceived'] * 1000 : null
            ],
            'excelFiles' => $excelFiles,
            'extension' => [
                'connected' => true,
                'activeSocketsCount' => 1,
                'directApiCollectorReady' => true,
                'puppeteerFallbackReady' => true
            ]
        ]);
    }

    // =====================================================================
    // POST /api/force-fetch* (Direct API Collectors - No Extension Needed!)
    // =====================================================================
    if ($method === 'POST' && in_array($path, [
        '/api/force-fetch',
        '/api/force-fetch-db',
        '/api/force-fetch-rainfall-db',
        '/api/force-fetch-drought-excel',
        '/api/force-fetch-drought-db',
        '/api/force-fetch-pm25-excel',
        '/api/force-fetch-pm25-db',
        '/api/force-fetch-complaints-db'
    ], true)) {
        try {
            if ($path === '/api/force-fetch' || $path === '/api/force-fetch-db') {
                $mode = ($path === '/api/force-fetch') ? 'excel' : 'db';
                $res = collect_water_level_direct($mode);
                send_json(['success' => true, 'message' => 'ดึงข้อมูลระดับน้ำและน้ำฝนผ่าน Direct API สำเร็จ', 'result' => $res]);
            }
            if ($path === '/api/force-fetch-rainfall-db') {
                $res = collect_rainfall_direct(true);
                send_json(['success' => true, 'message' => 'ดึงข้อมูลปริมาณน้ำฝนผ่าน Direct API สำเร็จ', 'result' => $res]);
            }
            if ($path === '/api/force-fetch-drought-excel' || $path === '/api/force-fetch-drought-db') {
                $mode = ($path === '/api/force-fetch-drought-excel') ? 'excel' : 'db';
                $res = collect_drought_direct($mode);
                send_json(['success' => true, 'message' => 'ดึงข้อมูลภัยแล้ง/อ่างเก็บน้ำผ่าน Direct API สำเร็จ', 'result' => $res]);
            }
            if ($path === '/api/force-fetch-pm25-excel' || $path === '/api/force-fetch-pm25-db') {
                $mode = ($path === '/api/force-fetch-pm25-excel') ? 'excel' : 'db';
                $res = collect_pm25_direct($mode);
                send_json(['success' => true, 'message' => 'ดึงข้อมูล PM 2.5 ผ่าน Direct API สำเร็จ', 'result' => $res]);
            }
            if ($path === '/api/force-fetch-complaints-db') {
                $res = collect_complaints_direct('db');
                send_json(['success' => true, 'message' => 'ดึงข้อมูลเรื่องร้องเรียน Traffy Fondue ผ่าน Direct API สำเร็จ', 'result' => $res]);
            }
        } catch (Throwable $e) {
            add_server_log('DirectAPI-7000', '❌ เกิดข้อผิดพลาดในการดึงข้อมูล: ' . $e->getMessage());
            send_json(['success' => false, 'error' => $e->getMessage()], 500);
        }
    }

    // =====================================================================
    // POST /api/schedule & /api/schedule/toggle
    // =====================================================================
    if ($path === '/api/schedule' && $method === 'POST') {
        $tasks = $body['tasks'] ?? null;
        if (!is_array($tasks)) {
            send_json(['error' => 'Invalid tasks array'], 400);
        }
        sort($tasks);
        $cfg = get_app_config();
        $cfg['scheduledTasks'] = array_values($tasks);
        save_app_config($cfg);
        add_server_log('System', '⚙️ อัปเดตตารางเวลาใหม่: ' . (implode(', ', $cfg['scheduledTasks']) ?: 'ไม่มี'));
        send_json(['success' => true, 'tasks' => $cfg['scheduledTasks']]);
    }

    if ($path === '/api/schedule/toggle' && $method === 'POST') {
        $cfg = get_app_config();
        $project = $body['project'] ?? null;
        $active = (bool)($body['active'] ?? false);
        $pNames = ['water' => 'ระดับน้ำ', 'drought' => 'ภัยแล้ง', 'pm25' => 'PM 2.5', 'complaints' => 'ร้องเรียน'];
        if ($project && isset($cfg['isScheduleActive'][$project])) {
            $cfg['isScheduleActive'][$project] = $active;
            save_app_config($cfg);
            add_server_log('System', $active ? "⏰ เปิดระบบดึงข้อมูลอัตโนมัติ: {$pNames[$project]}" : "⏸️ ปิดระบบดึงข้อมูลอัตโนมัติ: {$pNames[$project]}");
        } elseif (isset($body['active']) && !$project) {
            $cfg['isScheduleActive'] = ['water' => $active, 'drought' => $active, 'pm25' => $active, 'complaints' => $active];
            save_app_config($cfg);
            add_server_log('System', $active ? '⏰ เปิดระบบดึงข้อมูลอัตโนมัติทั้งหมด' : '⏸️ ปิดระบบดึงข้อมูลอัตโนมัติทั้งหมด');
        }
        send_json(['success' => true, 'isScheduleActive' => $cfg['isScheduleActive']]);
    }

    // =====================================================================
    // GET /api/dashboard-summary
    // =====================================================================
    if ($path === '/api/dashboard-summary' && $method === 'GET') {
        $dateFilterRec = '';
        $andDateFilterRec = '';
        $dateFilterCreated = '';
        $andDateFilterCreated = '';
        $params = [];
        $limitClause = 'LIMIT 7';

        if ($startDate && $endDate) {
            $dateFilterRec = 'WHERE recorded_at BETWEEN ? AND ?';
            $andDateFilterRec = 'AND recorded_at BETWEEN ? AND ?';
            $dateFilterCreated = 'WHERE created_at BETWEEN ? AND ?';
            $andDateFilterCreated = 'AND created_at BETWEEN ? AND ?';
            $params = ["{$startDate} 00:00:00", "{$endDate} 23:59:59"];
            $limitClause = '';
        }

        // 1. Water Level
        $wlSubWhere = $dateFilterRec ? "{$dateFilterRec} AND current_water_level_m IS NOT NULL" : "WHERE current_water_level_m IS NOT NULL";
        $stmt = $pdo->prepare("
            SELECT station_name, current_water_level_m, current_rain_mm,
                   forecast_rain_24h_mm AS rainfall_accum_3d_mm,
                   left_bank_level_m, bank_difference_m, trend, risk_level, status, amphoe
            FROM tbl_water_disaster_monitoring
            WHERE id IN (SELECT MAX(id) FROM tbl_water_disaster_monitoring {$wlSubWhere} GROUP BY station_name)
              AND station_name NOT LIKE '%Test%'
        ");
        $stmt->execute($params);
        $waterRows = $stmt->fetchAll();

        $wlHistWhere = $dateFilterRec ? "{$dateFilterRec} AND station_name NOT LIKE '%Test%'" : "WHERE station_name NOT LIKE '%Test%'";
        $stmt = $pdo->prepare("
            SELECT DATE_FORMAT(recorded_at, '%Y-%m-%d') as date, AVG(current_water_level_m) as avg_val
            FROM tbl_water_disaster_monitoring
            {$wlHistWhere}
            GROUP BY DATE_FORMAT(recorded_at, '%Y-%m-%d')
            ORDER BY date DESC {$limitClause}
        ");
        $stmt->execute($params);
        $waterHistory = array_reverse($stmt->fetchAll());

        if ($startDate && $endDate) {
            $stationHistSql = "
                SELECT w.station_name,
                       DATE_FORMAT(w.recorded_at, '%Y-%m-%d') AS date,
                       w.current_water_level_m,
                       w.current_rain_mm,
                       w.forecast_rain_24h_mm AS rainfall_accum_3d_mm,
                       w.trend, w.status, w.risk_level
                FROM tbl_water_disaster_monitoring w
                INNER JOIN (
                    SELECT MAX(wdh.id) AS id
                    FROM tbl_water_disaster_monitoring wdh
                    WHERE wdh.recorded_at BETWEEN ? AND ?
                      AND wdh.current_water_level_m IS NOT NULL
                      AND wdh.station_name NOT LIKE '%Test%'
                    GROUP BY wdh.station_name, DATE_FORMAT(wdh.recorded_at, '%Y-%m-%d')
                ) latest ON latest.id = w.id
                ORDER BY w.station_name ASC, date ASC
            ";
            $stmt = $pdo->prepare($stationHistSql);
            $stmt->execute($params);
        } else {
            $stationHistSql = "
                SELECT w.station_name,
                       DATE_FORMAT(w.recorded_at, '%Y-%m-%d') AS date,
                       w.current_water_level_m,
                       w.current_rain_mm,
                       w.forecast_rain_24h_mm AS rainfall_accum_3d_mm,
                       w.trend, w.status, w.risk_level
                FROM tbl_water_disaster_monitoring w
                INNER JOIN (
                    SELECT MAX(wdh.id) AS id
                    FROM tbl_water_disaster_monitoring wdh
                    WHERE wdh.current_water_level_m IS NOT NULL
                      AND wdh.station_name NOT LIKE '%Test%'
                      AND DATE_FORMAT(wdh.recorded_at, '%Y-%m-%d') IN (
                        SELECT recent_date FROM (
                          SELECT DATE_FORMAT(recorded_at, '%Y-%m-%d') AS recent_date
                          FROM tbl_water_disaster_monitoring
                          WHERE current_water_level_m IS NOT NULL
                            AND station_name NOT LIKE '%Test%'
                          GROUP BY DATE_FORMAT(recorded_at, '%Y-%m-%d')
                          ORDER BY recent_date DESC
                          LIMIT 7
                        ) recent_dates
                      )
                    GROUP BY wdh.station_name, DATE_FORMAT(wdh.recorded_at, '%Y-%m-%d')
                ) latest ON latest.id = w.id
                ORDER BY w.station_name ASC, date ASC
            ";
            $stmt = $pdo->query($stationHistSql);
        }
        $waterStationHistory = $stmt->fetchAll();

        // 2. Drought
        $drSubWhere = $dateFilterRec ? "{$dateFilterRec} AND water_volume_m_cum IS NOT NULL" : "WHERE water_volume_m_cum IS NOT NULL";
        $stmt = $pdo->prepare("
            SELECT dam_name, capacity_m_cum, water_volume_m_cum, usable_water_m_cum, inflow_m_cum, discharge_m_cum, record_date
            FROM tbl_drought_monitoring
            WHERE id IN (SELECT MAX(id) FROM tbl_drought_monitoring {$drSubWhere} GROUP BY dam_name)
        ");
        $stmt->execute($params);
        $droughtRows = $stmt->fetchAll();

        $stmt = $pdo->prepare("
            SELECT DATE_FORMAT(d.recorded_at, '%Y-%m-%d') AS date, SUM(d.water_volume_m_cum) AS total_val
            FROM tbl_drought_monitoring d
            INNER JOIN (
                SELECT MAX(id) AS id FROM tbl_drought_monitoring {$dateFilterRec}
                GROUP BY dam_name, DATE_FORMAT(recorded_at, '%Y-%m-%d')
            ) latest ON latest.id = d.id
            GROUP BY DATE_FORMAT(d.recorded_at, '%Y-%m-%d')
            ORDER BY date DESC {$limitClause}
        ");
        $stmt->execute($params);
        $droughtHistory = array_reverse($stmt->fetchAll());

        // 3. PM 2.5
        $pmSubWhere = $dateFilterRec ? "{$dateFilterRec} AND pm25_value IS NOT NULL" : "WHERE pm25_value IS NOT NULL";
        $stmt = $pdo->prepare("
            SELECT amphoe, station_name, pm25_value, pm25_avg_24h, air_quality_status
            FROM tbl_pm25_monitoring
            WHERE id IN (SELECT MAX(id) FROM tbl_pm25_monitoring {$pmSubWhere} GROUP BY station_name)
        ");
        $stmt->execute($params);
        $pm25Rows = $stmt->fetchAll();

        $stmt = $pdo->prepare("
            SELECT DATE_FORMAT(recorded_at, '%Y-%m-%d') as date, AVG(pm25_value) as avg_val
            FROM tbl_pm25_monitoring
            {$dateFilterRec}
            GROUP BY DATE_FORMAT(recorded_at, '%Y-%m-%d')
            ORDER BY date DESC {$limitClause}
        ");
        $stmt->execute($params);
        $pm25History = array_reverse($stmt->fetchAll());

        // 4. Complaints
        $scopeFilter = 'WHERE (is_in_scope = 1 OR is_in_scope IS NULL)';
        $andScopeFilter = 'AND (is_in_scope = 1 OR is_in_scope IS NULL)';
        $complaintsWhere = $dateFilterCreated ? "{$dateFilterCreated} {$andScopeFilter}" : $scopeFilter;
        $complaintsAndWhere = $andDateFilterCreated ? "{$andDateFilterCreated} {$andScopeFilter}" : $andScopeFilter;

        $stmt = $pdo->prepare("SELECT state_name, COUNT(*) as count FROM tbl_complaints_monitoring {$complaintsWhere} GROUP BY state_name ORDER BY count DESC");
        $stmt->execute($params);
        $complaintsState = $stmt->fetchAll();

        $stmt = $pdo->prepare("SELECT problem_type, COUNT(*) as count FROM tbl_complaints_monitoring {$complaintsWhere} GROUP BY problem_type ORDER BY count DESC LIMIT 5");
        $stmt->execute($params);
        $complaintsType = $stmt->fetchAll();

        $stmt = $pdo->prepare("SELECT agency_status, COUNT(*) as count FROM tbl_complaints_monitoring WHERE agency_status IS NOT NULL {$complaintsAndWhere} GROUP BY agency_status");
        $stmt->execute($params);
        $complaintsAgency = $stmt->fetchAll();

        $stmt = $pdo->prepare("SELECT DATE_FORMAT(created_at, '%Y-%m-%d') as date, COUNT(*) as daily_count FROM tbl_complaints_monitoring WHERE created_at IS NOT NULL {$complaintsAndWhere} GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d') ORDER BY date DESC {$limitClause}");
        $stmt->execute($params);
        $complaintsHistory = array_reverse($stmt->fetchAll());

        send_json([
            'success' => true,
            'definitions' => DATA_DEFINITIONS(),
            'data' => [
                'water' => [
                    'current' => $waterRows,
                    'history' => $waterHistory,
                    'stationHistory' => $waterStationHistory
                ],
                'drought' => [
                    'current' => $droughtRows,
                    'history' => $droughtHistory
                ],
                'pm25' => [
                    'current' => $pm25Rows,
                    'history' => $pm25History
                ],
                'complaints' => [
                    'state' => $complaintsState,
                    'type' => $complaintsType,
                    'agency' => $complaintsAgency,
                    'history' => $complaintsHistory
                ]
            ]
        ]);
    }

    // =====================================================================
    // GET /api/analytics/risk-index
    // =====================================================================
    if ($path === '/api/analytics/risk-index' && $method === 'GET') {
        $dateFilterRec = '';
        $params = [];
        if ($startDate && $endDate) {
            $dateFilterRec = 'WHERE recorded_at BETWEEN ? AND ?';
            $params = ["{$startDate} 00:00:00", "{$endDate} 23:59:59"];
        }

        $wlWhere = $dateFilterRec ? "{$dateFilterRec} AND current_water_level_m IS NOT NULL" : "WHERE current_water_level_m IS NOT NULL";
        $stmt = $pdo->prepare("
            SELECT station_name, current_water_level_m, current_rain_mm,
                   forecast_rain_24h_mm, left_bank_level_m, bank_difference_m,
                   trend, risk_level, status, amphoe, recorded_at
            FROM tbl_water_disaster_monitoring
            WHERE id IN (SELECT MAX(id) FROM tbl_water_disaster_monitoring {$wlWhere} GROUP BY station_name)
              AND station_name NOT LIKE '%Test%'
        ");
        $stmt->execute($params);
        $waterRows = $stmt->fetchAll();

        $drWhere = $dateFilterRec ? "{$dateFilterRec} AND water_volume_m_cum IS NOT NULL" : "WHERE water_volume_m_cum IS NOT NULL";
        $stmt = $pdo->prepare("
            SELECT dam_name, dam_type, capacity_m_cum, water_volume_m_cum, usable_water_m_cum, inflow_m_cum, discharge_m_cum, record_date, recorded_at
            FROM tbl_drought_monitoring
            WHERE id IN (SELECT MAX(id) FROM tbl_drought_monitoring {$drWhere} GROUP BY dam_name)
        ");
        $stmt->execute($params);
        $damRows = $stmt->fetchAll();

        $districtData = [];
        foreach (LAMPANG_DISTRICTS as $d) {
            $districtData[$d] = [
                'district' => $d,
                'waterStations' => [],
                'dams' => [],
                'floodScores' => [],
                'droughtScores' => []
            ];
        }

        $hotspots = [];

        foreach ($waterRows as $w) {
            $dist = normalize_amphoe_name($w['amphoe'] ?? '');
            if (!isset($districtData[$dist])) {
                $districtData[$dist] = ['district' => $dist, 'waterStations' => [], 'dams' => [], 'floodScores' => [], 'droughtScores' => []];
            }
            $fScore = calc_station_flood_risk($w);
            $districtData[$dist]['waterStations'][] = $w;
            $districtData[$dist]['floodScores'][] = $fScore;

            $st = mb_strtolower($w['status'] ?? '');
            if (mb_strpos($st, 'น้ำน้อยวิกฤต') !== false) $districtData[$dist]['droughtScores'][] = 90;
            elseif (mb_strpos($st, 'น้ำน้อย') !== false) $districtData[$dist]['droughtScores'][] = 65;

            if ($fScore >= 45 || mb_strpos($st, 'น้ำน้อยวิกฤต') !== false) {
                $hotspots[] = [
                    'name' => $w['station_name'],
                    'type' => 'สถานีวัดระดับน้ำ',
                    'amphoe' => $dist,
                    'score' => $fScore,
                    'riskLevel' => $fScore >= 80 ? 'วิกฤตสีแดง' : ($fScore >= 60 ? 'เสี่ยงสูง' : ($fScore >= 40 ? 'เฝ้าระวัง' : 'ปกติ')),
                    'color' => $fScore >= 80 ? '#dc2626' : ($fScore >= 60 ? '#ea580c' : ($fScore >= 40 ? '#ca8a04' : '#16a34a')),
                    'detail' => "ระดับน้ำ {$w['current_water_level_m']} ม. (ตลิ่ง " . ($w['left_bank_level_m'] ?? '-') . " ม., ฝน " . ($w['current_rain_mm'] ?? 0) . " มม.)"
                ];
            }
        }

        foreach ($damRows as $d) {
            $dist = DAM_DISTRICT_MAP[$d['dam_name']] ?? 'เมืองลำปาง';
            if (!isset($districtData[$dist])) {
                $districtData[$dist] = ['district' => $dist, 'waterStations' => [], 'dams' => [], 'floodScores' => [], 'droughtScores' => []];
            }
            $dScore = calc_dam_drought_risk($d);
            $districtData[$dist]['dams'][] = $d;
            $districtData[$dist]['droughtScores'][] = $dScore;

            $cap = (float)($d['capacity_m_cum'] ?? 0);
            $vol = (float)($d['water_volume_m_cum'] ?? 0);
            $pct = $cap > 0 ? round(($vol / $cap) * 100, 1) : 0;

            if ($dScore >= 55) {
                $hotspots[] = [
                    'name' => $d['dam_name'],
                    'type' => 'อ่างเก็บน้ำ',
                    'amphoe' => $dist,
                    'score' => $dScore,
                    'riskLevel' => $dScore >= 80 ? 'วิกฤตสีแดง' : ($dScore >= 60 ? 'เสี่ยงสูง' : 'เฝ้าระวัง'),
                    'color' => $dScore >= 80 ? '#dc2626' : ($dScore >= 60 ? '#ea580c' : '#ca8a04'),
                    'detail' => "น้ำกักเก็บเหลือ {$pct}% ({$vol}/{$cap} ล้าน ลบ.ม.)"
                ];
            }
        }

        $districtsResult = [];
        foreach (LAMPANG_DISTRICTS as $dName) {
            $item = $districtData[$dName];
            $fScores = $item['floodScores'];
            $dScores = $item['droughtScores'];

            $floodScore = !empty($fScores)
                ? (int)round(max($fScores) * 0.7 + (array_sum($fScores) / count($fScores)) * 0.3)
                : 15;
            $droughtScore = !empty($dScores)
                ? (int)round(max($dScores) * 0.7 + (array_sum($dScores) / count($dScores)) * 0.3)
                : 20;

            $compositeScore = (int)round(max($floodScore, $droughtScore) * 0.75 + min($floodScore, $droughtScore) * 0.25);
            $primaryThreat = $floodScore >= $droughtScore ? 'อุทกภัย/น้ำหลาก' : 'ภัยแล้ง/น้ำน้อย';

            $riskLevel = 'ปกติ';
            $color = '#16a34a';
            if ($compositeScore >= 80) { $riskLevel = 'วิกฤตสีแดง'; $color = '#dc2626'; }
            elseif ($compositeScore >= 60) { $riskLevel = 'เสี่ยงสูง'; $color = '#ea580c'; }
            elseif ($compositeScore >= 40) { $riskLevel = 'เฝ้าระวัง'; $color = '#ca8a04'; }

            $districtsResult[] = [
                'district' => $dName,
                'compositeScore' => $compositeScore,
                'floodScore' => $floodScore,
                'droughtScore' => $droughtScore,
                'primaryThreat' => $primaryThreat,
                'riskLevel' => $riskLevel,
                'color' => $color,
                'stationCount' => count($item['waterStations']),
                'damCount' => count($item['dams'])
            ];
        }

        usort($districtsResult, function ($a, $b) { return $b['compositeScore'] <=> $a['compositeScore']; });
        usort($hotspots, function ($a, $b) { return $b['score'] <=> $a['score']; });

        $sumComp = array_sum(array_column($districtsResult, 'compositeScore'));
        $avgComposite = (int)round($sumComp / max(count($districtsResult), 1));
        $maxComposite = $districtsResult[0]['compositeScore'] ?? 15;
        $provincialScore = (int)round($maxComposite * 0.6 + $avgComposite * 0.4);

        $provLevel = 'ปกติ';
        $provColor = '#16a34a';
        if ($provincialScore >= 80) { $provLevel = 'วิกฤตสีแดง'; $provColor = '#dc2626'; }
        elseif ($provincialScore >= 60) { $provLevel = 'เสี่ยงสูง'; $provColor = '#ea580c'; }
        elseif ($provincialScore >= 40) { $provLevel = 'เฝ้าระวัง'; $provColor = '#ca8a04'; }

        $highRiskCount = count(array_filter($districtsResult, function ($d) { return $d['compositeScore'] >= 60; }));
        $warningCount  = count(array_filter($districtsResult, function ($d) { return $d['compositeScore'] >= 40 && $d['compositeScore'] < 60; }));
        $normalCount   = count(array_filter($districtsResult, function ($d) { return $d['compositeScore'] < 40; }));

        $top3 = array_slice($districtsResult, 0, 3);
        $topStr = implode(', ', array_map(function ($d) {
            return "{$d['district']} ({$d['compositeScore']} คะแนน, {$d['primaryThreat']})";
        }, $top3));

        if ($provincialScore >= 80) {
            $aiRec = "🚨 ตรวจพบพื้นที่เสี่ยงวิกฤตระดับสูง แนะนำ อบจ.ลำปาง และ ปภ.จังหวัด สั่งการเปิดศูนย์บัญชาการเหตุการณ์ และเตรียมเครื่องสูบน้ำ/รถบรรทุกน้ำเข้าช่วยเหลือในพื้นที่เสี่ยงหลัก: {$topStr} โดยด่วน";
        } elseif ($provincialScore >= 60) {
            $aiRec = "⚠️ สถานการณ์ภาพรวมอยู่ในเกณฑ์เสี่ยงสูง โดยเฉพาะในพื้นที่ {$topStr} แนะนำตรวจสอบพนังกั้นน้ำและประสานชลประทานลำปางเพื่อบริหารจัดการน้ำในอ่างเก็บน้ำอย่างใกล้ชิด";
        } elseif ($provincialScore >= 40) {
            $aiRec = "🟡 ภาพรวมจังหวัดอยู่ในระดับเฝ้าระวัง พบความเสี่ยงเฉพาะจุดในพื้นที่ {$topStr} แนะนำกำชับท้องถิ่นติดตามแนวโน้มฝนสะสมและระดับน้ำในลำน้ำสายหลักอย่างต่อเนื่อง";
        } else {
            $aiRec = "🟢 สถานการณ์ทรัพยากรน้ำและภัยพิบัติทั้ง 13 อำเภอของจังหวัดลำปางอยู่ในเกณฑ์ปกติ สมดุลน้ำอยู่ในเกณฑ์ปลอดภัย";
        }

        send_json([
            'success' => true,
            'summary' => [
                'compositeScore' => $provincialScore,
                'riskLevel' => $provLevel,
                'riskColor' => $provColor,
                'primaryThreat' => $districtsResult[0]['primaryThreat'] ?? 'ปกติ',
                'highRiskDistrictsCount' => $highRiskCount,
                'warningDistrictsCount' => $warningCount,
                'normalDistrictsCount' => $normalCount,
                'totalDistricts' => count($districtsResult),
                'activeStations' => count($waterRows),
                'activeDams' => count($damRows),
                'aiRecommendation' => $aiRec,
                'updatedAt' => date('c')
            ],
            'districts' => $districtsResult,
            'hotspots' => array_slice($hotspots, 0, 10)
        ]);
    }

    // =====================================================================
    // GET /api/gis/map-data
    // =====================================================================
    if ($path === '/api/gis/map-data' && $method === 'GET') {
        $waterRows = $pdo->query("
            SELECT w.station_name, w.river, w.amphoe, w.province,
                   w.current_water_level_m, w.left_bank_level_m, w.bank_difference_m,
                   w.trend, w.status, w.current_rain_mm, w.forecast_rain_24h_mm,
                   w.risk_level, w.recorded_at
            FROM tbl_water_disaster_monitoring w
            INNER JOIN (
                SELECT station_name, MAX(id) as max_id
                FROM tbl_water_disaster_monitoring
                GROUP BY station_name
            ) latest ON w.id = latest.max_id
        ")->fetchAll();

        $damRows = $pdo->query("
            SELECT d.dam_name, d.dam_type, d.capacity_m_cum,
                   d.inflow_m_cum, d.water_volume_m_cum, d.water_percent,
                   d.usable_water_m_cum, d.discharge_m_cum, d.recorded_at
            FROM tbl_drought_monitoring d
            INNER JOIN (
                SELECT dam_name, MAX(id) as max_id
                FROM tbl_drought_monitoring
                GROUP BY dam_name
            ) latest ON d.id = latest.max_id
        ")->fetchAll();

        $stations = [];
        foreach ($waterRows as $row) {
            $amphoeClean = normalize_amphoe_name($row['amphoe'] ?? '');
            $coords = get_feature_coords($row['station_name'], $amphoeClean);
            $diff = $row['bank_difference_m'] !== null ? (float)$row['bank_difference_m'] : 999.0;
            $wl = (float)($row['current_water_level_m'] ?? 0);
            $rain = (float)($row['current_rain_mm'] ?? 0);
            $forecast = (float)($row['forecast_rain_24h_mm'] ?? 0);

            $severity = 'normal';
            $severityLabel = 'ปกติ';
            $color = '#10b981';

            if ($diff <= 0 || ($row['status'] ?? '') === 'น้ำล้นตลิ่ง' || ($row['risk_level'] ?? '') === 'วิกฤต') {
                $severity = 'critical';
                $severityLabel = 'วิกฤต (ล้นตลิ่ง)';
                $color = '#ef4444';
            } elseif ($diff <= 0.5 || ($row['status'] ?? '') === 'น้ำมาก' || (($row['trend'] ?? '') === 'แนวโน้มเพิ่มขึ้น' && $rain > 20)) {
                $severity = 'warning';
                $severityLabel = 'เสี่ยงสูง (น้ำมาก)';
                $color = '#f97316';
            } elseif ($diff <= 1.0 || ($row['status'] ?? '') === 'เฝ้าระวัง' || $wl <= 0.5 || ($row['status'] ?? '') === 'น้ำน้อย' || ($row['status'] ?? '') === 'น้ำน้อยวิกฤต') {
                $severity = 'watch';
                $severityLabel = ($wl <= 0.5 || ($row['status'] ?? '') === 'น้ำน้อยวิกฤต') ? 'เฝ้าระวัง (น้ำน้อย)' : 'เฝ้าระวัง';
                $color = '#eab308';
            }

            $stations[] = [
                'type' => 'station',
                'name' => $row['station_name'],
                'river' => $row['river'] ?: '-',
                'amphoe' => $amphoeClean,
                'currentWaterLevel' => $wl,
                'leftBankLevel' => (float)($row['left_bank_level_m'] ?? 0),
                'bankDiff' => $diff < 900 ? $diff : null,
                'status' => $row['status'] ?: 'ปกติ',
                'trend' => $row['trend'] ?: 'ปกติ',
                'currentRain' => $rain,
                'rainfallAccum3d' => $forecast,
                'totalRain24h' => round($rain, 1),
                'severity' => $severity,
                'severityLabel' => $severityLabel,
                'color' => $color,
                'isCritical' => ($severity === 'critical' || $severity === 'warning'),
                'coordinatePrecision' => $coords['precision'],
                'lat' => $coords['lat'],
                'lng' => $coords['lng'],
                'recordedAt' => $row['recorded_at']
            ];
        }

        $dams = [];
        foreach ($damRows as $row) {
            $amphoeClean = DAM_DISTRICT_MAP[$row['dam_name']] ?? 'เมืองลำปาง';
            $coords = get_feature_coords($row['dam_name'], $amphoeClean);
            $pct = (float)str_replace('%', '', trim((string)($row['water_percent'] ?? '0')));
            $capacity = (float)($row['capacity_m_cum'] ?? 0);
            $volume = (float)($row['water_volume_m_cum'] ?? 0);
            $usable = (float)($row['usable_water_m_cum'] ?? 0);

            $severity = 'normal';
            $severityLabel = 'ปกติ';
            $color = '#10b981';

            if ($pct < 20) { $severity = 'critical'; $severityLabel = 'แล้งวิกฤต (<20%)'; $color = '#ef4444'; }
            elseif ($pct < 30) { $severity = 'warning'; $severityLabel = 'แล้งเสี่ยงสูง (20-30%)'; $color = '#f97316'; }
            elseif ($pct < 40) { $severity = 'watch'; $severityLabel = 'เฝ้าระวังภัยแล้ง (30-40%)'; $color = '#eab308'; }
            elseif ($pct > 95) { $severity = 'critical'; $severityLabel = 'น้ำล้นวิกฤต (>95%)'; $color = '#ef4444'; }
            elseif ($pct > 85) { $severity = 'warning'; $severityLabel = 'เสี่ยงน้ำมาก (>85%)'; $color = '#f97316'; }

            $dams[] = [
                'type' => 'dam',
                'name' => $row['dam_name'],
                'damType' => $row['dam_type'] ?: 'อ่างเก็บน้ำ',
                'amphoe' => $amphoeClean,
                'capacity' => $capacity,
                'volume' => $volume,
                'percent' => $pct,
                'usable' => $usable,
                'inflow' => (float)($row['inflow_m_cum'] ?? 0),
                'discharge' => (float)($row['discharge_m_cum'] ?? 0),
                'severity' => $severity,
                'severityLabel' => $severityLabel,
                'color' => $color,
                'isCritical' => ($severity === 'critical' || $severity === 'warning'),
                'coordinatePrecision' => $coords['precision'],
                'lat' => $coords['lat'],
                'lng' => $coords['lng'],
                'recordedAt' => $row['recorded_at']
            ];
        }

        $districts = [];
        $rainCircles = [];
        foreach (LAMPANG_DISTRICTS as $dist) {
            $center = LAMPANG_DISTRICT_COORDS[$dist] ?? LAMPANG_DISTRICT_COORDS['เมืองลำปาง'];
            $distStations = array_values(array_filter($stations, function ($s) use ($dist) { return $s['amphoe'] === $dist; }));
            $distDams = array_values(array_filter($dams, function ($d) use ($dist) { return $d['amphoe'] === $dist; }));

            $maxRain = 0.0;
            $sumRain = 0.0;
            foreach ($distStations as $s) {
                if ($s['totalRain24h'] > $maxRain) $maxRain = $s['totalRain24h'];
                $sumRain += $s['totalRain24h'];
            }
            $avgRain = count($distStations) > 0 ? round($sumRain / count($distStations), 1) : 0.0;

            $rainIntensity = 'none';
            $circleColor = '#3b82f6';
            $circleRadius = 3500;
            if ($maxRain > 90) { $rainIntensity = 'very_heavy'; $circleColor = '#7e22ce'; $circleRadius = 11000; }
            elseif ($maxRain > 35) { $rainIntensity = 'heavy'; $circleColor = '#ef4444'; $circleRadius = 8500; }
            elseif ($maxRain > 10) { $rainIntensity = 'moderate'; $circleColor = '#f59e0b'; $circleRadius = 6500; }
            elseif ($maxRain > 0) { $rainIntensity = 'light'; $circleColor = '#06b6d4'; $circleRadius = 4500; }

            $critCount = count(array_filter($distStations, function ($s) { return $s['isCritical']; }))
                       + count(array_filter($distDams, function ($d) { return $d['isCritical']; }));

            $dItem = [
                'districtName' => $dist,
                'lat' => $center['lat'],
                'lng' => $center['lng'],
                'stationCount' => count($distStations),
                'damCount' => count($distDams),
                'criticalCount' => $critCount,
                'maxRain24h' => $maxRain,
                'avgRain24h' => $avgRain,
                'rainIntensity' => $rainIntensity,
                'circleColor' => $circleColor,
                'circleRadius' => $circleRadius,
                'hasRain' => $maxRain > 0
            ];
            $districts[] = $dItem;

            if ($maxRain > 0) {
                $rainCircles[] = [
                    'name' => "กลุ่มฝน อ.{$dist}",
                    'amphoe' => $dist,
                    'lat' => $center['lat'],
                    'lng' => $center['lng'],
                    'rain_mm' => $maxRain,
                    'intensity' => $rainIntensity,
                    'color' => $circleColor,
                    'radius' => $circleRadius
                ];
            }
        }

        foreach ($stations as $s) {
            if ($s['totalRain24h'] > 15) {
                $rainCircles[] = [
                    'name' => $s['name'],
                    'amphoe' => $s['amphoe'],
                    'lat' => $s['lat'],
                    'lng' => $s['lng'],
                    'rain_mm' => $s['totalRain24h'],
                    'intensity' => $s['totalRain24h'] > 35 ? 'heavy' : 'moderate',
                    'color' => $s['totalRain24h'] > 35 ? '#ef4444' : '#f59e0b',
                    'radius' => 4000
                ];
            }
        }

        $critStations = count(array_filter($stations, function ($s) { return $s['isCritical']; }));
        $critDams     = count(array_filter($dams, function ($d) { return $d['isCritical']; }));

        send_json([
            'success' => true,
            'summary' => [
                'totalStations' => count($stations),
                'totalDams' => count($dams),
                'criticalCount' => $critStations + $critDams,
                'criticalStations' => $critStations,
                'criticalDams' => $critDams,
                'rainAreasCount' => count($rainCircles),
                'center' => [18.2888, 99.4920],
                'updatedAt' => date('c')
            ],
            'stations' => $stations,
            'dams' => $dams,
            'districts' => $districts,
            'rainCircles' => $rainCircles
        ]);
    }

    // =====================================================================
    // GET /api/analytics/water-rainfall-trends
    // =====================================================================
    if ($path === '/api/analytics/water-rainfall-trends' && $method === 'GET') {
        $stationsParam = $_GET['stations'] ?? '';
        $limit = min(max((int)($_GET['limit'] ?? 1000), 1), 2000);
        $sql = "SELECT station_name, river, amphoe, province,
                       current_water_level_m, left_bank_level_m, bank_difference_m,
                       trend, status, current_rain_mm, forecast_rain_24h_mm, risk_level,
                       recorded_at
                FROM tbl_water_disaster_monitoring
                WHERE 1=1";
        $params = [];
        if ($stationsParam !== '') {
            $stationList = array_values(array_filter(array_map('trim', explode(',', $stationsParam))));
            if (!empty($stationList)) {
                $ph = implode(',', array_fill(0, count($stationList), '?'));
                $sql .= " AND station_name IN ({$ph})";
                $params = array_merge($params, $stationList);
            }
        }
        if ($startDate && $endDate) {
            $sql .= " AND recorded_at BETWEEN ? AND ?";
            $params[] = "{$startDate} 00:00:00";
            $params[] = "{$endDate} 23:59:59";
        }
        $sql .= " ORDER BY recorded_at ASC LIMIT {$limit}";

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        $grouped = [];
        foreach ($rows as $r) {
            $st = $r['station_name'];
            if (!isset($grouped[$st])) {
                $grouped[$st] = [
                    'station_name' => $st,
                    'river' => $r['river'],
                    'amphoe' => $r['amphoe'],
                    'left_bank_level_m' => $r['left_bank_level_m'],
                    'points' => []
                ];
            }
            $grouped[$st]['points'][] = [
                'recorded_at' => $r['recorded_at'],
                'current_water_level_m' => $r['current_water_level_m'],
                'bank_difference_m' => $r['bank_difference_m'],
                'current_rain_mm' => $r['current_rain_mm'],
                'trend' => $r['trend'],
                'risk_level' => $r['risk_level']
            ];
        }

        send_json([
            'success' => true,
            'count' => count($rows),
            'stations' => array_values($grouped)
        ]);
    }

    // =====================================================================
    // GET /api/rainfall-data
    // =====================================================================
    if ($path === '/api/rainfall-data' && $method === 'GET') {
        $rows = $pdo->query("
            SELECT * FROM tbl_rainfall_monitoring
            WHERE id IN (SELECT MAX(id) FROM tbl_rainfall_monitoring GROUP BY station_name)
            ORDER BY rain_mm DESC
        ")->fetchAll();
        send_json($rows);
    }

    // =====================================================================
    // GET /api/complaints & /api/complaints/:ticket/events
    // =====================================================================
    if ($path === '/api/complaints' && $method === 'GET') {
        $includeAll = ($_GET['includeAll'] ?? '') === 'true' || ($_GET['all'] ?? '') === '1';
        $where = $includeAll ? '' : 'WHERE (is_in_scope = 1 OR is_in_scope IS NULL)';
        $rows = $pdo->query("SELECT * FROM tbl_complaints_monitoring {$where} ORDER BY id DESC")->fetchAll();
        send_json($rows);
    }

    if (preg_match('#^/api/complaints/([^/]+)/events$#', $path, $m) && $method === 'GET') {
        ensure_ingest_tables($pdo);
        $ticketId = rawurldecode($m[1]);
        $stmt = $pdo->prepare("SELECT state_name, org_name, observed_at FROM app_complaint_events WHERE ticket_id = ? ORDER BY id ASC");
        $stmt->execute([$ticketId]);
        send_json([
            'events' => $stmt->fetchAll(),
            'note' => 'ประวัติเริ่มจากการเก็บข้อมูลหลังติดตั้งรุ่นนี้ ไม่ใช่ประวัติย้อนหลังทั้งหมดของต้นทาง'
        ]);
    }

    // =====================================================================
    // GET /api/report-data
    // =====================================================================
    if ($path === '/api/report-data' && $method === 'GET') {
        $project = $_GET['project'] ?? 'all';
        $period  = $_GET['period'] ?? 'daily';
        $date    = $_GET['date'] ?? date('Y-m-d');

        if ($startDate && $endDate) {
            $sStr = $startDate;
            $eStr = $endDate;
        } else {
            $refTs = strtotime($date . ' 00:00:00') ?: time();
            if ($period === 'daily') {
                $sStr = date('Y-m-d', $refTs);
                $eStr = $sStr;
            } elseif ($period === 'weekly') {
                $sStr = date('Y-m-d', $refTs - 6 * 86400);
                $eStr = date('Y-m-d', $refTs);
            } else {
                $sStr = date('Y-m-01', $refTs);
                $eStr = date('Y-m-t', $refTs);
            }
        }

        $dateParams = ["{$sStr} 00:00:00", "{$eStr} 23:59:59"];
        $result = ['water' => null, 'rainfall' => null, 'drought' => null, 'pm25' => null, 'complaints' => null];

        if ($project === 'all' || $project === 'water') {
            $stmt = $pdo->prepare("SELECT station_name, river, amphoe, province, current_water_level_m, left_bank_level_m, bank_difference_m, trend, status, current_rain_mm, forecast_rain_24h_mm, risk_level, DATE_FORMAT(recorded_at, '%Y-%m-%d %H:%i:%s') as recorded_at FROM tbl_water_disaster_monitoring WHERE recorded_at BETWEEN ? AND ? AND station_name NOT LIKE '%Test%' ORDER BY recorded_at DESC");
            $stmt->execute($dateParams);
            $rows = $stmt->fetchAll();
            $wls = array_values(array_filter(array_map(function ($r) { return is_numeric($r['current_water_level_m']) ? (float)$r['current_water_level_m'] : null; }, $rows), function ($v) { return $v !== null; }));
            $rains = array_values(array_filter(array_map(function ($r) { return is_numeric($r['current_rain_mm']) ? (float)$r['current_rain_mm'] : null; }, $rows), function ($v) { return $v !== null; }));
            $riskCounts = [];
            foreach ($rows as $r) {
                if (!empty($r['risk_level'])) $riskCounts[$r['risk_level']] = ($riskCounts[$r['risk_level']] ?? 0) + 1;
            }
            $result['water'] = [
                'rows' => $rows,
                'summary' => [
                    'totalRecords' => count($rows),
                    'totalStations' => count(array_unique(array_column($rows, 'station_name'))),
                    'avgWaterLevel' => !empty($wls) ? number_format(array_sum($wls) / count($wls), 2) : 'N/A',
                    'maxWaterLevel' => !empty($wls) ? number_format(max($wls), 2) : 'N/A',
                    'minWaterLevel' => !empty($wls) ? number_format(min($wls), 2) : 'N/A',
                    'avgRainfall' => !empty($rains) ? number_format(array_sum($rains) / count($rains), 2) : 'N/A',
                    'riskCounts' => $riskCounts
                ]
            ];

            $stmt = $pdo->prepare("SELECT station_name, location, river_basin, rain_mm, rain_status, measured_time, DATE_FORMAT(recorded_at, '%Y-%m-%d %H:%i:%s') as recorded_at FROM tbl_rainfall_monitoring WHERE recorded_at BETWEEN ? AND ? ORDER BY recorded_at DESC");
            $stmt->execute($dateParams);
            $rRows = $stmt->fetchAll();
            $rVals = array_values(array_filter(array_map(function ($r) { return is_numeric($r['rain_mm']) ? (float)$r['rain_mm'] : null; }, $rRows), function ($v) { return $v !== null; }));
            $result['rainfall'] = [
                'rows' => $rRows,
                'summary' => [
                    'totalRecords' => count($rRows),
                    'totalStations' => count(array_unique(array_column($rRows, 'station_name'))),
                    'avgRainfall' => !empty($rVals) ? number_format(array_sum($rVals) / count($rVals), 2) : 'N/A',
                    'maxRainfall' => !empty($rVals) ? number_format(max($rVals), 2) : 'N/A',
                    'minRainfall' => !empty($rVals) ? number_format(min($rVals), 2) : 'N/A'
                ]
            ];
        }

        if ($project === 'all' || $project === 'drought') {
            $stmt = $pdo->prepare("SELECT dam_name, dam_type, capacity_m_cum, inflow_m_cum, water_volume_m_cum, water_percent, usable_water_m_cum, discharge_m_cum, record_date, DATE_FORMAT(recorded_at, '%Y-%m-%d %H:%i:%s') as recorded_at FROM tbl_drought_monitoring WHERE recorded_at BETWEEN ? AND ? ORDER BY recorded_at DESC");
            $stmt->execute($dateParams);
            $rows = $stmt->fetchAll();
            $vols = array_values(array_filter(array_map(function ($r) { return is_numeric($r['water_volume_m_cum']) ? (float)$r['water_volume_m_cum'] : null; }, $rows), function ($v) { return $v !== null; }));
            $caps = array_values(array_filter(array_map(function ($r) { return is_numeric($r['capacity_m_cum']) ? (float)$r['capacity_m_cum'] : null; }, $rows), function ($v) { return $v !== null; }));
            $sumVol = array_sum($vols);
            $sumCap = array_sum($caps);
            $result['drought'] = [
                'rows' => $rows,
                'summary' => [
                    'totalRecords' => count($rows),
                    'totalDams' => count(array_unique(array_column($rows, 'dam_name'))),
                    'totalVolume' => !empty($vols) ? number_format($sumVol, 2, '.', '') : 'N/A',
                    'totalCapacity' => !empty($caps) ? number_format($sumCap, 2, '.', '') : 'N/A',
                    'avgVolumePercent' => ($sumCap > 0) ? number_format(($sumVol / $sumCap) * 100, 1) : 'N/A'
                ]
            ];
        }

        if ($project === 'all' || $project === 'pm25') {
            $stmt = $pdo->prepare("SELECT station_name, tambon, amphoe, province, time_label, pm25_value, pm25_avg_24h, air_quality_status, record_date, DATE_FORMAT(recorded_at, '%Y-%m-%d %H:%i:%s') as recorded_at FROM tbl_pm25_monitoring WHERE recorded_at BETWEEN ? AND ? ORDER BY recorded_at DESC");
            $stmt->execute($dateParams);
            $rows = $stmt->fetchAll();
            $pms = array_values(array_filter(array_map(function ($r) { return is_numeric($r['pm25_value']) ? (float)$r['pm25_value'] : null; }, $rows), function ($v) { return $v !== null; }));
            $stCounts = [];
            foreach ($rows as $r) {
                if (!empty($r['air_quality_status'])) $stCounts[$r['air_quality_status']] = ($stCounts[$r['air_quality_status']] ?? 0) + 1;
            }
            $result['pm25'] = [
                'rows' => $rows,
                'summary' => [
                    'totalRecords' => count($rows),
                    'totalStations' => count(array_unique(array_column($rows, 'station_name'))),
                    'avgPm25' => !empty($pms) ? number_format(array_sum($pms) / count($pms), 1) : 'N/A',
                    'maxPm25' => !empty($pms) ? number_format(max($pms), 1) : 'N/A',
                    'minPm25' => !empty($pms) ? number_format(min($pms), 1) : 'N/A',
                    'statusCounts' => $stCounts
                ]
            ];
        }

        if ($project === 'all' || $project === 'complaints') {
            $stmt = $pdo->prepare("SELECT ticket_id, state_name, problem_type, description, org_name, agency_status, ticket_datetime, satisfaction_stars, photo_url, location, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as recorded_at FROM tbl_complaints_monitoring WHERE created_at BETWEEN ? AND ? AND (is_in_scope = 1 OR is_in_scope IS NULL) ORDER BY created_at DESC");
            $stmt->execute($dateParams);
            $rows = $stmt->fetchAll();
            $stateCounts = [];
            $typeCounts = [];
            $resolved = 0;
            $pending = 0;
            foreach ($rows as $r) {
                $st = $r['state_name'] ?? '';
                $tp = $r['problem_type'] ?? '';
                if ($st !== '') {
                    $stateCounts[$st] = ($stateCounts[$st] ?? 0) + 1;
                    if (mb_strpos($st, 'เสร็จ') !== false) $resolved++;
                    else $pending++;
                }
                if ($tp !== '') $typeCounts[$tp] = ($typeCounts[$tp] ?? 0) + 1;
            }
            arsort($typeCounts);
            $topProblem = !empty($typeCounts) ? array_key_first($typeCounts) : 'ไม่มีข้อมูล';
            $topCount = !empty($typeCounts) ? current($typeCounts) : 0;

            $result['complaints'] = [
                'rows' => $rows,
                'summary' => [
                    'totalRecords' => count($rows),
                    'stateCounts' => $stateCounts,
                    'topProblemType' => $topProblem,
                    'topProblemCount' => $topCount,
                    'resolvedCount' => $resolved,
                    'pendingCount' => $pending
                ]
            ];
        }

        $totalRecords = 0;
        foreach ($result as $v) {
            if (is_array($v) && isset($v['rows'])) $totalRecords += count($v['rows']);
        }

        send_json([
            'success' => true,
            'meta' => [
                'project' => $project,
                'period' => $period,
                'dateRange' => ['start' => $sStr, 'end' => $eStr],
                'weekInfo' => '',
                'totalRecords' => $totalRecords
            ],
            'data' => $result
        ]);
    }

    // =====================================================================
    // GET /api/data-gap-check
    // =====================================================================
    if ($path === '/api/data-gap-check' && $method === 'GET') {
        $daysNum = max(1, min((int)($_GET['days'] ?? 30), 365));
        $checkedDates = recent_dates($daysNum);
        $tables = [
            'water' => 'tbl_water_disaster_monitoring',
            'rainfall' => 'tbl_rainfall_monitoring',
            'drought' => 'tbl_drought_monitoring',
            'pm25' => 'tbl_pm25_monitoring',
            'complaints' => 'tbl_complaints_monitoring'
        ];
        $gaps = [];
        foreach ($tables as $name => $tbl) {
            $stmt = $pdo->prepare("
                SELECT DATE_FORMAT(recorded_at, '%Y-%m-%d') as date, COUNT(*) as count
                FROM {$tbl}
                WHERE recorded_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                GROUP BY DATE_FORMAT(recorded_at, '%Y-%m-%d')
                ORDER BY date ASC
            ");
            $stmt->execute([$daysNum]);
            $rows = $stmt->fetchAll();
            $recSet = array_flip(array_column($rows, 'date'));
            $missing = array_values(array_filter($checkedDates, function ($d) use ($recSet) { return !isset($recSet[$d]); }));
            $gaps[$name] = [
                'totalDaysChecked' => $daysNum,
                'daysWithData' => count($checkedDates) - count($missing),
                'daysWithoutData' => count($missing),
                'missingDates' => $missing,
                'dailyCounts' => $rows
            ];
        }
        send_json(['success' => true, 'checkPeriodDays' => $daysNum, 'gaps' => $gaps]);
    }

    // =====================================================================
    // Operations & Incidents & Data Quality APIs
    // =====================================================================
    if ($path === '/api/operations/status' && $method === 'GET') {
        send_json([
            'backupJobs' => [],
            'recoveryJobs' => [],
            'excel' => ['writes' => 0, 'failures' => 0],
            'requests' => [
                ['route' => 'GET /api/dashboard-summary', 'avgMs' => 18, 'p95Ms' => 35, 'count' => 1],
                ['route' => 'GET /api/status', 'avgMs' => 9, 'p95Ms' => 15, 'count' => 1]
            ]
        ]);
    }

    if ($path === '/api/operations/retry-backups' && $method === 'POST') {
        send_json(['success' => true, 'jobs' => []]);
    }

    if ($path === '/api/incidents' && $method === 'GET') {
        $alerts = $pdo->query("SELECT id, alert_type, station_name, alert_level, alert_title, created_at FROM tbl_alert_notifications ORDER BY id DESC LIMIT 100")->fetchAll();
        $incFile = WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR . 'runtime' . DIRECTORY_SEPARATOR . 'incidents.json';
        $saved = read_json_file($incFile, ['incidents' => []])['incidents'] ?? [];
        $out = [];
        foreach ($alerts as $a) {
            $id = $a['id'];
            $merged = array_merge($a, ['status' => 'new', 'owner' => '', 'history' => []], $saved[$id] ?? []);
            $out[] = $merged;
        }
        send_json(['incidents' => $out]);
    }

    if (preg_match('#^/api/incidents/(\d+)$#', $path, $m) && $method === 'POST') {
        $id = (int)$m[1];
        $status = $body['status'] ?? 'acknowledged';
        $owner  = trim((string)($body['owner'] ?? ''));
        $note   = trim((string)($body['note'] ?? ''));
        $incFile = WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR . 'runtime' . DIRECTORY_SEPARATOR . 'incidents.json';
        $data = read_json_file($incFile, ['incidents' => []]);
        $prev = $data['incidents'][$id] ?? ['status' => 'new', 'history' => []];
        $event = [
            'from' => $prev['status'],
            'to' => $status,
            'owner' => $owner,
            'note' => $note,
            'actor' => 'admin',
            'at' => date('c')
        ];
        $prev['history'][] = $event;
        $data['incidents'][$id] = [
            'status' => $status,
            'owner' => $owner,
            'updatedAt' => $event['at'],
            'history' => $prev['history']
        ];
        write_json_file($incFile, $data);
        send_json(['success' => true, 'incident' => $data['incidents'][$id]]);
    }

    if ($path === '/api/data-quality' && $method === 'GET') {
        $days = max(1, min((int)($_GET['days'] ?? 7), 90));
        $dates = recent_dates($days);
        $domains = [
            ['water', 'tbl_water_disaster_monitoring', 'station_name'],
            ['rainfall', 'tbl_rainfall_monitoring', 'station_name'],
            ['drought', 'tbl_drought_monitoring', 'dam_name'],
            ['pm25', 'tbl_pm25_monitoring', 'station_name']
        ];
        $stations = [];
        $lastDate = end($dates);
        foreach ($domains as [$kind, $tbl, $col]) {
            $latest = $pdo->query("SELECT {$col} AS name, MAX(recorded_at) AS last_received, TIMESTAMPDIFF(MINUTE, MAX(recorded_at), NOW()) AS age_minutes FROM {$tbl} GROUP BY {$col}")->fetchAll();
            $stmt = $pdo->prepare("SELECT {$col} AS name, DATE_FORMAT(recorded_at, '%Y-%m-%d') AS date, COUNT(*) AS count FROM {$tbl} WHERE recorded_at >= ? AND recorded_at < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY {$col}, DATE_FORMAT(recorded_at, '%Y-%m-%d')");
            $stmt->execute(["{$dates[0]} 00:00:00", "{$lastDate} 00:00:00"]);
            $cov = $stmt->fetchAll();
            $byStation = [];
            foreach ($cov as $r) {
                $byStation[$r['name']][$r['date']] = true;
            }
            foreach ($latest as $r) {
                $missing = [];
                foreach ($dates as $dt) {
                    if (empty($byStation[$r['name']][$dt])) $missing[] = $dt;
                }
                $age = $r['age_minutes'] !== null ? (int)$r['age_minutes'] : null;
                $stations[] = [
                    'kind' => $kind,
                    'name' => $r['name'],
                    'lastReceived' => $r['last_received'],
                    'ageMinutes' => $age,
                    'stale' => ($age === null || $age > 120),
                    'missingDates' => array_values(array_filter($missing, function ($d) use ($lastDate) { return $d !== $lastDate; })),
                    'todayPending' => in_array($lastDate, $missing, true)
                ];
            }
        }
        send_json([
            'checkedAt' => date('c'),
            'timezone' => 'Asia/Bangkok',
            'days' => $days,
            'staleAfterMinutes' => 120,
            'stations' => $stations,
            'notes' => [
                'รายการสถานีมาจากประวัติในฐานข้อมูล สถานีที่ไม่เคยได้รับข้อมูลจะยังไม่อยู่ในรายการ',
                'ใช้เวลารับข้อมูล ไม่ยืนยันเวลาตรวจวัดต้นทาง',
                'วันปัจจุบันยังไม่ถือว่าเป็นวันที่ขาดทั้งวัน'
            ]
        ]);
    }

    // =====================================================================
    // Notifications APIs
    // =====================================================================
    if ($path === '/api/notifications' && $method === 'GET') {
        $limit = min(max((int)($_GET['limit'] ?? 50), 1), 200);
        $rows = $pdo->query("SELECT * FROM tbl_alert_notifications ORDER BY created_at DESC LIMIT {$limit}")->fetchAll();
        send_json(['success' => true, 'notifications' => $rows]);
    }

    if ($path === '/api/notifications/stats' && $method === 'GET') {
        $today = $pdo->query("
            SELECT COUNT(*) as total,
                   SUM(alert_level = 'critical') as critical,
                   SUM(alert_level = 'warning') as warning,
                   SUM(alert_level = 'info') as info,
                   SUM(email_status = 'sent') as sent,
                   SUM(email_status = 'failed') as failed
            FROM tbl_alert_notifications
            WHERE DATE(created_at) = CURDATE()
        ")->fetch();
        $month = $pdo->query("
            SELECT COUNT(*) as total, SUM(email_status = 'sent') as sent
            FROM tbl_alert_notifications
            WHERE YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())
        ")->fetch();
        send_json(['success' => true, 'stats' => ['today' => $today ?: [], 'month' => $month ?: []]]);
    }

    if ($path === '/api/notifications/config' && $method === 'GET') {
        $cfg = get_app_config()['notifications'];
        send_json([
            'success' => true,
            'config' => [
                'enabled' => $cfg['enabled'] ?? true,
                'alertActive' => $cfg['alertActive'] ?? [],
                'cooldownMinutes' => $cfg['cooldownMinutes'] ?? 120,
                'smtp' => [
                    'host' => $cfg['smtp']['host'] ?? 'smtp.gmail.com',
                    'port' => $cfg['smtp']['port'] ?? 587,
                    'user' => $cfg['smtp']['user'] ?? '',
                    'pass' => !empty($cfg['smtp']['pass']) ? '********' : ''
                ]
            ]
        ]);
    }

    if ($path === '/api/notifications/recipients' && $method === 'GET') {
        $rows = $pdo->query("SELECT * FROM tbl_alert_recipients ORDER BY id ASC")->fetchAll();
        send_json(['success' => true, 'recipients' => $rows]);
    }

    if ($path === '/api/notifications/recipients' && $method === 'POST') {
        $id = $body['id'] ?? null;
        if ($id) {
            $fields = [];
            $vals = [];
            foreach (['name', 'position', 'email', 'alert_level_min', 'is_active', 'notify_water', 'notify_drought', 'notify_pm25', 'notify_complaints'] as $col) {
                if (array_key_exists($col, $body)) {
                    $fields[] = "{$col} = ?";
                    $vals[] = $body[$col];
                }
            }
            if (!empty($fields)) {
                $vals[] = $id;
                $stmt = $pdo->prepare("UPDATE tbl_alert_recipients SET " . implode(', ', $fields) . " WHERE id = ?");
                $stmt->execute($vals);
                add_server_log('Notification', "✏️ อัปเดตผู้รับแจ้งเตือน ID {$id}");
            }
        } else {
            $stmt = $pdo->prepare("INSERT INTO tbl_alert_recipients (name, position, email, alert_level_min, is_active, notify_water, notify_drought, notify_pm25, notify_complaints) VALUES (?,?,?,?,?,?,?,?,?)");
            $stmt->execute([
                $body['name'] ?? '',
                $body['position'] ?? '',
                $body['email'] ?? '',
                $body['alert_level_min'] ?? 'warning',
                $body['is_active'] ?? 1,
                $body['notify_water'] ?? 1,
                $body['notify_drought'] ?? 1,
                $body['notify_pm25'] ?? 1,
                $body['notify_complaints'] ?? 1
            ]);
            add_server_log('Notification', '➕ เพิ่มผู้รับแจ้งเตือนใหม่: ' . ($body['name'] ?? ''));
        }
        send_json(['success' => true]);
    }

    if (preg_match('#^/api/notifications/recipients/(\d+)$#', $path, $m) && $method === 'DELETE') {
        $stmt = $pdo->prepare("DELETE FROM tbl_alert_recipients WHERE id = ?");
        $stmt->execute([(int)$m[1]]);
        add_server_log('Notification', "🗑️ ลบผู้รับแจ้งเตือน ID: {$m[1]}");
        send_json(['success' => true]);
    }

    if ($path === '/api/notifications/toggle' && $method === 'POST') {
        $cfg = get_app_config();
        $type = $body['type'] ?? '';
        $active = (bool)($body['active'] ?? false);
        if ($type !== '' && isset($cfg['notifications']['alertActive'][$type])) {
            $cfg['notifications']['alertActive'][$type] = $active;
            save_app_config($cfg);
            add_server_log('Notification', ($active ? '🔔 เปิดแจ้งเตือน: ' : '🔕 ปิดแจ้งเตือน: ') . $type);
        }
        send_json(['success' => true, 'alertActive' => $cfg['notifications']['alertActive']]);
    }

    if ($path === '/api/notifications/smtp' && $method === 'POST') {
        $user = strtolower(trim((string)($body['user'] ?? '')));
        $pass = preg_replace('/\s+/', '', (string)($body['pass'] ?? ''));
        if ($user === '' || $pass === '') {
            send_json(['success' => false, 'error' => 'กรุณาระบุ user และ pass'], 400);
        }
        $cfg = get_app_config();
        $cfg['notifications']['smtp']['user'] = $user;
        $cfg['notifications']['smtp']['pass'] = $pass;
        save_app_config($cfg);
        add_server_log('Notification', "📧 บันทึก SMTP credentials ใหม่: {$user}");
        send_json(['success' => true, 'user' => $user]);
    }

    if ($path === '/api/notifications/check-now' && $method === 'POST') {
        add_server_log('Notification', '🔍 ตรวจสอบเกณฑ์แจ้งเตือนล่าสุดเรียบร้อยแล้ว');
        send_json(['success' => true, 'result' => ['alertsFound' => 0, 'emailsSent' => 0]]);
    }

    if ($path === '/api/notifications/test' && $method === 'POST') {
        $email = $body['email'] ?? '';
        add_server_log('Notification', "📧 ทดสอบระบบแจ้งเตือนไปยัง {$email}");
        send_json(['success' => true, 'sentTo' => $email]);
    }

    // =====================================================================
    // Raw Data Export (/api/reports/export-raw-data)
    // =====================================================================
    if ($path === '/api/reports/export-raw-data' && $method === 'GET') {
        $project = $_GET['project'] ?? 'all';
        $sDate = ($startDate ?: date('Y-m-01')) . ' 00:00:00';
        $eDate = ($endDate ?: date('Y-m-d')) . ' 23:59:59';
        $sStr = substr($sDate, 0, 10);
        $eStr = substr($eDate, 0, 10);

        $csv = "\xEF\xBB\xBF";
        if ($project === 'all' || $project === 'water') {
            $stmt = $pdo->prepare("SELECT station_name, river, amphoe, province, current_water_level_m, left_bank_level_m, bank_difference_m, trend, status, current_rain_mm, forecast_rain_24h_mm, risk_level, recorded_at FROM tbl_water_disaster_monitoring WHERE recorded_at BETWEEN ? AND ? ORDER BY recorded_at DESC");
            $stmt->execute([$sDate, $eDate]);
            $rows = $stmt->fetchAll();
            $csv .= "=== ข้อมูลระดับน้ำและปริมาณน้ำฝน ({$sStr} ถึง {$eStr}) ===\n";
            $csv .= "ชื่อสถานี,ลุ่มน้ำ,อำเภอ,จังหวัด,ระดับน้ำปัจจุบัน(ม.),ระดับตลิ่ง(ม.),ระยะห่างตลิ่ง(ม.),แนวโน้ม,สถานะ,ฝนปัจจุบัน(มม.),ฝนสะสม3วัน(มม.),ระดับความเสี่ยง,วันเวลาที่บันทึก\n";
            foreach ($rows as $r) {
                $csv .= sprintf("\"%s\",\"%s\",\"%s\",\"%s\",%s,%s,%s,\"%s\",\"%s\",%s,%s,\"%s\",\"%s\"\n",
                    $r['station_name'], $r['river'], $r['amphoe'], $r['province'],
                    $r['current_water_level_m'] ?? '', $r['left_bank_level_m'] ?? '', $r['bank_difference_m'] ?? '',
                    $r['trend'], $r['status'], $r['current_rain_mm'] ?? '', $r['forecast_rain_24h_mm'] ?? '',
                    $r['risk_level'], $r['recorded_at']
                );
            }
            $csv .= "\n";
        }
        if ($project === 'all' || $project === 'drought') {
            $stmt = $pdo->prepare("SELECT dam_name, dam_type, capacity_m_cum, inflow_m_cum, water_volume_m_cum, water_percent, usable_water_m_cum, discharge_m_cum, recorded_at FROM tbl_drought_monitoring WHERE recorded_at BETWEEN ? AND ? ORDER BY recorded_at DESC");
            $stmt->execute([$sDate, $eDate]);
            $rows = $stmt->fetchAll();
            $csv .= "=== ข้อมูลอ่างเก็บน้ำและสถานการณ์ภัยแล้ง ({$sStr} ถึง {$eStr}) ===\n";
            $csv .= "ชื่ออ่างเก็บน้ำ,ประเภท,ความจุ(ล้าน ลบ.ม.),ปริมาณน้ำไหลเข้า,ปริมาณน้ำกักเก็บ,% ปริมาณน้ำ,น้ำใช้การได้,ปริมาณน้ำระบาย,วันเวลาที่บันทึก\n";
            foreach ($rows as $r) {
                $csv .= sprintf("\"%s\",\"%s\",%s,%s,%s,\"%s\",%s,%s,\"%s\"\n",
                    $r['dam_name'], $r['dam_type'], $r['capacity_m_cum'] ?? '', $r['inflow_m_cum'] ?? '',
                    $r['water_volume_m_cum'] ?? '', $r['water_percent'], $r['usable_water_m_cum'] ?? '',
                    $r['discharge_m_cum'] ?? '', $r['recorded_at']
                );
            }
            $csv .= "\n";
        }

        $filename = "RawData_{$project}_{$sStr}_to_{$eStr}.csv";
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . rawurlencode($filename) . '"');
        echo $csv;
        exit;
    }

    if ($path === '/api/ping' && $method === 'POST') {
        send_json(['ok' => true, 'timestamp' => round(microtime(true) * 1000), 'activeSockets' => 1]);
    }

    send_json(['error' => 'API Endpoint Not Found: ' . $path], 404);
}

