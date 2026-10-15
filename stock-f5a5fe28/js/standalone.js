/*
 * Backstock Manager — standalone runtime.
 *
 * app.js talks to four services through `window.claude.use(name)`:
 *   db        – document store (items, depts, log)
 *   sample    – AI reading of photos / typed lists
 *   downloads – saving the PDF report
 *   user      – who is viewing (not used outside Claude)
 *
 * When the page runs inside Claude, Claude provides these. Anywhere else
 * (GitHub Pages, a local file, any web server) this file provides them:
 *   db        → this browser's localStorage
 *   sample    → the Anthropic Messages API with your own API key (optional)
 *   downloads → a normal browser download
 */
(function () {
  if (window.claude && typeof window.claude.use === "function") return; // running inside Claude

  const DB_KEY = "backstock-db-v1";
  const CFG_KEY = "backstock-settings-v1";
  const MAX_LOG = 500;
  const DEFAULT_MODEL = "claude-sonnet-5-5";

  /* ---------------- settings ---------------- */
  function loadCfg() { try { return JSON.parse(localStorage.getItem(CFG_KEY) || "{}"); } catch (e) { return {}; } }
  function saveCfg(c) { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) {} }

  /* ---------------- db (localStorage) ---------------- */
  let mem = { items: {}, depts: {}, log: {} };
  function load() {
    try { const raw = localStorage.getItem(DB_KEY); if (raw) mem = Object.assign({ items: {}, depts: {}, log: {} }, JSON.parse(raw)); } catch (e) {}
  }
  function persist() {
    // keep the activity log bounded
    const ids = Object.keys(mem.log);
    if (ids.length > MAX_LOG) {
      ids.sort((a, b) => (mem.log[b].at || 0) - (mem.log[a].at || 0)).slice(MAX_LOG).forEach(id => delete mem.log[id]);
    }
    try { localStorage.setItem(DB_KEY, JSON.stringify(mem)); }
    catch (e) { throw { code: "quota_exceeded", message: "Browser storage is full." }; }
  }
  load();

  const listeners = new Set();
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const clone = o => JSON.parse(JSON.stringify(o));
  const meta = { fromCache: false, hasPendingWrites: false };
  const snapDoc = (id, data) => ({ id, exists: data !== undefined, data: () => (data === undefined ? undefined : clone(data)), metadata: meta });
  const coll = name => (mem[name] = mem[name] || {});

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
  function notify(name) {
    for (const l of listeners) if (l.q.name === name) setTimeout(() => l.next(runQuery(l.q)), 0);
  }
  function docRef(name, id) {
    id = id || newId();
    return {
      id, path: name + "/" + id,
      async get() { return snapDoc(id, coll(name)[id]); },
      async set(data) { coll(name)[id] = clone(data); persist(); notify(name); },
      async update(data) {
        const cur = coll(name)[id];
        if (!cur) throw { code: "invalid_argument", message: "Document does not exist." };
        coll(name)[id] = Object.assign(cur, clone(data)); persist(); notify(name);
      },
      async delete() { delete coll(name)[id]; persist(); notify(name); },
      onSnapshot(next) { const l = { q: { name }, next: () => next(snapDoc(id, coll(name)[id])) }; listeners.add(l); setTimeout(l.next, 0); return () => listeners.delete(l); }
    };
  }
  function query(q) {
    return {
      path: q.name,
      orderBy(f, dir) { return query(Object.assign({}, q, { order: [f, dir || "asc"] })); },
      limit(n) { return query(Object.assign({}, q, { lim: n })); },
      where() { return query(q); }, // not used by the app
      async get() { return runQuery(q); },
      onSnapshot(next) { const l = { q, next }; listeners.add(l); setTimeout(() => next(runQuery(q)), 0); return () => listeners.delete(l); },
      doc(id) { return docRef(q.name, id); },
      async add(data) { const r = docRef(q.name); await r.set(data); return r; }
    };
  }
  const db = {
    collection(name) { return query({ name }); },
    doc(path) { const [name, id] = path.split("/"); return docRef(name, id); }
  };
  // keep several open tabs in sync
  window.addEventListener("storage", e => { if (e.key === DB_KEY) { load(); ["items", "depts", "log"].forEach(notify); } });

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

  /* ---------------- sample (Anthropic API) ---------------- */
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
  function makeSample(cfg) {
    async function call(input, opts = {}) {
      const prompt = typeof input === "string" ? input : input.map(t => t.content).join("\n\n");
      const content = [];
      const imgs = opts.images ? (opts.images instanceof Blob ? [opts.images] : [...opts.images]) : [];
      for (const f of imgs) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await toBase64Image(f) } });
      content.push({ type: "text", text: prompt });
      let res;
      try {
        res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal: opts.signal,
          headers: {
            "content-type": "application/json",
            "x-api-key": cfg.apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
          },
          body: JSON.stringify({ model: cfg.model || DEFAULT_MODEL, max_tokens: 4096, messages: [{ role: "user", content }] })
        });
      } catch (e) {
        if (e && e.name === "AbortError") throw { code: "cancelled" };
        throw { code: "network" };
      }
      if (res.status === 401 || res.status === 403) throw { code: "bad_key" };
      if (res.status === 429) throw { code: "rate_limited" };
      if (!res.ok) throw { code: "upstream_error", message: await res.text().catch(() => "") };
      const body = await res.json();
      const text = (body.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
      if (!text) throw { code: "empty_completion" };
      return { text, truncated: body.stop_reason === "max_tokens", modelTierApplied: "default" };
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

  /* ---------------- window.claude shim ---------------- */
  window.claude = {
    standalone: true,
    use: async name => {
      if (name === "db") return db;
      if (name === "downloads") return downloads;
      if (name === "sample") { const c = loadCfg(); return c.apiKey ? makeSample(c) : null; }
      return null; // "user": everyone on this device can edit
    }
  };

  /* ---------------- settings & backup UI ---------------- */
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function openSettings() {
    const cfg = loadCfg();
    const root = document.getElementById("modal-root");
    const counts = `${Object.keys(mem.items).length} items, ${Object.keys(mem.depts).length} departments`;
    root.innerHTML = `<div class="scrim" id="scrim"><form class="modal" id="set-form">
      <h3 style="font-size:20px">Settings</h3>
      <div class="field"><span class="label">AI reading (optional)</span>
        <span class="hint">Add an Anthropic API key to read delivery photos and messy typed lists. Without one, typed lists are read line by line and the Photo option is hidden. The key stays in this browser only.</span></div>
      <label class="field" for="set-key"><span class="label">Anthropic API key</span><input id="set-key" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(cfg.apiKey || "")}"></label>
      <label class="field" for="set-model"><span class="label">Model</span><input id="set-model" autocomplete="off" value="${esc(cfg.model || DEFAULT_MODEL)}"></label>
      <div class="field"><span class="label">Backup</span><span class="hint">Inventory is saved in this browser (${counts}). Export a backup to move it to another device.</span>
        <div class="actions"><button type="button" class="btn sm" id="set-export">Export backup</button>
        <label class="btn sm" for="set-import" style="cursor:pointer">Import backup</label><input id="set-import" type="file" accept="application/json,.json" hidden>
        <button type="button" class="btn sm danger" id="set-clear">Erase all data</button></div></div>
      <span class="status" id="set-msg"></span>
      <div class="actions" style="justify-content:flex-end"><button type="button" class="btn" id="set-cancel">Cancel</button><button type="submit" class="btn primary">Save</button></div>
    </form></div>`;
    const msg = (t, bad) => { const m = document.getElementById("set-msg"); m.className = "status" + (bad ? " err" : ""); m.textContent = t; };
    document.getElementById("set-cancel").onclick = () => (root.innerHTML = "");
    document.getElementById("scrim").onclick = e => { if (e.target.id === "scrim") root.innerHTML = ""; };
    document.getElementById("set-form").onsubmit = e => {
      e.preventDefault();
      saveCfg({ apiKey: document.getElementById("set-key").value.trim(), model: document.getElementById("set-model").value.trim() || DEFAULT_MODEL });
      location.reload();
    };
    document.getElementById("set-export").onclick = () => {
      downloads.save({ filename: `backstock-backup-${new Date().toISOString().slice(0, 10)}.json`, data: JSON.stringify({ app: "backstock", version: 1, exportedAt: Date.now(), data: mem }, null, 2) });
      msg("Backup downloaded.");
    };
    document.getElementById("set-import").onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const j = JSON.parse(await f.text());
        const d = j.data || j;
        if (!d || typeof d.items !== "object") throw 0;
        mem = { items: d.items || {}, depts: d.depts || {}, log: d.log || {} };
        persist(); location.reload();
      } catch (err) { msg("That file isn't a Backstock backup.", true); }
    };
    const clr = document.getElementById("set-clear");
    clr.onclick = () => {
      if (clr.dataset.armed !== "1") { clr.dataset.armed = "1"; clr.textContent = "Tap again to erase everything"; return; }
      mem = { items: {}, depts: {}, log: {} }; persist(); location.reload();
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
