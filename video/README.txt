Taruh video laut hasil render di folder ini:
  sea-light.mp4 (tema terang), sea-dark.mp4 (tema gelap)   [opsional: .webm dengan nama sama]

Render otomatis (npm i playwright && npx playwright install chromium; ffmpeg harus ada di PATH):
  node tools/render-sea.mjs light 1280 30 20
  node tools/render-sea.mjs dark  1280 30 20
Argumen: tema, lebar px (tinggi otomatis 4/3 lebar), fps, detik. Sambungan loop di-crossfade otomatis.

Area dunia yang dirender: 480 x 640 satuan, kapal di tengah (1 satuan = 1% sisi pendek layar). Kalau beda, ubah --sv-w / --sv-h di style.css (.sea-video).
Kalau file tidak ada, program memakai laut WebGL lama.
