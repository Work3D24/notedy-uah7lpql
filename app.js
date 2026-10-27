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

  function renderSetup(msg) {
    showApp();
    $("app").innerHTML = '<div class="top"><img src="assets/Notedy.png" alt=""><div class="ttl"><b>Notedy</b><small>ตั้งค่าครั้งแรก</small></div></div>' +
      '<div class="setup"><h2>เชื่อมกับ Google ของคุณ</h2>' + (msg ? '<div class="banner">' + esc(msg) + "</div>" : "") +
      '<ol><li>เปิด Google Sheet "Notedy Cloud" ของคุณ แล้วไปแท็บ <b>setup</b></li><li>แตะลิงก์ในเซลล์ A2 (ลิงก์ตั้งค่า) บนเครื่องนี้ หรือกรอกด้านล่างเอง</li></ol>' +
      '<label class="muted">Web app URL</label><input id="cfgU" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" autocapitalize="off">' +
      '<label class="muted">รหัสลับ (64 ตัวอักษร)</label><input id="cfgT" placeholder="รหัสลับ" autocomplete="off" autocapitalize="off">' +
      '<button class="setup go" id="cfgGo" type="button">เชื่อมต่อ</button></div>';
  }
  function renderPin(create, msg) {
    showApp();
    var top = '<div class="top"><img src="assets/Notedy.png" alt=""><div class="ttl"><b>Notedy</b><small>' + (create ? "ตั้งรหัสเข้าแอป" : "ใส่รหัสเข้าแอป") + "</small></div></div>";
    $("app").innerHTML = top + '<div class="setup pinbox"><h2>' + (create ? "ตั้งรหัส 6 หลัก" : "ใส่รหัส 6 หลัก") + "</h2>" + (msg ? '<div class="banner">' + esc(msg) + "</div>" : "") +
      '<p class="muted">' + (create ? "ใช้เข้าแอปนี้ ตั้งครั้งเดียว เครื่องนี้จะจำไว้ให้ ไม่ต้องกรอกอีก (เครื่องใหม่ต้องกรอกรหัสนี้)" : "ใส่รหัสที่ตั้งไว้ เครื่องนี้จะจำไว้หลังกรอกถูก") + "</p>" +
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
      '<button class="ico" id="syncBtn" type="button" aria-label="ซิงก์ Drive ตอนนี้">🔄</button><button class="ico" id="lockBtn" type="button" aria-label="ล็อกแอป">🔒</button></div>' +
      '<div class="ofTabs"><button class="on" data-v="office" type="button"><b>🏡</b>ห้อง</button><button data-v="pending" type="button"><b>📥</b>ค้างตรวจ</button><button data-v="day" type="button"><b>📒</b>โน้ต</button></div>' +
      '<div id="ofScrim"></div><div id="ofSheet" role="dialog" aria-modal="true"><div class="grab"></div><div class="hd"><img id="ofImg" alt=""><div><h2 id="ofNm"></h2><div class="rl" id="ofRl"></div></div><button class="x" id="ofX" type="button" aria-label="ปิด">✕</button></div>' +
      '<div id="ofChat"></div><div class="ofQuick" id="ofQuick"></div><form id="ofForm" autocomplete="off"><input id="ofIn" maxlength="500" placeholder="พิมพ์คุยกับภูติ…" enterkeyhint="send"><button id="ofSend" type="submit">ส่ง</button></form></div>';
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
  function renderEntries(entries) {
    var box = $("ofChat"); box.innerHTML = "";
    var show = (entries || []).filter(function (e) { return e.role === "user" || e.role === "model" || e.role === "ask_out" || e.role === "ask_answer"; }).slice(-24);
    show.forEach(function (e) {
      if (e.role === "user") bubble("me", e.text);
      else if (e.role === "model") { bubble("sp", e.text); bubbleActs(e.id, e.actions, e.done); }
      else if (e.role === "ask_out") bubble("note", "↪ ถาม" + peerName(e.peer) + ": " + e.text);
      else bubble("note", "↩ " + peerName(e.peer) + " ตอบ: " + e.text);
    });
    box.scrollTop = box.scrollHeight;
  }
  function peerName(id) { var r = Office.BY[id]; return r ? r.th : "เพื่อนภูติ"; }
  function openSheet(def, asset) {
    ofSpirit = def.id; var th = asset.theme || { bg: "#3f9a6b", fg: "#fff" }, sh = $("ofSheet");
    sh.style.setProperty("--tc", th.bg); sh.style.setProperty("--tx", th.fg);
    $("ofImg").src = office.u(office.night ? asset.night : asset.day); $("ofNm").textContent = def.th; $("ofRl").textContent = def.role;
    $("ofChat").innerHTML = ""; bubble("sp", sayFor(def));
    $("ofQuick").innerHTML = (QUICK[def.id] || []).map(function (q) { return '<button type="button" data-q="' + q[0] + '">' + q[1] + "</button>"; }).join("");
    $("ofIn").placeholder = "คุยกับ" + def.th + "…"; $("office").classList.add("open");
    var me = def.id;
    api("chat_log", { spirit: def.id }).then(function (r) { if (ofSpirit === me && $("ofChat") && r.entries && r.entries.length) renderEntries(r.entries); })
      .catch(function (e) { if (ofSpirit === me && !authFail(e) && $("ofChat")) bubble("note", /unknown action/.test(e.message) ? "ระบบแชทยังไม่เปิดใช้ (อัปเดตสคริปต์ก่อน)" : e.message); });
  }
  function closeSheet() { var o = $("office"); if (o) o.classList.remove("open"); ofSpirit = null; try { document.activeElement.blur(); } catch (e) {} }
  function sendChat() {
    var inp = $("ofIn"), msg = (inp.value || "").trim(); if (!msg || chatBusy || !ofSpirit) return;
    chatBusy = true; inp.value = ""; $("ofSend").disabled = true; var me = ofSpirit; bubble("me", msg); var wait = bubble("note", "กำลังคิด… (ตอบครั้งแรกอาจช้านิดนึง)"); $("ofChat").scrollTop = 1e6;
    api("chat", { spirit: me, message: msg }, 110000).then(function (r) {
      if (ofSpirit !== me) return; wait.remove();
      (r.asked || []).forEach(function (id) { bubble("note", "↪ ถาม" + peerName(id) + " แล้ว"); });
      bubble("sp", r.reply); bubbleActs(r.id || "x" + Date.now(), r.actions, []);
    }).catch(function (e) {
      if (authFail(e)) return; if (ofSpirit !== me) return; wait.remove();
      var d = bubble("err", /GEMINI_KEY|ยังไม่ได้ใส่/.test(e.message) ? "ยังไม่ได้ใส่ Gemini API key ในสคริปต์ (ดูวิธีใน README)" : e.message);
    }).then(function () { chatBusy = false; var b = $("ofSend"); if (b) b.disabled = false; var c = $("ofChat"); if (c) c.scrollTop = c.scrollHeight; });
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
    var vv = window.visualViewport, kb = function () { var sh = $("ofSheet"); if (!sh) return; sh.style.bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + "px"; sh.style.maxHeight = Math.max(260, Math.min(window.innerHeight * 0.78, vv.height - 16)) + "px"; };
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
      var u = $("cfgU").value.trim(), tk = $("cfgT").value.trim();
      if (!URL_OK.test(u) || !TOKEN_OK.test(tk)) { renderSetup("URL หรือรหัสลับไม่ถูกต้อง"); return; }
      verifyAndStart({ u: u, t: tk });
    }
  });
  document.addEventListener("input", function (e) {              // PIN boxes: digits only, move on / submit when 6 are typed
    var t = e.target; if (!t || (t.id !== "pinA" && t.id !== "pinB")) return;
    t.value = t.value.replace(/\D/g, "").slice(0, 6);
    if (t.value.length < 6) return;
    if ($("app").dataset.pin === "create") { if (t.id === "pinA") $("pinB").focus(); else submitPin(); } else submitPin();
  });
  document.addEventListener("submit", function (e) { if (e.target && e.target.id === "ofForm") { e.preventDefault(); sendChat(); } });
  document.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target && (e.target.id === "pinA" || e.target.id === "pinB")) submitPin(); });
  document.addEventListener("visibilitychange", function () { if (document.hidden || !cfg || !cfg.p) return; if (view === "office") { if (office) office.setNight(isNight()); officeData(); } else if (!busy) load(true); });

  /* ---------- boot ---------- */
  day = todayStr();
  var fromHash = setupFromHash();
  if (fromHash) verifyAndStart(fromHash); else { cfg = loadCfg(); start(); }
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) navigator.serviceWorker.register("sw.js").catch(function () {});
})();
