<?php
// =========================================================================
// Water_System2 (Port 7000) — PHP + Socket.IO Main Router
// Strictly isolated on Port 7000 (Never touches Port 3000)
// =========================================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/api.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

// Support universal subfolder endpoint.php?r=/api/... or ?r=/socket.io/...
if ((basename($uri) === 'endpoint.php' || isset($_GET['r'])) && !empty($_GET['r']) && is_string($_GET['r'])) {
    $route = $_GET['r'];
    $parsed = parse_url($route);
    $uri = $parsed['path'] ?? '/';
    if (!empty($parsed['query'])) {
        parse_str($parsed['query'], $extraQuery);
        if (is_array($extraQuery)) {
            $_GET = array_merge($extraQuery, $_GET);
        }
    }
}

// Security & Isolation Headers
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: same-origin');
header('X-Water-System2-Port: 7000');

// CORS for Port 7000 + configured Primary/Backup domains (domain_config.json)
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    $allowed = function_exists('get_allowed_cors_origins') ? get_allowed_cors_origins() : [
        'http://localhost:7000',
        'http://127.0.0.1:7000',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'https://lampang.thaiwater.net',
        'https://citydata.traffy.in.th'
    ];
    if (in_array(strtolower($origin), $allowed, true) || in_array($origin, $allowed, true) || preg_match('/^chrome-extension:\/\/[a-p]{32}$/', $origin)) {
        header("Access-Control-Allow-Origin: {$origin}");
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, Authorization, X-CSRF-Token, X-Bootstrap-Token, X-Ingest-Key');
    }
}
if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// =========================================================================
// 1. Socket.IO Client JS & Real-Time Polling Stream (/socket.io/*)
// =========================================================================
if ($uri === '/socket.io/socket.io.js' || $uri === '/socketio_client.js') {
    header('Content-Type: application/javascript; charset=utf-8');
    header('Cache-Control: no-store');
    readfile(__DIR__ . '/socketio_client.js');
    exit;
}

if ($uri === '/server_setup.php') {
    require WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR . 'server_setup.php';
    exit;
}

if ($uri === '/cron.php') {
    require WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR . 'cron.php';
    exit;
}

if ($uri === '/worker.php') {
    require WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR . 'worker.php';
    exit;
}

if (strpos($uri, '/socket.io/') === 0) {
    $eventsFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'socketio_events.json';
    if ($method === 'GET') {
        $sinceSeq = isset($_GET['seq']) ? (int)$_GET['seq'] : -1;
        $eventsData = read_json_file($eventsFile, ['seq' => 0, 'events' => []]);
        $currentSeq = (int)($eventsData['seq'] ?? 0);
        $newEvents = [];
        if ($sinceSeq >= 0 && !empty($eventsData['events'])) {
            foreach ($eventsData['events'] as $ev) {
                if ((int)($ev['seq'] ?? 0) > $sinceSeq) {
                    $newEvents[] = $ev;
                }
            }
        }
        send_json([
            'ok' => true,
            'seq' => $currentSeq,
            'events' => $newEvents
        ]);
    }
    if ($method === 'POST') {
        $raw = file_get_contents('php://input');
        $payload = json_decode($raw ?: '{}', true);
        $evName = $payload['event'] ?? '';
        $evData = $payload['data'] ?? null;
        if ($evName === 'client_log' && is_array($evData) && !empty($evData['message'])) {
            add_server_log($evData['source'] ?? 'Client', (string)$evData['message']);
        }
        send_json(['ok' => true]);
    }
    exit;
}

// =========================================================================
// 2. REST API Endpoints (/api/*)
// =========================================================================
if (strpos($uri, '/api/') === 0) {
    try {
        handle_api_request($method, $uri);
    } catch (Throwable $e) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'success' => false,
            'error' => $e->getMessage()
        ], JSON_UNESCAPED_UNICODE);
    }
    exit;
}

// =========================================================================
// 3. Static Files & Pages from backend_ui/
// =========================================================================
$targetRel = ($uri === '/') ? '/index.html' : $uri;
$safeRel = str_replace(['..', '\\'], ['', '/'], $targetRel);
$filePath = WATER_SYSTEM2_UI_DIR . str_replace('/', DIRECTORY_SEPARATOR, $safeRel);

if (is_file($filePath)) {
    $ext = strtolower(pathinfo($filePath, PATHINFO_EXTENSION));
    $mimeMap = [
        'html' => 'text/html; charset=utf-8',
        'js'   => 'application/javascript; charset=utf-8',
        'css'  => 'text/css; charset=utf-8',
        'png'  => 'image/png',
        'jpg'  => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'gif'  => 'image/gif',
        'svg'  => 'image/svg+xml',
        'ico'  => 'image/x-icon',
        'json' => 'application/json; charset=utf-8',
        'woff' => 'font/woff',
        'woff2'=> 'font/woff2'
    ];
    header('Content-Type: ' . ($mimeMap[$ext] ?? 'application/octet-stream'));
    if ($ext === 'html') {
        header('Cache-Control: no-store');
    }
    readfile($filePath);
    exit;
}

http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
echo "404 Not Found on Water_System2 (Port 7000): {$uri}";

