/* Notedy cloud PWA: cache the app shell so it opens instantly; the Google script API is never cached. */
var CACHE = "notedy-cloud-v9";
var SHELL = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/favicon-64.png", "assets/Notedy.png", "assets/Drivee.png", "office/office.css", "office/office_render.js", "office/assets.json", "qr.js"];
self.addEventListener("install", function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); })); self.skipWaiting(); });
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(function (r) { if (r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); } return r; }).catch(function () { return caches.match(e.request); }));
});

/* ---------- Web Push: the script sends an EMPTY push; we ask it how many folders are new (counts only, never names) and show the notification ---------- */
function cfgFromIdb() {
  return new Promise(function (res) {
    try {
      var rq = indexedDB.open("notedy", 1); rq.onupgradeneeded = function () { rq.result.createObjectStore("kv"); };
      rq.onerror = function () { res(null); };
      rq.onsuccess = function () { try { var g = rq.result.transaction("kv").objectStore("kv").get("cfg"); g.onsuccess = function () { res(g.result || null); }; g.onerror = function () { res(null); }; } catch (e) { res(null); } };
    } catch (e) { res(null); }
  });
}
function pushText() {
  return cfgFromIdb().then(function (c) {
    if (!c || !c.u || !c.t) return null;
    return fetch(c.u, { method: "POST", body: JSON.stringify({ token: c.t, pin: c.p || undefined, action: "push_peek" }), headers: { "Content-Type": "text/plain;charset=utf-8" } }).then(function (r) { return r.json(); }).catch(function () { return null; });
  }).then(function (r) {
    if (r && r.ok && r.test) return "ทดสอบการแจ้งเตือนสำเร็จ 🎉";
    if (r && r.ok && r.folders) return "มีแฟ้มอัปเดตใหม่ " + r.folders + " แฟ้ม";
    return "มีงานอัปเดตใหม่ใน Drive";                         // always show something: browsers drop subscriptions that stay silent
  });
}
self.addEventListener("push", function (e) {
  e.waitUntil(pushText().then(function (body) {
    return self.registration.showNotification("Notedy", { body: body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "notedy-new", renotify: true, data: { url: "./" } });
  }));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) if ("focus" in cs[i]) return cs[i].focus();
    return self.clients.openWindow("./");
  }));
});
