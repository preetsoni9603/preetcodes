<?php
/*
 * Backstock Manager — password gate.
 *
 * The app page only loads after the correct password is entered.
 * The password itself is never stored here, only a one-way hash.
 *
 * Starting password: set by STARTING_HASH below. Change it any time from the
 * app's Settings (gear icon) → Password. The new hash and a random signing key
 * are kept in a private file outside the public web folder when possible:
 *   /home/<you>/.backstock-auth.json   (fallback: .auth.json in this folder,
 *   which .htaccess blocks from the web)
 * Delete that file to go back to the starting password.
 *
 * Inventory data is saved on the server in /home/<you>/.backstock-data.json
 * (fallback: .data.json in this folder, blocked from the web), so every device
 * you sign in on sees the same stock.
 */
declare(strict_types=1);

const STARTING_HASH = '$2y$10$it0kPT.nGQNuu6ok7jJZt.h/iRMwzvYJI.edQODC7LL.4/FvNreoC';
const COOKIE_NAME   = 'bs_auth';
const REMEMBER_DAYS = 30;     // "Keep me signed in on this device"
const SHORT_HOURS   = 12;     // otherwise
const MAX_FAILS     = 8;      // wrong tries allowed per IP …
const LOCK_MINUTES  = 15;     // … before a pause of this long

define('BACKSTOCK', true);

header('X-Robots-Tag: noindex, nofollow, noarchive');
header('Referrer-Policy: no-referrer');
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

/* ---------- private settings file ---------- */
function auth_path(): string {
    $home = dirname((string)($_SERVER['DOCUMENT_ROOT'] ?? ''));
    $outside = $home . '/.backstock-auth.json';
    if ($home !== '' && $home !== '.' && $home !== '/' && (is_file($outside) || is_writable($home))) return $outside;
    return __DIR__ . '/.auth.json';
}
function save_auth(array $a): bool {
    $p = auth_path();
    $ok = @file_put_contents($p, json_encode($a), LOCK_EX) !== false;
    if ($ok) @chmod($p, 0600);
    return $ok;
}
function load_auth(): array {
    $p = auth_path();
    if (is_file($p)) {
        $a = json_decode((string)@file_get_contents($p), true);
        if (is_array($a) && !empty($a['hash']) && !empty($a['secret'])) {
            $a['fails'] = is_array($a['fails'] ?? null) ? $a['fails'] : [];
            $a['writable'] = true;
            return $a;
        }
    }
    $a = ['hash' => STARTING_HASH, 'secret' => bin2hex(random_bytes(32)), 'fails' => []];
    if (save_auth($a)) { $a['writable'] = true; return $a; }
    // Could not create the settings file: fall back to a key derived from this server.
    $a['secret'] = hash('sha256', STARTING_HASH . '|' . __DIR__ . '|' . php_uname());
    $a['writable'] = false;
    return $a;
}
function persist(array $a): bool {
    if (empty($a['writable'])) return false;
    unset($a['writable']);
    return save_auth($a);
}

