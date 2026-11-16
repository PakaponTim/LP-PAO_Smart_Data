<?php
// =========================================================================
// Water_System2 (Port 7000) — Auth Module (Ready for future enforcement)
// Right now AUTH_ENFORCE defaults to false so the user can test all features
// immediately on port 7000 without login blocks, while keeping the full
// session, CSRF, user, and device APIs intact.
// =========================================================================

require_once __DIR__ . '/config.php';

function get_accounts_path(): string {
    $dir = WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR . 'runtime' . DIRECTORY_SEPARATOR . 'security';
    if (!is_dir($dir)) @mkdir($dir, 0777, true);
    return $dir . DIRECTORY_SEPARATOR . 'accounts.json';
}

function get_accounts_data(): array {
    $data = read_json_file(get_accounts_path(), ['users' => [], 'devices' => []]);
    if (!isset($data['users']) || !is_array($data['users'])) $data['users'] = [];
    if (!isset($data['devices']) || !is_array($data['devices'])) $data['devices'] = [];
    return $data;
}

function save_accounts_data(array $data): void {
    write_json_file(get_accounts_path(), $data);
}

function get_sessions_path(): string {
    return WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'sessions.json';
}

function auth_send_session_cookie(string $token, int $maxAgeSec): void {
    $proto = $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '';
    $isHttps = (stripos($proto, 'https') !== false) || (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    $expiresTs = ($maxAgeSec <= 0) ? (time() - 3600) : (time() + $maxAgeSec);
    $expiresStr = gmdate('D, d M Y H:i:s \G\M\T', $expiresTs);
    $effMaxAge = max(0, $maxAgeSec);
    $cookieHeader = SESSION_COOKIE_NAME . '=' . rawurlencode($token)
        . "; Expires={$expiresStr}; Max-Age={$effMaxAge}; Path=/; HttpOnly; SameSite=Strict"
        . ($isHttps ? '; Secure' : '');
    header('Set-Cookie: ' . $cookieHeader, false);
}

function verify_php_user_credentials(string $username, string $password): ?array {
    $acc = get_accounts_data();
    $users = $acc['users'] ?? [];
    if (empty($users)) {
        if (!AUTH_ENFORCE) {
            return ['id' => 'admin-7000', 'username' => ($username ?: 'admin'), 'role' => 'admin'];
        }
        return null;
    }

    foreach ($users as $u) {
        if (empty($u['active'])) continue;
        if (strcasecmp((string)($u['username'] ?? ''), $username) !== 0) continue;

        if (!empty($u['password_hash'])) {
            if (!password_verify($password, (string)$u['password_hash'])) {
                return null;
            }
        } elseif (AUTH_ENFORCE || $password === '') {
            // Legacy Node scrypt record cannot be verified natively on PHP <7.4 without password_hash
            if (AUTH_ENFORCE) return null;
            if ($password === '') return null;
        }
        return [
            'id'       => $u['id'] ?? 'admin-7000',
            'username' => $u['username'] ?? $username,
            'role'     => $u['role'] ?? 'viewer',
        ];
    }
    return null;
}

/**
 * Returns: null (no Bearer header sent), array (valid active device), or false (invalid/revoked Bearer token).
 */
function verify_bearer_device_token(?string $authHeader = null) {
    $hdr = $authHeader ?? ($_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['HTTP_X_DEVICE_TOKEN'] ?? ''));
    if ($hdr === '') return null;
    $token = preg_match('/^Bearer\s+(.+)$/i', $hdr, $m) ? trim($m[1]) : trim($hdr);
    if ($token === '') return false;

    $acc = get_accounts_data();
    $bh = hash('sha256', $token);
    foreach (($acc['devices'] ?? []) as $d) {
        if (!empty($d['revoked'])) continue;
        $stored = (string)($d['hash'] ?? '');
        if ($stored !== '' && (hash_equals($stored, $bh) || hash_equals($stored, $token))) {
            return $d;
        }
    }
    return false;
}

