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
  const toast = () => {};                                    // notifikasi pop-up dimatikan (menutupi layar)

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
  // local.on = sedang offline (atau server belum tersambung): pemutar jalan sendiri dari lagu yang tersimpan di perangkat
  const local = { on: false };
  const shd = () => !!fb && !local.on;                        // true = kontrol memutar lagu bersama lobby
  const REST_ANGLE = 0;
  const currentTitle = () => (state.tracks[state.index] ? state.tracks[state.index].name : '');

  function addFiles(list) {
    const files = [...list].filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/i.test(f.name));
    if (!files.length) { toast('Tidak ada file audio yang dipilih'); return; }
    if (shd()) { uploadShared(files); return; }          // mode lobby: lagu dibagikan ke semua orang
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
    shared.loadedSid = state.tracks[i].fromLobby ? state.tracks[i].id : null;
    if (shared.loadedSid) store.set('lobby.last', shared.loadedSid);
    updateNow(dir);
    renderQueue();
    updateMediaSession();
    if (autoplay) audio.play().catch(() => {});
    announce();
  }

  function next(auto) {
    clockRewind();
    if (shd()) { sharedNext(auto); return; }
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
    if (shd()) { if (audio.currentTime > 3) seekTo(0); else sharedMove(-1); return; }
    const n = state.tracks.length;
    if (!n) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    loadTrack((state.index - 1 + n) % n, true, -1);
  }

  function toggle() {
    if (shd()) { sharedToggle(); return; }
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
    document.title = t ? t + ' — Xina Music' : 'Xina Music';
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
    setMediaState('playing');
    placeArm(); renderDisplay(); renderSeats(); announce();
  });
  audio.addEventListener('pause', () => {
    document.body.classList.remove('is-playing');
    setMediaState('paused');
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
  el.seek.addEventListener('change', () => { if (shd() && shared.pb) pbWrite({ pos: audio.currentTime }); });
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
    if (shd()) { if (shared.pb) { pbWrite({ shuffle: !shared.pb.shuffle }); flashDisplay(!shared.pb.shuffle ? 'SHUFFLE ON' : 'SHUFFLE OFF'); } return; }
    state.shuffle = !state.shuffle;
    el.shuffle.classList.toggle('active', state.shuffle);
    flashDisplay(state.shuffle ? 'SHUFFLE ON' : 'SHUFFLE OFF');
  });
  el.loop.addEventListener('click', () => {
    if (shd()) {
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
    const sRoot = e.target.closest('.seat'), sk = sRoot ? seatEls.findIndex((x) => x.root === sRoot) : -1;
    if (sk > 0 && seatEls[sk].id) { openGiftMenu(sk); return; }    // ketuk avatar orang lain: pilih hadiah (bukan gelombang)
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
  /* ---------- suara tik-tok jam ----------
     hanya berbunyi di "mode jam": lagu tidak diputar dan jarum sudah mendarat di waktu asli. Tiap detik satu ketukan,
     bergantian tik (tinggi) dan tok (rendah), tepat saat jarum detik melompat. Satu ketukan juga saat jam baru mendarat
     setelah lagu berhenti. Volumenya mengikuti knob (0 = senyap). AudioContext baru dibuat setelah interaksi pertama
     (aturan autoplay browser), jadi sebelum itu halaman tetap senyap. */
  let tctx = null, tnoise = null, tflip = false, clockMode = false;
  function unlockTick() {
    try {
      if (!tctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        tctx = new AC();
        tnoise = tctx.createBuffer(1, Math.floor(tctx.sampleRate * 0.05), tctx.sampleRate);
        const d = tnoise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (tctx.state === 'suspended') tctx.resume();
    } catch (e) { tctx = null; }
  }
  ['pointerdown', 'keydown', 'touchend'].forEach((ev) => window.addEventListener(ev, unlockTick, { passive: true }));
  function tickSound(ctx, dest, noise, t, tock, peak) {
    // klik: noise pendek dibentuk band-pass (tik lebih tinggi dari tok)
    const src = ctx.createBufferSource(); src.buffer = noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = tock ? 2300 : 3100; bp.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    src.connect(bp); bp.connect(g); g.connect(dest); src.start(t); src.stop(t + 0.05);
    // ketukan kayu kecil di bawah klik
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(tock ? 820 : 1100, t); o.frequency.exponentialRampToValueAtTime(tock ? 520 : 700, t + 0.03);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(peak * 0.5, t + 0.001); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(og); og.connect(dest); o.start(t); o.stop(t + 0.06);
  }
  function playTick(soft) {
    if (!tctx || tctx.state !== 'running') return;
    const vol = Math.min(1, state.vol);
    if (vol <= 0) return;
    tickSound(tctx, tctx.destination, tnoise, tctx.currentTime + 0.005, tflip, 0.3 * vol * (soft ? 0.75 : 1));
    tflip = !tflip;
  }
  // jarum detik: tiap detik pindah tepat ke garis berikutnya (pegas sedikit kebablasan seperti jam kuarsa), lalu diam di garis
  function stepSeconds(dt) {
    const s = new Date().getSeconds();
    if (SEC.last < 0) { SEC.last = s; SEC.count = s; SEC.x = s * 6; SEC.x0 = SEC.x; }
    if (s !== SEC.last) { SEC.count += (s - SEC.last + 60) % 60; SEC.last = s; if (clockMode) playTick(false); }
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
    // mode jam = lagu tidak diputar dan jarum sudah di waktu asli (tidak sedang ngebut / mundur / mendarat)
    const idleClock = (audio.paused || !state.tracks.length) && !CLK.resetting && CLK.extra === 0 && CLK.vel === 0 && !CLK.fin;
    if (idleClock && !clockMode) playTick(true);          // baru masuk mode jam: satu ketukan pendaratan
    clockMode = idleClock;
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
  function setMediaState(st) { try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = st; } catch (e) { /* abaikan */ } }
  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const t = state.tracks[state.index];
    if (!t) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.name, artist: 'Xina Music' });
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
      actx.onstatechange = () => { if (actx.state !== 'running' && !audio.paused) actx.resume().catch(() => {}); };
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
  /* ---------- alat musik di kursi ikut frekuensi lagu ----------
     tiga kelompok pita diubah jadi variabel CSS di #seats (0..1), lalu dipakai style.css untuk menggerakkan alat:
       --kick  lonjakan bass (kick)          -> drum bass, bola di belakang drum
       --snrA / --snrB  lonjakan mid         -> snare + tom, bergantian kiri/kanan tiap ketukan
       --hat / --crash lonjakan treble       -> simbal (crash lebih lambat padam)
       --hi    energi treble yang dihaluskan -> amplitudo goyangan tamborin, dengung senar ukulele
       --mid   energi mid yang dihaluskan    -> goyangan mic, trumpet, ukulele, pianika, harmonika
       --note  lonjakan mid (tiap nada baru) -> katup trumpet, tuts pianika, loncatan bola
     nilai dibulatkan ke 1/24 dan hanya ditulis kalau berubah, supaya style tidak dihitung ulang tiap frame */
  const RX = { snr: 0, hat: 0, crash: 0, a: 0, b: 0, midS: 0, flip: false, armed: true, pMid: 0, pHi: 0, w: {}, on: false };
  function rxSet(name, v) {
    const q = Math.round(Math.min(1, Math.max(0, v)) * 24) / 24;
    if (RX.w[name] === q) return;
    RX.w[name] = q;
    el.seats.style.setProperty('--' + name, q);
  }
  function reactInstruments(dt, active) {
    if (active !== RX.on) { RX.on = active; el.seats.classList.toggle('react', active); }
    if (!active) {
      if (RX.snr || RX.hat || RX.crash || RX.a || RX.b || RX.midS || RX.w.kick || RX.w.hi) {
        RX.snr = RX.hat = RX.crash = RX.a = RX.b = RX.midS = 0;
        ['kick', 'snrA', 'snrB', 'hat', 'crash', 'hi', 'mid', 'note'].forEach((n) => rxSet(n, 0));
      }
      return;
    }
    // pita onset: mid ~230 Hz-3 kHz (snare/tom, band 12-33), treble ~3,3 kHz ke atas (hi-hat/simbal, band 36-47).
    // lonjakan mid dikurangi sebagian kick, karena kick juga menyisakan sedikit energi di mid.
    let mid = 0; for (let i = 12; i < 34; i++) mid += sm[i];
    let hh = 0; for (let i = 36; i < BANDS; i++) hh += sm[i];
    const midN = mid / 22, hhN = hh / (BANDS - 36);
    const sOn = Math.min(1, Math.max(0, (midN - RX.pMid) * 6 - kick * 0.7));   // seberapa kuat ketukan mid di frame ini
    const hOn = Math.min(1, Math.max(0, hhN - RX.pHi) * 8);
    RX.pMid = midN; RX.pHi = hhN;
    if (sOn > 0.35 && RX.armed) { RX.flip = !RX.flip; RX.armed = false; }   // ketukan baru: pindah ke sisi lain
    else if (sOn < 0.1) RX.armed = true;
    const dS = Math.exp(-dt * 11);
    RX.a *= dS; RX.b *= dS;
    if (RX.flip) RX.a = Math.max(RX.a, sOn); else RX.b = Math.max(RX.b, sOn);
    RX.hat = Math.max(RX.hat * Math.exp(-dt * 13), hOn);
    RX.crash = Math.max(RX.crash * Math.exp(-dt * 5), hOn > 0.6 ? hOn : 0);
    rxSet('kick', kick);
    rxSet('snrA', RX.a); rxSet('snrB', RX.b);
    rxSet('hat', RX.hat); rxSet('crash', RX.crash);
    rxSet('hi', hiS);
    RX.midS += (Math.min(1, midN * 2.2) - RX.midS) * Math.min(1, dt * 8);
    rxSet('mid', RX.midS);                       // energi mid yang dihaluskan: vokal / melodi (mic, trumpet, ukulele, pianika, harmonika)
    rxSet('note', Math.max(RX.a, RX.b));         // lonjakan mid tanpa membedakan sisi: tiap "nada" baru
  }

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
    reactInstruments(dt, playing && !calm);
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
  try { bc = new BroadcastChannel('xina-music-v1'); } catch (e) { bc = null; }
  let fb = null;                                            // { update, meRef } setelah Firebase tersambung

  // catetan: teks singkat di bawah avatar, tetap tampil (juga setelah refresh) sampai kamu menyimpan catetan baru
  const NOTE_MAX = 40;
  const cleanNote = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
  const mine = { note: cleanNote(store.get('lobby.note', '')) };
  // AFK otomatis: tab / aplikasi disembunyikan (HP dikunci atau pindah aplikasi, lagu tetap jalan di background) -> catetan sementara "AFK"
  const AFK_TEXT = 'AFK', AFK_STALE_MS = 10 * 60 * 1000;     // browser memperlambat timer tab tersembunyi, jadi AFK diberi toleransi heartbeat lebih lama
  let afk = !!document.hidden;
  const shownNote = () => (afk ? AFK_TEXT : mine.note);
  const isStale = (v, now) => !!v.seen && now - v.seen > (v.afk ? AFK_STALE_MS : STALE_MS);
  const presenceData = () => ({ name: me.name, hue: me.hue, playing: !audio.paused && state.tracks.length > 0, title: currentTitle().slice(0, 80), note: shownNote() || null, afk: afk ? 1 : null });
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
      bc.postMessage({ type: type || 'hb', id: me.id, name: me.name, hue: me.hue, playing: !audio.paused, title: currentTitle(), note: shownNote() });
    } catch (e) { /* abaikan */ }
  }

  if (bc) {
    bc.onmessage = (ev) => {
      if (fb) return;
      const m = ev.data;
      if (!m || m.id === me.id) return;
      if (m.type === 'chat') { chatFrom(m.id, m.text); return; }
      if (m.type === 'typing') { typingFrom(m.id, m.text); return; }
      if (m.type === 'gift') { giftFrom(m.id, m.to, m.kind); return; }
      if (m.type === 'duet') { duetFrom(m.id, m.to, DUET_MS); return; }
      if (m.type === 'tap') { const k = seatEls.findIndex((s) => s.id === String(m.id)); if (k > 0) burst(k); return; }
      if (m.type === 'bye') { peers.delete(m.id); renderSeats(); return; }
      const isNew = !peers.has(m.id);
      peers.set(m.id, {
        id: String(m.id), name: String(m.name || '?').slice(0, 24), hue: Number(m.hue) || 0,
        playing: !!m.playing, title: String(m.title || '').slice(0, 80), note: cleanNote(m.note), seen: Date.now()
      });
      if (m.type === 'hello' || isNew) announce();
      renderSeats();
    };
    window.addEventListener('pagehide', () => { try { if (bc) bc.postMessage({ type: 'bye', id: me.id }); } catch (e) { /* abaikan */ } });
  }
  let lastBeat = 0;
  setInterval(() => {
    if (fb) { if (Date.now() - lastBeat > 15000) { lastBeat = Date.now(); pushPresence(true); } return; }   // heartbeat Firebase tiap ~15 detik (berbasis waktu, jadi tetap benar walau timer tab tersembunyi diperlambat)
    const now = Date.now();
    for (const [id, p] of peers) if (now - p.seen > 7000) peers.delete(id);
    announce();
    renderSeats();
  }, 2000);


  function setAfk(v) {
    v = !!v;
    if (v === afk) return;
    afk = v;
    renderSeats(); announce(); pushPresence(true);
    if (!v) {                                                     // kembali ke layar: bangunkan audio, sinkron ulang posisi lagu
      lastBeat = Date.now();
      if (actx && actx.state !== 'running' && !audio.paused) actx.resume().catch(() => {});
      if (shd()) applyPlayback();
    }
  }
  document.addEventListener('visibilitychange', () => setAfk(document.hidden));
  document.addEventListener('freeze', () => setAfk(true));

  /* ---------- lagu bersama: file diubah jadi base64, disimpan di Firebase, diputar barengan ---------- */
  const MAX_BYTES = 4 * 1024 * 1024;        // batas ukuran file (base64 ~ +33%)
  const CHUNK = 262144;                     // karakter base64 per potongan (kelipatan 4)
  const MAX_SONGS = 10;                     // lagu terlama dihapus otomatis kalau lebih dari ini
  const shared = { pb: null, list: [], loadedSid: null, loadingSid: null, blobs: new Map(), pending: new Map() };
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
    if (shd() && shared.pb) pbWrite({ pos: t });
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
  let idbP = null;
  const idbOpen = () => idbP || (idbP = new Promise((res) => {
    try {
      const r = indexedDB.open('lobby-songs', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('s');
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    } catch (e) { res(null); }
  }));
  const idbHas = (id) => idbOpen().then((d) => d && new Promise((res) => {
    try { const q = d.transaction('s').objectStore('s').count(id); q.onsuccess = () => res(q.result > 0); q.onerror = () => res(false); } catch (e) { res(false); }
  })).then((v) => !!v);
  const idbKeys = () => idbOpen().then((d) => d && new Promise((res) => {
    try { const q = d.transaction('s').objectStore('s').getAllKeys(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); } catch (e) { res([]); }
  })).then((v) => v || []);
  const idbGet = (id) => idbOpen().then((d) => d && new Promise((res) => {
    try { const q = d.transaction('s').objectStore('s').get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (e) { res(null); }
  }));
  const idbPut = (id, blob) => idbOpen().then((d) => { try { d && d.transaction('s', 'readwrite').objectStore('s').put(blob, id); } catch (e) { /* abaikan */ } });
  const idbDel = (id) => idbOpen().then((d) => { try { d && d.transaction('s', 'readwrite').objectStore('s').delete(id); } catch (e) { /* abaikan */ } });

  /* ---- unduh + susun ulang lagu dari potongan base64 ---- */
  const blobUrl = (id, blob) => { if (!shared.blobs.has(id)) shared.blobs.set(id, URL.createObjectURL(blob)); return shared.blobs.get(id); };
  function getSongUrl(t, cacheOnly) {                          // cacheOnly: hanya dari perangkat (tanpa internet), null kalau belum tersimpan
    if (shared.blobs.has(t.id)) return Promise.resolve(shared.blobs.get(t.id));
    if (cacheOnly) return idbGet(t.id).then((cached) => (cached ? blobUrl(t.id, cached) : null));
    if (shared.pending.has(t.id)) return shared.pending.get(t.id);
    const p = idbGet(t.id).then((cached) => {
      if (cached) return blobUrl(t.id, cached);
      return fetchSong(t);
    }).finally(() => shared.pending.delete(t.id));
    shared.pending.set(t.id, p);
    return p;
  }
  const fetchSong = (t) => downloadBlob(t).then((blob) => blobUrl(t.id, blob));
  function downloadBlob(t) {                                    // unduh dari server, simpan ke IndexedDB, kembalikan Blob
    const get = fb.db.get(fb.db.ref(fb.rdb, 'lobby/chunks/' + t.id));
    const limit = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 60000));   // koneksi menggantung: jangan tahan pemutar selamanya
    return Promise.race([get, limit]).then(async (snap) => {
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
      return blob;
    });
  }

  let loadGen = 0, loadRetryT = null, loadFails = 0;
  async function loadShared(t) {
    if (shared.loadingSid === t.id) return;
    if (shared.loadedSid) clockRewind();
    const gen = ++loadGen;
    clearTimeout(loadRetryT);
    shared.loadingSid = t.id; renderDisplay();
    let url = null;
    try { url = await getSongUrl(t); } catch (e) { url = null; }
    if (gen !== loadGen) return;                                 // keburu ganti lagu lagi (atau offline): panggilan yang lebih baru yang melanjutkan
    shared.loadingSid = null; renderDisplay();
    if (!url) {                                                  // gagal unduh: coba lagi pelan-pelan, bukan tiap saat
      loadFails++;
      if (shd()) loadRetryT = setTimeout(applyPlayback, Math.min(30000, 2000 * loadFails));
      return;
    }
    loadFails = 0;
    if (shd() && shared.pb && shared.pb.sid === t.id) {
      audio.src = url; audio.load();
      shared.loadedSid = t.id;
      store.set('lobby.last', t.id);
      updateMediaSession();
    }
    applyPlayback();
    prefetchSoon();
  }

  // samakan pemutar lokal dengan keadaan bersama
  function applyPlayback() {
    if (!shd()) return;
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
      if (audio.paused) {
        const pr = audio.play();
        if (pr && pr.then) pr.then(() => { needTap = false; }).catch(() => { needTap = true; });   // diblokir autoplay: lanjut begitu layar diketuk
      }
    } else {
      if (!audio.paused) audio.pause();
      if (Math.abs(audio.currentTime - pb.pos) > 0.3) audio.currentTime = pb.pos;
    }
    renderDisplay();
  }
  const unlockPlay = () => {
    if (!shd() || !needTap) return;
    tapUnlockAt = performance.now();
    applyPlayback();
  };
  for (const ev of ['pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(ev, unlockPlay, true);
  setInterval(() => {                                            // koreksi drift pelan-pelan + lanjutkan kalau tiba-tiba terhenti (mis. diinterupsi sistem)
    if (!shd() || !shared.pb || !shared.pb.playing || shared.loadedSid !== shared.pb.sid || seeking) return;
    if (audio.paused) { if (!needTap && !shared.loadingSid) applyPlayback(); return; }
    const target = sharedPos();
    if (isFinite(audio.duration) && target < audio.duration - 0.3 && Math.abs(audio.currentTime - target) > 0.4) audio.currentTime = target;
  }, 1500);

  function startShared() {
    const { db, rdb } = fb;
    local.on = false; link.fbOn = true; updateNetClass();
    // lagu lokal mode offline diganti daftar lobby. Kalau lagu yang sedang berbunyi juga ada di lobby, biarkan terus berbunyi tanpa putus.
    const keep = state.tracks[state.index];
    shared.loadedSid = keep && keep.fromLobby && !audio.paused ? keep.id : null;
    if (!shared.loadedSid) { audio.pause(); audio.removeAttribute('src'); }
    state.tracks = []; state.index = -1;
    db.onValue(db.ref(rdb, 'lobby/songs'), (snap) => {
      const list = [];
      snap.forEach((c) => {
        const v = c.val();
        if (v && v.n) list.push({ id: c.key, name: String(v.name || 'Tanpa judul').slice(0, 80), dur: 0, url: null, type: v.type, by: String(v.by || ''), at: v.at || Date.now() });
      });
      list.sort((a, b) => a.at - b.at);
      shared.list = list;
      store.set('lobby.songs', JSON.stringify(list.map((t) => ({ id: t.id, name: t.name, type: t.type, by: t.by, at: t.at }))));   // daftar ini dipakai saat offline
      const ids = new Set(list.map((x) => x.id));
      for (const [id, url] of shared.blobs) if (!ids.has(id)) { URL.revokeObjectURL(url); shared.blobs.delete(id); idbDel(id); }
      if (netUp()) idbKeys().then((ks) => { for (const k of ks) if (!ids.has(k)) idbDel(k); });   // buang lagu yang sudah dihapus dari lobby
      if (local.on) return;                                      // sedang offline: pemutar lokal tidak diganti
      state.tracks = list;
      renderQueue();
      applyPlayback();
      prefetchSoon();
    });
    db.onValue(db.ref(rdb, 'lobby/playback'), (snap) => { shared.pb = snap.val(); applyPlayback(); });
  }

  /* ---------- offline: lagu lobby yang sudah tersimpan di perangkat tetap bisa diputar sendiri; online lagi -> otomatis masuk lobby ---------- */
  const netUp = () => navigator.onLine !== false;
  const link = { fbOn: false };                                  // fbOn: koneksi ke server Firebase aktif
  function updateNetClass() { document.body.classList.toggle('is-offline', local.on || (!fb && FIREBASE_CONFIGS.length > 0 && !netUp())); }

  async function offlineTracks(list) {                           // hanya lagu yang sudah ada di perangkat
    const out = [];
    for (const t of list) {
      const url = await getSongUrl(t, true);
      if (url) out.push({ id: t.id, name: t.name, type: t.type, by: t.by, at: t.at, dur: 0, url, fromLobby: true });
    }
    return out;
  }
  // buka aplikasi tanpa internet (atau server mati): tampilkan pustaka lagu lobby terakhir dari perangkat
  async function loadLibrary() {
    if (fb || state.tracks.length) return;
    let saved = [];
    try { saved = JSON.parse(store.get('lobby.songs', '[]')) || []; } catch (e) { saved = []; }
    if (!shared.list.length) shared.list = saved.filter((x) => x && x.id && x.name).map((x) => ({ id: String(x.id), name: String(x.name).slice(0, 80), dur: 0, url: null, type: x.type, by: String(x.by || ''), at: x.at || 0 }));
    const lib = await offlineTracks(shared.list);
    if (fb || state.tracks.length || !lib.length) return;      // keburu tersambung, atau pengguna menambah lagu sendiri, atau belum ada yang tersimpan
    state.tracks = lib;
    renderQueue();
    const last = store.get('lobby.last', '');
    loadTrack(Math.max(0, lib.findIndex((t) => t.id === last)), false, 1);
    updateNetClass();
  }

  // koneksi putus saat sedang di lobby: lagu yang sedang berbunyi tidak boleh berhenti, pemutar pindah ke mode lokal
  async function goLocal() {
    if (!fb || local.on) return;
    const lib = await offlineTracks(shared.list);
    if (!fb || local.on) return;
    local.on = true;
    loadGen++; shared.loadingSid = null; clearTimeout(loadRetryT);   // batalkan unduhan yang menggantung
    peers.clear();
    state.tracks = lib;
    state.index = lib.findIndex((t) => t.id === shared.loadedSid);
    renderQueue(); updateNow(1); renderSeats(); renderDisplay(); updateMediaSession(); updateNetClass();
  }
  let rejoining = false;
  async function goShared() {
    if (!local.on || rejoining) return;
    rejoining = true;
    try {                                                        // ambil keadaan lobby terbaru dulu, supaya tidak sempat loncat ke lagu basi
      const snap = await Promise.race([fb.db.get(fb.db.ref(fb.rdb, 'lobby/playback')), new Promise((r) => setTimeout(r, 3000))]);
      if (snap && typeof snap.val === 'function') shared.pb = snap.val();
    } catch (e) { /* pakai yang ada */ }
    rejoining = false;
    if (!local.on || !(link.fbOn && netUp())) return;
    local.on = false;
    state.tracks = shared.list; state.index = -1;
    renderQueue(); updateNetClass();
    applyPlayback();                                             // ikut keadaan lobby sekarang (lagu & posisi)
    pushPresence(true);
    prefetchSoon();
  }
  let localT = null;
  function syncLink() {
    if (!fb) return;
    clearTimeout(localT);
    if (link.fbOn && netUp()) { goShared(); return; }
    if (local.on) return;
    if (!netUp()) goLocal();
    else localT = setTimeout(() => { if (!(link.fbOn && netUp())) goLocal(); }, 4000);   // putus sebentar saja: tunggu dulu
  }

  /* ---- unduh semua lagu lobby di belakang layar supaya bisa diputar offline dan ganti lagu terasa instan ---- */
  let prefT = null, prefBusy = false;
  const prefetchSoon = (ms) => { clearTimeout(prefT); prefT = setTimeout(prefetchAll, ms == null ? 4000 : ms); };
  async function prefetchAll() {
    if (prefBusy || !shd() || !netUp()) return;
    if (navigator.connection && navigator.connection.saveData) return;   // hemat data: jangan unduh diam-diam
    prefBusy = true;
    try {
      const L = shared.list, cur = L.findIndex((t) => t.id === (shared.pb && shared.pb.sid)), st = cur >= 0 ? cur + 1 : 0;
      for (let k = 0; k < L.length; k++) {                       // lagu setelah yang sedang berbunyi didahulukan
        const t = L[(st + k) % L.length];
        if (!shd() || shared.loadingSid) break;                  // lagu yang sedang dibutuhkan didahulukan
        if (shared.blobs.has(t.id) || await idbHas(t.id)) continue;
        await downloadBlob(t);
        await new Promise((r) => setTimeout(r, 1200));
      }
    } catch (e) { prefetchSoon(30000); }
    prefBusy = false;
  }

  // sambung ke server: dicoba terus sampai berhasil (online lagi, atau server pulih)
  let fbReady = false, connecting = false;
  async function connectLobby() {
    if (fbReady || connecting || !FIREBASE_CONFIGS.length || !netUp()) return;
    connecting = true;
    try { fbReady = await initFirebase(); } finally { connecting = false; }
    if (!fbReady && !fb) loadLibrary();                          // server belum bisa dicapai: pakai lagu yang tersimpan
  }
  window.addEventListener('online', () => { updateNetClass(); connectLobby(); syncLink(); });
  window.addEventListener('offline', () => { updateNetClass(); syncLink(); if (!fb) loadLibrary(); });
  setInterval(connectLobby, 20000);

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
        return true;
      }
    }
    console.warn('Semua server Firebase tidak merespon, pakai lagu yang tersimpan / mode antar-tab');
    return false;
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
      const dropCheck = () => {
        if (link.fbOn) return;
        if (!netUp()) { dropT = setTimeout(dropCheck, DROP_MS); return; }      // memang offline: bukan salah server, tunggu saja (jangan muat ulang)
        try { sessionStorage.setItem('lobby.srv', String((idx + 1) % FIREBASE_CONFIGS.length)); } catch (e) { /* abaikan */ }
        location.reload();
      };
      db.onValue(db.ref(rdb, '.info/connected'), (s) => {
        clearTimeout(dropT);
        link.fbOn = !!s.val();
        syncLink();
        if (!link.fbOn) dropT = setTimeout(dropCheck, DROP_MS);
      });
      const meRef = db.ref(rdb, ROOM + '/' + me.id);
      const lastTap = new Map(), lastChat = new Map(), lastTyp = new Map(), lastGift = new Map(), lastDuet = new Map();
      let offset = 0, first = true;

      // sambung / sambung ulang: daftarkan hapus-otomatis saat koneksi putus, lalu tulis kehadiran
      db.onValue(db.ref(rdb, '.info/serverTimeOffset'), (s) => { offset = Number(s.val()) || 0; srvOff = offset; });
      // kapasitas lobby: maks SEATS orang. Yang ke-9 dst. tidak boleh masuk (urutan ditentukan joinAt dari server)
      const fresh = (snap) => {
        const now = Date.now() + offset, L = [];
        snap.forEach((c) => { const v = c.val(); if (v && c.key !== me.id && !isStale(v, now)) L.push({ id: c.key, at: v.joinAt || 0 }); });
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
        const now = Date.now() + offset, seen = new Set(), said = [], typers = [], gifts = [], duetsNew = [];
        snap.forEach((c) => {
          const id = c.key, v = c.val();
          if (id === me.id || !v) return;
          if (isStale(v, now)) return;
          seen.add(id);
          const prevTap = lastTap.get(id);
          lastTap.set(id, v.tap || 0);
          const prevChat = lastChat.get(id);
          lastChat.set(id, v.chatAt || 0);
          const prevGift = lastGift.get(id);
          lastGift.set(id, v.giftAt || 0);
          if (!first && v.gift && v.giftTo && v.giftAt && v.giftAt !== prevGift && now - v.giftAt < 8000) gifts.push([id, v.giftTo, v.gift]);   // hadiah baru
          const prevDuet = lastDuet.get(id);
          lastDuet.set(id, v.duetAt || 0);
          if (!first && v.duet && v.duetAt && v.duetAt !== prevDuet && now - v.duetAt < DUET_MS) duetsNew.push([id, v.duet, DUET_MS - (now - v.duetAt)]);   // ajakan duet baru
          const prevTyp = lastTyp.get(id) || 0, curTyp = typeof v.typing === 'number' ? v.typing : 0;
          if (curTyp !== prevTyp) { lastTyp.set(id, curTyp); typers.push([id, curTyp && now - curTyp < TYPE_MS ? '...' : '']); }   // nilai basi (mis. sisa sesi lama) diabaikan
          if (!first && v.chat && v.chatAt && v.chatAt !== prevChat && now - v.chatAt < 10000) said.push([id, v.chat]);   // pesan baru (bukan riwayat lama)
          if (!first && prevTap !== undefined && v.tap && v.tap !== prevTap) {
            const k = seatEls.findIndex((x) => x.id === id);
            if (k > 0) burst(k);
          }
          peers.set(id, {
            id, name: String(v.name || '?').slice(0, 24), hue: Number(v.hue) || 0,
            playing: !!v.playing, title: String(v.title || '').slice(0, 80), note: cleanNote(v.note), seen: Date.now()
          });
        });
        for (const id of [...peers.keys()]) if (!seen.has(id)) { peers.delete(id); lastTap.delete(id); lastChat.delete(id); lastTyp.delete(id); lastGift.delete(id); lastDuet.delete(id); }
        first = false;
        renderSeats();                                          // kursi harus sudah terpasang dulu, baru gelembung bisa ditempel
        for (const [id, text] of typers) typingFrom(id, text);
        for (const [id, to, kind] of gifts) giftFrom(id, to, kind);
        for (const [id, to, left] of duetsNew) duetFrom(id, to, left);
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
  function ensureStack(s) {
    if (!s.stack) { s.stack = document.createElement('div'); s.stack.className = 'bubbles'; s.root.append(s.stack); }
    return s.stack;
  }
  // catetan = gelembung tetap di paling bawah tumpukan (paling dekat avatar); chat biasa menumpuk di atasnya
  function setNoteBubble(s, text) {
    let b = s.noteEl && s.noteEl.isConnected ? s.noteEl : null;
    if (!text) { if (b) { b.remove(); s.noteEl = null; if (s.stack && !s.stack.children.length) s.root.classList.remove('talk'); } return; }
    if (!b) {
      b = document.createElement('div'); b.className = 'bubble unote';
      ensureStack(s).append(b); s.noteEl = b;
      void b.offsetWidth; b.classList.add('show');
    }
    b.textContent = text;                                       // textContent: catetan orang lain tidak pernah dianggap HTML
    s.root.classList.add('talk');
    clampStack(s.stack);
  }
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
    const live = [...s.stack.children].filter((x) => !x.dataset.gone && !x.classList.contains('unote'));
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

  /* ---------- popover kecil di bawah tombol header (ganti nama & catetan): tanpa prompt/alert bawaan browser ---------- */
  const pops = [];
  function makePopover(btn, menu, input, onOpen) {
    const p = { btn, menu, input };
    p.open = () => {
      pops.forEach((o) => { if (o !== p) o.close(); });
      onOpen();
      menu.hidden = false;
      if (input) input.focus({ preventScroll: true });                       // fokus langsung di dalam ketukan, supaya keyboard HP ikut terbuka
      const r = btn.getBoundingClientRect(), vw = document.documentElement.clientWidth, w = menu.offsetWidth;
      const left = Math.round(Math.max(12, Math.min(vw - w - 12, r.right - w)));
      menu.style.top = Math.round(r.bottom + 8) + 'px';
      menu.style.left = left + 'px';
      menu.style.transformOrigin = Math.max(12, Math.min(w - 12, r.left + r.width / 2 - left)) + 'px 0';
      void menu.offsetWidth; menu.classList.add('show');
      btn.setAttribute('aria-expanded', 'true');
      if (input) { try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) { /* abaikan */ } }
    };
    p.close = () => {
      if (menu.hidden) return;
      menu.classList.remove('show'); menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      if (input) input.blur();
    };
    btn.addEventListener('click', () => { if (menu.hidden) p.open(); else p.close(); });
    pops.push(p);
    return p;
  }
  document.addEventListener('pointerdown', (e) => { for (const p of pops) if (!p.menu.hidden && !e.target.closest('#' + p.menu.id + ', #' + p.btn.id)) p.close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') for (const p of pops) if (!p.menu.hidden) { p.close(); p.btn.focus(); } });

  // catetan: teks yang menempel di atas avatar sampai kamu menyimpan yang baru
  const noteBtn = $('#noteBtn'), noteMenu = $('#noteMenu'), noteIn = $('#noteIn'), noteCount = $('#noteCount');
  const countNote = () => { noteCount.textContent = noteIn.value.length + '/' + NOTE_MAX; };
  function refreshNoteBtn() {
    noteBtn.classList.toggle('has', !!mine.note);
    noteBtn.title = mine.note ? 'Catetanmu: ' + mine.note : 'Tulis catetan (tetap tampil sampai kamu ganti)';
  }
  function saveNote(text) {
    mine.note = cleanNote(text);
    store.set('lobby.note', mine.note);
    refreshNoteBtn(); renderSeats(); announce(); pushPresence(true);
  }
  const notePop = makePopover(noteBtn, noteMenu, noteIn, () => { noteIn.value = mine.note; countNote(); });
  noteIn.addEventListener('input', countNote);
  noteMenu.addEventListener('submit', (e) => { e.preventDefault(); saveNote(noteIn.value); notePop.close(); });
  $('#noteClear').addEventListener('click', () => { saveNote(''); notePop.close(); });
  refreshNoteBtn();

  /* ---------- install sebagai aplikasi (PWA): tombol install otomatis di Chrome/Edge/Android, petunjuk manual di iOS/Safari/Firefox ---------- */
  const installBtn = $('#installBtn'), installMenu = $('#installMenu'), installHelp = $('#installHelp'), installGo = $('#installGo');
  let installEvt = null;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true;
  function installHow() {
    const ua = navigator.userAgent, ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios) return 'Di iPhone/iPad: ketuk tombol Bagikan (kotak dengan panah ke atas) di Safari, lalu pilih "Tambahkan ke Layar Utama".';
    if (/firefox/i.test(ua) && !/android/i.test(ua)) return 'Firefox di komputer belum mendukung install. Buka lewat Chrome atau Edge, lalu klik ikon install di kolom alamat. Atau di HP: menu ⋮ lalu "Install".';
    if (/safari/i.test(ua) && !/chrome|chromium|crios|android/i.test(ua)) return 'Di Safari Mac: menu File lalu "Tambahkan ke Dock".';
    return 'Buka menu browser (⋮ atau ⋯) lalu pilih "Install aplikasi" atau "Tambahkan ke layar utama".';
  }
  const installPop = makePopover(installBtn, installMenu, null, () => {
    installHelp.textContent = installEvt ? 'Pasang Xina Music di perangkatmu supaya terbuka seperti aplikasi biasa, langsung dari layar utama atau desktop.' : installHow();
    installGo.hidden = !installEvt;
  });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (!standalone()) installBtn.hidden = false; });
  window.addEventListener('appinstalled', () => { installEvt = null; installBtn.hidden = true; installPop.close(); });
  // install langsung: ketuk tombol -> dialog install browser muncul seketika (tanpa menu ⋮ dan tanpa popover perantara)
  async function installNow() {
    if (!installEvt) return false;
    const e = installEvt; installEvt = null; installPop.close();
    try {
      e.prompt();
      const c = await e.userChoice;
      if (c && c.outcome === 'dismissed') { try { localStorage.setItem('xina-install-dismissed', String(Date.now())); } catch (err) { /* abaikan */ } }
    } catch (err) { /* abaikan */ }
    installBtn.hidden = true;
    return true;
  }
  installBtn.addEventListener('click', (ev) => { if (installEvt) { ev.stopImmediatePropagation(); ev.preventDefault(); installNow(); } }, true);
  installGo.addEventListener('click', installNow);
  if (!standalone()) installBtn.hidden = false;                // tombol selalu ada kalau belum terpasang; tanpa prompt otomatis, isinya petunjuk manual
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* abaikan */ }); });
  }

  // ganti nama
  const nameIn = $('#nameIn'), nameMenu = $('#nameMenu');
  const namePop = makePopover($('#renameBtn'), nameMenu, nameIn, () => { nameIn.value = me.name; });
  nameMenu.addEventListener('submit', (e) => {
    e.preventDefault();
    me.name = nameIn.value.replace(/\s+/g, ' ').trim().slice(0, 24) || me.name;
    store.set('lobby.name', me.name);
    announce(); pushPresence(true); renderSeats();
    namePop.close();
  });

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
      const av = document.createElement('div');
      av.className = 'avatar';
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
    const list = [{ id: me.id, name: me.name, hue: me.hue, self: true, playing: !audio.paused && state.tracks.length > 0, title: currentTitle(), note: shownNote() }, ...others].slice(0, SEATS);

    const n = 1 + peers.size;
    if (n !== shownCount) {
      shownCount = n;
      setNum(el.count, n, 0, '');
    }

    for (let k = 0; k < SEATS; k++) {
      const p = list[k], s = seatEls[k];
      const sig = p ? [p.id, p.name, p.hue, p.playing, p.note || ''].join('|') : '';
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
        setNoteBubble(s, p.note);
        if (!p.self) s.av.title = p.name + (p.note ? ' — "' + p.note + '"' : '') + (p.title ? ' — ' + (p.playing ? 'memutar: ' : 'siap: ') + p.title : '');
      } else {
        s.ins = null; s.av.firstChild.innerHTML = '';
        s.nm.textContent = '';
        setNoteBubble(s, '');
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

  /* ---------- hadiah: ketuk avatar teman, pilih hadiah, bola cahaya melesat lalu meledak saat kena ---------- */
  const ICON = (d) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
  const GIFTS = [
    { id: 'star', name: 'Bintang', h: 46, ic: ICON('<path d="M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.2l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>') },
    { id: 'fire', name: 'Api', h: 14, ic: ICON('<path d="M12 3c.8 3.2 5.2 5.3 5.2 10A5.2 5.2 0 0 1 6.8 13c0-1.9.9-3.2 2-4.2.3 1.2 1 2 2 2.2-.6-3 0-6 1.2-8z"/>') },
    { id: 'ice', name: 'Kristal', h: 194, ic: ICON('<path d="M6.5 4h11l3.5 5.2-9 10.8-9-10.8z"/><path d="M3 9.2h18M9.5 4L8 9.2l4 10.8 4-10.8L14.5 4"/>') },
    { id: 'love', name: 'Cinta', h: 330, ic: ICON('<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z"/>') }
  ];
  let giftLast = 0, gmId = null, gmOpenedAt = 0;
  const gm = document.createElement('div');
  gm.className = 'giftmenu'; gm.hidden = true;
  gm.innerHTML = '<div class="gm-t"></div><div class="gm-b">' + GIFTS.map((g) => '<button type="button" class="gm-i" data-g="' + g.id + '" style="--g:' + g.h + '"><span class="gm-ic">' + g.ic + '</span><span>' + g.name + '</span></button>').join('') + '</div><button type="button" class="gm-duet">' + ICON('<path d="M9 18V6.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>') + '<span>Ajak duet</span></button>';
  document.body.append(gm);
  const gmT = gm.querySelector('.gm-t');
  function closeGiftMenu() { gm.classList.remove('show'); gm.hidden = true; gmId = null; }
  function openGiftMenu(k) {
    const s = seatEls[k];
    if (!s || !s.id) return;
    const p = peers.get(s.id);
    gmId = s.id; gmOpenedAt = performance.now();
    gmT.textContent = 'Hadiah untuk ' + (p ? p.name : 'teman') + (p && p.note ? ' — ' + p.note : '');
    gm.hidden = false;
    const r = s.av.getBoundingClientRect(), w = gm.offsetWidth, h = gm.offsetHeight, vw = document.documentElement.clientWidth;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, gap = Math.max(34, r.height * .85);
    let top = cy - gap - h, below = false; if (top < 8) { top = cy + gap; below = true; }
    const left = Math.max(8, Math.min(vw - w - 8, cx - w / 2));
    gm.dataset.pos = below ? 'below' : 'above';
    gm.style.left = left + 'px';
    gm.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, top)) + 'px';
    gm.style.setProperty('--tx', Math.max(16, Math.min(w - 16, cx - left)) + 'px');        // ekor tepat di atas / bawah avatar
    gm.style.setProperty('--h', s.av.style.getPropertyValue('--h') || '200');             // bingkai memakai warna avatar tujuan
    void gm.offsetWidth; gm.classList.add('show');
  }
  gm.addEventListener('click', (e) => {
    if (e.target.closest('.gm-duet')) { const id = gmId; closeGiftMenu(); if (id) sendDuet(id); return; }
    const b = e.target.closest('.gm-i'); if (!b) return;
    const g = GIFTS.find((x) => x.id === b.dataset.g), id = gmId;
    closeGiftMenu();
    if (g && id) sendGift(id, g);
  });
  document.addEventListener('pointerdown', (e) => { if (!gm.hidden && performance.now() - gmOpenedAt > 80 && !e.target.closest('.giftmenu')) closeGiftMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !gm.hidden) closeGiftMenu(); });

  function sendGift(toId, g) {
    const t = Math.max(Date.now(), giftLast + 1);                // tanpa jeda; stempel waktu dibuat selalu naik supaya tiap kiriman terdeteksi
    if (!seatEls.some((x) => x.id === toId)) { toast('Orangnya sudah pergi'); return; }
    giftLast = t;
    flyGift(0, seatEls.findIndex((x) => x.id === toId), g);
    if (fb) fb.update(fb.meRef, { gift: g.id, giftTo: toId, giftAt: t + srvOff }).catch(() => {});
    else if (bc) { try { bc.postMessage({ type: 'gift', id: me.id, to: toId, kind: g.id }); } catch (err) { /* abaikan */ } }
  }
  function giftFrom(fromId, toId, kind) {
    const g = GIFTS.find((x) => x.id === kind);
    if (!g) return;
    const kf = seatEls.findIndex((x) => x.id === String(fromId));
    const kt = String(toId) === me.id ? 0 : seatEls.findIndex((x) => x.id === String(toId));
    if (kt < 0) return;
    flyGift(kf, kt, g);
    if (kt === 0) { const p = peers.get(String(fromId)); toast((p ? p.name : 'Seseorang') + ' mengirim ' + g.name + ' untukmu'); }
  }

  // kanvas efek: bola cahaya + jejak + ledakan (blend 'lighter' supaya menyala)
  const gfx = document.createElement('canvas');
  gfx.className = 'gfx'; gfx.setAttribute('aria-hidden', 'true');
  document.body.append(gfx);
  const gx = gfx.getContext('2d');
  let gD = 1;
  function gSize() { gD = Math.min(2, window.devicePixelRatio || 1); gfx.width = Math.round(window.innerWidth * gD); gfx.height = Math.round(window.innerHeight * gD); }
  gSize(); window.addEventListener('resize', gSize);
  const shots = [], parts = [];
  let gRaf = 0, gPrev = 0;
  const center = (k) => { const r = seatEls[k].av.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  function flyGift(kf, kt, g) {
    if (kt < 0 || !seatEls[kt]) return;
    const b = center(kt), a = kf >= 0 && seatEls[kf] ? center(kf) : { x: window.innerWidth / 2, y: window.innerHeight + 30 };
    if (rm()) { explode({ x1: b.x, y1: b.y, h: g.h, kt }); return; }
    const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 1, bow = (dx >= 0 ? -1 : 1) * dist * .28;
    shots.push({
      t0: performance.now(), dur: Math.max(520, Math.min(1000, 380 + dist * .9)), x0: a.x, y0: a.y, x1: b.x, y1: b.y,
      cx: (a.x + b.x) / 2 - dy / dist * bow, cy: (a.y + b.y) / 2 + dx / dist * bow - dist * .12, h: g.h, kt, trail: [], spin: 0
    });
    if (!gRaf) { gPrev = performance.now(); gRaf = requestAnimationFrame(gLoop); }
  }
  function explode(sh) {
    const { x1: x, y1: y, h } = sh;
    parts.push({ k: 'flash', x, y, h, age: 0, life: .35 }, { k: 'ring', x, y, h, age: 0, life: .55, r: 90 }, { k: 'ring', x, y, h, age: 0, life: .8, r: 140 });
    const n = rm() || parts.length > 900 ? 10 : 42;               // kalau banyak sekali ledakan sekaligus, kurangi percikan supaya tetap lancar
    for (let i = 0; i < n; i++) {
      const an = Math.random() * 6.2832, sp = 90 + Math.random() * 320;
      parts.push({ k: 'spark', x, y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, h: h + (Math.random() - .5) * 26, age: 0, life: .45 + Math.random() * .55, w: 1.4 + Math.random() * 2.2 });
    }
    for (let i = 0; i < (rm() ? 2 : 9); i++) {
      const an = Math.random() * 6.2832, sp = 50 + Math.random() * 200;
      parts.push({ k: 'star', x, y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - 40, h, age: 0, life: .7 + Math.random() * .6, r: 4 + Math.random() * 6, rot: Math.random() * 3 });
    }
    const s = seatEls[sh.kt];
    if (s && s.av.animate && !rm()) {                          // target kena hantam: bergetar sebentar
      s.av.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.22, .8)', offset: .12 }, { transform: 'translateX(-5px) scale(.96)', offset: .3 }, { transform: 'translateX(4px)', offset: .5 }, { transform: 'translateX(-2px)', offset: .7 }, { transform: 'none' }], { duration: 460, easing: 'ease-out' });
    }
    burst(sh.kt);
    if (!gRaf) { gPrev = performance.now(); gRaf = requestAnimationFrame(gLoop); }
  }
  function star4(c, x, y, r, rot) {
    c.beginPath();
    for (let i = 0; i < 8; i++) { const a = rot + i * Math.PI / 4, q = i % 2 ? r * .28 : r; c.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); }
    c.closePath();
  }
  // tema terang: blend 'lighter' tidak kelihatan di latar putih, jadi pakai warna pekat biasa; tema gelap: menyala (additive)
  let gLight = false;
  function gTheme() {
    const c = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(), m = /^#([0-9a-f]{6})$/i.exec(c);
    gLight = m ? parseInt(m[1].slice(0, 2), 16) * .3 + parseInt(m[1].slice(2, 4), 16) * .59 + parseInt(m[1].slice(4, 6), 16) * .11 > 128 : false;
  }
  const hc = (h, l, a) => 'hsl(' + Math.round(h) + ' 100% ' + (gLight ? Math.min(l, 56) : l) + '%' + (a == null ? ')' : ' / ' + a + ')');

  /* ---------- duet: dua avatar disambung pita cahaya bergelombang + nada mengalir, keduanya ikut bergoyang ---------- */
  const DUET_MS = 30000, DUET_MAX = 4, duets = [];
  let duetOn = false;
  const edgeD = new Map(), seenGroups = new Set();
  // siapa saja yang tersambung (langsung / lewat teman) dengan startId, termasuk pasangan calon `extra`
  function duetMembers(startId, extra) {
    const now = performance.now(), pairs = duets.filter((d) => now - d.t0 < d.dur * 1000).map((d) => [d.a, d.b]);
    if (extra) pairs.push(extra);
    const mem = new Set([startId]);
    for (let grow = true; grow;) { grow = false; for (const [x, y] of pairs) if (mem.has(x) !== mem.has(y)) { mem.add(x); mem.add(y); grow = true; } }
    return mem;
  }
  // kelompokkan pasangan yang saling tersambung jadi satu grup (duet / trio / kuartet)
  function duetGroups() {
    const par = new Map(), f = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
    const ok = [];
    for (const d of duets) {
      if (!seatEls.some((x) => x.id === d.a) || !seatEls.some((x) => x.id === d.b)) continue;
      ok.push(d);
      if (!par.has(d.a)) par.set(d.a, d.a); if (!par.has(d.b)) par.set(d.b, d.b);
      par.set(f(d.a), f(d.b));
    }
    const m = new Map();
    for (const d of ok) {
      const r = f(d.a); if (!m.has(r)) m.set(r, { ids: new Set(), end: 0, join: new Map(), pairs: [] });
      const g = m.get(r); g.pairs.push(d); g.end = Math.max(g.end, d.t0 + d.dur * 1000);
      for (const id of [d.a, d.b]) { g.ids.add(id); g.join.set(id, Math.max(g.join.get(id) || 0, d.t0)); }
    }
    return [...m.values()];
  }
  function chime(k) {                                          // tanda anggota baru bergabung: dua riak dari avatarnya
    const c = center(k), h = Number(seatEls[k].av.style.getPropertyValue('--h')) || 200;
    parts.push({ k: 'ring', x: c.x, y: c.y, h, age: 0, life: .6, r: 70 }, { k: 'ring', x: c.x, y: c.y, h: h + 30, age: 0, life: .9, r: 110 });
  }
  function sendDuet(toId) {
    const t = Math.max(Date.now(), giftLast + 1);
    if (!seatEls.some((x) => x.id === toId)) { toast('Orangnya sudah pergi'); return; }
    if (duetMembers(me.id, [me.id, toId]).size > DUET_MAX) { toast('Duet sudah penuh (maks ' + DUET_MAX + ' orang)'); return; }
    giftLast = t;
    duetFrom(me.id, toId, DUET_MS);
    if (fb) fb.update(fb.meRef, { duet: toId, duetAt: t + srvOff }).catch(() => {});
    else if (bc) { try { bc.postMessage({ type: 'duet', id: me.id, to: toId }); } catch (err) { /* abaikan */ } }
  }
  function duetFrom(a, b, ms) {
    a = String(a); b = String(b);
    if (a === b || ms < 800 || rm()) return;
    const old = duets.findIndex((d) => (d.a === a && d.b === b) || (d.a === b && d.b === a));
    if (old >= 0) duets.splice(old, 1);
    if (duetMembers(a, [a, b]).size > DUET_MAX) { if (a === me.id) toast('Duet sudah penuh (maks ' + DUET_MAX + ' orang)'); return; }
    const t0 = performance.now(), end = t0 + ms;
    for (const d of duets) if (duetMembers(a, [a, b]).has(d.a)) d.dur = Math.max(d.dur, (end - d.t0) / 1000);   // anggota lama ikut bertahan selama pendatang baru
    while (duets.length >= 12) duets.shift();
    duets.push({ a, b, t0, dur: ms / 1000, bow: (a < b ? 1 : -1), lastB: 0 });
    const nm = (id) => id === me.id ? 'kamu' : ((peers.get(id) || {}).name || '?');
    if (b === me.id) toast(nm(a) + ' mengajakmu berduet');
    else if (a === me.id) toast('Berduet dengan ' + nm(b));
    if (!gRaf) { gPrev = performance.now(); gRaf = requestAnimationFrame(gLoop); }
  }
  // gambar not balok: kind 0 = not satu (♪), kind 1 = dua not disambung balok (♫); tegak, hanya sedikit miring
  function drawNote(c, x, y, sz, kind, tilt) {
    c.save(); c.translate(x, y); c.rotate(tilt);
    const hd = (hx, hy) => { c.beginPath(); c.ellipse(hx, hy, sz * .62, sz * .44, -.5, 0, 6.2832); c.fill(); };
    c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = sz * .2;
    if (kind === 0) {
      hd(0, 0);
      c.beginPath(); c.moveTo(sz * .55, -sz * .1); c.lineTo(sz * .55, -sz * 2.5); c.stroke();
      c.beginPath(); c.moveTo(sz * .55, -sz * 2.5); c.bezierCurveTo(sz * 1.5, -sz * 2.1, sz * 1.9, -sz * 1.2, sz * 1.2, -sz * .7); c.lineWidth = sz * .3; c.stroke();
    } else {
      hd(-sz * .9, sz * .3); hd(sz * .75, 0);
      c.beginPath(); c.moveTo(-sz * .35, sz * .2); c.lineTo(-sz * .35, -sz * 2.2); c.moveTo(sz * 1.3, -sz * .1); c.lineTo(sz * 1.3, -sz * 2.5); c.stroke();
      c.beginPath(); c.moveTo(-sz * .35, -sz * 2.2); c.lineTo(sz * 1.3, -sz * 2.5); c.lineTo(sz * 1.3, -sz * 1.8); c.lineTo(-sz * .35, -sz * 1.5); c.closePath(); c.fill();
    }
    c.restore();
  }
  function drawDuet(d, ka, kb, age, now) {
    const A = center(ka), B = center(kb), dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux, R = Math.min(30, L * .3);
    const sx = A.x + ux * R, sy = A.y + uy * R, ex = B.x - ux * R, ey = B.y - uy * R, len = L - 2 * R;
    const env = Math.max(0, Math.min(1, age / .5, (d.dur - age) / .8));
    const bow = (d.bowAbs != null ? d.bowAbs : len * .22 * d.bow) * (1 + .14 * Math.sin(age * 1.3)), qx = (sx + ex) / 2 + nx * bow * 2, qy = (sy + ey) / 2 + ny * bow * 2;   // lengkungnya ikut "bernapas"
    const ha = Number(seatEls[ka].av.style.getPropertyValue('--h')) || 200;
    let hb = Number(seatEls[kb].av.style.getPropertyValue('--h')) || 320;
    hb = ha + ((hb - ha + 540) % 360) - 180;                    // campur warna lewat jalur terpendek di lingkaran warna
    const hue = (t) => ha + (hb - ha) * t, tone = gLight ? 44 : 68;
    const pt = (t, off) => {
      const m = 1 - t, x = m * m * sx + 2 * m * t * qx + t * t * ex, y = m * m * sy + 2 * m * t * qy + t * t * ey;
      return { x: x + nx * off, y: y + ny * off };
    };
    const amp = (7 + 3 * Math.sin(age * 1.7)) * env;
    const wave = (t, ph) => Math.pow(Math.sin(t * Math.PI), 1.2) * amp * (Math.sin(t * 7 - age * 3.2 + ph) + .45 * Math.sin(t * 13 + age * 2.1 + ph * 1.3)) / 1.45;   // dua gelombang campur: mengalir, tidak kaku
    gx.lineCap = 'round'; gx.lineJoin = 'round';
    const N = 56;
    for (let i = 0; i < N; i++) {                              // cahaya lembut di bawah pita
      const t0 = i / N, t1 = (i + 1) / N, q0 = pt(t0, 0), q1 = pt(t1, 0);
      gx.strokeStyle = hc(hue((t0 + t1) / 2), tone + 8, (.16 * env).toFixed(3)); gx.lineWidth = 13 * Math.sin((t0 + t1) / 2 * Math.PI) + 2;
      gx.beginPath(); gx.moveTo(q0.x, q0.y); gx.lineTo(q1.x, q1.y); gx.stroke();
    }
    for (const ph of [0, Math.PI * .9]) {                      // dua pita saling melilit, ujungnya meruncing
      let prev = pt(0, 0);
      for (let i = 1; i <= N; i++) {
        const t = i / N, q = pt(t, wave(t, ph)), tm = Math.sin(t * Math.PI);
        gx.strokeStyle = hc(hue(t), tone, (env * (.25 + .7 * tm)).toFixed(3)); gx.lineWidth = .8 + tm * 2.8;
        gx.beginPath(); gx.moveTo(prev.x, prev.y); gx.lineTo(q.x, q.y); gx.stroke();
        prev = q;
      }
    }
    for (let j = 0; j < 3; j++) {                              // nada mengalir bolak-balik
      for (const dir of [1, -1]) {
        let t = (age * (dir > 0 ? .34 : .29) + j / 3 + (dir > 0 ? 0 : .17)) % 1; if (dir < 0) t = 1 - t;
        const f = Math.sin(t * Math.PI), q = pt(t, wave(t, dir > 0 ? 0 : Math.PI * .9) + (dir > 0 ? -9 : 9) * f), h = hue(t);
        const al = env * Math.min(1, f * 2.2), sz = 5.2 + f * 1.6;
        gx.globalAlpha = al * (gLight ? .09 : .22); gx.fillStyle = hc(h, tone + 14); gx.beginPath(); gx.arc(q.x, q.y - sz, sz * 2.1, 0, 6.2832); gx.fill();
        gx.globalAlpha = al; gx.fillStyle = hc(h, tone); gx.strokeStyle = hc(h, tone);
        drawNote(gx, q.x - sz * .3, q.y + sz * 1.1, sz, (j + (dir > 0 ? 0 : 1)) % 2, Math.sin(age * 2.4 + j * 2 + dir) * .22);
      }
    }
    if (d.mid !== false) {                                                         // not besar mengambang di tengah (hanya untuk duet berdua)
      const mid = pt(.5, wave(.5, 0) * .4), bob = Math.sin(age * 3.4) * 2.2;
      gx.globalAlpha = env * (gLight ? .09 : .22); gx.fillStyle = hc(hue(.5), tone + 14); gx.beginPath(); gx.arc(mid.x, mid.y - 8, 17, 0, 6.2832); gx.fill();
      gx.globalAlpha = env; gx.fillStyle = hc(hue(.5), tone); gx.strokeStyle = hc(hue(.5), tone);
      drawNote(gx, mid.x - 3, mid.y + 6 + bob, 8.5, 1, Math.sin(age * 1.8) * .12);
    }
    gx.globalAlpha = 1;
    if (age - d.lastB > .9) { d.lastB = age; burst(ka); burst(kb); }
  }
  function gLoop(now) {
    const dt = Math.max(0, Math.min(.05, (now - gPrev) / 1000)); gPrev = now;
    gx.setTransform(gD, 0, 0, gD, 0, 0);
    gx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    gTheme(); gx.globalCompositeOperation = gLight ? 'source-over' : 'lighter';
    for (let i = shots.length - 1; i >= 0; i--) {
      const sh = shots[i], u = Math.max(0, (now - sh.t0) / sh.dur);   // rAF bisa lebih awal dari performance.now(): jangan negatif
      if (u >= 1) { shots.splice(i, 1); explode(sh); continue; }
      const e = Math.pow(u, 1.6), m = 1 - e;                  // makin dekat makin ngebut
      const x = m * m * sh.x0 + 2 * m * e * sh.cx + e * e * sh.x1, y = m * m * sh.y0 + 2 * m * e * sh.cy + e * e * sh.y1;
      sh.trail.push({ x, y }); if (sh.trail.length > 22) sh.trail.shift();
      sh.spin += dt * 9;
      const tl = sh.trail, n = tl.length;
      gx.lineCap = 'round';
      for (let j = 1; j < n; j++) {                           // ekor: makin ke belakang makin tipis dan redup
        const f = j / n;
        gx.strokeStyle = hc(sh.h, 55 + f * 25, (f * .75).toFixed(3));
        gx.lineWidth = 1 + f * 9;
        gx.beginPath(); gx.moveTo(tl[j - 1].x, tl[j - 1].y); gx.lineTo(tl[j].x, tl[j].y); gx.stroke();
      }
      const gl = gx.createRadialGradient(x, y, 0, x, y, 30);
      gl.addColorStop(0, hc(sh.h, 80, .95)); gl.addColorStop(.35, hc(sh.h, 58, .45)); gl.addColorStop(1, hc(sh.h, 50, 0));
      gx.fillStyle = gl; gx.beginPath(); gx.arc(x, y, 30, 0, 6.2832); gx.fill();
      gx.fillStyle = hc(sh.h, 92); star4(gx, x, y, 11, sh.spin); gx.fill();
      gx.fillStyle = '#fff'; gx.beginPath(); gx.arc(x, y, 3.4, 0, 6.2832); gx.fill();
      if (Math.random() < .8) parts.push({ k: 'spark', x, y, vx: (Math.random() - .5) * 60, vy: (Math.random() - .5) * 60 + 20, h: sh.h, age: 0, life: .3 + Math.random() * .3, w: 1.2 + Math.random() * 1.4 });
    }
    const act = new Set(), used = new Set(), liveKeys = new Set();
    for (let i = duets.length - 1; i >= 0; i--) if (now - duets[i].t0 >= duets[i].dur * 1000) duets.splice(i, 1);
    for (const g of duetGroups()) {
      const ms = [...g.ids].map((id) => ({ id, k: seatEls.findIndex((x) => x.id === id) })).sort((p, q) => p.k - q.k);   // urutan kursi = urutan melingkar
      for (const m of ms) act.add(seatEls[m.k].root);
      const key = ms.map((m) => m.id).join('|'); liveKeys.add(key);
      if (ms.length >= 3 && !seenGroups.has(key)) {            // grup baru terbentuk / bertambah anggota
        seenGroups.add(key);
        for (const m of ms) chime(m.k);
        if (g.ids.has(me.id)) toast((ms.length === 3 ? 'Trio' : 'Kuartet') + '! ' + ms.map((m) => m.id === me.id ? 'kamu' : ((peers.get(m.id) || {}).name || '?')).join(', ') + ' berduet bareng');
      }
      if (ms.length === 2) {
        const d = g.pairs[0], age = Math.max(0, (now - d.t0) / 1000);
        d.mid = true; drawDuet(d, ms[0].k, ms[1].k, age, now);
        continue;
      }
      let cx = 0, cy = 0;                                      // pusat lingkaran kursi (bukan pusat anggota) supaya pita melengkung di sisi luar, tidak menimpa pemutar
      const all = seatEls.map((_, i) => center(i));
      for (const q of all) { cx += q.x / all.length; cy += q.y / all.length; }
      const rs = all.reduce((t, q) => t + Math.hypot(q.x - cx, q.y - cy), 0) / all.length;
      for (let i = 0; i < ms.length; i++) {                    // lingkaran pita: tiap anggota tersambung ke tetangganya
        const u = ms[i], v = ms[(i + 1) % ms.length], ek = u.id < v.id ? u.id + '>' + v.id : v.id + '>' + u.id;
        let e = edgeD.get(ek); if (!e) { e = { lastB: 0, mid: false, bow: 1, dur: 0 }; edgeD.set(ek, e); }
        used.add(ek);
        const A = center(u.k), B = center(v.k), nx = -(B.y - A.y), ny = B.x - A.x;
        const mx = (A.x + B.x) / 2 - cx, my = (A.y + B.y) / 2 - cy, chord = Math.hypot(nx, ny) || 1;
        e.bow = mx * nx + my * ny >= 0 ? 1 : -1;                                              // lengkung ke arah luar
        e.bowAbs = e.bow * Math.max(chord * .1, rs - Math.hypot(mx, my));                      // puncaknya tepat di lingkaran kursi
        const age = Math.max(0, (now - Math.max(g.join.get(u.id) || 0, g.join.get(v.id) || 0)) / 1000);
        e.dur = age + Math.max(0, (g.end - now) / 1000);
        drawDuet(e, u.k, v.k, age, now);
      }
    }
    for (const k of [...edgeD.keys()]) if (!used.has(k)) edgeD.delete(k);
    for (const k of [...seenGroups]) if (!liveKeys.has(k)) seenGroups.delete(k);
    if (act.size || duetOn) { for (const s of seatEls) s.root.classList.toggle('duet', act.has(s.root)); duetOn = act.size > 0; }
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i]; q.age += dt;
      const p = q.age / q.life;
      if (p >= 1) { parts.splice(i, 1); continue; }
      if (q.k === 'flash') {
        const r = 40 + p * 70, gr = gx.createRadialGradient(q.x, q.y, 0, q.x, q.y, r);
        gr.addColorStop(0, hc(q.h, 95, (1 - p).toFixed(3))); gr.addColorStop(.4, hc(q.h, 62, ((1 - p) * .6).toFixed(3))); gr.addColorStop(1, hc(q.h, 55, 0));
        gx.fillStyle = gr; gx.beginPath(); gx.arc(q.x, q.y, r, 0, 6.2832); gx.fill();
      } else if (q.k === 'ring') {
        const r = 6 + q.r * (1 - Math.pow(1 - p, 3));
        gx.strokeStyle = hc(q.h, 75, ((1 - p) * .9).toFixed(3)); gx.lineWidth = 1.5 + (1 - p) * 5;
        gx.beginPath(); gx.arc(q.x, q.y, r, 0, 6.2832); gx.stroke();
      } else {
        const drag = Math.pow(.04, dt); q.vx *= drag; q.vy = q.vy * drag + 260 * dt;   // melambat + sedikit jatuh
        q.x += q.vx * dt; q.y += q.vy * dt;
        if (q.k === 'spark') {
          gx.strokeStyle = hc(q.h, 65 + (1 - p) * 25, (1 - p).toFixed(3)); gx.lineWidth = q.w * (1 - p * .6); gx.lineCap = 'round';
          gx.beginPath(); gx.moveTo(q.x, q.y); gx.lineTo(q.x - q.vx * .045, q.y - q.vy * .045); gx.stroke();
        } else {
          gx.fillStyle = hc(q.h, 75, (1 - p).toFixed(3)); star4(gx, q.x, q.y, q.r * (1 - p * .5), q.rot + q.age * 4); gx.fill();
        }
      }
    }
    gx.globalCompositeOperation = 'source-over';
    if (shots.length || parts.length || duets.length || duetOn) gRaf = requestAnimationFrame(gLoop);
    else { gRaf = 0; gx.clearRect(0, 0, window.innerWidth, window.innerHeight); }
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
  updateNetClass();
  connectLobby();
  setTimeout(() => { if (!fb) loadLibrary(); }, netUp() ? 2500 : 0);     // belum tersambung (offline / server lambat): tampilkan lagu yang tersimpan di perangkat
})();
