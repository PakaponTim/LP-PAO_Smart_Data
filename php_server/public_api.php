<?php
// =========================================================================
// Water_System2 — Secure Public Dashboard & Inter-Agency Open Data API
// Security Controls:
//   - Strict Zero-PII & Zero-Secret Redaction (phone/ID/email/LINE scrubbed)
//   - Read-only allowlisted DTO projection (raw_timeline & secrets excluded)
//   - Sliding-window IP / API-Key Rate Limiting (HTTP 429 + X-RateLimit-*)
//   - SHA-256 hashed Inter-Agency API Keys (`X-API-Key` -> agency/* routes)
//   - Automatic Cloud Snapshot fallback when MySQL is unreachable
// =========================================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/collectors_transform.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/backup_manager.php';
require_once __DIR__ . '/system_log.php';

function public_scrub_text(string $text, int $maxLen = 200): string {
    return transform_scrub_pii_text($text, $maxLen);
}

function public_sanitize_complaint(array $r): array {
    $stars = $r['satisfaction_stars'] ?? null;
    $starsNum = is_numeric($stars) ? (float)$stars : null;
    return [
        'ticket_id'          => (string)($r['ticket_id'] ?? ''),
        'state_name'         => (string)($r['state_name'] ?? 'รอรับเรื่อง'),
        'agency_status'      => (string)($r['agency_status'] ?? 'หน่วยงานอื่นรับเรื่อง'),
        'problem_type'       => (string)($r['problem_type'] ?? 'ทั่วไป'),
        'summary'            => public_scrub_text((string)($r['description'] ?? ''), 180),
        'area'               => public_scrub_text((string)($r['location'] ?? ''), 120),
        'org_name'           => (string)($r['org_name'] ?? ''),
        'ticket_datetime'    => (string)($r['ticket_datetime'] ?? ''),
        'satisfaction_stars' => $starsNum,
        'recorded_at'        => (string)($r['recorded_at'] ?? ''),
    ];
}

function public_api_keys_file(): string {
    return WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'agency_api_keys.json';
}

function public_list_api_keys(): array {
    $items = read_json_file(public_api_keys_file(), []);
    if (!is_array($items)) return [];
    $out = [];
    foreach ($items as $k) {
        if (!is_array($k)) continue;
        $out[] = [
            'id'           => (string)($k['id'] ?? ''),
            'agencyName'   => (string)($k['agencyName'] ?? ''),
            'keyPrefix'    => (string)($k['keyPrefix'] ?? 'ws2_ag_***'),
            'scopes'       => $k['scopes'] ?? ['overview', 'environment', 'traffy'],
            'rateLimit'    => (int)($k['rateLimit'] ?? 600),
            'active'       => !empty($k['active']),
            'createdAt'    => $k['createdAt'] ?? null,
            'lastUsedAt'   => $k['lastUsedAt'] ?? null,
            'revokedAt'    => $k['revokedAt'] ?? null,
        ];
    }
    return $out;
}

