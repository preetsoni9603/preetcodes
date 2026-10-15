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
