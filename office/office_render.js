/* Notedy office renderer: draws the room from assets.json + layout.json. Used by the app page (read only) and the layout editor.
 *
 * layout.json (v2):
 *   room  {h}                          room height in px (the room scrolls inside the 390x844 screen)
 *   bg    {w, x, y}                    background width px, centre x in %, top y in px (scrolls with the room)
 *   chars {Id: {x, y, w, flip, hide}}  x = centre in % of width, y = feet in px from the top of the room, w = width px
 *   decos [{id, asset, x, y, w, layer, flip, hide}]
 *         layer "back"  behind the spirits (scrolls with room) · "front" in front of them (scrolls) · "pin" in front, glued to the
 *         screen (y = px from the bottom edge, does not scroll)
 * Spirits and same-layer decorations stack by y (lower on screen = in front).
 */
(function (g) {
  'use strict';
  var ROSTER = [
    { id: 'Notedy', th: 'โน๊ตดี้', role: 'หัวหน้าออฟฟิศ', say: 'วันนี้ไฟล์เปลี่ยน 18 ไฟล์ใน 3 แฟ้ม มาดูโน้ตรายวันกัน', go: 'เปิดโน้ตรายวัน' },
    { id: 'Buddy', th: 'บัดดี้', role: 'ผู้ช่วยแมวน้อย', say: 'เหนื่อยไหม พักจิบชากันก่อนนะ 🍵', go: 'คุยกับบัดดี้' },
    { id: 'Minty', th: 'มินตี้', role: 'จัดหมวด/แฟ้มงาน', say: 'มีไฟล์รอจัดหมวดเยอะเลย ช่วยกันนะ 🍀', go: 'ไปตรวจไฟล์' },
    { id: 'Newnew', th: 'นิวนิว', role: 'งานใหม่ยังไม่ตั้งค่า', say: 'มีงานใหม่ที่ยังไม่ได้ตั้งค่า', go: 'ตั้งค่างานใหม่' },
    { id: 'Drivey', th: 'ไดรฟ์วี่', role: 'เชื่อมต่อ Google Drive', say: 'เชื่อม Drive อยู่ ซิงก์ทุก 30 นาที', go: 'ซิงก์ตอนนี้' },
    { id: 'Backy', th: 'แบ็กกี้', role: 'สำรองข้อมูล', say: 'สำรองข้อมูลเรียบร้อย ถังขยะเก็บ 90 วัน', go: 'ดูข้อมูลสำรอง' },
    { id: 'Searchy', th: 'เสิร์ชชี่', role: 'ค้นหาย้อนหลัง', say: 'จะหาอะไรย้อนหลังบอกชื่อไฟล์หรือวันที่ได้เลย', go: 'เริ่มค้นหา' },
    { id: 'Linky', th: 'ลิงค์กี้', role: 'ลิงก์งาน', say: 'ลิงก์ทุกชิ้นยังเปิดได้ปกติ', go: 'เช็กลิงก์' },
    { id: 'Drawy', th: 'ดรอวี่', role: 'หน้าตา PDF', say: 'อยากปรับหน้าตา PDF ส่ง HR ให้น่ารักขึ้นไหมคะ', go: 'ดูตัวอย่าง PDF' },
    { id: 'Sunny', th: 'ซันนี่', role: 'สรุปรายงาน', say: 'เดือนนี้ฉันรวมยอดให้ได้ทันทีนะ', go: 'ดูสรุปเดือนนี้' },
    { id: 'Clouddy', th: 'คราวดี้', role: 'ตรวจข้อมูล', say: 'ยังไม่พบข้อมูลที่ผิดปกติเลยค่ะ ☁️', go: 'ตรวจอีกรอบ' },
    { id: 'Planly', th: 'แพลนลี่', role: 'วางแผนงาน', say: 'อยากให้ช่วยวางงานสัปดาห์หน้าไหม', go: 'เปิดแผน' }
  ];
  var BY = {}; ROSTER.forEach(function (r) { BY[r.id] = r; });
  /* atmosphere: floating light dust (canvas) + the slight "breathing" of the spirits. Tuned in the editor, saved as layout.fx */
  var FXD = { on: true, count: 36, min: 0.8, max: 2.4, speed: 8, rise: 0.5, drift: 10, twinkle: 1, alpha: 0.6, sparkle: 0.3, glow: 3,
              layer: 'front', colorDay: '#fff1bf', colorNight: '#c9dcff', breath: 2, breathSpeed: 4.2 };
  function el(t, c) { var e = document.createElement(t); if (c) e.className = c; return e; }
  function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function r1(v) { return Math.round(v * 10) / 10; }

  /* a layout that always has every spirit and a sane background, whatever was saved */
  function normalize(L, A) {
    L = L && L.v === 2 ? L : {};
    var lock = !(L.room && L.room.lock === false);                  /* default: one fixed 390x844 screen, no scrolling */
    var bgA = A.bg, roomH = lock ? 844 : ((L.room && L.room.h) || 1420);
    var bgw = bgA ? Math.max(390, Math.round(roomH * bgA.w / bgA.h)) : 900;   /* default: background fits the room height */
    var out = { v: 2, room: { h: (L.room && L.room.h) || (lock ? 844 : 1420), lock: lock }, bg: Object.assign({ w: bgw, x: 50, y: 0 }, L.bg || {}), chars: {}, decos: [] };
    var def = ['Notedy', 'Buddy', 'Minty', 'Newnew', 'Drivey', 'Backy', 'Searchy', 'Linky', 'Drawy', 'Sunny', 'Clouddy', 'Planly'];
    A.chars.forEach(function (c) {
      var k = def.indexOf(c.id), d;
      if (lock) { var i = k < 0 ? def.length : k; d = { x: [20, 50, 80][i % 3], y: 330 + Math.floor(i / 3) * 135, w: 110 }; }   /* 3 x 4 grid inside one screen */
      else if (k < 1) d = { x: 50, y: 318, w: 210 };
      else { var r = Math.floor((k - 1) / 2), right = (k - 1) % 2; d = { x: right ? 73 : 27, y: 500 + r * 165 + (right ? 60 : 0), w: 158 }; }
      out.chars[c.id] = Object.assign({ flip: false, hide: false }, d, (L.chars || {})[c.id] || {});
    });
    if (L.decos) out.decos = L.decos.map(function (d) { return Object.assign({ x: 50, y: 0, w: 390, layer: 'front', flip: false, hide: false }, d); });
    else (A.decos || []).forEach(function (a, i) { if (/daisy/.test(a.id)) out.decos.push({ id: 'd' + (i + 1), asset: a.id, x: 50, y: 96, w: 390, layer: 'pin', flip: false, hide: false }); });
    out.fx = Object.assign({}, FXD, L.fx || {});
    return out;
  }

  function Office(root, o) {
    var me = this; me.o = o || {}; me.root = root; me.night = false; me.A = { chars: [], decos: [], bg: null }; me.L = null; me.it = {}; me.badges = {}; me.sel = null;
    root.classList.add('of'); if (me.o.editor) root.classList.add('of-ed');
    me.scroll = el('div', 'of-scroll'); me.wrap = el('div', 'of-wrap'); me.bg = el('img', 'of-bg'); me.bg.draggable = false; me.bg.alt = '';
    me.cBack = el('div', 'of-layer'); me.cChars = el('div', 'of-layer'); me.cFront = el('div', 'of-layer'); me.pin = el('div', 'of-pin');
    me.wrap.appendChild(me.bg); me.wrap.appendChild(me.cBack); me.wrap.appendChild(me.cChars); me.wrap.appendChild(me.cFront);
    me.scroll.appendChild(me.wrap); root.appendChild(me.scroll); root.appendChild(me.pin);
    if (me.o.editor) me._bgDrag();
  }
  Office.FXD = FXD; Office.ROSTER = ROSTER; Office.BY = BY; Office.normalize = normalize; Office.find = find;

  Office.prototype.load = function (A, L, night) { this.A = A; this.L = normalize(L, A); this.night = !!night; this.sel = null; this.render(); };

  Office.prototype.render = function () {
    var me = this, L = me.L, A = me.A; me.it = {};
    [me.cBack, me.cChars, me.cFront, me.pin].forEach(function (c) { c.innerHTML = ''; });
    A.chars.forEach(function (c, i) { me._add('c:' + c.id, 'char', c, L.chars[c.id], me.cChars, i); });
    L.decos.forEach(function (d) { var a = find(A.decos, d.asset); if (a) me._add('d:' + d.id, 'deco', a, d, me.cBack, 0); });
    me.refresh();
  };

  Office.prototype._add = function (key, kind, asset, P, cont, i) {
    var me = this, def = BY[asset.id] || { th: asset.id };
    var e = el(kind === 'char' && !me.o.editor ? 'button' : 'div', 'of-it of-' + kind); if (e.tagName === 'BUTTON') e.type = 'button';
    var im = el('img'); im.alt = ''; im.draggable = false; e.appendChild(im);
    if (kind === 'char') {
      e.style.setProperty('--d', '-' + (i * 0.37).toFixed(2) + 's');
      var bd = el('span', 'bd'); bd.style.display = 'none'; e.appendChild(bd);
      var nm = el('span', 'nm'); nm.textContent = def.th; e.appendChild(nm);
      if (asset.theme) { nm.style.background = asset.theme.bg; nm.style.color = asset.theme.fg; }   /* chip takes the spirit's own colour */
      if (!me.o.editor) e.addEventListener('click', function () { me.o.onTap && me.o.onTap(def, asset); });
    }
    var it = { key: key, kind: kind, e: e, im: im, asset: asset, P: P, def: def, bd: bd || null };
    me.it[key] = it; cont.appendChild(e);
    if (me.o.editor) me._drag(it);
  };

  Office.prototype.containerFor = function (it) {
    var l = it.P.layer; return it.kind === 'char' ? this.cChars : (l === 'back' ? this.cBack : (l === 'pin' ? this.pin : this.cFront));
  };

  Office.prototype.place = function (it) {
    var P = it.P, e = it.e, pin = it.kind === 'deco' && P.layer === 'pin', c = this.containerFor(it);
    if (e.parentNode !== c) c.appendChild(e);
    e.style.left = P.x + '%'; e.style.width = P.w + 'px';
    if (pin) { e.style.top = 'auto'; e.style.bottom = P.y + 'px'; e.style.transform = 'translateX(-50%)'; e.style.zIndex = String(1000 - Math.round(P.y)); }
    else { e.style.bottom = 'auto'; e.style.top = P.y + 'px'; e.style.transform = 'translate(-50%,-100%)'; e.style.zIndex = String(Math.round(P.y)); }
    e.style.setProperty('--fx', P.flip ? -1 : 1);
    e.classList.toggle('hid', !!P.hide); e.classList.toggle('sel', this.sel === it.key);
  };

  Office.prototype.refresh = function () {
    var me = this, L = me.L, A = me.A, n = me.night, b = A.bg;
    if (!me._rz) { me._rz = 1; window.addEventListener('resize', function () { if (me.L && !me._dead) me._fit(); }); }
    if (b) { me.bg.src = me.u(n ? b.night : b.day); me.bg.style.width = L.bg.w + 'px'; me.bg.style.left = L.bg.x + '%'; me.bg.style.top = L.bg.y + 'px'; }
    me._fit(); me._fxApply();
    me.root.classList.toggle('bgsel', me.sel === 'bg'); me.root.classList.toggle('fxsel', me.sel === 'fx');
    Object.keys(me.it).forEach(function (k) {
      var it = me.it[k]; it.im.src = me.u((n ? it.asset.night : it.asset.day) || it.asset.day); me.place(it);
      if (it.bd) { var v = me.badges[it.asset.id]; it.bd.style.display = v ? '' : 'none'; it.bd.textContent = v || ''; }
    });
  };
  /* locked room: the 390x844 design box is scaled to cover the screen (exactly 1:1 on an iPhone 13 Pro); otherwise a normal scrolling room */
  Office.prototype._fit = function () {
    var me = this, lock = !!me.L.room.lock;
    me.root.classList.toggle('of-lock', lock);
    (lock ? me.wrap : me.root).appendChild(me.pin);
    if (lock) {
      var rw = me.root.clientWidth || 390, rh = me.root.clientHeight || 844;
      me.wrap.style.height = '844px'; me.wrap.style.setProperty('--s', Math.max(rw / 390, rh / 844)); me.scroll.scrollTop = 0;
    } else { me.wrap.style.height = me.L.room.h + 'px'; me.wrap.style.removeProperty('--s'); }
  };
  Office.prototype.u = function (path) { return (this.o.base || '') + path; };      /* where the images live when the page is not next to them */
  Office.prototype.destroy = function () { this._dead = true; if (this.root) { this.root.innerHTML = ''; this.root.classList.remove('of', 'of-lock', 'of-ed'); } };
  Office.prototype.setNight = function (n) { this.night = !!n; this.refresh(); };
  Office.prototype.setBadges = function (b) { this.badges = b || {}; this.refresh(); };
  Office.prototype.select = function (key) {
    this.sel = key; this.refresh(); this.o.onSelect && this.o.onSelect(key);
  };
  Office.prototype.viewCentreY = function () { return this.L.room.lock ? 422 : Math.round(this.scroll.scrollTop + this.root.clientHeight / 2); };

  /* ---- editor only ---- */
  Office.prototype._drag = function (it) {
    var me = this;
    it.e.addEventListener('pointerdown', function (ev) {
      ev.preventDefault(); ev.stopPropagation(); me.select(it.key);
      var P = it.P, pin = it.kind === 'deco' && P.layer === 'pin', sx = ev.clientX, sy = ev.clientY, ox = P.x, oy = P.y, st = me.scroll.scrollTop,
        k = me.o.scale ? me.o.scale() : 1, W = me.wrap.clientWidth || 390, last = ev, tm = 0;
      it.e.setPointerCapture(ev.pointerId);
      function mv(e) {
        last = e; var dx = (e.clientX - sx) / k, dy = (e.clientY - sy) / k + (pin ? 0 : me.scroll.scrollTop - st);
        P.x = r1(clamp(ox + dx / W * 100, -20, 120)); P.y = Math.round(pin ? oy - dy : oy + dy);
        if (!pin) P.y = clamp(P.y, 0, (me.L.room.lock ? 844 : me.L.room.h) + 200);
        me.place(it); me.o.onChange && me.o.onChange(it.key);
        var r = me.root.getBoundingClientRect(), edge = 70 * k, d = e.clientY < r.top + edge ? -9 : (e.clientY > r.bottom - edge ? 9 : 0);
        clearInterval(tm); if (d && !pin && !me.L.room.lock) tm = setInterval(function () { me.scroll.scrollTop += d; mv(last); }, 16);
      }
      function up() { clearInterval(tm); it.e.removeEventListener('pointermove', mv); it.e.removeEventListener('pointerup', up); it.e.removeEventListener('pointercancel', up); me.o.onCommit && me.o.onCommit(); }
      it.e.addEventListener('pointermove', mv); it.e.addEventListener('pointerup', up); it.e.addEventListener('pointercancel', up);
    });
  };
  Office.prototype._bgDrag = function () {
    var me = this;
    me.scroll.addEventListener('pointerdown', function (ev) {
      if (me.sel !== 'bg' || ev.target.closest('.of-it')) return;
      var B = me.L.bg, sx = ev.clientX, sy = ev.clientY, ox = B.x, oy = B.y, st = me.scroll.scrollTop, k = me.o.scale ? me.o.scale() : 1, W = me.wrap.clientWidth || 390;
      me.scroll.setPointerCapture(ev.pointerId);
      function mv(e) { B.x = r1(ox + (e.clientX - sx) / k / W * 100); B.y = Math.round(oy + (e.clientY - sy) / k + (me.scroll.scrollTop - st)); me.refresh(); me.o.onChange && me.o.onChange('bg'); }
      function up() { me.scroll.removeEventListener('pointermove', mv); me.scroll.removeEventListener('pointerup', up); me.scroll.removeEventListener('pointercancel', up); me.o.onCommit && me.o.onCommit(); }
      me.scroll.addEventListener('pointermove', mv); me.scroll.addEventListener('pointerup', up); me.scroll.addEventListener('pointercancel', up);
    });
  };
  /* add / remove decorations (editor) */
  Office.prototype.addDeco = function (assetId) {
    var me = this, a = find(me.A.decos, assetId); if (!a) return null;
    var n = 1; while (find(me.L.decos, 'd' + n)) n++;
    var w = Math.min(390, a.w), d = { id: 'd' + n, asset: assetId, x: 50, y: me.viewCentreY(), w: w, layer: 'front', flip: false, hide: false };
    me.L.decos.push(d); me.render(); me.select('d:' + d.id); return d;
  };
  Office.prototype.cloneDeco = function (id) {
    var me = this, s = find(me.L.decos, id); if (!s) return null; var n = 1; while (find(me.L.decos, 'd' + n)) n++;
    var d = Object.assign({}, s, { id: 'd' + n, x: r1(clamp(s.x + 6, 0, 100)), y: s.y + (s.layer === 'pin' ? -20 : 20) });
    me.L.decos.push(d); me.render(); me.select('d:' + d.id); return d;
  };
  Office.prototype.removeDeco = function (id) {
    var me = this; me.L.decos = me.L.decos.filter(function (d) { return d.id !== id; }); me.sel = null; me.render(); me.o.onSelect && me.o.onSelect(null);
  };

  /* ---- breathing + floating light dust ---- */
  function rgb(hex) { var m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); var n = m ? parseInt(m[1], 16) : 0xffffff; return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function makeSprite(color, star) {
    var c = el('canvas'); c.width = c.height = 64; var x = c.getContext('2d'), k = rgb(color), col = function (a) { return 'rgba(' + k[0] + ',' + k[1] + ',' + k[2] + ',' + a + ')'; };
    function blob(sx, sy, a0) { x.save(); x.translate(32, 32); x.scale(sx, sy); var g = x.createRadialGradient(0, 0, 0, 0, 0, 32); g.addColorStop(0, col(a0)); g.addColorStop(.25, col(a0 * .55)); g.addColorStop(1, col(0)); x.fillStyle = g; x.beginPath(); x.arc(0, 0, 32, 0, 6.2832); x.fill(); x.restore(); }
    if (!star) { blob(1, 1, 1); return c; }
    blob(.5, .5, .9);                                                  /* soft core */
    x.save(); x.translate(32, 32);
    [[1, .07, 0, .95], [.07, 1, 0, .95], [.55, .05, Math.PI / 4, .55], [.55, .05, -Math.PI / 4, .55]].forEach(function (s) {   /* 2 long + 2 short rays */
      x.save(); x.rotate(s[2]); x.scale(s[0], s[1]); var g = x.createRadialGradient(0, 0, 0, 0, 0, 32); g.addColorStop(0, col(s[3])); g.addColorStop(.4, col(s[3] * .35)); g.addColorStop(1, col(0));
      x.fillStyle = g; x.beginPath(); x.arc(0, 0, 32, 0, 6.2832); x.fill(); x.restore();
    });
    x.restore(); return c;
  }
  Office.prototype._fxInit = function () {
    var me = this; if (me.fxc) return;
    me.fxc = el('canvas', 'of-fx'); me.fxx = me.fxc.getContext('2d'); me.fxp = []; me._fxs = {}; me._fxk = ''; me._fxt = 0;
    var still = !me.o.editor && window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    function loop(t) { if (me._dead) return; me._fxFrame(t); requestAnimationFrame(loop); }
    if (still) setTimeout(function () { me._fxFrame(1000); }, 50); else requestAnimationFrame(loop);
  };
  Office.prototype._fxApply = function () {
    var me = this, L = me.L, F = L.fx; me._fxInit();
    me.root.style.setProperty('--br', (F.breath || 0) / 100); me.root.style.setProperty('--bs', (F.breathSpeed || 4) + 's');
    me.root.classList.toggle('nobreath', !(F.breath > 0));
    me.fxc.style.display = F.on ? '' : 'none';
    var back = F.layer === 'back';
    if (me.fxc.parentNode !== me.wrap || (back ? me.fxc.nextSibling !== me.cBack : me.fxc.previousSibling !== me.cFront)) me.wrap.insertBefore(me.fxc, back ? me.cBack : me.cFront.nextSibling);
    var lock = !!L.room.lock, W = me.wrap.clientWidth || 390, H = lock ? 844 : L.room.h, sc = lock ? (parseFloat(me.wrap.style.getPropertyValue('--s')) || 1) : 1;
    var d = Math.min(2.5, Math.max(1, (window.devicePixelRatio || 1) * sc)); while (W * H * d * d > 3.5e6 && d > 1) d -= .25;
    var key = W + 'x' + H + 'x' + d;
    if (key !== me._fxk) {
      me._fxk = key; me.fxc.width = Math.round(W * d); me.fxc.height = Math.round(H * d); me.fxc.style.width = W + 'px'; me.fxc.style.height = H + 'px';
      me._fxW = W; me._fxH = H; me._fxd = d; me.fxp.forEach(function (p) { p.x = Math.random() * W; p.y = Math.random() * H; });
    }
    while (me.fxp.length < F.count) me.fxp.push({ x: Math.random() * me._fxW, y: Math.random() * me._fxH, r: Math.random(), a: Math.random(), ph: Math.random() * 6.283, w: Math.random(), u: Math.random(), dx: Math.random() * 2 - 1, v: Math.random() });
    me.fxp.length = Math.max(0, Math.min(me.fxp.length, F.count | 0));
  };
  Office.prototype.fxReseed = function () { var me = this; me.fxp.forEach(function (p) { p.x = Math.random() * me._fxW; p.y = Math.random() * me._fxH; p.r = Math.random(); p.u = Math.random(); }); };
  Office.prototype._fxFrame = function (t) {
    var me = this, F = me.L && me.L.fx, x = me.fxx; if (!F || !F.on || !me.fxc.width) return;
    var dt = me._fxt ? Math.min(.05, (t - me._fxt) / 1000) : 0; me._fxt = t; var s = t / 1000, W = me._fxW, H = me._fxH;
    var color = me.night ? F.colorNight : F.colorDay, dot = me._fxs['d' + color] || (me._fxs['d' + color] = makeSprite(color, 0)), star = me._fxs['s' + color] || (me._fxs['s' + color] = makeSprite(color, 1));
    x.setTransform(me._fxd, 0, 0, me._fxd, 0, 0); x.clearRect(0, 0, W, H); x.globalCompositeOperation = me.night ? 'lighter' : 'source-over';
    for (var i = 0; i < me.fxp.length; i++) {
      var p = me.fxp[i];
      p.y -= F.rise * F.speed * (.4 + p.v * 1.2) * dt;                                              /* slow rise (or fall if rise < 0) */
      p.x += (Math.sin(s * (.35 + p.w * .5) + p.ph) * F.drift + p.dx * F.speed * .25) * dt;           /* wander sideways ... */
      p.y += Math.cos(s * (.3 + p.v * .4) + p.ph * 1.7) * F.drift * .5 * dt;                          /* ... and up/down: drifting, not straight */
      if (p.y < -14) p.y = H + 14; else if (p.y > H + 14) p.y = -14; if (p.x < -14) p.x = W + 14; else if (p.x > W + 14) p.x = -14;
      var tw = .5 + .5 * Math.sin(s * F.twinkle * (1.2 + p.w * 2.2) + p.ph * 3); tw = tw * tw * (3 - 2 * tw);
      var isStar = p.u < F.sparkle, a = F.alpha * (.12 + .88 * (isStar ? tw * tw : tw)) * (.55 + .45 * p.a);
      if (a < .01) continue;
      var r = (F.min + (F.max - F.min) * p.r) * F.glow * (isStar ? 2.2 : 1);
      x.globalAlpha = Math.min(1, a); x.drawImage(isStar ? star : dot, p.x - r, p.y - r, r * 2, r * 2);
    }
    x.globalAlpha = 1;
  };

  g.Office = Office;
})(window);
