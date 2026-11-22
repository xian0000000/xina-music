/* Service worker: bikin aplikasi bisa di-install dan cangkangnya (halaman, gaya, skrip, font) tetap terbuka saat offline.
   Strategi file satu origin: jaringan dulu, tapi kalau jaringan lambat (>3,5 dtk) atau mati, pakai cache. Pembaruan tetap sampai ke pengguna.
   Font Google: cache dulu, diperbarui diam-diam. Firebase dan lagu bersama tidak disentuh (lagu disimpan di IndexedDB oleh app.js). */
const CACHE = 'xina-music-v16';
const SHELL = ['./', 'index.html', 'app.js', 'style.css', 'lame.min.js', 'config.js', 'tick.wav', 'manifest.webmanifest',
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
  const net = fetch(req).then((res) => put(req, res));
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
