/* Service worker: bikin aplikasi bisa di-install dan cangkangnya (halaman, gaya, skrip, font) tetap terbuka saat offline.
   Strategi file satu origin: jaringan dulu, tapi kalau jaringan lambat (>3,5 dtk) atau mati, pakai cache. Pembaruan tetap sampai ke pengguna.
   Font Google: cache dulu, diperbarui diam-diam. Firebase dan lagu bersama tidak disentuh (lagu disimpan di IndexedDB oleh app.js). */
const CACHE = 'xina-music-v83';
const SHELL = ['./', 'index.html', 'app.js', 'style.css', 'lame.min.js', 'config.js', 'tick.wav', 'ship-light.webp', 'ship-dark.webp', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon.svg', 'icons/apple-touch-icon.png', 'icons/icon-maskable-512.png'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const NET_TIMEOUT = 3500;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const put = (req, res) => { if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); } return res; };

// jaringan dulu dengan batas waktu; kalau gagal / kelamaan, cache (halaman navigasi jatuh ke index.html)
async function networkFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  const net = fetch(req, { cache: 'no-cache' }).then((res) => put(req, res));   // selalu cek ke server (lewati cache HTTP 10 menit GitHub Pages), supaya HP tidak memakai style.css / app.js lama
  if (!hit) return net.catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
  const slow = new Promise((res) => setTimeout(() => res(hit), NET_TIMEOUT));
  return Promise.race([net.catch(() => hit), slow]);
}
// font: pakai yang tersimpan, sambil memperbarui di belakang
async function cacheFirst(req) {
  const hit = await caches.match(req);
  const net = fetch(req).then((res) => put(req, res)).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === location.origin) { e.respondWith(networkFirst(req)); return; }
  if (FONT_HOSTS.includes(url.hostname)) e.respondWith(cacheFirst(req));
});

/* ---------- notifikasi pesan baru (Web Push dari Worker; isi pesan sudah ada di payload) ---------- */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { /* abaikan */ }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // aplikasi sedang terlihat: titik merah di tombol papan pesan sudah cukup. Pengecualian iOS: Safari mewajibkan setiap push menampilkan notifikasi.
    if (wins.some((c) => c.visibilityState === 'visible') && !/iphone|ipad|ipod/i.test(self.navigator.userAgent)) return;
    await self.registration.showNotification(String(d.n || 'Pesan baru').slice(0, 40), {
      body: String(d.t || 'Ada pesan baru di papan pesan').slice(0, 200),
      icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'xina-msg', renotify: true, data: { go: 'msgs' },
    });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find((c) => 'focus' in c);
    if (w) { await w.focus(); w.postMessage({ type: 'open-msgs' }); return; }
    await self.clients.openWindow('./#pesan');
  })());
});
