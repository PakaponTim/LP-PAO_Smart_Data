<?php
// =========================================================================
// Water_System2 — Shared Zero-Dependency Security Hardening Module (PHP 7.2+)
// Covers:
//   1. Smart Loopback vs External Production Auth Detection
//   2. Sliding-Window Rate Limiter & Brute-Force Guard
//   3. Strict HTTP Security Headers (HSTS, Frame-Ancestors, Permissions)
//   4. HMAC-SHA256 Cron/Worker Authentication & Replay Window Protection
//   5. CSRF Token Validation & Chrome Extension Origin Verification
//   6. Safe Setup Form CSRF Helpers
// =========================================================================

if (!defined('WATER_SYSTEM2_SECURITY_LOADED')) {
    define('WATER_SYSTEM2_SECURITY_LOADED', true);
}

function security_is_https_request(): bool {
    if (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off') {
        return true;
    }
    $proto = strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
    if ($proto === 'https') {
        return true;
    }
    $cf = (string)($_SERVER['HTTP_CF_VISITOR'] ?? '');
    return ($cf !== '' && stripos($cf, '"https"') !== false);
}

function security_is_loopback_ip(string $ip): bool {
    return in_array(trim($ip), ['127.0.0.1', '::1'], true);
}

/**
 * Determine whether the incoming request is strictly a direct local loopback request.
 * Fail-closed: if any reverse proxy header indicates a non-loopback client IP, returns false!
 */
function is_local_loopback_request(): bool {
    if (PHP_SAPI === 'cli') {
        return true;
    }
    $remoteAddr = trim((string)($_SERVER['REMOTE_ADDR'] ?? ''));
    if (!security_is_loopback_ip($remoteAddr)) {
        return false;
    }

    // Reverse proxy headers forwarded from Nginx/Cloudflare indicate external traffic
    $proxyHeaders = [
        $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '',
        $_SERVER['HTTP_X_REAL_IP'] ?? '',
        $_SERVER['HTTP_CF_CONNECTING_IP'] ?? '',
    ];
    foreach ($proxyHeaders as $hdr) {
        $raw = trim((string)$hdr);
        if ($raw === '') continue;
        $parts = array_map('trim', explode(',', $raw));
        foreach ($parts as $p) {
            if ($p !== '' && !security_is_loopback_ip($p)) {
                return false;
            }
        }
    }
    return true;
}

/**
 * Smart Production Guard:
 * Enforce strict authentication whenever AUTH_ENFORCE=1 OR traffic arrives externally.
 */
function is_strict_auth_required(): bool {
    if (defined('AUTH_ENFORCE') && AUTH_ENFORCE) {
        return true;
    }
    if (PHP_SAPI === 'cli') {
        return false;
    }
    return !is_local_loopback_request();
}

