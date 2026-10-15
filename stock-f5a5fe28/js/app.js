/* Backstock Manager — app logic. Storage, AI and downloads come from window.claude (see standalone.js). */
(() => {
const LOW = 3;
const DEFAULT_DEPTS = ["Grocery","Dairy","Frozen","Produce","Meat & Seafood","Bakery","Deli","Beverages","Snacks","Health & Beauty","Household","Pet","General Merchandise"];
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const fmtN = n => Number(n || 0).toLocaleString();

let lim = null, db = null, sample = null, downloads = null, user = null, myId = null;
let canWrite = true, imagesOk = false;
let items = new Map();
let deptDocs = new Map();
let logs = [];
let loaded = false;
const ui = { tab: "stock", rmode: "photo", smode: "text", repDept: "", photos: [] };
try { const s = JSON.parse(localStorage.getItem("bs-ui") || "{}"); Object.assign(ui, s, { photos: [] }); } catch (e) {}
const saveUi = () => { try { localStorage.setItem("bs-ui", JSON.stringify({ tab: ui.tab, rmode: ui.rmode, smode: ui.smode, repDept: ui.repDept })); } catch (e) {} };

/* ---------- helpers ---------- */
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3200);
}
function ago(ms) {
  if (!ms) return "—";
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return Math.floor(d / 60) + " min ago";
  if (d < 86400) return Math.floor(d / 3600) + " h ago";
  if (d < 86400 * 7) return Math.floor(d / 86400) + " d ago";
  return new Date(ms).toLocaleDateString();
}
const allItems = () => [...items.values()];
function depts() {
  const s = new Map();
  for (const d of deptDocs.values()) if (d.name) s.set(norm(d.name), d.name);
  for (const i of allItems()) if (i.dept && !s.has(norm(i.dept))) s.set(norm(i.dept), i.dept);
  return [...s.values()].sort((a, b) => a.localeCompare(b));
}
function deptOptions(v) {
  let o = '<option value="">Choose department</option>', found = false;
  for (const d of depts()) { const sel = !!v && norm(d) === norm(v); if (sel) found = true; o += `<option value="${esc(d)}"${sel ? " selected" : ""}>${esc(d)}</option>`; }
  if (v && !found) o += `<option value="${esc(v)}" selected>${esc(v)} (new)</option>`;
  if (canWrite) o += '<option value="__new">+ New department…</option>';
  return o;
}
function wireDeptSelect(sel, onChange) {
  sel.dataset.prev = sel.value;
  sel.addEventListener("change", async () => {
    if (sel.value === "__new") {
      const name = await askNewDept();
      if (name) sel.innerHTML = deptOptions(name); else sel.value = sel.dataset.prev || "";
    }
    sel.dataset.prev = sel.value;
    onChange && onChange();
  });
}
function refreshDeptSelects() {
  $$("select.f-dept, select.rv-dept, select#ed-dept").forEach(sel => { const v = sel.value === "__new" ? "" : sel.value; sel.innerHTML = deptOptions(v); sel.dataset.prev = sel.value; });
}
async function ensureDept(name) {
  name = String(name || "").trim();
  if (!name || name === "Unassigned") return;
  for (const d of deptDocs.values()) if (norm(d.name) === norm(name)) return;
  deptDocs.set("local-" + norm(name), { id: "", name });
  await db.collection("depts").doc().set({ name, createdAt: Date.now() });
}
function askNewDept() {
  return new Promise(resolve => {
    const root = $("#modal2");
    root.innerHTML = `<div class="scrim" id="scrim2"><form class="modal" id="nd-form">
      <h3 style="font-size:20px">New department</h3>
      <label class="field" for="nd-name"><span class="label">Department name</span><input id="nd-name" required autocomplete="off" placeholder="e.g. Frozen"></label>
      <span class="status" id="nd-msg"></span>
      <div class="actions" style="justify-content:flex-end"><button type="button" class="btn" id="nd-cancel">Cancel</button><button type="submit" class="btn primary">Add department</button></div>
    </form></div>`;
    const done = v => { root.innerHTML = ""; resolve(v); };
    $("#nd-name").focus();
    $("#nd-cancel").addEventListener("click", () => done(null));
    $("#scrim2").addEventListener("click", e => { if (e.target.id === "scrim2") done(null); });
    $("#nd-form").addEventListener("submit", async e => {
      e.preventDefault();
      const name = $("#nd-name").value.trim().replace(/\s+/g, " ");
      if (!name) return;
      const ex = depts().find(d => norm(d) === norm(name));
      if (ex) { done(ex); return; }
      try { await ensureDept(name); toast(`Added department ${name}`); done(name); }
      catch (err) { $("#nd-msg").className = "status err"; $("#nd-msg").textContent = dbErr(err); }
    });
  });
}

