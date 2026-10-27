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
  function saveCfg(c) { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); return true; } catch (e) { return false; } }
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
      ? '<div class="nbtns"><button class="nbig ok" data-nd="work" type="button">✓ เป็นงาน</button><button class="nbig no" data-nd="not-work" type="button">✕ ไม่ใช่งาน</button></div>'
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
  function decide(items, decision) { return api("decide_many", { items: items, decision: decision }); }
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
      bulk.last = null; bulk.armed = false; setRow(row, nd);
      decide(groupsMap[row.dataset.gid] || [], nd).then(function (r) { if (r.skipped) toast("ข้าม " + r.skipped + " ไฟล์ที่เพิ่งถูกแก้ไข"); bulkRender(); counters(); }).catch(function (e) { toast(e.message); load(true); });
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
      .catch(function (e) { if (e.code === "unauthorized") { cfg = null; try { localStorage.removeItem(CFG_KEY); } catch (e2) {} renderSetup(e.message); } else renderPin(false, e.message); });
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
  var QUICK = { Notedy: [["day", "📒 เปิดโน้ตรายวัน"]], Minty: [["pending", "📥 ไปตรวจไฟล์"]], Drivey: [["sync", "🔄 ซิงก์ Drive ตอนนี้"]] };
  /* per-spirit colours (same palette as the PC app): a = accent, s/s2 = soft backgrounds, d = dark text */
  var THEMES = {
    Notedy: { a: "#4b64c4", s: "#eef1ff", s2: "#fff4e6", d: "#2c3a86", pat: "star" }, Newnew: { a: "#5b7bdb", s: "#eaf2ff", s2: "#fff1e6", d: "#2f4392", pat: "doc" },
    Backy: { a: "#8d86d9", s: "#2b2943", s2: "#37345a", d: "#f0eeff", pat: "moon", dark: true, av: "#cfcaf0" }, Minty: { a: "#6b9a4f", s: "#eaf6df", s2: "#fbfff3", d: "#2f5a2a", pat: "leaf" },
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
  function authFail(e) {                                         // PIN changed / reset elsewhere or token revoked
    if (e.code && PIN_CODES[e.code]) { cfg.p = ""; saveCfg(cfg); gatePin(e.code === "pin_setup" ? "" : e.message); return true; }
    if (e.code === "unauthorized") { cfg = null; try { localStorage.removeItem(CFG_KEY); } catch (e2) {} renderSetup(e.message); return true; }
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
    o.hidden = false; o.classList.remove("open");
    o.innerHTML = '<div id="ofStage"></div><div class="ofTop"><div class="ttl"><b>Notedy</b><small id="ofSub">กำลังโหลด…</small></div><button class="pill" id="ofPend" type="button">📥 ค้างตรวจ</button>' +
      '<button class="ico" id="syncBtn" type="button" aria-label="ซิงก์ Drive ตอนนี้">🔄</button><button class="ico" id="menuBtn" type="button" aria-label="เมนู">⚙</button></div>' +
      '<div class="ofTabs"><button class="on" data-v="office" type="button"><b>🏡</b>ห้อง</button><button data-v="pending" type="button"><b>📥</b>ค้างตรวจ</button><button data-v="day" type="button"><b>📒</b>โน้ต</button></div>' +
      '<div id="ofScrim"></div><div id="ofSheet" role="dialog" aria-modal="true" data-dark="0"><div class="grab"></div><div class="phead"><img id="ofImg" alt=""><div><h2 id="ofNm"></h2><small id="ofRl"></small></div><button class="x" id="ofX" type="button" aria-label="ปิด">✕</button></div>' +
      '<div class="strip" id="ofStrip"></div><div id="ofBody"></div>' +
      '<div id="ofChatBox" class="collapsed"><button class="chatBar" id="ofChatBar" type="button"><span id="ofChatBarT">💬 แชท</span><span class="chev" aria-hidden="true">▾</span></button><div id="ofChat"></div><form id="ofForm" autocomplete="off"><input id="ofIn" maxlength="500" enterkeyhint="send"><button id="ofSend" type="submit">ส่ง</button></form></div></div>' +
      '<div id="ofMenu" hidden><div class="mCard"><h3>เมนู</h3><button type="button" id="mQr">📱 เปิดบนมือถือเครื่องอื่น (QR)</button><div id="mQrBox" hidden></div>' +
      '<button type="button" id="mKey">🔑 ใส่ Gemini API key (ให้ภูติคุยได้)</button><div id="mKeyBox" hidden><div id="mKeySt" class="muted"></div><input id="mKeyIn" type="password" placeholder="วาง API key ที่นี่" autocomplete="off" autocapitalize="off" spellcheck="false"><div class="krow"><button type="button" id="mKeySave">บันทึก</button><button type="button" id="mKeyDel" class="plain">ลบ key</button></div></div>' +
      '<button type="button" id="lockBtn">🔒 ล็อกแอป (ต้องใส่รหัสผ่านใหม่)</button><button type="button" id="cfgBtn">ล้างการตั้งค่าเครื่องนี้</button><button type="button" id="mClose" class="plain">ปิด</button></div></div><div id="ofAsk" hidden></div>';
    loadOfficeAssets().then(function () {
      if (view !== "office" || office) return;
      office = new Office($("ofStage"), { base: "office/", onTap: openSheet }); office.load(ofAssets, ofLayout, isNight()); office.setBadges(ofBadges);
    }).catch(function () { toast("โหลดภาพห้องไม่สำเร็จ ลองเปิดใหม่"); });
    officeData();
  }
  function headerOffice() {
    var sub = $("ofSub"); if (!sub) return;
    sub.textContent = (status.last_success ? "ซิงก์ล่าสุด " + hhmm(status.last_success) : "ยังไม่เคยซิงก์") + (status.pending != null ? " · รอตรวจ " + status.pending + " ไฟล์" : "");
    var pb = $("ofPend"); if (pb) pb.textContent = "📥 ค้างตรวจ" + (status.pending ? " " + status.pending : "");
  }
  function officeData() {
    return Promise.all([api("status"), api("daily", { date: todayStr() })]).then(function (r) {
      status = r[0]; var gs = groupFiles(r[1].files || []);
      ofToday = { groups: gs.length, files: r[1].files_total || 0, pending: gs.filter(function (g) { return groupDecision(g) === "pending"; }).length };
      ofBadges = { Minty: status.pending || 0, Notedy: ofToday.pending };
      if (office) office.setBadges(ofBadges); headerOffice();
    }).catch(function (e) { if (!authFail(e)) { var sub = $("ofSub"); if (sub) sub.textContent = e.message; } });
  }
  function sayFor(def) {
    if (def.id === "Notedy" && ofToday) return "วันนี้ไฟล์เปลี่ยน " + ofToday.files + " ไฟล์ใน " + ofToday.groups + " แฟ้ม" + (ofToday.pending ? " ยังไม่ได้ตัดสิน " + ofToday.pending + " แฟ้ม" : " ตัดสินครบแล้ว 🎉") + " ฝากถามอะไรก็ได้นะคะ";
    if (def.id === "Minty" && status.pending != null) return "มีไฟล์รอตรวจ " + status.pending + " ไฟล์ ช่วยกันดูนะ 🍀";
    return def.say;
  }
  function bubble(cls, text) { var d = document.createElement("div"); d.className = "m " + cls; d.textContent = text; $("ofChat").appendChild(d); return d; }
  function spRow(id, text, typing) {                             // LINE-style row: avatar + name + bubble
    var r = Office.BY[id] || { th: id }, d = document.createElement("div"); d.className = "mrow";
    d.innerHTML = avatar(id) + '<div class="mcol"><span class="who">' + esc(r.th) + '</span><div class="m sp' + (typing ? " typing" : "") + '">' + (typing ? "<i></i><i></i><i></i>" : esc(text)) + "</div></div>";
    $("ofChat").appendChild(d); return d;
  }
  function bubbleActs(entryId, actions, done) {
    if (!actions || !actions.length) return;
    var w = document.createElement("div"); w.className = "acts";
    actions.forEach(function (a, i) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = actLabel(a); b.dataset.ai = entryId + ":" + i; ofActs[entryId + ":" + i] = a;
      if ((done || []).indexOf(i) >= 0) { b.className = "done"; b.disabled = true; }
      w.appendChild(b);
    });
    $("ofChat").appendChild(w);
  }
  function actLabel(a) {
    return a.type === "open_pending" ? "📥 ไปหน้าค้างตรวจ" : a.type === "open_day" ? "📒 เปิดโน้ต " + (a.date ? shortDate(a.date) : "วันนี้") : a.type === "sync" ? "🔄 ซิงก์ Drive ตอนนี้"
      : a.type === "decide_folder" ? "✓ ตั้ง “" + a.folder + "” เป็น" + (a.decision === "work" ? "งาน" : "ไม่ใช่งาน") : a.type;
  }
  function peerName(id) { var r = Office.BY[id]; return r ? r.th : "เพื่อนภูติ"; }
  function renderEntries(entries, owner) {
    var box = $("ofChat"); box.innerHTML = "";
    var show = (entries || []).filter(function (e) { return e.role === "user" || e.role === "model" || e.role === "ask_out" || e.role === "ask_answer"; }).slice(-24);
    show.forEach(function (e) {
      if (e.role === "user") bubble("me", e.text);
      else if (e.role === "model") { spRow(owner, e.text); bubbleActs(e.id, e.actions, e.done); }
      else if (e.role === "ask_out") bubble("note", "↪ " + peerName(owner) + " ไปถาม" + peerName(e.peer) + ": " + trunc(e.text, 120));
      else spRow(e.peer, e.text);
    });
    box.scrollTop = box.scrollHeight;
  }
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
  function periodRange() {                                      // the monthly round runs from the 26th to the 26th
    var t = todayStr().split("-").map(Number), y = t[0], m = t[1], d = t[2], sy, sm, ey, em;
    if (d >= 26) { sy = y; sm = m; ey = m === 12 ? y + 1 : y; em = m === 12 ? 1 : m + 1; } else { ey = y; em = m; sy = m === 1 ? y - 1 : y; sm = m === 1 ? 12 : m - 1; }
    return { from: sy + "-" + p2(sm) + "-26", to: ey + "-" + p2(em) + "-26" };
  }
  function loadSpiritData(force) {
    if (!force && ofData && Date.now() - ofDataAt < 45000) return Promise.resolve(ofData);
    return Promise.all([api("inbox"), api("daily", { date: todayStr() })]).then(function (r) {
      ofData = { items: r[0].items || [], daily: r[1] }; ofDataAt = Date.now(); if (r[0].status) status = r[0].status; return ofData;
    });
  }
  function newest(g) { var m = ""; g.files.forEach(function (f) { if (f.modifiedTime > m) m = f.modifiedTime; }); return m; }
  function card(title, inner, cls) { return '<div class="card ' + (cls || "") + '"><h3>' + title + "</h3>" + inner + "</div>"; }
  function goBtn(go, label) { return '<button type="button" class="pbtn" data-go="' + go + '">' + label + "</button>"; }
  function itemRow(g, decide) {
    ofGroups[g.gid] = g.files.map(function (f) { return { file_id: f.id, version: f.version }; });
    var sub = g.files.length + " ไฟล์ · " + dayTime(newest(g)) + (g.path ? " · " + g.path : "");
    return '<div class="item"><div class="nm"><b>' + (g.folder ? "📁 " : "") + esc(g.name) + "</b><small>" + esc(sub) + "</small></div>" +
      (decide ? '<div class="dec"><button type="button" class="dbtn ok" data-md="work" data-g="' + esc(g.gid) + '">✓ งาน</button><button type="button" class="dbtn no" data-md="not-work" data-g="' + esc(g.gid) + '">✕ ไม่ใช่</button></div>'
              : (g.link ? '<a class="lnk" href="' + esc(g.link) + '" target="_blank" rel="noopener">เปิด ↗</a>' : "")) + "</div>";
  }
  function searchHtml(q) {
    var items = (ofData && ofData.items) || [], ql = String(q || "").trim().toLowerCase(), hit = items;
    if (ql) hit = items.filter(function (f) { return (f.name || "").toLowerCase().indexOf(ql) >= 0 || (f.folder_name || "").toLowerCase().indexOf(ql) >= 0; });
    hit = hit.slice().sort(function (a, b) { return a.modifiedTime < b.modifiedTime ? 1 : -1; });
    var shown = hit.slice(0, 30);
    return '<div class="muted">' + (ql ? "พบ " + hit.length + " ไฟล์" : "ไฟล์ล่าสุด") + (hit.length > 30 ? " (แสดง 30 รายการแรก)" : "") + "</div>" + (shown.length ? shown.map(function (f) {
      return '<div class="item"><div class="nm"><b>' + esc(f.name) + "</b><small>" + esc((f.folder_name ? "📁 " + f.folder_name + " · " : "") + dayTime(f.modifiedTime)) + "</small></div>" + tagHtml(f.decision || "pending", true) + (f.link ? ' <a class="lnk" href="' + esc(f.link) + '" target="_blank" rel="noopener">เปิด</a>' : "") + "</div>";
    }).join("") : '<div class="muted">ไม่พบไฟล์ที่ตรงกัน</div>');
  }
  function bodyFor(def, d) {
    ofGroups = {};
    var items = d.items, pend = items.filter(function (f) { return f.decision === "pending"; }), pg = groupFiles(pend).sort(function (a, b) { return newest(b) < newest(a) ? -1 : 1; }), today = groupFiles(d.daily.files || []);
    var out = '<div class="bubble">' + esc(sayFor(def)) + "</div>";
    if (def.id === "Notedy") {
      var dec = today.filter(function (g) { return groupDecision(g) !== "pending"; }).length;
      out += card("📒 สรุปวันนี้", '<div class="stat"><b>' + today.length + "</b> แฟ้มมีไฟล์เปลี่ยน · <b>" + (d.daily.files_total || 0) + '</b> ไฟล์</div><div class="bar"><i style="width:' + (today.length ? Math.round(dec * 100 / today.length) : 0) + '%"></i></div><div class="muted">ตัดสินแล้ว ' + dec + "/" + today.length + ' แฟ้ม</div><div class="row">' + goBtn("day", "📒 เปิดโน้ตรายวัน") + goBtn("pending", "📥 ค้างตรวจ (" + (status.pending || 0) + ")") + "</div>");
      if (pg.length) out += card("ค้างตรวจล่าสุด", pg.slice(0, 4).map(function (g) { return itemRow(g, false); }).join("") + (pg.length > 4 ? '<div class="muted">…อีก ' + (pg.length - 4) + " แฟ้ม</div>" : ""));
    } else if (def.id === "Minty") {
      out += card("📥 แฟ้มค้างตรวจ (" + pg.length + " แฟ้ม · " + pend.length + " ไฟล์)", pg.length ? pg.slice(0, 8).map(function (g) { return itemRow(g, true); }).join("") + (pg.length > 8 ? '<div class="muted">…อีก ' + (pg.length - 8) + " แฟ้ม</div>" : "") + '<div class="row">' + goBtn("pending", "ดูทั้งหมด") + "</div>" : '<div class="muted">ไม่มีอะไรค้าง 🎉</div>');
    } else if (def.id === "Drivey") {
      out += card("☁️ สถานะ Drive", '<div class="kv">ซิงก์ล่าสุด <b>' + (status.last_success ? esc(dayTime(status.last_success)) : "ยังไม่เคย") + '</b></div><div class="kv">ไฟล์ที่ติดตาม <b>' + (status.total || items.length) + "</b> · รอตรวจ <b>" + (status.pending || 0) + "</b></div>" +
        (status.error ? '<div class="warnTxt">ซิงก์ผิดพลาด: ' + esc(status.error) + "</div>" : '<div class="muted">ซิงก์อัตโนมัติทุก 30 นาที (อ่านเฉพาะชื่อ แฟ้ม วันที่ ไม่อ่านเนื้อไฟล์)</div>') + '<div class="row">' + goBtn("sync", "🔄 ซิงก์ตอนนี้") + "</div>");
    } else if (def.id === "Clouddy") {
      var issues = [], loose = items.filter(function (f) { return !f.folder_id && f.decision === "pending"; });
      if (status.error) issues.push("ซิงก์ Drive ผิดพลาด: " + esc(status.error));
      if (status.last_success && Date.now() - new Date(status.last_success).getTime() > 3 * 3600e3) issues.push("ซิงก์ล่าสุดเกิน 3 ชั่วโมงแล้ว");
      if (loose.length) issues.push("ไฟล์ค้างตรวจที่ไม่อยู่ในแฟ้ม " + loose.length + " ไฟล์ (เช่น " + esc(trunc(loose[0].name, 28)) + ")");
      pg.filter(function (g) { return g.files.length >= 40; }).slice(0, 3).forEach(function (g) { issues.push("แฟ้ม “" + esc(trunc(g.name, 28)) + "” ค้างอยู่ " + g.files.length + " ไฟล์ (เยอะผิดปกติ)"); });
      out += card(issues.length ? "⚠️ พบ " + issues.length + " จุดที่ควรดู" : "✅ ตรวจแล้วไม่พบปัญหา", issues.length ? '<ul class="chk">' + issues.map(function (i) { return "<li>" + i + "</li>"; }).join("") + "</ul>" : '<div class="muted">ซิงก์ปกติ · ไม่มีไฟล์หลุดแฟ้ม · ไม่มีแฟ้มค้างผิดปกติ</div>', issues.length ? "warn" : "ok");
    } else if (def.id === "Sunny") {
      var pr = periodRange(), inP = items.filter(function (f) { var dd = f.modifiedTime ? bkkDay(f.modifiedTime) : ""; return dd >= pr.from && dd <= pr.to; });
      var work = inP.filter(function (f) { return f.decision === "work"; }), gs = groupFiles(work).sort(function (a, b) { return b.files.length - a.files.length; }), still = inP.filter(function (f) { return f.decision === "pending"; }).length;
      out += card("☀️ สรุปรอบ " + esc(shortDate(pr.from)) + " – " + esc(shortDate(pr.to)), '<div class="stat"><b>' + gs.length + "</b> แฟ้มงาน · <b>" + work.length + "</b> ไฟล์ที่ยืนยันเป็นงาน</div>" +
        (gs.length ? '<table class="sum"><tr><th>แฟ้ม</th><th>ไฟล์</th></tr>' + gs.slice(0, 12).map(function (g) { return "<tr><td>" + esc(trunc(g.name, 34)) + "</td><td>" + g.files.length + "</td></tr>"; }).join("") + "</table>" + (gs.length > 12 ? '<div class="muted">…อีก ' + (gs.length - 12) + " แฟ้ม</div>" : "") : '<div class="muted">ยังไม่มีไฟล์ที่ตัดสินเป็นงานในรอบนี้</div>') +
        (still ? '<div class="muted">ยังรอตรวจในรอบนี้อีก ' + still + " ไฟล์</div>" : "") + '<div class="row">' + goBtn("pending", "📥 ไปตรวจต่อ") + "</div>");
    } else if (def.id === "Searchy") {
      out += card("🔎 ค้นหาไฟล์ย้อนหลัง", '<input id="ofSearch" class="sinp" placeholder="พิมพ์ชื่อไฟล์หรือชื่อแฟ้ม…" autocomplete="off" autocapitalize="off"><div id="ofSearchRes">' + searchHtml("") + "</div>");
    } else if (def.id === "Linky") {
      var fl = groupFiles(items.filter(function (f) { return f.folder_id; })).sort(function (a, b) { return newest(b) < newest(a) ? -1 : 1; }).slice(0, 12);
      out += card("🔗 แฟ้มที่แก้ล่าสุด", fl.length ? fl.map(function (g) { return '<div class="item"><div class="nm"><b>📁 ' + esc(g.name) + "</b><small>" + esc((g.path ? g.path + " · " : "") + dayTime(newest(g))) + "</small></div>" + (g.link ? '<a class="lnk" href="' + esc(g.link) + '" target="_blank" rel="noopener">เปิดแฟ้ม ↗</a>' : "") + "</div>"; }).join("") : '<div class="muted">ยังไม่มีแฟ้ม</div>');
    } else if (def.id === "Buddy") {
      out += card("🐱 ทิปการใช้แอป", '<ul class="chk"><li>แตะภูติแต่ละตัวเพื่อดูงานของตัวนั้น</li><li>มินตี้ตัดสินแฟ้มค้างตรวจได้เลย (✓ งาน / ✕ ไม่ใช่)</li><li>โน๊ตดี้สรุปวันนี้ เสิร์ชชี่ค้นไฟล์ ซันนี่สรุปรอบ 26→26</li><li>พิมพ์คุยกับภูติได้ที่แถบแชทด้านล่าง (ต้องใส่ Gemini key ที่ ⚙ ก่อน)</li><li>ซิงก์ Drive อัตโนมัติทุก 30 นาที หรือกด 🔄</li></ul>');
    } else {
      var why = { Newnew: "จัดไฟล์ PDF/XLSX และจุดตัดหน้า", Backy: "สำรองข้อมูลและถังขยะ", Drawy: "ปรับหน้าตา PDF", Planly: "วางแผนและกำหนดส่ง" }[def.id] || def.role;
      out += card("💻 ส่วนนี้ทำบนแอปคอม", '<div class="muted">' + esc(why) + " ยังต้องใช้แอปบนคอม" + (def.id === "Backy" ? " · ข้อมูลฝั่งมือถือเก็บอยู่ใน Google Sheet ของคุณเองอยู่แล้ว" : "") + " แต่ชวนคุยได้ตามปกติค่ะ</div>");
    }
    return out;
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
    api("ai_setkey", { key: key }, 30000).then(function (r) { inp.value = ""; $("mKeySt").textContent = r.has_key ? "✅ บันทึกแล้ว ใช้ได้เลย" : "ลบ key แล้ว"; toast(r.has_key ? "บันทึก key แล้ว ลองคุยกับภูติได้เลย" : "ลบ key แล้ว"); })
      .catch(function (e) { if (!authFail(e)) $("mKeySt").textContent = "⚠️ " + e.message; }).then(function () { b.disabled = false; });
  }
  function bubbleKey() {
    var w = document.createElement("div"); w.className = "acts"; w.innerHTML = '<button type="button" data-key="1">🔑 ใส่ Gemini key ตอนนี้</button>'; $("ofChat").appendChild(w);
  }
  function openSheet(def, asset) {
    askStop(); ofSpirit = def.id; ofDef = def; applyTheme(def.id);
    $("ofImg").src = office.u(office.night ? asset.night : asset.day); $("ofNm").textContent = def.th + " (" + def.id + ")"; $("ofRl").textContent = def.role + " · คุยกับ AI ได้ (Gemini ฟรี)";
    buildStrip(def.id); $("ofBody").innerHTML = '<div class="bubble">' + esc(sayFor(def)) + '</div><div class="muted" style="text-align:center">กำลังโหลดข้อมูล…</div>'; $("ofBody").scrollTop = 0;
    $("ofChat").innerHTML = ""; $("ofIn").placeholder = "พิมพ์คุยกับ" + def.th + "…"; setChatCollapsed(chatCollapsed, true); $("office").classList.add("open");
    var me = def.id;
    loadSpiritData(false).then(function (d) { if (ofSpirit === me) renderBody(def, d); })
      .catch(function (e) { if (ofSpirit === me && !authFail(e) && $("ofBody")) $("ofBody").innerHTML = '<div class="bubble">' + esc(sayFor(def)) + '</div><div class="banner">' + esc(e.message) + "</div>"; });
    api("chat_log", { spirit: def.id }).then(function (r) { if (ofSpirit === me && $("ofChat") && r.entries && r.entries.length) renderEntries(r.entries, me); })
      .catch(function (e) { if (ofSpirit === me && !authFail(e) && $("ofChat")) bubble("note", /unknown action/.test(e.message) ? "ระบบแชทยังไม่เปิดใช้ (อัปเดตสคริปต์ก่อน)" : e.message); });
  }
  function ofDecide(btn) {
    var items = ofGroups[btn.dataset.g]; if (!items) return; var row = btn.closest(".item"), bs = [].slice.call(row.querySelectorAll("button"));
    bs.forEach(function (b) { b.disabled = true; });
    decide(items, btn.dataset.md).then(function () {
      toast(btn.dataset.md === "work" ? "ตั้งเป็นงานแล้ว" : "ตั้งเป็นไม่ใช่งานแล้ว"); officeData();
      return loadSpiritData(true).then(function (d) { if (ofDef) renderBody(ofDef, d); });
    }).catch(function (e) { toast(e.message); bs.forEach(function (b) { b.disabled = false; }); });
  }
  function closeSheet() { var o = $("office"); if (o) o.classList.remove("open"); ofSpirit = null; try { document.activeElement.blur(); } catch (e) {} }
  function sendChat() {
    var inp = $("ofIn"), msg = (inp.value || "").trim(); if (!msg || chatBusy || !ofSpirit) return;
    chatBusy = true; inp.value = ""; $("ofSend").disabled = true; var me = ofSpirit; setChatCollapsed(false, true); bubble("me", msg); var wait = spRow(me, "", true); $("ofChat").scrollTop = 1e6;
    api("chat", { spirit: me, message: msg }, 110000).then(function (r) {
      if (ofSpirit !== me) return; wait.remove();
      spRow(me, r.reply); bubbleActs(r.id || "x" + Date.now(), r.actions, []);
      if (r.asked && r.asked.length) askFromLog(me, r.asked);
    }).catch(function (e) {
      if (authFail(e)) return; if (ofSpirit !== me) return; wait.remove();
      var nokey = /GEMINI_KEY|ยังไม่ได้ใส่/.test(e.message); bubble("err", nokey ? "ยังไม่ได้ใส่ Gemini API key" : e.message); if (nokey) bubbleKey();
    }).then(function () { chatBusy = false; var b = $("ofSend"); if (b) b.disabled = false; var c = $("ofChat"); if (c) c.scrollTop = c.scrollHeight; setChatCollapsed(chatCollapsed, true); });
  }
  /* "A runs to ask B": a small animated card played after the answer arrives */
  var askQ = [], askT = 0;
  function askFromLog(me, asked) {
    api("chat_log", { spirit: me }).then(function (r) {
      var es = r.entries || [], pairs = [];
      asked.forEach(function (p) {
        var q = null, a = null; es.forEach(function (e) { if (e.peer === p && e.role === "ask_out") q = e; if (e.peer === p && e.role === "ask_answer") a = e; });
        if (q && a) pairs.push({ a: me, b: p, q: q.text, ans: a.text });
      });
      if (pairs.length) { askQ = pairs; askNext(); }
    }).catch(function () {});
  }
  function askNext() {
    clearTimeout(askT); var it = askQ.shift(), el = $("ofAsk"); if (!it || !el || !ofAssets) { askStop(); return; }
    var A = ofAssets.chars.filter(function (c) { return c.id === it.a; })[0], B = ofAssets.chars.filter(function (c) { return c.id === it.b; })[0], ta = theme(it.a), tb = theme(it.b);
    if (!A || !B) { askStop(); return; }
    var hearts = ""; for (var i = 0; i < 7; i++) hearts += '<span class="fxHeart" style="left:' + (8 + i * 13) + "%;animation-delay:" + (i * 0.33) + 's">' + ["💖", "✨", "💬", "💗", "⭐", "💞", "✨"][i] + "</span>";
    el.hidden = false;
    el.innerHTML = '<div class="fxCard" style="background:linear-gradient(135deg,' + (ta.dark ? ta.a : ta.s) + "," + (tb.dark ? tb.a : tb.s) + ')"><button class="fxClose" id="askClose" type="button" aria-label="ปิด">✕</button><div class="fxRow">' +
      '<div class="fxSide a"><div class="fxBub">' + esc(trunc(it.q, 90)) + '</div><img src="' + office.u(A.day) + '" alt=""><div class="fxName">' + esc(peerName(it.a)) + "</div></div><div class=\"fxMid\">💬</div>" +
      '<div class="fxSide b"><div class="fxBub typing" id="askB"><i></i><i></i><i></i></div><img src="' + office.u(B.day) + '" alt=""><div class="fxName">' + esc(peerName(it.b)) + '</div></div></div><div class="fxCap">' + esc(peerName(it.a)) + " ไปถาม" + esc(peerName(it.b)) + "</div>" + hearts + "</div>";
    askT = setTimeout(function () { var b = $("askB"); if (b) { b.classList.remove("typing"); b.textContent = trunc(it.ans, 150); } askT = setTimeout(askNext, 6500); }, 1500);
  }
  function askStop() { clearTimeout(askT); askQ = []; var e = $("ofAsk"); if (e) { e.hidden = true; e.innerHTML = ""; } }
  function showQr() {
    if (!cfg || typeof qrcode !== "function") { toast("สร้าง QR ไม่ได้"); return; }
    var link = location.origin + location.pathname + "#setup=" + b64url(JSON.stringify({ u: cfg.u, t: cfg.t })), box = $("mQrBox");
    try { var q = qrcode(0, "L"); q.addData(link); q.make(); box.innerHTML = '<img alt="QR เชื่อมมือถือ" src="' + q.createDataURL(5, 4) + '"><p>เปิดกล้องมือถือสแกน แล้วตั้งรหัสผ่านแอป 6 หลักบนมือถือ<br><b>QR นี้มีรหัสลับ</b> สแกนเสร็จแล้วกดปิด อย่าแคปหรือส่งให้ใคร</p>'; box.hidden = false; }
    catch (e) { toast("สร้าง QR ไม่ได้"); }
  }
  function runAction(key, btn) {
    var a = ofActs[key]; if (!a) return; var eid = key.split(":")[0], idx = +key.split(":")[1], spirit = ofSpirit;
    function done() { btn.classList.add("done"); btn.disabled = true; api("chat_done", { spirit: spirit, id: eid, index: idx }).catch(function () {}); }
    if (a.type === "open_pending") { done(); closeSheet(); view = "pending"; renderShell(); load(); }
    else if (a.type === "open_day") { done(); closeSheet(); day = /^\d{4}-\d{2}-\d{2}$/.test(a.date || "") && a.date <= todayStr() ? a.date : todayStr(); view = "day"; renderShell(); load(); }
    else if (a.type === "sync") { done(); syncNow(); }
    else if (a.type === "decide_folder") {
      btn.disabled = true;
      api("inbox").then(function (r) {
        var items = (r.items || []).filter(function (f) { return f.folder_name === a.folder && f.decision === "pending"; }).map(function (f) { return { file_id: f.id, version: f.version }; });
        if (!items.length) { toast("ไม่พบไฟล์ค้างในแฟ้ม “" + a.folder + "”"); btn.disabled = false; return; }
        return decide(items, a.decision).then(function (d) { toast("ตั้งแล้ว " + d.done.length + " ไฟล์"); done(); officeData(); });
      }).catch(function (e) { toast(e.message); btn.disabled = false; });
    }
  }
  function syncNow() {
    var b = $("syncBtn"); if (b) b.disabled = true; toast("กำลังซิงก์ Drive…");
    api("sync").then(function (r) { toast(r.ok === false ? "ซิงก์ไม่สำเร็จ: " + r.error : r.busy ? "กำลังซิงก์อยู่แล้ว" : "ซิงก์แล้ว"); if (b) b.disabled = false; if (view === "office") officeData(); else load(); }).catch(function (e2) { toast(e2.message); if (b) b.disabled = false; });
  }
  if (window.visualViewport) {                                   // keep the chat sheet above the iPhone keyboard
    var vv = window.visualViewport, kb = function () { var sh = $("ofSheet"); if (!sh) return; sh.style.bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + "px"; sh.style.maxHeight = Math.max(280, Math.min(window.innerHeight * 0.9, vv.height - 10)) + "px"; };
    vv.addEventListener("resize", kb); vv.addEventListener("scroll", kb);
  }
  setInterval(function () { if (office && view === "office") office.setNight(isNight()); }, 60000);

  /* ---------- events ---------- */
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t.closest) return;
    var tab = t.closest(".tabs [data-v], .ofTabs [data-v]");
    if (tab) { if (tab.dataset.v === view) return; view = tab.dataset.v; if (view === "office") renderOffice(); else { renderShell(); load(); } return; }
    if (t.closest("#ofScrim") || t.closest("#ofX")) { closeSheet(); return; }
    if (t.closest("#ofPend")) { view = "pending"; renderShell(); load(); return; }
    var sp = t.closest("#ofStrip [data-sp]"); if (sp) { var cc = ofAssets.chars.filter(function (c) { return c.id === sp.dataset.sp; })[0]; if (cc && Office.BY[cc.id]) openSheet(Office.BY[cc.id], cc); return; }
    if (t.closest("#menuBtn")) { $("ofMenu").hidden = false; $("mQrBox").hidden = true; $("mKeyBox").hidden = true; return; }
    var go = t.closest("#ofBody [data-go]"); if (go) { var gv = go.dataset.go; closeSheet(); if (gv === "sync") syncNow(); else { view = gv; renderShell(); load(); } return; }
    var md = t.closest("#ofBody [data-md]"); if (md) { ofDecide(md); return; }
    if (t.closest("#ofChatBar")) { setChatCollapsed(!chatCollapsed); return; }
    if (t.closest("#mKey") || t.closest("[data-key]")) { openKeyBox(); return; }
    if (t.closest("#mKeySave")) { saveKey(false); return; }
    if (t.closest("#mKeyDel")) { saveKey(true); return; }
    if (t.closest("#mClose") || t.id === "ofMenu") { $("ofMenu").hidden = true; return; }
    if (t.closest("#mQr")) { showQr(); return; }
    if (t.closest("#askClose") || t.id === "ofAsk") { askStop(); return; }
    var qk = t.closest("#ofQuick [data-q]"); if (qk) { var q = qk.dataset.q; if (q === "sync") { closeSheet(); syncNow(); } else { closeSheet(); view = q; renderShell(); load(); } return; }
    var ai = t.closest("#ofChat [data-ai]"); if (ai) { runAction(ai.dataset.ai, ai); return; }
    var nav = t.closest("[data-nav]"); if (nav && !nav.disabled) { var nd = addDays(day, +nav.dataset.nav); if (nd <= todayStr()) { day = nd; load(); } return; }
    var act = t.closest("[data-nd]"); if (act) { onAction(act.dataset.nd, act); return; }
    if (t.closest("#syncBtn")) { syncNow(); return; }
    if (t.closest("#cfgBtn")) { if (confirm("ล้างการตั้งค่าบนเครื่องนี้และตั้งค่าใหม่?")) { try { localStorage.removeItem(CFG_KEY); } catch (e3) {} cfg = null; renderSetup(); } return; }
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
  document.addEventListener("input", function (e) { if (e.target && e.target.id === "ofSearch") { var r = $("ofSearchRes"); if (r) r.innerHTML = searchHtml(e.target.value); } });
  document.addEventListener("submit", function (e) { if (e.target && e.target.id === "ofForm") { e.preventDefault(); sendChat(); } });
  document.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target && (e.target.id === "pinA" || e.target.id === "pinB")) submitPin(); });
  document.addEventListener("visibilitychange", function () { if (document.hidden || !cfg || !cfg.p) return; if (view === "office") { if (office) office.setNight(isNight()); officeData(); } else if (!busy) load(true); });

  /* ---------- boot ---------- */
  day = todayStr();
  var fromHash = setupFromHash();
  if (fromHash) verifyAndStart(fromHash); else { cfg = loadCfg(); start(); }
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) navigator.serviceWorker.register("sw.js").catch(function () {});
})();
