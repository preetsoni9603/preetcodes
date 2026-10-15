/*
 * Backstock Manager — website runtime.
 *
 * app.js talks to four services through `window.claude.use(name)`:
 *   db        – document store (items, depts, log)
 *   sample    – AI reading of photos / typed lists
 *   downloads – saving the PDF report and backups
 *   user      – who is viewing (not used outside Claude)
 *
 * Inside Claude, Claude provides them. On your website this file does:
 *   - Server mode (index.php, password-protected): inventory is stored on
 *     your server, so every signed-in device sees the same stock. Changes
 *     from other devices appear within a few seconds. AI requests go through
 *     your server, which holds the API key.
 *   - Local mode (plain static hosting): inventory stays in this browser.
 */
(function () {
  if (window.claude && typeof window.claude.use === "function") return; // running inside Claude

  const SERVER = !!window.BACKSTOCK_LOCK;
  const LOCAL_DB_KEY = "backstock-db-v1";
  const LOCAL_CFG_KEY = "backstock-settings-v1";
  const DEFAULT_MODEL = "claude-sonnet-5-5";
  const POLL_MS = 6000;
  const MAX_LOG = 500;

  const clone = o => JSON.parse(JSON.stringify(o));
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const emptyData = () => ({ items: {}, depts: {}, log: {} });

  /* ---------------- server API ---------------- */
  async function api(action, body, extra = "") {
    let r;
    try {
      r = await fetch(`./?action=${action}${extra}`, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json", "X-Backstock": "1" } : { "X-Backstock": "1" },
        body: body ? JSON.stringify(body) : undefined,
        credentials: "same-origin",
        cache: "no-store"
      });
    } catch (e) { throw { code: "network", message: "Couldn't reach your website." }; }
    if (r.status === 401) { location.reload(); throw { code: "signed_out" }; }
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.ok === false) throw { code: (j && j.code) || "unavailable", message: (j && j.error) || "Server error." };
    return j;
  }

  /* ---------------- shared store (memory + listeners) ---------------- */
  let mem = emptyData();
  let rev = 0;
  const listeners = new Set();
  const meta = { fromCache: false, hasPendingWrites: false };
  const coll = name => (mem[name] = mem[name] || {});
  const snapDoc = (id, data) => ({ id, exists: data !== undefined, data: () => (data === undefined ? undefined : clone(data)), metadata: meta });

  function runQuery(q) {
    let docs = Object.entries(coll(q.name)).map(([id, d]) => snapDoc(id, d));
    if (q.order) {
      const [f, dir] = q.order;
      docs.sort((a, b) => {
        const x = a.data()[f], y = b.data()[f];
        if (x === y) return 0;
        if (x === undefined) return 1;
        if (y === undefined) return -1;
        return (x < y ? -1 : 1) * (dir === "desc" ? -1 : 1);
      });
    } else docs.sort((a, b) => a.id.localeCompare(b.id));
    if (q.lim) docs = docs.slice(0, q.lim);
    return { docs, size: docs.length, empty: !docs.length, metadata: meta, docChanges: () => docs.map((d, i) => ({ type: "added", doc: d, oldIndex: -1, newIndex: i })) };
  }
  function notify(name) { for (const l of listeners) if (!name || l.q.name === name) setTimeout(() => l.fire(), 0); }

  /* persistence: server or this browser */
  function saveLocal() {
    const ids = Object.keys(mem.log);
    if (ids.length > MAX_LOG) ids.sort((a, b) => (mem.log[b].at || 0) - (mem.log[a].at || 0)).slice(MAX_LOG).forEach(id => delete mem.log[id]);
    try { localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(mem)); }
    catch (e) { throw { code: "quota_exceeded", message: "Browser storage is full." }; }
  }
  function loadLocal() {
    try { const raw = localStorage.getItem(LOCAL_DB_KEY); return raw ? Object.assign(emptyData(), JSON.parse(raw)) : null; } catch (e) { return null; }
  }
  async function writeOp(name, op, id, data) {
    if (!SERVER) { saveLocal(); return; }
    try {
      const j = await api("write", { ops: [{ op, coll: name, id, data }] });
      rev = j.rev;
    } catch (e) {
      await pull(true).catch(() => {}); // put the screen back in step with the server
      throw e;
    }
  }

  function docRef(name, id) {
    id = id || newId();
    return {
      id, path: name + "/" + id,
      async get() { return snapDoc(id, coll(name)[id]); },
      async set(data) { coll(name)[id] = clone(data); notify(name); await writeOp(name, "set", id, data); },
      async update(data) {
        const cur = coll(name)[id];
        if (!cur) throw { code: "invalid_argument", message: "Document does not exist." };
        coll(name)[id] = Object.assign({}, cur, clone(data)); notify(name);
        await writeOp(name, "update", id, data);
      },
      async delete() { delete coll(name)[id]; notify(name); await writeOp(name, "delete", id); },
      onSnapshot(next) { const l = { q: { name }, fire: () => next(snapDoc(id, coll(name)[id])) }; listeners.add(l); setTimeout(l.fire, 0); return () => listeners.delete(l); }
    };
  }
  function query(q) {
    return {
      path: q.name,
      orderBy(f, dir) { return query(Object.assign({}, q, { order: [f, dir || "asc"] })); },
      limit(n) { return query(Object.assign({}, q, { lim: n })); },
      where() { return query(q); },
      async get() { return runQuery(q); },
      onSnapshot(next) { const l = { q, fire: () => next(runQuery(q)) }; listeners.add(l); setTimeout(l.fire, 0); return () => listeners.delete(l); },
      doc(id) { return docRef(q.name, id); },
      async add(data) { const r = docRef(q.name); await r.set(data); return r; }
    };
  }
  const db = {
    collection(name) { return query({ name }); },
    doc(path) { const [name, id] = path.split("/"); return docRef(name, id); }
  };

  /* ---------------- sync with the server ---------------- */
  async function pull(force) {
    const j = await api("data", null, force ? "" : `&since=${rev}`);
    if (j.unchanged) return false;
    rev = j.rev;
    mem = { items: j.items || {}, depts: j.depts || {}, log: j.log || {} };
    notify();
    return true;
  }
  let ready;
  if (SERVER) {
    ready = (async () => {
      try {
        await pull(true);
        // One-time move: data saved in this browser by an earlier version goes to the server.
        const local = loadLocal();
        const serverEmpty = !Object.keys(mem.items).length && !Object.keys(mem.depts).length;
        if (local && serverEmpty && (Object.keys(local.items || {}).length || Object.keys(local.depts || {}).length)) {
          await api("import", { data: local });
          try { localStorage.setItem(LOCAL_DB_KEY + "-moved", localStorage.getItem(LOCAL_DB_KEY)); localStorage.removeItem(LOCAL_DB_KEY); } catch (e) {}
          await pull(true);
        }
        return true;
      } catch (e) { return false; }
    })();
    const tick = () => { if (document.visibilityState === "visible") pull(false).catch(() => {}); };
    setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
  } else {
    mem = loadLocal() || emptyData();
    ready = Promise.resolve(true);
    window.addEventListener("storage", e => { if (e.key === LOCAL_DB_KEY) { mem = loadLocal() || emptyData(); notify(); } });
  }

  /* ---------------- settings (API key) ---------------- */
  let serverCfg = { hasKey: false, keyHint: "", model: DEFAULT_MODEL };
  const cfgReady = SERVER ? api("settings").then(c => (serverCfg = c)).catch(() => serverCfg) : Promise.resolve();
  function loadLocalCfg() { try { return JSON.parse(localStorage.getItem(LOCAL_CFG_KEY) || "{}"); } catch (e) { return {}; } }
  function saveLocalCfg(c) { try { localStorage.setItem(LOCAL_CFG_KEY, JSON.stringify(c)); } catch (e) {} }

  /* ---------------- downloads ---------------- */
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return { status: "saved" };
    }
  };

  /* ---------------- AI ---------------- */
  // Shrink photos before upload: long side 1568px, JPEG.
  function toBase64Image(file) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, 1568 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.85).split(",")[1]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject({ code: "image_rejected" }); };
      img.src = url;
    });
  }
  async function askServer(prompt, images, signal) {
    if (signal && signal.aborted) throw { code: "cancelled" };
    const job = api("ai", { prompt, images });
    if (!signal) return job;
    return Promise.race([job, new Promise((_, rej) => signal.addEventListener("abort", () => rej({ code: "cancelled" }), { once: true }))]);
  }
  async function askDirect(cfg, prompt, images, signal) {
    const content = images.map(data => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }));
    content.push({ type: "text", text: prompt });
    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal,
        headers: { "content-type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: cfg.model || DEFAULT_MODEL, max_tokens: 4096, messages: [{ role: "user", content }] })
      });
    } catch (e) { throw { code: e && e.name === "AbortError" ? "cancelled" : "network" }; }
    if (res.status === 401 || res.status === 403) throw { code: "bad_key" };
    if (res.status === 429) throw { code: "rate_limited" };
    if (!res.ok) throw { code: "upstream_error" };
    const body = await res.json();
    return { text: (body.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim(), truncated: body.stop_reason === "max_tokens" };
  }
  function makeSample() {
    async function call(input, opts = {}) {
      const prompt = typeof input === "string" ? input : input.map(t => t.content).join("\n\n");
      const files = opts.images ? (opts.images instanceof Blob ? [opts.images] : [...opts.images]) : [];
      const images = [];
      for (const f of files) images.push(await toBase64Image(f));
      const r = SERVER ? await askServer(prompt, images, opts.signal) : await askDirect(loadLocalCfg(), prompt, images, opts.signal);
      if (!r.text) throw { code: "empty_completion" };
      return { text: r.text, truncated: !!r.truncated, modelTierApplied: "default" };
    }
    const sample = (input, opts) => call(input, opts);
    sample.json = async (input, opts) => {
      const { text } = await call(input, opts);
      try { return JSON.parse(text); } catch (e) {}
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fence) { try { return JSON.parse(fence[1]); } catch (e) {} }
      const a = text.search(/[\[{]/), b = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
      if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch (e) {} }
      throw { code: "invalid_json", text };
    };
    sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20e6, mediaTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] } });
    return sample;
  }

  /* ---------------- window.claude ---------------- */
  window.claude = {
    standalone: true,
    use: async name => {
      if (name === "db") return (await ready) ? db : null;
      if (name === "downloads") return downloads;
      if (name === "sample") {
        if (SERVER) { await cfgReady; return serverCfg.hasKey ? makeSample() : null; }
        return loadLocalCfg().apiKey ? makeSample() : null;
      }
      return null; // "user": everyone signed in can edit
    }
  };

  /* ---------------- Settings panel ---------------- */
  async function openSettings() {
    if (SERVER) { try { serverCfg = await api("settings"); } catch (e) {} }
    const local = loadLocalCfg();
    const hasKey = SERVER ? serverCfg.hasKey : !!local.apiKey;
    const hint = SERVER ? serverCfg.keyHint : (local.apiKey ? "…" + local.apiKey.slice(-4) : "");
    const model = (SERVER ? serverCfg.model : local.model) || DEFAULT_MODEL;
    const counts = `${Object.keys(mem.items).length} items, ${Object.keys(mem.depts).length} departments`;
    const root = document.getElementById("modal-root");
    root.innerHTML = `<div class="scrim" id="scrim"><form class="modal" id="set-form">
      <h3 style="font-size:20px">Settings</h3>
      <div class="field"><span class="label">Your inventory</span>
        <span class="hint">${SERVER ? `Saved on your website (${counts}). Sign in on any phone or computer with the same password to see the same stock.` : `Saved in this browser only (${counts}).`}</span></div>
      <div class="field"><span class="label">AI reading of photos and lists</span>
        <span class="hint">${hasKey ? `API key saved (${esc(hint)}). Leave the box empty to keep it.` : "Optional. Add an Anthropic API key to read delivery photos and messy lists."}${SERVER ? " The key is kept on your server and works on every device." : " The key stays in this browser."}</span>
        <input id="set-key" type="password" autocomplete="off" placeholder="${hasKey ? "Paste a new key to replace it" : "sk-ant-…"}" aria-label="Anthropic API key">
        <input id="set-model" autocomplete="off" value="${esc(model)}" aria-label="Model">
        ${hasKey ? '<div class="actions"><button type="button" class="btn sm" id="set-rmkey">Remove key</button></div>' : ""}</div>
      ${SERVER ? `<div class="field"><span class="label">Password</span>
        <span class="hint">The same password works on every device. Changing it signs out every other device.</span>
        <input id="pw-cur" type="password" autocomplete="current-password" placeholder="Current password" aria-label="Current password">
        <input id="pw-new" type="password" autocomplete="new-password" placeholder="New password (8+ characters)" aria-label="New password">
        <input id="pw-new2" type="password" autocomplete="new-password" placeholder="Type the new password again" aria-label="Confirm new password">
        <div class="actions"><button type="button" class="btn sm" id="pw-save">Change password</button>
        <button type="button" class="btn sm" id="pw-lock">Lock app now</button></div></div>` : ""}
      <div class="field"><span class="label">Backup</span><span class="hint">Download a copy of everything, or restore one.</span>
        <div class="actions"><button type="button" class="btn sm" id="set-export">Export backup</button>
        <label class="btn sm" for="set-import" style="cursor:pointer">Import backup</label><input id="set-import" type="file" accept="application/json,.json" hidden>
        <button type="button" class="btn sm danger" id="set-clear">Erase all data</button></div></div>
      <span class="status" id="set-msg"></span>
      <div class="actions" style="justify-content:flex-end"><button type="button" class="btn" id="set-cancel">Close</button><button type="submit" class="btn primary">Save</button></div>
    </form></div>`;
    const $ = id => document.getElementById(id);
    const msg = (t, bad) => { const m = $("set-msg"); m.className = "status" + (bad ? " err" : ""); m.textContent = t; };
    const close = () => (root.innerHTML = "");
    $("set-cancel").onclick = close;
    $("scrim").onclick = e => { if (e.target.id === "scrim") close(); };

    $("set-form").onsubmit = async e => {
      e.preventDefault();
      const key = $("set-key").value.trim(), mdl = $("set-model").value.trim() || DEFAULT_MODEL;
      if (SERVER) {
        try { await api("settings", { apiKey: key, model: mdl }); } catch (err) { msg(err.message || "Couldn't save settings.", true); return; }
      } else saveLocalCfg({ apiKey: key || local.apiKey || "", model: mdl });
      location.reload();
    };
    const rm = $("set-rmkey");
    if (rm) rm.onclick = async () => {
      if (SERVER) { try { await api("settings", { clearKey: true }); } catch (err) { msg(err.message, true); return; } }
      else saveLocalCfg({ apiKey: "", model: local.model });
      location.reload();
    };

    const pwSave = $("pw-save");
    if (pwSave) {
      pwSave.onclick = async () => {
        const cur = $("pw-cur").value, nw = $("pw-new").value, nw2 = $("pw-new2").value;
        if (!cur || !nw) { msg("Fill in your current and new password.", true); return; }
        if (nw.length < 8) { msg("New password must be at least 8 characters.", true); return; }
        if (nw !== nw2) { msg("The two new passwords don't match.", true); return; }
        pwSave.disabled = true; msg("Saving…");
        try {
          const r = await fetch("./?action=change", { method: "POST", body: new URLSearchParams({ current: cur, new: nw }), credentials: "same-origin" });
          const j = await r.json().catch(() => ({}));
          if (r.ok && j.ok) { ["pw-cur", "pw-new", "pw-new2"].forEach(id => ($(id).value = "")); msg("Password changed. Use the new one on your other devices."); }
          else msg(j.error || "Couldn't change the password. Try again.", true);
        } catch (e) { msg("Couldn't reach the server. Check your connection.", true); }
        pwSave.disabled = false;
      };
      $("pw-lock").onclick = () => {
        const f = document.createElement("form"); f.method = "post"; f.action = "./?action=logout";
        document.body.appendChild(f); f.submit();
      };
    }

    $("set-export").onclick = () => {
      downloads.save({ filename: `backstock-backup-${new Date().toISOString().slice(0, 10)}.json`, data: JSON.stringify({ app: "backstock", version: 1, exportedAt: Date.now(), data: mem }, null, 2) });
      msg("Backup downloaded.");
    };
    const replaceAll = async data => {
      if (SERVER) { await api("import", { data }); await pull(true); }
      else { mem = Object.assign(emptyData(), data); saveLocal(); }
      location.reload();
    };
    $("set-import").onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      let d;
      try { const j = JSON.parse(await f.text()); d = j.data || j; if (!d || typeof d.items !== "object") throw 0; }
      catch (err) { msg("That file isn't a Backstock backup.", true); return; }
      try { await replaceAll({ items: d.items || {}, depts: d.depts || {}, log: d.log || {} }); }
      catch (err) { msg(err.message || "Couldn't restore the backup.", true); }
    };
    const clr = $("set-clear");
    clr.onclick = async () => {
      if (clr.dataset.armed !== "1") { clr.dataset.armed = "1"; clr.textContent = "Tap again to erase everything"; return; }
      try { await replaceAll(emptyData()); } catch (err) { msg(err.message || "Couldn't erase.", true); }
    };
  }

  document.addEventListener("DOMContentLoaded", () => {
    const row = document.querySelector(".hrow");
    if (!row) return;
    const b = document.createElement("button");
    b.className = "gear"; b.type = "button"; b.setAttribute("aria-label", "Settings");
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
    b.onclick = openSettings;
    row.appendChild(b);
  });
})();