/* ---------- departments manager ---------- */
function openDepts() {
  $("#modal-root").innerHTML = `<div class="scrim" id="scrim"><div class="modal" id="dm">
    <h3 style="font-size:20px">Departments</h3>
    <form class="actions" id="dm-form" style="flex-wrap:nowrap"><input id="dm-name" placeholder="New department name" autocomplete="off" aria-label="New department name"><button type="submit" class="btn primary">Add</button></form>
    <div class="dlist" id="dm-list"></div>
    <span class="status" id="dm-msg">Departments with items can be renamed. Empty ones can be deleted.</span>
    <div class="actions" style="justify-content:flex-end"><button type="button" class="btn" id="dm-close">Done</button></div>
  </div></div>`;
  $("#dm-close").addEventListener("click", closeModal);
  $("#scrim").addEventListener("click", e => { if (e.target.id === "scrim") closeModal(); });
  $("#dm-form").addEventListener("submit", async e => {
    e.preventDefault();
    const inp = $("#dm-name"), name = inp.value.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (depts().some(d => norm(d) === norm(name))) { dmMsg(`${name} already exists.`, true); return; }
    try { await ensureDept(name); inp.value = ""; dmMsg(`Added ${name}.`); renderDeptList(); inp.focus(); }
    catch (err) { dmMsg(dbErr(err), true); }
  });
  renderDeptList();
  $("#dm-name").focus();
}
function dmMsg(t, bad) { const m = $("#dm-msg"); if (m) { m.className = "status" + (bad ? " err" : ""); m.textContent = t; } }
function renderDeptList() {
  const box = $("#dm-list"); if (!box) return;
  const list = depts();
  if (!list.length) { box.innerHTML = '<div class="di"><span class="m">No departments yet. Add your first one above.</span></div>'; return; }
  box.innerHTML = list.map(d => {
    const its = allItems().filter(i => norm(i.dept) === norm(d));
    const u = its.reduce((a, i) => a + i.qty, 0);
    return `<div class="di" data-d="${esc(d)}"><span class="n">${esc(d)}</span><span class="m num">${its.length} items · ${fmtN(u)} units</span>
      <button type="button" class="btn sm" data-ren>Rename</button>${its.length ? "" : '<button type="button" class="btn sm danger" data-del>Delete</button>'}</div>`;
  }).join("");
  box.querySelectorAll(".di[data-d]").forEach(row => {
    const d = row.dataset.d;
    row.querySelector("[data-ren]").addEventListener("click", () => {
      row.innerHTML = `<input value="${esc(d)}" aria-label="New name for ${esc(d)}"><button type="button" class="btn sm primary" data-save>Save</button><button type="button" class="btn sm" data-cancel>Cancel</button>`;
      const inp = row.querySelector("input"); inp.focus(); inp.select();
      row.querySelector("[data-cancel]").addEventListener("click", renderDeptList);
      const save = async () => {
        const nn = inp.value.trim().replace(/\s+/g, " ");
        if (!nn || nn === d) { renderDeptList(); return; }
        if (norm(nn) !== norm(d) && depts().some(x => norm(x) === norm(nn))) { dmMsg(`${nn} already exists.`, true); return; }
        row.querySelectorAll("button").forEach(b => b.disabled = true);
        try {
          const docs = [...deptDocs.values()].filter(x => x.id && norm(x.name) === norm(d));
          if (docs.length) await db.doc("depts/" + docs[0].id).update({ name: nn });
          else await db.collection("depts").doc().set({ name: nn, createdAt: Date.now() });
          for (const x of docs.slice(1)) await db.doc("depts/" + x.id).delete();
          const its = allItems().filter(i => norm(i.dept) === norm(d));
          for (const i of its) { await db.doc("items/" + i.id).update({ dept: nn }); i.dept = nn; }
          dmMsg(`Renamed ${d} to ${nn}${its.length ? ` and moved ${its.length} items` : ""}.`);
        } catch (err) { dmMsg(dbErr(err), true); }
        renderDeptList();
      };
      row.querySelector("[data-save]").addEventListener("click", save);
      inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); save(); } });
    });
    const del = row.querySelector("[data-del]");
    if (del) del.addEventListener("click", async () => {
      if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = "Tap again"; return; }
      del.disabled = true;
      try {
        for (const x of [...deptDocs.values()].filter(x => x.id && norm(x.name) === norm(d))) await db.doc("depts/" + x.id).delete();
        [...deptDocs.keys()].forEach(k => { if (norm(deptDocs.get(k).name) === norm(d)) deptDocs.delete(k); });
        dmMsg(`Deleted ${d}.`);
      } catch (err) { dmMsg(dbErr(err), true); }
      renderDeptList();
    });
  });
}
function usedDepts() { return [...new Set(allItems().map(i => i.dept || "Unassigned"))].sort((a, b) => a.localeCompare(b)); }
function findItem(name, dept, strictDept) {
  const n = norm(name); if (!n) return null;
  const c = allItems().filter(i => norm(i.name) === n);
  if (!c.length) return null;
  if (dept) {
    const m = c.find(i => norm(i.dept) === norm(dept));
    if (m) return m;
    if (strictDept) return null;
  }
  return c[0];
}
function statusPill(q) {
  if (q <= 0) return '<span class="pill out">Out</span>';
  if (q <= LOW) return '<span class="pill low">Low</span>';
  return "";
}
function errCopy(code) {
  return ({
    not_granted: "Claude access was not allowed for this page. Use the form instead.",
    sampling_disabled: "Claude isn't available on this account. Use the form instead.",
    rate_limited: "Too many requests right now. Wait a minute and try again.",
    image_rejected: "That photo couldn't be read. Try a clearer JPG or PNG.",
    images_unavailable: "Photo reading isn't available here. Type the list instead.",
    invalid_json: "Claude's answer didn't come back as a list. Try again.",
    refused: "Claude couldn't read that. Try a different photo or list.",
    empty_completion: "Nothing was found. Try a clearer photo or list.",
    session_expired: "Sign in to Claude again, then retry.",
    prompt_too_large: "That list is too long. Split it into two parts.",
    bad_key: "Your Anthropic API key was rejected. Check it in Settings (gear icon).",
    network: "Couldn't reach the Anthropic API. Check your internet connection."
  })[code] || "Something went wrong reading that. Try again.";
}

/* ---------- tabs ---------- */
function showTab(t) {
  ui.tab = t; saveUi();
  $$(".tab").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
  $$("section.panel").forEach(p => p.hidden = p.dataset.panel !== t);
  if (t === "reports") renderReports();
  if (t === "activity") renderLog();
}
$$(".tab").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));

