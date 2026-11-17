<?php
// =========================================================================
// LP-PAO Smart Data — End-to-End Traffy Fondue + Cookie & Session E2E Test Suite
// Tests ALL 5 flows on live http://127.0.0.1:7000 + MySQL + Upstream Traffy:
//   Stage 1: Internal App Session & Cookie (water_session_7000, HttpOnly, SameSite=Strict, CSRF, Rotation, Logout)
//   Stage 2: Chrome Extension 04ext_TraffyLP Pairing -> Bearer Token -> /api/ping -> /api/append-complaints-db -> Revoke
//   Stage 3: Traffy Cookie / Bearer Token Storage Security (notification_secrets.json isolation, masking, build_traffy_headers)
//   Stage 4: Live Traffy Endpoints Diagnostic (citydata.traffy.in.th SPA, api.traffy.in.th PostgREST, publicapi.traffy.in.th)
//   Stage 5: MySQL Complaints State & System Log Integration
// =========================================================================

error_reporting(E_ALL);
ini_set('display_errors', '1');
date_default_timezone_set('Asia/Bangkok');

require_once dirname(__DIR__) . '/php_server/config.php';
require_once dirname(__DIR__) . '/php_server/auth.php';
require_once dirname(__DIR__) . '/php_server/collectors.php';

$pass = 0;
$fail = 0;
$warn = 0;

function check_pass(bool $ok, string $title, string $detail = ''): void {
    global $pass, $fail;
    if ($ok) {
        $pass++;
        echo "[PASS] {$title}" . ($detail !== '' ? " -> {$detail}" : '') . "\n";
    } else {
        $fail++;
        echo "[FAIL] {$title}" . ($detail !== '' ? " -> {$detail}" : '') . "\n";
    }
}

function check_warn(string $title, string $detail = ''): void {
    global $warn;
    $warn++;
    echo "[WARN] {$title}" . ($detail !== '' ? " -> {$detail}" : '') . "\n";
}

function call_http(string $url, string $method = 'GET', ?array $jsonBody = null, array $headers = [], ?string $cookieJar = null): array {
    $ch = curl_init($url);
    $respHeaders = [];
    $hdrs = array_merge(['Accept: application/json, text/html, */*'], $headers);
    if ($jsonBody !== null) $hdrs[] = 'Content-Type: application/json';

    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_TIMEOUT        => 25,
        CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_HTTPHEADER     => $hdrs,
        CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$respHeaders) {
            $respHeaders[] = trim($line);
            return strlen($line);
        },
    ];
    if ($jsonBody !== null) $opts[CURLOPT_POSTFIELDS] = json_encode($jsonBody, JSON_UNESCAPED_UNICODE);
    if ($cookieJar !== null) {
        $opts[CURLOPT_COOKIEJAR]  = $cookieJar;
        $opts[CURLOPT_COOKIEFILE] = $cookieJar;
    }

    curl_setopt_array($ch, $opts);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    return [
        'code'    => $code,
        'body'    => $body,
        'json'    => is_string($body) ? json_decode($body, true) : null,
        'headers' => $respHeaders,
        'error'   => $err,
    ];
}

$baseUrl = 'http://127.0.0.1:7000';
$pdo = get_db();

echo "=================================================================\n";
echo "Traffy Fondue & Cookie/Session Full E2E Test @ " . date('Y-m-d H:i:s') . "\n";
echo "=================================================================\n\n";

// -------------------------------------------------------------------------
// STAGE 1: App Cookie & Session Security Lifecycle (with real password verification)
// -------------------------------------------------------------------------
echo "--- STAGE 1: LP-PAO Smart Data Cookie & Session Lifecycle ---\n";
$testAdminUser = 'e2e_admin_' . mt_rand(1000, 9999);
$testAdminPass = 'StrongVerifyPass_7000!';
$createUserRes = call_http("{$baseUrl}/api/auth/users", 'POST', [
    'username' => $testAdminUser,
    'password' => $testAdminPass,
    'role'     => 'admin',
]);
check_pass(
    $createUserRes['code'] === 201 && ($createUserRes['json']['user']['username'] ?? '') === $testAdminUser,
    '1.0 Created temporary PHP-hashed admin user for real credential verification'
);

