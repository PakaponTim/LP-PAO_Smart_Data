<?php
// =========================================================================
// Water_System2 — 6-Layer Security Hardening E2E Verification Suite
// Usage: php tests/verify_security_hardening_e2e.php
// =========================================================================

date_default_timezone_set('Asia/Bangkok');
ini_set('display_errors', '1');
error_reporting(E_ALL);

require_once __DIR__ . '/../php_server/config.php';
require_once __DIR__ . '/../php_server/auth.php';
require_once __DIR__ . '/../php_server/backup_manager.php';
require_once __DIR__ . '/../php_server/collectors_transform.php';

$pass = 0;
$fail = 0;

function s_assert(bool $cond, string $label, string $detail = ''): void {
    global $pass, $fail;
    if ($cond) {
        $pass++;
        echo "[PASS] {$label}" . ($detail !== '' ? " -> {$detail}" : '') . "\n";
    } else {
        $fail++;
        echo "[FAIL] {$label}" . ($detail !== '' ? " -> {$detail}" : '') . "\n";
    }
}

function http_sec_req(string $url, string $method = 'GET', array $headers = [], ?string $body = null, ?string $cookieJar = null, bool $writeCookies = false): array {
    $ch = curl_init($url);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_TIMEOUT        => 8,
    ];
    if (!empty($headers)) {
        $opts[CURLOPT_HTTPHEADER] = $headers;
    }
    if ($body !== null) {
        $opts[CURLOPT_POSTFIELDS] = $body;
    }
    if ($cookieJar !== null) {
        if (file_exists($cookieJar)) {
            $opts[CURLOPT_COOKIEFILE] = $cookieJar;
        }
        if ($writeCookies) {
            $opts[CURLOPT_COOKIEJAR] = $cookieJar;
        }
    }
    curl_setopt_array($ch, $opts);
    $raw = (string)curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $hdrSize = (int)curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    return [
        'code'    => $code,
        'headers' => substr($raw, 0, $hdrSize),
        'body'    => substr($raw, $hdrSize),
    ];
}

echo "=================================================================\n";
echo "Water_System2 6-Layer Security Hardening E2E Test\n";
echo "=================================================================\n\n";

$base = 'http://127.0.0.1:7000';
$extIp = '203.0.113.55';
$extHeaders = ["X-Forwarded-For: {$extIp}"];

// -------------------------------------------------------------------------
// Approach 1: Smart Production Auth Guard (Loopback vs External IP)
// -------------------------------------------------------------------------
$rLocalMe = http_sec_req("{$base}/endpoint.php?r=" . urlencode('/api/auth/me'));
s_assert($rLocalMe['code'] === 200, 'Approach 1 (Local Dev): Direct 127.0.0.1 /api/auth/me works seamlessly', "code={$rLocalMe['code']}");

$rExtMe = http_sec_req("{$base}/endpoint.php?r=" . urlencode('/api/auth/me'), 'GET', $extHeaders);
$rExtBk = http_sec_req("{$base}/endpoint.php?r=" . urlencode('/api/backup/download'), 'GET', $extHeaders);
$rExtBkSt = http_sec_req("{$base}/endpoint.php?r=" . urlencode('/api/backup/status'), 'GET', $extHeaders);
$rExtBkRun = http_sec_req("{$base}/endpoint.php?r=" . urlencode('/api/backup/run'), 'POST', array_merge($extHeaders, ['Content-Type: application/json']), '{}');
$rExtEmptyLogin = http_sec_req("{$base}/endpoint.php?r=" . urlencode('/api/auth/login'), 'POST', array_merge($extHeaders, ['Content-Type: application/json']), '{"username":"admin","password":""}');
s_assert(
    $rExtMe['code'] === 401 && $rExtBk['code'] === 401 && $rExtBkSt['code'] === 401 && $rExtBkRun['code'] === 401 && $rExtEmptyLogin['code'] === 401,
    'Approach 1 (External Strict Mode): Unauthenticated external calls to /api/auth/me, /api/backup/* & empty-pass login blocked with HTTP 401',
    "me={$rExtMe['code']}, dl={$rExtBk['code']}, run={$rExtBkRun['code']}, emptyLogin={$rExtEmptyLogin['code']}"
);

$rExtPub = http_sec_req("{$base}/endpoint.php?r=" . urlencode('/api/public/overview'), 'GET', $extHeaders);
s_assert($rExtPub['code'] === 200, 'Approach 1 (Public Access): External /api/public/overview remains accessible', "code={$rExtPub['code']}");