function setRmode(m) {
  if (m === "photo" && !imagesOk && loaded) m = "text";
  ui.rmode = m; saveUi();
  $$("[data-rmode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.rmode === m)));
  $$("[data-rpane]").forEach(p => p.hidden = p.dataset.rpane !== m);
}
function setSmode(m) {
  ui.smode = m; saveUi();
  $$("[data-smode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.smode === m)));
  $$("[data-spane]").forEach(p => p.hidden = p.dataset.spane !== m);
}
$$("[data-rmode]").forEach(b => b.addEventListener("click", () => setRmode(b.dataset.rmode)));
$$("[data-smode]").forEach(b => b.addEventListener("click", () => setSmode(b.dataset.smode)));

/* ---------- stock view ---------- */
$("#q").addEventListener("input", () => { if (ui.tab !== "stock") showTab("stock"); renderStock(); });
$("#f-dept").addEventListener("change", renderStock);
$("#f-sort").addEventListener("change", renderStock);

function renderHeader() {
  const its = allItems();
  const units = its.reduce((a, i) => a + (i.qty || 0), 0);
  $("#hdr-total").innerHTML = loaded ? `<span class="num">${fmtN(its.length)}</span> items · <span class="num">${fmtN(units)}</span> units` : "Loading…";
  const fd = $("#f-dept"), cur = fd.value;
  fd.innerHTML = '<option value="">All departments</option>' + usedDepts().map(d => `<option${d === cur ? " selected" : ""}>${esc(d)}</option>`).join("");
  $("#dl-names").innerHTML = its.map(i => `<option value="${esc(i.name)}">${esc(i.dept)} · ${i.qty} on hand</option>`).join("");
  $("#dl-depts").innerHTML = depts().map(d => `<option value="${esc(d)}"></option>`).join("");
}

function renderStock() {
  const wrap = $("#stock-wrap");
  const q = norm($("#q").value);
  const fd = $("#f-dept").value, sort = $("#f-sort").value;
  let list = allItems();
  if (fd) list = list.filter(i => (i.dept || "Unassigned") === fd);
  if (q) list = list.filter(i => norm(i.name).includes(q) || norm(i.dept).includes(q));
  const byName = (a, b) => a.name.localeCompare(b.name);
  if (sort === "name") list.sort(byName);
  else if (sort === "low") list.sort((a, b) => a.qty - b.qty || byName(a, b));
  else if (sort === "recent") list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  else list.sort((a, b) => (a.dept || "").localeCompare(b.dept || "") || byName(a, b));

  // search hit card
  const hit = $("#hit");
  if (q && list.length) {
    const exact = list.find(i => norm(i.name) === q) || (list.length === 1 ? list[0] : null);
    if (exact) {
      hit.hidden = false;
      hit.className = "hit";
      hit.innerHTML = `<span class="big">${fmtN(exact.qty)}</span><div><div class="nm">${esc(exact.name)}${statusPill(exact.qty)}</div><div class="hint">${esc(exact.dept)} · units in backstock · updated ${ago(exact.updatedAt)}</div></div>`;
    } else {
      hit.hidden = false; hit.className = "hit";
      const u = list.reduce((a, i) => a + i.qty, 0);
      hit.innerHTML = `<span class="big">${fmtN(list.length)}</span><div><div class="nm">matching items</div><div class="hint"><span class="num">${fmtN(u)}</span> units between them</div></div>`;
    }
  } else hit.hidden = true;

  if (!loaded) { wrap.innerHTML = `<div class="empty">Loading inventory…</div>`; return; }
  if (!items.size) {
    wrap.innerHTML = `<div class="empty"><h3>No backstock yet</h3><p>Set up your departments, then add items one by one or receive a whole delivery at once.</p>${canWrite ? `<div class="btnrow"><button class="btn" data-go="dept">+ Add department</button><button class="btn" data-go="item">+ Add item</button><button class="btn primary" data-go="receive">Receive a delivery</button></div>${depts().length ? `<p class="hint">Departments so far: ${depts().map(esc).join(", ")}</p>` : ""}` : ""}</div>`;
    wrap.querySelector('[data-go="receive"]')?.addEventListener("click", () => showTab("receive"));
    wrap.querySelector('[data-go="dept"]')?.addEventListener("click", openDepts);
    wrap.querySelector('[data-go="item"]')?.addEventListener("click", () => openEdit(null));
    return;
  }
  if (!list.length) { wrap.innerHTML = `<div class="empty"><h3>No match</h3><p>Nothing in backstock matches “${esc($("#q").value)}”.</p></div>`; return; }

  const grouped = sort === "dept";
  let rows = "", lastD = null;
  for (const i of list) {
    if (grouped && i.dept !== lastD) {
      lastD = i.dept;
      const g = list.filter(x => x.dept === lastD);
      rows += `<tr class="grp"><td colspan="4">${esc(lastD || "Unassigned")}<span class="num">${g.length} items · ${fmtN(g.reduce((a, x) => a + x.qty, 0))} units</span></td></tr>`;
    }
    rows += `<tr data-id="${esc(i.id)}" style="cursor:${canWrite ? "pointer" : "default"}">
      <td><span class="item-name">${esc(i.name)}</span>${statusPill(i.qty)}${grouped ? "" : `<div><span class="dept">${esc(i.dept)}</span></div>`}</td>
      <td class="q">${fmtN(i.qty)}</td>
      <td class="when hide-sm">${ago(i.updatedAt)}</td>
      <td style="text-align:right;width:1%">${canWrite ? `<button class="btn sm" data-edit="${esc(i.id)}">Edit</button>` : ""}</td></tr>`;
  }
  wrap.innerHTML = `<table><thead><tr><th>Item</th><th class="q">On hand</th><th class="hide-sm">Updated</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  if (canWrite) wrap.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", () => openEdit(tr.dataset.id)));
}

/* ---------- edit modal ---------- */
function closeModal() { $("#modal-root").innerHTML = ""; }
function openEdit(id) {
  const it = id ? items.get(id) : null;
  if (id && !it) return;
  $("#modal-root").innerHTML = `<div class="scrim" id="scrim"><form class="modal" id="ed-form">
    <h3 style="font-size:20px">${it ? "Edit item" : "Add an item"}</h3>
    <label class="field" for="ed-name"><span class="label">Name</span><input id="ed-name" required value="${esc(it?.name || "")}" autocomplete="off"></label>
    <label class="field" for="ed-dept"><span class="label">Department</span><select id="ed-dept" required>${deptOptions(it?.dept || "")}</select></label>
    <div class="field"><span class="label">Quantity in backstock</span>
      <div class="stepper"><button type="button" class="icon-btn" data-step="-1" aria-label="Minus one">−</button>
      <input id="ed-qty" type="number" min="0" step="1" inputmode="numeric" required value="${it ? it.qty : 0}" aria-label="Quantity">
      <button type="button" class="icon-btn" data-step="1" aria-label="Plus one">+</button></div></div>
    <div class="actions" style="justify-content:space-between">
      ${it ? '<button type="button" class="btn danger" id="ed-del">Delete</button>' : "<span></span>"}
      <div class="actions"><button type="button" class="btn" id="ed-cancel">Cancel</button><button type="submit" class="btn primary">Save</button></div>
    </div></form></div>`;
  const qty = $("#ed-qty");
  wireDeptSelect($("#ed-dept"));
  $$("[data-step]").forEach(b => b.addEventListener("click", () => { qty.value = Math.max(0, (parseInt(qty.value, 10) || 0) + Number(b.dataset.step)); }));
  $("#ed-cancel").addEventListener("click", closeModal);
  $("#scrim").addEventListener("click", e => { if (e.target.id === "scrim") closeModal(); });
  (it ? qty : $("#ed-name")).focus();
  const del = $("#ed-del");
  if (del) del.addEventListener("click", async () => {
    if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = "Tap again to delete"; return; }
    del.disabled = true;
    try {
      await db.doc("items/" + it.id).delete();
      await addLog("delete", [{ name: it.name, dept: it.dept, qty: it.qty, before: it.qty, after: 0 }]);
      closeModal(); toast(`Deleted ${it.name}`);
    } catch (e) { del.disabled = false; toast(dbErr(e)); }
  });
  $("#ed-form").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("#ed-name").value.trim(), dept = $("#ed-dept").value.trim(), q = Math.max(0, parseInt(qty.value, 10) || 0);
    if (!name) return;
    if (!dept || dept === "__new") { toast("Choose a department, or pick “+ New department…”."); return; }
    if (!it) {
      const dup = findItem(name, dept, true);
      if (dup) { toast(`${dup.name} already exists in ${dup.dept}. Edit it instead.`); return; }
    }
    const sb = e.submitter || $("#ed-form button[type=submit]"); sb.disabled = true;
    try {
      await ensureDept(dept);
      const now = Date.now();
      if (it) {
        await db.doc("items/" + it.id).update({ name, dept, qty: q, updatedAt: now });
        await addLog("edit", [{ name, dept, qty: q - it.qty, before: it.qty, after: q, note: (it.name !== name || it.dept !== dept) ? `was ${it.name} · ${it.dept}` : "" }]);
      } else {
        await db.collection("items").doc().set({ name, dept, qty: q, createdAt: now, updatedAt: now });
        await addLog("edit", [{ name, dept, qty: q, before: 0, after: q, note: "added by hand" }]);
      }
      closeModal(); toast(`Saved ${name}: ${q} on hand`);
    } catch (err) { sb.disabled = false; toast(dbErr(err)); }
  });
}
$("#btn-new").addEventListener("click", () => openEdit(null));
$("#btn-dept").addEventListener("click", openDepts);
document.addEventListener("keydown", e => { if (e.key !== "Escape") return; if ($("#scrim2")) $("#nd-cancel").click(); else closeModal(); });

function dbErr(e) {
  if (e?.code === "invalid_argument") return "You don't have permission to change this inventory.";
  if (e?.code === "quota_exceeded") return "Storage is full. Delete old items to make room.";
  return "Couldn't save. Check your connection and try again.";
}

/* ---------- applying changes ---------- */
async function addLog(type, lines) {
  try { await db.collection("log").doc().set({ at: Date.now(), type, by: myId || "", lines: lines.slice(0, 300) }); } catch (e) {}
}
function mergeLines(lines) {
  const m = new Map();
  for (const l of lines) {
    const k = norm(l.name) + "|" + norm(l.dept);
    if (m.has(k)) m.get(k).qty += l.qty; else m.set(k, { ...l });
  }
  return [...m.values()];
}
// mode: "receive" adds, "shelf" subtracts. Returns {ok, msg}
async function applyLines(mode, raw) {
  const lines = mergeLines(raw.filter(l => l.name && l.qty > 0));
  if (!lines.length) return { ok: false, msg: "Add at least one item with a quantity." };
  // validate shelf
  if (mode === "shelf") {
    const need = new Map();
    for (const l of lines) {
      const it = findItem(l.name, l.dept, false);
      if (!it) return { ok: false, msg: `“${l.name}” isn't in backstock.` };
      need.set(it.id, (need.get(it.id) || 0) + l.qty);
    }
    for (const [id, q] of need) { const it = items.get(id); if (q > it.qty) return { ok: false, msg: `Only ${it.qty} ${it.name} in backstock (you entered ${q}).` }; }
  }
  const logLines = [], now = Date.now();
  for (const l of lines) {
    if (mode === "receive") {
      const it = findItem(l.name, l.dept, !!l.dept);
      if (it) {
        const after = it.qty + l.qty;
        await db.doc("items/" + it.id).update({ qty: after, updatedAt: now });
        it.qty = after; // keep local map current within this batch
        logLines.push({ name: it.name, dept: it.dept, qty: l.qty, before: after - l.qty, after });
      } else {
        const dept = (l.dept || "").trim() || "Unassigned";
        await ensureDept(dept);
        const ref = db.collection("items").doc();
        await ref.set({ name: l.name.trim(), dept, qty: l.qty, createdAt: now, updatedAt: now });
        items.set(ref.id, { id: ref.id, name: l.name.trim(), dept, qty: l.qty, updatedAt: now });
        logLines.push({ name: l.name.trim(), dept, qty: l.qty, before: 0, after: l.qty, note: "new item" });
      }
    } else {
      const it = findItem(l.name, l.dept, false);
      const after = it.qty - l.qty;
      await db.doc("items/" + it.id).update({ qty: after, updatedAt: now });
      it.qty = after;
      logLines.push({ name: it.name, dept: it.dept, qty: l.qty, before: after + l.qty, after });
    }
  }
  await addLog(mode, logLines);
  const units = lines.reduce((a, l) => a + l.qty, 0);
  return { ok: true, msg: mode === "receive" ? `Added ${fmtN(units)} units across ${lines.length} items` : `Moved ${fmtN(units)} units to the shelf` };
}

