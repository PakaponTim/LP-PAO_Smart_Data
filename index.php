<?php
// Serve the main Dashboard index.html when accessed as http://server/Water_System2/ or index.php
require_once __DIR__ . '/php_server/config.php';
require_once __DIR__ . '/php_server/auth.php';
security_apply_http_headers(false);
if (is_strict_auth_required() && !auth_is_admin_session()) {
    header('Location: ./login.html?reauth=1&next=index.html', true, 302);
    exit;
}
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
readfile(__DIR__ . '/index.html');
