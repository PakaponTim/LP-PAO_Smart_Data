<?php
// =========================================================================
// Water_System2 — Public Dashboard & Inter-Agency Secure API E2E Tests
// Usage: php tests/verify_public_api_e2e.php
// =========================================================================

date_default_timezone_set('Asia/Bangkok');
ini_set('display_errors', '1');
error_reporting(E_ALL);

require_once __DIR__ . '/../php_server/config.php';
require_once __DIR__ . '/../php_server/public_api.php';

$pass = 0;
$fail = 0;

function t_assert(bool $cond, string $label, string $detail = ''): void {
    global $pass, $fail;
    if ($cond) {
        $pass++;
        echo "[PASS] {$label}" . ($detail !== '' ? " -> {$detail}" : '') . "\n";
    } else {
        $fail++;
        echo "[FAIL] {$label}" . ($detail !== '' ? " -> {$detail}" : '') . "\n";
    }
}

function http_req(string $url, string $method = 'GET', array $headers = [], ?string $body = null): array {
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
echo "Water_System2 Public Dashboard & Inter-Agency Security E2E Test\n";
echo "=================================================================\n\n";

// 1. Unit Security: Zero-PII text scrubbing
$dirty = '<script>alert(1)</script> พบถนนพัง ติดต่อ 081-234-5678 หรือ +66891112222 บัตร 1-5201-00123-45-6 (1520100123456) เมล citizen@example.go.th LINE ID: myline99 https://line.me/ti/p/abc';
$scrubbed = public_scrub_text($dirty, 300);
t_assert(
    strpos($scrubbed, '081-234-5678') === false
    && strpos($scrubbed, '+66891112222') === false
    && strpos($scrubbed, '1-5201-00123-45-6') === false
    && strpos($scrubbed, '1520100123456') === false
    && strpos($scrubbed, 'citizen@example.go.th') === false
    && strpos($scrubbed, 'myline99') === false
    && strpos($scrubbed, 'line.me/ti/p/abc') === false
    && strpos($scrubbed, '<script>') === false
    && strpos($scrubbed, '[สงวนเบอร์โทร]') !== false
    && strpos($scrubbed, '[สงวนเลขบัตร]') !== false
    && strpos($scrubbed, '[สงวนอีเมล]') !== false,
    'Security Scrub: redacts Thai ID, phones, email, LINE ID, and HTML tags',
    $scrubbed
);

// 2. Unit Zero-PII Complaint DTO projection
$rawComplaint = [
    'ticket_id'          => 'LP-TEST-001',
    'state_name'         => 'กำลังดำเนินการ',
    'agency_status'      => 'อบจ.ลำปาง รับเรื่อง',
    'problem_type'       => 'ถนน/ทางเท้า',
    'description'        => 'ขอความอนุเคราะห์ซ่อมถนน โทร 089-876-5432 ด่วน',
    'location'           => 'ต.บ่อแฮ้ว อ.เมืองลำปาง เมล staff@test.com',
    'org_name'           => 'องค์การบริหารส่วนจังหวัดลำปาง',
    'ticket_datetime'    => '2026-11-17 09:00:00',
    'satisfaction_stars' => 4.5,
    'recorded_at'        => '2026-11-17 09:30:00',
    'raw_timeline'       => ['secret_internal_operator' => 'นาย ก 0812223333'],
    'reporter_phone'     => '0898765432',
];
$dto = public_sanitize_complaint($rawComplaint);
t_assert(
    !array_key_exists('raw_timeline', $dto)
    && !array_key_exists('reporter_phone', $dto)
    && strpos($dto['summary'], '089-876-5432') === false
    && strpos($dto['area'], 'staff@test.com') === false
    && $dto['ticket_id'] === 'LP-TEST-001'
    && $dto['satisfaction_stars'] === 4.5,
    'Security DTO: removes raw_timeline & reporter fields while keeping safe analytics fields'
);

// 3. Unit Rate Limiter check
$rlBucket = '__e2e_rl_' . substr(bin2hex(random_bytes(4)), 0, 8);
$r1 = public_rate_limit_check($rlBucket, 3);
$r2 = public_rate_limit_check($rlBucket, 3);
$r3 = public_rate_limit_check($rlBucket, 3);
$r4 = public_rate_limit_check($rlBucket, 3);
t_assert(
    !empty($r1['allowed']) && !empty($r2['allowed']) && !empty($r3['allowed']) && empty($r4['allowed']) && ($r4['remaining'] ?? -1) === 0,
    'Security Rate Limit: sliding 60s window blocks when quota exceeded',
    '4th call allowed=' . (!empty($r4['allowed']) ? 'true' : 'false')
);

// Clean up rate limit test bucket immediately
$rlFile = LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'public_rate_limits.json';
update_json_file_atomic($rlFile, [], function (array $buckets) use ($rlBucket) {
    unset($buckets[$rlBucket]);
    return $buckets;
});

$base = 'http://127.0.0.1:7000';

// 4. Public UI page & Open Public API routes
$resPage = http_req($base . '/public.html');
t_assert(
    $resPage['code'] === 200
    && strpos($resPage['body'], 'อบจ.ลำปาง') !== false
    && strpos($resPage['body'], 'Traffy Fondue') !== false
    && strpos($resPage['body'], '/api/public/overview') !== false,
    'UI HTTP 200: GET /public.html renders Lampang PAO & Traffy Fondue dashboard',
    "code={$resPage['code']}, bytes=" . strlen($resPage['body'])
);

$resOv = http_req($base . '/endpoint.php?r=' . urlencode('/api/public/overview'), 'GET', ['Origin: https://partner-agency.go.th']);
$jOv = json_decode($resOv['body'], true);
t_assert(
    $resOv['code'] === 200
    && !empty($jOv['success'])
    && count($jOv['highlights'] ?? []) >= 4
    && !empty($jOv['executiveSummary']['headline'])
    && isset($jOv['executiveSummary']['drought']['largeDams'], $jOv['traffySummary']['completionRatePct'])
    && isset($jOv['environment'], $jOv['traffySummary'], $jOv['traffyBreakdown'])
    && stripos($resOv['headers'], 'Access-Control-Allow-Origin: *') !== false,
    'Public Overview API & Read-Only CORS: GET /api/public/overview returns 200 JSON + executiveSummary + wildcard CORS',
    "code={$resOv['code']}, largeDams=" . count($jOv['executiveSummary']['drought']['largeDams'] ?? [])
);

$resPrivCors = http_req($base . '/endpoint.php?r=' . urlencode('/api/status'), 'GET', ['Origin: https://evil.example.com']);
t_assert(
    $resPrivCors['code'] === 200
    && stripos($resPrivCors['headers'], 'Access-Control-Allow-Origin: *') === false
    && stripos($resPrivCors['headers'], 'https://evil.example.com') === false,
    'Internal CORS Isolation: /api/status rejects wildcard & arbitrary origins cleanly',
    "code={$resPrivCors['code']}"
);

$resEnv = http_req($base . '/endpoint.php?r=' . urlencode('/api/public/environment'));
$jEnv = json_decode($resEnv['body'], true);
t_assert(
    $resEnv['code'] === 200 && !empty($jEnv['success']) && isset($jEnv['water'], $jEnv['rainfall'], $jEnv['drought'], $jEnv['pm25']),
    'Public Environment API: GET /api/public/environment returns all 4 domains',
    "code={$resEnv['code']}"
);

$resTraffy = http_req($base . '/endpoint.php?r=' . urlencode('/api/public/traffy'));
$jTraffy = json_decode($resTraffy['body'], true);
$hasRawLeak = false;
foreach (($jTraffy['items'] ?? []) as $it) {
    if (array_key_exists('raw_timeline', $it) || preg_match('/(?<!\d)0[689]\d{8}(?!\d)/', (string)($it['summary'] ?? '') . ' ' . (string)($it['area'] ?? ''))) {
        $hasRawLeak = true;
        break;
    }
}
t_assert(
    $resTraffy['code'] === 200 && !empty($jTraffy['success']) && isset($jTraffy['summary'], $jTraffy['breakdown'], $jTraffy['items']) && !$hasRawLeak,
    'Public Traffy API: GET /api/public/traffy returns Zero-PII items & omits raw_timeline',
    "code={$resTraffy['code']}, items=" . count($jTraffy['items'] ?? [])
);

$resOpenApi = http_req($base . '/endpoint.php?r=' . urlencode('/api/public/openapi'));
$jOpenApi = json_decode($resOpenApi['body'], true);
t_assert(
    $resOpenApi['code'] === 200 && ($jOpenApi['openapi'] ?? '') === '3.0.3' && !empty($jOpenApi['endpoints']) && !empty($jOpenApi['securityControls']),
    'OpenAPI Discovery: GET /api/public/openapi returns OpenAPI 3.0.3 spec & security metadata',
    "code={$resOpenApi['code']}"
);

// 5. Security Controls: Read-Only 405 & Missing/Invalid Agency Key 401
$resPost = http_req($base . '/endpoint.php?r=' . urlencode('/api/public/overview'), 'POST', ['Content-Type: application/json'], '{"x":1}');
t_assert(
    $resPost['code'] === 405,
    'Security Read-Only: POST /api/public/overview rejected with HTTP 405',
    "code={$resPost['code']}"
);

$resNoKey = http_req($base . '/endpoint.php?r=' . urlencode('/api/public/agency/traffy'));
t_assert(
    $resNoKey['code'] === 401,
    'Security Auth: GET /api/public/agency/traffy without X-API-Key rejected with HTTP 401',
    "code={$resNoKey['code']}"
);

$resBadKey = http_req($base . '/endpoint.php?r=' . urlencode('/api/public/agency/traffy'), 'GET', ['X-API-Key: ws2_ag_invalid_forged_key_000']);
t_assert(
    $resBadKey['code'] === 401,
    'Security Auth: GET /api/public/agency/traffy with forged key rejected with HTTP 401',
    "code={$resBadKey['code']}"
);

// 6. Full Agency API Key Lifecycle + Storage Hashing + CSV/JSON + Revocation
$createdKey = null;
$rawKey = '';
$keyId = '';
try {
    $createdKey = public_create_api_key('__E2E_TEST_AGENCY__', ['overview', 'environment', 'traffy'], 600);
    $rawKey = (string)($createdKey['apiKey'] ?? '');
    $keyId = (string)($createdKey['id'] ?? '');

    $storeRaw = (string)@file_get_contents(public_api_keys_file());
    t_assert(
        strpos($rawKey, 'ws2_ag_') === 0 && $keyId !== '' && strpos($storeRaw, $rawKey) === false && strpos($storeRaw, hash('sha256', $rawKey)) !== false,
        'Security Storage: issued X-API-Key stored exclusively as SHA-256 hash (no plaintext in agency_api_keys.json)',
        "keyId={$keyId}"
    );

    $resAgJson = http_req($base . '/endpoint.php?r=' . urlencode('/api/public/agency/traffy?agency=pao'), 'GET', ["X-API-Key: {$rawKey}"]);
    $jAgJson = json_decode($resAgJson['body'], true);
    t_assert(
        $resAgJson['code'] === 200 && !empty($jAgJson['success']) && isset($jAgJson['items'], $jAgJson['summary']),
        'Agency Traffy Feed (JSON): authenticated X-API-Key returns 200 + filtered PAO items',
        "code={$resAgJson['code']}, count=" . ($jAgJson['count'] ?? -1)
    );

    $resAgCsv = http_req($base . '/endpoint.php?r=' . urlencode('/api/public/agency/traffy?format=csv'), 'GET', ["X-API-Key: {$rawKey}"]);
    t_assert(
        $resAgCsv['code'] === 200
        && substr($resAgCsv['body'], 0, 3) === "\xEF\xBB\xBF"
        && strpos($resAgCsv['body'], 'ticket_id,state_name,agency_status') !== false,
        'Agency Traffy Feed (CSV): authenticated X-API-Key returns 200 UTF-8 BOM CSV',
        "code={$resAgCsv['code']}, bytes=" . strlen($resAgCsv['body'])
    );

    $resAgAll = http_req($base . '/endpoint.php?r=' . urlencode('/api/public/agency/all'), 'GET', ["X-API-Key: {$rawKey}"]);
    $jAgAll = json_decode($resAgAll['body'], true);
    t_assert(
        $resAgAll['code'] === 200 && !empty($jAgAll['success']) && isset($jAgAll['environment']['water'], $jAgAll['traffy']['summary']),
        'Agency All Feed: GET /api/public/agency/all returns full 5-domain integrated payload',
        "code={$resAgAll['code']}"
    );

    $revoked = public_revoke_api_key($keyId);
    $resAfterRevoke = http_req($base . '/endpoint.php?r=' . urlencode('/api/public/agency/traffy'), 'GET', ["X-API-Key: {$rawKey}"]);
    t_assert(
        $revoked && $resAfterRevoke['code'] === 401,
        'Security Revocation: revoked X-API-Key is rejected immediately with HTTP 401',
        "revoked=" . ($revoked ? 'true' : 'false') . ", afterCode={$resAfterRevoke['code']}"
    );
} finally {
    if ($keyId !== '') {
        update_json_file_atomic(public_api_keys_file(), [], function (array $list) use ($keyId) {
            return array_values(array_filter($list, function ($item) use ($keyId) {
                return ($item['id'] ?? '') !== $keyId;
            }));
        });
        update_json_file_atomic($rlFile, [], function (array $buckets) use ($keyId) {
            unset($buckets['key_' . $keyId]);
            return $buckets;
        });
    }
    try {
        $pdo = get_db();
        $pdo->prepare("DELETE FROM tbl_system_logs WHERE module = 'public_api' AND (summary LIKE '%__E2E_TEST_AGENCY__%' OR summary LIKE ?)")->execute(["%{$keyId}%"]);
    } catch (Throwable $e) {
        // Ignore cleanup noise when DB offline
    }
}

echo "\n=================================================================\n";
echo "PUBLIC DASHBOARD & AGENCY API E2E SUMMARY: PASS={$pass}, FAIL={$fail}\n";
echo "=================================================================\n";

exit($fail > 0 ? 1 : 0);
