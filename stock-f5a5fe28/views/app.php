<?php if (!defined('BACKSTOCK')) { http_response_code(404); exit; } ?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Backstock Manager</title>
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<meta name="description" content="Track stockroom inventory: receive deliveries by photo, list or form, move stock to the shelf, and export department PDF reports.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=Public+Sans:wght@400;500;600&display=swap">
<link rel="stylesheet" href="css/styles.css">
</head>
<body>
<header>
  <div class="wrap">
    <div class="hrow">
      <div class="brand"><h1>Backstock</h1><span class="tot" id="hdr-total">Loading…</span></div>
      <label class="search" for="q">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="q" type="search" placeholder="Check quantity — search an item" autocomplete="off" aria-label="Search items">
      </label>
    </div>
    <nav class="tabs" role="tablist">
      <button class="tab" role="tab" data-tab="stock" aria-selected="true">Stock</button>
      <button class="tab" role="tab" data-tab="receive" aria-selected="false">Receive delivery</button>
      <button class="tab" role="tab" data-tab="shelf" aria-selected="false">Move to shelf</button>
      <button class="tab" role="tab" data-tab="reports" aria-selected="false">Reports</button>
      <button class="tab" role="tab" data-tab="activity" aria-selected="false">Activity</button>
    </nav>
  </div>
  <div class="tape" aria-hidden="true"></div>
</header>