/* ---------- form entry rows ---------- */
function addFormRow(mode, preset) {
  const box = $(mode === "receive" ? "#r-rows" : "#s-rows");
  const r = document.createElement("div");
  r.className = "frow" + (mode === "shelf" ? " shelf" : "");
  r.innerHTML = `<input class="f-name" list="dl-names" placeholder="${mode === "shelf" ? "Start typing an item" : "Item name"}" aria-label="Item name" autocomplete="off">
    ${mode === "receive" ? `<select class="f-dept" aria-label="Department">${deptOptions(preset?.dept || "")}</select>` : ""}
    <input class="f-qty" type="number" min="1" step="1" inputmode="numeric" placeholder="Qty" aria-label="Quantity">
    <button type="button" class="icon-btn f-del" aria-label="Remove row">×</button><div class="f-hint"></div>`;
  const nm = r.querySelector(".f-name"), dp = r.querySelector(".f-dept"), qt = r.querySelector(".f-qty"), hint = r.querySelector(".f-hint");
  if (preset) { nm.value = preset.name || ""; qt.value = preset.qty || ""; }
  const upd = () => {
    const it = findItem(nm.value, dp?.value, false);
    hint.classList.remove("err");
    if (mode === "receive") {
      if (it && dp && !dp.value) { dp.innerHTML = deptOptions(it.dept); dp.dataset.prev = dp.value; }
      hint.textContent = it ? `${it.qty} on hand now` : (nm.value.trim() ? (dp && !dp.value ? "New item — choose a department" : "New item") : "");
    } else {
      const q = parseInt(qt.value, 10) || 0;
      if (!nm.value.trim()) hint.textContent = "";
      else if (!it) { hint.textContent = "Not in backstock"; hint.classList.add("err"); }
      else if (q > it.qty) { hint.textContent = `Only ${it.qty} on hand`; hint.classList.add("err"); }
      else hint.textContent = `${it.qty} on hand${q ? ` → ${it.qty - q} after` : ""}`;
    }
  };
  nm.addEventListener("change", upd); nm.addEventListener("input", upd); qt.addEventListener("input", upd);
  if (dp) wireDeptSelect(dp, upd);
  r.querySelector(".f-del").addEventListener("click", () => { r.remove(); if (!box.children.length) addFormRow(mode); });
  box.appendChild(r); upd();
  return r;
}
function readRows(mode) {
  return [...$(mode === "receive" ? "#r-rows" : "#s-rows").children].map(r => ({
    name: r.querySelector(".f-name").value.trim(),
    dept: r.querySelector(".f-dept")?.value.trim() || "",
    qty: parseInt(r.querySelector(".f-qty").value, 10) || 0
  })).filter(l => l.name || l.qty);
}
function resetRows(mode) { $(mode === "receive" ? "#r-rows" : "#s-rows").innerHTML = ""; addFormRow(mode); addFormRow(mode); }
$("#r-addrow").addEventListener("click", () => addFormRow("receive").querySelector(".f-name").focus());
$("#s-addrow").addEventListener("click", () => addFormRow("shelf").querySelector(".f-name").focus());
for (const mode of ["receive", "shelf"]) {
  $(mode === "receive" ? "#r-form" : "#s-form").addEventListener("submit", async e => {
    e.preventDefault();
    const rows = readRows(mode);
    const bad = rows.find(r => !r.name || r.qty <= 0);
    if (bad) { toast("Each row needs an item name and a quantity of 1 or more."); return; }
    const noDept = mode === "receive" && rows.find(r => !r.dept && !findItem(r.name, "", false));
    if (noDept) { toast(`Choose a department for the new item “${noDept.name}”.`); return; }
    const btn = e.submitter; if (btn) btn.disabled = true;
    try {
      const res = await applyLines(mode, rows);
      toast(res.msg);
      if (res.ok) resetRows(mode);
    } catch (err) { toast(dbErr(err)); }
    if (btn) btn.disabled = false;
  });
}