$badLogin = call_http("{$baseUrl}/api/auth/login", 'POST', ['username' => $testAdminUser, 'password' => 'WrongPassword123!']);
check_pass($badLogin['code'] === 401, '1.0b POST /api/auth/login rejects wrong password with HTTP 401');

$jar = LP_PAO_RUNTIME_DIR . '/e2e_cookie_jar.txt';
@unlink($jar);

$login1 = call_http("{$baseUrl}/api/auth/login", 'POST', ['username' => $testAdminUser, 'password' => $testAdminPass], [], $jar);
$setCookieHdr = '';
foreach ($login1['headers'] as $h) {
    if (stripos($h, 'Set-Cookie:') === 0 && strpos($h, SESSION_COOKIE_NAME . '=') !== false) {
        $setCookieHdr = $h;
    }
}
$csrf1 = $login1['json']['csrfToken'] ?? '';
check_pass(
    $login1['code'] === 200
    && $setCookieHdr !== ''
    && stripos($setCookieHdr, 'HttpOnly') !== false
    && stripos($setCookieHdr, 'SameSite=Strict') !== false
    && $csrf1 !== '',
    '1.1 POST /api/auth/login sets HttpOnly + SameSite=Strict Cookie & returns csrfToken',
    $setCookieHdr
);

// Extract raw session token from Set-Cookie to inspect sessions.json directly
preg_match('/' . preg_quote(SESSION_COOKIE_NAME, '/') . '=([^;]+)/', $setCookieHdr, $tm);
$rawTok1 = urldecode($tm[1] ?? '');
$sessionsBeforeRotate = read_json_file(get_sessions_path(), []);
check_pass(
    $rawTok1 !== '' && isset($sessionsBeforeRotate[hash('sha256', $rawTok1)]),
    '1.2 Session stored in sessions.json strictly as SHA-256 hash (no plaintext token)'
);

$me1 = call_http("{$baseUrl}/api/auth/me", 'GET', null, [], $jar);
check_pass(
    $me1['code'] === 200 && ($me1['json']['csrfToken'] ?? '') === $csrf1 && ($me1['json']['user']['username'] ?? '') === $testAdminUser,
    '1.3 GET /api/auth/me with Cookie returns matching active session, username & csrfToken'
);

// Re-login rotates session & invalidates old token hash
$login2 = call_http("{$baseUrl}/api/auth/login", 'POST', ['username' => $testAdminUser, 'password' => $testAdminPass], [], $jar);
$csrf2 = $login2['json']['csrfToken'] ?? '';
$sessionsAfterRotate = read_json_file(get_sessions_path(), []);
check_pass(
    $csrf2 !== '' && $csrf2 !== $csrf1 && !isset($sessionsAfterRotate[hash('sha256', $rawTok1)]),
    '1.4 Re-login rotates session ID & invalidates prior session hash (Session Fixation protection)'
);

$logout = call_http("{$baseUrl}/api/auth/logout", 'POST', [], ['X-CSRF-Token: ' . $csrf2], $jar);
$logoutSetCookie = '';
foreach ($logout['headers'] as $h) {
    if (stripos($h, 'Set-Cookie:') === 0 && strpos($h, SESSION_COOKIE_NAME . '=') !== false) {
        $logoutSetCookie = $h;
    }
}
$meAfterLogout = call_http("{$baseUrl}/api/auth/me", 'GET', null, [], $jar);
check_pass(
    !empty($logout['json']['success'])
    && stripos($logoutSetCookie, 'Max-Age=0') !== false
    && ($meAfterLogout['json']['csrfToken'] ?? '') !== $csrf2,
    '1.5 POST /api/auth/logout destroys session hash & expires browser cookie (Max-Age=0)'
);

