<?php
// Serve the main Dashboard index.html when accessed as http://server/Water_System2/ or index.php
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
readfile(__DIR__ . '/index.html');