/* ---------- parsing (Claude + local fallback) ---------- */
function localParse(text) {
  const out = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim().replace(/^[-*•]\s+/, "");
    if (!line) continue;
    let name = line, qty = 1, dept = "";
    let m = line.match(/^(.*?)(?:\s*[,;:\-–]\s*|\s+)(?:x\s*)?(\d+)\s*(?:pcs?|units?|ea|each)?$/i);
    if (m && m[1].trim()) { name = m[1]; qty = +m[2]; }
    else if ((m = line.match(/^(\d+)\s*(?:x|×|pcs?|units?)?\s+(.+)$/i))) { qty = +m[1]; name = m[2]; }
    const parts = name.split(/\s*[,|;]\s*/).filter(Boolean);
    if (parts.length >= 2) { name = parts[0]; dept = parts[1]; }
    name = name.replace(/[\s,;:\-–]+$/, "").trim();
    if (!dept) { const it = findItem(name, "", false); if (it) { name = it.name; dept = it.dept; } }
    if (name) out.push({ name, dept, qty });
  }
  return out;
}
async function aiParse(mode, { text, images, signal }) {
  const catalog = allItems().slice(0, 600).map(i => `${i.name} | ${i.dept}`).join("\n");
  const source = images ? "photo(s) of a delivery: a packing slip, invoice, or the products themselves" : "a stock list typed quickly by a store worker";
  const prompt = `You are reading ${source} for a store's backstock (stockroom) inventory.
Task: ${mode === "receive" ? "list every product that was received and how many units came in." : "list every product being moved from backstock to the sales floor shelf and how many units."}

Existing backstock items (name | department):
${catalog || "(none yet)"}

Known departments: ${depts().join(", ") || "(none yet; choose short, sensible ones such as Dairy or Produce)"}

Rules:
- When a line or product refers to an existing item, use that item's exact name and department.
- Otherwise write a clear, short product name and choose the best department from the known list, or a sensible new one.
- qty is a whole number of units. If both a case count and a pack size are given (for example "2 cs x 12"), multiply them.
- Skip prices, totals, addresses, order numbers and anything that is not a product.
Reply with only a JSON array, for example: [{"name":"Whole Milk 1 gal","dept":"Dairy","qty":12}]
${text ? "\nThe list:\n" + text.slice(0, 20000) : ""}`;
  const res = await sample.json(prompt, { images, signal, cache: false });
  if (!Array.isArray(res)) throw { code: "invalid_json" };
  return res.map(r => ({ name: String(r?.name || "").trim(), dept: String(r?.dept || "").trim(), qty: Math.max(0, Math.round(Number(r?.qty) || 0)) })).filter(r => r.name);
}