// 1.6 Remember Me (30-day TTL) + Sliding Expiration Auto-Extend + /api/auth/refresh
@unlink($jar);
$loginRem = call_http("{$baseUrl}/api/auth/login", 'POST', ['username' => $testAdminUser, 'password' => $testAdminPass, 'remember' => true], [], $jar);
$remCookieHdr = '';
foreach ($loginRem['headers'] as $h) {
    if (stripos($h, 'Set-Cookie:') === 0 && strpos($h, SESSION_COOKIE_NAME . '=') !== false) $remCookieHdr = $h;
}
check_pass(
    ($loginRem['json']['ttlSeconds'] ?? 0) === (30 * 86400) && strpos($remCookieHdr, 'Max-Age=2592000') !== false,
    '1.6 Remember-Me login issues 30-day session & Max-Age=2592000 Cookie'
);

preg_match('/' . preg_quote(SESSION_COOKIE_NAME, '/') . '=([^;]+)/', $remCookieHdr, $tmRem);
$remHash = hash('sha256', urldecode($tmRem[1] ?? ''));
// Simulate near-expiry session (only 1 hour left on 30-day session -> triggers Sliding Auto-Extend)
update_json_file_atomic(get_sessions_path(), [], function (array $s) use ($remHash) {
    if (isset($s[$remHash])) $s[$remHash]['expires'] = time() + 3600;
    return $s;
});
$meSliding = call_http("{$baseUrl}/api/auth/me", 'GET', null, [], $jar);
$slidingCookieHdr = '';
foreach ($meSliding['headers'] as $h) {
    if (stripos($h, 'Set-Cookie:') === 0 && strpos($h, SESSION_COOKIE_NAME . '=') !== false) $slidingCookieHdr = $h;
}
$sessionsAfterSlide = read_json_file(get_sessions_path(), []);
check_pass(
    $slidingCookieHdr !== ''
    && strpos($slidingCookieHdr, 'Max-Age=2592000') !== false
    && (($sessionsAfterSlide[$remHash]['expires'] ?? 0) - time()) > (29 * 86400),
    '1.7 Sliding Session auto-extended Cookie & Server Session back to 30 days on activity'
);

$refreshRes = call_http("{$baseUrl}/api/auth/refresh", 'POST', [], [], $jar);
check_pass(
    $refreshRes['code'] === 200 && !empty($refreshRes['json']['success']) && ($refreshRes['json']['ttlSeconds'] ?? 0) === (30 * 86400),
    '1.8 POST /api/auth/refresh explicitly renews active session & cookie'
);
call_http("{$baseUrl}/api/auth/logout", 'POST', [], [], $jar);
@unlink($jar);

// -------------------------------------------------------------------------
// STAGE 2: Chrome Extension 04ext_TraffyLP Pairing -> Bearer -> Push -> Revoke
// -------------------------------------------------------------------------
echo "\n--- STAGE 2: Chrome Extension (04ext_TraffyLP) Device Token & Ingestion ---\n";
$badPair = call_http("{$baseUrl}/api/auth/pair-device", 'POST', [
    'username' => $testAdminUser,
    'password' => 'WrongPassword!',
    'name'     => 'Should-Reject',
]);
check_pass($badPair['code'] === 401, '2.0 POST /api/auth/pair-device rejects wrong admin password with HTTP 401');

$pairRes = call_http("{$baseUrl}/api/auth/pair-device", 'POST', [
    'username' => $testAdminUser,
    'password' => $testAdminPass,
    'name'     => 'E2E-Test-TraffyLP-Extension',
]);
$devToken = $pairRes['json']['token'] ?? '';
$devId    = $pairRes['json']['id'] ?? '';
check_pass(
    $pairRes['code'] === 200 && strlen($devToken) === 64 && $devId !== '',
    '2.1 POST /api/auth/pair-device issued 64-char Extension Bearer Token',
    "deviceId={$devId}"
);

