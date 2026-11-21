// Salin jadi config.js untuk dipakai lokal (config.js di-ignore git).
// Di GitHub Pages, file ini dibuat otomatis oleh workflow dari secret FIREBASE_CONFIGS dan (opsional) YT_WORKER.
// Urutan: [server utama, server cadangan]
window.FIREBASE_CONFIGS = [
  { apiKey: "", authDomain: "", databaseURL: "", projectId: "", storageBucket: "", messagingSenderId: "", appId: "" },
  { apiKey: "", authDomain: "", databaseURL: "", projectId: "", storageBucket: "", messagingSenderId: "", appId: "" }
];
// Opsional: URL Cloudflare Worker untuk fitur "Unduh dari YouTube". Kalau diisi, kolom URL Worker di app disembunyikan.
window.YT_WORKER = "";