function get_current_user_session(): array {
    $sessionsPath = get_sessions_path();
    $sessions = read_json_file($sessionsPath, []);
    $cookieToken = $_COOKIE[SESSION_COOKIE_NAME] ?? '';

    if ($cookieToken !== '') {
        $hash = hash('sha256', $cookieToken);
        $now = time();
        if (isset($sessions[$hash]) && ($sessions[$hash]['expires'] ?? 0) > $now) {
            $sess = $sessions[$hash];
            $ttl = (int)($sess['ttl'] ?? (8 * 3600));
            $remaining = (int)$sess['expires'] - $now;
            // Sliding Session Expiration: if less than 75% TTL remains, auto-extend both server & cookie
            if ($remaining < ($ttl * 0.75)) {
                $newExpires = $now + $ttl;
                $sess['expires'] = $newExpires;
                update_json_file_atomic($sessionsPath, [], function (array $cur) use ($hash, $newExpires) {
                    if (isset($cur[$hash])) {
                        $cur[$hash]['expires'] = $newExpires;
                    }
                    return $cur;
                });
                if (!headers_sent()) {
                    auth_send_session_cookie($cookieToken, $ttl);
                }
            }
            return $sess;
        }
    }

    // If AUTH_ENFORCE is false (current default per user instruction),
    // automatically provide a ready admin session so all UI pages & APIs work seamlessly.
    if (!AUTH_ENFORCE) {
        return [
            'user' => [
                'id' => 'admin-7000',
                'username' => 'admin',
                'role' => 'admin'
            ],
            'csrfToken' => 'csrf-7000-ready-token',
            'expires' => time() + 86400
        ];
    }

    return [];
}