<main class="wrap">
  <div class="banner" id="ro-banner" hidden>You can view this inventory but not change it. Ask the owner for edit access.</div>
  <div class="banner" id="offline-banner" hidden>Couldn't load your inventory from the website. Check your internet connection and reload the page.</div>

  <!-- STOCK -->
  <section class="panel" id="p-stock" data-panel="stock">
    <div class="panel-head">
      <div><h2>Backstock on hand</h2><p>Everything in the stockroom. Tap an item to edit its count.</p></div>
      <div class="toolbar">
        <select id="f-dept" aria-label="Filter by department"><option value="">All departments</option></select>
        <select id="f-sort" aria-label="Sort">
          <option value="dept">Sort: Department</option>
          <option value="name">Sort: Name A–Z</option>
          <option value="low">Sort: Lowest first</option>
          <option value="recent">Sort: Recently changed</option>
        </select>
        <button class="btn w-only" id="btn-dept">+ Add department</button>
        <button class="btn primary w-only" id="btn-new">+ Add item</button>
      </div>
    </div>
    <div id="hit" hidden></div>
    <div class="card scroll" id="stock-wrap"></div>
  </section>

  <!-- RECEIVE -->
  <section class="panel" id="p-receive" data-panel="receive" hidden>
    <div class="panel-head">
      <div><h2>Receive a delivery</h2><p>Counts you enter here are added to backstock.</p></div>
      <div class="seg" role="group" aria-label="Entry method">
        <button data-rmode="photo" aria-pressed="true">Photo</button>
        <button data-rmode="text" aria-pressed="false">Type a list</button>
        <button data-rmode="form" aria-pressed="false">Form</button>
      </div>
    </div>

    <div class="card pad" data-rpane="photo">
      <div style="display:flex;flex-direction:column;gap:14px">
        <label class="drop" id="drop" for="photo-in">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="4"/></svg>
          <strong>Take or choose a photo of the packing slip or invoice</strong>
          <span class="hint">Claude reads the items and counts. You review them before anything is added.</span>
        </label>
        <input id="photo-in" type="file" accept="image/*" capture="environment" multiple hidden>
        <div class="thumbs" id="thumbs"></div>
        <div class="actions">
          <button class="btn primary" id="btn-photo-read" disabled>Read delivery</button>
          <button class="btn" id="btn-photo-stop" hidden>Stop</button>
          <span class="status" id="photo-status"></span>
        </div>
      </div>
    </div>

    <div class="card pad" data-rpane="text" hidden>
      <div style="display:flex;flex-direction:column;gap:12px">
        <label class="field" for="r-text"><span class="label">One item per line — name, department, quantity</span>
          <textarea id="r-text" placeholder="Whole milk 1 gal, Dairy, 24&#10;Bananas, Produce, 40&#10;Paper towels 6pk - 12&#10;3 cases x 12 Sparkling water"></textarea></label>
        <div class="actions">
          <button class="btn primary" id="btn-rtext">Read list</button>
          <span class="status" id="rtext-status">Department is optional for items you already stock.</span>
        </div>
      </div>
    </div>

    <form class="card pad" data-rpane="form" id="r-form" hidden>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="colhead"><span class="label">Item</span><span class="label c-dept">Department (new items)</span><span class="label">Qty</span><span></span></div>
        <div class="frows" id="r-rows"></div>
        <div class="actions">
          <button type="button" class="btn sm" id="r-addrow">+ Another item</button>
          <span style="flex:1"></span>
          <button type="submit" class="btn primary">Add to backstock</button>
        </div>
      </div>
    </form>

    <div id="review-receive"></div>
  </section>

  <!-- SHELF -->
  <section class="panel" id="p-shelf" data-panel="shelf" hidden>
    <div class="panel-head">
      <div><h2>Move stock to the shelf</h2><p>Counts you enter here are taken out of backstock.</p></div>
      <div class="seg" role="group" aria-label="Entry method">
        <button data-smode="text" aria-pressed="true">Type a list</button>
        <button data-smode="form" aria-pressed="false">Form</button>
      </div>
    </div>

    <div class="card pad" data-spane="text">
      <div style="display:flex;flex-direction:column;gap:12px">
        <label class="field" for="s-text"><span class="label">One item per line — name and quantity pulled</span>
          <textarea id="s-text" placeholder="Whole milk 1 gal - 6&#10;Bananas 10&#10;Paper towels, 4"></textarea></label>
        <div class="actions">
          <button class="btn primary" id="btn-stext">Read list</button>
          <span class="status" id="stext-status"></span>
        </div>
      </div>
    </div>

    <form class="card pad" data-spane="form" id="s-form" hidden>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="colhead shelf"><span class="label">Item from backstock</span><span class="label">Qty</span><span></span></div>
        <div class="frows" id="s-rows"></div>
        <div class="actions">
          <button type="button" class="btn sm" id="s-addrow">+ Another item</button>
          <span style="flex:1"></span>
          <button type="submit" class="btn primary">Remove to shelf</button>
        </div>
      </div>
    </form>

    <div id="review-shelf"></div>
  </section>

  <!-- REPORTS -->
  <section class="panel" id="p-reports" data-panel="reports" hidden>
    <div class="panel-head">
      <div><h2>Inventory report</h2><p>Pick a department or keep all, then download the table as a PDF.</p></div>
      <div class="toolbar">
        <button class="btn primary" id="btn-pdf">Download PDF</button>
      </div>
    </div>
    <div class="stats" id="rep-stats"></div>
    <div class="dept-grid" id="rep-depts"></div>
    <div class="card scroll" id="rep-table"></div>
    <span class="status" id="pdf-status"></span>
  </section>

  <!-- ACTIVITY -->
  <section class="panel" id="p-activity" data-panel="activity" hidden>
    <div class="panel-head"><div><h2>Recent activity</h2><p>The last 40 deliveries, shelf pulls and edits.</p></div></div>
    <div class="card log" id="log"></div>
  </section>
</main>

<datalist id="dl-names"></datalist>
<datalist id="dl-depts"></datalist>
<nav class="bnav" aria-label="Sections">
  <button class="tab btab" role="tab" data-tab="stock" aria-selected="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/></svg><span>Stock</span></button>
  <button class="tab btab" role="tab" data-tab="receive" aria-selected="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 6h12v10H2z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg><span>Receive</span></button>
  <button class="tab btab" role="tab" data-tab="shelf" aria-selected="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M3 13h18"/><path d="M5 13V9h5v4M13 13V6h6v7M6 21v-4h4v4M14 21v-5h4v5"/></svg><span>To shelf</span></button>
  <button class="tab btab" role="tab" data-tab="reports" aria-selected="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M9 13h8M9 17h6"/></svg><span>Reports</span></button>
  <button class="tab btab" role="tab" data-tab="activity" aria-selected="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span>Activity</span></button>
</nav>
<div id="modal-root"></div>
<div id="modal2"></div>
<div class="toast" id="toast" hidden></div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"></script>
<script>window.BACKSTOCK_LOCK = true;</script>
<script src="js/standalone.js"></script>
<script src="js/app.js"></script>
</body>
</html>