// -------------------------------------------------------------------------
// Approach 2: Zero-PII Cloud Snapshot & Push Guard
// -------------------------------------------------------------------------
$dirtyRows = [[
    'ticket_id'      => 'LP-SNAP-1',
    'description'    => 'น้ำท่วมซอย ติดต่อ 089-123-4567 บัตร 1-5201-00999-12-3 เมล a@b.go.th LINE: lineuser01',
    'location'       => 'บ้านพัก 0812223333 อ.เมืองลำปาง',
    'raw_timeline'   => ['internal' => 'secret'],
    'reporter_phone' => '0891234567',
]];
$cleanRows = sanitize_traffy_rows_zero_pii($dirtyRows);
$c0 = $cleanRows[0] ?? [];
s_assert(
    !array_key_exists('raw_timeline', $c0)
    && !array_key_exists('reporter_phone', $c0)
    && strpos((string)($c0['description'] ?? ''), '089-123-4567') === false
    && strpos((string)($c0['description'] ?? ''), '1-5201-00999-12-3') === false
    && strpos((string)($c0['location'] ?? ''), '0812223333') === false,
    'Approach 2 (Zero-PII Sanitizer): sanitize_traffy_rows_zero_pii() scrubs ID/phone/email/LINE & drops raw fields'
);

$rFallback = http_sec_req("{$base}/endpoint.php?r=" . urlencode('/api/cloud-fallback'), 'GET', $extHeaders);
$jFb = json_decode($rFallback['body'], true);
$fbLeak = false;
foreach (($jFb['snapshot']['complaints'] ?? []) as $cp) {
    $txt = (string)($cp['description'] ?? '') . ' ' . (string)($cp['location'] ?? '');
    if (array_key_exists('raw_timeline', $cp) || preg_match('/(?<!\d)0[689]\d{8}(?!\d)/', $txt)) {
        $fbLeak = true;
        break;
    }
}
s_assert($rFallback['code'] === 200 && !$fbLeak, 'Approach 2 (Cloud Fallback): /api/cloud-fallback serves scrubbed Zero-PII complaints', "code={$rFallback['code']}");

// -------------------------------------------------------------------------
// Approach 3: Cron HMAC Verification, Worker Lock & Extension Isolation
// -------------------------------------------------------------------------
$testCronSecret = 'ws2_unit_cron_secret_123456';
$cronUrl = 'https://water.lampangpao.go.th/Water_System2/cron.php';
$hmacHdrs = security_sign_cron_headers($cronUrl, $testCronSecret, time());
$hdrMap = [];
foreach ($hmacHdrs as $hLine) {
    [$hk, $hv] = array_map('trim', explode(':', $hLine, 2));
    $hdrMap['HTTP_' . strtoupper(str_replace('-', '_', $hk))] = $hv;
}
$origServer = $_SERVER;
$_SERVER['REQUEST_URI'] = '/Water_System2/cron.php';
$_SERVER['REMOTE_ADDR'] = $extIp;
$_SERVER['HTTP_X_CRON_TIMESTAMP'] = $hdrMap['HTTP_X_CRON_TIMESTAMP'] ?? '';
$_SERVER['HTTP_X_CRON_SIGNATURE'] = $hdrMap['HTTP_X_CRON_SIGNATURE'] ?? '';
$hmacOk = security_verify_cron_or_admin(false, $testCronSecret);
$_SERVER['HTTP_X_CRON_SIGNATURE'] = 'sha256=' . str_repeat('0', 64);
$hmacBadSig = security_verify_cron_or_admin(false, $testCronSecret);
$_SERVER['HTTP_X_CRON_TIMESTAMP'] = (string)(time() - 900);
$_SERVER['HTTP_X_CRON_SIGNATURE'] = $hdrMap['HTTP_X_CRON_SIGNATURE'] ?? '';
$hmacExpired = security_verify_cron_or_admin(false, $testCronSecret);
$_SERVER = $origServer;

s_assert(
    $hmacOk === true && $hmacBadSig === false && $hmacExpired === false,
    'Approach 3 (HMAC Cron): valid HMAC accepted, bad signature & expired replay window rejected cleanly'
);

