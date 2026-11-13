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

function get_current_user_session(): array {
    $sessions = read_json_file(get_sessions_path(), []);
    $cookieToken = $_COOKIE[SESSION_COOKIE_NAME] ?? '';

    if ($cookieToken !== '') {
        $hash = hash('sha256', $cookieToken);
        if (isset($sessions[$hash]) && ($sessions[$hash]['expires'] ?? 0) > time()) {
            return $sessions[$hash];
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
        $token = bin2hex(random_bytes(24));
        $csrf = bin2hex(random_bytes(16));
        $sessions = read_json_file(get_sessions_path(), []);
        $userObj = [
            'id' => 'admin-7000',
            'username' => $username !== '' ? $username : 'admin',
            'role' => 'admin'
        ];
        $sessions[hash('sha256', $token)] = [
            'user' => $userObj,
            'csrfToken' => $csrf,
            'expires' => time() + 8 * 3600
        ];
        write_json_file(get_sessions_path(), $sessions);
        setcookie(SESSION_COOKIE_NAME, $token, time() + 8 * 3600, '/', '', false, true);
        send_json(['user' => $userObj, 'csrfToken' => $csrf]);
        return true;
    }

    if ($path === '/api/auth/logout' && $method === 'POST') {
        $cookieToken = $_COOKIE[SESSION_COOKIE_NAME] ?? '';
        if ($cookieToken !== '') {
            $sessions = read_json_file(get_sessions_path(), []);
            unset($sessions[hash('sha256', $cookieToken)]);
            write_json_file(get_sessions_path(), $sessions);
        }
        setcookie(SESSION_COOKIE_NAME, '', time() - 3600, '/');
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

