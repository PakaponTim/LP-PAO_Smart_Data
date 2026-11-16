<?php
// =========================================================================
// Water_System2 — Universal Subfolder API & Socket.IO Entrypoint (backend_ui)
// =========================================================================

if (isset($_GET['r']) && is_string($_GET['r']) && $_GET['r'] !== '') {
    $route = $_GET['r'];
    $parsed = parse_url($route);
    $path = $parsed['path'] ?? '/';
    if (!empty($parsed['query'])) {
        parse_str($parsed['query'], $extraQuery);
        if (is_array($extraQuery)) {
            $_GET = array_merge($extraQuery, $_GET);
        }
    }
    $_SERVER['REQUEST_URI'] = $route;
}

require dirname(__DIR__) . '/php_server/router.php';