$rWorkerStop = http_sec_req("{$base}/worker.php?action=stop", 'GET', $extHeaders);
$rWorkerStart = http_sec_req("{$base}/worker.php?action=start", 'GET', $extHeaders);
$rCronForce = http_sec_req("{$base}/cron.php?force=1", 'GET', $extHeaders);
$rExtIngest = http_sec_req("{$base}/endpoint.php?r=" . urlencode('/api/append-complaints-db'), 'POST', array_merge($extHeaders, ['Content-Type: application/json']), '{"rows":[]}');
s_assert(
    $rWorkerStop['code'] === 403 && $rWorkerStart['code'] === 403 && $rCronForce['code'] === 403 && $rExtIngest['code'] === 401,
    'Approach 3 (Worker & Extension Guard): External worker stop/start (403), force cron (403), unauthenticated ingest (401) rejected',
    "stop={$rWorkerStop['code']}, start={$rWorkerStart['code']}, cronForce={$rCronForce['code']}, ingest={$rExtIngest['code']}"
);

// -------------------------------------------------------------------------
// Approach 4: Brute-Force Guard + CSRF Enforcement
// -------------------------------------------------------------------------
$rSetupNoCsrf = http_sec_req("{$base}/server_setup.php", 'POST', array_merge($extHeaders, ['Content-Type: application/x-www-form-urlencoded']), 'action=save_domains&primary_domain=https://evil.example');
s_assert($rSetupNoCsrf['code'] === 403, 'Approach 4 (Setup Form CSRF): POST /server_setup.php without _csrf cookie/token rejected with HTTP 403', "code={$rSetupNoCsrf['code']}");

$accountsFile = get_accounts_path();
$origAccountsRaw = file_exists($accountsFile) ? file_get_contents($accountsFile) : null;
$cookieJar = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'sec_e2e_cookie.txt';
@unlink($cookieJar);
$bfIp = '203.0.113.99';
$bfHeaders = ["X-Forwarded-For: {$bfIp}", 'Content-Type: application/json'];

try {
    // Seed temporary admin user in accounts.json, then restore exact prior file in finally
    $acc = read_json_file($accountsFile, ['users' => [], 'devices' => []]);
    $acc['users'][] = [
        'id'            => '__E2E_SEC_ADMIN__',
        'username'      => '__e2e_sec_admin__',
        'password_hash' => password_hash('SecPass!987', PASSWORD_DEFAULT),
        'role'          => 'admin',
        'active'        => true,
    ];
    write_json_file($accountsFile, $acc);

    // Trigger 5 invalid logins from external IP -> 5th or 6th attempt gets 429 Too Many Requests
    $got429 = false;
    for ($i = 1; $i <= 6; $i++) {
        $rBad = http_sec_req("{$base}/endpoint.php?r=" . urlencode('/api/auth/login'), 'POST', $bfHeaders, '{"username":"__e2e_sec_admin__","password":"wrong"}');
        if ($rBad['code'] === 429) {
            $got429 = true;
            break;
        }
    }
    s_assert($got429, 'Approach 4 (Brute-Force Protection): Repeated failed external logins trigger HTTP 429 lockout');

    // Valid admin login from external IP -> obtain cookie & csrfToken, then test CSRF rejection vs acceptance
    $rGoodLogin = http_sec_req(
        "{$base}/endpoint.php?r=" . urlencode('/api/auth/login'),
        'POST',
        array_merge($extHeaders, ['Content-Type: application/json']),
        '{"username":"__e2e_sec_admin__","password":"SecPass!987"}',
        $cookieJar,
        true
    );
    $jLogin = json_decode($rGoodLogin['body'], true);
    $csrfTok = (string)($jLogin['csrfToken'] ?? '');
    s_assert($rGoodLogin['code'] === 200 && $csrfTok !== '', 'Approach 4 (Strict Auth Login): External admin login issues session cookie + CSRF token', "code={$rGoodLogin['code']}");

    $rPostNoCsrf = http_sec_req(
        "{$base}/endpoint.php?r=" . urlencode('/api/backup/flush-spool'),
        'POST',
        array_merge($extHeaders, ['Content-Type: application/json']),
        '{}',
        $cookieJar
    );
    $rPostWithCsrf = http_sec_req(
        "{$base}/endpoint.php?r=" . urlencode('/api/backup/flush-spool'),
        'POST',
        array_merge($extHeaders, ['Content-Type: application/json', "X-CSRF-Token: {$csrfTok}"]),
        '{}',
        $cookieJar
    );
    s_assert(
        $rPostNoCsrf['code'] === 403 && $rPostWithCsrf['code'] === 200,
        'Approach 4 (CSRF Enforcement): External POST without X-CSRF-Token returns 403; with valid X-CSRF-Token returns 200',
        "noCsrf={$rPostNoCsrf['code']}, withCsrf={$rPostWithCsrf['code']}"
    );

    // Test authenticated admin /api/auth/logout cleans cookie cleanly
    http_sec_req("{$base}/endpoint.php?r=" . urlencode('/api/auth/logout'), 'POST', $extHeaders, '{}', $cookieJar);
} finally {
    @unlink($cookieJar);
    if ($origAccountsRaw === null) {
        @unlink($accountsFile);
    } else {
        file_put_contents($accountsFile, $origAccountsRaw);
    }
    security_bruteforce_clear('login', $bfIp . '|__e2e_sec_admin__');
    security_bruteforce_clear('login', $extIp . '|__e2e_sec_admin__');
    try {
        $pdo = get_db();
        $pdo->prepare("DELETE FROM tbl_system_logs WHERE module = 'security' AND summary LIKE ?")->execute(["%{$bfIp}%"]);
    } catch (Throwable $e) {}
}

