<?php
// =========================================================================
// LP-PAO Smart Data — Universal Subfolder API & Socket.IO Entrypoint
// Allows dropping the folder into any Server (e.g. http://server/LP-PAO_Smart_Data/)
// without needing Admin access, VirtualHost, or .htaccess rewrite rules!
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

$phpServerDir = is_dir(__DIR__ . '/php_server') ? __DIR__ . '/php_server' : dirname(__DIR__) . '/php_server';
require $phpServerDir . '/router.php';
