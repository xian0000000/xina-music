(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const audio = $('#audio');
  const el = {
    stage: $('#stage'), seats: $('#seats'), count: $('#count'),
    record: $('#record'), arm: $('#tonearm'),
    knob: $('#knob'), dial: $('#knobDial'),
    disp: $('#dispText'), dispBtn: $('#display'),
    nowTitle: $('#nowTitle'), seek: $('#seek'), tCur: $('#tCur'), tDur: $('#tDur'),
    file: $('#file'), platter: $('#platter'), fx: $('#fx'), spot: $('#spot'), toast: $('#toast'),
    shuffle: $('#btnShuffle'), loop: $('#btnLoop'),
    theme: $('#theme'), bg: $('#bg'), glow: $('.l-glow'), tt: $('.turntable')
  };
  /* Jam raksasa: dulu satu SVG besar yang digambar ulang penuh tiap gir/jarum bergerak (sangat berat di HP).
     Sekarang dipecah: dial statis (digambar sekali), tiap gir = SVG kecil yang diputar GPU lewat CSS transform, jarum = SVG sendiri. */
  function splitSigil() {
    const svg = document.querySelector('svg.l-sigil');
    if (!svg || !svg.getBBox) return [];
    const NS = 'http://www.w3.org/2000/svg', list = [];
    const wrap = document.createElement('div');
    wrap.className = 'l-sigil'; wrap.setAttribute('aria-hidden', 'true');
    svg.parentNode.insertBefore(wrap, svg);
    svg.setAttribute('class', 'sg-dial'); wrap.append(svg);
    const hands = svg.querySelector('.hands');
    let capSvg = null;
    if (hands) {
      for (const hp of [...hands.querySelectorAll('.hand')]) {            // tiap jarum = SVG kecil yang diputar GPU (id dipindah ke SVG-nya, jadi kode jam tidak berubah)
        const hs = document.createElementNS(NS, 'svg');
        hs.setAttribute('viewBox', '46 -7 8 59'); hs.setAttribute('class', 'sg-hand'); hs.id = hp.id; hp.removeAttribute('id');
        hs.style.left = '46%'; hs.style.top = '-7%'; hs.style.width = '8%'; hs.style.height = '59%';
        hs.style.transformOrigin = '50% ' + (57 / 59 * 100).toFixed(3) + '%';
        const hg = document.createElementNS(NS, 'g'); hg.setAttribute('stroke', 'none'); hg.style.color = '#000';
        hg.append(hp); hs.append(hg); wrap.append(hs);
      }
      capSvg = document.createElementNS(NS, 'svg');                       // tutup poros di tengah (statis), di atas jarum
      capSvg.setAttribute('viewBox', '0 0 100 100'); capSvg.setAttribute('class', 'sg-cap');
      capSvg.append(hands); wrap.append(capSvg);
    }
    for (const g of [...svg.querySelectorAll('.gear')]) {
      let b; try { b = g.getBBox(); } catch (e) { b = null; }
      const o = (g.getAttribute('style') || '').match(/transform-origin:\s*([\d.]+)px\s+([\d.]+)px/);
      if (!b || !b.width || !o) continue;                                  // tidak bisa dipisah: biarkan di dial seperti semula
      const pad = 1, x = b.x - pad, y = b.y - pad, w = b.width + 2 * pad, h = b.height + 2 * pad;
      const s2 = document.createElementNS(NS, 'svg');
      s2.setAttribute('viewBox', x + ' ' + y + ' ' + w + ' ' + h);
      s2.setAttribute('class', 'sg-gear');
      s2.style.left = x + '%'; s2.style.top = y + '%'; s2.style.width = w + '%'; s2.style.height = h + '%';
      s2.style.transformOrigin = ((parseFloat(o[1]) - x) / w * 100).toFixed(3) + '% ' + ((parseFloat(o[2]) - y) / h * 100).toFixed(3) + '%';
      const grp = document.createElementNS(NS, 'g');                       // atribut gambar yang tadinya diwarisi dari grup induk
      grp.setAttribute('fill', 'none'); grp.setAttribute('stroke', 'currentColor');
      grp.setAttribute('stroke-linecap', 'round'); grp.setAttribute('stroke-linejoin', 'round');
      const k = parseFloat(g.dataset.k), r = parseFloat(g.dataset.r) || 0;
      g.removeAttribute('style'); g.classList.remove('gear');
      grp.append(g); s2.append(grp); wrap.insertBefore(s2, wrap.querySelector('.sg-hand'));
      list.push({ el: s2, k, r });
    }
    return list;
  }
  const gears = [...document.querySelectorAll('.label .gear')].map((e) => ({ el: e, k: parseFloat(e.dataset.k), r: parseFloat(e.dataset.r) || 0 })).concat(splitSigil());
  // k = kecepatan relatif (dihitung dari jumlah gigi, arah selang-seling), r = sudut awal supaya gigi saling mengunci
  const placeGears = (ang) => { for (const g of gears) g.el.style.transform = 'rotate(' + (g.r + ang * g.k).toFixed(3) + 'deg)'; };
  const rm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // tab disembunyikan: animasi CSS dijeda (tidak terlihat, jadi tidak ada bedanya)
  document.addEventListener('visibilitychange', () => document.documentElement.classList.toggle('is-hidden', document.hidden));

  /* ---------- util ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* abaikan */ } }
  };
  const uid = () => Math.random().toString(36).slice(2, 10);
  const fmt = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  };
  const cleanName = (n) => n.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Tanpa judul';
  let toastTimer;
  const toast = (msg) => {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2400);
  };

  // angka menghitung naik/turun dengan ease-out (seperti count-up di web cuaca)
  function tween(node, to, dec, suf, dur) {
    const from = node._v || 0;
    cancelAnimationFrame(node._raf);
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - k, 3);
      node._v = from + (to - from) * e;
      node.textContent = node._v.toFixed(dec) + suf;
      if (k < 1) node._raf = requestAnimationFrame(step); else node._v = to;
    };
    node._raf = requestAnimationFrame(step);
  }
  function setNum(node, to, dec, suf) {
    if (node._to === to) return;
    node._to = to;
    if (rm()) { node._v = to; node.textContent = to.toFixed(dec) + suf; return; }
    tween(node, to, dec, suf, 900);
  }

  /* ---------- tema (lingkaran membesar dari tombol) ---------- */
  const root = document.documentElement;
  const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  const themeLabel = () => { el.theme.textContent = isDark() ? 'Mode terang' : 'Mode gelap'; };
  el.theme.addEventListener('click', () => {
    const apply = () => {
      root.dataset.theme = isDark() ? 'light' : 'dark';
      store.set('lobby.theme', root.dataset.theme);
      themeLabel();
    };
    if (!document.startViewTransition || rm()) { apply(); return; }
    const r = el.theme.getBoundingClientRect();
    root.style.setProperty('--tx', (r.left + r.width / 2) + 'px');
    root.style.setProperty('--ty', (r.top + r.height / 2) + 'px');
    document.startViewTransition(apply);
  });
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { themeLabel(); });
  } catch (e) { /* abaikan */ }

  /* ---------- state pemutar ---------- */
  const state = { tracks: [], index: -1, shuffle: false, loop: 'all', vol: 0.8 };
  const REST_ANGLE = 0;
  const currentTitle = () => (state.tracks[state.index] ? state.tracks[state.index].name : '');

  function addFiles(list) {
    const files = [...list].filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/i.test(f.name));
    if (!files.length) { toast('Tidak ada file audio yang dipilih'); return; }
    if (fb) { uploadShared(files); return; }          // mode lobby: lagu dibagikan ke semua orang
    const wasEmpty = state.tracks.length === 0;
    for (const f of files) {
      const t = { id: uid(), name: cleanName(f.name), url: URL.createObjectURL(f), dur: 0 };
      state.tracks.push(t);
      const probe = new Audio();
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => { t.dur = probe.duration; renderQueue(); };
      probe.src = t.url;
    }
    renderQueue();
    if (wasEmpty) loadTrack(0, true, 1);
    toast(files.length + ' lagu ditambahkan');
  }

  function loadTrack(i, autoplay, dir) {
    if (i < 0 || i >= state.tracks.length) return;
    state.index = i;
    audio.src = state.tracks[i].url;
    audio.load();
    updateNow(dir);
    renderQueue();
    updateMediaSession();
    if (autoplay) audio.play().catch(() => {});
    announce();
  }

  function next(auto) {
    clockRewind();
    if (fb) { sharedNext(auto); return; }
    const n = state.tracks.length;
    if (!n) return;
    if (auto && state.loop === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    let i;
    if (state.shuffle && n > 1) {
      do { i = Math.floor(Math.random() * n); } while (i === state.index);
    } else {
      i = state.index + 1;
      if (i >= n) {
        if (state.loop === 'all' || !auto) i = 0;
        else { loadTrack(0, false, 1); return; }
      }
    }
    loadTrack(i, true, 1);
  }

  function prev() {
    clockRewind();
    if (fb) { if (audio.currentTime > 3) seekTo(0); else sharedMove(-1); return; }
    const n = state.tracks.length;
    if (!n) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    loadTrack((state.index - 1 + n) % n, true, -1);
  }

  function toggle() {
    if (fb) { sharedToggle(); return; }
    if (!state.tracks.length) { el.file.click(); return; }
    if (state.index < 0) loadTrack(0, true, 1);
    else if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  /* ---------- render ---------- */
  function renderQueue() {
    document.body.classList.toggle('empty', state.tracks.length === 0);
    el.seek.disabled = state.tracks.length === 0;
  }

  // judul lagu: keluar dengan blur, masuk dari sisi lain
  let shownTitle = 'Belum ada lagu';
  function swapTitle(text, dir) {
    if (text === shownTitle) return;
    shownTitle = text;
    const n = el.nowTitle;
    clearTimeout(n._t);
    if (rm()) { n.textContent = text; return; }
    root.style.setProperty('--dir', dir < 0 ? -1 : 1);
    n.classList.remove('swap-in');
    n.classList.add('swap-out');
    n._t = setTimeout(() => {
      n.textContent = text;
      n.classList.remove('swap-out');
      n.classList.add('swap-in');
      n._t = setTimeout(() => n.classList.remove('swap-in'), 450);
    }, 220);
  }

  function updateNow(dir) {
    const t = currentTitle();
    swapTitle(t || 'Belum ada lagu', dir || 1);
    document.title = t ? t + ' — Lobby Dengar' : 'Lobby Dengar';
    if (!t) { el.tCur.textContent = '0:00'; el.tDur.textContent = '0:00'; el.seek.value = 0; }
  }

  let flashText = '', flashUntil = 0;
  function flashDisplay(t) {
    flashText = t; flashUntil = performance.now() + 1200;
    renderDisplay();
    setTimeout(renderDisplay, 1250);
  }
  function renderDisplay() {
    let t;
    if (performance.now() < flashUntil) t = flashText;
    else if (shared.loadingSid) t = 'LOADING';
    else if (!state.tracks.length) t = 'TAP DISC';
    else t = (audio.paused ? 'PAUSE ' : 'PLAY ') + fmt(audio.currentTime);
    el.disp.textContent = t;
  }

  function armAngle() {
    if (audio.paused || !state.tracks.length) return REST_ANGLE;
    const d = audio.duration || 0;
    const p = d ? Math.min(1, audio.currentTime / d) : 0;
    return 12 + 19 * p;          // alur luar -> alur dalam
  }
  function placeArm() { el.arm.style.transform = 'rotate(' + armAngle().toFixed(2) + 'deg)'; }

  /* ---------- audio events ---------- */
  let seeking = false;
  audio.addEventListener('play', () => {
    ensureAnalyser();
    if (actx && actx.state === 'suspended') actx.resume();
    document.body.classList.add('is-playing');
    placeArm(); renderDisplay(); renderSeats(); announce();
  });
  audio.addEventListener('pause', () => {
    document.body.classList.remove('is-playing');
    placeArm(); renderDisplay(); renderSeats(); announce();
  });
  audio.addEventListener('ended', () => next(true));
  audio.addEventListener('timeupdate', () => {
    const d = audio.duration || 0;
    if (!seeking) el.seek.value = d ? Math.round((audio.currentTime / d) * 1000) : 0;
    el.tCur.textContent = fmt(audio.currentTime);
    placeArm(); renderDisplay();
  });
  const onDuration = () => {
    el.tDur.textContent = fmt(audio.duration);
    const t = state.tracks[state.index];
    if (t && isFinite(audio.duration) && t.dur !== audio.duration) { t.dur = audio.duration; renderQueue(); }
  };
  audio.addEventListener('loadedmetadata', onDuration);
  audio.addEventListener('durationchange', onDuration);
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src')) return;
    toast('File ini tidak bisa diputar di browser');
  });

  el.seek.addEventListener('pointerdown', () => { seeking = true; });
  ['pointerup', 'pointercancel', 'change'].forEach((ev) => el.seek.addEventListener(ev, () => { seeking = false; }));
  el.seek.addEventListener('change', () => { if (fb && shared.pb) pbWrite({ pos: audio.currentTime }); });
  el.seek.addEventListener('input', () => {
    const d = audio.duration;
    if (!d) return;
    audio.currentTime = (el.seek.value / 1000) * d;
    el.tCur.textContent = fmt(audio.currentTime);
  });

  /* ---------- tombol ---------- */
  $('#btnPlay').addEventListener('click', toggle);
  $('#btnPlay2').addEventListener('click', toggle);
  $('#btnPrev').addEventListener('click', prev);
  $('#btnNext').addEventListener('click', () => next(false));
  el.platter.addEventListener('click', () => el.file.click());
  el.platter.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopPropagation(); el.file.click(); }
  });
  el.dispBtn.addEventListener('click', () => { if (!state.tracks.length) el.file.click(); });
  el.file.addEventListener('change', () => { addFiles(el.file.files); el.file.value = ''; });

  el.shuffle.addEventListener('click', () => {
    if (fb) { if (shared.pb) { pbWrite({ shuffle: !shared.pb.shuffle }); flashDisplay(!shared.pb.shuffle ? 'SHUFFLE ON' : 'SHUFFLE OFF'); } return; }
    state.shuffle = !state.shuffle;
    el.shuffle.classList.toggle('active', state.shuffle);
    flashDisplay(state.shuffle ? 'SHUFFLE ON' : 'SHUFFLE OFF');
  });
  el.loop.addEventListener('click', () => {
    if (fb) {
      if (!shared.pb) return;
      const m = shared.pb.loop === 'all' ? 'one' : shared.pb.loop === 'one' ? 'off' : 'all';
      pbWrite({ loop: m }); flashDisplay('LOOP ' + m.toUpperCase()); return;
    }
    state.loop = state.loop === 'all' ? 'one' : state.loop === 'one' ? 'off' : 'all';
    el.loop.dataset.mode = state.loop;
    flashDisplay('LOOP ' + state.loop.toUpperCase());
  });

  /* ---------- knob volume ---------- */
  // 0-100% lewat volume bawaan elemen audio, 100-200% lewat gain Web Audio
  function applyGain() { if (gainNode) gainNode.gain.value = Math.max(1, state.vol); }
  function setVol(v, flash) {
    state.vol = Math.round(Math.min(2, Math.max(0, v)) * 100) / 100;
    audio.volume = Math.min(1, state.vol);
    applyGain();
    el.dial.style.transform = 'rotate(' + (-135 + 270 * (state.vol / 2)).toFixed(1) + 'deg)';
    el.knob.classList.toggle('boost', state.vol > 1);
    el.knob.setAttribute('aria-valuenow', Math.round(state.vol * 100));
    store.set('lobby.vol', String(state.vol));
    if (flash) flashDisplay('VOL ' + Math.round(state.vol * 100));
  }
  let drag = null;
  el.knob.addEventListener('pointerdown', (e) => {
    drag = { y: e.clientY, v: state.vol };
    el.knob.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  el.knob.addEventListener('pointermove', (e) => {
    if (!drag) return;
    let v = drag.v + (drag.y - e.clientY) / 75;
    if (Math.abs(v - 1) < 0.035) v = 1;            // tahanan kecil di 100% supaya gampang berhenti di situ
    setVol(v, true);
  });
  ['pointerup', 'pointercancel'].forEach((ev) => el.knob.addEventListener(ev, () => { drag = null; }));
  el.knob.addEventListener('wheel', (e) => { e.preventDefault(); setVol(state.vol - Math.sign(e.deltaY) * 0.05, true); }, { passive: false });
  el.knob.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); setVol(state.vol + 0.05, true); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); setVol(state.vol - 0.05, true); }
  });

  /* ---------- keyboard ---------- */
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target === el.knob) return;
    if ((e.key === 'Enter' || e.key === '/') && tag !== 'button' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); openChat(); return; }
    if (e.code === 'Space' && tag !== 'button') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight' && tag !== 'button') seekTo(Math.min((audio.duration || 0), audio.currentTime + 5));
    else if (e.key === 'ArrowLeft' && tag !== 'button') seekTo(Math.max(0, audio.currentTime - 5));
  });

  /* ---------- drag & drop ---------- */
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0;
    document.body.classList.remove('dragging');
    addFiles(e.dataTransfer.files);
  });

  /* ---------- parallax: turntable miring, kursi dan cincin bergeser ---------- */
  let pxT = 0, pyT = 0, pxQ = NaN, pyQ = NaN, pxRaf = 0;
  function applyParallax() {
    pxRaf = 0;
    const px = Math.round(pxT * 100) / 100, py = Math.round(pyT * 100) / 100;     // dibulatkan: gerakan mouse kecil tidak memicu render ulang
    if (px === pxQ && py === pyQ) return;
    pxQ = px; pyQ = py;
    const sh = 'translate(' + (px * -12).toFixed(2) + 'px,' + (py * -7).toFixed(2) + 'px)';
    el.seats.style.transform = sh; el.spot.style.transform = sh;
    if (el.tt) el.tt.style.transform = 'rotateX(' + (py * -4).toFixed(2) + 'deg) rotateY(' + (px * 5).toFixed(2) + 'deg)';
  }
  const askParallax = () => { if (!pxRaf) pxRaf = requestAnimationFrame(applyParallax); };
  el.stage.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const r = el.stage.getBoundingClientRect();
    pxT = (e.clientX - r.left) / r.width - 0.5;
    pyT = (e.clientY - r.top) / r.height - 0.5;
    askParallax();
  }, { passive: true });
  el.stage.addEventListener('pointerleave', () => { pxT = 0; pyT = 0; askParallax(); });

  /* ---------- user menekan layar: avatarnya melompat dan mengeluarkan gelombang ---------- */
  function seatRipple(fx, ph, o, delay) {
    const r = document.createElement('i');
    r.className = 's-ripple';
    r.style.setProperty('--ph', ph);
    r.style.setProperty('--o', o);
    if (delay) r.style.animationDelay = delay + 's';
    r.addEventListener('animationend', () => r.remove());
    fx.append(r);
  }
  function seatNote(fx, ph) {
    const p = document.createElement('span');
    p.className = 's-note';
    const a = Math.random() * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const r1 = 2 + Math.random() * 0.7;                       // satuan: lebar kursi
    p.style.setProperty('--ph', ph);
    p.style.setProperty('--x0', (c * 0.7).toFixed(2));
    p.style.setProperty('--y0', (s * 0.7).toFixed(2));
    p.style.setProperty('--x1', (c * r1).toFixed(2));
    p.style.setProperty('--y1', (s * r1 - 0.4).toFixed(2));
    p.style.setProperty('--rot', ((Math.random() - 0.5) * 50).toFixed(0) + 'deg');
    p.style.setProperty('--dur', (1.4 + Math.random() * 0.9).toFixed(2) + 's');
    p.style.setProperty('--sz', (8 + Math.random() * 5).toFixed(0) + 'px');
    p.textContent = GLYPHS[(Math.random() * GLYPHS.length) | 0];
    p.addEventListener('animationend', () => p.remove());
    fx.append(p);
  }
  function burst(k) {
    const s = seatEls[k];
    if (!s || !s.id || rm()) return;
    const t = performance.now();
    if (t - s.last < 60 || s.fx.childElementCount > 64) return;
    s.last = t;
    const ph = s.av.style.getPropertyValue('--h') || '335';        // efek memakai warna lingkaran kursi ini
    const g = document.createElement('i');
    g.className = 's-glow';
    g.style.setProperty('--ph', ph);
    g.addEventListener('animationend', () => g.remove());
    s.fx.append(g);
    seatRipple(s.fx, ph, '.6', 0);
    const n = 2 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) seatNote(s.fx, ph);
    if (s.av.animate) {
      if (s.jump) s.jump.cancel();
      s.jump = s.av.animate([
        { transform: 'translateY(0) scale(1, 1)' },
        { transform: 'translateY(1px) scale(1.14, .86)', offset: 0.08 },
        { transform: 'translateY(-16px) scale(.93, 1.09)', offset: 0.45 },
        { transform: 'translateY(0) scale(1.08, .92)', offset: 0.8 },
        { transform: 'translateY(0) scale(1, 1)' }
      ], { duration: 380, easing: 'ease-out' });
    }
  }
  // tekan = langsung keluar satu gelombang; ditahan = gelombang terus keluar
  let holdTimer = null;
  const tapEmit = () => {
    burst(0);                                                  // kursimu selalu yang pertama
    if (fb) { if (window.fbTap) window.fbTap(); } else { try { if (bc) bc.postMessage({ type: 'tap', id: me.id }); } catch (err) { /* abaikan */ } }
  };
  const stopHold = () => { clearInterval(holdTimer); holdTimer = null; };
  el.stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.knob, input[type="range"]')) return;   // geser volume / posisi lagu tidak memicu gelombang
    tapEmit();
    clearInterval(holdTimer);
    holdTimer = setInterval(tapEmit, 380);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => el.stage.addEventListener(ev, stopHold));
  window.addEventListener('blur', stopHold);

  /* ---------- jam besar: waktu asli saat diam, ngebut kayak time traveler saat lagu diputar ---------- */
  const hHour = $('#hHour'), hMin = $('#hMin'), hSec = $('#hSec');
  // pos tampilan = waktu asli + extra (jarak yang sudah "ditempuh" ke depan, tidak dibungkus) + tick (loncat kecil saat menit ganti)
  const CLK = { extra: 0, vel: 0, acc: 0, hold: 0, tick: 0, last: -1, drawn: -1, real: 0, gdrawn: NaN };   // satuan: menit; vel = menit per detik
  const GEAR_PER_SEC = 0.5;                            // derajat putaran gir per derajat jarum detik (waktu asli): ~3 derajat tiap detik
  const GEAR_T0 = Date.now();                          // titik nol putaran gir
  const GEAR_PER_HAND = 0.04;                         // derajat putaran gir per derajat jarum menit (dikali rasio tiap gir)
  const WARP = 220;                                     // maju saat lagu diputar: jarum menit ~4 putaran per detik
  const REW_MIN_CAP = 900;                              // kecepatan mundur maksimum minimum (menit/detik = 15 putaran jarum per detik)
  const REW_SEC_BASE = 0.9, REW_SEC_PER_MIN = 1 / 2000, REW_SEC_MAX = 3;   // lama mundur: makin banyak putaran maju makin lama, tapi dibatasi
  const HOLD_SEC = 0.15;                                // jeda singkat setelah lagu selesai, sebelum jam diputar mundur
  const LAST_LAP = 60;                                  // putaran terakhir = satu putaran jarum menit (60 menit)
  const OVERSHOOT = 5;                                  // jarum sengaja kebablasan mundur segini (menit = 30 derajat) sebelum balik ke waktu asli
  const SETTLE_SEC = 0.28;                              // lama jarum balik pelan dari kebablasan ke waktu asli
  // jarum menit & jam hanya pindah tiap pergantian menit (tepat di garis dial); jarum detik pindah tiap detik, juga tepat di garis
  const realMin = () => { const d = new Date(); return (d.getHours() * 60 + d.getMinutes()) % 720; };
  const SEC = { x: 0, x0: 0, v: 0, count: 0, last: -1, drawn: '' };            // x = sudut jarum detik (derajat, tidak dibungkus), pegas mengejar tiap garis detik
  const SEC_RATIO = 2;                                                  // saat time travel jarum detik berputar 2x lebih cepat dari jarum menit
  function drawClock(pos) {
    if (pos === CLK.drawn) return;
    CLK.drawn = pos;
    hMin.style.transform = 'rotate(' + (pos * 6).toFixed(2) + 'deg)';
    hHour.style.transform = 'rotate(' + (pos * 0.5).toFixed(3) + 'deg)';
  }
  const clockRewind = () => { CLK.resetting = true; };                  // dipanggil saat lagu habis / ganti lagu
  // kecepatan jarum mengejar target lewat filter kritis-teredam (tanpa overshoot): kecepatan DAN percepatan berubah mulus
  function trackVel(want, w, dt) {
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (let i = 0; i < n; i++) {
      CLK.acc += (w * w * (want - CLK.vel) - 2 * w * CLK.acc) * h;
      CLK.vel += CLK.acc * h;
    }
  }
  // jarum detik: tiap detik pindah tepat ke garis berikutnya (pegas sedikit kebablasan seperti jam kuarsa), lalu diam di garis
  function stepSeconds(dt) {
    const s = new Date().getSeconds();
    if (SEC.last < 0) { SEC.last = s; SEC.count = s; SEC.x = s * 6; SEC.x0 = SEC.x; }
    if (s !== SEC.last) { SEC.count += (s - SEC.last + 60) % 60; SEC.last = s; }
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n, w = 38, z = 0.55;
    for (let i = 0; i < n; i++) { SEC.v += (w * w * (SEC.count * 6 - SEC.x) - 2 * z * w * SEC.v) * h; SEC.x += SEC.v * h; }
    const ang = (SEC.x + CLK.extra * 6 * SEC_RATIO) % 360, str = 'rotate(' + ang.toFixed(2) + 'deg)';
    if (str !== SEC.drawn) { SEC.drawn = str; hSec.style.transform = str; }
  }
  function stepClock(dt, warp) {
    const rmin = realMin();
    if (CLK.last < 0) CLK.last = rmin;
    if (rmin !== CLK.last) {                                             // menit ganti: jarum loncat ke garis berikutnya dengan gerak halus
      const d = ((((rmin - CLK.last + 360) % 720) + 720) % 720) - 360;
      CLK.last = rmin; CLK.real += d;                                    // waktu asli tanpa pembungkus 12 jam, supaya gir tidak loncat
      CLK.tick = Math.abs(d) <= 5 ? CLK.tick - d : 0;
    }
    CLK.tick += (0 - CLK.tick) * Math.min(1, dt * 14);
    if (Math.abs(CLK.tick) < 0.001) CLK.tick = 0;
    if (CLK.resetting) {                                                 // lagu habis / ganti lagu: mundur dulu ke awal, baru ngebut lagi
      if (CLK.extra === 0 && CLK.vel === 0 && !CLK.fin) CLK.resetting = false;
      else warp = false;
    }
    let integrate = true;
    if (warp) {
      CLK.fin = null; CLK.hold = 0; CLK.rewCap = 0;
      trackVel(WARP, 5, dt);                                             // ngebut: kecepatan naik mulus (tanpa hentakan awal)
    } else if (CLK.extra !== 0 || CLK.vel !== 0 || CLK.fin) {
      // lagu berhenti: jarum diputar mundur PERSIS sejauh yang sudah ditempuh maju (extra), lalu mendarat di waktu asli
      const remain = CLK.extra + OVERSHOOT;                              // jarak sampai titik kebablasan
      if (!CLK.fin && CLK.extra > LAST_LAP && CLK.hold < HOLD_SEC) {
        CLK.hold += dt;                                                  // jeda: jarum melambat sampai diam, tahan sebentar
        trackVel(0, 16, dt);
      } else if (!CLK.fin && CLK.extra > LAST_LAP && remain > 0.3 * Math.abs(Math.min(0, CLK.vel)) + 1) {
        if (!CLK.rewCap) {                                               // kecepatan maksimum ditentukan sekali di awal mundur, dari jarak yang harus ditempuh
          const D = Math.min(REW_SEC_MAX, REW_SEC_BASE + CLK.extra * REW_SEC_PER_MIN);
          CLK.rewCap = Math.max(REW_MIN_CAP, 1.3 * CLK.extra / D);
        }
        trackVel(-CLK.rewCap, 14, dt);                                   // tancap mundur mulus sampai kecepatan maksimum
      } else {
        // pengereman terencana: mulai saat sisa jarak = 0,3 x kecepatan, jadi rem sudah jalan dari jauh (bukan mendadak di ujung).
        // Kurva quintic Hermite: posisi, kecepatan DAN percepatan menyambung di semua titik, berhenti di titik kebablasan,
        // lalu balik pelan ke waktu asli. Putaran terakhir (60 menit) terjadi di ekor rem ini, sekitar 0,3 detik.
        if (!CLK.fin) {
          const v0 = CLK.vel, T = Math.max(0.3, Math.min(0.9, 2 * remain / Math.max(Math.abs(v0), 150)));
          CLK.fin = { x0: CLK.extra, v0, a0: CLK.acc, T, t: 0 };
        }
        const f = CLK.fin, prev = CLK.extra; f.t += dt;
        if (f.t < f.T) {
          const p = f.t / f.T, p2 = p * p, p3 = p2 * p, p4 = p3 * p, p5 = p4 * p, T = f.T;
          CLK.extra = f.x0 * (1 - 10 * p3 + 15 * p4 - 6 * p5)
            + T * f.v0 * (p - 6 * p3 + 8 * p4 - 3 * p5)
            + T * T * f.a0 * (0.5 * p2 - 1.5 * p3 + 1.5 * p4 - 0.5 * p5)
            - OVERSHOOT * (10 * p3 - 15 * p4 + 6 * p5);
        } else {
          const p = Math.min(1, (f.t - f.T) / SETTLE_SEC), q = p * p * p * (10 - 15 * p + 6 * p * p);
          CLK.extra = -OVERSHOOT * (1 - q);
        }
        CLK.vel = dt > 0 ? (CLK.extra - prev) / dt : 0; CLK.acc = 0; integrate = false;
        if (f.t >= f.T + SETTLE_SEC) { CLK.extra = 0; CLK.vel = 0; CLK.fin = null; CLK.hold = 0; CLK.rewCap = 0; }
      }
    }
    if (integrate && CLK.vel) CLK.extra += CLK.vel * dt;
    drawClock((((rmin + CLK.extra + CLK.tick) % 720) + 720) % 720);
    stepSeconds(dt);
    // gir digerakkan langsung oleh jarum menit (seperti jam mekanik): maju, ngebut, mundur, dan loncat per menit ikut sama persis
    // + gir juga ikut jarum detik (waktu asli): tiap detik jarum loncat, gir ikut maju dengan pegas yang sama
    // putaran dasar = waktu asli yang MENGALIR HALUS (bukan pegas jarum detik yang loncat-loncat), jadi kecepatan konstan;
    // saat time travel, gir ikut jarum menit (extra) secara mulus
    const gang = CLK.extra * 6 * GEAR_PER_HAND + ((Date.now() - GEAR_T0) / 1000) * 6 * GEAR_PER_SEC;
    if (gang !== CLK.gdrawn) { CLK.gdrawn = gang; placeGears(gang); }
  }

  /* ---------- Media Session (kontrol di lock screen) ---------- */
  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const t = state.tracks[state.index];
    if (!t) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.name, artist: 'Lobby Dengar' });
      navigator.mediaSession.setActionHandler('play', toggle);
      navigator.mediaSession.setActionHandler('pause', toggle);
      navigator.mediaSession.setActionHandler('previoustrack', prev);
      navigator.mediaSession.setActionHandler('nexttrack', () => next(false));
    } catch (e) { /* abaikan */ }
  }

  /* ---------- analyser audio ---------- */
  let actx = null, analyser = null, freq = null, gainNode = null, limiter = null;
  function ensureAnalyser() {
    if (analyser) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = new AC();
      const src = actx.createMediaElementSource(audio);
      analyser = actx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.minDecibels = -88;
      analyser.maxDecibels = -22;
      analyser.smoothingTimeConstant = 0.2;      // smoothing browser dibuat tipis supaya cepat bereaksi
      gainNode = actx.createGain();
      limiter = actx.createDynamicsCompressor();       // pembatas supaya boost 200% tidak pecah
      limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
      limiter.attack.value = 0.002; limiter.release.value = 0.15;
      src.connect(analyser);
      analyser.connect(gainNode);
      gainNode.connect(limiter);
      limiter.connect(actx.destination);
      applyGain();
      freq = new Uint8Array(analyser.frequencyBinCount);
      buildBands();
    } catch (e) { analyser = null; }
  }

  /* ---------- analisis frekuensi (untuk denyut piringan & kursi) log, gravitasi jatuh, puncak melayang ---------- */
  const BANDS = 48;
  const bars = new Float32Array(BANDS), vel = new Float32Array(BANDS), caps = new Float32Array(BANDS);
  const sm = new Float32Array(BANDS), raw = new Float32Array(BANDS), eqw = new Float32Array(BANDS);
  for (let i = 0; i < BANDS; i++) eqw[i] = 0.8 + 0.95 * Math.pow(i / (BANDS - 1), 1.1);   // treble biasanya lebih lemah
  let bLo = null, bHi = null, bPos = null, peak = 0.6;

  function buildBands() {
    const sr = actx.sampleRate, binW = sr / analyser.fftSize;
    const fMin = 45, fMax = Math.min(14000, (sr / 2) * 0.95);
    bLo = new Int32Array(BANDS); bHi = new Int32Array(BANDS); bPos = new Float32Array(BANDS);
    for (let i = 0; i < BANDS; i++) {
      const f0 = fMin * Math.pow(fMax / fMin, i / BANDS), f1 = fMin * Math.pow(fMax / fMin, (i + 1) / BANDS);
      bLo[i] = Math.max(1, Math.floor(f0 / binW));
      bHi[i] = Math.max(bLo[i], Math.ceil(f1 / binW) - 1);
      bPos[i] = Math.sqrt(f0 * f1) / binW;
    }
  }

  function computeBars(dt, now, playing) {
    if (playing) {
      if (analyser && bLo) {
        analyser.getByteFrequencyData(freq);
        for (let i = 0; i < BANDS; i++) {
          let v;
          if (bHi[i] - bLo[i] >= 2) { v = 0; for (let b = bLo[i]; b <= bHi[i]; b++) if (freq[b] > v) v = freq[b]; }
          else { const p = bPos[i], k = Math.floor(p), f = p - k; v = freq[k] * (1 - f) + freq[k + 1] * f; }
          raw[i] = (v / 255) * eqw[i];
        }
      } else {
        // cadangan kalau browser tidak bisa membuka analyser: gerak simulasi
        const beat = Math.pow(Math.max(0, Math.sin(now / 260)), 3);
        for (let i = 0; i < BANDS; i++) {
          raw[i] = (0.62 - 0.35 * (i / BANDS)) * (0.45 + 0.55 * Math.abs(Math.sin(now / (210 + i * 23) + i * 1.7))) * (0.65 + 0.35 * beat);
        }
      }
      // sensitivitas otomatis: lagu pelan tetap hidup, lagu keras tidak mentok
      let mx = 0;
      for (let i = 0; i < BANDS; i++) if (raw[i] > mx) mx = raw[i];
      peak = Math.max(mx, peak * Math.exp(-dt * 0.6));          // gain menyesuaikan lebih cepat
      const sc = 1 / Math.max(0.45, peak);
      for (let i = 0; i < BANDS; i++) {
        const x = Math.min(1, Math.max(0, (raw[i] * sc - 0.08) / 0.92));
        raw[i] = Math.pow(x, 1.6);                              // kontras: bagian pelan turun, ketukan menonjol
      }
    } else {
      raw.fill(0);
    }
    const atk = 1 - Math.exp(-dt * 120);                         // naik hampir instan
    for (let i = 0; i < BANDS; i++) {
      if (raw[i] >= bars[i]) { bars[i] += (raw[i] - bars[i]) * atk; vel[i] = 0; }
      else { vel[i] += 6.5 * dt; bars[i] = Math.max(raw[i], bars[i] - vel[i] * dt); }   // jatuh lebih cepat
      caps[i] = Math.max(bars[i], caps[i] - 0.6 * dt);
    }
    for (let i = 0; i < BANDS; i++) {
      sm[i] = 0.12 * bars[Math.max(0, i - 1)] + 0.76 * bars[i] + 0.12 * bars[Math.min(BANDS - 1, i + 1)];
    }
  }

  /* ---------- animasi: piringan berputar ---------- */
  let rot = 0, speed = 0, last = performance.now(), lv = 0, lastLv = -1, kick = 0, prevBass = 0;
  let fxRip = 0, fxNote = 0;
  let enS = 0, hiS = 0, lastEn = -1, lastHi = -1, lastRipple = 0, noteAcc = 0, clkAcc = 0;
  const GLYPHS = ['♪', '♫', '♪', '•'];

  // riak melebar dari balik alat setiap ketukan bass
  function spawnRipple(str) {
    if (fxRip >= 10) return;
    fxRip++;
    const r = document.createElement('i');
    r.className = 'ripple';
    r.style.setProperty('--ph', (322 + Math.random() * 26).toFixed(0));      // pink -> magenta
    r.style.setProperty('--o', (0.35 + 0.45 * Math.min(1, str)).toFixed(2));
    r.addEventListener('animationend', () => { fxRip--; r.remove(); });
    el.fx.append(r);
  }
  // not / titik kecil melayang keluar dari balik alat ke arah kursi
  function spawnNote() {
    if (fxNote >= 30) return;
    fxNote++;
    const p = document.createElement('span');
    p.className = 'note';
    p.style.setProperty('--ph', (322 + Math.random() * 26).toFixed(0));
    const a = Math.random() * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const r0 = 15, r1 = 36 + Math.random() * 10;
    p.style.setProperty('--x0', (c * r0).toFixed(1));
    p.style.setProperty('--y0', (s * r0).toFixed(1));
    p.style.setProperty('--x1', (c * r1).toFixed(1));
    p.style.setProperty('--y1', (s * r1 - 5).toFixed(1));      // sedikit naik
    p.style.setProperty('--rot', ((Math.random() - 0.5) * 50).toFixed(0) + 'deg');
    p.style.setProperty('--dur', (2.6 + Math.random() * 1.6).toFixed(2) + 's');
    p.style.setProperty('--sz', (10 + Math.random() * 8).toFixed(0) + 'px');
    p.textContent = GLYPHS[(Math.random() * GLYPHS.length) | 0];
    p.addEventListener('animationend', () => { fxNote--; p.remove(); });
    el.fx.append(p);
  }
  let glowOn = false;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const playing = !audio.paused && state.tracks.length > 0;
    if (playing !== glowOn) { glowOn = playing; document.body.classList.toggle('glow-on', playing); }   // glow: nyala saat lagu main, padam saat berhenti
    const target = playing ? 200 : 0;                       // ~33 rpm
    speed += (target - speed) * Math.min(1, dt * (playing ? 2.2 : 1.4));
    if (!playing && speed < 0.2) speed = 0;
    if (speed) {
      rot = (rot + speed * dt) % 360;
      el.record.style.transform = 'rotate(' + rot.toFixed(2) + 'deg)';
    }

    computeBars(dt, now, playing);
    let bass = 0;
    for (let i = 0; i < 10; i++) bass += sm[i];
    const bassN = bass / 10;
    kick = Math.max(kick * Math.exp(-dt * 9), Math.min(1, Math.max(0, bassN - prevBass) * 5));   // lonjakan bass = ketukan
    prevBass = bassN;
    lv += (Math.min(1, bassN * 1.1 + kick * 0.35) - lv) * Math.min(1, dt * 30);
    const lvQ = Math.round(lv * 40) / 40;                    // 40 langkah sudah mulus; mengurangi invalidasi style
    if (lvQ !== lastLv) {
      el.stage.style.setProperty('--level', lvQ.toFixed(3));
      lastLv = lvQ;
    }

    // ---- ruangan ikut hidup ----
    const calm = rm();
    let tot = 0, tre = 0;
    for (let i = 0; i < BANDS; i++) { tot += sm[i]; if (i >= 28) tre += sm[i]; }
    enS += (Math.min(1, (tot / BANDS) * 2.4) - enS) * Math.min(1, dt * 5);
    hiS += (Math.min(1, (tre / (BANDS - 28)) * 3) - hiS) * Math.min(1, dt * 8);
    if (!calm) {
      if (playing) {
        if (kick > 0.5 && now - lastRipple > 320) { lastRipple = now; spawnRipple(kick); }
        noteAcc += enS * dt * 7;
        while (noteAcc >= 1) { noteAcc -= 1; spawnNote(); }
      } else noteAcc = 0;
    }

    // jam raksasa = SVG besar yang digambar ulang penuh tiap update. Saat diam geraknya cuma ~3 derajat/detik, jadi cukup ~10 fps;
    // jarum detik tetap mulus karena update penuh dipakai tepat saat detik/menit berganti dan selama pegasnya belum tenang.
    clkAcc += dt;
    const clkBusy = playing || CLK.extra !== 0 || CLK.vel !== 0 || CLK.fin || CLK.resetting || CLK.tick !== 0
      || Math.abs(SEC.count * 6 - SEC.x) > 0.02 || Math.abs(SEC.v) > 0.05
      || new Date().getSeconds() !== SEC.last || realMin() !== CLK.last;
    const clkGap = clkBusy ? 0 : 1 / 10;
    if (clkAcc >= clkGap - 0.002) { stepClock(Math.min(0.1, clkAcc), playing && !calm); clkAcc = 0; }

    requestAnimationFrame(frame);
  }

  /* ---------- lobby: realtime lewat Firebase Realtime Database (fallback ke BroadcastChannel antar tab) ---------- */
  const SEATS = 8;
  // server utama lalu cadangan: kalau yang pertama tidak merespon (mis. bandwidth habis), otomatis pindah ke berikutnya
  const FIREBASE_CONFIGS = Array.isArray(window.FIREBASE_CONFIGS) ? window.FIREBASE_CONFIGS : [];   // diisi config.js (dibuat saat deploy dari repository secret)
  const PROBE_MS = 7000, DROP_MS = 20000;                   // batas tunggu server pertama kali / putus terlalu lama
  const FB_VER = '10.14.1';
  const ROOM = 'lobby/peers';
  const STALE_MS = 45000;                                   // peer tanpa heartbeat selama ini dianggap sudah pergi
  const me = {
    id: uid(),
    name: (store.get('lobby.name', '') || ('Pendengar ' + (10 + Math.floor(Math.random() * 90)))).slice(0, 24),
    hue: Math.floor(Math.random() * 360)
  };
  const peers = new Map();
  let bc = null;
  try { bc = new BroadcastChannel('lobby-dengar-v1'); } catch (e) { bc = null; }
  let fb = null;                                            // { update, meRef } setelah Firebase tersambung

  const presenceData = () => ({ name: me.name, hue: me.hue, playing: !audio.paused && state.tracks.length > 0, title: currentTitle().slice(0, 80) });
  let pushT = null;
  function pushPresence(now) {
    if (!fb) return;
    clearTimeout(pushT);
    const go = () => { fb.update(fb.meRef, Object.assign(presenceData(), { seen: fb.stamp() })).catch(() => {}); };
    if (now) go(); else pushT = setTimeout(go, 150);
  }

  function announce(type) {
    if (fb) { pushPresence(false); return; }
    if (!bc) return;
    try {
      bc.postMessage({ type: type || 'hb', id: me.id, name: me.name, hue: me.hue, playing: !audio.paused, title: currentTitle() });
    } catch (e) { /* abaikan */ }
  }

  if (bc) {
    bc.onmessage = (ev) => {
      if (fb) return;
      const m = ev.data;
      if (!m || m.id === me.id) return;
      if (m.type === 'chat') { chatFrom(m.id, m.text); return; }
      if (m.type === 'typing') { typingFrom(m.id, m.text); return; }
      if (m.type === 'tap') { const k = seatEls.findIndex((s) => s.id === String(m.id)); if (k > 0) burst(k); return; }
      if (m.type === 'bye') { peers.delete(m.id); renderSeats(); return; }
      const isNew = !peers.has(m.id);
      peers.set(m.id, {
        id: String(m.id), name: String(m.name || '?').slice(0, 24), hue: Number(m.hue) || 0,
        playing: !!m.playing, title: String(m.title || '').slice(0, 80), seen: Date.now()
      });
      if (m.type === 'hello' || isNew) announce();
      renderSeats();
    };
    window.addEventListener('pagehide', () => { try { if (bc) bc.postMessage({ type: 'bye', id: me.id }); } catch (e) { /* abaikan */ } });
  }
  let beatN = 0;
  setInterval(() => {
    if (fb) { if (++beatN % 8 === 0) pushPresence(true); return; }   // heartbeat Firebase tiap ~16 detik
    const now = Date.now();
    for (const [id, p] of peers) if (now - p.seen > 7000) peers.delete(id);
    announce();
    renderSeats();
  }, 2000);


  /* ---------- lagu bersama: file diubah jadi base64, disimpan di Firebase, diputar barengan ---------- */
  const MAX_BYTES = 4 * 1024 * 1024;        // batas ukuran file (base64 ~ +33%)
  const CHUNK = 262144;                     // karakter base64 per potongan (kelipatan 4)
  const MAX_SONGS = 10;                     // lagu terlama dihapus otomatis kalau lebih dari ini
  const shared = { pb: null, loadedSid: null, loadingSid: null, blobs: new Map(), pending: new Map() };
  let srvOff = 0, needTap = false, tapUnlockAt = 0;
  const srvNow = () => Date.now() + srvOff;

  // posisi lagu yang seharusnya sekarang (dihitung dari waktu server, jadi semua orang sama)
  function sharedPos() {
    const pb = shared.pb;
    if (!pb) return 0;
    return pb.playing ? (pb.pos || 0) + Math.max(0, (srvNow() - (pb.at || srvNow())) / 1000) : (pb.pos || 0);
  }
  const curPos = () => (shared.pb && shared.loadedSid === shared.pb.sid ? audio.currentTime : sharedPos());

  function pbWrite(patch) {
    if (!fb) return;
    const cur = shared.pb || {};
    const n = Object.assign({ sid: null, playing: false, pos: 0, loop: 'all', shuffle: false }, cur, patch, { n: (cur.n || 0) + 1, at: fb.stamp() });
    return fb.db.set(fb.db.ref(fb.rdb, 'lobby/playback'), n).catch(() => toast('Gagal menyinkronkan'));
  }
  function seekTo(t) {
    audio.currentTime = t;
    if (fb && shared.pb) pbWrite({ pos: t });
  }
  function sharedToggle() {
    if (performance.now() - tapUnlockAt < 400) return;          // ketukan pertama untuk membuka blokir autoplay, bukan jeda
    if (!state.tracks.length) { el.file.click(); return; }
    const pb = shared.pb;
    if (!pb || !pb.sid) { pbWrite({ sid: state.tracks[0].id, playing: true, pos: 0 }); return; }
    pbWrite({ playing: !pb.playing, pos: curPos() });
  }

  function chooseNext(dir, auto) {
    const pb = shared.pb, L = state.tracks;
    if (!pb || !L.length) return null;
    const i = L.findIndex((t) => t.id === pb.sid);
    if (auto && pb.loop === 'one') return { pos: 0, playing: true };
    let j;
    if (pb.shuffle && L.length > 1 && dir > 0) { do { j = Math.floor(Math.random() * L.length); } while (j === i); }
    else {
      j = i + dir;
      if (j >= L.length) { if (pb.loop === 'all' || !auto) j = 0; else return { sid: L[0].id, playing: false, pos: 0 }; }
      if (j < 0) j = L.length - 1;
    }
    return { sid: L[j].id, playing: true, pos: 0 };
  }
  function sharedMove(dir) { const p = chooseNext(dir, false); if (p) pbWrite(p); }
  function sharedNext(auto) {
    if (!auto) { sharedMove(1); return; }
    const pb = shared.pb;
    if (!pb || shared.loadedSid !== pb.sid) return;
    const patch = chooseNext(1, true);
    if (!patch) return;
    // lagu habis di semua perangkat hampir bersamaan: hanya satu yang berhasil memajukan (dijaga lewat counter n)
    fb.db.runTransaction(fb.db.ref(fb.rdb, 'lobby/playback'), (cur) => {
      if (!cur || cur.n !== pb.n) return;
      return Object.assign({}, cur, patch, { n: (cur.n || 0) + 1, at: srvNow() });
    }).catch(() => {});
  }

  /* ---- cache lagu di perangkat (IndexedDB): sekali unduh, selanjutnya gratis bandwidth ---- */
  const idbOpen = () => new Promise((res) => {
    try {
      const r = indexedDB.open('lobby-songs', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('s');
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    } catch (e) { res(null); }
  });
  const idbGet = (id) => idbOpen().then((d) => d && new Promise((res) => {
    try { const q = d.transaction('s').objectStore('s').get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (e) { res(null); }
  }));
  const idbPut = (id, blob) => idbOpen().then((d) => { try { d && d.transaction('s', 'readwrite').objectStore('s').put(blob, id); } catch (e) { /* abaikan */ } });
  const idbDel = (id) => idbOpen().then((d) => { try { d && d.transaction('s', 'readwrite').objectStore('s').delete(id); } catch (e) { /* abaikan */ } });

  /* ---- unduh + susun ulang lagu dari potongan base64 ---- */
  function getSongUrl(t) {
    if (shared.blobs.has(t.id)) return Promise.resolve(shared.blobs.get(t.id));
    if (shared.pending.has(t.id)) return shared.pending.get(t.id);
    const p = idbGet(t.id).then((cached) => {
      if (cached) { const url = URL.createObjectURL(cached); shared.blobs.set(t.id, url); return url; }
      return fetchSong(t);
    }).finally(() => shared.pending.delete(t.id));
    shared.pending.set(t.id, p);
    return p;
  }
  function fetchSong(t) {
    return fb.db.get(fb.db.ref(fb.rdb, 'lobby/chunks/' + t.id)).then(async (snap) => {
      const v = snap.val();
      if (!v) throw new Error('kosong');
      const arr = Array.isArray(v) ? v : Object.keys(v).sort((a, b) => a - b).map((k) => v[k]);
      const parts = [];
      for (const c of arr) {                                   // satu potongan (256 KB) per giliran, lalu beri napas ke UI (animasi tidak macet saat lagu masuk)
        const bin = atob(c), u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        parts.push(u);
        await new Promise((r) => setTimeout(r));
      }
      const blob = new Blob(parts, { type: t.type || 'audio/mpeg' });
      idbPut(t.id, blob);
      const url = URL.createObjectURL(blob);
      shared.blobs.set(t.id, url);
      return url;
    });
  }

  async function loadShared(t) {
    if (shared.loadedSid) clockRewind();
    if (shared.loadingSid === t.id) return;
    shared.loadingSid = t.id; renderDisplay();
    try {
      const url = await getSongUrl(t);
      if (shared.pb && shared.pb.sid === t.id) {
        audio.src = url; audio.load();
        shared.loadedSid = t.id;
        updateMediaSession();
      }
    } catch (e) { toast('Gagal memuat lagu dari lobby'); }
    shared.loadingSid = null; renderDisplay();
    applyPlayback();
  }

  // samakan pemutar lokal dengan keadaan bersama
  function applyPlayback() {
    if (!fb) return;
    const pb = shared.pb;
    state.index = pb ? state.tracks.findIndex((t) => t.id === pb.sid) : -1;
    if (pb) {
      state.shuffle = !!pb.shuffle; state.loop = pb.loop || 'all';
      el.shuffle.classList.toggle('active', state.shuffle);
      el.loop.dataset.mode = state.loop;
    }
    updateNow(1);
    const t = state.tracks[state.index];
    if (!pb || !t) { if (!state.tracks.length) { audio.pause(); audio.removeAttribute('src'); shared.loadedSid = null; } renderDisplay(); return; }
    if (shared.loadedSid !== t.id) { loadShared(t); return; }
    const target = sharedPos(), d = audio.duration;
    if (pb.playing) {
      if (isFinite(d) && target >= d - 0.3) {                    // lagu ini sudah habis di sisi lain
        if (target > d + 1) sharedNext(true);                    // keadaan basi (semua orang pernah pergi): maju
        return;
      }
      if (Math.abs(audio.currentTime - target) > 0.4) audio.currentTime = target;
      if (audio.paused) audio.play().catch(() => { needTap = true; toast('Ketuk layar untuk ikut mendengar'); });
    } else {
      if (!audio.paused) audio.pause();
      if (Math.abs(audio.currentTime - pb.pos) > 0.3) audio.currentTime = pb.pos;
    }
    renderDisplay();
  }
  document.addEventListener('pointerdown', () => {
    if (!fb || !needTap) return;
    needTap = false; tapUnlockAt = performance.now();
    applyPlayback();
  }, true);
  setInterval(() => {                                            // koreksi drift pelan-pelan
    if (!fb || !shared.pb || !shared.pb.playing || shared.loadedSid !== shared.pb.sid || audio.paused || seeking) return;
    const target = sharedPos();
    if (isFinite(audio.duration) && target < audio.duration - 0.3 && Math.abs(audio.currentTime - target) > 0.4) audio.currentTime = target;
  }, 1500);

  function startShared() {
    const { db, rdb } = fb;
    // hapus lagu lokal bawaan mode offline, semua diganti daftar lobby
    audio.pause(); audio.removeAttribute('src'); shared.loadedSid = null; state.tracks = []; state.index = -1;
    db.onValue(db.ref(rdb, 'lobby/songs'), (snap) => {
      const list = [];
      snap.forEach((c) => {
        const v = c.val();
        if (v && v.n) list.push({ id: c.key, name: String(v.name || 'Tanpa judul').slice(0, 80), dur: 0, url: null, type: v.type, by: String(v.by || ''), at: v.at || Date.now() });
      });
      list.sort((a, b) => a.at - b.at);
      const ids = new Set(list.map((x) => x.id));
      for (const [id, url] of shared.blobs) if (!ids.has(id)) { URL.revokeObjectURL(url); shared.blobs.delete(id); idbDel(id); }
      state.tracks = list;
      renderQueue();
      applyPlayback();
    });
    db.onValue(db.ref(rdb, 'lobby/playback'), (snap) => { shared.pb = snap.val(); applyPlayback(); });
  }

  /* ---- upload: file -> base64 -> potongan kecil -> Firebase ---- */
  const fileToB64 = (f) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); res(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });
  /* ---- kompres: dekode -> mono 44.1 kHz -> MP3 64 kbps (~0,5 MB per menit), lagu jadi jauh lebih kecil ---- */
  const KBPS = 64, MAX_SRC = 40 * 1024 * 1024;
  let lameP = null;
  const loadLame = () => lameP || (lameP = new Promise((res, rej) => {
    if (window.lamejs) return res();
    const s = document.createElement('script'); s.src = 'lame.min.js';
    s.onload = () => res(); s.onerror = () => { lameP = null; rej(new Error('lame')); };
    document.head.append(s);
  }));
  async function compressAudio(f, onProg) {
    await loadLame();
    const AC = window.AudioContext || window.webkitAudioContext, ctx = new AC();
    let buf;
    try { buf = await ctx.decodeAudioData(await f.arrayBuffer()); } finally { ctx.close && ctx.close(); }
    const rate = 44100, len = Math.max(1, Math.ceil(buf.duration * rate));
    const oc = new OfflineAudioContext(1, len, rate), src = oc.createBufferSource();   // 1 kanal: stereo otomatis dicampur ke mono
    src.buffer = buf; src.connect(oc.destination); src.start();
    const pcmF = (await oc.startRendering()).getChannelData(0);
    const pcm = new Int16Array(pcmF.length);
    for (let i = 0; i < pcmF.length; i++) { const v = Math.max(-1, Math.min(1, pcmF[i])); pcm[i] = v < 0 ? v * 32768 : v * 32767; }
    const enc = new lamejs.Mp3Encoder(1, rate, KBPS), out = [], B = 1152 * 20;
    let tY = performance.now();
    for (let i = 0; i < pcm.length; i += B) {
      const d = enc.encodeBuffer(pcm.subarray(i, i + B));
      if (d.length) out.push(d);
      if (performance.now() - tY > 10) { onProg && onProg(i / pcm.length); await new Promise((r) => setTimeout(r)); tY = performance.now(); }   // beri napas ke UI tiap ~10 ms
    }
    const e = enc.flush(); if (e.length) out.push(e);
    return new Blob(out, { type: 'audio/mpeg' });
  }

  let uploading = false;
  async function uploadShared(files) {
    if (uploading) { toast('Masih mengunggah, tunggu sebentar'); return; }
    uploading = true;
    const { db, rdb } = fb;
    try {
      for (const f of files) {
        if (f.size > MAX_SRC) { toast(f.name + ' terlalu besar (maks 40 MB)'); continue; }
        let up = f;
        try {
          up = await compressAudio(f, (p) => toast('Mengompres ' + Math.round(p * 100) + '%'));
          if (up.size >= f.size) up = f;                                   // sudah lebih kecil dari hasil kompres: pakai asli
        } catch (err) { console.warn('kompres gagal, pakai file asli', err); up = f; }
        if (up.size > MAX_BYTES) { toast(cleanName(f.name) + ' masih terlalu besar (maks 4 MB setelah kompres)'); continue; }
        toast('Mengunggah ' + cleanName(f.name) + ' (' + (up.size / 1048576).toFixed(1) + ' MB)…');
        const b64 = await fileToB64(up);
        const n = Math.ceil(b64.length / CHUNK), sid = uid();
        for (let i = 0; i < n; i += 4) {
          const upd = {};
          for (let k = i; k < Math.min(n, i + 4); k++) upd['lobby/chunks/' + sid + '/' + k] = b64.slice(k * CHUNK, (k + 1) * CHUNK);
          await db.update(db.ref(rdb), upd);
          toast('Mengunggah ' + Math.min(100, Math.round((Math.min(n, i + 4) / n) * 100)) + '%');
        }
        idbPut(sid, up);
        shared.blobs.set(sid, URL.createObjectURL(up));              // pengunggah tidak perlu mengunduh lagi
        await db.set(db.ref(rdb, 'lobby/songs/' + sid), { name: cleanName(f.name), type: up.type || 'audio/mpeg', size: up.size, n, by: me.name, at: db.serverTimestamp() });
        toast(cleanName(f.name) + ' dibagikan ke lobby');
        const pb = shared.pb;
        if (!pb || !pb.sid || !state.tracks.some((t) => t.id === pb.sid)) pbWrite({ sid, playing: true, pos: 0 });
        trimOld(sid);
      }
    } catch (e) {
      console.warn(e); toast('Gagal mengunggah lagu');
    }
    uploading = false;
  }
  function trimOld(keepSid) {
    const L = state.tracks;
    if (L.length <= MAX_SONGS) return;
    const cur = shared.pb && shared.pb.sid;
    for (const t of L.slice(0, L.length - MAX_SONGS)) {
      if (t.id === cur || t.id === keepSid) continue;
      fb.db.remove(fb.db.ref(fb.rdb, 'lobby/songs/' + t.id)).catch(() => {});
      fb.db.remove(fb.db.ref(fb.rdb, 'lobby/chunks/' + t.id)).catch(() => {});
    }
  }

  async function initFirebase() {
    let start = 0;
    try { start = Math.max(0, parseInt(sessionStorage.getItem('lobby.srv'), 10) || 0) % FIREBASE_CONFIGS.length; } catch (e) { /* abaikan */ }
    for (let k = 0; k < FIREBASE_CONFIGS.length; k++) {
      const idx = (start + k) % FIREBASE_CONFIGS.length;
      if (await initFirebaseWith(FIREBASE_CONFIGS[idx], idx)) {
        if (k > 0 || idx > 0) toast('Server utama bermasalah, memakai server cadangan');
        return;
      }
    }
    console.warn('Semua server Firebase tidak merespon, pakai mode antar-tab saja');
  }
  async function initFirebaseWith(cfg, idx) {
    let app = null, closeApp = null;
    try {
      const base = 'https://www.gstatic.com/firebasejs/' + FB_VER + '/';
      const [appMod, db] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-database.js')]);
      const { initializeApp } = appMod;
      app = initializeApp(cfg, 'srv' + idx);
      closeApp = () => { try { db.goOffline(db.getDatabase(app)); } catch (e) { /* abaikan */ } try { appMod.deleteApp(app); } catch (e) { /* abaikan */ } };
      const rdb = db.getDatabase(app);
      // tes server: baca nyata dengan batas waktu (server yang kena kuota biasanya tidak menjawab / menolak)
      try {
        await Promise.race([db.get(db.ref(rdb, 'lobby/playback')), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), PROBE_MS))]);
      } catch (e) { console.warn('Server ' + idx + ' tidak merespon', e); closeApp(); return false; }
      // sudah tersambung lalu terputus lama (mis. kuota habis di tengah jalan): pindah server dan muat ulang
      let dropT = null;
      db.onValue(db.ref(rdb, '.info/connected'), (s) => {
        clearTimeout(dropT);
        if (!s.val()) dropT = setTimeout(() => {
          try { sessionStorage.setItem('lobby.srv', String((idx + 1) % FIREBASE_CONFIGS.length)); } catch (e) { /* abaikan */ }
          location.reload();
        }, DROP_MS);
      });
      const meRef = db.ref(rdb, ROOM + '/' + me.id);
      const lastTap = new Map(), lastChat = new Map(), lastTyp = new Map();
      let offset = 0, first = true;

      // sambung / sambung ulang: daftarkan hapus-otomatis saat koneksi putus, lalu tulis kehadiran
      db.onValue(db.ref(rdb, '.info/serverTimeOffset'), (s) => { offset = Number(s.val()) || 0; srvOff = offset; });
      // kapasitas lobby: maks SEATS orang. Yang ke-9 dst. tidak boleh masuk (urutan ditentukan joinAt dari server)
      const fresh = (snap) => {
        const now = Date.now() + offset, L = [];
        snap.forEach((c) => { const v = c.val(); if (v && c.key !== me.id && !(v.seen && now - v.seen > STALE_MS)) L.push({ id: c.key, at: v.joinAt || 0 }); });
        return L;
      };
      async function admit() {
        if (fresh(await db.get(db.ref(rdb, ROOM))).length >= SEATS) return false;
        await db.set(meRef, Object.assign(presenceData(), { seen: db.serverTimestamp(), joinAt: db.serverTimestamp(), tap: 0 }));
        const mine = (await db.get(meRef)).val(), myAt = (mine && mine.joinAt) || Date.now() + offset;
        const before = fresh(await db.get(db.ref(rdb, ROOM))).filter((p) => p.at < myAt || (p.at === myAt && p.id < me.id));
        if (before.length >= SEATS) { try { await db.remove(meRef); } catch (e) { /* abaikan */ } return false; }   // kalah balapan
        return true;
      }
      let joining = false, retryT = null;
      function showFull() {
        let o = document.getElementById('fullVeil');
        if (!o) {
          o = document.createElement('div'); o.id = 'fullVeil';
          o.style.cssText = 'position:fixed;inset:0;z-index:100;display:grid;place-items:center;text-align:center;padding:24px;background:var(--veil);backdrop-filter:blur(8px);color:var(--ink);font-family:inherit';
          o.innerHTML = '<div><div style="font-size:22px;font-weight:700;margin-bottom:8px">Lobby penuh</div><div style="color:var(--mute);font-size:14px;line-height:1.5">Sudah ' + SEATS + ' orang di dalam.<br>Halaman ini akan masuk otomatis kalau ada yang keluar.</div></div>';
          document.body.append(o);
        }
        clearTimeout(retryT); retryT = setTimeout(tryJoin, 8000);
      }
      async function tryJoin() {
        if (joining) return; joining = true;
        let ok = false;
        try { await db.onDisconnect(meRef).remove(); } catch (e) { /* abaikan */ }
        try { ok = await admit(); } catch (e) { ok = false; }
        joining = false;
        if (!ok) { if (fb) { location.reload(); return; } showFull(); return; }     // sudah di dalam lalu terputus & penuh: muat ulang -> layar penuh
        clearTimeout(retryT);
        const o = document.getElementById('fullVeil'); if (o) o.remove();
        if (!fb) {
          fb = { update: db.update, meRef, stamp: db.serverTimestamp, db, rdb };
          if (bc) { try { bc.close(); } catch (e) { /* abaikan */ } bc = null; }
          peers.clear();
          toast('Tersambung — lobby realtime aktif');
          startShared();
        }
      }
      db.onValue(db.ref(rdb, '.info/serverTimeOffset'), (s) => { offset = Number(s.val()) || 0; srvOff = offset; });
      db.onValue(db.ref(rdb, '.info/connected'), (s) => { if (s.val()) tryJoin(); });

      db.onValue(db.ref(rdb, ROOM), (snap) => {
        const now = Date.now() + offset, seen = new Set(), said = [], typers = [];
        snap.forEach((c) => {
          const id = c.key, v = c.val();
          if (id === me.id || !v) return;
          if (v.seen && now - v.seen > STALE_MS) return;
          seen.add(id);
          const prevTap = lastTap.get(id);
          lastTap.set(id, v.tap || 0);
          const prevChat = lastChat.get(id);
          lastChat.set(id, v.chatAt || 0);
          const prevTyp = lastTyp.get(id) || 0, curTyp = typeof v.typing === 'number' ? v.typing : 0;
          if (curTyp !== prevTyp) { lastTyp.set(id, curTyp); typers.push([id, curTyp && now - curTyp < TYPE_MS ? '...' : '']); }   // nilai basi (mis. sisa sesi lama) diabaikan
          if (!first && v.chat && v.chatAt && v.chatAt !== prevChat && now - v.chatAt < 10000) said.push([id, v.chat]);   // pesan baru (bukan riwayat lama)
          if (!first && prevTap !== undefined && v.tap && v.tap !== prevTap) {
            const k = seatEls.findIndex((x) => x.id === id);
            if (k > 0) burst(k);
          }
          peers.set(id, {
            id, name: String(v.name || '?').slice(0, 24), hue: Number(v.hue) || 0,
            playing: !!v.playing, title: String(v.title || '').slice(0, 80), seen: Date.now()
          });
        });
        for (const id of [...peers.keys()]) if (!seen.has(id)) { peers.delete(id); lastTap.delete(id); lastChat.delete(id); lastTyp.delete(id); }
        first = false;
        renderSeats();                                          // kursi harus sudah terpasang dulu, baru gelembung bisa ditempel
        for (const [id, text] of typers) typingFrom(id, text);
        for (const [id, text] of said) chatFrom(id, text);
      });
      window.fbTap = () => { if (fb) db.update(meRef, { tap: Date.now() * 1000 + Math.floor(Math.random() * 1000) }).catch(() => {}); };
      return true;
    } catch (e) {
      console.warn('Firebase gagal dimuat', e);
      if (closeApp) closeApp();
      return false;
    }
  }

  /* ---------- chat gelembung ala Roblox: muncul di atas kepala, beberapa detik kemudian hilang ---------- */
  // pesan ikut dititipkan di data kehadiran (chat + chatAt), jadi tidak butuh jalur / aturan Firebase baru
  const CHAT_MAX = 80;
  let chatLastSend = 0;
  const chatBar = $('#chatbar'), chatIn = $('#chatIn');
  const BUBBLE_MAX = 3, BUBBLE_MS = 10000;                      // maks 3 gelembung per orang, tiap pesan hilang setelah 10 detik
  function dropBubble(s, b) {
    if (!b.isConnected || b.dataset.gone) return;
    b.dataset.gone = '1'; clearTimeout(b._t);
    b.classList.remove('show');
    setTimeout(() => { b.remove(); if (!s.stack.children.length) s.root.classList.remove('talk'); }, 320);
  }
  function clampStack(st) {                                    // geser tumpukan gelembung supaya tidak keluar dari layar
    st.style.setProperty('--sx', '0px');
    const r = st.getBoundingClientRect(), pad = 8, vw = document.documentElement.clientWidth;
    let dx = 0;
    if (r.left < pad) dx = pad - r.left; else if (r.right > vw - pad) dx = vw - pad - r.right;
    if (dx) st.style.setProperty('--sx', Math.round(dx) + 'px');
  }
  function showBubble(k, text) {
    const s = seatEls[k];
    if (!s || !s.id) return false;
    if (!s.stack) { s.stack = document.createElement('div'); s.stack.className = 'bubbles'; s.root.append(s.stack); }
    const live = [...s.stack.children].filter((x) => !x.dataset.gone);
    while (live.length >= BUBBLE_MAX) dropBubble(s, live.shift());    // yang terlama (paling atas) tergeser keluar
    const b = document.createElement('div');
    b.className = 'bubble';
    b.textContent = text;                                     // textContent: pesan orang lain tidak pernah dianggap HTML
    s.stack.append(b);                                        // pesan baru di bawah, yang lama naik ke atas
    void b.offsetWidth; b.classList.add('show');
    s.root.classList.add('talk');
    clampStack(s.stack);
    b._t = setTimeout(() => dropBubble(s, b), BUBBLE_MS);
    return true;
  }
  /* ---- 'sedang mengetik': gelembung "..." di atas kepala orangnya (tanpa isi ketikan) ---- */
  const TYPE_MAX = 40, TYPE_MS = 5000, TYPE_BEAT = 2500;      // tanda hilang 5 dtk setelah ketikan terakhir; selama mengetik dikirim ulang tiap 2,5 dtk
  function typingFrom(id, raw) {
    const k = seatEls.findIndex((x) => x.id === String(id));
    if (k < 1) return;                                          // kursimu sendiri tidak perlu: kamu sudah lihat kolom ketiknya
    const s = seatEls[k];
    const text = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, TYPE_MAX);
    let b = s.typ && s.typ.isConnected && !s.typ.dataset.gone ? s.typ : null;
    if (!text) { if (b) { clearTimeout(b._t); dropBubble(s, b); } s.typ = null; return; }
    if (!b) {
      if (!s.stack) { s.stack = document.createElement('div'); s.stack.className = 'bubbles'; s.root.append(s.stack); }
      b = document.createElement('div'); b.className = 'bubble typing';
      b.innerHTML = '<i></i><i></i><i></i>';                    // tiga titik beranimasi
      s.stack.append(b); s.typ = b;
      void b.offsetWidth; b.classList.add('show');
      s.root.classList.add('talk');
    }
    clampStack(s.stack);
    clearTimeout(b._t);
    b._t = setTimeout(() => typingFrom(id, ''), TYPE_MS);       // berhenti mengetik / koneksi putus: hilang sendiri
  }
  let typOn = false, typBeat = 0;
  function sendTyping(on) {                                    // isi ketikan TIDAK dikirim: orang lain cuma melihat "..."
    const t = Date.now();
    if (on) {
      if (typOn && t - typBeat < TYPE_BEAT) return;            // sudah dikabarkan, ulangi tiap 2,5 dtk selama masih mengetik
      typOn = true; typBeat = t;
      if (fb) fb.update(fb.meRef, { typing: t + srvOff }).catch(() => {});
      else if (bc) { try { bc.postMessage({ type: 'typing', id: me.id, text: '...' }); } catch (err) { /* abaikan */ } }
    } else {
      if (!typOn) return;
      typOn = false;
      if (fb) fb.update(fb.meRef, { typing: null }).catch(() => {});
      else if (bc) { try { bc.postMessage({ type: 'typing', id: me.id, text: '' }); } catch (err) { /* abaikan */ } }
    }
  }
  function stopTyping() { sendTyping(false); }
  function chatFrom(id, raw) {
    const text = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
    if (!text) return;
    typingFrom(id, '');
    const k = seatEls.findIndex((s) => s.id === String(id));
    if (k > 0 && showBubble(k, text)) return;
    const p = peers.get(String(id));                         // tidak kebagian kursi: tampilkan sebagai toast saja
    if (p) toast(p.name + ': ' + text);
  }
  function sendChat(raw) {
    const text = String(raw).replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
    const t = Date.now();
    if (!text || t - chatLastSend < 800) return false;       // jeda antar pesan supaya tidak spam
    chatLastSend = t;
    stopTyping();
    showBubble(0, text);
    if (fb) fb.update(fb.meRef, { chat: text, chatAt: Date.now() + srvOff }).catch(() => {});
    else if (bc) { try { bc.postMessage({ type: 'chat', id: me.id, text }); } catch (err) { /* abaikan */ } }
    return true;
  }
  function openChat() { chatBar.classList.add('open'); chatIn.focus(); }
  function closeChat() { stopTyping(); chatBar.classList.remove('open'); chatIn.blur(); }
  chatBar.addEventListener('submit', (e) => { e.preventDefault(); if (sendChat(chatIn.value)) chatIn.value = ''; closeChat(); });
  chatIn.addEventListener('input', () => sendTyping(!!chatIn.value.trim()));   // langsung muncul saat mulai mengetik, hilang saat kolom dikosongkan
  chatIn.addEventListener('keydown', (e) => { if (e.key === 'Escape') { chatIn.value = ''; closeChat(); } });
  chatIn.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== chatIn) { stopTyping(); chatBar.classList.remove('open'); } }, 120));
  $('#chatBtn').addEventListener('click', () => { if (chatBar.classList.contains('open')) closeChat(); else openChat(); });
  if (window.visualViewport) {                              // di HP kolom ketik naik di atas keyboard
    const vv = window.visualViewport;
    const fit = () => chatBar.style.setProperty('--kb', Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px');
    vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit);
  }

  function rename() {
    const n = window.prompt('Nama kamu di lobby:', me.name);
    if (n === null) return;
    me.name = n.trim().slice(0, 24) || me.name;
    store.set('lobby.name', me.name);
    announce(); pushPresence(true); renderSeats();
  }

  // tiap orang kebagian satu alat musik (dipilih dari hash id, jadi sama di semua perangkat): drum set, mic, tamborin, trumpet, ukulele, pianika, harmonika.
  // lingkaran warnanya ada di belakang alat; saat lagu diputar alatnya "dimainkan" lewat animasi CSS
  const INSTR = (() => {
    const K = 'stroke="var(--ink)" stroke-linejoin="round" stroke-linecap="round" stroke-width="3"', P = 'fill="var(--card)"';
    const wrap = (cls, inner) => '<svg viewBox="0 0 120 120" aria-hidden="true" class="' + cls + '">' + inner + '</svg>';
    // --- drum set ---
    const tom = (cls, cx, cy, rx, h) => '<g class="d ' + cls + '"><path d="M' + (cx - rx) + ' ' + cy + ' v' + h + ' a' + rx + ' ' + (rx * .32) + ' 0 0 0 ' + (rx * 2) + ' 0 v-' + h + '" ' + P + ' ' + K + '/>'
      + '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + (rx * .32) + '" ' + P + ' ' + K + '/>'
      + [-.55, 0, .55].map((f) => '<line x1="' + (cx + rx * f) + '" y1="' + (cy + rx * .3 + 1) + '" x2="' + (cx + rx * f) + '" y2="' + (cy + rx * .3 + 6) + '" ' + K + ' stroke-width="3"/>').join('') + '</g>';
    let lugs = '';
    for (let i = 0; i < 10; i++) lugs += '<rect x="58" y="49.5" width="4" height="6" rx="2" ' + P + ' ' + K + ' stroke-width="2" transform="rotate(' + (i * 36) + ' 60 84)"/>';
    const kit = wrap('i-kit',
      '<line x1="28" y1="21" x2="28" y2="70" ' + K + '/><line x1="95" y1="27" x2="95" y2="74" ' + K + '/>'
      + '<g class="d c c-l"><ellipse cx="25" cy="15" rx="21" ry="6.5" transform="rotate(-9 25 15)" ' + P + ' ' + K + '/><circle cx="28" cy="13" r="2.4" fill="var(--ink)"/></g>'
      + '<g class="d c c-r"><ellipse cx="96" cy="21" rx="19" ry="6" transform="rotate(7 96 21)" ' + P + ' ' + K + '/><circle cx="95" cy="20" r="2.4" fill="var(--ink)"/></g>'
      + '<line x1="14" y1="88" x2="10" y2="104" ' + K + '/><line x1="35" y1="88" x2="39" y2="104" ' + K + '/>'
      + '<line x1="100" y1="82" x2="90" y2="104" ' + K + '/><line x1="100" y1="82" x2="110" y2="104" ' + K + '/><line x1="100" y1="82" x2="100" y2="106" ' + K + '/>'
      + tom('t-l', 45, 36, 14, 15) + tom('t-r', 77, 36, 14, 15) + tom('t-f', 24, 64, 17, 22) + tom('t-s', 100, 66, 16, 11)
      + '<line x1="40" y1="108" x2="31" y2="118" ' + K + '/><line x1="80" y1="108" x2="89" y2="118" ' + K + '/>'
      + '<g class="d t-k"><circle cx="60" cy="84" r="32" ' + P + ' ' + K + ' stroke-width="3.4"/>' + lugs + '<circle cx="60" cy="84" r="25" fill="none" ' + K + ' stroke-width="1.8"/></g>');
    // --- mic (digambar tegak lalu dimiringkan 40 derajat) ---
    let grid = '';
    for (const f of [-12, 0, 12]) { const h = Math.sqrt(22 * 22 - f * f) - 1; grid += '<line x1="' + (60 + f) + '" y1="' + (30 - h) + '" x2="' + (60 + f) + '" y2="' + (30 + h) + '" ' + K + ' stroke-width="2.2"/><line x1="' + (60 - h) + '" y1="' + (30 + f) + '" x2="' + (60 + h) + '" y2="' + (30 + f) + '" ' + K + ' stroke-width="2.2"/>'; }
    const mic = wrap('i-mic',
      '<g class="mic-g" transform="rotate(40 60 60)"><g class="mic-in">'
      + '<path d="M47 52 L73 52 L68 100 Q60 107 52 100 Z" ' + P + ' ' + K + '/><rect x="55" y="104" width="10" height="11" rx="3" ' + P + ' ' + K + '/>'
      + '<circle cx="60" cy="30" r="22" ' + P + ' ' + K + '/>' + grid + '<circle cx="60" cy="30" r="22" fill="none" ' + K + ' stroke-width="3.6"/>'
      + '<rect x="44" y="49" width="32" height="9" rx="1.5" ' + P + ' ' + K + '/></g></g>');
    // --- tamborin ---
    const jing = (cx, cy, rx, ry, rot) => '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" transform="rotate(' + rot + ' ' + cx + ' ' + cy + ')" ' + P + ' ' + K + '/>';
    const tamb = wrap('i-tamb',
      '<g class="tamb-g">'
      + '<g class="jg">' + jing(11, 52, 8, 11, -20) + jing(109, 52, 8, 11, 20) + '</g>'
      + '<path d="M10 62 Q12 96 60 100 Q108 96 110 62 L110 50 L10 50 Z" ' + P + ' ' + K + '/>'
      + '<g class="jg">' + jing(34, 90, 10, 8, -15) + jing(60, 97, 11, 8, 0) + jing(86, 90, 10, 8, 15) + '</g>'
      + '<ellipse cx="60" cy="46" rx="49" ry="31" ' + P + ' ' + K + '/>' + '<ellipse cx="60" cy="46" rx="39" ry="23" fill="none" ' + K + ' stroke-width="1.8"/>'
      + [[24, 62], [44, 72], [60, 74], [76, 72], [96, 62]].map((q) => '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="2.4" ' + P + ' ' + K + ' stroke-width="2"/>').join('') + '</g>');
    // --- trumpet (digambar mendatar, lonceng di kanan, lalu dimiringkan) ---
    const valve = (x, i) => '<g class="vl vl' + i + '"><rect x="' + x + '" y="36" width="7" height="24" rx="1.5" ' + P + ' ' + K + ' stroke-width="2.6"/><line x1="' + (x - 2.5) + '" y1="34" x2="' + (x + 9.5) + '" y2="34" ' + K + '/></g>';
    const trumpet = wrap('i-trump',
      '<g class="tr-g" transform="rotate(-40 60 60)"><g class="tr-in">'
      + '<rect x="3" y="55" width="9" height="10" rx="3" ' + P + ' ' + K + '/><line x1="12" y1="60" x2="36" y2="60" ' + K + '/>'
      + '<rect x="34" y="50" width="58" height="26" rx="13" ' + P + ' ' + K + '/><rect x="42" y="57" width="42" height="12" rx="6" fill="none" ' + K + ' stroke-width="2.4"/>'
      + valve(42, 1) + valve(54, 2) + valve(66, 3)
      + '<path d="M90 56 Q106 55 109 36 L117 36 L117 84 L109 84 Q106 65 90 64 Z" ' + P + ' ' + K + '/><line x1="113" y1="34" x2="113" y2="86" ' + K + ' stroke-width="5"/>'
      + '</g></g>');
    // --- ukulele (digambar tegak, kepala di atas, lalu dimiringkan) ---
    let frets = '', strs = '';
    for (const y of [26, 38, 50]) frets += '<line x1="52" y1="' + y + '" x2="68" y2="' + y + '" ' + K + ' stroke-width="2"/>';
    for (const x of [55.5, 60, 64.5]) strs += '<line x1="' + x + '" y1="80" x2="' + x + '" y2="103" ' + K + ' stroke-width="1.4"/>';
    const peg = (cx, cy) => '<circle cx="' + cx + '" cy="' + cy + '" r="4" ' + P + ' ' + K + ' stroke-width="2.6"/>';
    const uke = wrap('i-uke',
      '<g class="uk-g" transform="translate(60 60) rotate(35) scale(.84) translate(-60 -62)"><g class="uk-in">'
      + peg(45, 7) + peg(45, 15) + peg(75, 7) + peg(75, 15)
      + '<path d="M50 2 Q60 -1 70 2 L68 18 L52 18 Z" ' + P + ' ' + K + '/>'
      + '<rect x="52" y="17" width="16" height="44" ' + P + ' ' + K + '/>' + frets
      + '<path d="M50 56 C50 66 36 72 36 90 C36 106 47 117 60 117 C73 117 84 106 84 90 C84 72 70 66 70 56 Z" ' + P + ' ' + K + '/>'
      + '<g class="uk-s">' + strs + '</g>'
      + '<circle cx="60" cy="78" r="8" fill="var(--ink)"/>'
      + '<rect x="48" y="102" width="24" height="6" rx="1.5" ' + P + ' ' + K + ' stroke-width="2.6"/>'
      + '</g></g>');
    // --- pianika / melodica (digambar mendatar, pipa tiup di kanan, lalu dimiringkan) ---
    let wk = '', bk = '';
    for (let i = 0; i < 8; i++) wk += '<rect class="pk pk' + (i % 4) + '" x="' + (13 + i * 9) + '" y="49" width="9" height="26" ' + P + ' ' + K + ' stroke-width="1.6"/>';
    for (const i of [0, 1, 3, 4, 5]) bk += '<rect class="pb" x="' + (13 + (i + 1) * 9 - 3) + '" y="49" width="6" height="15" rx="1" fill="var(--ink)"/>';
    const pika = wrap('i-pika',
      '<g transform="rotate(-25 60 60)"><g class="pi-in">'
      + '<rect x="94" y="54" width="21" height="12" rx="4" ' + P + ' ' + K + '/><rect x="109" y="52" width="8" height="16" rx="3" fill="var(--ink)"/>'
      + '<rect x="4" y="38" width="94" height="44" rx="9" ' + P + ' ' + K + '/>'
      + '<g class="pw">' + wk + '</g>' + bk
      + '<circle cx="90" cy="46" r="2" fill="var(--ink)"/><circle cx="90" cy="60" r="2" fill="var(--ink)"/><circle cx="90" cy="74" r="2" fill="var(--ink)"/>'
      + '</g></g>');
    // --- harmonika (mendatar, lalu dimiringkan; digeser kiri-kanan seperti ditiup) ---
    let holes = '';
    for (let i = 0; i < 10; i++) holes += '<rect x="' + (14.5 + i * 9.1) + '" y="67" width="6.4" height="9" rx="1.2" fill="var(--ink)"/>';
    const harp = wrap('i-harp',
      '<g transform="rotate(-18 60 60)"><g class="hm-in">'
      + '<rect x="5" y="38" width="110" height="44" rx="7" ' + P + ' ' + K + '/>'
      + '<rect x="10" y="42" width="100" height="19" rx="4" ' + P + ' ' + K + ' stroke-width="2.2"/>'
      + '<circle cx="18" cy="51.5" r="2.4" fill="var(--ink)"/><circle cx="102" cy="51.5" r="2.4" fill="var(--ink)"/>'
      + '<line x1="30" y1="51.5" x2="90" y2="51.5" ' + K + ' stroke-width="1.8"/>'
      + '<line x1="9" y1="64" x2="111" y2="64" ' + K + ' stroke-width="2"/>' + holes
      + '</g></g>');
    return [kit, mic, tamb, trumpet, uke, pika, harp];
  })();
  function instrumentFor(id) {
    let h = 0; const s = String(id);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return INSTR[h % INSTR.length];
  }

  // kursi dibuat sekali; update hanya mengubah yang berubah, jadi animasi tidak diulang
  const seatEls = [];
  function buildSeats() {
    for (let k = 0; k < SEATS; k++) {
      const a = ((67.5 + k * 45) * Math.PI) / 180;               // melingkar, digeser 22.5° supaya tidak menabrak sudut alat; kamu = kursi pertama
      const root = document.createElement('div');
      root.className = 'seat empty';
      root.style.setProperty('--c', Math.cos(a).toFixed(4));
      root.style.setProperty('--s', Math.sin(a).toFixed(4));
      root.style.setProperty('--i', k);
      const av = document.createElement(k === 0 ? 'button' : 'div');
      av.className = 'avatar';
      if (k === 0) { av.type = 'button'; av.title = 'Ganti nama'; av.addEventListener('click', rename); }
      const ins = document.createElement('span'); ins.className = 'ins';                 // lingkaran warna + alat musik
      av.append(ins);
      const eq = document.createElement('div');
      eq.className = 'eq';
      eq.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
      const nm = document.createElement('div');
      nm.className = 'name';
      root.append(av, eq, nm);
      el.seats.append(root);
      const fxk = document.createElement('div');                 // titik keluarnya efek untuk kursi ini
      fxk.className = 's-fx';
      fxk.style.setProperty('--c', Math.cos(a).toFixed(4));
      fxk.style.setProperty('--s', Math.sin(a).toFixed(4));
      el.spot.append(fxk);
      seatEls.push({ root, av, nm, fx: fxk, sig: null, id: null, on: false, last: 0 });
    }
  }

  let seatsReady = false, shownCount = 0;
  function renderSeats() {
    const others = [...peers.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    const list = [{ id: me.id, name: me.name, hue: me.hue, self: true, playing: !audio.paused && state.tracks.length > 0, title: currentTitle() }, ...others].slice(0, SEATS);

    const n = 1 + peers.size;
    if (n !== shownCount) {
      shownCount = n;
      setNum(el.count, n, 0, '');
    }

    for (let k = 0; k < SEATS; k++) {
      const p = list[k], s = seatEls[k];
      const sig = p ? [p.id, p.name, p.hue, p.playing].join('|') : '';
      if (s.sig === sig) continue;
      const joined = !!p && s.id !== p.id;
      if (s.typ && s.id !== (p ? p.id : null)) { clearTimeout(s.typ._t); dropBubble(s, s.typ); s.typ = null; }
      s.sig = sig; s.id = p ? p.id : null; s.on = !!(p && p.playing);
      s.root.classList.toggle('empty', !p);
      s.root.classList.toggle('me', !!(p && p.self));
      s.root.classList.toggle('on', !!(p && p.playing));
      if (p) {
        s.av.style.setProperty('--h', p.hue); s.root.style.setProperty('--h', p.hue);
        const svg = instrumentFor(p.id);
        if (s.ins !== svg) { s.ins = svg; s.av.firstChild.innerHTML = svg; }
        s.nm.textContent = p.self ? p.name + ' (kamu)' : p.name;
        if (!p.self) s.av.title = p.name + (p.title ? ' — ' + (p.playing ? 'memutar: ' : 'siap: ') + p.title : '');
      } else {
        s.ins = null; s.av.firstChild.innerHTML = '';
        s.nm.textContent = '';
        s.av.removeAttribute('title');
      }
      if (joined && seatsReady && !rm() && s.av.animate) {
        s.av.animate(
          [{ transform: 'scale(.5)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
          { duration: 650, easing: 'cubic-bezier(.3,1.5,.5,1)' }
        );
      }
    }
    seatsReady = true;
  }

  /* ---------- mulai ---------- */
  const savedVol = parseFloat(store.get('lobby.vol', '0.8'));
  setVol(isFinite(savedVol) ? savedVol : 0.8, false);
  themeLabel();
  buildSeats();
  renderQueue();
  updateNow(1);
  renderSeats();
  renderDisplay();
  placeArm();
  placeGears(0);                       // posisi awal gigi sudah saling mengunci walau piringan diam
  CLK.last = realMin(); CLK.real = CLK.last; drawClock(CLK.last);
  requestAnimationFrame(frame);
  announce('hello');
  initFirebase();
})();
