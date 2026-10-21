<?php if (!defined('MYCAL')) { http_response_code(404); exit; } ?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#111514">
<title>My Calendar</title>
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Figtree:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap">
<link rel="stylesheet" href="css/app.css">
</head>
<body>
<main class="lock">
  <form method="post" action="" autocomplete="on">
    <div><p class="eyebrow"><span>Preet's planner</span></p><h1>My Calendar</h1></div>
    <p>Enter your password to open your tasks.</p>
    <?php if (!empty($error)): ?><p class="err" role="alert"><?= htmlspecialchars($error, ENT_QUOTES) ?></p><?php endif; ?>
    <div class="field"><label for="password">Password</label>
      <span class="pw-wrap"><input id="password" name="password" type="password" required autofocus autocomplete="current-password" spellcheck="false">
      <button type="button" class="pw-eye" id="pw-eye" aria-label="Show password" aria-pressed="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
      </button></span></div>
    <label class="check" for="remember"><input id="remember" name="remember" type="checkbox" value="1" checked> Keep me signed in on this device for 30 days</label>
    <button class="btn primary" type="submit">Open my calendar</button>
  </form>
</main>
<script>
(function () {
  var b = document.getElementById("pw-eye"), i = document.getElementById("password");
  b.addEventListener("click", function () {
    var show = i.type === "password";
    i.type = show ? "text" : "password";
    b.setAttribute("aria-pressed", String(show));
    b.setAttribute("aria-label", show ? "Hide password" : "Show password");
    i.focus();
  });
})();
</script>
</body>
</html>