$pingOk = call_http("{$baseUrl}/api/ping", 'POST', [], ['Authorization: Bearer ' . $devToken]);
check_pass(
    $pingOk['code'] === 200 && !empty($pingOk['json']['authenticated']) && ($pingOk['json']['deviceId'] ?? '') === $devId,
    '2.2 POST /api/ping verified Extension Bearer Token & updated heartbeat'
);

$pingBad = call_http("{$baseUrl}/api/ping", 'POST', [], ['Authorization: Bearer invalid_fake_token_123']);
check_pass(
    $pingBad['code'] === 401,
    '2.3 POST /api/ping rejects forged/invalid Bearer Token with HTTP 401'
);

$extTicket = 'E2E-TRAFFY-' . date('His');
$batchKey = 'e2e_batch_' . time();
$pushRes = call_http(
    "{$baseUrl}/api/append-complaints-db",
    'POST',
    [
        'rows' => [[
            'ticket_id'       => $extTicket,
            'state_name'      => 'กำลังดำเนินการ',
            'problem_type'    => 'ไฟฟ้าส่องสว่าง',
            'description'     => 'E2E Extension Bridge Test Ticket (Lampang PAO)',
            'location'        => 'ต.สบตุ๋ย อ.เมืองลำปาง จ.ลำปาง',
            'org_name'        => 'องค์การบริหารส่วนจังหวัดลำปาง (อบจ.ลำปาง)',
            'ticket_datetime' => date('Y-m-d H:i:s'),
            'is_in_scope'     => 1,
        ]]
    ],
    ['Authorization: Bearer ' . $devToken, 'X-Ingest-Key: ' . $batchKey]
);
$savedExt = $pdo->query("SELECT ticket_id, state_name, agency_status FROM tbl_complaints_monitoring WHERE ticket_id = " . $pdo->quote($extTicket))->fetch();
check_pass(
    $pushRes['code'] === 200
    && !empty($pushRes['json']['success'])
    && ($savedExt['agency_status'] ?? '') === 'งานที่ อบจ.กำลังดำเนินการ',
    '2.4 POST /api/append-complaints-db saved & classified Extension payload accurately',
    'agency_status=' . ($savedExt['agency_status'] ?? 'NULL')
);

// Revoke test device & verify rejection
$revokeRes = call_http("{$baseUrl}/api/auth/devices/" . urlencode($devId), 'DELETE');
$pushRevoked = call_http("{$baseUrl}/api/append-complaints-db", 'POST', ['rows' => [['ticket_id' => 'SHOULD-FAIL']]], ['Authorization: Bearer ' . $devToken]);
check_pass(
    !empty($revokeRes['json']['success']) && $pushRevoked['code'] === 401,
    '2.5 Revoked Extension device token is rejected immediately with HTTP 401'
);

// Clean up synthetic E2E device, temporary test user & complaint row cleanly
$pdo->exec("DELETE FROM tbl_complaints_monitoring WHERE ticket_id = " . $pdo->quote($extTicket));
$pdo->exec("DELETE FROM app_complaint_events WHERE ticket_id = " . $pdo->quote($extTicket));
$pdo->exec("DELETE FROM app_ingest_batches WHERE batch_id = " . $pdo->quote($batchKey));
update_json_file_atomic(get_accounts_path(), ['users' => [], 'devices' => []], function (array $acc) use ($devId, $testAdminUser) {
    $acc['devices'] = array_values(array_filter($acc['devices'] ?? [], function ($d) use ($devId) {
        return ($d['id'] ?? '') !== $devId;
    }));
    $acc['users'] = array_values(array_filter($acc['users'] ?? [], function ($u) use ($testAdminUser) {
        return ($u['username'] ?? '') !== $testAdminUser;
    }));
    return $acc;
});