function public_create_api_key(string $agencyName, array $scopes = ['overview', 'environment', 'traffy'], int $rateLimit = 600): array {
    $agencyClean = public_scrub_text($agencyName, 80);
    if ($agencyClean === '') {
        throw new InvalidArgumentException('กรุณาระบุชื่อหน่วยงาน');
    }
    $validScopes = ['overview', 'environment', 'traffy'];
    $cleanScopes = array_values(array_intersect($validScopes, array_map('strval', $scopes)));
    if (empty($cleanScopes)) $cleanScopes = $validScopes;

    $rawKey = 'ws2_ag_' . bin2hex(random_bytes(18));
    $keyHash = hash('sha256', $rawKey);
    $keyId = 'ag-' . substr(bin2hex(random_bytes(6)), 0, 12);
    $nowStr = date('Y-m-d H:i:s');

    $record = [
        'id'         => $keyId,
        'agencyName' => $agencyClean,
        'keyPrefix'  => substr($rawKey, 0, 13) . '...',
        'keyHash'    => $keyHash,
        'scopes'     => $cleanScopes,
        'rateLimit'  => max(60, min(3000, $rateLimit)),
        'active'     => true,
        'createdAt'  => $nowStr,
        'lastUsedAt' => null,
        'revokedAt'  => null,
    ];

    update_json_file_atomic(public_api_keys_file(), [], function (array $list) use ($record) {
        $list[] = $record;
        return $list;
    });

    sys_log_record([
        'module'         => 'public_api',
        'action'         => 'Issue Inter-Agency API Key',
        'status'         => 'success',
        'trigger_source' => 'user',
        'summary'        => "ออก API Key ให้หน่วยงาน [{$agencyClean}] (ID: {$keyId})",
    ]);

    return [
        'id'         => $keyId,
        'agencyName' => $agencyClean,
        'apiKey'     => $rawKey, // Shown ONLY once upon issuance!
        'keyPrefix'  => $record['keyPrefix'],
        'scopes'     => $cleanScopes,
        'rateLimit'  => $record['rateLimit'],
        'createdAt'  => $nowStr,
    ];
}

function public_revoke_api_key(string $keyId): bool {
    $revokedName = '';
    $found = false;
    update_json_file_atomic(public_api_keys_file(), [], function (array $list) use ($keyId, &$found, &$revokedName) {
        foreach ($list as &$item) {
            if (($item['id'] ?? '') === $keyId && !empty($item['active'])) {
                $item['active'] = false;
                $item['revokedAt'] = date('Y-m-d H:i:s');
                $revokedName = (string)($item['agencyName'] ?? $keyId);
                $found = true;
            }
        }
        return $list;
    });
    if ($found) {
        sys_log_record([
            'module'         => 'public_api',
            'action'         => 'Revoke Inter-Agency API Key',
            'status'         => 'success',
            'trigger_source' => 'user',
            'summary'        => "เพิกถอน API Key ของหน่วยงาน [{$revokedName}] ({$keyId})",
        ]);
    }
    return $found;
}

function public_extract_provided_api_key(): string {
    $hdr = trim((string)($_SERVER['HTTP_X_API_KEY'] ?? ''));
    if ($hdr !== '') return $hdr;
    $auth = trim((string)($_SERVER['HTTP_AUTHORIZATION'] ?? ''));
    if (stripos($auth, 'Bearer ') === 0) {
        $tok = trim(substr($auth, 7));
        if (strpos($tok, 'ws2_ag_') === 0) return $tok;
    }
    return trim((string)($_GET['api_key'] ?? ''));
}

/**
 * Returns: null (no key provided), false (invalid/revoked), or array (valid agency record)
 */
function public_verify_api_key_if_present() {
    $raw = public_extract_provided_api_key();
    if ($raw === '') return null;
    $hash = hash('sha256', $raw);
    $matched = false;

    update_json_file_atomic(public_api_keys_file(), [], function (array $list) use ($hash, &$matched) {
        foreach ($list as &$item) {
            if (!empty($item['active']) && !empty($item['keyHash']) && hash_equals((string)$item['keyHash'], $hash)) {
                $item['lastUsedAt'] = date('Y-m-d H:i:s');
                $matched = $item;
                break;
            }
        }
        return $list;
    });

    if (is_array($matched)) {
        unset($matched['keyHash']);
    }
    return $matched;
}

/**
 * Sliding-window 60-second rate limiter stored atomically in runtime/.
 */
function public_rate_limit_check(string $bucketKey, int $limitPerMin): array {
    $rlFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'public_rate_limits.json';
    $res = security_sliding_window_hit($rlFile, $bucketKey, $limitPerMin, 60, true);

    if (!headers_sent()) {
        header("X-RateLimit-Limit: {$res['limit']}");
        header("X-RateLimit-Remaining: {$res['remaining']}");
        header('X-RateLimit-Window: 60');
    }

    return ['allowed' => $res['allowed'], 'limit' => $res['limit'], 'remaining' => $res['remaining']];
}