/* ---------- signed login cookie ---------- */
function cookie_path(): string {
    $dir = str_replace('\\', '/', dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/')));
    return rtrim($dir, '/') . '/';
}
function is_https(): bool {
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}
function sign(string $exp, array $a): string {
    return hash_hmac('sha256', $exp . '|' . $a['hash'], $a['secret']);
}
function set_login_cookie(array $a, bool $remember): void {
    $exp = (string)(time() + ($remember ? REMEMBER_DAYS * 86400 : SHORT_HOURS * 3600));
    setcookie(COOKIE_NAME, $exp . '.' . sign($exp, $a), [
        'expires'  => $remember ? (int)$exp : 0,
        'path'     => cookie_path(),
        'secure'   => is_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}
function clear_login_cookie(): void {
    setcookie(COOKIE_NAME, '', ['expires' => time() - 3600, 'path' => cookie_path(), 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Strict']);
}
function is_logged_in(array $a): bool {
    $c = (string)($_COOKIE[COOKIE_NAME] ?? '');
    if (!preg_match('/^(\d{9,12})\.([a-f0-9]{64})$/', $c, $m)) return false;
    if ((int)$m[1] < time()) return false;
    return hash_equals(sign($m[1], $a), $m[2]);
}

/* ---------- too many wrong tries ---------- */
function client_key(): string { return hash('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown')); }
function lock_remaining(array $a): int {
    $f = $a['fails'][client_key()] ?? null;
    if (!$f || $f['n'] < MAX_FAILS) return 0;
    return max(0, ($f['t'] + LOCK_MINUTES * 60) - time());
}
function note_fail(array &$a): void {
    $k = client_key(); $now = time();
    $f = $a['fails'][$k] ?? ['n' => 0, 't' => $now];
    if ($now - $f['t'] > LOCK_MINUTES * 60) $f = ['n' => 0, 't' => $now];
    $f['n']++; $f['t'] = $now;
    $a['fails'][$k] = $f;
    foreach ($a['fails'] as $key => $v) if ($now - $v['t'] > 86400) unset($a['fails'][$key]); // tidy
    persist($a);
}
function clear_fails(array &$a): void {
    if (isset($a['fails'][client_key()])) { unset($a['fails'][client_key()]); persist($a); }
}

function json_out(int $code, array $body): void {
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode($body);
    exit;
}
function go_home(): void { header('Location: ' . cookie_path(), true, 303); exit; }

/* ---------- shared inventory data ---------- */
const DATA_COLLS = ['items', 'depts', 'log'];
const MAX_LOG    = 500;
function data_path(): string {
    $home = dirname((string)($_SERVER['DOCUMENT_ROOT'] ?? ''));
    $outside = $home . '/.backstock-data.json';
    if ($home !== '' && $home !== '.' && $home !== '/' && (is_file($outside) || is_writable($home))) return $outside;
    return __DIR__ . '/.data.json';
}
function empty_data(): array { return ['rev' => 0, 'items' => [], 'depts' => [], 'log' => []]; }
function clean_data($d): array {
    $out = empty_data();
    if (!is_array($d)) return $out;
    $out['rev'] = (int)($d['rev'] ?? 0);
    foreach (DATA_COLLS as $c) {
        if (!isset($d[$c]) || !is_array($d[$c])) continue;
        foreach ($d[$c] as $id => $doc) if (valid_id((string)$id) && is_array($doc)) $out[$c][(string)$id] = $doc;
    }
    return $out;
}
function valid_id(string $id): bool { return (bool)preg_match('/^[A-Za-z0-9_\-.~:@+]{1,80}$/', $id); }
function read_data(): array {
    $p = data_path();
    if (!is_file($p)) return empty_data();
    $fh = @fopen($p, 'r'); if (!$fh) return empty_data();
    flock($fh, LOCK_SH); $raw = stream_get_contents($fh); flock($fh, LOCK_UN); fclose($fh);
    return clean_data(json_decode((string)$raw, true));
}
/** Lock, change, save. $fn receives the data by reference; return a string to abort with that error. */
function change_data(callable $fn): array {
    $p = data_path();
    $fh = @fopen($p, 'c+');
    if (!$fh) json_out(500, ['ok' => false, 'code' => 'unavailable', 'error' => 'The server would not let the app save data.']);
    flock($fh, LOCK_EX);
    $d = clean_data(json_decode((string)stream_get_contents($fh), true));
    $err = $fn($d);
    if (is_string($err)) { flock($fh, LOCK_UN); fclose($fh); json_out(400, ['ok' => false, 'code' => 'invalid_argument', 'error' => $err]); }
    if (count($d['log']) > MAX_LOG) {
        uasort($d['log'], fn($a, $b) => ($b['at'] ?? 0) <=> ($a['at'] ?? 0));
        $d['log'] = array_slice($d['log'], 0, MAX_LOG, true);
    }
    $d['rev']++;
    $json = json_encode($d, JSON_UNESCAPED_UNICODE);
    ftruncate($fh, 0); rewind($fh); fwrite($fh, $json); fflush($fh);
    flock($fh, LOCK_UN); fclose($fh);
    @chmod($p, 0600);
    return $d;
}
function read_json_body(int $maxBytes): array {
    $raw = file_get_contents('php://input', false, null, 0, $maxBytes + 1);
    if ($raw === false || strlen($raw) > $maxBytes) json_out(413, ['ok' => false, 'code' => 'too_large', 'error' => 'That request is too large.']);
    $j = json_decode($raw, true);
    if (!is_array($j)) json_out(400, ['ok' => false, 'code' => 'invalid_argument', 'error' => 'Bad request.']);
    return $j;
}
function key_hint(string $k): string { return $k === '' ? '' : '…' . substr($k, -4); }

/* ---------- requests ---------- */
$auth   = load_auth();
$action = (string)($_GET['action'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($action === 'logout' && $method === 'POST') { clear_login_cookie(); go_home(); }

if ($action === 'change' && $method === 'POST') {
    if (!is_logged_in($auth)) json_out(401, ['ok' => false, 'error' => 'You are signed out. Reload the page and sign in again.']);
    $cur = (string)($_POST['current'] ?? '');
    $new = (string)($_POST['new'] ?? '');
    if (!password_verify($cur, $auth['hash'])) { usleep(800000); json_out(400, ['ok' => false, 'error' => 'Current password is wrong.']); }
    if (strlen($new) < 8) json_out(400, ['ok' => false, 'error' => 'New password must be at least 8 characters.']);
    if (empty($auth['writable'])) json_out(500, ['ok' => false, 'error' => 'The server would not let the app save a new password. Ask your host to allow writing to your home folder.']);
    $auth['hash'] = password_hash($new, PASSWORD_DEFAULT);
    if (!persist($auth)) json_out(500, ['ok' => false, 'error' => 'Could not save the new password. Try again.']);
    set_login_cookie($auth, true); // other devices are signed out; this one stays in
    json_out(200, ['ok' => true]);
}

/* ---------- app API (signed-in only) ---------- */
$api = ['data', 'write', 'import', 'settings', 'ai'];
if (in_array($action, $api, true)) {
    if (!is_logged_in($auth)) json_out(401, ['ok' => false, 'code' => 'signed_out', 'error' => 'Signed out.']);
    if ($method === 'POST' && ($_SERVER['HTTP_X_BACKSTOCK'] ?? '') !== '1') json_out(403, ['ok' => false, 'code' => 'forbidden', 'error' => 'Forbidden.']);

    if ($action === 'data') {
        $d = read_data();
        if (isset($_GET['since']) && (int)$_GET['since'] === $d['rev']) json_out(200, ['ok' => true, 'rev' => $d['rev'], 'unchanged' => true]);
        json_out(200, ['ok' => true] + $d);
    }

    if ($action === 'write' && $method === 'POST') {
        $in = read_json_body(2 * 1024 * 1024);
        $ops = $in['ops'] ?? null;
        if (!is_array($ops) || !$ops || count($ops) > 300) json_out(400, ['ok' => false, 'code' => 'invalid_argument', 'error' => 'Bad request.']);
        $d = change_data(function (array &$d) use ($ops) {
            foreach ($ops as $o) {
                $op = $o['op'] ?? ''; $c = $o['coll'] ?? ''; $id = (string)($o['id'] ?? '');
                if (!in_array($c, DATA_COLLS, true) || !valid_id($id)) return 'Bad item reference.';
                if ($op === 'delete') { unset($d[$c][$id]); continue; }
                $doc = $o['data'] ?? null;
                if (!is_array($doc) || strlen(json_encode($doc)) > 65536) return 'Bad item data.';
                if ($op === 'set') $d[$c][$id] = $doc;
                elseif ($op === 'update') {
                    if (!isset($d[$c][$id])) return 'That item no longer exists. Reload and try again.';
                    $d[$c][$id] = array_merge($d[$c][$id], $doc);
                } else return 'Bad operation.';
            }
            return null;
        });
        json_out(200, ['ok' => true, 'rev' => $d['rev']]);
    }

    if ($action === 'import' && $method === 'POST') {
        $in = read_json_body(8 * 1024 * 1024);
        $src = clean_data($in['data'] ?? []);
        $d = change_data(function (array &$d) use ($src) {
            foreach (DATA_COLLS as $c) $d[$c] = $src[$c];
            return null;
        });
        json_out(200, ['ok' => true, 'rev' => $d['rev']]);
    }

    if ($action === 'settings') {
        if ($method === 'POST') {
            $in = read_json_body(16384);
            if (!empty($in['clearKey'])) $auth['apiKey'] = '';
            elseif (isset($in['apiKey']) && trim((string)$in['apiKey']) !== '') $auth['apiKey'] = trim((string)$in['apiKey']);
            if (isset($in['model']) && preg_match('/^[a-z0-9.\-]{3,64}$/', (string)$in['model'])) $auth['model'] = (string)$in['model'];
            if (!persist($auth)) json_out(500, ['ok' => false, 'code' => 'unavailable', 'error' => 'Could not save settings on the server.']);
        }
        $k = (string)($auth['apiKey'] ?? '');
        json_out(200, ['ok' => true, 'hasKey' => $k !== '', 'keyHint' => key_hint($k), 'model' => (string)($auth['model'] ?? 'claude-sonnet-5-5')]);
    }

    if ($action === 'ai' && $method === 'POST') {
        $key = (string)($auth['apiKey'] ?? '');
        if ($key === '') json_out(400, ['ok' => false, 'code' => 'not_granted', 'error' => 'No API key saved.']);
        if (!function_exists('curl_init')) json_out(500, ['ok' => false, 'code' => 'upstream_error', 'error' => 'PHP cURL is not available on this server.']);
        $in = read_json_body(14 * 1024 * 1024);
        $prompt = (string)($in['prompt'] ?? '');
        $images = is_array($in['images'] ?? null) ? $in['images'] : [];
        if ($prompt === '' || strlen($prompt) > 200000 || count($images) > 5) json_out(400, ['ok' => false, 'code' => 'invalid_request', 'error' => 'Bad request.']);
        $content = [];
        foreach ($images as $b64) {
            if (!is_string($b64) || strlen($b64) > 6000000 || !preg_match('/^[A-Za-z0-9+\/=]+$/', $b64)) json_out(400, ['ok' => false, 'code' => 'image_rejected', 'error' => 'Bad image.']);
            $content[] = ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => 'image/jpeg', 'data' => $b64]];
        }
        $content[] = ['type' => 'text', 'text' => $prompt];
        @set_time_limit(150);
        $ch = curl_init('https://api.anthropic.com/v1/messages');
        curl_setopt_array($ch, [
            CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 140, CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_HTTPHEADER => ['content-type: application/json', 'x-api-key: ' . $key, 'anthropic-version: 2023-06-01'],
            CURLOPT_POSTFIELDS => json_encode(['model' => (string)($auth['model'] ?? 'claude-sonnet-5-5'), 'max_tokens' => 4096, 'messages' => [['role' => 'user', 'content' => $content]]]),
        ]);
        $res = curl_exec($ch); $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
        if ($res === false) json_out(502, ['ok' => false, 'code' => 'network', 'error' => 'Could not reach the Anthropic API.']);
        if ($status === 401 || $status === 403) json_out(400, ['ok' => false, 'code' => 'bad_key', 'error' => 'API key rejected.']);
        if ($status === 429) json_out(429, ['ok' => false, 'code' => 'rate_limited', 'error' => 'Rate limited.']);
        $j = json_decode((string)$res, true);
        if ($status !== 200 || !is_array($j)) json_out(502, ['ok' => false, 'code' => 'upstream_error', 'error' => 'The AI service returned an error.']);
        $text = '';
        foreach (($j['content'] ?? []) as $b) if (($b['type'] ?? '') === 'text') $text .= (string)$b['text'];
        json_out(200, ['ok' => true, 'text' => trim($text), 'truncated' => ($j['stop_reason'] ?? '') === 'max_tokens']);
    }
    json_out(405, ['ok' => false, 'code' => 'invalid_request', 'error' => 'Not allowed.']);
}

$error = '';
if ($method === 'POST' && isset($_POST['password'])) {
    $wait = lock_remaining($auth);
    if ($wait > 0) {
        $error = 'Too many wrong tries. Try again in ' . (int)ceil($wait / 60) . ' min.';
    } elseif (password_verify((string)$_POST['password'], $auth['hash'])) {
        clear_fails($auth);
        set_login_cookie($auth, !empty($_POST['remember']));
        go_home();
    } else {
        note_fail($auth);
        usleep(800000);
        $left = MAX_FAILS - (int)($auth['fails'][client_key()]['n'] ?? 0);
        $error = $left > 0 ? 'That password is not right.' : 'Too many wrong tries. Try again in ' . LOCK_MINUTES . ' min.';
    }
}

if (!is_logged_in($auth)) {
    if ($method === 'POST' || $action !== '') http_response_code($error ? 401 : 403);
    require __DIR__ . '/views/login.php';
    exit;
}

require __DIR__ . '/views/app.php';
