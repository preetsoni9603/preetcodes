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
  .pw-wrap{position:relative;display:block}
  .pw-wrap input{padding-right:52px!important;width:100%}
  .pw-eye{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:42px;height:38px;border:0;border-radius:6px;background:none;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center}
  .pw-eye:hover{color:var(--ink);background:var(--sunk)}
  .pw-eye svg{width:22px;height:22px}
  .note{font-size:13px;color:var(--muted);text-align:center}
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
        <span class="pw-wrap"><input id="password" name="password" type="password" required autofocus autocomplete="current-password" autocapitalize="characters" spellcheck="false">
        <button type="button" class="pw-eye" id="pw-eye" aria-label="Show password" aria-pressed="false">
          <svg class="eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
          <svg class="eye-shut" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" hidden><path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>
        </button></span></label>
      <label class="check" for="remember"><input id="remember" name="remember" type="checkbox" value="1" checked> Keep me signed in on this device for 30 days</label>
      <button class="btn primary" type="submit">Unlock</button>
      <p class="note">Use the same password on any phone or computer. Your stock is the same everywhere.</p>
    </form>
  </main>
</div>
<script>
(function () {
  var b = document.getElementById("pw-eye"), i = document.getElementById("password");
  b.addEventListener("click", function () {
    var show = i.type === "password";
    i.type = show ? "text" : "password";
    b.setAttribute("aria-pressed", String(show));
    b.setAttribute("aria-label", show ? "Hide password" : "Show password");
    b.querySelector(".eye-open").hidden = show;
    b.querySelector(".eye-shut").hidden = !show;
    i.focus();
  });
})();
</script>
</body>
</html>