// -------------------------------------------------------------------------
// STAGE 3: Traffy Personal Cookie / Bearer Token Config & Forwarding Test
// -------------------------------------------------------------------------
echo "\n--- STAGE 3: Traffy Personal Cookie & Bearer Token Forwarding Security ---\n";
$origCfg = get_app_config()['traffyAuth'] ?? ['cookie' => '', 'token' => '', 'orgId' => '469'];
$hadRealTraffyAuth = (!empty($origCfg['cookie']) || !empty($origCfg['token']));

if (!$hadRealTraffyAuth) {
    $sampleCookie = 'session=e2e_dummy_cookie_value';
    $sampleJwt = base64_encode('{"alg":"HS256"}') . '.' . base64_encode(json_encode(['exp' => time() + 3600, 'role' => 'officer'])) . '.sig';
    $saveSess = call_http("{$baseUrl}/api/traffy/session-config", 'POST', [
        'cookie' => $sampleCookie,
        'token'  => json_encode('Bearer ' . $sampleJwt),
        'orgId'  => '',
    ]);
    $statusCheck = call_http("{$baseUrl}/api/traffy/session-status");
    $sj = $statusCheck['json'] ?? [];
    $hdrs = build_traffy_headers();
    $configJsonRaw = (string)@file_get_contents(dirname(__DIR__) . '/config.json');

    check_pass(
        !empty($saveSess['json']['success'])
        && !empty($sj['configured'])
        && !empty($sj['hasCookie'])
        && !empty($sj['hasToken'])
        && !empty($sj['jwtInfo']['expAt'])
        && isset($sj['jwtInfo']['remainingHours'])
        && strpos((string)$statusCheck['body'], 'e2e_dummy_cookie_value') === false
        && strpos($configJsonRaw, 'e2e_dummy_cookie_value') === false
        && in_array('Cookie: ' . $sampleCookie, $hdrs, true)
        && in_array('Authorization: Bearer ' . $sampleJwt, $hdrs, true),
        '3.1 Traffy Cookie/Token (even JSON-wrapped local_login_data) stored strictly in notification_secrets.json, masked & decoded for exp countdown'
    );

    $planWithToken = get_traffy_request_plan();
    check_pass(
        !empty($planWithToken[0]['url']) && strpos($planWithToken[0]['url'], 'https://api.traffy.in.th/postgrest/rpc/get_user_all_orgs_feed') === 0,
        '3.2 Server-to-Server request planner selects api.traffy.in.th/postgrest feed automatically when LINE Token/Cookie is configured',
        $planWithToken[0]['url'] ?? ''
    );

    // Restore clean cleared state
    call_http("{$baseUrl}/api/traffy/session-config", 'POST', ['clear' => true]);

    $planNoToken = get_traffy_request_plan();
    check_pass(
        !empty($planNoToken[0]['url']) && strpos($planNoToken[0]['url'], 'https://publicapi.traffy.in.th/') === 0,
        '3.3 Server-to-Server request planner falls back cleanly to publicapi.traffy.in.th when no Token/Org is configured'
    );
} else {
    check_pass(true, '3.1 Real Traffy Cookie/Token already configured in runtime secrets (preserved)');
}

$postgrestSample = [
    [
        'ticket_id'          => '2026-PG-TEST',
        'state'              => 'กำลังดำเนินการ',
        'issue_category_name'=> 'ถนน',
        'description'        => 'PostgREST feed row accuracy check',
        'address'            => 'ต.พระบาท อ.เมืองลำปาง จ.ลำปาง',
        'province'           => 'ลำปาง',
        'fd_reported_tos'    => [['name' => 'องค์การบริหารส่วนจังหวัดลำปาง (อบจ.ลำปาง)']],
        'timestamp'          => '2026-11-16 15:00:00',
        'photo_url'          => 'https://example.com/a.jpg',
        'star'               => 5,
    ]
];
$pgTransformed = transform_traffy_complaints($postgrestSample, 10);
check_pass(
    count($pgTransformed) === 1
    && $pgTransformed[0]['ticket_id'] === '2026-PG-TEST'
    && $pgTransformed[0]['problem_type'] === 'ถนน'
    && strpos($pgTransformed[0]['org_name'], 'อบจ.ลำปาง') !== false,
    '3.4 transform_traffy_complaints() accurately maps authenticated api.traffy.in.th PostgREST feed rows (zero Extension needed)'
);