function public_load_data_sources(?PDO $pdo): array {
    if ($pdo !== null) {
        $water = $pdo->query("
            SELECT w.station_name, w.river, w.amphoe, w.current_water_level_m,
                   w.left_bank_level_m, w.bank_difference_m, w.trend, w.status,
                   w.current_rain_mm, w.forecast_rain_24h_mm, w.risk_level, w.recorded_at
            FROM tbl_water_disaster_monitoring w
            INNER JOIN (SELECT station_name, MAX(id) AS max_id FROM tbl_water_disaster_monitoring WHERE station_name NOT LIKE '%Test%' GROUP BY station_name) latest
              ON w.id = latest.max_id
            ORDER BY w.station_name ASC
        ")->fetchAll();

        $rain = $pdo->query("
            SELECT r.station_name, r.location, r.river_basin, r.rain_mm, r.rain_status, r.measured_time, r.recorded_at
            FROM tbl_rainfall_monitoring r
            INNER JOIN (SELECT station_name, MAX(id) AS max_id FROM tbl_rainfall_monitoring WHERE station_name NOT LIKE '%Test%' GROUP BY station_name) latest
              ON r.id = latest.max_id
            ORDER BY r.rain_mm DESC, r.station_name ASC
        ")->fetchAll();

        $drought = $pdo->query("
            SELECT d.dam_name, d.dam_type, d.capacity_m_cum, d.water_volume_m_cum,
                   d.water_percent, d.usable_water_m_cum, d.inflow_m_cum, d.discharge_m_cum, d.recorded_at
            FROM tbl_drought_monitoring d
            INNER JOIN (SELECT dam_name, MAX(id) AS max_id FROM tbl_drought_monitoring WHERE dam_name NOT LIKE '%Test%' GROUP BY dam_name) latest
              ON d.id = latest.max_id
            ORDER BY d.capacity_m_cum DESC
        ")->fetchAll();

        $pm25 = $pdo->query("
            SELECT p.station_name, p.tambon, p.amphoe, p.pm25_value, p.pm25_avg_24h,
                   p.air_quality_status, p.time_label, p.recorded_at
            FROM tbl_pm25_monitoring p
            INNER JOIN (SELECT station_name, MAX(id) AS max_id FROM tbl_pm25_monitoring WHERE station_name NOT LIKE '%Test%' GROUP BY station_name) latest
              ON p.id = latest.max_id
            ORDER BY p.pm25_value DESC
        ")->fetchAll();

        $complaints = $pdo->query("
            SELECT ticket_id, state_name, agency_status, problem_type, description, location, org_name, ticket_datetime, satisfaction_stars, recorded_at
            FROM tbl_complaints_monitoring
            WHERE (is_in_scope = 1 OR is_in_scope IS NULL) AND ticket_id NOT LIKE '%TEST%'
            ORDER BY id DESC
            LIMIT 250
        ")->fetchAll();

        return [
            'source'     => 'live_mysql',
            'water'      => $water,
            'rainfall'   => $rain,
            'drought'    => $drought,
            'pm25'       => $pm25,
            'complaints' => $complaints,
        ];
    }

    // Cloud Snapshot emergency fallback when MySQL is offline
    $snap = get_latest_cloud_snapshot_bundle();
    return [
        'source'     => !empty($snap) ? 'cloud_fallback' : 'unavailable',
        'water'      => $snap['water'] ?? [],
        'rainfall'   => $snap['rainfall'] ?? [],
        'drought'    => $snap['drought'] ?? [],
        'pm25'       => $snap['pm25'] ?? [],
        'complaints' => $snap['complaints'] ?? [],
    ];
}

function public_build_traffy_stats(array $rawComplaints): array {
    $byState = [];
    $byAgency = [];
    $byType = [];
    $starsSum = 0.0;
    $starsCnt = 0;
    $paoTotal = 0;
    $completedTotal = 0;
    $sanitized = [];

    foreach ($rawComplaints as $r) {
        $clean = public_sanitize_complaint($r);
        $sanitized[] = $clean;
        $st = $clean['state_name'] ?: 'รอรับเรื่อง';
        $ag = $clean['agency_status'] ?: 'อื่นๆ';
        $tp = $clean['problem_type'] ?: 'ทั่วไป';

        $byState[$st] = ($byState[$st] ?? 0) + 1;
        $byAgency[$ag] = ($byAgency[$ag] ?? 0) + 1;
        $byType[$tp] = ($byType[$tp] ?? 0) + 1;

        if (mb_strpos($ag, 'อบจ.') !== false) $paoTotal++;
        if (mb_strpos($st, 'เสร็จสิ้น') !== false) $completedTotal++;
        if ($clean['satisfaction_stars'] !== null && $clean['satisfaction_stars'] > 0) {
            $starsSum += $clean['satisfaction_stars'];
            $starsCnt++;
        }
    }
    arsort($byState);
    arsort($byAgency);
    arsort($byType);

    return [
        'summary' => [
            'total'            => count($sanitized),
            'paoCount'         => $paoTotal,
            'otherAgencyCount' => max(0, count($sanitized) - $paoTotal),
            'completedCount'   => $completedTotal,
            'avgSatisfaction'  => $starsCnt > 0 ? round($starsSum / $starsCnt, 2) : null,
            'ratedCount'       => $starsCnt,
            'latestRecordedAt' => $sanitized[0]['recorded_at'] ?? null,
        ],
        'breakdown' => [
            'byState'  => $byState,
            'byAgency' => $byAgency,
            'byType'   => array_slice($byType, 0, 10, true),
        ],
        'items' => $sanitized,
    ];
}

function handle_public_api_routes(string $method, string $path, ?PDO $pdo, array $body = []): bool {
    // 1. Admin API Key Management Routes (/api/public/admin/*)
    if (strpos($path, '/api/public/admin/') === 0) {
        if (is_strict_auth_required()) {
            $u = get_current_user_session();
            if (empty($u['fromCookie']) || empty($u['user']) || (($u['user']['role'] ?? '') !== 'admin')) {
                send_json(['success' => false, 'error' => 'Admin permission required'], 403);
            }
        }
        if ($path === '/api/public/admin/keys' && $method === 'GET') {
            send_json(['success' => true, 'keys' => public_list_api_keys()]);
        }
        if ($path === '/api/public/admin/keys' && $method === 'POST') {
            try {
                $created = public_create_api_key(
                    (string)($body['agencyName'] ?? ''),
                    is_array($body['scopes'] ?? null) ? $body['scopes'] : ['overview', 'environment', 'traffy'],
                    (int)($body['rateLimit'] ?? 600)
                );
                send_json(['success' => true, 'key' => $created]);
            } catch (Throwable $e) {
                send_json(['success' => false, 'error' => $e->getMessage()], 400);
            }
        }
        if ($path === '/api/public/admin/keys/revoke' && $method === 'POST') {
            $kid = trim((string)($body['keyId'] ?? ''));
            $ok = $kid !== '' && public_revoke_api_key($kid);
            send_json(['success' => $ok, 'message' => $ok ? 'เพิกถอน API Key สำเร็จ' : 'ไม่พบ API Key ที่ระบุ'], $ok ? 200 : 404);
        }
        return false;
    }

    if (strpos($path, '/api/public/') !== 0) {
        return false;
    }

    if ($method !== 'GET') {
        send_json(['success' => false, 'error' => 'Method Not Allowed: Public Open Data API permits GET only'], 405);
    }

    // Security check: validate API Key if sent, enforce key on /api/public/agency/* routes
    $agencyInfo = public_verify_api_key_if_present();
    if ($agencyInfo === false) {
        send_json(['success' => false, 'error' => 'Unauthorized: Invalid or revoked X-API-Key'], 401);
    }

    $isAgencyRoute = (strpos($path, '/api/public/agency/') === 0);
    $requireGlobalKey = (env_val('PUBLIC_API_REQUIRE_KEY', '0') === '1');
    if (($isAgencyRoute || $requireGlobalKey) && !is_array($agencyInfo)) {
        send_json([
            'success' => false,
            'error'   => 'Unauthorized: กรุณาส่ง Header "X-API-Key: ws2_ag_..." สำหรับดึงข้อมูลหน่วยงาน',
            'docs'    => './endpoint.php?r=/api/public/openapi',
        ], 401);
    }

    // Rate Limit enforcement
    $clientIp = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $rlKey = is_array($agencyInfo) ? ('key_' . $agencyInfo['id']) : ('ip_' . hash('sha256', $clientIp));
    $rlMax = is_array($agencyInfo)
        ? (int)($agencyInfo['rateLimit'] ?? 600)
        : max(20, (int)env_val('PUBLIC_API_RATE_LIMIT', '120'));
    $rl = public_rate_limit_check($rlKey, $rlMax);
    if (empty($rl['allowed'])) {
        header('Retry-After: 60');
        send_json(['success' => false, 'error' => 'Rate Limit Exceeded (Too Many Requests): กรุณารอสักครู่แล้วเรียกใหม่'], 429);
    }

    // Audit Agency Key calls cleanly
    if (is_array($agencyInfo)) {
        sys_log_record([
            'module'         => 'public_api',
            'action'         => "Agency API Pull ({$path})",
            'status'         => 'success',
            'trigger_source' => 'agency_api',
            'summary'        => "หน่วยงาน [{$agencyInfo['agencyName']}] เรียก {$path}",
        ]);
    }

    // OpenAPI / Self-Documentation endpoint
    if ($path === '/api/public/openapi') {
        send_json([
            'openapi' => '3.0.3',
            'info' => [
                'title'       => 'Lampang PAO Integrated Disaster & Traffy Open Data API',
                'version'     => '2.0.0',
                'description' => 'บริการข้อมูลบูรณาการ 5 ด้านและ Traffy Fondue จ.ลำปาง (มีการคัดกรองข้อมูลส่วนบุคคล Zero-PII, จำกัดอัตราเรียก Rate Limit, และรองรับ X-API-Key สำหรับหน่วยงาน)',
            ],
            'securityControls' => [
                'readOnly'        => 'GET methods only',
                'piiRedaction'    => 'Automatically masks Phone numbers, Thai National IDs, Emails, LINE IDs, and removes raw_timeline',
                'rateLimit'       => 'Sliding 60-second window (HTTP 429 protection)',
                'agencyKeyAuth'   => 'SHA-256 hashed X-API-Key required for /api/public/agency/*',
            ],
            'endpoints' => [
                ['path' => '/api/public/overview',      'auth' => 'Open / Optional X-API-Key', 'desc' => 'สรุปภาพรวม 5 ด้าน, จุดแข็งระบบ, และ Traffy summary'],
                ['path' => '/api/public/environment',   'auth' => 'Open / Optional X-API-Key', 'desc' => 'ข้อมูลสิ่งแวดล้อมล่าสุด (น้ำ, ฝน, อ่างฯ, PM 2.5)'],
                ['path' => '/api/public/traffy',        'auth' => 'Open / Optional X-API-Key', 'desc' => 'สรุปสถิติและเรื่องร้องเรียน Traffy Fondue ลำปาง (คัดกรอง PII แล้ว)'],
                ['path' => '/api/public/agency/traffy', 'auth' => 'Required: X-API-Key',       'desc' => 'Feed เฉพาะหน่วยงาน รองรับ ?agency=all|pao|other&state=...&format=json|csv'],
                ['path' => '/api/public/agency/all',    'auth' => 'Required: X-API-Key',       'desc' => 'ข้อมูลบูรณาการครบทั้ง 5 ด้านสำหรับระบบภายนอกของหน่วยงาน'],
            ],
        ]);
    }

    $data = public_load_data_sources($pdo);
    $traffy = public_build_traffy_stats($data['complaints']);

    $envMeta = [
        'waterCount'        => count($data['water']),
        'waterCritical'     => count(array_filter($data['water'], function ($r) { return ($r['risk_level'] ?? '') === 'วิกฤต' || mb_strpos((string)($r['status'] ?? ''), 'ล้น') !== false; })),
        'rainfallCount'     => count($data['rainfall']),
        'rainfallRaining'   => count(array_filter($data['rainfall'], function ($r) { return (float)($r['rain_mm'] ?? 0) > 0; })),
        'droughtCount'      => count($data['drought']),
        'pm25Count'         => count($data['pm25']),
        'latestWaterAt'     => $data['water'][0]['recorded_at'] ?? null,
        'latestRainfallAt'  => $data['rainfall'][0]['recorded_at'] ?? null,
        'latestDroughtAt'   => $data['drought'][0]['recorded_at'] ?? null,
        'latestPm25At'      => $data['pm25'][0]['recorded_at'] ?? null,
    ];

    $metaHeader = [
        'generatedAt'        => date('c'),
        'dataSource'         => $data['source'],
        'piiProtected'       => true,
        'authenticatedAgency'=> is_array($agencyInfo) ? $agencyInfo['agencyName'] : null,
        'rateLimitRemaining' => $rl['remaining'],
    ];

    header('Cache-Control: public, max-age=30');

    if ($path === '/api/public/overview') {
        send_json([
            'success'       => true,
            'meta'          => $metaHeader,
            'organization'  => 'องค์การบริหารส่วนจังหวัดลำปาง (อบจ.ลำปาง)',
            'highlights'    => [
                ['title' => 'บูรณาการ 5 มิติครบจังหวัด', 'desc' => "น้ำ {$envMeta['waterCount']} สถานี, ฝน {$envMeta['rainfallCount']} สถานี, อ่างฯ {$envMeta['droughtCount']} แห่ง, ฝุ่น PM2.5 {$envMeta['pm25Count']} จุด และ Traffy Fondue {$traffy['summary']['total']} เรื่อง"],
                ['title' => 'ครบทั้ง 36 อ่างฯ + ฝน 3 วัน', 'desc' => 'ติดตามอ่างใหญ่ 3 แห่ง (กิ่วลม, กิ่วคอหมา, แม่มอก) กลาง/เล็ก 33 แห่ง พร้อมค่าฝนสะสม 3 วันล่วงหน้า'],
                ['title' => 'เก็บข้อมูล 24 ชม. + Cloud Failover', 'desc' => 'เก็บอัตโนมัติ 48 รอบ/วัน พร้อม Local Spool, Auto Backup และ GitHub Snapshot สำรอง'],
                ['title' => 'Open Data API ปลอดภัยระดับหน่วยงาน', 'desc' => 'คัดกรองข้อมูลส่วนบุคคล (Zero-PII), จำกัด Rate Limit และใช้ SHA-256 X-API-Key'],
            ],
            'environment'   => $envMeta,
            'traffySummary' => $traffy['summary'],
            'traffyBreakdown'=> $traffy['breakdown'],
        ]);
    }

    if ($path === '/api/public/environment') {
        $domainParam = (string)($_GET['domain'] ?? 'all');
        $payload = [
            'success' => true,
            'meta'    => $metaHeader,
            'summary' => $envMeta,
        ];
        if ($domainParam === 'all' || $domainParam === 'water')    $payload['water']    = $data['water'];
        if ($domainParam === 'all' || $domainParam === 'rainfall') $payload['rainfall'] = $data['rainfall'];
        if ($domainParam === 'all' || $domainParam === 'drought')  $payload['drought']  = $data['drought'];
        if ($domainParam === 'all' || $domainParam === 'pm25')     $payload['pm25']     = $data['pm25'];
        send_json($payload);
    }

    if ($path === '/api/public/traffy') {
        $limit = min(max((int)($_GET['limit'] ?? 60), 1), 100);
        send_json([
            'success'   => true,
            'meta'      => $metaHeader,
            'summary'   => $traffy['summary'],
            'breakdown' => $traffy['breakdown'],
            'items'     => array_slice($traffy['items'], 0, $limit),
        ]);
    }

    if ($path === '/api/public/agency/traffy') {
        if (is_array($agencyInfo) && !in_array('traffy', $agencyInfo['scopes'] ?? ['traffy'], true)) {
            send_json(['success' => false, 'error' => 'Forbidden: API Key lacks traffy scope'], 403);
        }
        $agencyFilter = strtolower(trim((string)($_GET['agency'] ?? 'all')));
        $stateFilter  = trim((string)($_GET['state'] ?? ''));
        $limit        = min(max((int)($_GET['limit'] ?? 100), 1), 250);
        $format       = strtolower(trim((string)($_GET['format'] ?? 'json')));

        $filtered = array_values(array_filter($traffy['items'], function ($it) use ($agencyFilter, $stateFilter) {
            if ($agencyFilter === 'pao' && mb_strpos($it['agency_status'], 'อบจ.') === false) return false;
            if ($agencyFilter === 'other' && mb_strpos($it['agency_status'], 'อบจ.') !== false) return false;
            if ($stateFilter !== '' && $it['state_name'] !== $stateFilter) return false;
            return true;
        }));
        $filtered = array_slice($filtered, 0, $limit);

        if ($format === 'csv') {
            $csv = "\xEF\xBB\xBFticket_id,state_name,agency_status,problem_type,org_name,area,summary,ticket_datetime,satisfaction_stars,recorded_at\n";
            foreach ($filtered as $it) {
                $csv .= sprintf("\"%s\",\"%s\",\"%s\",\"%s\",\"%s\",\"%s\",\"%s\",\"%s\",%s,\"%s\"\n",
                    str_replace('"', '""', $it['ticket_id']),
                    str_replace('"', '""', $it['state_name']),
                    str_replace('"', '""', $it['agency_status']),
                    str_replace('"', '""', $it['problem_type']),
                    str_replace('"', '""', $it['org_name']),
                    str_replace('"', '""', $it['area']),
                    str_replace('"', '""', $it['summary']),
                    str_replace('"', '""', $it['ticket_datetime']),
                    $it['satisfaction_stars'] ?? '',
                    str_replace('"', '""', $it['recorded_at'])
                );
            }
            header('Content-Type: text/csv; charset=utf-8');
            header('Content-Disposition: attachment; filename="Lampang_Traffy_Agency_Feed.csv"');
            echo $csv;
            exit;
        }

        send_json([
            'success' => true,
            'meta'    => $metaHeader,
            'count'   => count($filtered),
            'summary' => $traffy['summary'],
            'items'   => $filtered,
        ]);
    }

    if ($path === '/api/public/agency/all') {
        send_json([
            'success'     => true,
            'meta'        => $metaHeader,
            'environment' => [
                'summary'  => $envMeta,
                'water'    => $data['water'],
                'rainfall' => $data['rainfall'],
                'drought'  => $data['drought'],
                'pm25'     => $data['pm25'],
            ],
            'traffy'      => $traffy,
        ]);
    }

    send_json(['success' => false, 'error' => 'Public API Endpoint Not Found'], 404);
}
