<?php if (!defined('BACKSTOCK')) { http_response_code(404); exit; } ?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<title>Backstock Manager</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=Public+Sans:wght@400;500;600&display=swap">
<link rel="stylesheet" href="css/styles.css">
<style>
  html,body{height:100%}
  .lock-page{min-height:100%;display:flex;flex-direction:column}
  .lock-main{flex:1;display:flex;align-items:center;justify-content:center;padding-block:32px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
  .lock-card{width:100%;max-width:380px;padding:28px 24px;display:flex;flex-direction:column;gap:16px}
  .lock-card h1{font-size:28px;font-weight:700}
  .lock-card p{margin:0;color:var(--muted)}
  .lock-card input[type=password]{height:46px;font-size:16px}
  .check{display:flex;gap:10px;align-items:center;font-size:14px;color:var(--muted);cursor:pointer}
  .check input{width:18px;height:18px;accent-color:var(--ink)}
  .err{padding:10px 12px;border-radius:6px;background:var(--bad-soft);color:var(--bad);font-size:14px;font-weight:600}
  .lock-card .btn{width:100%;height:46px;font-size:16px}
</style>
</head>
<body>
<div class="lock-page">
  <div class="tape" aria-hidden="true"></div>
  <main class="lock-main">
    <form class="card lock-card" method="post" action="" autocomplete="on">
      <div>
        <div class="label">Stockroom</div>
        <h1>Backstock</h1>
      </div>
      <p>Enter the password to open the inventory.</p>
      <?php if (!empty($error)): ?><div class="err" role="alert"><?= htmlspecialchars($error, ENT_QUOTES) ?></div><?php endif; ?>
      <label class="field" for="password"><span class="label">Password</span>
        <input id="password" name="password" type="password" required autofocus autocomplete="current-password"></label>
      <label class="check" for="remember"><input id="remember" name="remember" type="checkbox" value="1" checked> Keep me signed in on this device for 30 days</label>
      <button class="btn primary" type="submit">Unlock</button>
    </form>
  </main>
</div>
</body>
</html>