/* ---------- review table ---------- */
const reviews = { receive: null, shelf: null };
function showReview(mode, rows, source) {
  reviews[mode] = rows.map(r => ({ ...r }));
  renderReview(mode, source);
  $("#review-" + mode).scrollIntoView({ behavior: "smooth", block: "start" });
}
function rowStatus(mode, r) {
  if (!r.name) return { cls: "err", txt: "Needs a name" };
  if (!(r.qty > 0)) return { cls: "err", txt: "Needs a quantity" };
  if (mode === "receive") {
    const it = findItem(r.name, r.dept, !!r.dept);
    if (it) return { cls: "", txt: `${it.qty} → ${it.qty + r.qty}` };
    if (!r.dept) return { cls: "err", txt: "Choose a department" };
    return { cls: "new", txt: depts().some(d => norm(d) === norm(r.dept)) ? "New item" : "New item + new dept" };
  }
  const it = findItem(r.name, r.dept, false);
  if (!it) return { cls: "err", txt: "Not in backstock" };
  if (r.qty > it.qty) return { cls: "err", txt: `Only ${it.qty} on hand` };
  return { cls: "", txt: `${it.qty} → ${it.qty - r.qty}` };
}
function renderReview(mode, source) {
  const box = $("#review-" + mode), rows = reviews[mode];
  if (!rows) { box.innerHTML = ""; return; }
  if (!rows.length) {
    box.innerHTML = `<div class="review"><div class="review-head"><h3>No items found</h3><button class="btn sm" data-x>Close</button></div><div class="pad hint">Nothing that looks like a product and count came back. Try a clearer photo, or type the list.</div></div>`;
    box.querySelector("[data-x]").onclick = () => { reviews[mode] = null; renderReview(mode); };
    return;
  }
  box.innerHTML = `<div class="review">
    <div class="review-head"><h3>Check ${rows.length} item${rows.length > 1 ? "s" : ""}${source ? ` from ${esc(source)}` : ""}</h3><span class="hint">Fix anything that's wrong, then confirm.</span></div>
    <div class="scroll"><table><thead><tr><th>Item</th>${mode === "receive" ? "<th>Department</th>" : ""}<th class="q">Qty</th><th>Backstock</th><th></th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr data-i="${i}">
      <td style="min-width:160px"><input class="rv-name" list="dl-names" value="${esc(r.name)}" aria-label="Item name"></td>
      ${mode === "receive" ? `<td style="min-width:140px"><select class="rv-dept" aria-label="Department">${deptOptions(r.dept)}</select></td>` : ""}
      <td style="width:90px"><input class="rv-qty" type="number" min="0" step="1" inputmode="numeric" value="${r.qty}" aria-label="Quantity" style="text-align:right;min-width:70px"></td>
      <td class="st"></td>
      <td style="width:1%"><button class="icon-btn" data-rm="${i}" aria-label="Remove row">×</button></td></tr>`).join("")}
    </tbody></table></div>
    <div class="review-foot actions">
      <button class="btn primary" data-ok>${mode === "receive" ? "Add to backstock" : "Remove from backstock"}</button>
      <button class="btn" data-x>Discard</button>
      <span class="status" data-msg></span>
    </div></div>`;
  const refresh = () => {
    let errs = 0, units = 0;
    box.querySelectorAll("tr[data-i]").forEach(tr => {
      const r = rows[+tr.dataset.i]; const s = rowStatus(mode, r);
      const td = tr.querySelector(".st"); td.className = "st " + s.cls; td.textContent = s.txt;
      if (s.cls === "err") errs++; else units += r.qty;
    });
    const ok = box.querySelector("[data-ok]"), msg = box.querySelector("[data-msg]");
    ok.disabled = errs > 0 || !canWrite;
    msg.className = "status" + (errs ? " err" : "");
    msg.textContent = errs ? `${errs} row${errs > 1 ? "s" : ""} need fixing` : `${fmtN(units)} units in total`;
  };
  box.querySelectorAll("tr[data-i]").forEach(tr => {
    const r = rows[+tr.dataset.i];
    tr.querySelector(".rv-name").addEventListener("input", e => { r.name = e.target.value.trim(); refresh(); });
    const ds = tr.querySelector(".rv-dept");
    if (ds) wireDeptSelect(ds, () => { r.dept = ds.value === "__new" ? "" : ds.value; refresh(); });
    tr.querySelector(".rv-qty").addEventListener("input", e => { r.qty = Math.max(0, parseInt(e.target.value, 10) || 0); refresh(); });
  });
  box.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { rows.splice(+b.dataset.rm, 1); renderReview(mode, source); }));
  box.querySelector("[data-x]").addEventListener("click", () => { reviews[mode] = null; renderReview(mode); });
  box.querySelector("[data-ok]").addEventListener("click", async e => {
    e.target.disabled = true;
    try {
      const res = await applyLines(mode, rows);
      toast(res.msg);
      if (res.ok) {
        reviews[mode] = null; renderReview(mode);
        if (mode === "receive") { $("#r-text").value = ""; clearPhotos(); } else $("#s-text").value = "";
      } else { box.querySelector("[data-msg]").textContent = res.msg; e.target.disabled = false; }
    } catch (err) { toast(dbErr(err)); e.target.disabled = false; }
  });
  refresh();
}

/* ---------- text list buttons ---------- */
async function readTextList(mode) {
  const ta = $(mode === "receive" ? "#r-text" : "#s-text"), st = $(mode === "receive" ? "#rtext-status" : "#stext-status");
  const btn = $(mode === "receive" ? "#btn-rtext" : "#btn-stext");
  const text = ta.value.trim();
  if (!text) { st.className = "status err"; st.textContent = "Type at least one item."; ta.focus(); return; }
  st.className = "status";
  if (!sample) { showReview(mode, localParse(text), "your list"); st.textContent = ""; return; }
  btn.disabled = true; st.textContent = "Claude is reading your list…";
  try {
    const rows = await aiParse(mode, { text });
    st.textContent = "";
    showReview(mode, rows, "your list");
  } catch (e) {
    // fall back to the simple line reader so the user is never stuck
    showReview(mode, localParse(text), "your list");
    st.className = "status err";
    st.textContent = (e?.code === "not_granted" || e?.code === "sampling_disabled") ? "Read line by line without Claude. Check the rows below." : errCopy(e?.code) + " Read line by line instead.";
  }
  btn.disabled = false;
}
$("#btn-rtext").addEventListener("click", () => readTextList("receive"));
$("#btn-stext").addEventListener("click", () => readTextList("shelf"));

/* ---------- photos ---------- */
const photoIn = $("#photo-in"), drop = $("#drop");
let photoCtl = null;
function maxPhotos() { return lim?.images?.maxCount || 4; }
function addPhotos(files) {
  for (const f of files) { if (f.type.startsWith("image/") && ui.photos.length < maxPhotos()) ui.photos.push({ f, url: URL.createObjectURL(f) }); }
  renderThumbs();
}
function clearPhotos() { ui.photos.forEach(p => URL.revokeObjectURL(p.url)); ui.photos = []; renderThumbs(); }
function renderThumbs() {
  $("#thumbs").innerHTML = ui.photos.map((p, i) => `<figure><img src="${p.url}" alt="Delivery photo ${i + 1}"><button type="button" data-rp="${i}" aria-label="Remove photo">×</button></figure>`).join("");
  $$("[data-rp]").forEach(b => b.addEventListener("click", () => { const [p] = ui.photos.splice(+b.dataset.rp, 1); URL.revokeObjectURL(p.url); renderThumbs(); }));
  $("#btn-photo-read").disabled = !ui.photos.length || !canWrite;
  $("#photo-status").textContent = ui.photos.length ? `${ui.photos.length} photo${ui.photos.length > 1 ? "s" : ""} ready` : "";
  $("#photo-status").className = "status";
}
photoIn.addEventListener("change", () => { addPhotos(photoIn.files); photoIn.value = ""; });
drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); addPhotos(e.dataTransfer.files); });
$("#btn-photo-stop").addEventListener("click", () => photoCtl?.abort());
$("#btn-photo-read").addEventListener("click", async () => {
  if (!sample || !ui.photos.length) return;
  const st = $("#photo-status"), btn = $("#btn-photo-read"), stop = $("#btn-photo-stop");
  photoCtl = new AbortController();
  btn.disabled = true; stop.hidden = false; st.className = "status"; st.textContent = "Claude is reading the delivery… this can take up to a minute.";
  try {
    const rows = await aiParse("receive", { images: ui.photos.map(p => p.f), signal: photoCtl.signal });
    st.textContent = "";
    showReview("receive", rows, "the photo");
  } catch (e) {
    if (e?.code !== "cancelled") { st.className = "status err"; st.textContent = errCopy(e?.code); } else st.textContent = "Stopped.";
  }
  btn.disabled = !ui.photos.length; stop.hidden = true;
});

/* ---------- reports ---------- */
function deptSummary() {
  const m = new Map();
  for (const i of allItems()) {
    const d = i.dept || "Unassigned";
    if (!m.has(d)) m.set(d, { dept: d, items: 0, units: 0, out: 0, low: 0 });
    const s = m.get(d); s.items++; s.units += i.qty; if (i.qty <= 0) s.out++; else if (i.qty <= LOW) s.low++;
  }
  return [...m.values()].sort((a, b) => a.dept.localeCompare(b.dept));
}
function reportItems() {
  return allItems().filter(i => !ui.repDept || (i.dept || "Unassigned") === ui.repDept)
    .sort((a, b) => (a.dept || "").localeCompare(b.dept || "") || a.name.localeCompare(b.name));
}
function renderReports() {
  const sum = deptSummary();
  if (ui.repDept && !sum.find(s => s.dept === ui.repDept)) ui.repDept = "";
  const list = reportItems();
  const units = list.reduce((a, i) => a + i.qty, 0);
  const out = list.filter(i => i.qty <= 0).length, low = list.filter(i => i.qty > 0 && i.qty <= LOW).length;
  $("#rep-stats").innerHTML = [
    ["Scope", ui.repDept || "All departments", false],
    ["Items", fmtN(list.length), true], ["Units on hand", fmtN(units), true],
    ["Out of stock", fmtN(out), true], [`Low (${LOW} or fewer)`, fmtN(low), true]
  ].map(([k, v, n]) => `<div class="card stat"><div class="label">${k}</div><div class="v"${n ? "" : ' style="font-family:var(--f-display);font-size:20px;padding-top:4px"'}>${esc(v)}</div></div>`).join("");
  $("#rep-depts").innerHTML = (sum.length > 1 ? `<button class="card drow" data-d="" aria-pressed="${!ui.repDept}"><span class="n">All departments</span><span class="m num">${fmtN(sum.reduce((a, s) => a + s.units, 0))} units</span></button>` : "") +
    sum.map(s => `<button class="card drow" data-d="${esc(s.dept)}" aria-pressed="${ui.repDept === s.dept}"><span><span class="n">${esc(s.dept)}</span><br><span class="m">${s.items} items${s.out ? ` · ${s.out} out` : ""}${s.low ? ` · ${s.low} low` : ""}</span></span><span class="m num">${fmtN(s.units)} units</span></button>`).join("");
  $$("#rep-depts [data-d]").forEach(b => b.addEventListener("click", () => { ui.repDept = b.dataset.d; saveUi(); renderReports(); }));
  const tw = $("#rep-table");
  if (!list.length) { tw.innerHTML = `<div class="empty"><h3>Nothing to report yet</h3><p>Receive a delivery and the report fills in by department.</p></div>`; $("#btn-pdf").disabled = true; return; }
  $("#btn-pdf").disabled = !downloads;
  let rows = "", last = null;
  for (const i of list) {
    if (i.dept !== last) { last = i.dept; const s = sum.find(x => x.dept === (last || "Unassigned")); rows += `<tr class="grp"><td colspan="3">${esc(last || "Unassigned")}<span class="num">${s.items} items · ${fmtN(s.units)} units</span></td></tr>`; }
    rows += `<tr><td><span class="item-name">${esc(i.name)}</span>${statusPill(i.qty)}</td><td class="q">${fmtN(i.qty)}</td><td class="when">${i.updatedAt ? new Date(i.updatedAt).toLocaleDateString() : "—"}</td></tr>`;
  }
  tw.innerHTML = `<table><thead><tr><th>Item</th><th class="q">Qty</th><th>Last updated</th></tr></thead><tbody>${rows}</tbody></table>`;
}
$("#btn-pdf").addEventListener("click", async () => {
  const st = $("#pdf-status"); st.className = "status";
  if (!window.jspdf?.jsPDF) { st.className = "status err"; st.textContent = "The PDF tool didn't load. Reload the page and try again."; return; }
  if (!downloads) { st.className = "status err"; st.textContent = "Downloads aren't available in this view."; return; }
  const list = reportItems(), sum = deptSummary();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const now = new Date();
  const units = list.reduce((a, i) => a + i.qty, 0);
  doc.setFont("helvetica", "bold"); doc.setFontSize(18);
  doc.text("Backstock Inventory Report", 40, 52);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(90);
  doc.text(`${ui.repDept || "All departments"}  ·  ${list.length} items  ·  ${units.toLocaleString()} units  ·  ${now.toLocaleString()}`, 40, 70);
  doc.setFillColor(242, 194, 48); doc.rect(40, 80, 532, 3, "F");
  const body = []; let last = null;
  for (const i of list) {
    const d = i.dept || "Unassigned";
    if (d !== last) {
      last = d; const s = sum.find(x => x.dept === d);
      body.push([{ content: `${d.toUpperCase()}   —   ${s.items} items, ${s.units.toLocaleString()} units`, colSpan: 4, styles: { fillColor: [228, 232, 237], fontStyle: "bold", textColor: [22, 32, 43] } }]);
    }
    body.push([i.name, { content: String(i.qty), styles: { halign: "right", fontStyle: "bold" } }, i.qty <= 0 ? "OUT" : i.qty <= LOW ? "LOW" : "", i.updatedAt ? new Date(i.updatedAt).toLocaleDateString() : ""]);
  }
  doc.autoTable({
    startY: 96, head: [["Item", "Qty", "Status", "Last updated"]], body,
    styles: { font: "helvetica", fontSize: 10, cellPadding: 5, textColor: [22, 32, 43], lineColor: [212, 219, 227], lineWidth: 0.5 },
    headStyles: { fillColor: [22, 32, 43], textColor: 255, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: "auto" }, 1: { cellWidth: 60, halign: "right" }, 2: { cellWidth: 60 }, 3: { cellWidth: 90 } },
    didParseCell: d => { if (d.section === "body" && d.column.index === 2 && d.cell.raw === "OUT") d.cell.styles.textColor = [184, 50, 47]; if (d.section === "body" && d.column.index === 2 && d.cell.raw === "LOW") d.cell.styles.textColor = [154, 93, 0]; },
    didDrawPage: () => { doc.setFontSize(9); doc.setTextColor(120); doc.text(`Page ${doc.internal.getNumberOfPages()}`, 572, 770, { align: "right" }); },
    margin: { left: 40, right: 40 }
  });
  const stamp = now.toISOString().slice(0, 10);
  const slug = ui.repDept ? "-" + ui.repDept.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "";
  try {
    await downloads.save({ filename: `backstock-report${slug}-${stamp}.pdf`, data: doc.output("blob") });
    st.textContent = "Report saved.";
  } catch (e) {
    if (e?.code === "declined") st.textContent = "";
    else { st.className = "status err"; st.textContent = e?.code === "rate_limited" ? "A save prompt is already open." : "Couldn't save the PDF here."; }
  }
});

/* ---------- activity ---------- */
function renderLog() {
  const el = $("#log");
  if (!logs.length) { el.innerHTML = `<div class="empty"><h3>No activity yet</h3><p>Deliveries, shelf pulls and edits are listed here as they happen.</p></div>`; return; }
  const label = { receive: "Received", shelf: "To shelf", edit: "Edited", delete: "Deleted" };
  el.innerHTML = logs.map(l => {
    const lines = Array.isArray(l.lines) ? l.lines : [];
    const units = lines.reduce((a, x) => a + Math.abs(x.qty || 0), 0);
    const head = l.type === "receive" || l.type === "shelf" ? `${lines.length} item${lines.length !== 1 ? "s" : ""} · <span class="num">${fmtN(units)}</span> units` : esc(lines[0]?.name || "");
    return `<details><summary><span class="tag ${esc(l.type)}">${label[l.type] || esc(l.type)}</span><span style="flex:1;min-width:0">${head}</span><span class="when">${ago(l.at)}</span></summary>
      <ul>${lines.map(x => `<li><span>${esc(x.name)} <span class="dept">${esc(x.dept)}</span>${x.note ? ` <span class="hint">${esc(x.note)}</span>` : ""}</span><span class="num">${l.type === "shelf" ? "−" : l.type === "receive" ? "+" : ""}${l.type === "edit" || l.type === "delete" ? `${x.before} → ${x.after}` : fmtN(x.qty)}</span></li>`).join("")}</ul></details>`;
  }).join("");
}

/* ---------- boot ---------- */
function renderAll() {
  renderHeader(); renderStock(); refreshDeptSelects(); renderDeptList();
  if (ui.tab === "reports") renderReports();
  ["receive", "shelf"].forEach(m => { if (reviews[m]) { /* keep inputs; refresh statuses */ const b = $("#review-" + m); b.querySelectorAll("input")[0]?.dispatchEvent(new Event("input")); } });
  $$("#r-rows .f-name, #s-rows .f-name").forEach(i => i.dispatchEvent(new Event("change")));
}
function applyWriteGate() {
  $("#ro-banner").hidden = canWrite || !db;
  $$(".w-only").forEach(e => e.hidden = !canWrite);
  ["receive", "shelf"].forEach(t => { const b = document.querySelector(`.tab[data-tab="${t}"]`); b.hidden = !canWrite; });
  if (!canWrite && (ui.tab === "receive" || ui.tab === "shelf")) showTab("stock");
}

resetRows("receive"); resetRows("shelf");
setSmode(ui.smode); setRmode(ui.rmode); showTab(ui.tab);
$("#f-sort").value = "dept";
renderAll();

(async () => {
  const c = window.claude;
  if (!c?.use) { loaded = true; $("#offline-banner").hidden = false; canWrite = false; applyWriteGate(); renderAll(); return; }
  [db, sample, downloads, user] = await Promise.all(["db", "sample", "downloads", "user"].map(n => c.use(n).catch(() => null)));
  if (user) {
    try { myId = await user.id(); } catch (e) {}
    try { const w = await user.can("data.write"); if (w === false) canWrite = false; } catch (e) {}
  }
  if (sample) {
    try { lim = await sample.limits(); imagesOk = !!lim?.images; } catch (e) { imagesOk = false; }
  }
  if (!imagesOk) {
    const pb = document.querySelector('[data-rmode="photo"]');
    pb.hidden = true;
  }
  if (lim?.images?.mediaTypes) photoIn.accept = lim.images.mediaTypes.join(",");
  if (!db) { loaded = true; canWrite = false; $("#offline-banner").hidden = false; applyWriteGate(); renderAll(); return; }
  applyWriteGate();
  setRmode(ui.rmode);
  db.collection("items").onSnapshot(snap => {
    items = new Map(snap.docs.map(d => { const v = d.data(); return [d.id, { id: d.id, name: String(v.name || ""), dept: String(v.dept || "Unassigned"), qty: Math.max(0, Number(v.qty) || 0), updatedAt: v.updatedAt || 0 }]; }));
    loaded = true; renderAll();
  }, () => { loaded = true; $("#offline-banner").hidden = false; renderAll(); });
  db.collection("depts").onSnapshot(snap => {
    deptDocs = new Map(snap.docs.map(d => [d.id, { id: d.id, name: String(d.data().name || "").trim() }]).filter(([, v]) => v.name));
    renderAll();
  }, () => {});
  db.collection("log").orderBy("at", "desc").limit(40).onSnapshot(snap => {
    logs = snap.docs.map(d => d.data());
    if (ui.tab === "activity") renderLog();
  }, () => {});
})();
})();