function security_client_ip(): string {
    $remote = trim((string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    if (!security_is_loopback_ip($remote)) {
        return $remote;
    }
    $xff = trim((string)($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ''));
    if ($xff !== '') {
        $first = trim(explode(',', $xff)[0]);
        if (filter_var($first, FILTER_VALIDATE_IP)) {
            return $first;
        }
    }
    $realIp = trim((string)($_SERVER['HTTP_X_REAL_IP'] ?? ''));
    if ($realIp !== '' && filter_var($realIp, FILTER_VALIDATE_IP)) {
        return $realIp;
    }
    return $remote ?: 'unknown';
}

function security_apply_http_headers(bool $isApi = false): void {
    if (headers_sent() || PHP_SAPI === 'cli') {
        return;
    }
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('X-XSS-Protection: 0');
    header('Referrer-Policy: same-origin');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
    header('X-Water-System2-Port: 7000');
    if (security_is_https_request()) {
        header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    }
    if ($isApi) {
        header("Content-Security-Policy: default-src 'none'; frame-ancestors 'self'");
    } else {
        header("Content-Security-Policy: frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
    }
}

/**
 * Atomic sliding-window rate tracker shared across public API and auth brute-force protection.
 *
 * @return array{allowed:bool, count:int, limit:int, remaining:int, retryAfter:int}
 */
function security_sliding_window_hit(string $filePath, string $bucketKey, int $limit, int $windowSec = 60, bool $recordHit = true): array {
    $now = time();
    $windowStart = $now - $windowSec;
    $allowed = true;
    $count = 0;
    $remaining = $limit;
    $retryAfter = 0;

    update_json_file_atomic($filePath, [], function (array $buckets) use ($bucketKey, $limit, $windowSec, $now, $windowStart, $recordHit, &$allowed, &$count, &$remaining, &$retryAfter) {
        if (count($buckets) > 250) {
            foreach ($buckets as $k => $hits) {
                $recent = array_values(array_filter((array)$hits, function ($ts) use ($windowStart) {
                    return (int)$ts >= $windowStart;
                }));
                if (empty($recent)) {
                    unset($buckets[$k]);
                } else {
                    $buckets[$k] = $recent;
                }
            }
        }

        $list = array_values(array_filter((array)($buckets[$bucketKey] ?? []), function ($ts) use ($windowStart) {
            return (int)$ts >= $windowStart;
        }));

        if (count($list) >= $limit) {
            $allowed = false;
            $remaining = 0;
            $count = count($list);
            $oldest = (int)($list[0] ?? $now);
            $retryAfter = max(1, ($oldest + $windowSec) - $now);
        } else {
            if ($recordHit) {
                $list[] = $now;
            }
            $count = count($list);
            $remaining = max(0, $limit - $count);
        }
        $buckets[$bucketKey] = $list;
        return $buckets;
    });

    return [
        'allowed'    => $allowed,
        'count'      => $count,
        'limit'      => $limit,
        'remaining'  => $remaining,
        'retryAfter' => $retryAfter,
    ];
}

function security_bruteforce_file(): string {
    return WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'auth_bruteforce.json';
}

function security_bruteforce_bucket(string $scope, string $identifier): string {
    return $scope . '_' . hash('sha256', strtolower(trim($identifier)));
}

function security_bruteforce_check(string $scope, string $identifier, int $maxFailures = 5, int $windowSec = 300): array {
    $file = security_bruteforce_file();
    $bucket = security_bruteforce_bucket($scope, $identifier);
    $res = security_sliding_window_hit($file, $bucket, $maxFailures, $windowSec, false);
    return [
        'blocked'    => !$res['allowed'],
        'attempts'   => $res['count'],
        'retryAfter' => $res['retryAfter'],
    ];
}

function security_bruteforce_record_failure(string $scope, string $identifier, int $maxFailures = 5, int $windowSec = 300): array {
    $file = security_bruteforce_file();
    $bucket = security_bruteforce_bucket($scope, $identifier);
    $res = security_sliding_window_hit($file, $bucket, $maxFailures, $windowSec, true);
    if (!$res['allowed'] && function_exists('sys_log_record')) {
        sys_log_record([
            'module'         => 'security',
            'action'         => "Brute-Force Blocked ({$scope})",
            'status'         => 'warning',
            'trigger_source' => 'system',
            'summary'        => "ระงับการสุ่มรหัสผ่าน [{$scope}] ชั่วคราวจาก IP " . security_client_ip(),
        ]);
    }
    return [
        'blocked'    => !$res['allowed'],
        'attempts'   => $res['count'],
        'retryAfter' => $res['retryAfter'],
    ];
}

function security_bruteforce_clear(string $scope, string $identifier): void {
    $file = security_bruteforce_file();
    if (!file_exists($file)) return;
    $bucket = security_bruteforce_bucket($scope, $identifier);
    update_json_file_atomic($file, [], function (array $buckets) use ($bucket) {
        unset($buckets[$bucket]);
        return $buckets;
    });
}

/**
 * Generate signed HMAC-SHA256 headers for outbound automated cron/worker pings.
 */
function security_sign_cron_headers(string $url, string $secret, ?int $timestamp = null): array {
    if ($secret === '') return [];
    $ts = $timestamp ?? time();
    $path = parse_url($url, PHP_URL_PATH) ?: '/cron.php';
    $sig = hash_hmac('sha256', "{$ts}|{$path}", $secret);
    return [
        "X-Cron-Timestamp: {$ts}",
        "X-Cron-Signature: sha256={$sig}",
    ];
}

/**
 * Verify Cron / Worker requests:
 * Allows valid HMAC-SHA256 signature, matching CRON_SECRET, authenticated admin session,
 * or direct local loopback when CRON_SECRET is unset (unless $requireExplicitWhenSet = true).
 */
function security_verify_cron_or_admin(bool $allowLoopbackIfUnset = true, string $secretOverride = ''): bool {
    $secret = ($secretOverride !== '') ? $secretOverride : (string)env_val('CRON_SECRET', '');

    if ($secret !== '') {
        // 1. Verify replay-protected HMAC signature (preferred: never puts secret in URL/header plaintext)
        $tsRaw  = trim((string)($_SERVER['HTTP_X_CRON_TIMESTAMP'] ?? ''));
        $sigRaw = trim((string)($_SERVER['HTTP_X_CRON_SIGNATURE'] ?? ''));
        if ($tsRaw !== '' && $sigRaw !== '' && ctype_digit($tsRaw)) {
            $ts = (int)$tsRaw;
            if (abs(time() - $ts) <= 300) {
                $reqPath = parse_url($_SERVER['REQUEST_URI'] ?? '/cron.php', PHP_URL_PATH) ?: '/cron.php';
                $expected = 'sha256=' . hash_hmac('sha256', "{$ts}|{$reqPath}", $secret);
                if (hash_equals($expected, $sigRaw)) {
                    return true;
                }
            }
        }

        // 2. Fallback: direct CRON_SECRET header or query key (constant-time comparison)
        $provided = trim((string)($_SERVER['HTTP_X_CRON_SECRET'] ?? ($_GET['key'] ?? '')));
        if ($provided !== '' && hash_equals($secret, $provided)) {
            return true;
        }
    }

    // 3. Authenticated Admin Session cookie
    if (function_exists('get_current_user_session')) {
        $sess = get_current_user_session();
        if (!empty($sess['fromCookie']) && !empty($sess['user']) && (($sess['user']['role'] ?? '') === 'admin')) {
            return true;
        }
    }

    // 4. Local loopback convenience when no CRON_SECRET is configured
    if ($allowLoopbackIfUnset && $secret === '' && is_local_loopback_request()) {
        return true;
    }

    return false;
}

/**
 * Check whether an Origin header matches configured domains or allowlisted Chrome Extensions.
 */
function security_is_allowed_origin(string $origin): bool {
    if ($origin === '') return false;
    $allowed = function_exists('get_allowed_cors_origins') ? get_allowed_cors_origins() : [
        'http://localhost:7000',
        'http://127.0.0.1:7000',
    ];
    if (in_array(strtolower($origin), $allowed, true) || in_array($origin, $allowed, true)) {
        return true;
    }

    if (preg_match('/^chrome-extension:\/\/([a-p]{32})$/', $origin, $m)) {
        $dCfg = function_exists('get_domain_config') ? get_domain_config() : [];
        $extIds = $dCfg['allowed_extension_ids'] ?? [];
        if (!empty($extIds) && is_array($extIds)) {
            return in_array($m[1], $extIds, true);
        }
        // Chrome Extension is disabled by default (system uses Direct PHP Collector 100%)
        return false;
    }
    return false;
}

function security_get_or_issue_setup_csrf(): string {
    $cookieName = 'ws2_setup_csrf';
    $tok = (string)($_COOKIE[$cookieName] ?? '');
    if (preg_match('/^[a-f0-9]{32}$/', $tok)) {
        return $tok;
    }
    $tok = bin2hex(random_bytes(16));
    if (!headers_sent() && PHP_SAPI !== 'cli') {
        $isHttps = security_is_https_request();
        $hdr = "{$cookieName}={$tok}; Path=/; HttpOnly; SameSite=Strict" . ($isHttps ? '; Secure' : '');
        header('Set-Cookie: ' . $hdr, false);
    }
    $_COOKIE[$cookieName] = $tok;
    return $tok;
}

function security_verify_setup_csrf(): bool {
    $cookieTok = (string)($_COOKIE['ws2_setup_csrf'] ?? '');
    $postTok   = (string)($_POST['_csrf'] ?? '');
    if (!preg_match('/^[a-f0-9]{32}$/', $cookieTok) || $postTok === '') {
        return false;
    }
    return hash_equals($cookieTok, $postTok);
}

/**
 * Return true for back-office Admin HTML pages that must never be exposed on public servers without Admin session.
 */
function security_is_admin_page_uri(string $uri): bool {
    $base = strtolower(basename((string)parse_url($uri, PHP_URL_PATH)));
    if ($base === '' || $base === 'water_system2') {
        $base = 'index.html';
    }
    $adminPages = [
        'index.html',
        'index.php',
        'control.html',
        'notification.html',
        'operations.html',
        'accounts.html',
        'db_compare.html',
        'mobile.html',
    ];
    return in_array($base, $adminPages, true);
}
