/* Notedy cloud PWA (GitHub Pages). Talks to the owner's Google Apps Script web app; no server of ours, nothing stored here.
   Config (script URL + secret token) lives only in this browser's localStorage. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
  var CFG_KEY = "notedy.cloud.cfg";
  var URL_OK = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_\-]+\/exec$/, TOKEN_OK = /^[a-f0-9]{64}$/, PIN_OK = /^\d{6}$/;
  var PIN_CODES = { pin_wrong: 1, pin_required: 1, pin_setup: 1, locked: 1 };
  var MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  var WEEK = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
  var cfg = null, view = "office", office = null, ofLoad = null, ofAssets = null, ofLayout = null, ofBadges = {}, ofToday = null, ofSpirit = null, chatBusy = false, ofActs = {}, day = null, status = {}, busy = false, groupsMap = {}, bulk = { armed: false, t: null, last: null };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(t) { var e = $("toast"); e.textContent = t; e.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(function () { e.classList.remove("on"); }, 2600); }

  /* ---------- config ---------- */
  function loadCfg() { try { var c = JSON.parse(localStorage.getItem(CFG_KEY) || "null"); return c && URL_OK.test(c.u) && TOKEN_OK.test(c.t) ? { u: c.u, t: c.t, p: PIN_OK.test(c.p || "") ? c.p : "" } : null; } catch (e) { return null; } }
  function idbSet(k, v) {                                       // the service worker cannot read localStorage: keep a copy of the config in IndexedDB
    try {
      var rq = indexedDB.open("notedy", 1); rq.onupgradeneeded = function () { rq.result.createObjectStore("kv"); };
      rq.onsuccess = function () { try { var st = rq.result.transaction("kv", "readwrite").objectStore("kv"); if (v == null) st["delete"](k); else st.put(v, k); } catch (e) { /* no push peek, generic text */ } };
    } catch (e) { /* ignore */ }
  }
  function clearCfgStore() { try { localStorage.removeItem(CFG_KEY); } catch (e) { /* ignore */ } idbSet("cfg", null); }
  function saveCfg(c) { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); idbSet("cfg", c); return true; } catch (e) { return false; } }
  function setupFromHash() {                                   // #setup=<base64url({u,t})> from the owner's "setup" sheet
    var m = /[#&]setup=([A-Za-z0-9_\-=]+)/.exec(location.hash); if (!m) return null;
    try {
      var o = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, "+").replace(/_/g, "/")))));
      if (URL_OK.test(o.u) && TOKEN_OK.test(o.t)) return { u: o.u, t: o.t, p: "" };    // only a Google script URL is accepted
    } catch (e) { /* fall through */ }
    return null;
  }

  /* ---------- API ---------- */
  function api(action, payload, ms) {
    var body = Object.assign({ token: cfg.t, pin: cfg.p || undefined, action: action }, payload || {}), ctrl = new AbortController(), to = setTimeout(function () { ctrl.abort(); }, ms || 45000);
    return fetch(cfg.u, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "text/plain;charset=utf-8" }, signal: ctrl.signal })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        clearTimeout(to);
        if (j.ok === false) {
          var msg = j.error === "unauthorized" ? "ลิงก์ตั้งค่าไม่ถูกต้องหรือหมดอายุ เปิดลิงก์ใหม่จากชีต setup"
            : j.error === "pin_wrong" ? "รหัสไม่ถูกต้อง (เหลืออีก " + j.left + " ครั้ง)"
            : j.error === "locked" ? "ใส่รหัสผิดหลายครั้ง ล็อกไว้อีกประมาณ " + j.minutes + " นาที"
            : PIN_CODES[j.error] ? "ต้องใส่รหัสก่อน" : (j.error || "ผิดพลาด");
          var er = new Error(msg); er.code = j.error; throw er;
        }
        return j;
      })
      .catch(function (e) { clearTimeout(to); if (e.code) throw e; throw new Error(e.name === "AbortError" ? "หมดเวลา ลองใหม่อีกครั้ง" : /Failed to fetch|NetworkError|Load failed/.test(e.message) ? "ต่ออินเทอร์เน็ตหรือสคริปต์ไม่ได้" : e.message); });
  }

  /* ---------- dates ---------- */
  function todayStr() { var t = new Date(), th = new Date(t.getTime() + (7 * 60 + t.getTimezoneOffset()) * 60000); return th.getFullYear() + "-" + p2(th.getMonth() + 1) + "-" + p2(th.getDate()); }
  function addDays(s, n) { var d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); }
  function shortDate(s) { var p = s.split("-"); return +p[2] + " " + MON[+p[1] - 1]; }
  function longDate(s) { var d = new Date(s + "T12:00:00"); return "วัน" + WEEK[d.getDay()] + "ที่ " + shortDate(s) + " " + d.getFullYear(); }
  function hhmm(iso) { try { return new Date(iso).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }
  function dayTime(iso) { try { var d = new Date(iso), th = new Date(d.getTime() + 7 * 3600e3); return shortDate(th.getUTCFullYear() + "-" + p2(th.getUTCMonth() + 1) + "-" + p2(th.getUTCDate())) + " " + hhmm(iso); } catch (e) { return ""; } }

  /* ---------- folder cards (the folder is the unit; its files are details) ---------- */
  function groupFiles(files) {
    var by = {}, order = [];
    files.forEach(function (f) {
      var gid = f.folder_id ? "d:" + f.folder_id : "f:" + f.id, g = by[gid];
      if (!g) { g = by[gid] = { gid: gid, folder: !!f.folder_id, name: f.folder_id ? f.folder_name : f.name, path: f.folder_path || "", link: f.folder_id ? f.folder_link : f.link, files: [] }; order.push(gid); }
      g.files.push(f);
    });
    return order.map(function (k) { return by[k]; });
  }
  function groupDecision(g) { var d = {}; g.files.forEach(function (f) { d[f.decision || "pending"] = 1; }); if (d.pending) return "pending"; var k = Object.keys(d); return k.length === 1 ? k[0] : "mixed"; }
  function tagHtml(dec, mini) {
    var c = dec === "work" ? "y" : dec === "not-work" ? "n" : dec === "mixed" ? "m" : "p", t = dec === "work" ? "เป็นงาน" : dec === "not-work" ? "ไม่ใช่งาน" : dec === "mixed" ? "ผสม" : "รอตรวจ";
    return '<span class="ntag ' + c + (mini ? " mini" : "") + '">' + t + "</span>";
  }
  function actsHtml(dec) {
    return dec === "pending"
      ? '<select class="catSel" aria-label="หมวดงาน">' + catOpts() + '</select><div class="nbtns"><button class="nbig ok" data-nd="work" type="button">✓ เป็นงาน</button><button class="nbig no" data-nd="not-work" type="button">✕ ไม่ใช่งาน</button></div>'
      : '<div class="nundo"><button class="nlink" data-nd="pending" type="button">↩ แก้การตัดสิน</button></div>';
  }
  function subRow(f) { return '<div class="nsub"><span class="nsn">' + esc(f.name) + "<small> " + esc(hhmm(f.modifiedTime)) + "</small></span>" + tagHtml(f.decision || "pending", true) + (f.link ? '<a href="' + esc(f.link) + '" target="_blank" rel="noopener">เปิด</a>' : "") + "</div>"; }
  function groupCard(g, withDate) {
    groupsMap[g.gid] = g.files.map(function (f) { return { file_id: f.id, version: f.version }; });
    var dec = groupDecision(g), times = g.files.map(function (f) { return f.modifiedTime; }).sort(), last = times[times.length - 1];
    var sub = g.folder ? g.files.length + " ไฟล์ · " + (withDate ? "แก้ล่าสุด " + dayTime(last) : hhmm(times[0]) + (times.length > 1 ? "–" + hhmm(last) : "")) + (g.path ? " · " + g.path : "") : (withDate ? dayTime(last) : hhmm(last));
    var details = g.folder ? '<details class="ndet"><summary>ดูไฟล์ในแฟ้ม (' + g.files.length + ")</summary>" + g.files.slice(0, 80).map(subRow).join("") + (g.files.length > 80 ? '<div class="noteEmpty">…อีก ' + (g.files.length - 80) + " ไฟล์</div>" : "") + "</details>" : "";
    return '<div class="nfile" data-gid="' + esc(g.gid) + '"><div class="nline"><div class="nn"><b>' + (g.folder ? "📁 " : "") + esc(g.name) + "</b><small>" + esc(sub) + '</small></div><span class="tagslot">' + tagHtml(dec) + "</span>" +
      (g.link ? '<a href="' + esc(g.link) + '" target="_blank" rel="noopener">' + (g.folder ? "เปิดแฟ้ม" : "เปิด") + " ↗</a>" : "") + '</div><div class="actslot">' + actsHtml(dec) + "</div>" + details + "</div>";
  }
  function setRow(row, dec) {
    row.querySelector(".tagslot").innerHTML = tagHtml(dec); row.querySelector(".actslot").innerHTML = actsHtml(dec);
    if (dec !== "mixed") [].slice.call(row.querySelectorAll(".nsub .ntag")).forEach(function (t) { t.outerHTML = tagHtml(dec, true); });
  }

  /* ---------- decisions: in place, undoable, "tick all" needs two taps ---------- */
  function rows() { return [].slice.call(document.querySelectorAll("#content .nfile")); }
  function pendingRows() { return rows().filter(function (r) { var t = r.querySelector(".tagslot .ntag"); return t && t.classList.contains("p"); }); }
  function itemsOf(rs) { var out = []; rs.forEach(function (r) { out = out.concat(groupsMap[r.dataset.gid] || []); }); return out; }
  function decide(items, decision, cat) { var q = { items: items, decision: decision }; if (cat) q.cat = cat; return api("decide_many", q); }
  var UNSET = "ไม่ระบุหมวด", catCache = lsGet("notedy.cats") || [], catAt = 0;
  function catOpts(sel) { return '<option value="">หมวด: อัตโนมัติ</option>' + catCache.map(function (c) { return '<option value="' + esc(c) + '"' + (c === sel ? " selected" : "") + ">" + esc(c) + "</option>"; }).join(""); }
  function refreshCats() { catAt = Date.now(); api("pdfcfg_get").then(function (r) { catCache = r.cats || []; lsSet("notedy.cats", catCache); }).catch(function () {}); }
  function bulkRender() {
    var bar = $("noteBulk"); if (!bar) return;
    var rs = pendingRows(), n = rs.length, nf = itemsOf(rs).length;
    if (bulk.last) { bar.hidden = false; bar.innerHTML = "<span>✓ ตั้งเป็น “เป็นงาน” แล้ว " + bulk.last.length + ' ไฟล์</span><button class="nlink" data-nd="bulkundo" type="button">↩ ยกเลิกทั้งหมด</button>'; }
    else if (n > 0) { bar.hidden = false; bar.innerHTML = bulk.armed ? '<button class="nbulk warn" data-nd="bulk" type="button">แน่ใจไหม? แตะอีกครั้งเพื่อตั้งเป็น “เป็นงาน” ทั้ง ' + n + " รายการ (" + nf + " ไฟล์)</button>" : '<button class="nbulk" data-nd="bulk" type="button">✓ ถูกทั้งหมด (' + n + " รายการ · " + nf + " ไฟล์)</button>"; }
    else bar.hidden = true;
  }
  function counters() {
    var tags = [].slice.call(document.querySelectorAll("#content .nfile .tagslot .ntag")), done = tags.filter(function (t) { return !t.classList.contains("p"); }).length;
    var b = document.querySelector("#content .bDecided"); if (b) b.textContent = done + "/" + tags.length;
    api("status").then(function (s) { status = s; header(); var li = document.querySelector("#content .liPending"); if (li) { if (s.pending) li.textContent = "ไฟล์ในคิว Drive รอตรวจ " + s.pending; else li.remove(); } }).catch(function () {});
  }
  function onAction(nd, btn) {
    if (nd === "bulk") {
      if (!bulk.armed) { bulk.armed = true; clearTimeout(bulk.t); bulk.t = setTimeout(function () { bulk.armed = false; bulkRender(); }, 4000); bulkRender(); return; }
      bulk.armed = false; clearTimeout(bulk.t);
      var rs = pendingRows(), items = itemsOf(rs); if (!items.length) return;
      decide(items, "work").then(function (r) {
        var ok = {}; r.done.forEach(function (id) { ok[id] = 1; });
        rs.forEach(function (row) { if ((groupsMap[row.dataset.gid] || []).every(function (i) { return ok[i.file_id]; })) setRow(row, "work"); });
        bulk.last = items.filter(function (i) { return ok[i.file_id]; });
        if (r.skipped) toast("ข้าม " + r.skipped + " ไฟล์ที่เพิ่งถูกแก้ไข");
        bulkRender(); counters();
      }).catch(function (e) { toast(e.message); load(true); });
    } else if (nd === "bulkundo") {
      var last = bulk.last || []; bulk.last = null;
      decide(last, "pending").then(function () { load(true); }).catch(function (e) { toast(e.message); load(true); });
    } else {
      var row = btn.closest(".nfile"); if (!row) return;
      bulk.last = null; bulk.armed = false; var cs = row.querySelector(".catSel"), cat = nd === "work" && cs ? cs.value : ""; setRow(row, nd);
      decide(groupsMap[row.dataset.gid] || [], nd, cat).then(function (r) { if (r.skipped) toast("ข้าม " + r.skipped + " ไฟล์ที่เพิ่งถูกแก้ไข"); bulkRender(); counters(); }).catch(function (e) { toast(e.message); load(true); });
    }
  }

  /* ---------- views ---------- */
  function header() {
    var sub = $("subline"); if (!sub) return;
    var t = status.last_success ? "ซิงก์ล่าสุด " + hhmm(status.last_success) : "ยังไม่เคยซิงก์";
    sub.textContent = t + (status.pending != null ? " · รอตรวจ " + status.pending + " ไฟล์" : "");
    var tab = document.querySelector('.tabs [data-v="pending"]'); if (tab) tab.textContent = "📥 ค้างตรวจ" + (status.pending ? " (" + status.pending + ")" : "");
    var bn = $("banner"); if (bn) { bn.hidden = !status.error; bn.textContent = status.error ? "ซิงก์ Drive ผิดพลาด: " + status.error : ""; }
  }
  function showApp() {                                          // leave the office room: the classic (scrolling) pages use #app
    if (office) { office.destroy(); office = null; }
    document.body.classList.remove("inOffice"); var o = $("office"); if (o) { o.hidden = true; o.innerHTML = ""; o.classList.remove("open"); } $("app").hidden = false;
  }
  function renderShell() {
    showApp();
    $("app").innerHTML = '<div class="top"><img src="assets/Notedy.png" alt=""><div class="ttl"><b>Notedy</b><small id="subline">กำลังโหลด…</small></div><button class="ibtn" id="syncBtn" title="ซิงก์ Drive ตอนนี้" aria-label="ซิงก์ Drive ตอนนี้">🔄</button><button class="ibtn" id="lockBtn" title="ล็อกแอป" aria-label="ล็อกแอป">🔒</button><button class="ibtn" id="cfgBtn" title="ตั้งค่า" aria-label="ตั้งค่า">⚙</button></div>' +
      '<div class="banner" id="banner" hidden></div>' +
      '<div class="tabs"><button data-v="office">🏡 ห้อง</button><button data-v="day" class="' + (view === "day" ? "on" : "") + '">📒 โน้ตรายวัน</button><button data-v="pending" class="' + (view === "pending" ? "on" : "") + '">📥 ค้างตรวจ</button></div>' +
      '<div id="content"><div class="noteEmpty">กำลังโหลด…</div></div><div class="noteBulk" id="noteBulk" hidden></div>';
  }
  function dayHtml(d) {
    var files = d.files || [], events = d.events || [], isToday = day === todayStr();
    groupsMap = {};
    var groups = groupFiles(files), gDecided = groups.filter(function (g) { return groupDecision(g) !== "pending"; }).length;
    var total = d.files_total || files.length, stars = total >= 40 ? 3 : total >= 12 ? 2 : total >= 1 ? 1 : 0;
    var starHtml = [0, 1, 2].map(function (i) { return '<span class="' + (i < stars ? "" : "off") + '">★</span>'; }).join("");
    var doneLi = events.length ? events.slice(-7).map(function (e) { return "<li>" + esc((e.ts || "").slice(11, 16)) + " " + esc(e.text) + "</li>"; }).join("") + (events.length > 7 ? "<li>…อีก " + (events.length - 7) + " รายการ</li>" : "") : "<li>ยังไม่มีบันทึก</li>";
    var todoLi = status.pending ? '<li class="liPending">ไฟล์ในคิว Drive รอตรวจ ' + status.pending + "</li>" : "<li>ไม่มีค้าง 🎉</li>";
    return '<div class="board"><div class="boardClip"></div><div class="paper">' +
      '<div class="noteHead"><div class="noteNo">N.' + esc(day.slice(8)) + '</div><div class="noteTitle"><small>daily note</small><b>' + (isToday ? "วันนี้" : esc(shortDate(day))) + '</b></div><div class="noteStars">' + starHtml + "</div></div>" +
      '<hr class="noteDash"><div class="noteSub">' + esc(longDate(day)) + "</div>" +
      '<div class="noteHero"><button class="noteArrow l" data-nav="-1" aria-label="วันก่อนหน้า"></button><img src="assets/Notedy.png" alt="Notedy"><button class="noteArrow r" data-nav="1" aria-label="วันถัดไป"' + (isToday ? " disabled" : "") + "></button></div>" +
      '<div class="noteBoxes"><div class="nbox orange"><div>📁 แฟ้มที่มีไฟล์เปลี่ยน <b>' + groups.length + "</b></div><div>🗂 ไฟล์ที่แก้ใน Drive <b>" + total + '</b></div><div>✅ ตัดสินแล้ว <b class="bDecided">' + gDecided + "/" + groups.length + "</b></div></div>" +
      '<div class="nbox green"><div class="cols"><div class="yes"><h4>ทำแล้ว ✓</h4><ul>' + doneLi + '</ul></div><div class="no"><h4>ค้างอยู่ ✗</h4><ul>' + todoLi + "</ul></div></div></div></div>" +
      '<div class="noteSec">แฟ้มที่มีไฟล์เปลี่ยนวันนี้</div>' + (groups.length ? groups.slice(0, 150).map(function (g) { return groupCard(g, false); }).join("") : '<div class="noteEmpty">ไม่มีไฟล์ที่แก้ไขในวันนี้</div>') +
      '<div class="noteFoot">@Notedy · สมุดสรุปประจำวัน</div></div></div>';
  }
  function pendingHtml(inb) {
    groupsMap = {};
    var pend = (inb.items || []).filter(function (f) { return f.decision === "pending"; }), groups = groupFiles(pend);
    return '<div class="plain"><div class="noteSec" style="margin-top:0">แฟ้มที่ยังรอตรวจ (ทุกวัน) · ' + groups.length + " รายการ · " + pend.length + " ไฟล์</div>" +
      (groups.length ? groups.slice(0, 120).map(function (g) { return groupCard(g, true); }).join("") + (groups.length > 120 ? '<div class="noteEmpty">…และอีก ' + (groups.length - 120) + " รายการ (ตัดสินชุดนี้ก่อนแล้วโหลดใหม่)</div>" : "") : '<div class="noteEmpty">ไม่มีอะไรค้างตรวจ 🎉</div>') + "</div>";
  }
  function load(keepScroll) {
    if (noteOpen) return loadNote(keepScroll);
    if (busy || view === "office") return Promise.resolve();
    busy = true; var sc = keepScroll ? window.scrollY : 0;
    var job = view === "day" ? Promise.all([api("daily", { date: day }), api("status")]) : Promise.all([api("inbox"), Promise.resolve(null)]);
    return job.then(function (r) {
      busy = false; bulk.last = null; bulk.armed = false;
      if (view === "day") { status = r[1]; $("content").innerHTML = dayHtml(r[0]); }
      else { status = r[0].status || status; $("content").innerHTML = pendingHtml(r[0]); }
      header(); bulkRender(); if (sc) window.scrollTo(0, sc);
    }).catch(function (e) {
      busy = false;
      if (e.code && PIN_CODES[e.code]) { cfg.p = ""; saveCfg(cfg); gatePin(e.code === "pin_setup" ? "" : e.message); return; }      // PIN changed or reset elsewhere
      $("content").innerHTML = '<div class="banner">' + esc(e.message) + '</div><button class="setup go" id="retry" style="margin-top:8px">ลองใหม่</button>';
    });
  }

  function parseSetup(text) {                                   // accepts the whole link from the sheet (…#setup=…) or just the code after setup=
    var t = String(text || "").trim(), m = /setup=([A-Za-z0-9_\-=]+)/.exec(t), code = m ? m[1] : (/^[A-Za-z0-9_\-=]{80,}$/.test(t) ? t : "");
    if (!code) return null;
    try { var o = JSON.parse(decodeURIComponent(escape(atob(code.replace(/-/g, "+").replace(/_/g, "/"))))); if (URL_OK.test(o.u) && TOKEN_OK.test(o.t)) return { u: o.u, t: o.t, p: "" }; } catch (e) { /* not a setup link */ }
    return null;
  }
  function renderSetup(msg) {
    showApp();
    $("app").innerHTML = '<div class="top"><img src="assets/Notedy.png" alt=""><div class="ttl"><b>Notedy</b><small>เชื่อมครั้งแรก (ทำครั้งเดียวต่อเครื่อง)</small></div></div>' +
      '<div class="setup"><h2>เชื่อมแอปกับ Google ของคุณ</h2>' + (msg ? '<div class="banner">' + esc(msg) + "</div>" : "") +
      '<div class="how"><b>วิธีที่ง่ายสุด: สแกน QR</b><br>บนคอมที่เปิดแอปนี้อยู่แล้ว กด ⚙ → “เปิดบนมือถือ (QR)” แล้วสแกนด้วยกล้องมือถือ</div>' +
      '<div class="how"><b>หรือวางลิงก์:</b><br>เปิดชีต “Notedy Cloud” → แท็บ <b>setup</b> → เซลล์ <b>A2</b> → คัดลอกทั้งเซลล์ แล้ววางตรงนี้</div>' +
      '<textarea id="cfgLink" rows="3" placeholder="วางลิงก์ตั้งค่าทั้งเส้นที่นี่" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>' +
      '<button class="setup go" id="cfgGo" type="button">เชื่อมต่อ</button>' +
      '<details class="adv"><summary>กรอกเองแบบแยกช่อง (ขั้นสูง)</summary><label class="muted">Web app URL</label><input id="cfgU" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" autocapitalize="off">' +
      '<label class="muted">รหัสเชื่อมต่อ (64 ตัวอักษร ในลิงก์หลัง setup=)</label><input id="cfgT" placeholder="รหัสเชื่อมต่อ" autocomplete="off" autocapitalize="off"></details>' +
      '<p class="muted">หลังเชื่อมแล้วแอปจะขอ “รหัสผ่านแอป 6 หลัก” ที่คุณตั้งเอง (คนละอันกับรหัสในลิงก์)</p></div>';
  }
  function renderPin(create, msg) {
    showApp();
    var top = '<div class="top"><img src="assets/Notedy.png" alt=""><div class="ttl"><b>Notedy</b><small>' + (create ? "ตั้งรหัสผ่านแอป" : "ใส่รหัสผ่านแอป") + "</small></div></div>";
    $("app").innerHTML = top + '<div class="setup pinbox"><h2>' + (create ? "ตั้งรหัสผ่านแอป (ตัวเลข 6 หลัก)" : "ใส่รหัสผ่านแอป (ตัวเลข 6 หลัก)") + "</h2>" + (msg ? '<div class="banner">' + esc(msg) + "</div>" : "") +
      '<p class="muted">' + (create ? "คิดเลข 6 หลักขึ้นมาเอง (เช่นวันเกิด) ไว้เปิดแอปนี้ ตั้งครั้งเดียว เครื่องนี้จะจำไว้ ไม่ต้องกรอกอีก · เครื่องใหม่ต้องใส่เลขเดียวกันนี้" : "ใส่เลข 6 หลักที่คุณตั้งไว้ตอนแรก (ไม่ใช่รหัสในลิงก์) เครื่องนี้จะจำไว้หลังใส่ถูก") + "</p>" +
      '<input id="pinA" class="pinIn" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" autocapitalize="off" placeholder="● ● ● ● ● ●" aria-label="รหัส 6 หลัก">' +
      (create ? '<input id="pinB" class="pinIn" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" autocapitalize="off" placeholder="พิมพ์ซ้ำอีกครั้ง" aria-label="พิมพ์รหัสซ้ำ">' : "") +
      '<button class="setup go" id="pinGo" type="button">' + (create ? "ตั้งรหัสและเข้าแอป" : "เข้าแอป") + "</button></div>";
    var a = $("pinA"); if (a) { try { a.focus(); } catch (e) {} }
    $("app").dataset.pin = create ? "create" : "enter";
  }
  function gatePin(msg) {                                       // is a PIN already set on the Google side? then ask for it, otherwise create it
    return api("ping").then(function (r) { renderPin(!r.pin_set, msg); })
      .catch(function (e) { if (e.code === "unauthorized") { cfg = null; clearCfgStore(); renderSetup(e.message); } else renderPin(false, e.message); });
  }
  function submitPin() {
    var create = $("app").dataset.pin === "create", a = ($("pinA").value || "").trim(), b = create ? ($("pinB").value || "").trim() : a;
    if (!PIN_OK.test(a)) { toast("ใส่ตัวเลข 6 หลัก"); return; }
    if (create && a !== b) { toast("สองช่องไม่ตรงกัน ลองใหม่"); return; }
    if (busy) return;
    busy = true; var btn = $("pinGo"); if (btn) btn.disabled = true;
    var job = create ? (cfg.p = "", api("setpin", { newpin: a })) : (cfg.p = a, api("ping"));
    job.then(function () { busy = false; cfg.p = a; saveCfg(cfg); day = todayStr(); start(); })
      .catch(function (e) {
        busy = false; cfg.p = "";
        if (e.code === "pin_setup") renderPin(true, "ยังไม่ได้ตั้งรหัส ตั้งตอนนี้ได้เลย");
        else renderPin(false, e.message);
      });
  }
  function start() {
    if (!cfg) { renderSetup(); return; }
    if (!cfg.p) { gatePin(); return; }
    if (view === "office") renderOffice(); else { renderShell(); load(); }
  }
  function verifyAndStart(c) {
    cfg = c;
    return api("ping").then(function () { if (!saveCfg(c)) toast("บันทึกการตั้งค่าไม่ได้ (โหมดส่วนตัวของเบราว์เซอร์?)"); try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {} day = todayStr(); start(); })
      .catch(function (e) { cfg = null; renderSetup(e.message); });
  }


  /* ---------- office room (home) + chat with the spirits ---------- */
  /* per-spirit colours (same palette as the PC app): a = accent, s/s2 = soft backgrounds, d = dark text */
  var THEMES = {
    Notedy: { a: "#4b64c4", s: "#eef1ff", s2: "#fff4e6", d: "#2c3a86", pat: "star" }, Newnew: { a: "#5b7bdb", s: "#eaf2ff", s2: "#fff1e6", d: "#2f4392", pat: "doc" },
    Backy: { a: "#8d86d9", s: "#2b2943", s2: "#37345a", d: "#f0eeff", pat: "moon", dark: true, av: "#cfcaf0", card: "#d9d6f5" }, Minty: { a: "#6b9a4f", s: "#eaf6df", s2: "#fbfff3", d: "#2f5a2a", pat: "leaf" },
    Drivey: { a: "#5c95ed", s: "#e3f0ff", s2: "#f6faff", d: "#244a8c", pat: "cloud" }, Clouddy: { a: "#e7819b", s: "#ffe8f0", s2: "#fff8fb", d: "#8c2f55", pat: "heart" },
    Sunny: { a: "#e09145", s: "#ffefcf", s2: "#fffaf0", d: "#8a4b12", pat: "sun" }, Linky: { a: "#6281e3", s: "#e9edff", s2: "#f8f9ff", d: "#2f3f94", pat: "link" },
    Searchy: { a: "#a66d5d", s: "#f5e6df", s2: "#fffaf7", d: "#5c3329", pat: "paw" }, Drawy: { a: "#e3719e", s: "#ffe6f1", s2: "#fff7fb", d: "#8a2b57", pat: "spark" },
    Planly: { a: "#837ae4", s: "#edeaff", s2: "#faf9ff", d: "#40368f", pat: "dots" }, Buddy: { a: "#e1a45b", s: "#ffedd2", s2: "#fffaf2", d: "#7a4a14", pat: "paw" }
  };
  var SHAPES = {
    star: "<path d='M14 8l2.2 5.3 5.3 2.2-5.3 2.2L14 23l-2.2-5.3L6.5 15.5l5.3-2.2z'/><circle cx='26' cy='9' r='1.6'/>", doc: "<rect x='8' y='7' width='12' height='15' rx='2'/><path d='M11 12h6M11 16h6' stroke='#fff' stroke-width='1.4'/>",
    moon: "<path d='M20 7a9 9 0 1 0 7 14 7.5 7.5 0 0 1-7-14z'/><circle cx='28' cy='10' r='1.5'/><circle cx='9' cy='27' r='1.2'/>", leaf: "<path d='M8 24C8 13 16 8 26 8c0 11-7 17-18 16z'/>",
    cloud: "<circle cx='13' cy='19' r='5'/><circle cx='20' cy='15' r='6.5'/><circle cx='27' cy='19' r='5'/><rect x='9' y='19' width='22' height='5' rx='2.5'/>", heart: "<circle cx='11' cy='13' r='5'/><circle cx='21' cy='13' r='5'/><path d='M6.3 15.6L16 25.5l9.7-9.9z'/>",
    sun: "<circle cx='16' cy='16' r='5'/><path d='M16 5v4M16 23v4M5 16h4M23 16h4M8 8l3 3M21 21l3 3M24 8l-3 3M11 21l-3 3' stroke='COLOR' stroke-width='2' stroke-linecap='round'/>", link: "<circle cx='13' cy='16' r='6' fill='none' stroke='COLOR' stroke-width='2.6'/><circle cx='22' cy='16' r='6' fill='none' stroke='COLOR' stroke-width='2.6'/>",
    paw: "<ellipse cx='16' cy='21' rx='6' ry='5'/><circle cx='9' cy='14' r='2.5'/><circle cx='14' cy='9.5' r='2.5'/><circle cx='20' cy='9.5' r='2.5'/><circle cx='25' cy='14' r='2.5'/>", spark: "<path d='M16 5l2 6.5L24.5 13.5 18 15.5 16 22l-2-6.5L7.5 13.5 14 11.5z'/><circle cx='26' cy='24' r='1.6'/>",
    dots: "<circle cx='14' cy='14' r='2.6'/><circle cx='28' cy='28' r='2.6'/><circle cx='14' cy='42' r='2.6'/><circle cx='42' cy='14' r='2.6'/>"
  };
  function theme(id) { return THEMES[id] || THEMES.Notedy; }
  function patUrl(kind, color) {
    var sh = (SHAPES[kind] || SHAPES.dots).replace(/COLOR/g, color), svg = "<svg xmlns='http://www.w3.org/2000/svg' width='56' height='56'><g fill='" + color + "' opacity='.17'>" + sh + "<g transform='translate(27 27)'>" + sh + "</g></g></svg>";
    return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
  }
  function applyTheme(id) {
    var t = theme(id), sh = $("ofSheet"); if (!sh) return;
    sh.style.setProperty("--t1", t.a); sh.style.setProperty("--t2", t.s); sh.style.setProperty("--t3", t.s2); sh.style.setProperty("--td", t.d); sh.style.setProperty("--tpat", patUrl(t.pat, t.dark ? "#ffffff" : t.a));
    sh.dataset.dark = t.dark ? "1" : "0";
  }
  function avatar(id) { var t = theme(id); return '<span class="av" style="background-color:' + (t.av || t.s) + ";background-image:url(office/img/chars/" + id + ".webp);border-color:" + t.a + '"></span>'; }
  function trunc(x, n) { x = String(x || ""); return x.length > n ? x.slice(0, n - 1) + "…" : x; }
  function b64url(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_"); }
  function isNight() { var h = parseInt(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Bangkok" }).format(new Date()), 10); return h >= 18 || h < 6; }
  /* room light: 0 = day (brightest) ... 1 = night (darkest). Auto follows Bangkok time with a smooth dusk/dawn; the slider takes over until "auto" is pressed */
  var toneCfg = (function () { try { var v = JSON.parse(localStorage.getItem("notedy.tone") || "null"); if (v && v.mode === "manual" && v.v >= 0 && v.v <= 1) return v; } catch (e) { /* default */ } return { mode: "auto" }; })();
  function autoTone() {
    var p = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" }).format(new Date()).split(":"), h = +p[0] + p[1] / 60;
    if (h >= 8 && h < 17) return 0; if (h >= 19 || h < 6) return 1;
    return h < 8 ? 1 - (h - 6) / 2 : (h - 17) / 2;                          /* 06-08 dawn, 17-19 dusk */
  }
  function curTone() { return toneCfg.mode === "manual" ? toneCfg.v : autoTone(); }
  function toneUi() {
    sleepUi(); var r = $("toneRange"); if (!r) return; var t = curTone(); if (document.activeElement !== r) r.value = Math.round(t * 100);
    $("toneAuto").classList.toggle("on", toneCfg.mode !== "manual");
    $("toneTxt").textContent = (toneCfg.mode === "manual" ? "ปรับเอง" : "อัตโนมัติตามเวลา") + " · " + (t < 0.05 ? "Day สว่างสุด" : t > 0.95 ? "Night มืดสุด" : "มืด " + Math.round(t * 100) + "%");
  }
  function applyTone() { if (office) office.setTone(curTone()); toneUi(); }
  function setToneManual(v) { toneCfg = { mode: "manual", v: Math.min(1, Math.max(0, v)) }; try { localStorage.setItem("notedy.tone", JSON.stringify(toneCfg)); } catch (e) { /* not saved */ } applyTone(); }
  function setToneAuto() { toneCfg = { mode: "auto" }; try { localStorage.removeItem("notedy.tone"); } catch (e) { /* ignore */ } applyTone(); }

  /* ---------- sleeping spirits: from 19:00 an idle spirit goes to bed; long-press (or the 😴 in its page) sends one to bed / wakes it. Each one separately. ---------- */
  var sleepCfg = (function () { try { var v = JSON.parse(localStorage.getItem("notedy.sleep") || "null"); if (v && typeof v === "object") return { auto: v.auto !== false, ov: v.ov || {} }; } catch (e) { /* default */ } return { auto: true, ov: {} }; })();
  var fxOpts = (function () { try { var v = JSON.parse(localStorage.getItem("notedy.fxopts") || "null"); if (v && typeof v === "object") return { glow: v.glow !== false, grade: v.grade !== false, party: v.party !== false }; } catch (e) { /* default */ } return { glow: true, grade: true, party: true }; })();
  function saveSleep() { try { localStorage.setItem("notedy.sleep", JSON.stringify(sleepCfg)); } catch (e) { /* not saved */ } }
  function saveFxOpts() { try { localStorage.setItem("notedy.fxopts", JSON.stringify(fxOpts)); } catch (e) { /* not saved */ } }
  function bkkHour() { var p = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" }).format(new Date()).split(":"); return +p[0] + p[1] / 60; }
  function isDark() { var h = bkkHour(); return h >= 19 || h < 6; }
  function nextWake() { var now = Date.now(), th = new Date(now + 7 * 3600e3), d = Date.UTC(th.getUTCFullYear(), th.getUTCMonth(), th.getUTCDate(), 6, 0, 0) - 7 * 3600e3; if (d <= now) d += 864e5; return d; }
  function busyNow(id) { if (id === "Minty") return (status.pending || 0) > 0; if (id === "Notedy") return !!(ofToday && ofToday.pending > 0); if (id === "Drivey") return !!status.error; return false; }
  function asleep(id) {
    var o = sleepCfg.ov[id]; if (o && o.until > Date.now()) return !!o.v;
    return sleepCfg.auto && isDark() && !busyNow(id);
  }
  function applySleep() { if (!office) return; var m = {}; Office.ROSTER.forEach(function (r) { if (asleep(r.id)) m[r.id] = true; }); office.setSleep(m); sleepUi(); }
  function setSleepOne(id, v) { sleepCfg.ov[id] = { v: v ? 1 : 0, until: isDark() ? nextWake() : Date.now() + 4 * 3600e3 }; saveSleep(); applySleep(); }
  function sleepUi() {
    var z = $("ofZ"); if (z && ofSpirit) { var s = asleep(ofSpirit); z.textContent = s ? "⏰" : "😴"; z.title = s ? "ปลุก" : "ให้นอน"; }
    var a = $("sleepAuto"); if (a) a.checked = sleepCfg.auto; [["fxGlow", "glow"], ["fxGrade", "grade"], ["fxParty", "party"]].forEach(function (x) { var c = $(x[0]); if (c) c.checked = fxOpts[x[1]]; });
  }
  var sleepFor = null;
  function openSleepMenu(def, asset, el) {
    var m = $("ofSleepMenu"), o = $("office"); if (!m || !o) return; sleepFor = def.id; var r = el.getBoundingClientRect(), ob = o.getBoundingClientRect(), s = asleep(def.id);
    m.innerHTML = '<button type="button" data-sl="toggle">' + (s ? "⏰ ปลุก" : "😴 ให้") + esc(def.th) + (s ? "" : "นอน") + '</button><button type="button" data-sl="open">เปิดหน้าของ' + esc(def.th) + "</button>";
    m.hidden = false; var w = m.offsetWidth || 170; m.style.left = Math.max(8, Math.min(ob.width - w - 8, r.left - ob.left + r.width / 2 - w / 2)) + "px"; m.style.top = Math.max(70, r.top - ob.top + r.height * 0.25) + "px";
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* no haptics */ }
  }
  function celebrate() {                                         // every folder checked: confetti and hearts for a few seconds
    var o = $("office"); if (!o || view !== "office" || o.hidden) return;
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) { toast("ตรวจครบแล้ว 🎉"); return; }
    var cv = document.createElement("canvas"), W = o.clientWidth, H = o.clientHeight, d = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * d; cv.height = H * d; cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:50;pointer-events:none"; o.appendChild(cv);
    var x = cv.getContext("2d"), cols = ["#ff6f91", "#ffc75f", "#4b64c4", "#2ec4b6", "#b78cf7", "#ff9671", "#8bd450"], ps = [], i;
    for (i = 0; i < 110; i++) ps.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.6, vx: (Math.random() - 0.5) * 60, vy: 120 + Math.random() * 180, r: 4 + Math.random() * 5, a: Math.random() * 6.28, va: (Math.random() - 0.5) * 8, c: cols[i % cols.length], h: Math.random() < 0.22 });
    var t0 = performance.now(), last = t0;
    (function f(t) {
      var dt = Math.min(0.05, (t - last) / 1000), el = (t - t0) / 1000; last = t; x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, W, H);
      ps.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt; x.save(); x.translate(p.x, p.y); x.rotate(p.a); x.globalAlpha = Math.max(0, Math.min(1, (4 - el) / 1.2)); if (p.h) { x.font = (p.r * 3) + "px sans-serif"; x.fillText("💖", -p.r, 0); } else { x.fillStyle = p.c; x.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); } x.restore(); });
      if (el < 4) requestAnimationFrame(f); else cv.remove();
    })(t0);
    toast("ตรวจครบแล้ว 🎉 เก่งมาก!");
  }

  function toggleTone(on) { var p = $("ofTone"); if (!p) return; p.hidden = on === undefined ? !p.hidden : !on; if (!p.hidden) toneUi(); }
  function authFail(e) {                                         // PIN changed / reset elsewhere or token revoked
    if (e.code && PIN_CODES[e.code]) { cfg.p = ""; saveCfg(cfg); gatePin(e.code === "pin_setup" ? "" : e.message); return true; }
    if (e.code === "unauthorized") { cfg = null; clearCfgStore(); renderSetup(e.message); return true; }
    return false;
  }
  function loadOfficeAssets() {
    if (!ofLoad) ofLoad = Promise.all([fetch("office/assets.json").then(function (r) { return r.json(); }), fetch("office/layout.json").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })])
      .then(function (r) { ofAssets = r[0]; ofLayout = r[1]; }).catch(function (e) { ofLoad = null; throw e; });
    return ofLoad;
  }
  function renderOffice() {
    document.body.classList.add("inOffice"); $("app").hidden = true; $("app").innerHTML = "";
    var o = $("office"); if (!o) { o = document.createElement("div"); o.id = "office"; document.body.insertBefore(o, $("toast")); }
    o.hidden = false; o.classList.remove("open"); noteOpen = false;
    var spOpts = '<option value="">ภูติทุกตัว</option>' + Office.ROSTER.map(function (r) { return '<option value="' + r.id + '">' + esc(r.th) + "</option>"; }).join("");
    o.innerHTML = '<div id="ofStage"></div>' +
      '<div class="demoTop"><div class="dtL"><div class="dtRow"><div class="pillBox"><span class="cat">🐱</span><strong>Notedy</strong></div><button class="noteBtn" data-note="1" type="button" aria-label="โน้ตประจำวัน" title="โน้ตประจำวัน">' + NOTE_ICON + '</button><button class="noteBtn wkBtn" data-wkopen="1" type="button" aria-label="หน้าสรุปงานเต็ม" title="หน้าสรุปงานเต็ม (จัดหมวด · PDF)">' + WORK_ICON + "</button></div>" +
      '<div class="pillBox pillBtn"><button type="button" id="ofPeriodBtn" class="pb" aria-label="เลือกรอบ"><span id="ofPeriod"></span><span class="car">▾</span></button><span class="sep"></span><button type="button" id="ofPend" class="pb" aria-label="ไปหน้าค้างตรวจ">📋 รอตรวจ <b id="ofPendN">–</b></button></div></div>' +
      '<div class="dtR"><button class="ico" id="toneBtn" type="button" aria-label="ปรับแสงในห้อง (Day / Night)" title="ปรับแสง Day / Night">🌗</button><button class="ico" id="menuBtn" type="button" aria-label="เมนู">⚙</button></div></div>' +
      '<div id="ofTone" hidden><div class="tCard"><div class="tTop"><b>แสง · การนอน</b><button type="button" id="toneAuto" class="tAuto">อัตโนมัติ</button><button type="button" id="toneX" class="tX" aria-label="ปิด">✕</button></div><div class="tRow"><span aria-hidden="true">☀️</span><input id="toneRange" type="range" min="0" max="100" step="1" aria-label="ความมืด: Day ถึง Night"><span aria-hidden="true">🌙</span></div><div class="tLb"><span>Day</span><small id="toneTxt"></small><span>Night</span></div><div class="tSep"></div><div class="tSl"><button type="button" id="sleepAll">😴 ให้ทุกตัวนอน</button><button type="button" id="wakeAll">⏰ ปลุกทุกตัว</button></div><label class="tChk"><input type="checkbox" id="sleepAuto"> นอนเองหลัง 19:00 เมื่อว่างงาน</label><div class="tOpts"><label><input type="checkbox" id="fxGlow"> แสงโคม</label><label><input type="checkbox" id="fxGrade"> โทนสี</label><label><input type="checkbox" id="fxParty"> ฉลอง 🎉</label></div></div></div><div id="ofSleepMenu" hidden></div>' +
      '<button class="handle" id="ofHandle" type="button" aria-label="เมนูลัด"><i></i></button>' +
      '<div id="ofQuick" hidden><div class="qCard"><button type="button" data-q="pending">📥<span>ค้างตรวจ</span></button><button type="button" data-q="day">📒<span>โน้ตรายวัน</span></button><button type="button" data-q="work">📊<span>สรุปงาน</span></button><button type="button" data-q="menu">⚙<span>เมนู</span></button></div></div>' +
      '<div id="ofPeriodMenu" hidden><div class="mCard"><h3>เลือกรอบ (26 → 26)</h3><div id="ofPeriodList"></div><button type="button" id="ppClose" class="plain">ปิด</button></div></div>' +
      '<div id="ofScrim"></div><div id="ofSheet" role="dialog" aria-modal="true" data-dark="0"><div class="grab"></div><div class="phead"><img id="ofImg" alt=""><div><h2 id="ofNm"></h2><small id="ofRl"></small></div><button class="x" id="ofZ" type="button" aria-label="ให้นอน / ปลุก" title="ให้นอน">😴</button><button class="x" id="ofX" type="button" aria-label="ปิด">✕</button></div>' +
      '<div class="strip" id="ofStrip"></div><div id="ofBody"></div>' +
      '<div id="ofChatBox" class="collapsed"><button class="chatBar" id="ofChatBar" type="button"><span id="ofChatBarT">💬 แชท</span><span class="chev" aria-hidden="true">▾</span></button><div id="ofChat"></div><div id="ofKey" hidden></div><form id="ofForm" autocomplete="off"><input id="ofIn" maxlength="500" enterkeyhint="send"><button id="ofSend" type="submit">ส่ง</button></form></div></div>' +
      '<div id="ofMenu" hidden><div class="mCard"><h3>เมนู</h3><button type="button" id="syncBtn">🔄 ซิงก์ Drive ตอนนี้</button><button type="button" id="mQr">📱 เปิดบนมือถือเครื่องอื่น (QR)</button><div id="mQrBox" hidden></div>' +
      '<button type="button" id="mKey">🔑 ใส่ Gemini API key (ให้ภูติคุยได้)</button><div id="mKeyBox" hidden><div id="mKeySt" class="muted"></div><input id="mKeyIn" type="password" placeholder="วาง API key ที่นี่" autocomplete="off" autocapitalize="off" spellcheck="false"><div class="krow"><button type="button" id="mKeySave">บันทึก</button><button type="button" id="mKeyDel" class="plain">ลบ key</button></div></div>' +
      '<button type="button" id="mNotify">🔔 แจ้งเตือนบนมือถือ (เด้งแม้ปิดแอป)</button><div id="mNotifyBox" hidden><div id="mNotifySt" class="muted"></div><div class="krow"><button type="button" id="mNotifyOn">เปิด</button><button type="button" id="mNotifyOff" class="plain">ปิด</button><button type="button" id="mNotifyTest" class="plain">ส่งทดสอบ</button></div></div>' +
      '<button type="button" id="mClear">🧹 ล้างประวัติแชต…</button><div id="mClearBox" hidden><select id="mClearSel">' + spOpts + '</select><div class="krow"><button type="button" id="mClearGo">ล้าง</button></div></div>' +
      '<button type="button" id="lockBtn">🔒 ล็อกแอป (ต้องใส่รหัสผ่านใหม่)</button><button type="button" id="cfgBtn">ล้างการตั้งค่าเครื่องนี้</button><button type="button" id="mClose" class="plain">ปิด</button></div></div><div id="ofAsk" hidden></div>';
    if (!o.dataset.sw) {                                          // swipe up from the bottom edge opens the quick menu (bound once: #office lives for the whole session)
      o.dataset.sw = "1"; var s0 = null;
      o.addEventListener("touchstart", function (e) { var t = e.touches[0]; s0 = t.clientY > innerHeight - 130 && !o.classList.contains("open") && !noteOpen ? t.clientY : null; }, { passive: true });
      o.addEventListener("touchend", function (e) { if (s0 == null) return; var t = e.changedTouches[0]; if (s0 - t.clientY > 40) openQuick(); s0 = null; }, { passive: true });
    }
    loadOfficeAssets().then(function () {
      if (view !== "office" || office) return;
      office = new Office($("ofStage"), { base: "office/", onTap: openSheet, onLongPress: openSleepMenu }); office.load(ofAssets, ofLayout, curTone()); office.setOpts(fxOpts); office.setBadges(ofBadges); applySleep();
    }).catch(function () { toast("โหลดภาพห้องไม่สำเร็จ ลองเปิดใหม่"); });
    var cs = lsGet("notedy.cache.data"); if (cs && cs.items && status.pending == null) {                     // last known numbers right away, fresh ones follow
      var pn0 = cs.items.filter(function (f) { return f.decision === "pending"; }).length; status = Object.assign({}, status, { pending: pn0 }); ofBadges = { Minty: pn0 };
    }
    headerOffice(); officeData();
  }
  function headerOffice() {
    var pr = periodSel(), pe = $("ofPeriod"); if (pe) pe.textContent = shortDate(pr.from) + " – " + shortDate(pr.to);
    var pn = $("ofPendN"); if (pn) pn.textContent = status.pending != null ? status.pending : "–";
    var pb = $("ofPend"); if (pb) pb.classList.toggle("hot", (status.pending || 0) > 20);
  }
  function openQuick() { var q = $("ofQuick"); if (q) q.hidden = false; }
  function openPeriodMenu() {
    var list = periodList(), cur = periodSel();
    $("ofPeriodList").innerHTML = list.map(function (p, k) { return '<button type="button" class="' + (p.from === cur.from ? "on" : "") + '" data-per="' + k + '">' + esc(periodLabel(p)) + (k === 0 ? " (รอบนี้)" : "") + "</button>"; }).join(""); $("ofPeriodMenu").hidden = false;
  }
  function pickPeriod(k) { var list = periodList(); ofPer = k === 0 ? null : list[k]; calM = null; calSel = null; $("ofPeriodMenu").hidden = true; headerOffice(); if (ofDef && ofData && $("office").classList.contains("open")) renderBody(ofDef, ofData); }
  function swReady() {                                          // the worker may not be active yet (first visit, or a browser that blocks it): do not wait forever
    return Promise.race([navigator.serviceWorker.ready, new Promise(function (_, rej) { setTimeout(function () { rej(new Error("ระบบแจ้งเตือนยังไม่พร้อม ปิดแอปแล้วเปิดใหม่อีกครั้ง")); }, 6000); })]);
  }
  function pushSupport() {
    var ios = /iPhone|iPad|iPod/.test(navigator.userAgent), standalone = window.navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
    if (ios && !standalone) return "ios-install";
    return ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) ? "ok" : "none";
  }
  function u8(b64) { var p = "=".repeat((4 - b64.length % 4) % 4), raw = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/")), a = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) a[i] = raw.charCodeAt(i); return a; }
  function notifyShow(t) { var e = $("mNotifySt"); if (e) e.textContent = t; }
  function openNotifyBox() {
    $("ofMenu").hidden = false; $("mNotifyBox").hidden = false; notifyShow("กำลังตรวจ…"); var sup = pushSupport();
    if (sup === "ios-install") { notifyShow("บน iPhone ต้องเพิ่มแอปลงหน้าจอโฮมก่อน: กดปุ่มแชร์ใน Safari → เพิ่มลงหน้าจอโฮม แล้วเปิดแอปจากไอคอนนั้น (ต้อง iOS 16.4 ขึ้นไป) จึงจะเปิดแจ้งเตือนได้"); return; }
    if (sup === "none") { notifyShow("เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือนแบบเด้ง"); return; }
    Promise.all([api("notify_status"), swReady().then(function (r) { return r.pushManager.getSubscription(); })]).then(function (r) {
      var st = r[0], sub = r[1];
      notifyShow((st.on && sub ? "🔔 เปิดอยู่ในเครื่องนี้" : st.on ? "🔔 เปิดในระบบ แต่เครื่องนี้ยังไม่ได้เปิด (กด “เปิด”)" : "🔕 ปิดอยู่") + " · เครื่องที่ผูกไว้ " + st.devices + (st.error ? " · ⚠️ " + st.error : "") + (Notification.permission === "denied" ? " · ⚠️ สิทธิ์แจ้งเตือนถูกปิดไว้ในตั้งค่าเครื่อง" : ""));
    }).catch(function (e) { if (!authFail(e)) notifyShow(/unknown action/.test(e.message) ? "สคริปต์ยังไม่อัปเดต" : e.message); });
  }
  function setNotify(on) {
    var sup = pushSupport(); if (sup !== "ok") { openNotifyBox(); return; }
    if (!on) {
      swReady().then(function (r) { return r.pushManager.getSubscription(); }).then(function (sub) { var ep = sub && sub.endpoint; return Promise.all([sub ? sub.unsubscribe() : 0, ep ? api("push_unsubscribe", { endpoint: ep }) : 0]); })
        .then(function () { return api("notify_set", { on: false }); }).then(function () { toast("ปิดแจ้งเตือนแล้ว"); openNotifyBox(); }).catch(function (e) { if (!authFail(e)) notifyShow("⚠️ " + e.message); });
      return;
    }
    Notification.requestPermission().then(function (perm) {         // asked straight from the tap, as iOS requires
      if (perm !== "granted") throw new Error("ยังไม่ได้อนุญาตการแจ้งเตือน (เปิดได้ที่ ตั้งค่า iPhone → Notedy → การแจ้งเตือน)");
      idbSet("cfg", cfg); return Promise.all([swReady(), api("push_key")]);
    }).then(function (r) { return r[0].pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(r[1].key) }); })
      .then(function (sub) { return api("push_subscribe", { endpoint: sub.endpoint }); }).then(function () { return api("notify_set", { on: true }); })
      .then(function () { toast("เปิดแจ้งเตือนแล้ว"); return testNotify(); }).catch(function (e) { if (!authFail(e)) notifyShow("⚠️ " + e.message); });
  }
  function testNotify() {
    return api("notify_test").then(function (r) { notifyShow(r.ok ? "ส่งแจ้งเตือนทดสอบแล้ว ควรเด้งภายในไม่กี่วินาที (ถ้าไม่เด้ง ลองปิดแล้วเปิดใหม่)" : "⚠️ " + r.error); })
      .catch(function (e) { if (!authFail(e)) notifyShow("⚠️ " + e.message); });
  }
  function clearChats() {
    var sp = $("mClearSel").value; if (!confirm(sp ? "ล้างประวัติแชตของ" + peerName(sp) + "? (ภูติตัวอื่นที่เคยคุยกันยังจำได้)" : "ล้างประวัติแชตของภูติทุกตัว?")) return;
    api("chat_clear", sp ? { spirit: sp } : {}).then(function () { if (sp) chatCache[sp] = []; else chatCache = {}; toast("ล้างประวัติแล้ว"); }).catch(function (e) { if (!authFail(e)) toast(e.message); });
  }
  function officeData() {
    return Promise.all([api("status"), api("daily", { date: todayStr() })]).then(function (r) {
      var prevP = status.pending; status = r[0]; var gs = groupFiles(r[1].files || []);
      ofToday = { groups: gs.length, files: r[1].files_total || 0, pending: gs.filter(function (g) { return groupDecision(g) === "pending"; }).length };
      ofBadges = { Minty: status.pending || 0, Notedy: ofToday.pending }; if (Date.now() - catAt > 600000) refreshCats();
      if (office) office.setBadges(ofBadges); headerOffice(); applySleep(); if (prevP > 0 && status.pending === 0 && fxOpts.party) celebrate();
    }).catch(function (e) { if (!authFail(e)) toast(e.message); });
  }
  function sayFor(def) {
    if (def.id === "Notedy" && ofToday) return "วันนี้ไฟล์เปลี่ยน " + ofToday.files + " ไฟล์ใน " + ofToday.groups + " แฟ้ม" + (ofToday.pending ? " ยังไม่ได้ตัดสิน " + ofToday.pending + " แฟ้ม" : " ตัดสินครบแล้ว 🎉") + " ฝากถามอะไรก็ได้นะคะ";
    if (def.id === "Minty" && status.pending != null) return "มีไฟล์รอตรวจ " + status.pending + " ไฟล์ ช่วยกันดูนะ 🍀";
    return def.say;
  }
  function peerName(id) { var r = Office.BY[id]; return r ? r.th : "เพื่อนภูติ"; }
  /* ---------- chat: same look and behaviour as the PC app (rules first when there is no key, Gemini when there is) ---------- */
  var chatCache = {}, lastRp = { map: {}, userAsks: {} }, ai = { has_key: null }, noteOpen = false, ofKeyHint = false;
  function ruleReply(txt) {                                      // free, no AI: only things the cloud data can answer
    var t = String(txt || ""), pend = status.pending != null ? status.pending : null, d = ofData, pr = periodSel(), m;
    if (/ซิงก์|ซิงค์|sync|อัปเดต.*drive|ดึง.*drive/i.test(t)) return { reply: "ซิงก์ Drive ให้ค่ะ กดยืนยันด้านล่างเพื่อเริ่มนะคะ", actions: [{ type: "sync" }] };
    if (/สรุปรอบ|สรุปเดือน|รอบนี้/.test(t)) {
      if (!d) return { reply: "เปิดหน้าซันนี่ดูสรุปรอบได้เลยค่ะ", actions: [{ type: "open_spirit", id: "Sunny" }] };
      var st = sunnyStats(d.items, pr); return { reply: "รอบ " + periodLabel(pr) + " ยืนยันเป็นงานแล้ว " + st.folders.length + " แฟ้ม (" + st.work.length + " ไฟล์) ค่ะ ดูสถิติที่ซันนี่ได้เลย", actions: [{ type: "open_spirit", id: "Sunny" }] };
    }
    if (/แฟ้มล่าสุด|แฟ้มที่แก้|แก้ล่าสุด/.test(t)) {
      if (!d) return { reply: "เปิดหน้าลิงค์กี้ดูแฟ้มล่าสุดได้เลยค่ะ", actions: [{ type: "open_spirit", id: "Linky" }] };
      var fl = groupFiles(d.items.filter(function (f) { return f.folder_id; })).sort(function (a, b) { return newest(b) < newest(a) ? -1 : 1; }).slice(0, 5);
      return { reply: fl.length ? "แฟ้มที่แก้ล่าสุด: " + fl.map(function (g) { return g.name; }).join(", ") + " ค่ะ" : "ยังไม่มีแฟ้มค่ะ", actions: [{ type: "open_spirit", id: "Linky" }] };
    }
    if (/ค้างตรวจ|รอตรวจ|ยังไม่ตรวจ|ยังไม่ตัดสิน/.test(t)) return { reply: pend == null ? "ไปดูหน้าค้างตรวจได้เลยค่ะ" : (pend ? "ตอนนี้ค้างตรวจ " + pend + " ไฟล์ค่ะ กดไปตัดสินได้เลย" : "ไม่มีอะไรค้างตรวจค่ะ 🎉"), actions: pend ? [{ type: "open_pending" }] : [] };
    if (/โน้ต|โน๊ต|วันนี้ทำอะไร|สรุปวันนี้/.test(t)) return { reply: ofToday ? "วันนี้ไฟล์เปลี่ยน " + ofToday.files + " ไฟล์ใน " + ofToday.groups + " แฟ้มค่ะ เปิดโน้ตรายวันดูรายละเอียดได้เลย" : "เปิดโน้ตรายวันดูได้เลยค่ะ", actions: [{ type: "open_day" }] };
    m = /(?:ค้นหา|ค้น|หา)\s*(?:ไฟล์|แฟ้ม)?\s*(.{2,40})$/.exec(t);
    if (m) {
      var q = m[1].trim().toLowerCase(), n = d ? d.items.filter(function (f) { return (f.name || "").toLowerCase().indexOf(q) >= 0 || (f.folder_name || "").toLowerCase().indexOf(q) >= 0; }).length : null;
      return { reply: (n == null ? "ไปค้นที่เสิร์ชชี่ได้เลยค่ะ" : "พบ " + n + " ไฟล์ที่ชื่อมี “" + m[1].trim() + "” ค่ะ เปิดเสิร์ชชี่ดูรายการได้เลย"), actions: [{ type: "open_spirit", id: "Searchy" }] };
    }
    return null;
  }
  function actLabel(a) {
    return a.type === "open_pending" ? "ไปหน้าค้างตรวจ" : a.type === "open_day" ? "เปิดโน้ต " + (a.date ? shortDate(a.date) : "วันนี้") : a.type === "sync" ? "ซิงก์ Drive ตอนนี้" : a.type === "open_spirit" ? "ไปที่" + peerName(a.id)
      : a.type === "decide_folder" ? "ตั้ง “" + a.folder + "” เป็น" + (a.decision === "work" ? "งาน" : "ไม่ใช่งาน") : a.type;
  }
  function actionView(a, i, eid, done) {
    if (done) return '<div class="muted">✓ ทำแล้ว</div>';
    return '<button class="btn pri" type="button" data-chat="act" data-eid="' + esc(eid) + '" data-ai="' + i + '">' + esc(actLabel(a)) + "</button>";
  }
  /* which log entries belong to a spirit-to-spirit exchange, so the popup can be replayed by tapping them */
  function buildReplays(log, me) {
    var map = {}, userAsks = {}, curUser = null;
    function find(from, role, peer) { for (var j = from + 1; j < log.length; j++) { if (log[j].role === "user") return null; if (log[j].role === role && log[j].peer === peer) return log[j]; } return null; }
    log.forEach(function (e, i) {
      if (e.role === "user") curUser = e.id;
      if (e.role === "ask_out") { var ans = find(i, "ask_answer", e.peer), r = { a: me, b: e.peer, q: e.text, ans: ans ? ans.text : "…" }; map[e.id] = r; if (ans) map[ans.id] = r; if (curUser) (userAsks[curUser] = userAsks[curUser] || []).push(e.id); }
      if (e.role === "ask_in") { var rep = find(i, "ask_reply", e.peer), r2 = { a: e.peer, b: me, q: e.text, ans: rep ? rep.text : "…" }; map[e.id] = r2; if (rep) map[rep.id] = r2; }
    });
    return { map: map, userAsks: userAsks };
  }
  function entryView(e, rp, me) {
    var t = esc(e.text).split("\n").join("<br>");
    if (e.role === "user") {
      var rids = rp.userAsks[e.id];
      return rids ? '<div class="cm u" data-replay="' + esc(rids.join(",")) + '">' + t + '<span class="rpHint">▶ ดูอนิเมชันซ้ำ</span></div>' : '<div class="cm u">' + t + "</div>";
    }
    if (e.role === "model") {
      var acts = (e.actions || []).map(function (a, i) { return '<div class="actRow">' + actionView(a, i, e.id, (e.done || []).indexOf(i) >= 0) + "</div>"; }).join("");
      return '<div class="mrow">' + avatar(me) + '<div class="mcol"><span class="who">' + esc(peerName(me)) + '</span><div class="cm b">' + t + acts + "</div></div></div>";
    }
    var label = e.role === "ask_out" ? "↪ วิ่งไปถาม" + peerName(e.peer) : e.role === "ask_answer" ? "💬 " + peerName(e.peer) + " ตอบกลับ" : e.role === "ask_in" ? "📨 " + peerName(e.peer) + " วิ่งมาถาม" : e.role === "ask_reply" ? "↩ ตอบ" + peerName(e.peer) : null;
    if (label === null) return "";
    return '<div class="mrow sm">' + avatar(e.role === "ask_out" || e.role === "ask_reply" ? me : e.peer) + '<div class="mcol"><span class="who">' + esc(label) + '</span><div class="cm x"' + (rp.map[e.id] ? ' data-replay="' + esc(e.id) + '"' : "") + ">" + t + (rp.map[e.id] ? '<span class="rpHint">▶ ดูอนิเมชันซ้ำ</span>' : "") + "</div></div></div>";
  }
  function chatRender() {
    if (!ofSpirit || !$("ofChat")) return;
    var log = chatCache[ofSpirit] || [], me = ofSpirit; lastRp = buildReplays(log, me);
    $("ofChat").innerHTML = log.slice(-40).map(function (e) { return entryView(e, lastRp, me); }).join("") + (chatBusy ? '<div class="cm b muted">กำลังคิด… (ถ้าต้องถามภูติตัวอื่น อาจนานหน่อย)</div>' : "") +
      (ofKeyHint ? '<div class="cm x">ยังไม่ได้ใส่ Gemini API key จึงคุยอิสระไม่ได้ <button class="btn pri" type="button" data-chat="openkey">🔑 ใส่ key ตอนนี้</button></div>' : "");
    $("ofChat").scrollTop = 1e9; setChatCollapsed(chatCollapsed, true); if ($("ofKey")) $("ofKey").hidden = true;
    if (ofDef) $("ofRl").textContent = ofDef.role + (ai.has_key ? " · คุยกับ AI ได้ (Gemini ฟรี)" : " · ผู้ช่วยแบบกฎ ใช้ข้อมูลจริง");
  }
  function chatLoad(id) {
    return api("chat_log", { spirit: id }).then(function (r) { chatCache[id] = r.entries || []; if (ofSpirit === id) chatRender(); })
      .catch(function (e) { if (!authFail(e) && ofSpirit === id && /unknown action/.test(e.message)) toast("ระบบแชทยังไม่เปิดใช้ (อัปเดตสคริปต์ก่อน)"); });
  }
  function aiLoad() {
    return api("ai_status").then(function (r) { ai.has_key = !!r.has_key; if (ofSpirit) chatRender(); }).catch(function () { /* old script: keep unknown */ });
  }
  function chatSend(txt) {
    txt = String(txt || "").trim(); if (!txt || chatBusy || !ofSpirit) return;
    var id = ofSpirit; setChatCollapsed(false, true);
    var rr = ai.has_key === false ? ruleReply(txt) : null, known = {}; (chatCache[id] || []).forEach(function (e) { known[e.id] = 1; });
    var watcher = rr ? null : watch(id, known); chatBusy = true;
    (chatCache[id] = chatCache[id] || []).push({ id: "tmp", role: "user", text: txt }); chatRender();
    var p = rr ? api("chat_append", { spirit: id, user: txt, reply: rr.reply, actions: rr.actions }) : api("chat", { spirit: id, message: txt }, 110000);
    p.catch(function (e) { if (authFail(e)) return; if (/GEMINI_KEY|ยังไม่ได้ใส่/.test(e.message)) { ai.has_key = false; ofKeyHint = true; toast("ยังไม่ได้ใส่ Gemini API key"); } else toast("⚠️ " + e.message); })
      .then(function () { chatBusy = false; return watcher ? watcher.stop() : null; }).then(function () { return chatLoad(id); }).then(function () { chatRender(); });
  }
  function chatAct(eid, i) {
    var e = (chatCache[ofSpirit] || []).filter(function (x) { return x.id === eid; })[0], a = e && (e.actions || [])[i], spirit = ofSpirit; if (!a) return;
    function finish() { e.done = (e.done || []).concat([i]); chatRender(); api("chat_done", { spirit: spirit, id: eid, index: i }).catch(function () {}); }
    if (a.type === "open_pending") { finish(); closeSheet(); openPending(); }
    else if (a.type === "open_day") { finish(); closeSheet(); openNote(a.date); }
    else if (a.type === "open_spirit") { finish(); var asset = ofAssets && ofAssets.chars.filter(function (c) { return c.id === a.id; })[0]; if (asset && Office.BY[a.id]) openSheet(Office.BY[a.id], asset); }
    else if (a.type === "sync") { finish(); syncNow(); }
    else if (a.type === "decide_folder") {
      api("inbox").then(function (r) {
        var items = (r.items || []).filter(function (f) { return f.folder_name === a.folder && f.decision === "pending"; }).map(function (f) { return { file_id: f.id, version: f.version }; });
        if (!items.length) { toast("ไม่พบไฟล์ค้างในแฟ้ม “" + a.folder + "”"); return; }
        return decide(items, a.decision).then(function (d) { toast("ตั้งแล้ว " + d.done.length + " ไฟล์"); finish(); ofDataAt = 0; officeData(); });
      }).catch(function (er) { toast(er.message); });
    }
  }
  function saveInlineKey() {
    var inp = $("keyIn"), key = inp ? inp.value.trim() : ""; if (!key) { toast("วาง key ก่อน"); return; }
    toast("กำลังตรวจ key กับ Google…");
    api("ai_setkey", { key: key }, 30000).then(function (r) { ai.has_key = !!r.has_key; toast(r.has_key ? "บันทึก key แล้ว ลองคุยได้เลย" : "ลบ key แล้ว"); chatRender(); }).catch(function (e) { if (!authFail(e)) toast("⚠️ " + e.message); });
  }
  /* ---------- "A runs to ask B" popup (port of the PC app: live while waiting, answer bar, replay) ---------- */
  var HOLD_MS = 6000, fx = { on: false, since: 0, answered: false, answeredAt: 0, peer: null, closeT: null, replayT: null, userClosed: false, token: 0, chainNext: null, item: null };
  function fxBuild() {
    var d = $("ofAsk"); if (!d || d.dataset.built) return; d.dataset.built = "1";
    var hearts = ""; for (var i = 0; i < 7; i++) hearts += '<span class="fxHeart" style="left:' + (8 + i * 13) + "%;animation-delay:" + (i * 0.33) + 's">' + ["💖", "✨", "💬", "💗", "⭐", "💞", "✨"][i] + "</span>";
    d.innerHTML = '<div class="fxCard" id="fxCard"><button class="fxClose" id="fxClose" type="button" aria-label="ปิด">✕</button><div class="fxRow">' +
      '<div class="fxSide a"><div class="fxBub" id="fxABub"></div><img id="fxAImg" alt=""><div class="fxName" id="fxAName"></div></div><div class="fxMid">💬</div>' +
      '<div class="fxSide b"><div class="fxBub typing" id="fxBBub"><i></i><i></i><i></i></div><img id="fxBImg" alt=""><div class="fxName" id="fxBName"></div></div>' +
      '</div><div class="fxCap" id="fxCap"></div><div class="fxFoot"><button class="fxAgain" id="fxAgain" type="button" hidden>↻ ดูอีกครั้ง</button></div><div class="fxBar" id="fxBar" hidden></div>' + hearts + "</div>";
  }
  function chImg(id) { var c = ofAssets && ofAssets.chars.filter(function (x) { return x.id === id; })[0]; return c && office ? office.u(c.day) : ""; }
  function fxStart(a, b, q) {
    fxBuild(); clearTimeout(fx.closeT); var ta = theme(a), tb = theme(b);
    $("fxCard").style.background = "linear-gradient(100deg," + (ta.card || ta.s) + " 0 50%," + (tb.card || tb.s) + " 50% 100%)";
    $("fxAImg").src = chImg(a); $("fxBImg").src = chImg(b); $("fxAName").textContent = peerName(a); $("fxBName").textContent = peerName(b);
    var ab = $("fxABub"); ab.textContent = trunc(q, 110); ab.style.animation = "none"; void ab.offsetWidth; ab.style.animation = "";
    var bb = $("fxBBub"); bb.className = "fxBub typing"; bb.innerHTML = "<i></i><i></i><i></i>";
    $("fxCap").textContent = peerName(a) + " กำลังวิ่งไปถาม" + peerName(b) + "…"; $("fxBar").hidden = true; $("fxAgain").hidden = true; $("ofAsk").hidden = false;
    fx.on = true; fx.since = Date.now(); fx.answered = false; fx.peer = b;
  }
  function fxAnswer(text, auto) {
    if (!fx.on) return;
    var bb = $("fxBBub"); bb.className = "fxBub"; bb.textContent = trunc(text, 110); bb.style.animation = "none"; void bb.offsetWidth; bb.style.animation = "";
    $("fxCap").textContent = peerName(fx.peer) + "ตอบแล้ว! กำลังวิ่งกลับไปบอก…"; fx.answered = true; fx.answeredAt = Date.now();
    var bar = $("fxBar"); bar.hidden = false; bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = "fxBar " + HOLD_MS + "ms linear forwards"; $("fxAgain").hidden = false;
    if (auto) { clearTimeout(fx.closeT); fx.closeT = setTimeout(fxAutoHide, HOLD_MS); }
  }
  function fxReset() { clearTimeout(fx.closeT); clearTimeout(fx.replayT); }
  function fxAutoHide() { var next = fx.chainNext; fx.chainNext = null; fxHide(); if (next) next(); }
  function fxHide() { fxReset(); var e = $("ofAsk"); if (e) e.hidden = true; fx.on = false; }
  function fxUserClose() { fx.userClosed = true; fx.chainNext = null; fx.token++; fxHide(); }
  function fxCloseSoon() {
    if (!fx.on) return; var now = Date.now(), wait = Math.max(0, fx.since + 1800 - now, fx.answered ? fx.answeredAt + HOLD_MS - now : 900);
    clearTimeout(fx.closeT); fx.closeT = setTimeout(fxAutoHide, wait);
  }
  function replay(items) {                                       // stored exchanges {a,b,q,ans}: question + typing dots, then the answer, one after the other
    var list = (items || []).filter(Boolean); if (!list.length) return;
    fxBuild(); fxReset(); var tok = ++fx.token, i = 0;
    function next() {
      if (tok !== fx.token || i >= list.length) return;
      var it = list[i++]; fx.item = it; fx.userClosed = false; fxStart(it.a, it.b, it.q); fx.chainNext = i < list.length ? next : null;
      fx.replayT = setTimeout(function () { if (tok === fx.token && fx.on) fxAnswer(it.ans, true); }, 1700);
    }
    next();
  }
  function watch(spirit, known) {                                // poll the shared log while a request runs; show the popup as soon as `spirit` asks someone
    var seen = {}, timer = null, busyTick = false; fx.userClosed = false;
    function tick() {
      if (busyTick) return Promise.resolve(); busyTick = true;
      return api("chat_log", { spirit: spirit }).then(function (r) {
        (r.entries || []).forEach(function (e) {
          if (known[e.id] || seen[e.id]) return;
          if (e.role === "ask_out") { seen[e.id] = 1; if (!fx.userClosed) { fx.item = { a: spirit, b: e.peer, q: e.text, ans: "…" }; fxStart(spirit, e.peer, e.text); } }
          else if (e.role === "ask_answer") { seen[e.id] = 1; if (fx.item && fx.item.b === e.peer) fx.item.ans = e.text; if (fx.on && fx.peer === e.peer) fxAnswer(e.text); }
        });
      }).catch(function () {}).then(function () { busyTick = false; });
    }
    timer = setInterval(tick, 1500);
    return { stop: function () { clearInterval(timer); return tick().then(fxCloseSoon); } };
  }
  function askStop() { fxUserClose(); }
  /* ---------- the daily note and the pending list open over the room (swipe down to close) ---------- */
  var NOTE_ICON = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="7" y="8" width="34" height="37" rx="7" fill="#b8794a" stroke="#8d5a33" stroke-width="2.5"/><rect x="12" y="14" width="24" height="26" rx="3.5" fill="#fff8e6"/><rect x="16" y="3" width="16" height="10" rx="4.5" fill="#efe0c2" stroke="#8d5a33" stroke-width="2.5"/><path d="M17 22h14M17 28h14M17 34h8" stroke="#e9b36a" stroke-width="2.4" stroke-linecap="round"/><path d="M33 31l1.3 2.7 2.9.4-2.1 2 .5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.1-2 2.9-.4z" fill="#f2b43a"/></svg>';
  var noteKind = "day";
  function openNote(date) { noteKind = "day"; openOverlay(/^\d{4}-\d{2}-\d{2}$/.test(date || "") && date <= todayStr() ? date : todayStr()); }
  function openPending() { noteKind = "pending"; openOverlay(todayStr()); }
  function openOverlay(date) {
    var o = $("office"); if (!o) return; noteOpen = true; day = date; bulk = { armed: false, t: null, last: null };
    var w = $("noteWrap"); if (!w) { w = document.createElement("div"); w.id = "noteWrap"; o.appendChild(w); }
    w.hidden = false; w.innerHTML = '<button class="noteBack" id="noteBack" type="button" aria-label="ปิด">←</button><div id="content"><div class="noteEmpty">กำลังโหลด…</div></div><div class="noteBulk" id="noteBulk" hidden></div>';
    if (!w.dataset.sw) {
      w.dataset.sw = "1"; var y0 = null;
      w.addEventListener("touchstart", function (e) { var sc = w.querySelector(".paper, .plain"); y0 = (!sc || sc.scrollTop <= 0) ? e.touches[0].clientY : null; }, { passive: true });
      w.addEventListener("touchend", function (e) { if (y0 != null && e.changedTouches[0].clientY - y0 > 110) closeNote(); y0 = null; }, { passive: true });
    }
    loadNote();
  }
  function loadNote(keep) {
    var pa = keep ? document.querySelector("#noteWrap .paper, #noteWrap .plain") : null, sc = pa ? pa.scrollTop : 0, kind = noteKind, ck = "notedy.cache.day." + day;
    if (kind === "day" && !keep && $("content")) { var c0 = lsGet(ck); if (c0) { $("content").innerHTML = dayHtml(c0); bulkRender(); } }       // last known page first
    var job = kind === "pending" ? Promise.all([api("inbox"), Promise.resolve(null)]) : Promise.all([api("daily", { date: day }), api("status")]);
    return job.then(function (r) {
      if (!noteOpen || !$("content") || kind !== noteKind) return; bulk.last = null; bulk.armed = false;
      if (kind === "pending") { status = r[0].status || status; $("content").innerHTML = pendingHtml(r[0]); } else { status = r[1]; $("content").innerHTML = dayHtml(r[0]); lsSet(ck, r[0]); }
      bulkRender(); headerOffice();
      if (sc) { var np = document.querySelector("#noteWrap .paper, #noteWrap .plain"); if (np) np.scrollTop = sc; }
    }).catch(function (e) { if (!authFail(e) && $("content")) $("content").innerHTML = '<div class="board"><div class="boardClip"></div><div class="paper"><div class="noteEmpty">เปิดไม่ได้: ' + esc(e.message) + "</div></div></div>"; });
  }
  function closeNote() { noteOpen = false; var w = $("noteWrap"); if (w) { w.hidden = true; w.innerHTML = ""; } ofDataAt = 0; if (view === "office") officeData(); }
  function buildStrip(active) {
    var st = $("ofStrip"); if (!st || !ofAssets) return;
    st.innerHTML = Office.ROSTER.filter(function (r) { return ofAssets.chars.some(function (c) { return c.id === r.id; }); }).map(function (r) {
      var c = ofAssets.chars.filter(function (x) { return x.id === r.id; })[0];
      return '<button type="button" data-sp="' + r.id + '" class="' + (r.id === active ? "on" : "") + '"><img src="' + office.u(c.day) + '" alt=""><span>' + esc(r.th) + "</span></button>";
    }).join("");
    var on = st.querySelector(".on"); if (on) st.scrollLeft = on.offsetLeft - st.clientWidth / 2 + on.offsetWidth / 2;
  }
  /* ---------- per-spirit pages (what each spirit can show from the cloud data) ---------- */
  var ofData = null, ofDataAt = 0, ofGroups = {}, ofDef = null, chatCollapsed = true;
  try { chatCollapsed = localStorage.getItem("notedy.chat.collapsed") !== "0"; } catch (e) { /* default: collapsed so the page is not covered */ }
  function bkkDay(iso) { return new Date(new Date(iso).getTime() + 7 * 3600e3).toISOString().slice(0, 10); }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked: just no cache */ } }
  function dayDiff(a, b) { return Math.round((new Date(a + "T12:00:00") - new Date(b + "T12:00:00")) / 864e5); }       // a - b in days
  function periodRange() {                                      // the monthly round runs from the 26th to the 26th
    var t = todayStr().split("-").map(Number), y = t[0], m = t[1], d = t[2], sy, sm, ey, em;
    if (d >= 26) { sy = y; sm = m; ey = m === 12 ? y + 1 : y; em = m === 12 ? 1 : m + 1; } else { ey = y; em = m; sy = m === 1 ? y - 1 : y; sm = m === 1 ? 12 : m - 1; }
    return { from: sy + "-" + p2(sm) + "-26", to: ey + "-" + p2(em) + "-26" };
  }
  function periodShift(pr, k) {
    function sh(s) { var p = s.split("-").map(Number), i = p[0] * 12 + (p[1] - 1) - k; return Math.floor(i / 12) + "-" + p2(i % 12 + 1) + "-26"; }
    return { from: sh(pr.from), to: sh(pr.to) };
  }
  function periodList() { var cur = periodRange(), out = []; for (var k = 0; k < 12; k++) out.push(periodShift(cur, k)); return out; }
  var ofPer = null, calM = null, calSel = null, mintyArm = null, mintyLast = null, bfMsg = "", pdfMsg = "", csvMsg = "", pdPrev = null, pdWho = null;
  function periodSel() { return ofPer || periodRange(); }
  function periodLabel(pr) { return shortDate(pr.from) + " – " + shortDate(pr.to) + " " + pr.to.slice(0, 4); }
  function inPeriod(items, pr) { return items.filter(function (f) { var d = f.modifiedTime ? bkkDay(f.modifiedTime) : ""; return d >= pr.from && d <= pr.to; }); }
  function docScale() { var v = Number(lsGet("notedy.docScale")); return v >= 0.8 && v <= 1.2 ? v : 1; }
  function loadSpiritData(force, onCache) {
    if (!force && ofData && Date.now() - ofDataAt < 45000) return Promise.resolve(ofData);
    if (!ofData && onCache) { var c = lsGet("notedy.cache.data"); if (c && c.items) { ofData = { items: c.items, daily: c.daily || { files: [] } }; onCache(ofData); } }   // show what we saw last time at once, refresh behind it
    return Promise.all([api("inbox"), api("daily", { date: todayStr() })]).then(function (r) {
      ofData = { items: r[0].items || [], daily: r[1] }; ofDataAt = Date.now(); if (r[0].status) status = r[0].status; lsSet("notedy.cache.data", { items: ofData.items, daily: ofData.daily, at: Date.now() }); return ofData;
    });
  }
  function newest(g) { var m = ""; g.files.forEach(function (f) { if (f.modifiedTime > m) m = f.modifiedTime; }); return m; }
  function card(title, inner, cls) { return '<div class="card ' + (cls || "") + '"><h3>' + title + "</h3>" + inner + "</div>"; }
  function goBtn(go, label) { return '<button type="button" class="pbtn" data-go="' + go + '">' + label + "</button>"; }
  function actBtn(act, label, extra, cls) { return '<button type="button" class="pbtn' + (cls ? " " + cls : "") + '" data-act="' + act + '"' + (extra || "") + ">" + label + "</button>"; }
  function itemRow(g, decide) {
    ofGroups[g.gid] = g.files.map(function (f) { return { file_id: f.id, version: f.version }; });
    var sub = g.files.length + " ไฟล์ · " + dayTime(newest(g)) + (g.path ? " · " + g.path : "");
    return '<div class="item"><div class="nm"><b>' + (g.folder ? "📁 " : "") + esc(g.name) + "</b><small>" + esc(sub) + "</small></div>" +
      (decide ? '<div class="dec"><button type="button" class="dbtn ok" data-md="work" data-g="' + esc(g.gid) + '">✓ งาน</button><button type="button" class="dbtn no" data-md="not-work" data-g="' + esc(g.gid) + '">✕ ไม่ใช่</button></div><select class="catSel" aria-label="หมวดงาน">' + catOpts() + "</select>"
              : (g.link ? '<a class="lnk" href="' + esc(g.link) + '" target="_blank" rel="noopener">เปิด ↗</a>' : "")) + "</div>";
  }
  function searchHtml(q, from, to, sort) {
    var items = (ofData && ofData.items) || [], ql = String(q || "").trim().toLowerCase(), hit = items;
    if (ql) hit = hit.filter(function (f) { return (f.name || "").toLowerCase().indexOf(ql) >= 0 || (f.folder_name || "").toLowerCase().indexOf(ql) >= 0; });
    if (from || to) hit = hit.filter(function (f) { var d = f.modifiedTime ? bkkDay(f.modifiedTime) : ""; return (!from || d >= from) && (!to || d <= to); });
    var asc = sort === "old"; hit = hit.slice().sort(function (a, b) { return a.modifiedTime < b.modifiedTime ? (asc ? -1 : 1) : (asc ? 1 : -1); });
    var shown = hit.slice(0, 30);
    return '<div class="muted">' + (ql || from || to ? "พบ " + hit.length + " ไฟล์" : "ไฟล์ล่าสุด") + (hit.length > 30 ? " (แสดง 30 รายการแรก)" : "") + "</div>" + (shown.length ? shown.map(function (f) {
      return '<div class="item"><div class="nm"><b>' + esc(f.name) + "</b><small>" + esc((f.folder_name ? "📁 " + f.folder_name + " · " : "") + dayTime(f.modifiedTime)) + "</small></div>" + tagHtml(f.decision || "pending", true) + (f.link ? ' <a class="lnk" href="' + esc(f.link) + '" target="_blank" rel="noopener">เปิด</a>' : "") + "</div>";
    }).join("") : '<div class="muted">ไม่พบไฟล์ที่ตรงกัน</div>');
  }
  function searchRefresh() {
    var r = $("ofSearchRes"); if (r) r.innerHTML = searchHtml($("ofSearch").value, $("ofSF").value, $("ofST").value, $("ofSS").value);
  }
  /* ---- Clouddy: issues you checked yourself are hidden (kept on this device); they come back if the number changes ---- */
  function acksGet() { return lsGet("notedy.acks") || {}; }
  /* ---- Sunny: statistics for the chosen round ---- */
  function sunnyStats(items, pr) {
    var inP = inPeriod(items, pr), work = inP.filter(function (f) { return f.decision === "work"; }), np = inP.filter(function (f) { return f.decision === "not-work"; }).length, pe = inP.filter(function (f) { return (f.decision || "pending") === "pending"; }).length;
    var byDay = {}; inP.forEach(function (f) { var d = bkkDay(f.modifiedTime); byDay[d] = (byDay[d] || 0) + 1; });
    var days = Object.keys(byDay).sort(), best = null; days.forEach(function (d) { if (!best || byDay[d] > byDay[best]) best = d; });
    var gs = groupFiles(work).sort(function (a, b) { return b.files.length - a.files.length; });
    var bars = [], d0 = pr.from, end = pr.to < todayStr() ? pr.to : todayStr(), max = 0;
    for (var d = d0, guard = 0; d <= end && guard < 40; d = addDays(d, 1), guard++) { var n = byDay[d] || 0; bars.push({ d: d, n: n }); if (n > max) max = n; }
    return { inP: inP, work: work, notWork: np, pending: pe, byDay: byDay, activeDays: days.length, best: best, folders: gs, bars: bars, max: max };
  }
  function sunnyText(st, pr) {
    var lines = ["สรุปงาน " + periodLabel(pr), "รวม " + st.folders.length + " ชิ้นงาน " + st.work.length + " ไฟล์ (ยืนยันเป็นงาน)", "วันที่ทำงาน " + st.activeDays + " วัน" + (st.best ? " · เยอะสุด " + shortDate(st.best) + " (" + st.byDay[st.best] + " ไฟล์)" : "")];
    st.folders.slice(0, 12).forEach(function (g) { lines.push("- " + g.name + ": " + g.files.length + " ไฟล์"); });
    return lines.join("\n");
  }
  /* ---- Planly: cute calendar ---- */
  var TH_MON_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  function calHtml(items, pr) {
    var t = todayStr(), cm = calM || (calM = { y: +t.slice(0, 4), m: +t.slice(5, 7) }), by = {};
    items.forEach(function (f) { if (f.modifiedTime) { var d = bkkDay(f.modifiedTime); by[d] = (by[d] || 0) + 1; } });
    var first = new Date(cm.y, cm.m - 1, 1).getDay(), dim = new Date(cm.y, cm.m, 0).getDate(), cells = "";
    ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"].forEach(function (w) { cells += '<div class="cw">' + w + "</div>"; });
    for (var i = 0; i < first; i++) cells += "<div></div>";
    for (var dd = 1; dd <= dim; dd++) {
      var ds = cm.y + "-" + p2(cm.m) + "-" + p2(dd), n = by[ds] || 0, cls = "cd" + (ds === t ? " today" : "") + (ds >= pr.from && ds <= pr.to ? " inr" : "") + (dd === 26 ? " due" : "") + (calSel === ds ? " sel" : "");
      cells += '<button type="button" class="' + cls + '" data-act="cal-day" data-d="' + ds + '"><b>' + dd + "</b>" + (dd === 26 ? '<span class="star">⭐</span>' : "") + (n ? '<span class="dots">' + "●".repeat(Math.min(3, Math.ceil(n / 8))) + "</span>" : "") + "</button>";
    }
    var sel = "";
    if (calSel) {
      var gs = groupFiles(items.filter(function (f) { return f.modifiedTime && bkkDay(f.modifiedTime) === calSel; }));
      sel = '<div class="calsel"><b>' + esc(longDate(calSel)) + "</b>" + (gs.length ? gs.slice(0, 8).map(function (g) { return '<div class="item"><div class="nm"><b>📁 ' + esc(g.name) + "</b><small>" + g.files.length + " ไฟล์</small></div>" + (g.link ? '<a class="lnk" href="' + esc(g.link) + '" target="_blank" rel="noopener">เปิด ↗</a>' : "") + "</div>"; }).join("") : '<div class="muted">ไม่มีไฟล์เปลี่ยนในวันนี้</div>') + "</div>";
    }
    return '<div class="calhd"><button type="button" class="cn" data-act="cal-prev" aria-label="เดือนก่อน">‹</button><b>🗓️ ' + TH_MON_FULL[cm.m - 1] + " " + cm.y + '</b><button type="button" class="cn" data-act="cal-next" aria-label="เดือนถัดไป">›</button></div><div class="calgrid">' + cells + '</div><div class="muted cleg">⭐ วันส่ง (26) · ● วันที่มีไฟล์เปลี่ยน · พื้นชมพูอ่อน = รอบที่เลือก</div>' + sel;
  }
  var FAQ = [
    { k: ["ตัดสิน", "ค้างตรวจ", "เป็นงาน", "ไม่ใช่งาน", "ตรวจ"], q: "ตัดสินแฟ้มยังไง", a: "เปิดโน้ตรายวัน (ปุ่มคลิปบอร์ดมุมบนซ้าย) หรือคุยกับมินตี้ แล้วกด ✓ เป็นงาน / ✕ ไม่ใช่งาน ต่อแฟ้ม ตัดสินผิดกด “↩ แก้การตัดสิน” ได้ ถ้าถูกทั้งหมดมีปุ่ม “ถูกทั้งหมด” (แตะสองครั้ง)" },
    { k: ["ซิงก์", "drive", "ดึง", "อัปเดต"], q: "ซิงก์ Drive", a: "ซิงก์อัตโนมัติทุก 30 นาที หรือกด ⚙ → ซิงก์ Drive ตอนนี้ (หรือพิมพ์ “ซิงก์” คุยกับภูติ)" },
    { k: ["ย้อนหลัง", "รอบเก่า", "เดือนก่อน", "ช่วงวันที่"], q: "ดึงงานย้อนหลัง", a: "เปิดหน้าไดรฟ์วี่ → “ดึงย้อนหลังตามช่วงวันที่” เลือกวันเริ่ม–สิ้นสุด (ไม่เกิน 400 วัน) แล้วกดดึง ผลที่ตัดสินไว้แล้วไม่หาย" },
    { k: ["key", "ai", "คุยไม่ได้", "gemini", "api"], q: "ภูติคุยไม่ได้ / ใส่ API key", a: "กด ⚙ → ใส่ Gemini API key (ขอฟรีที่ aistudio.google.com/apikey) ถ้ายังไม่มี key ภูติตอบคำสั่งพื้นฐานแบบกฎได้ เช่น “ค้างตรวจ” “ซิงก์” “สรุปรอบ”" },
    { k: ["รหัส", "pin", "ลืม"], q: "ลืมรหัสผ่านแอป", a: "ให้ผู้พัฒนารัน resetPin ในสคริปต์ แล้วเปิดแอปตั้งรหัสใหม่ (ใส่ผิด 5 ครั้งล็อก 15 นาที)" },
    { k: ["มือถือ", "เครื่องอื่น", "qr", "คอม"], q: "เปิดบนเครื่องอื่น", a: "บนเครื่องที่เปิดอยู่ กด ⚙ → เปิดบนมือถือ (QR) แล้วสแกนด้วยกล้อง จากนั้นใส่รหัสผ่านแอปเดิม" },
    { k: ["หมวด", "สรุปเต็ม", "จัดหมวด", "หน้าเต็ม"], q: "จัดหมวดงาน / หน้าสรุปเต็ม", a: "แตะปุ่ม 📊 ข้างโน้ตรายวันที่หน้าห้อง (หรือปุ่มสรุปงานในเมนูลัด) จะเปิดหน้าสรุปเต็ม เลือกดูตามหมวด ย้ายชิ้นงานเข้าหมวด แก้ชื่อ และสร้าง PDF ส่วนตอนตรวจงานที่มินตี้ก็เลือกหมวดได้ที่ช่อง “หมวด” ข้างปุ่ม ✓ งาน" },
    { k: ["pdf", "พีดีเอฟ", "รายงาน", "hr"], q: "สร้าง PDF ส่ง HR", a: "ไปที่นิวนิว (หรือดรอวี่) เลือกช่วงวันที่แล้วกดสร้าง PDF จะเปิดให้บันทึกลงโทรศัพท์ (Files) หรือแชร์ต่อ" },
    { k: ["แจ้งเตือน", "เด้ง", "popup", "noti"], q: "การแจ้งเตือนแฟ้มใหม่", a: "บน iPhone เพิ่มแอปลงหน้าจอโฮมก่อน (แชร์ → เพิ่มลงหน้าจอโฮม) เปิดจากไอคอน แล้วกด ⚙ → แจ้งเตือนบนมือถือ → เปิด จะเด้งเตือนเมื่อมีแฟ้มอัปเดตใหม่ (นับเป็นแฟ้ม) แม้ปิดแอปอยู่" }
  ];
  function faqAnswer(i) { var f = FAQ[i]; return card(esc(f.q), '<div style="line-height:1.7">' + esc(f.a) + "</div>"); }
  function pdfRange() { var f = $("pdFrom") && $("pdFrom").value, t = $("pdTo") && $("pdTo").value, pr = periodSel(); return { from: f || pr.from, to: t || pr.to }; }
  function pdfBlock(def, d) {
    var pr = periodSel(), items = inPeriod(d.items, pr), work = items.filter(function (f) { return f.decision === "work"; }), gs = groupFiles(work), sc = Math.round(docScale() * 100);
    var scale = def.id === "Drawy" ? card("ขนาดตัวอักษรเอกสาร", '<div class="stat"><b>' + sc + '%</b></div><div class="row">' + actBtn("scale", "A−", ' data-d="-0.05"', "ghost") + actBtn("scale", "A+", ' data-d="0.05"', "ghost") + actBtn("scale", "100%", ' data-reset="1"', "ghost") + '</div><div class="muted">มีผลกับ PDF ที่สร้างจากมือถือ (80–120%)</div>') : "";
    return scale + card("📄 สร้าง PDF สรุปงาน", '<div class="muted">รอบที่เลือก: ' + esc(periodLabel(pr)) + " · ตอนนี้ยืนยันเป็นงานแล้ว <b>" + gs.length + "</b> ชิ้นงาน (" + work.length + ' ไฟล์) · เปลี่ยนรอบที่พิลล์มุมบนซ้าย หรือเลือกช่วงเอง:</div>' +
      '<div class="row"><input type="date" id="pdFrom" value="' + pr.from + '"> – <input type="date" id="pdTo" value="' + pr.to + '"></div><div class="row">' + actBtn("pdf", "📄 สร้าง PDF") + goBtn("work", "📊 หน้าสรุปเต็ม (จัดหมวด)") + "</div>" +
      '<div id="pdfSt" class="muted">' + esc(pdfMsg) + '</div><div class="muted">เสร็จแล้วจะเปิดหน้าให้เลือกบันทึกลงโทรศัพท์ (ไฟล์) หรือแชร์ต่อ ในรายงานนับเฉพาะแฟ้มที่ตัดสินเป็น “เป็นงาน”</div>') +
      card("🗂️ จัดหมวดชิ้นงานใน PDF", '<div class="muted">หน้าตา PDF เหมือนแบบที่ทำบนคอม: หมวด | ชิ้นงาน (จำนวนไฟล์) | เปิดไฟล์ — เลือกหมวดของแต่ละชิ้นงานที่นี่ ระบบจำไว้ใช้รอบถัดไป</div>' +
        '<div class="row"><input type="text" id="pdWho" placeholder="ชื่อใต้หัวเรื่อง (Graphic Designer)" value="' + esc(pdWho == null ? "" : pdWho) + '"> ' + actBtn("pdwho", "บันทึกชื่อ", "", "ghost") + "</div>" +
        '<div class="row">' + actBtn("pdcats", "🗂️ โหลดชิ้นงานของรอบนี้", "", "ghost") + '</div><div id="pdCats">' + pdCatsHtml() + "</div>");
  }
  function pdCatsHtml() {
    if (!pdPrev) return "";
    if (!pdPrev.groups.length) return '<div class="muted">ยังไม่มีงานที่ยืนยันเป็น “เป็นงาน” ในช่วงนี้</div>';
    var cats = pdPrev.cats.slice(), opts = function (cur) { var all = cats.slice(); if (cur && cur !== "ไม่ระบุหมวด" && all.indexOf(cur) < 0) all.push(cur); return '<option value="">ไม่ระบุหมวด</option>' + all.map(function (c) { return '<option value="' + esc(c) + '"' + (c === cur ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") + '<option value="__new">+ หมวดใหม่…</option>'; };
    return pdPrev.groups.map(function (g) {
      return '<div class="muted" style="margin-top:8px"><b>' + esc(g.cat) + "</b></div>" + g.rows.map(function (p) {
        return '<div class="row" style="align-items:center"><div style="flex:1;min-width:0;font-size:13px">' + esc(p.name) + ' <span class="muted">' + p.files + ' ไฟล์</span></div><select data-pdassign="' + esc(p.pid) + '">' + opts(g.cat) + "</select></div>";
      }).join("");
    }).join("");
  }
  function bodyFor(def, d) {
    ofGroups = {};
    var items = d.items, pend = items.filter(function (f) { return f.decision === "pending"; }), pg = groupFiles(pend).sort(function (a, b) { return newest(b) < newest(a) ? -1 : 1; }), today = groupFiles(d.daily.files || []), pr = periodSel(), isCur = !ofPer;
    var out = '<div class="bubble">' + esc(sayFor(def)) + "</div>", dl = dayDiff(pr.to, todayStr());
    if (def.id === "Notedy") {
      var dec = today.filter(function (g) { return groupDecision(g) !== "pending"; }).length;
      out += card("🗓️ รอบ " + esc(periodLabel(pr)), '<div class="stat">' + (!isCur ? "รอบที่ผ่านมาแล้ว" : dl > 0 ? "เหลืออีก <b>" + dl + "</b> วันถึงวันส่ง" : dl === 0 ? "<b>วันนี้วันส่งแล้ว</b>" : "ผ่านวันส่งมาแล้ว <b>" + (-dl) + "</b> วัน") + '</div><div class="bar"><i style="width:' + Math.max(0, Math.min(100, Math.round(dayDiff(todayStr(), pr.from) * 100 / Math.max(1, dayDiff(pr.to, pr.from))))) + '%"></i></div><div class="muted">วันส่งคือ ' + esc(shortDate(pr.to)) + " (วันที่ 26)</div>");
      out += card("📒 สรุปวันนี้", '<div class="stat"><b>' + today.length + "</b> แฟ้มมีไฟล์เปลี่ยน · <b>" + (d.daily.files_total || 0) + '</b> ไฟล์</div><div class="bar"><i style="width:' + (today.length ? Math.round(dec * 100 / today.length) : 0) + '%"></i></div><div class="muted">ตัดสินแล้ว ' + dec + "/" + today.length + ' แฟ้ม</div><div class="row">' + goBtn("day", "📒 เปิดโน้ตรายวัน") + goBtn("pending", "📥 ค้างตรวจ (" + (status.pending || 0) + ")") + goBtn("work", "📊 หน้าสรุปเต็ม") + "</div>");
      if (pg.length) out += card("ค้างตรวจล่าสุด", pg.slice(0, 4).map(function (g) { return itemRow(g, false); }).join("") + (pg.length > 4 ? '<div class="muted">…อีก ' + (pg.length - 4) + " แฟ้ม</div>" : ""));
    } else if (def.id === "Minty") {
      var nPend = pend.length;
      out += card("📥 แฟ้มค้างตรวจ (" + pg.length + " แฟ้ม · " + nPend + " ไฟล์)", (pg.length ? pg.slice(0, 8).map(function (g) { return itemRow(g, true); }).join("") + (pg.length > 8 ? '<div class="muted">…อีก ' + (pg.length - 8) + " แฟ้ม</div>" : "") +
        '<div class="row">' + goBtn("pending", "ดูทั้งหมด") + "</div>" + '<div class="row">' + (mintyArm ? actBtn("minty-all", "แน่ใจไหม? แตะอีกครั้งเพื่อตั้ง “เป็นงาน” ทั้ง " + pg.length + " แฟ้ม (" + nPend + " ไฟล์)", "", "warnb") : actBtn("minty-all", "✓ ถูกทั้งหมด (" + pg.length + " แฟ้ม · " + nPend + " ไฟล์)", "", "okb")) + "</div>" : '<div class="muted">ไม่มีอะไรค้าง 🎉</div>') +
        (mintyLast ? '<div class="row"><span class="muted">✓ ตั้งเป็นงานแล้ว ' + mintyLast.length + " ไฟล์</span>" + actBtn("minty-undo", "↩ ยกเลิกทั้งหมด", "", "ghost") + "</div>" : ""));
      out += wkSummaryCard();
    } else if (def.id === "Drivey") {
      out += card("☁️ สถานะ Drive", '<div class="kv">ซิงก์ล่าสุด <b>' + (status.last_success ? esc(dayTime(status.last_success)) : "ยังไม่เคย") + '</b></div><div class="kv">ไฟล์ที่ติดตาม <b>' + (status.total || items.length) + "</b> · รอตรวจ <b>" + (status.pending || 0) + "</b></div>" +
        (status.error ? '<div class="warnTxt">ซิงก์ผิดพลาด: ' + esc(status.error) + "</div>" : '<div class="muted">ซิงก์อัตโนมัติทุก 30 นาที (อ่านเฉพาะชื่อ แฟ้ม วันที่ ไม่อ่านเนื้อไฟล์)</div>') + '<div class="row">' + goBtn("sync", "🔄 ซิงก์ตอนนี้") + goBtn("work", "📊 หน้าสรุปเต็ม") + "</div>");
      out += card("📅 ดึงย้อนหลังตามช่วงวันที่", '<div class="muted">เลือกช่วงไหนก็ได้ (ไม่เกิน 400 วัน) ไฟล์ที่เคยตัดสินแล้วจะไม่หาย</div><div class="row"><input type="date" id="bfFrom" value="' + pr.from + '"> – <input type="date" id="bfTo" value="' + pr.to + '"></div><div class="row">' + actBtn("backfill", "ดึงช่วงนี้") + '</div><div id="bfSt" class="muted">' + esc(bfMsg) + "</div>");
    } else if (def.id === "Clouddy") {
      var issues = [], acks = acksGet(), loose = items.filter(function (f) { return !f.folder_id && f.decision === "pending"; });
      if (status.error) issues.push({ key: "err", sig: String(status.error).slice(0, 40), t: "ซิงก์ Drive ผิดพลาด: " + esc(status.error) });
      if (status.last_success && Date.now() - new Date(status.last_success).getTime() > 3 * 3600e3) issues.push({ key: "stale", sig: bkkDay(status.last_success), t: "ซิงก์ล่าสุดเกิน 3 ชั่วโมงแล้ว" });
      if (loose.length) issues.push({ key: "loose", sig: String(loose.length), t: "ไฟล์ค้างตรวจที่ไม่อยู่ในแฟ้ม " + loose.length + " ไฟล์ (เช่น " + esc(trunc(loose[0].name, 28)) + ")" });
      pg.filter(function (g) { return g.files.length >= 40; }).slice(0, 5).forEach(function (g) { issues.push({ key: "big|" + g.gid, sig: String(g.files.length), t: "แฟ้ม “" + esc(trunc(g.name, 28)) + "” ค้างอยู่ " + g.files.length + " ไฟล์ (เยอะผิดปกติ)" }); });
      var live = issues.filter(function (i) { return acks[i.key] !== i.sig; }), hidden = issues.filter(function (i) { return acks[i.key] === i.sig; });
      function ackRow(i, on) { return "<li>" + i.t + '<label class="ack"><input type="checkbox" data-ack="' + esc(i.key) + '" data-sig="' + esc(i.sig) + '"' + (on ? " checked" : "") + "> ตรวจเองแล้ว ผ่าน</label></li>"; }
      out += card(live.length ? "⚠️ พบ " + live.length + " จุดที่ควรดู" : "✅ ตรวจแล้วไม่พบปัญหา", live.length ? '<ul class="chk">' + live.map(function (i) { return ackRow(i, false); }).join("") + "</ul>" : '<div class="muted">ซิงก์ปกติ · ไม่มีไฟล์หลุดแฟ้ม · ไม่มีแฟ้มค้างผิดปกติ' + (hidden.length ? " (มี " + hidden.length + " เรื่องที่คุณตรวจเองแล้ว ซ่อนไว้ด้านล่าง)" : "") + "</div>", live.length ? "warn" : "ok");
      if (hidden.length) out += card("ตรวจเองแล้ว ผ่าน (" + hidden.length + ")", '<div class="muted">เอาติ๊กออกเพื่อให้คราวดี้เตือนอีกครั้ง (ถ้าตัวเลขเปลี่ยนจะเตือนเองอยู่แล้ว)</div><ul class="chk">' + hidden.map(function (i) { return ackRow(i, true); }).join("") + "</ul>");
    } else if (def.id === "Sunny") {
      var st = sunnyStats(items, pr), pct = function (n) { return st.inP.length ? Math.round(n * 100 / st.inP.length) : 0; };
      out += card("☀️ สถิติรอบ " + esc(periodLabel(pr)), '<div class="tiles"><div><b>' + st.folders.length + "</b><span>แฟ้มงาน</span></div><div><b>" + st.work.length + "</b><span>ไฟล์งาน</span></div><div><b>" + st.activeDays + "</b><span>วันที่ทำงาน</span></div><div><b>" + (st.activeDays ? Math.round(st.inP.length / st.activeDays) : 0) + "</b><span>ไฟล์/วัน</span></div></div>" +
        (st.best ? '<div class="muted">วันที่เยอะสุด ' + esc(shortDate(st.best)) + " (" + st.byDay[st.best] + " ไฟล์)</div>" : "") +
        '<div class="split" title="ตัดสินแล้ว/ค้าง"><i class="w" style="width:' + pct(st.work.length) + '%"></i><i class="n" style="width:' + pct(st.notWork) + '%"></i><i class="p" style="width:' + pct(st.pending) + '%"></i></div><div class="muted">เป็นงาน ' + st.work.length + " · ไม่ใช่งาน " + st.notWork + " · ค้างตรวจ " + st.pending + "</div>");
      out += card("📊 ไฟล์ต่อวัน", st.bars.length ? '<div class="bars">' + st.bars.map(function (b) { return '<i style="height:' + (st.max ? Math.max(b.n ? 8 : 2, Math.round(b.n * 100 / st.max)) : 2) + '%" title="' + b.d + ": " + b.n + ' ไฟล์"></i>'; }).join("") + '</div><div class="muted bx"><span>' + esc(shortDate(pr.from)) + "</span><span>" + esc(shortDate(st.bars[st.bars.length - 1].d)) + "</span></div>" : '<div class="muted">รอบนี้ยังไม่เริ่ม</div>');
      out += card("🏆 แฟ้มที่ไฟล์เยอะสุด", st.folders.length ? '<table class="sum"><tr><th>แฟ้ม</th><th>ไฟล์</th></tr>' + st.folders.slice(0, 8).map(function (g) { return "<tr><td>" + esc(trunc(g.name, 34)) + "</td><td>" + g.files.length + "</td></tr>"; }).join("") + "</table>" : '<div class="muted">ยังไม่มีไฟล์ที่ตัดสินเป็นงานในรอบนี้</div>');
      ofCopy = sunnyText(st, pr); out += '<div class="row">' + actBtn("sunny-copy", "📋 คัดลอกสรุปเป็นข้อความ") + goBtn("pending", "📥 ไปตรวจต่อ") + goBtn("work", "📊 หน้าสรุปเต็ม") + "</div>";
    } else if (def.id === "Searchy") {
      out += card("🔎 ค้นหาไฟล์ย้อนหลัง", '<input id="ofSearch" class="sinp" placeholder="พิมพ์ชื่อไฟล์หรือชื่อแฟ้ม…" autocomplete="off" autocapitalize="off"><div class="row"><input type="date" id="ofSF" aria-label="ตั้งแต่วันที่"> – <input type="date" id="ofST" aria-label="ถึงวันที่"><select id="ofSS"><option value="new">ใหม่ → เก่า</option><option value="old">เก่า → ใหม่</option></select></div><div id="ofSearchRes">' + searchHtml("") + "</div>");
    } else if (def.id === "Linky") {
      var fl = groupFiles(items.filter(function (f) { return f.folder_id; })).sort(function (a, b) { return newest(b) < newest(a) ? -1 : 1; }), cut = addDays(todayStr(), -14);
      var rowL = function (g) { return '<div class="item"><div class="nm"><b>📁 ' + esc(g.name) + "</b><small>" + esc((g.path ? g.path + " · " : "") + dayTime(newest(g))) + "</small></div>" + (g.link ? '<a class="lnk" href="' + esc(g.link) + '" target="_blank" rel="noopener">เปิด ↗</a> <button type="button" class="dbtn ok" data-act="copylink" data-u="' + esc(g.link) + '" aria-label="คัดลอกลิงก์">📋</button>' : "") + "</div>"; };
      var recent = fl.filter(function (g) { return bkkDay(newest(g)) >= cut; }).slice(0, 12), stale = fl.filter(function (g) { return bkkDay(newest(g)) < cut; }).slice(0, 10);
      out += card("🔗 แฟ้มที่แก้ล่าสุด", recent.length ? recent.map(rowL).join("") : '<div class="muted">ไม่มีแฟ้มที่แก้ใน 14 วันนี้</div>');
      if (stale.length) out += card("😴 แฟ้มที่ไม่มีการแก้ไขเกิน 14 วัน", stale.map(rowL).join(""));
    } else if (def.id === "Planly") {
      var elapsed = Math.max(0, Math.min(100, Math.round(dayDiff(todayStr(), pr.from) * 100 / Math.max(1, dayDiff(pr.to, pr.from)))));
      out += '<div class="row">' + goBtn("work", "📊 เปิดหน้าสรุปเต็ม") + "</div>";
      out += card("🌸 นับถอยหลังวันส่ง", '<div class="stat">' + (!isCur ? "รอบ " + esc(periodLabel(pr)) + " (ผ่านมาแล้ว)" : dl > 0 ? "อีก <b>" + dl + "</b> วันถึงวันส่ง (" + esc(shortDate(pr.to)) + ")" : dl === 0 ? "<b>วันนี้วันส่ง!</b>" : "เลยวันส่งมา <b>" + (-dl) + "</b> วัน") + '</div><div class="bar"><i style="width:' + elapsed + '%"></i></div><div class="muted">ผ่านไป ' + elapsed + "% ของรอบ</div>");
      out += card("🗓️ ปฏิทิน", calHtml(items, pr));
      var okPend = status.pending === 0;
      out += card("🎀 แผนแนะนำก่อนวันส่ง", [["3 วันก่อน", "ซิงก์ Drive และตรวจแฟ้มที่ค้างให้หมด", okPend], ["2 วันก่อน", "ให้คราวดี้ตรวจความถูกต้อง", false], ["1 วันก่อน", "สร้าง PDF ร่างที่นิวนิว", false], ["วันส่ง", "สร้าง PDF ฉบับจริงแล้วส่ง HR", false]].map(function (x) { return '<div class="item"><div class="nm"><b>' + (x[2] ? "✅ " : "⬜ ") + x[1] + "</b><small>" + x[0] + "</small></div></div>"; }).join(""));
    } else if (def.id === "Newnew" || def.id === "Drawy") {
      out += pdfBlock(def, d);
    } else if (def.id === "Backy") {
      out += card("💾 สำรองข้อมูล", '<div class="muted">ข้อมูลทั้งหมดของแอปนี้เก็บอยู่ใน Google Sheet “Notedy Cloud” ของคุณเองอยู่แล้ว (มีประวัติเวอร์ชันของ Google) ส่งออกคิวไฟล์เป็น CSV เก็บไว้ในโทรศัพท์ได้ที่นี่</div><div class="row">' + actBtn("csv", "⬇ ส่งออกคิวเป็น CSV") + "</div>" + '<div id="csvSt" class="muted">' + esc(csvMsg) + "</div>");
      out += pdfBlock({ id: "Backy" }, d);
    } else if (def.id === "Buddy") {
      out += card("🐱 ทิปการใช้แอป", '<ul class="chk"><li>แตะภูติแต่ละตัวเพื่อดูงานของตัวนั้น</li><li>มินตี้ตัดสินแฟ้มค้างตรวจได้เลย (✓ งาน / ✕ ไม่ใช่)</li><li>โน๊ตดี้สรุปรอบ เสิร์ชชี่ค้นไฟล์ ซันนี่ทำสถิติ แพลนลี่มีปฏิทิน นิวนิวสร้าง PDF</li><li>⚙ เมนู: ซิงก์, QR, ใส่ key, แจ้งเตือน, ล้างประวัติแชต</li></ul>');
      out += '<div class="row">' + FAQ.map(function (f, i) { return '<button type="button" class="dbtn ok" data-act="faq" data-i="' + i + '">' + esc(f.q) + "</button>"; }).join("") + '</div><div class="row"><input id="bq" class="sinp" placeholder="พิมพ์คำถาม เช่น ลืมรหัส" autocomplete="off">' + actBtn("ask", "ถาม") + '</div><div id="bres"></div>';
      out += '<div class="muted">💬 ชวนบัดดี้คุยเล่นได้ที่แถบแชทด้านล่าง บัดดี้คุยเล่นอย่างเดียว ไม่นับเป็นงานและไม่สั่งให้ทำงานค่ะ</div>';
    }
    return out;
  }
  var ofCopy = "";
  function toBlob(b64, mime) { var bin = atob(b64), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new Blob([arr], { type: mime }); }
  function saveBlob(blob, name, mime) {                          // iPhone: the share sheet offers "Save to Files"; otherwise a normal download
    var file; try { file = new File([blob], name, { type: mime }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file], title: name }).catch(function (e) { if (e && e.name !== "AbortError") dl(); });
    dl(); return Promise.resolve();
    function dl() { var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }
  }
  function copyText(txt) { return (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast("คัดลอกแล้ว"); }, function () { toast("คัดลอกไม่ได้ ลองเลือกข้อความเอง"); }); }
  function bodyAct(b) {
    var a = b.dataset.act;
    if (a === "minty-all") {
      if (!mintyArm) { mintyArm = setTimeout(function () { mintyArm = null; if (ofDef && ofData) renderBody(ofDef, ofData); }, 4000); renderBody(ofDef, ofData); return; }
      clearTimeout(mintyArm); mintyArm = null;
      var all = ofData.items.filter(function (f) { return f.decision === "pending"; }).map(function (f) { return { file_id: f.id, version: f.version }; }), chunks = [], doneItems = [];
      for (var i = 0; i < all.length; i += 400) chunks.push(all.slice(i, i + 400));
      var p = Promise.resolve(); chunks.forEach(function (c) { p = p.then(function () { return decide(c, "work").then(function (r) { var ok = {}; r.done.forEach(function (id) { ok[id] = 1; }); doneItems = doneItems.concat(c.filter(function (x) { return ok[x.file_id]; })); }); }); });
      p.then(function () { mintyLast = doneItems; toast("ตั้งเป็นงานแล้ว " + doneItems.length + " ไฟล์"); ofDataAt = 0; officeData(); return loadSpiritData(true).then(function (d) { if (ofDef) renderBody(ofDef, d); }); }).catch(function (e) { toast(e.message); });
    } else if (a === "minty-undo") {
      var last = mintyLast || []; mintyLast = null;
      var p2_ = Promise.resolve(); for (var j = 0; j < last.length; j += 400) (function (c) { p2_ = p2_.then(function () { return decide(c, "pending"); }); })(last.slice(j, j + 400));
      p2_.then(function () { toast("ยกเลิกแล้ว"); ofDataAt = 0; officeData(); return loadSpiritData(true).then(function (d) { if (ofDef) renderBody(ofDef, d); }); }).catch(function (e) { toast(e.message); });
    } else if (a === "backfill") {
      var f = $("bfFrom").value, t = $("bfTo").value; if (!f || !t || f > t) { toast("เลือกวันที่เริ่มและสิ้นสุดให้ถูกต้อง"); return; }
      b.disabled = true; $("bfSt").textContent = "กำลังดึงจาก Drive… (ช่วงยาวอาจใช้เวลาหลายสิบวินาที)";
      api("backfill", { from: f, to: t }, 170000).then(function (r) { bfMsg = "ตรวจ " + r.reviewed + " ไฟล์ · ใหม่/เปลี่ยน " + r.added + (r.capped ? " (ไฟล์เยอะ ดึงได้บางส่วน ลองแบ่งเป็นช่วงสั้นลง)" : ""); ofDataAt = 0; officeData(); return loadSpiritData(true).then(function (d) { if (ofDef) renderBody(ofDef, d); }); })
        .catch(function (e) { if (!authFail(e)) { bfMsg = "⚠️ " + e.message; if (ofDef && ofData) renderBody(ofDef, ofData); } });
    } else if (a === "sunny-copy") copyText(ofCopy);
    else if (a === "copylink") copyText(b.dataset.u);
    else if (a === "cal-prev" || a === "cal-next") { var k = a === "cal-prev" ? -1 : 1, mm = calM.m + k, yy = calM.y; if (mm < 1) { mm = 12; yy--; } if (mm > 12) { mm = 1; yy++; } calM = { y: yy, m: mm }; renderBody(ofDef, ofData); }
    else if (a === "cal-day") { calSel = calSel === b.dataset.d ? null : b.dataset.d; renderBody(ofDef, ofData); }
    else if (a === "scale") { var v = b.dataset.reset ? 1 : Math.round(Math.min(1.2, Math.max(0.8, docScale() + parseFloat(b.dataset.d))) * 100) / 100; lsSet("notedy.docScale", v); renderBody(ofDef, ofData); }
    else if (a === "faq") { $("bres").innerHTML = faqAnswer(+b.dataset.i); }
    else if (a === "ask") {
      var q = ($("bq").value || "").toLowerCase().trim(), best = -1, sc = 0; if (!q) return;
      FAQ.forEach(function (fq, i) { var n = fq.k.filter(function (k2) { return q.indexOf(k2) >= 0; }).length; if (n > sc) { sc = n; best = i; } });
      $("bres").innerHTML = best >= 0 ? faqAnswer(best) : card("ยังไม่เจอคำตอบ", '<div class="muted">ลองกดหัวข้อด้านบน หรือถามด้วยคำอื่น เช่น ซิงก์, รหัส, pdf, key, แจ้งเตือน</div>');
    } else if (a === "csv") {
      var rows = [["ชื่อไฟล์", "แฟ้ม", "แก้ไขล่าสุด", "สถานะ", "ลิงก์"]].concat(ofData.items.map(function (f) { return [f.name, f.folder_name || "", f.modifiedTime || "", f.decision || "pending", f.link || ""]; }));
      var csv = "﻿" + rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(","); }).join("\r\n");
      saveBlob(new Blob([csv], { type: "text/csv" }), "notedy-queue-" + todayStr() + ".csv", "text/csv").then(function () { csvMsg = "ส่งออกแล้ว " + ofData.items.length + " รายการ"; var s = $("csvSt"); if (s) s.textContent = csvMsg; });
    } else if (a === "pdwho") {
      var nm = ($("pdWho").value || "").trim(); pdWho = nm; api("pdfcfg_set", { kind: "designer", key: "designer", val: nm }).then(function () { toast("บันทึกชื่อแล้ว"); }).catch(function (e) { if (!authFail(e)) toast(e.message); });
    } else if (a === "pdcats") {
      var rg2 = pdfRange(); b.disabled = true; $("pdCats").innerHTML = '<div class="muted">กำลังโหลด…</div>';
      api("pdf_preview", { from: rg2.from, to: rg2.to }, 60000).then(function (r) { pdPrev = r; if (pdWho == null) pdWho = r.designer || ""; if ($("pdWho") && !$("pdWho").value) $("pdWho").value = pdWho; $("pdCats").innerHTML = pdCatsHtml(); })
        .catch(function (e) { if (!authFail(e)) $("pdCats").innerHTML = '<div class="muted">⚠️ ' + esc(/unknown action/.test(e.message) ? "สคริปต์ยังไม่อัปเดต (ต้องอัปเวอร์ชันใหม่ก่อน)" : e.message) + "</div>"; }).then(function () { b.disabled = false; });
    } else if (a === "pdf") {
      var rg = pdfRange(); if (rg.from > rg.to) { toast("เลือกวันที่เริ่มและสิ้นสุดให้ถูกต้อง"); return; }
      b.disabled = true; var st = $("pdfSt"); if (st) st.textContent = "กำลังสร้าง PDF… (ครั้งแรกอาจใช้เวลา 10–30 วินาที)";
      api("pdf", { from: rg.from, to: rg.to, scale: docScale() }, 170000).then(function (r) {
        pdfMsg = "สร้างแล้ว: " + r.folders + " ชิ้นงาน · " + r.files + " ไฟล์ — เลือก “บันทึกลงไฟล์” ในหน้าที่เปิดขึ้น"; if ($("pdfSt")) $("pdfSt").textContent = pdfMsg;
        return saveBlob(toBlob(r.b64, "application/pdf"), r.filename, "application/pdf");
      }).catch(function (e) { if (!authFail(e)) { pdfMsg = "⚠️ " + e.message; if ($("pdfSt")) $("pdfSt").textContent = pdfMsg; } }).then(function () { b.disabled = false; });
    }
  }
  function renderBody(def, d) { var b = $("ofBody"); if (b) { var st = b.scrollTop; b.innerHTML = bodyFor(def, d); b.scrollTop = st; } }
  function setChatCollapsed(c, keep) {
    chatCollapsed = !!c; if (!keep) { try { localStorage.setItem("notedy.chat.collapsed", c ? "1" : "0"); } catch (e) {} }
    var box = $("ofChatBox"); if (!box) return; box.classList.toggle("collapsed", chatCollapsed);
    var t = $("ofChatBarT"); if (t && ofDef) t.textContent = "💬 แชทกับ" + ofDef.th + (chatBusy ? " · กำลังคิด…" : "");
    if (!chatCollapsed) { var ch = $("ofChat"); if (ch) ch.scrollTop = ch.scrollHeight; }
  }
  function openKeyBox() {
    $("ofMenu").hidden = false; $("mQrBox").hidden = true; $("mKeyBox").hidden = false; $("mKeySt").textContent = "กำลังตรวจ…";
    api("ai_status").then(function (r) { $("mKeySt").textContent = r.has_key ? "✅ ตั้ง key ไว้แล้ว (วางใหม่เพื่อเปลี่ยน)" : "❌ ยังไม่ได้ตั้ง key — วางตรงนี้แล้วกดบันทึก"; })
      .catch(function (e) { if (!authFail(e)) $("mKeySt").textContent = /unknown action/.test(e.message) ? "สคริปต์ยังไม่อัปเดต (ต้องอัปเวอร์ชันใหม่ก่อน)" : e.message; });
  }
  function saveKey(del) {
    var inp = $("mKeyIn"), key = del ? "" : (inp.value || "").trim();
    if (!del && !key) { toast("วาง key ก่อน"); return; }
    if (del && !confirm("ลบ key ออกจากสคริปต์? ภูติจะคุยไม่ได้จนกว่าจะใส่ใหม่")) return;
    var b = $("mKeySave"); b.disabled = true; $("mKeySt").textContent = "กำลังตรวจกับ Google…";
    api("ai_setkey", { key: key }, 30000).then(function (r) { ai.has_key = !!r.has_key; ofKeyHint = false; inp.value = ""; $("mKeySt").textContent = r.has_key ? "✅ บันทึกแล้ว ใช้ได้เลย" : "ลบ key แล้ว"; toast(r.has_key ? "บันทึก key แล้ว ลองคุยกับภูติได้เลย" : "ลบ key แล้ว"); })
      .catch(function (e) { if (!authFail(e)) $("mKeySt").textContent = "⚠️ " + e.message; }).then(function () { b.disabled = false; });
  }
  function openSheet(def, asset) {
    fxUserClose(); ofSpirit = def.id; ofDef = def; applyTheme(def.id);
    $("ofImg").src = office.u(office.night ? asset.night : asset.day); $("ofNm").textContent = def.th + " (" + def.id + ")"; ofKeyHint = false;
    $("ofRl").textContent = def.role + (ai.has_key ? " · คุยกับ AI ได้ (Gemini ฟรี)" : " · ผู้ช่วยแบบกฎ ใช้ข้อมูลจริง");
    buildStrip(def.id); $("ofBody").innerHTML = '<div class="bubble">' + esc(sayFor(def)) + '</div><div class="muted" style="text-align:center">กำลังโหลดข้อมูล…</div>'; $("ofBody").scrollTop = 0;
    $("ofIn").placeholder = "พิมพ์คุยกับ" + def.th + "… เช่น “วันนี้ค้างตรวจอะไรบ้าง”"; setChatCollapsed(chatCollapsed, true); $("office").classList.add("open");
    var me = def.id; chatRender(); sleepUi();
    loadSpiritData(false, function (c) { if (ofSpirit === me) renderBody(def, c); }).then(function (d) { if (ofSpirit === me) renderBody(def, d); })
      .catch(function (e) { if (ofSpirit === me && !authFail(e) && $("ofBody")) $("ofBody").innerHTML = '<div class="bubble">' + esc(sayFor(def)) + '</div><div class="banner">' + esc(e.message) + "</div>"; });
    if (ai.has_key === null) aiLoad();
    chatLoad(me);
  }
  function ofDecide(btn) {
    var items = ofGroups[btn.dataset.g]; if (!items) return; var row = btn.closest(".item"), bs = [].slice.call(row.querySelectorAll("button"));
    bs.forEach(function (b) { b.disabled = true; });
    var cs = row.querySelector(".catSel"), cat = btn.dataset.md === "work" && cs ? cs.value : "";
    decide(items, btn.dataset.md, cat).then(function () {
      toast(btn.dataset.md === "work" ? (cat ? "ตั้งเป็นงาน หมวด “" + cat + "” แล้ว" : "ตั้งเป็นงานแล้ว") : "ตั้งเป็นไม่ใช่งานแล้ว"); wk.at = 0; officeData();
      return loadSpiritData(true).then(function (d) { if (ofDef) renderBody(ofDef, d); });
    }).catch(function (e) { toast(e.message); bs.forEach(function (b) { b.disabled = false; }); });
  }
  function closeSheet() { fxUserClose(); var o = $("office"); if (o) o.classList.remove("open"); ofSpirit = null; try { document.activeElement.blur(); } catch (e) {} }
  function showQr() {
    if (!cfg || typeof qrcode !== "function") { toast("สร้าง QR ไม่ได้"); return; }
    var link = location.origin + location.pathname + "#setup=" + b64url(JSON.stringify({ u: cfg.u, t: cfg.t })), box = $("mQrBox");
    try { var q = qrcode(0, "L"); q.addData(link); q.make(); box.innerHTML = '<img alt="QR เชื่อมมือถือ" src="' + q.createDataURL(5, 4) + '"><p>เปิดกล้องมือถือสแกน แล้วตั้งรหัสผ่านแอป 6 หลักบนมือถือ<br><b>QR นี้มีรหัสลับ</b> สแกนเสร็จแล้วกดปิด อย่าแคปหรือส่งให้ใคร</p>'; box.hidden = false; }
    catch (e) { toast("สร้าง QR ไม่ได้"); }
  }
  function syncNow() {
    var b = $("syncBtn"); if (b) b.disabled = true; toast("กำลังซิงก์ Drive…");
    api("sync").then(function (r) { toast(r.ok === false ? "ซิงก์ไม่สำเร็จ: " + r.error : r.busy ? "กำลังซิงก์อยู่แล้ว" : "ซิงก์แล้ว"); if (b) b.disabled = false; if (view === "office") officeData(); else load(); }).catch(function (e2) { toast(e2.message); if (b) b.disabled = false; });
  }
  if (window.visualViewport) {                                   // keep the chat sheet above the iPhone keyboard
    var vv = window.visualViewport, kb = function () { var sh = $("ofSheet"); if (!sh) return; sh.style.bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + "px"; sh.style.maxHeight = Math.max(280, Math.min(window.innerHeight * 0.9, vv.height - 10)) + "px"; };
    vv.addEventListener("resize", kb); vv.addEventListener("scroll", kb);
  }
  setInterval(function () { if (office && view === "office") { if (toneCfg.mode !== "manual") applyTone(); applySleep(); } }, 30000);


  /* ---------- the full work page: look by category, confirm / move categories, rename, make the PDF (the PC "full page", in one column for the phone) ---------- */
  var WORK_ICON = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="7" width="36" height="36" rx="8" fill="#6c8bd6" stroke="#3f5aa3" stroke-width="2.5"/><rect x="11" y="12" width="26" height="26" rx="4" fill="#f3f6ff"/><rect x="15" y="26" width="5" height="9" rx="1.5" fill="#e0457b"/><rect x="23" y="19" width="5" height="16" rx="1.5" fill="#4b64c4"/><rect x="31" y="23" width="4" height="12" rx="1.5" fill="#1f9d6b"/></svg>';
  var wk = { open: false, data: null, key: "", filter: "all", q: "", at: 0, preAt: 0, busy: false };
  var WK_COLORS = ["#4b64c4", "#e0457b", "#1f9d6b", "#e08a1e", "#8a4bd0", "#17a2b8", "#c0392b", "#6c8e23", "#b5651d", "#3d7ea6", "#d6559c", "#5d6d7e", "#c2a100", "#2e8b57"];
  function wkColor(cat) { if (!cat || cat === UNSET) return "#9aa0a6"; var i = wk.data ? wk.data.cats.indexOf(cat) : -1; return WK_COLORS[(i < 0 ? 0 : i) % WK_COLORS.length]; }
  function wkLoad() {
    var pr = periodSel(), key = pr.from; wk.busy = true;
    return api("work_pieces", { from: pr.from, to: pr.to }, 60000).then(function (r) {
      if (key !== periodSel().from) return; wk.data = r; wk.key = key; wk.at = Date.now(); catCache = r.cats || catCache; lsSet("notedy.cats", catCache); lsSet("notedy.cache.work." + key, r);
    }).catch(function (e) { if (!authFail(e)) toast(/unknown action/.test(e.message) ? "สคริปต์ยังไม่อัปเดตเป็นเวอร์ชันใหม่" : e.message); }).then(function () { wk.busy = false; });
  }
  function wkSummaryCard() {                                     // Minty: categories of the round, tap one to open it on the full page
    var d = wk.data && wk.key === periodSel().from ? wk.data : null;
    if (Date.now() - wk.preAt > 60000) { wk.preAt = Date.now(); wkLoad().then(function () { if (ofDef && ofDef.id === "Minty" && ofData && $("office").classList.contains("open")) renderBody(ofDef, ofData); }); }
    var body;
    if (!d) body = '<div class="muted">กำลังโหลดหมวด…</div>';
    else {
      var cnt = {}; d.pieces.forEach(function (p) { cnt[p.cat] = (cnt[p.cat] || 0) + 1; });
      var conf = d.pieces.filter(function (p) { return p.assigned; }).length, ks = d.cats.filter(function (c) { return cnt[c]; }); if (cnt[UNSET]) ks.push(UNSET);
      body = '<div class="muted">ชิ้นงานรอบนี้ ' + d.pieces.length + " ชิ้น · ยืนยันหมวดแล้ว " + conf + "</div>" + (ks.length ? '<div class="chips">' + ks.map(function (c) { return '<button type="button" class="chip" data-go="work:' + esc(encodeURIComponent(c)) + '"><i style="background:' + wkColor(c) + '"></i>' + esc(c) + " <b>" + cnt[c] + "</b></button>"; }).join("") + "</div>" : "") +
        '<div class="muted">ตอนตรวจแฟ้มด้านบน เลือกหมวดได้ที่ช่อง “หมวด” ข้างปุ่ม ✓ งาน (เว้นไว้ = ให้ระบบแนะนำ)</div>';
    }
    return card("🗂️ หมวดงานรอบนี้", body + '<div class="row">' + goBtn("work", "📊 เปิดหน้าสรุปเต็ม") + "</div>");
  }
  function openWork(cat) {
    closeSheet(); var p = $("workPage"); if (!p) { p = document.createElement("div"); p.id = "workPage"; document.body.appendChild(p); }
    wk.open = true; wk.filter = cat || "all"; wk.q = ""; p.hidden = false; document.body.classList.add("wkOpen");
    var key = periodSel().from; wk.data = wk.key === key && wk.data ? wk.data : lsGet("notedy.cache.work." + key); wk.key = wk.data ? key : "";
    wkRender(); wkLoad().then(function () { if (wk.open) wkRender(); });
  }
  function closeWork() { wk.open = false; var p = $("workPage"); if (p) { p.hidden = true; p.innerHTML = ""; } document.body.classList.remove("wkOpen"); if (view === "office") { ofDataAt = 0; officeData(); } }
  function wkVisible() {
    var d = wk.data, q = wk.q.trim().toLowerCase(); if (!d) return [];
    return d.pieces.filter(function (p) { return (wk.filter === "all" || p.cat === wk.filter) && (!q || (p.name + " " + p.parent + " " + p.parts.join(" ")).toLowerCase().indexOf(q) >= 0); });
  }
  function wkCatSelect(p) {
    var d = wk.data, cur = p.cat === UNSET ? "" : p.cat;
    return '<select class="wkCat" data-wkcat="' + esc(p.pid) + '" aria-label="หมวดของชิ้นงาน"><option value="">' + UNSET + "</option>" + d.cats.map(function (c) { return '<option value="' + esc(c) + '"' + (c === cur ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") + '<option value="__new">+ หมวดใหม่…</option></select>';
  }
  function wkDyn() {
    var d = wk.data; if (!d) return '<div class="muted">กำลังโหลด…</div>';
    var cnt = {}; d.pieces.forEach(function (p) { cnt[p.cat] = (cnt[p.cat] || 0) + 1; });
    var ks = d.cats.slice(); if (cnt[UNSET]) ks.push(UNSET);
    var h = '<div class="chips"><button type="button" class="chip' + (wk.filter === "all" ? " on" : "") + '" data-wk="chip" data-c="all"><b>ทั้งหมด ' + d.pieces.length + "</b></button>" + ks.map(function (c) { return '<button type="button" class="chip' + (wk.filter === c ? " on" : "") + '" data-wk="chip" data-c="' + esc(c) + '"><i style="background:' + wkColor(c) + '"></i>' + esc(c) + " <b>" + (cnt[c] || 0) + "</b></button>"; }).join("") + "</div>";
    var vis = wkVisible(), sug = d.pieces.filter(function (p) { return !p.assigned && p.auto !== UNSET; }).length;
    h += '<div class="wkTools"><div class="muted">ย้ายชิ้นงานที่แสดงอยู่ (' + vis.length + ') ไปหมวด</div><div class="row"><select id="wkMove">' + d.cats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + "</option>"; }).join("") + '</select><button type="button" class="wkB" data-wk="move"' + (vis.length ? "" : " disabled") + ">ย้าย</button></div>" +
      '<div class="row"><input id="wkNew" placeholder="ชื่อหมวดใหม่" maxlength="60"><button type="button" class="wkB" data-wk="addcat">เพิ่มหมวด</button></div>' +
      (sug ? '<div class="row"><button type="button" class="wkB pri" data-wk="confirm">ยืนยันหมวดที่แนะนำทั้งหมด (' + sug + ")</button></div>" : "") + "</div>";
    if (!vis.length) return h + '<div class="muted" style="padding:14px 0">ไม่มีชิ้นงานในมุมมองนี้</div>';
    var lastDay = "";
    vis.forEach(function (p) {
      if (p.last !== lastDay) { lastDay = p.last; h += '<div class="wkDay">' + esc(longDate(p.last)) + "</div>"; }
      h += '<div class="wkCard" style="border-left-color:' + wkColor(p.cat) + '"><div class="wkMain"><b>' + esc(p.name) + '</b> <span class="wkN">' + p.files + " ไฟล์</span>" + (p.parent ? ' <small>· ' + esc(p.parent) + "</small>" : "") + (p.assigned ? "" : ' <span class="wkSug">' + (p.auto === UNSET ? "ยังไม่ระบุหมวด" : "แนะนำ") + "</span>") +
        (p.parts.length ? '<div class="wkParts">' + esc(p.parts.join(", ")) + (p.nparts > p.parts.length ? " …" : "") + "</div>" : "") + '</div><div class="wkSide">' + wkCatSelect(p) + '<div class="wkLk">' + (p.link ? '<a href="' + esc(p.link) + '" target="_blank" rel="noopener">เปิด ↗</a>' : "") + '<button type="button" class="nlink" data-wk="edit" data-pid="' + esc(p.pid) + '">แก้ชื่อ</button></div></div></div>';
    });
    return h;
  }
  function wkRender() {
    var p = $("workPage"); if (!p || !wk.open) return; var sc = p.querySelector(".wkScroll"), st = sc ? sc.scrollTop : 0, d = wk.data, pr = periodSel(), list = periodList();
    var conf = d ? d.pieces.filter(function (x) { return x.assigned; }).length : 0, tot = d ? d.pieces.length : 0, sc100 = Math.round(docScale() * 100);
    p.innerHTML = '<div class="wkTop"><button type="button" class="wkBack" data-wk="back">← กลับห้อง Notedy</button><small>หน้าทำงานเต็ม: จัดหมวด แก้ชื่อ และสร้าง PDF</small></div><div class="wkScroll">' +
      "<h1>สรุปงานประจำเดือน " + esc(periodLabel(pr)) + '</h1><div class="wkSub">Graphic Designer : ' + esc(d ? d.designer || "" : "") + ' · เรียงตามวันที่อัปโหลด</div>' +
      '<div class="wkProg"><span>ยืนยันหมวดแล้ว <b>' + conf + "</b> / " + tot + ' ชิ้นงาน</span><div class="bar"><i style="width:' + (tot ? Math.round(conf * 100 / tot) : 0) + '%"></i></div></div>' +
      '<div class="row"><select id="wkPer" aria-label="เลือกรอบ">' + list.map(function (x, k) { return '<option value="' + k + '"' + (x.from === pr.from ? " selected" : "") + ">" + esc(periodLabel(x)) + (k === 0 ? " (รอบนี้)" : "") + "</option>"; }).join("") + '</select><button type="button" class="wkB" data-wk="sync">🔄 ดึงงานจาก Drive</button></div>' +
      '<div class="row"><button type="button" class="wkB pri" data-wk="pdf">📄 สร้าง PDF</button><button type="button" class="wkB" data-wk="scale" data-d="-0.05">A−</button><span class="muted">' + sc100 + '%</span><button type="button" class="wkB" data-wk="scale" data-d="0.05">A+</button></div><div id="wkSt" class="muted"></div>' +
      '<input id="wkQ" class="wkQ" placeholder="ค้นหาชื่อชิ้นงานหรือรายละเอียด" value="' + esc(wk.q) + '" autocomplete="off"><div id="wkDyn">' + wkDyn() + "</div></div>";
    if (st) { var n = p.querySelector(".wkScroll"); if (n) n.scrollTop = st; }
  }
  function wkRefreshDyn() { var e = $("wkDyn"); if (e) e.innerHTML = wkDyn(); var pr = document.querySelector("#workPage .wkProg"); if (pr && wk.data) { var c = wk.data.pieces.filter(function (x) { return x.assigned; }).length, t = wk.data.pieces.length; pr.innerHTML = "<span>ยืนยันหมวดแล้ว <b>" + c + "</b> / " + t + ' ชิ้นงาน</span><div class="bar"><i style="width:' + (t ? Math.round(c * 100 / t) : 0) + '%"></i></div>'; } }
  function wkSt(t) { var e = $("wkSt"); if (e) e.textContent = t; }
  function wkAssign(list, msg) {                                  // list: [{pid, cat}] — update at once, save behind it
    var by = {}; wk.data.pieces.forEach(function (p) { by[p.pid] = p; });
    list.forEach(function (x) { var p = by[x.pid]; if (!p) return; p.cat = x.cat || UNSET; p.assigned = !!x.cat; if (x.cat && wk.data.cats.indexOf(x.cat) < 0) wk.data.cats.push(x.cat); });
    wkRefreshDyn(); lsSet("notedy.cache.work." + wk.key, wk.data);
    var chunks = []; for (var i = 0; i < list.length; i += 300) chunks.push(list.slice(i, i + 300));
    var pr = Promise.resolve(); chunks.forEach(function (c) { pr = pr.then(function () { return api("assign_many", { items: c }, 60000); }); });
    pr.then(function () { if (msg) toast(msg); }).catch(function (e) { if (!authFail(e)) { toast("บันทึกไม่สำเร็จ: " + e.message); wkLoad().then(wkRender); } });
  }
  function wkAct(b) {
    var a = b.dataset.wk, d = wk.data;
    if (a === "back") closeWork();
    else if (a === "chip") { wk.filter = b.dataset.c; wkRefreshDyn(); }
    else if (a === "sync") { wkSt("กำลังซิงก์ Drive…"); api("sync").then(function (r) { wkSt(r.ok === false ? "ซิงก์ไม่สำเร็จ: " + r.error : "ซิงก์แล้ว"); return wkLoad(); }).then(function () { wkRender(); }).catch(function (e) { if (!authFail(e)) wkSt(e.message); }); }
    else if (a === "scale") { var v = Math.round(Math.min(1.2, Math.max(0.8, docScale() + parseFloat(b.dataset.d))) * 100) / 100; lsSet("notedy.docScale", v); wkRender(); }
    else if (a === "pdf") {
      var pr = periodSel(); b.disabled = true; wkSt("กำลังสร้าง PDF… (ครั้งแรกอาจใช้เวลา 10–30 วินาที)");
      api("pdf", { from: pr.from, to: pr.to, scale: docScale() }, 170000).then(function (r) { wkSt("สร้างแล้ว: " + r.folders + " ชิ้นงาน · " + r.files + " ไฟล์ — เลือก “บันทึกลงไฟล์” ในหน้าที่เปิดขึ้น"); return saveBlob(toBlob(r.b64, "application/pdf"), r.filename, "application/pdf"); })
        .catch(function (e) { if (!authFail(e)) wkSt("⚠️ " + e.message); }).then(function () { b.disabled = false; });
    } else if (!d) return;
    else if (a === "move") { var to = $("wkMove").value, vis = wkVisible(); if (!to || !vis.length) return; if (vis.length > 1 && !confirm("ย้าย " + vis.length + " ชิ้นงานไปหมวด “" + to + "” ?")) return; wkAssign(vis.map(function (p) { return { pid: p.pid, cat: to }; }), "ย้าย " + vis.length + " ชิ้นงานแล้ว"); }
    else if (a === "confirm") { var sg = d.pieces.filter(function (p) { return !p.assigned && p.auto !== UNSET; }); wkAssign(sg.map(function (p) { return { pid: p.pid, cat: p.auto }; }), "ยืนยันหมวดแล้ว " + sg.length + " ชิ้นงาน"); }
    else if (a === "addcat") { var nm = ($("wkNew").value || "").trim(); if (!nm) { toast("พิมพ์ชื่อหมวดก่อน"); return; } if (d.cats.indexOf(nm) >= 0) { toast("มีหมวดนี้แล้ว"); return; }
      d.cats.push(nm); catCache = d.cats; lsSet("notedy.cats", catCache); wkRefreshDyn(); api("pdfcfg_set", { kind: "cat", key: nm, val: "1" }).then(function () { toast("เพิ่มหมวดแล้ว"); }).catch(function (e) { if (!authFail(e)) toast(e.message); }); }
    else if (a === "edit") {
      var p = d.pieces.filter(function (x) { return x.pid === b.dataset.pid; })[0]; if (!p) return;
      var nn = prompt("ชื่อชิ้นงานที่จะแสดงใน PDF (เว้นว่าง = ใช้ชื่อแฟ้มเดิม)", p.name); if (nn == null) return; nn = nn.trim();
      var ed = Object.assign({}, p.ed || {}); if (nn) ed.name = nn; else delete ed.name;
      api("pdfcfg_set", { kind: "edit", key: p.pid, val: Object.keys(ed).length ? JSON.stringify(ed) : "" }).then(function () { return wkLoad(); }).then(function () { wkRender(); toast("แก้แล้ว"); }).catch(function (e) { if (!authFail(e)) toast(e.message); });
    }
  }

  /* ---------- events ---------- */
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t.closest) return;
    var tab = t.closest(".tabs [data-v], .ofTabs [data-v]");
    if (tab) { if (tab.dataset.v === view) return; view = tab.dataset.v; if (view === "office") renderOffice(); else { renderShell(); load(); } return; }
    if (t.closest("#ofScrim") || t.closest("#ofX")) { closeSheet(); return; }
    if (t.closest("#ofPend")) { openPending(); return; }
    var sp = t.closest("#ofStrip [data-sp]"); if (sp) { var cc = ofAssets.chars.filter(function (c) { return c.id === sp.dataset.sp; })[0]; if (cc && Office.BY[cc.id]) openSheet(Office.BY[cc.id], cc); return; }
    if (t.closest("#menuBtn")) { $("ofMenu").hidden = false; $("mQrBox").hidden = true; $("mKeyBox").hidden = true; $("mNotifyBox").hidden = true; $("mClearBox").hidden = true; return; }
    if (t.closest("#ofHandle")) { openQuick(); return; }
    var qk = t.closest("#ofQuick [data-q]"); if (qk) { $("ofQuick").hidden = true; var qv = qk.dataset.q; if (qv === "pending") openPending(); else if (qv === "day") openNote(); else if (qv === "work") openWork(); else { $("ofMenu").hidden = false; $("mQrBox").hidden = true; $("mKeyBox").hidden = true; $("mNotifyBox").hidden = true; $("mClearBox").hidden = true; } return; }
    if (t.id === "ofQuick") { t.hidden = true; return; }
    if (t.closest("#ofPeriodBtn")) { openPeriodMenu(); return; }
    var pp = t.closest("#ofPeriodList [data-per]"); if (pp) { pickPeriod(+pp.dataset.per); return; }
    if (t.closest("#ppClose") || t.id === "ofPeriodMenu") { $("ofPeriodMenu").hidden = true; return; }
    if (t.closest("#mNotify")) { openNotifyBox(); return; }
    if (t.closest("#mNotifyOn")) { setNotify(true); return; }
    if (t.closest("#mNotifyOff")) { setNotify(false); return; }
    if (t.closest("#mNotifyTest")) { testNotify(); return; }
    if (t.closest("#mClear")) { $("mClearBox").hidden = !$("mClearBox").hidden; return; }
    if (t.closest("#mClearGo")) { clearChats(); return; }
    var ba = t.closest("#ofBody [data-act]"); if (ba) { bodyAct(ba); return; }
    var go = t.closest("#ofBody [data-go]"); if (go) { var gv = go.dataset.go; closeSheet(); if (gv === "sync") syncNow(); else if (gv === "day") openNote(); else if (gv === "pending") openPending(); else if (gv.indexOf("work") === 0) openWork(gv.length > 5 ? decodeURIComponent(gv.slice(5)) : ""); else { view = gv; renderShell(); load(); } return; }
    var md = t.closest("#ofBody [data-md]"); if (md) { ofDecide(md); return; }
    if (t.closest("#ofChatBar")) { setChatCollapsed(!chatCollapsed); return; }
    if (t.closest("#mKey") || t.closest("[data-key]")) { openKeyBox(); return; }
    if (t.closest("#mKeySave")) { saveKey(false); return; }
    if (t.closest("#mKeyDel")) { saveKey(true); return; }
    if (t.closest("#mClose") || t.id === "ofMenu") { $("ofMenu").hidden = true; return; }
    if (t.closest("#mQr")) { showQr(); return; }
    var rp = t.closest("#ofChat [data-replay]"); if (rp) { replay(rp.dataset.replay.split(",").map(function (id) { return lastRp.map[id]; })); return; }
    var cb = t.closest("#ofChat [data-chat], #ofKey [data-chat]");
    if (cb) { var ck = cb.dataset.chat; if (ck === "act") chatAct(cb.dataset.eid, +cb.dataset.ai); else if (ck === "openkey") openKeyBox(); return; }
    if (t.closest("#fxClose") || t.id === "ofAsk") { fxUserClose(); return; }
    if (t.closest("#fxAgain")) { if (fx.item) replay([fx.item]); return; }
    var sm = t.closest("#ofSleepMenu [data-sl]");
    if (sm) { var sid = sleepFor, sdef = Office.BY[sid]; $("ofSleepMenu").hidden = true; if (sm.dataset.sl === "toggle") { setSleepOne(sid, !asleep(sid)); toast(asleep(sid) ? (sdef ? sdef.th : sid) + "หลับแล้ว 💤" : "ปลุกแล้ว"); } else { var ac = ofAssets && ofAssets.chars.filter(function (c) { return c.id === sid; })[0]; if (ac && sdef) openSheet(sdef, ac); } return; }
    var smo = $("ofSleepMenu"); if (smo && !smo.hidden && !t.closest("#ofSleepMenu")) smo.hidden = true;
    if (t.closest("#ofZ")) { if (ofSpirit) { setSleepOne(ofSpirit, !asleep(ofSpirit)); toast(asleep(ofSpirit) ? "หลับแล้ว 💤" : "ปลุกแล้ว"); } return; }
    if (t.closest("#sleepAll")) { Office.ROSTER.forEach(function (r) { sleepCfg.ov[r.id] = { v: 1, until: isDark() ? nextWake() : Date.now() + 4 * 3600e3 }; }); saveSleep(); applySleep(); toast("ให้ทุกตัวนอนแล้ว 💤"); return; }
    if (t.closest("#wakeAll")) { Office.ROSTER.forEach(function (r) { sleepCfg.ov[r.id] = { v: 0, until: isDark() ? nextWake() : Date.now() + 4 * 3600e3 }; }); saveSleep(); applySleep(); toast("ปลุกทุกตัวแล้ว"); return; }
    if (t.closest("#toneBtn")) { toggleTone(); return; }
    if (t.closest("#toneX")) { toggleTone(false); return; }
    if (t.closest("#toneAuto")) { setToneAuto(); return; }
    var tp = $("ofTone"); if (tp && !tp.hidden && !t.closest("#ofTone")) toggleTone(false);
    if (t.closest("[data-wkopen]")) { openWork(); return; }
    var wb = t.closest("#workPage [data-wk]"); if (wb) { wkAct(wb); return; }
    if (t.closest("[data-note]")) { openNote(); return; }
    if (t.closest("#noteBack") || t.id === "noteWrap") { closeNote(); return; }
    var nav = t.closest("[data-nav]"); if (nav && !nav.disabled) { var nd = addDays(day, +nav.dataset.nav); if (nd <= todayStr()) { day = nd; if (noteOpen) loadNote(); else load(); } return; }
    var act = t.closest("[data-nd]"); if (act) { onAction(act.dataset.nd, act); return; }
    if (t.closest("#syncBtn")) { syncNow(); return; }
    if (t.closest("#cfgBtn")) { if (confirm("ล้างการตั้งค่าบนเครื่องนี้และตั้งค่าใหม่?")) { clearCfgStore(); cfg = null; renderSetup(); } return; }
    if (t.closest("#lockBtn")) { cfg.p = ""; saveCfg(cfg); toast("ล็อกแล้ว"); gatePin(); return; }
    if (t.closest("#pinGo")) { submitPin(); return; }
    if (t.closest("#retry")) { load(); return; }
    if (t.closest("#cfgGo")) {
      var link = $("cfgLink") ? $("cfgLink").value : "", c = parseSetup(link);
      if (!c && $("cfgU") && ($("cfgU").value || $("cfgT").value)) { var u = $("cfgU").value.trim(), tk = $("cfgT").value.trim(); if (URL_OK.test(u) && TOKEN_OK.test(tk)) c = { u: u, t: tk, p: "" }; }
      if (!c) { renderSetup("ลิงก์ไม่ถูกต้อง ลองคัดลอกจากเซลล์ A2 ให้ครบทั้งเส้น (หรือสแกน QR จากคอม)"); return; }
      verifyAndStart(c);
      return;
    }
  });
  document.addEventListener("input", function (e) {              // PIN boxes: digits only, move on / submit when 6 are typed
    var t = e.target; if (!t || (t.id !== "pinA" && t.id !== "pinB")) return;
    t.value = t.value.replace(/\D/g, "").slice(0, 6);
    if (t.value.length < 6) return;
    if ($("app").dataset.pin === "create") { if (t.id === "pinA") $("pinB").focus(); else submitPin(); } else submitPin();
  });
  document.addEventListener("input", function (e) { var id = e.target && e.target.id; if (id === "ofSearch") searchRefresh(); else if (id === "wkQ") { wk.q = e.target.value; wkRefreshDyn(); } else if (id === "toneRange") setToneManual(e.target.value / 100); });
  document.addEventListener("change", function (e) {
    var t = e.target; if (!t) return;
    if (t.id === "sleepAuto") { sleepCfg.auto = t.checked; if (t.checked) sleepCfg.ov = {}; saveSleep(); applySleep(); }
    else if (t.id === "fxGlow" || t.id === "fxGrade" || t.id === "fxParty") { fxOpts[t.id === "fxGlow" ? "glow" : t.id === "fxGrade" ? "grade" : "party"] = t.checked; saveFxOpts(); if (office) office.setOpts(fxOpts); }
    else if (t.id === "ofSF" || t.id === "ofST" || t.id === "ofSS") searchRefresh();
    else if (t.id === "wkPer") { var lst = periodList(), k = +t.value; ofPer = k === 0 ? null : lst[k]; headerOffice(); wk.at = 0; var key = periodSel().from; wk.data = lsGet("notedy.cache.work." + key); wk.key = wk.data ? key : ""; wkRender(); wkLoad().then(function () { if (wk.open) wkRender(); }); }
    else if (t.dataset && t.dataset.wkcat !== undefined) {
      var cat = t.value; if (cat === "__new") { cat = (prompt("ชื่อหมวดใหม่") || "").trim(); if (!cat) { wkRefreshDyn(); return; } }
      wkAssign([{ pid: t.dataset.wkcat, cat: cat }], cat ? "ย้ายไป “" + cat + "” แล้ว" : "เอาออกจากหมวดแล้ว");
    }
    else if (t.dataset && t.dataset.pdassign !== undefined) {
      var pid = t.dataset.pdassign, val = t.value;
      if (val === "__new") { val = (prompt("ชื่อหมวดใหม่") || "").trim(); if (!val) { t.value = ""; return; } }
      (val && pdPrev.cats.indexOf(val) < 0 ? api("pdfcfg_set", { kind: "cat", key: val, val: "1" }) : Promise.resolve())
        .then(function () { return api("pdfcfg_set", { kind: "assign", key: pid, val: val }); })
        .then(function () { var rg3 = pdfRange(); return api("pdf_preview", { from: rg3.from, to: rg3.to }, 60000); })
        .then(function (r) { pdPrev = r; if ($("pdCats")) $("pdCats").innerHTML = pdCatsHtml(); toast("จัดหมวดแล้ว"); }).catch(function (e) { if (!authFail(e)) toast(e.message); });
    }
    else if (t.dataset && t.dataset.ack !== undefined) { var a = acksGet(); if (t.checked) a[t.dataset.ack] = t.dataset.sig; else delete a[t.dataset.ack]; lsSet("notedy.acks", a); if (ofDef && ofData) renderBody(ofDef, ofData); }
  });
  document.addEventListener("submit", function (e) { if (e.target && e.target.id === "ofForm") { e.preventDefault(); var iv = $("ofIn").value; $("ofIn").value = ""; chatSend(iv); } });
  document.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target && (e.target.id === "pinA" || e.target.id === "pinB")) submitPin(); });
  document.addEventListener("visibilitychange", function () { if (document.hidden || !cfg || !cfg.p) return; if (view === "office") { if (office && toneCfg.mode !== "manual") applyTone(); officeData(); } else if (!busy) load(true); });

  /* ---------- boot ---------- */
  day = todayStr();
  var fromHash = setupFromHash();
  if (fromHash) verifyAndStart(fromHash); else { cfg = loadCfg(); start(); }
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) navigator.serviceWorker.register("sw.js").catch(function () {});
})();