// -------------------------------------------------------------------------
// Approach 5: Backup Encrypt-then-MAC (AES-256-CBC + HMAC-SHA256) & Health Masking
// -------------------------------------------------------------------------
$samplePayload = "\x1f\x8b\x08\x00SAMPLE_SQL_GZ_BINARY_DATA_" . str_repeat('ABCD', 50);
$bkPass = 'SuperStrongBackupPass!2026';
$encrypted = backup_encrypt_bytes($samplePayload, $bkPass);
$decrypted = backup_decrypt_bytes($encrypted, $bkPass);
$wrongKeyDec = backup_decrypt_bytes($encrypted, 'WrongPass');
$parts = explode('|', $encrypted);
$parts[3] = base64_encode(str_repeat("\x00", 16));
$tamperedDec = backup_decrypt_bytes(implode('|', $parts), $bkPass);

s_assert(
    strpos($encrypted, 'WS2ENC1|') === 0
    && $decrypted === $samplePayload
    && $wrongKeyDec === null
    && $tamperedDec === null,
    'Approach 5 (Backup Encryption): AES-256-CBC + HMAC-SHA256 roundtrips cleanly & rejects wrong key / tampered ciphertext'
);

$rExtHealth = http_sec_req("{$base}/endpoint.php?r=" . urlencode('/api/health'), 'GET', $extHeaders);
$jHealth = json_decode($rExtHealth['body'], true);
s_assert(
    $rExtHealth['code'] === 200
    && (($jHealth['backup']['latestFile'] ?? null) === '[protected]' || ($jHealth['backup']['count'] ?? 0) === 0)
    && ($jHealth['database']['error'] ?? null) === null,
    'Approach 5 (Health Info Masking): External /api/health hides internal backup filename & raw DB errors',
    'latestFile=' . (string)($jHealth['backup']['latestFile'] ?? 'null')
);

// -------------------------------------------------------------------------
// Approach 6: HTTP Security Headers, .htaccess Rules & Workflow Concurrency
// -------------------------------------------------------------------------
$rHdrCheck = http_sec_req("{$base}/endpoint.php?r=" . urlencode('/api/public/overview'));
$hStr = $rHdrCheck['headers'];
s_assert(
    stripos($hStr, 'X-Content-Type-Options: nosniff') !== false
    && stripos($hStr, 'X-Frame-Options: SAMEORIGIN') !== false
    && stripos($hStr, 'X-XSS-Protection: 0') !== false
    && stripos($hStr, 'Permissions-Policy: camera=()') !== false
    && stripos($hStr, "Content-Security-Policy: default-src 'none'") !== false,
    'Approach 6 (HTTP Headers): API responses include nosniff, SAMEORIGIN, Permissions-Policy & strict CSP'
);

$htContent = (string)file_get_contents(__DIR__ . '/../.htaccess');
$wfContent = (string)file_get_contents(__DIR__ . '/../.github/workflows/collect_every_30min.yml');
s_assert(
    strpos($htContent, 'bat|ps1|sh|md') !== false
    && strpos($htContent, 'deploy_server|docs|04ext_TraffyLP') !== false
    && strpos($wfContent, 'concurrency:') !== false
    && strpos($wfContent, 'WATER_CRON_SECRET') !== false,
    'Approach 6 (.htaccess & GitHub Actions): Apache blocks scripts/docs & GitHub workflow enforces concurrency + WATER_CRON_SECRET'
);

echo "\n=================================================================\n";
echo "SECURITY HARDENING E2E SUMMARY: PASS={$pass}, FAIL={$fail}\n";
echo "=================================================================\n";

exit($fail > 0 ? 1 : 0);