function handle_auth_routes(string $method, string $path, array $body): bool {
    if ($path === '/api/auth/me' && $method === 'GET') {
        $session = get_current_user_session();
        if (empty($session['user'])) {
            send_json(['error' => 'กรุณาเข้าสู่ระบบ'], 401);
        }
        send_json([
            'user' => $session['user'],
            'csrfToken' => $session['csrfToken']
        ]);
        return true;
    }

    if ($path === '/api/auth/bootstrap-status' && $method === 'GET') {
        $acc = get_accounts_data();
        send_json(['required' => empty($acc['users']) && AUTH_ENFORCE]);
        return true;
    }

    if ($path === '/api/auth/login' && $method === 'POST') {
        $username = trim((string)($body['username'] ?? 'admin'));
        $password = (string)($body['password'] ?? '');
        if (AUTH_ENFORCE || $password !== '') {
            $verified = verify_php_user_credentials($username, $password);
            if (!$verified) {
                send_json(['error' => 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'], 401);
            }
            $userObj = $verified;
        } else {
            $userObj = [
                'id'       => 'admin-7000',
                'username' => $username !== '' ? $username : 'admin',
                'role'     => 'admin'
            ];
        }

        $remember = !isset($body['remember']) || !empty($body['remember']);
        $rememberDays = max(1, (int)env_val('AUTH_SESSION_DAYS', '30'));
        $ttlSec = $remember ? ($rememberDays * 86400) : (8 * 3600);

        $token = bin2hex(random_bytes(24));
        $csrf = bin2hex(random_bytes(16));
        $oldCookie = $_COOKIE[SESSION_COOKIE_NAME] ?? '';

        update_json_file_atomic(get_sessions_path(), [], function (array $sessions) use ($token, $csrf, $userObj, $oldCookie, $ttlSec, $remember) {
            $now = time();
            foreach ($sessions as $k => $v) {
                if (($v['expires'] ?? 0) <= $now) unset($sessions[$k]);
            }
            if ($oldCookie !== '') {
                unset($sessions[hash('sha256', $oldCookie)]);
            }
            $sessions[hash('sha256', $token)] = [
                'user'      => $userObj,
                'csrfToken' => $csrf,
                'ttl'       => $ttlSec,
                'remember'  => $remember,
                'expires'   => $now + $ttlSec
            ];
            return $sessions;
        });

        auth_send_session_cookie($token, $ttlSec);
        send_json([
            'user'       => $userObj,
            'csrfToken'  => $csrf,
            'ttlSeconds' => $ttlSec,
            'expiresAt'  => date('c', time() + $ttlSec),
            'remember'   => $remember,
        ]);
        return true;
    }

    if ($path === '/api/auth/refresh' && $method === 'POST') {
        $cookieToken = $_COOKIE[SESSION_COOKIE_NAME] ?? '';
        if ($cookieToken === '') {
            send_json(['error' => 'ไม่มี Cookie Session ให้ต่ออายุ'], 401);
        }
        $hash = hash('sha256', $cookieToken);
        $now = time();
        $renewed = null;
        update_json_file_atomic(get_sessions_path(), [], function (array $sessions) use ($hash, $now, &$renewed) {
            if (isset($sessions[$hash]) && ($sessions[$hash]['expires'] ?? 0) > $now) {
                $ttl = (int)($sessions[$hash]['ttl'] ?? (30 * 86400));
                $sessions[$hash]['expires'] = $now + $ttl;
                $renewed = $sessions[$hash];
            }
            return $sessions;
        });
        if (!$renewed) {
            send_json(['error' => 'Session หมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่'], 401);
        }
        $ttl = (int)($renewed['ttl'] ?? (30 * 86400));
        auth_send_session_cookie($cookieToken, $ttl);
        send_json([
            'success'    => true,
            'expiresAt'  => date('c', $renewed['expires']),
            'ttlSeconds' => $ttl,
        ]);
        return true;
    }

    if ($path === '/api/auth/pair-device' && $method === 'POST') {
        $username = trim((string)($body['username'] ?? ''));
        $password = (string)($body['password'] ?? '');
        $name = mb_substr(trim((string)($body['name'] ?? 'Chrome Extension Collector')), 0, 80);

        $user = verify_php_user_credentials($username, $password);
        if (!$user || ($user['role'] ?? '') !== 'admin') {
            send_json(['error' => 'ต้องใช้บัญชีผู้ดูแลระบบเพื่อเชื่อมต่อ Extension'], 401);
        }

        $token = bin2hex(random_bytes(32));
        $id = 'dev-' . bin2hex(random_bytes(8));
        update_json_file_atomic(get_accounts_path(), ['users' => [], 'devices' => []], function (array $acc) use ($id, $name, $token, $user) {
            if (!isset($acc['devices']) || !is_array($acc['devices'])) $acc['devices'] = [];
            $acc['devices'][] = [
                'id'        => $id,
                'name'      => $name ?: 'Chrome Extension Collector',
                'hash'      => hash('sha256', $token),
                'owner'     => $user['id'] ?? 'admin-7000',
                'createdAt' => date('c'),
                'revoked'   => false,
            ];
            return $acc;
        });

        send_json(['token' => $token, 'id' => $id]);
        return true;
    }

    if ($path === '/api/auth/logout' && $method === 'POST') {
        $cookieToken = $_COOKIE[SESSION_COOKIE_NAME] ?? '';
        if ($cookieToken !== '') {
            update_json_file_atomic(get_sessions_path(), [], function (array $sessions) use ($cookieToken) {
                unset($sessions[hash('sha256', $cookieToken)]);
                return $sessions;
            });
        }
        auth_send_session_cookie('', -3600);
        send_json(['success' => true]);
        return true;
    }

    if ($path === '/api/auth/users' && $method === 'GET') {
        $acc = get_accounts_data();
        $users = array_map(function ($u) {
            return [
                'id' => $u['id'] ?? 'admin-7000',
                'username' => $u['username'] ?? 'admin',
                'role' => $u['role'] ?? 'admin',
                'active' => $u['active'] ?? true
            ];
        }, $acc['users']);
        if (empty($users)) {
            $users[] = ['id' => 'admin-7000', 'username' => 'admin', 'role' => 'admin', 'active' => true];
        }
        send_json(['users' => $users]);
        return true;
    }

    if ($path === '/api/auth/users' && $method === 'POST') {
        $username = trim((string)($body['username'] ?? ''));
        $password = (string)($body['password'] ?? '');
        $role = trim((string)($body['role'] ?? 'viewer'));
        if ($username === '' || strlen($password) < 4) {
            send_json(['error' => 'กรุณาระบุชื่อผู้ใช้และรหัสผ่าน'], 400);
        }
        $acc = get_accounts_data();
        $newUser = [
            'id' => 'U-' . bin2hex(random_bytes(6)),
            'username' => $username,
            'password_hash' => password_hash($password, PASSWORD_DEFAULT),
            'role' => in_array($role, ['admin', 'operator', 'viewer'], true) ? $role : 'viewer',
            'active' => true
        ];
        $acc['users'][] = $newUser;
        save_accounts_data($acc);
        send_json([
            'user' => [
                'id' => $newUser['id'],
                'username' => $newUser['username'],
                'role' => $newUser['role']
            ]
        ], 201);
        return true;
    }

    if ($path === '/api/auth/devices' && $method === 'GET') {
        $acc = get_accounts_data();
        $devices = array_map(function ($d) {
            unset($d['hash']);
            return $d;
        }, $acc['devices']);
        if (empty($devices)) {
            $devices[] = [
                'id' => 'direct-api-collector-7000',
                'name' => 'PHP Direct API Collector (Server-to-Server Port 7000)',
                'createdAt' => date('c'),
                'revoked' => false
            ];
        }
        send_json(['devices' => $devices]);
        return true;
    }

    if (preg_match('#^/api/auth/devices/([^/]+)$#', $path, $m) && $method === 'DELETE') {
        $devId = $m[1];
        $acc = get_accounts_data();
        foreach ($acc['devices'] as &$d) {
            if (($d['id'] ?? '') === $devId) {
                $d['revoked'] = true;
            }
        }
        unset($d);
        save_accounts_data($acc);
        send_json(['success' => true]);
        return true;
    }

    return false;
}

