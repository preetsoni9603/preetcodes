<?php
/*
 * My Calendar — Preet's day planner.
 *
 * - Password gate: the app only loads after the right password. Only a
 *   one-way hash is stored. Change it from Settings → Password.
 * - Tasks are saved on the server in /home/<you>/.mycalendar-data.json
 *   (fallback: .data.json in this folder, blocked by .htaccess), so every
 *   device you sign in on sees the same tasks.
 * - Google Calendar: after you connect it in Settings, every task you add,
 *   change, finish or delete is mirrored to your primary Google Calendar with
 *   a reminder, and your Google events show up in the planner. Google then
 *   notifies your phone and laptop. Keys and tokens live in the private
 *   settings file /home/<you>/.mycalendar-auth.json, never in git.
 */
declare(strict_types=1);

const STARTING_HASH = '$2y$10$NZvv4w6e1dy52PfgkYjiP.kLL2yYDjRLvCN3svtkqjz8w0VwfYIGC';
const COOKIE_NAME   = 'mc_auth';
const REMEMBER_DAYS = 30;
const SHORT_HOURS   = 12;
const MAX_FAILS     = 8;
const LOCK_MINUTES  = 15;
const GCAL_EVENTS   = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const GCAL_SCOPE    = 'https://www.googleapis.com/auth/calendar.events';

define('MYCAL', true);

header('X-Robots-Tag: noindex, nofollow, noarchive');
header('Referrer-Policy: no-referrer');
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