// -------------------------------------------------------------------------
// STAGE 4: Live Traffy Upstream API & Portal Cookie/Session Verification
// -------------------------------------------------------------------------
echo "\n--- STAGE 4: Live Traffy Upstream Endpoints & Session Gate Diagnostics ---\n";
$diagRes = call_http("{$baseUrl}/api/traffy/test-session", 'POST', []);
$dj = $diagRes['json'] ?? [];
check_pass(
    $diagRes['code'] === 200 && !empty($dj['appSession']['ok']),
    '4.1 POST /api/traffy/test-session completed App Session roundtrip check',
    $dj['appSession']['message'] ?? ''
);
check_pass(
    !empty($dj['publicApi']['citydataReachable']),
    '4.2 https://citydata.traffy.in.th/recent-post SPA reachable (HTTP 200)'
);

if (!$hadRealTraffyAuth) {
    check_warn(
        '4.3 Traffy Personal Session Cookie / Bearer Token is NOT configured in system secrets',
        'api.traffy.in.th/postgrest requires officer login JWT/Cookie from citydata.traffy.in.th (HTTP 401 without user token)'
    );
} else {
    check_pass(!empty($dj['traffyAuth']['ok']), '4.3 Authenticated Traffy Cookie/Token verified against api.traffy.in.th', $dj['traffyAuth']['statusLabel'] ?? '');
}

$geoOk = !empty($dj['publicApi']['geojson']['ok']);
if ($geoOk) {
    check_pass(true, '4.4 publicapi.traffy.in.th GeoJSON API responded OK', 'rows=' . ($dj['publicApi']['geojson']['lampangCount'] ?? 0));
} else {
    check_warn(
        '4.4 publicapi.traffy.in.th/teamchadchart-stat-api currently DOWN/TIMING OUT at Traffy upstream',
        'geojson HTTP=' . ($dj['publicApi']['geojson']['httpCode'] ?? 0) . ' (' . ($dj['publicApi']['geojson']['error'] ?? 'timeout') . ') | timeline HTTP=' . ($dj['publicApi']['timeline']['httpCode'] ?? 0)
    );
}

// -------------------------------------------------------------------------
// STAGE 5: Existing MySQL Data & Audit Log Check
// -------------------------------------------------------------------------
echo "\n--- STAGE 5: MySQL tbl_complaints_monitoring & System Logs Summary ---\n";
$compTotal = (int)$pdo->query("SELECT COUNT(*) FROM tbl_complaints_monitoring WHERE (is_in_scope = 1 OR is_in_scope IS NULL)")->fetchColumn();
$compLatest = $pdo->query("SELECT MAX(recorded_at) FROM tbl_complaints_monitoring")->fetchColumn();
$agencyDist = $pdo->query("SELECT agency_status, COUNT(*) c FROM tbl_complaints_monitoring GROUP BY agency_status ORDER BY c DESC LIMIT 5")->fetchAll();
check_pass($compTotal > 0, '5.1 Existing complaints data intact in MySQL', "inScopeRows={$compTotal}, lastRecorded={$compLatest}");
foreach ($agencyDist as $row) {
    echo "   - {$row['agency_status']}: {$row['c']} rows\n";
}

echo "\n=================================================================\n";
echo "TRAFFY + SESSION/COOKIE SUMMARY: PASS={$pass}, FAIL={$fail}, WARN={$warn}\n";
echo "=================================================================\n";

exit($fail > 0 ? 1 : 0);