/* ---------- private files (outside the web folder when possible) ---------- */
function private_path(string $name, string $fallback): string {
    $home = dirname((string)($_SERVER['DOCUMENT_ROOT'] ?? ''));
    $outside = $home . '/' . $name;
    if ($home !== '' && $home !== '.' && $home !== '/' && (is_file($outside) || is_writable($home))) return $outside;
    return __DIR__ . '/' . $fallback;
}
function auth_path(): string { return private_path('.mycalendar-auth.json', '.auth.json'); }
function data_path(): string { return private_path('.mycalendar-data.json', '.data.json'); }

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
            $a['google'] = is_array($a['google'] ?? null) ? $a['google'] : [];
            $a['writable'] = true;
            return $a;
        }
    }
    $a = ['hash' => STARTING_HASH, 'secret' => bin2hex(random_bytes(32)), 'fails' => [], 'google' => []];
    if (save_auth($a)) { $a['writable'] = true; return $a; }
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
function app_url(): string {
    return (is_https() ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . cookie_path();
}
function sign(string $exp, array $a): string { return hash_hmac('sha256', $exp . '|' . $a['hash'], $a['secret']); }
function set_login_cookie(array $a, bool $remember): void {
    $exp = (string)(time() + ($remember ? REMEMBER_DAYS * 86400 : SHORT_HOURS * 3600));
    setcookie(COOKIE_NAME, $exp . '.' . sign($exp, $a), [
        'expires' => $remember ? (int)$exp : 0, 'path' => cookie_path(),
        'secure' => is_https(), 'httponly' => true, 'samesite' => 'Strict',
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
    foreach ($a['fails'] as $key => $v) if ($now - $v['t'] > 86400) unset($a['fails'][$key]);
    persist($a);
}
function clear_fails(array &$a): void {
    if (isset($a['fails'][client_key()])) { unset($a['fails'][client_key()]); persist($a); }
}

function json_out(int $code, array $body): void {
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}
function go_home(string $query = ''): void { header('Location: ' . cookie_path() . $query, true, 303); exit; }

/* ---------- task data ---------- */
const DATA_COLLS = ['tasks', 'meta'];
function empty_data(): array { return ['rev' => 0, 'tasks' => [], 'meta' => []]; }
function valid_id(string $id): bool { return (bool)preg_match('/^[A-Za-z0-9_\-.~:@+]{1,80}$/', $id); }
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
function read_data(): array {
    $p = data_path();
    if (!is_file($p)) return empty_data();
    $fh = @fopen($p, 'r'); if (!$fh) return empty_data();
    flock($fh, LOCK_SH); $raw = stream_get_contents($fh); flock($fh, LOCK_UN); fclose($fh);
    return clean_data(json_decode((string)$raw, true));
}
/** Lock, change, save. $fn gets the data by reference; return a string to abort with that error. */
function change_data(callable $fn): array {
    $p = data_path();
    $fh = @fopen($p, 'c+');
    if (!$fh) json_out(500, ['ok' => false, 'code' => 'unavailable', 'error' => 'The server would not let the app save data.']);
    flock($fh, LOCK_EX);
    $d = clean_data(json_decode((string)stream_get_contents($fh), true));
    $err = $fn($d);
    if (is_string($err)) { flock($fh, LOCK_UN); fclose($fh); json_out(400, ['ok' => false, 'code' => 'invalid_argument', 'error' => $err]); }
    $d['rev']++;
    ftruncate($fh, 0); rewind($fh); fwrite($fh, json_encode($d, JSON_UNESCAPED_UNICODE)); fflush($fh);
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

/* ---------- Google Calendar ---------- */
function http_req(string $method, string $url, $body = null, array $headers = [], bool $form = false): array {
    if (!function_exists('curl_init')) return [0, null];
    $ch = curl_init($url);
    $opts = [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_CONNECTTIMEOUT => 10];
    if ($body !== null) {
        if ($form) { $opts[CURLOPT_POSTFIELDS] = http_build_query($body); $headers[] = 'Content-Type: application/x-www-form-urlencoded'; }
        else { $opts[CURLOPT_POSTFIELDS] = json_encode($body, JSON_UNESCAPED_UNICODE); $headers[] = 'Content-Type: application/json'; }
    }
    $opts[CURLOPT_HTTPHEADER] = $headers;
    curl_setopt_array($ch, $opts);
    $res = curl_exec($ch); $st = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    if ($res === false) return [0, null];
    return [$st, json_decode((string)$res, true)];
}
function g_redirect_uri(): string { return app_url() . '?action=gcallback'; }
function g_configured(array $a): bool { return !empty($a['google']['client_id']) && !empty($a['google']['client_secret']); }
function g_connected(array $a): bool { return g_configured($a) && !empty($a['google']['refresh']); }
function g_status(array $a): array {
    return [
        'configured' => g_configured($a), 'connected' => g_connected($a),
        'error' => (string)($a['google']['error'] ?? ''), 'tz' => (string)($a['google']['tz'] ?? ''),
        'redirectUri' => g_redirect_uri(), 'clientIdHint' => g_configured($a) ? substr((string)$a['google']['client_id'], 0, 12) . '…' : '',
        'curl' => function_exists('curl_init'),
    ];
}
function g_tz(array $a): string {
    $tz = (string)($a['google']['tz'] ?? '');
    return in_array($tz, DateTimeZone::listIdentifiers(), true) ? $tz : 'America/Chicago';
}
function g_state(array $a, int $exp): string { return $exp . '.' . hash_hmac('sha256', 'gstate|' . $exp, $a['secret']); }
function g_state_ok(array $a, string $s): bool {
    if (!preg_match('/^(\d{9,12})\.([a-f0-9]{64})$/', $s, $m) || (int)$m[1] < time()) return false;
    return hash_equals(g_state($a, (int)$m[1]), $s);
}
/** A fresh access token, refreshing it with the saved refresh token when needed. '' when not connected. */
function g_access(array &$a): string {
    if (!g_connected($a)) return '';
    $g = $a['google'];
    if (!empty($g['access']) && (int)($g['access_exp'] ?? 0) > time() + 60) return (string)$g['access'];
    [$st, $j] = http_req('POST', 'https://oauth2.googleapis.com/token', [
        'client_id' => $g['client_id'], 'client_secret' => $g['client_secret'],
        'refresh_token' => $g['refresh'], 'grant_type' => 'refresh_token',
    ], [], true);
    if ($st !== 200 || empty($j['access_token'])) {
        if ($st === 400 || $st === 401) {
            $a['google']['refresh'] = ''; $a['google']['access'] = '';
            $a['google']['error'] = 'Google stopped accepting the connection. Connect Google Calendar again in Settings.';
            persist($a);
        }
        return '';
    }
    $a['google']['access'] = (string)$j['access_token'];
    $a['google']['access_exp'] = time() + (int)($j['expires_in'] ?? 3600);
    $a['google']['error'] = '';
    persist($a);
    return (string)$j['access_token'];
}
function g_event_body(string $id, array $t, string $tz): array {
    $dept = trim((string)($t['department'] ?? '')) ?: 'Personal';
    $done = !empty($t['done']);
    $pri  = (string)($t['priority'] ?? 'normal');
    $note = trim((string)($t['note'] ?? ''));
    $ev = [
        'summary' => ($done ? '✓ ' : '') . '[' . $dept . '] ' . (string)($t['name'] ?? 'Task'),
        'description' => ($note !== '' ? $note . "\n\n" : '') . 'Department: ' . $dept . "\nPriority: " . ucfirst($pri) . "\nAdded from My Calendar",
        'status' => 'confirmed',
        'transparency' => 'transparent',
        'extendedProperties' => ['private' => ['mycal' => '1', 'taskId' => $id]],
    ];
    $due = (string)($t['due'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $due)) $due = (new DateTime('now', new DateTimeZone($tz)))->format('Y-m-d');
    $time = (string)($t['time'] ?? '');
    if (preg_match('/^\d{2}:\d{2}$/', $time)) {
        $start = new DateTime($due . ' ' . $time, new DateTimeZone($tz));
        $end = (clone $start)->modify('+30 minutes');
        $ev['start'] = ['dateTime' => $start->format('Y-m-d\TH:i:s'), 'timeZone' => $tz];
        $ev['end']   = ['dateTime' => $end->format('Y-m-d\TH:i:s'), 'timeZone' => $tz];
        $mins = max(0, min(40320, (int)($t['remind'] ?? 30)));
    } else {
        $ev['start'] = ['date' => $due];
        $ev['end']   = ['date' => (new DateTime($due))->modify('+1 day')->format('Y-m-d')];
        $mins = 420; // all-day task: remind at 5 PM the evening before
    }
    $ev['reminders'] = $done ? ['useDefault' => false, 'overrides' => []]
                             : ['useDefault' => false, 'overrides' => [['method' => 'popup', 'minutes' => $mins]]];
    if ($pri === 'urgent') $ev['colorId'] = '11'; elseif ($pri === 'high') $ev['colorId'] = '6'; else $ev['colorId'] = '7';
    return $ev;
}
/** Mirror one task to Google. $t null = delete. Returns ['eventId'=>…] or ['err'=>…] or ['skip'=>true]. */
function g_push(array &$a, string $id, ?array $t, string $evId): array {
    $tok = g_access($a);
    if ($tok === '') return ['skip' => true];
    $h = ['Authorization: Bearer ' . $tok];
    if ($t === null) {
        if ($evId !== '') http_req('DELETE', GCAL_EVENTS . '/' . rawurlencode($evId), null, $h);
        return ['eventId' => ''];
    }
    $body = g_event_body($id, $t, g_tz($a));
    if ($evId !== '') {
        [$st, $j] = http_req('PATCH', GCAL_EVENTS . '/' . rawurlencode($evId), $body, $h);
        if ($st === 200 && !empty($j['id'])) return ['eventId' => (string)$j['id']];
        if ($st !== 404 && $st !== 410) return ['err' => 'Google Calendar did not accept the change.'];
    }
    [$st, $j] = http_req('POST', GCAL_EVENTS, $body, $h);
    if ($st === 200 && !empty($j['id'])) return ['eventId' => (string)$j['id']];
    return ['err' => $st === 0 ? 'Could not reach Google Calendar.' : 'Google Calendar did not accept the event.'];
}
/** Push a list of [id => previous eventId] and save the new event ids onto the tasks. Returns error count. */
function g_sync(array &$a, array $changed): int {
    if (!$changed || !g_connected($a)) return 0;
    $d = read_data(); $results = []; $errors = 0;
    foreach ($changed as $id => $oldEv) {
        $t = $d['tasks'][$id] ?? null;
        $r = g_push($a, (string)$id, $t, (string)($t['gcalId'] ?? $oldEv));
        if (!empty($r['skip'])) return 0;
        if (isset($r['err'])) $errors++;
        if ($t !== null) $results[$id] = $r;
    }
    if ($results) change_data(function (array &$d) use ($results) {
        foreach ($results as $id => $r) {
            if (!isset($d['tasks'][$id])) continue;
            if (isset($r['eventId'])) { $d['tasks'][$id]['gcalId'] = $r['eventId']; unset($d['tasks'][$id]['gcalErr']); }
            else $d['tasks'][$id]['gcalErr'] = $r['err'];
        }
        return null;
    });
    return $errors;
}

/* ---------- requests ---------- */
$auth   = load_auth();
$action = (string)($_GET['action'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($action === 'logout' && $method === 'POST') { clear_login_cookie(); go_home(); }

/* Google sends the browser back here. The login cookie is SameSite=Strict, so it is not sent on
   this cross-site return; the signed `state` proves the request started from a signed-in page. */
if ($action === 'gcallback') {
    $ok = false;
    if (g_configured($auth) && g_state_ok($auth, (string)($_GET['state'] ?? '')) && !empty($_GET['code'])) {
        [$st, $j] = http_req('POST', 'https://oauth2.googleapis.com/token', [
            'code' => (string)$_GET['code'], 'client_id' => $auth['google']['client_id'],
            'client_secret' => $auth['google']['client_secret'], 'redirect_uri' => g_redirect_uri(),
            'grant_type' => 'authorization_code',
        ], [], true);
        if ($st === 200 && !empty($j['refresh_token'])) {
            $auth['google']['refresh'] = (string)$j['refresh_token'];
            $auth['google']['access'] = (string)($j['access_token'] ?? '');
            $auth['google']['access_exp'] = time() + (int)($j['expires_in'] ?? 3600);
            $auth['google']['error'] = '';
            $ok = persist($auth);
        }
    }
    $to = './?gc=' . ($ok ? 'ok' : 'fail');
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><title>My Calendar</title><meta name="viewport" content="width=device-width,initial-scale=1">'
       . '<p style="font:16px system-ui;padding:24px">Returning to My Calendar… <a href="' . htmlspecialchars($to, ENT_QUOTES) . '">Continue</a></p>'
       . '<script>location.replace(' . json_encode($to) . ')</script>';
    exit;
}

if ($action === 'gauth') {
    if (!is_logged_in($auth)) go_home();
    if (!g_configured($auth)) go_home('?gc=nokeys');
    $q = http_build_query([
        'client_id' => $auth['google']['client_id'], 'redirect_uri' => g_redirect_uri(), 'response_type' => 'code',
        'scope' => GCAL_SCOPE, 'access_type' => 'offline', 'prompt' => 'consent', 'include_granted_scopes' => 'true',
        'state' => g_state($auth, time() + 600),
    ]);
    header('Location: https://accounts.google.com/o/oauth2/v2/auth?' . $q, true, 302);
    exit;
}

if ($action === 'change' && $method === 'POST') {
    if (!is_logged_in($auth)) json_out(401, ['ok' => false, 'error' => 'You are signed out. Reload the page and sign in again.']);
    $in = read_json_body(4096);
    $cur = (string)($in['current'] ?? ''); $new = (string)($in['new'] ?? '');
    if (!password_verify($cur, $auth['hash'])) { usleep(800000); json_out(400, ['ok' => false, 'error' => 'Current password is wrong.']); }
    if (strlen($new) < 8) json_out(400, ['ok' => false, 'error' => 'New password must be at least 8 characters.']);
    if (empty($auth['writable'])) json_out(500, ['ok' => false, 'error' => 'The server would not let the app save a new password. Ask your host to allow writing to your home folder.']);
    $auth['hash'] = password_hash($new, PASSWORD_DEFAULT);
    if (!persist($auth)) json_out(500, ['ok' => false, 'error' => 'Could not save the new password. Try again.']);
    set_login_cookie($auth, true);
    json_out(200, ['ok' => true]);
}

/* ---------- app API (signed-in only) ---------- */
$api = ['data', 'write', 'settings', 'gevents', 'gsyncall'];
if (in_array($action, $api, true)) {
    if (!is_logged_in($auth)) json_out(401, ['ok' => false, 'code' => 'signed_out', 'error' => 'Signed out.']);
    if ($method === 'POST' && ($_SERVER['HTTP_X_MYCAL'] ?? '') !== '1') json_out(403, ['ok' => false, 'code' => 'forbidden', 'error' => 'Forbidden.']);

    if ($action === 'data') {
        $d = read_data();
        if (isset($_GET['since']) && (int)$_GET['since'] === $d['rev']) json_out(200, ['ok' => true, 'rev' => $d['rev'], 'unchanged' => true]);
        json_out(200, ['ok' => true, 'google' => g_status($auth)] + $d);
    }

    if ($action === 'write' && $method === 'POST') {
        $in = read_json_body(1024 * 1024);
        $ops = $in['ops'] ?? null;
        if (!is_array($ops) || !$ops || count($ops) > 200) json_out(400, ['ok' => false, 'code' => 'invalid_argument', 'error' => 'Bad request.']);
        $changed = [];
        $d = change_data(function (array &$d) use ($ops, &$changed) {
            foreach ($ops as $o) {
                $op = $o['op'] ?? ''; $c = $o['coll'] ?? ''; $id = (string)($o['id'] ?? '');
                if (!in_array($c, DATA_COLLS, true) || !valid_id($id)) return 'Bad item reference.';
                $prev = $d[$c][$id] ?? null;
                if ($c === 'tasks') $changed[$id] = (string)($prev['gcalId'] ?? '');
                if ($op === 'delete') { unset($d[$c][$id]); continue; }
                $doc = $o['data'] ?? null;
                if (!is_array($doc) || strlen(json_encode($doc)) > 32768) return 'Bad item data.';
                unset($doc['gcalId'], $doc['gcalErr']); // owned by the server
                if ($op === 'set') {
                    if ($c === 'tasks' && $prev && !empty($prev['gcalId'])) $doc['gcalId'] = $prev['gcalId'];
                    $d[$c][$id] = $doc;
                } elseif ($op === 'update') {
                    if (!$prev) return 'That task no longer exists. Reload and try again.';
                    $d[$c][$id] = array_merge($prev, $doc);
                } else return 'Bad operation.';
            }
            return null;
        });
        $gErrors = g_sync($auth, $changed);
        json_out(200, ['ok' => true, 'rev' => $d['rev'], 'gcalErrors' => $gErrors]);
    }

    if ($action === 'gsyncall' && $method === 'POST') {
        if (!g_connected($auth)) json_out(400, ['ok' => false, 'code' => 'not_connected', 'error' => 'Connect Google Calendar first.']);
        @set_time_limit(120);
        $d = read_data(); $changed = [];
        foreach ($d['tasks'] as $id => $t) $changed[$id] = (string)($t['gcalId'] ?? '');
        $errs = g_sync($auth, array_slice($changed, 0, 300, true));
        json_out(200, ['ok' => true, 'count' => min(count($changed), 300), 'gcalErrors' => $errs]);
    }

    if ($action === 'gevents') {
        if (!g_connected($auth)) json_out(200, ['ok' => true, 'events' => []]);
        $from = (string)($_GET['from'] ?? ''); $to = (string)($_GET['to'] ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) json_out(400, ['ok' => false, 'error' => 'Bad range.']);
        $tok = g_access($auth);
        if ($tok === '') json_out(200, ['ok' => true, 'events' => [], 'google' => g_status($auth)]);
        $tz = new DateTimeZone(g_tz($auth));
        $q = http_build_query([
            'singleEvents' => 'true', 'orderBy' => 'startTime', 'maxResults' => 250,
            'timeMin' => (new DateTime($from . ' 00:00', $tz))->format(DATE_RFC3339),
            'timeMax' => (new DateTime($to . ' 23:59:59', $tz))->format(DATE_RFC3339),
        ]);
        [$st, $j] = http_req('GET', GCAL_EVENTS . '?' . $q, null, ['Authorization: Bearer ' . $tok]);
        if ($st !== 200) json_out(502, ['ok' => false, 'code' => 'upstream_error', 'error' => 'Could not load your Google Calendar.']);
        $out = [];
        foreach (($j['items'] ?? []) as $e) {
            if (($e['extendedProperties']['private']['mycal'] ?? '') === '1') continue; // our own tasks
            if (($e['status'] ?? '') === 'cancelled') continue;
            $s = $e['start'] ?? []; $en = $e['end'] ?? [];
            if (!empty($s['date'])) {
                $out[] = ['id' => $e['id'], 'title' => (string)($e['summary'] ?? '(No title)'), 'date' => $s['date'], 'allDay' => true, 'link' => (string)($e['htmlLink'] ?? '')];
            } elseif (!empty($s['dateTime'])) {
                $a1 = (new DateTime($s['dateTime']))->setTimezone($tz);
                $a2 = !empty($en['dateTime']) ? (new DateTime($en['dateTime']))->setTimezone($tz) : (clone $a1)->modify('+1 hour');
                $out[] = ['id' => $e['id'], 'title' => (string)($e['summary'] ?? '(No title)'), 'date' => $a1->format('Y-m-d'),
                          'time' => $a1->format('H:i'), 'endTime' => $a2->format('Y-m-d') === $a1->format('Y-m-d') ? $a2->format('H:i') : '23:59',
                          'allDay' => false, 'link' => (string)($e['htmlLink'] ?? '')];
            }
        }
        json_out(200, ['ok' => true, 'events' => $out]);
    }

    if ($action === 'settings') {
        if ($method === 'POST') {
            $in = read_json_body(16384);
            if (isset($in['tz']) && in_array((string)$in['tz'], DateTimeZone::listIdentifiers(), true)) $auth['google']['tz'] = (string)$in['tz'];
            if (!empty($in['clientId']) && !empty($in['clientSecret'])) {
                $cid = trim((string)$in['clientId']); $cs = trim((string)$in['clientSecret']);
                if (!preg_match('/^[A-Za-z0-9\-_.]+\.apps\.googleusercontent\.com$/', $cid)) json_out(400, ['ok' => false, 'error' => 'That Client ID does not look right. It ends with .apps.googleusercontent.com.']);
                if (strlen($cs) < 10 || strlen($cs) > 200) json_out(400, ['ok' => false, 'error' => 'That Client secret does not look right.']);
                $auth['google']['client_id'] = $cid; $auth['google']['client_secret'] = $cs;
                $auth['google']['refresh'] = ''; $auth['google']['access'] = ''; $auth['google']['error'] = '';
            }
            if (!empty($in['disconnect'])) {
                if (!empty($auth['google']['refresh'])) http_req('POST', 'https://oauth2.googleapis.com/revoke', ['token' => $auth['google']['refresh']], [], true);
                $auth['google']['refresh'] = ''; $auth['google']['access'] = ''; $auth['google']['error'] = '';
            }
            if (!empty($in['forgetKeys'])) $auth['google'] = ['tz' => (string)($auth['google']['tz'] ?? '')];
            if (!persist($auth)) json_out(500, ['ok' => false, 'code' => 'unavailable', 'error' => 'Could not save settings on the server.']);
        }
        json_out(200, ['ok' => true, 'google' => g_status($auth)]);
    }
    json_out(405, ['ok' => false, 'code' => 'invalid_request', 'error' => 'Not allowed.']);
}

/* ---------- sign in ---------- */
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
