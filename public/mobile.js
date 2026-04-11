/* ══════════════════════════════════════════════════════
   OCST MOBİL — mobile.js  v2.0
   Panik + Sesli Komut + Kod Butonları + SMS
══════════════════════════════════════════════════════ */

// ── YAPILANDIRMA ──────────────────────────────────────
const SERVER_URL  = 'https://ocst-arsiv-database.up.railway.app';
const API_KEY     = 'OCSTMLBL2020';
const PANIC_HOLD  = 300;   // ms — 0.3 saniye

// 112 SMS numarası
const SMS_NUMBER  = '113';

// ── ACİL KOD TANIMLAMALARI ───────────────────────────
const EMERGENCY_CODES = {
  '90':  { label: 'Trafik kazası',            title: 'KOD 90 — TRAFİK KAZASI' },
  '90A': { label: 'Kaza — tek yaralı',        title: 'KOD 90A — TRAFİK KAZASI' },
  '90B': { label: 'Kaza — 3+ yaralı',         title: 'KOD 90B — ÇOKLU YARALILI KAZA' },
  '91':  { label: 'Kavga',                    title: 'KOD 91 — KAVGA' },
  '91A': { label: 'Kavga — yaralı var',       title: 'KOD 91A — KAVGA / YARALI' },
  '91B': { label: 'Kavga — kalabalık',        title: 'KOD 91B — KALABALIK KAVGA' },
  '92':  { label: 'Kavga — kesici alet',      title: 'KOD 92 — KESİCİ DELİCİ ALET' },
  '93':  { label: 'Kavga — ateşli silah',     title: 'KOD 93 — ATEŞLİ SİLAH' },
  '94':  { label: 'Silahlı çatışma',          title: 'KOD 94 — SİLAHLI ÇATIŞMA' },
  '95':  { label: 'Bayılma / travma',         title: 'KOD 95 — BAYILMA / TRAVMA' },
  '99':  { label: 'Takip edilme',             title: 'KOD 99 — TAKİP' },
};

// SMS mesajları: konum placeholder'ları sonradan doldurulur
function buildSmsBody(code, locStr, mapsLink, coords) {
  const loc = `Konum: ${locStr}. Koordinat: ${coords}. Harita: ${mapsLink}`;
  const msgs = {
    '90':  `Acil durum. Trafik kazası yaşandı. ${loc}`,
    '90A': `Acil durum. Trafik kazası yaşandı. Tek bir yaralı var. ${loc}`,
    '90B': `Acil durum. Burada büyük bir trafik kazası yaşandı. 3'ten fazla yaralı var. ${loc}`,
    '91':  `Acil durum. Burada bir kavga yaşanıyor şu an. ${loc}`,
    '91A': `Acil durum. Burada bir kavga yaşanıyor şu an, yaralı var. ${loc}`,
    '91B': `Acil durum. Burada kalabalık bir grup şu an kavga ediyor. ${loc}`,
    '92':  `Acil durum. Burada bir kavga yaşanıyor şu an. Taraflarda kesici ve delici alet var. ${loc}`,
    '93':  `Acil durum. Burada bir kavga yaşanıyor şu an. Taraflarda ateşli silah bulunuyor. ${loc}`,
    '94':  `Acil durum. Silahlı çatışma yaşanıyor. Tehlikedeyiz. ${loc}`,
    '95':  `Acil durum. Burada bilincini kaybeden birisi var. Lütfen konuma acil sağlık yönlendirin. Mağdur ile ilgili bilgi için lütfen bu telefon numarasına geri dönüş yapın. ${loc}`,
    '99':  `Acil durum. Şu an takip ediliyorum, tehlikedeyim. Lütfen konuma polis yönlendirin. ${loc}`,
  };
  return msgs[code] || `Acil durum. Kod: ${code}. ${loc}`;
}

// Sesli komuttan kod çözme (90-99 arası, A/B alt kodlar dahil)
function parseVoiceCode(transcript) {
  const t = transcript.replace(/\s/g, '').toUpperCase();
  // Sırayla en özgül eşleşmeler
  const patterns = [
    { re: /90[AB]/,  fn: m => m[0] },
    { re: /91[AB]/,  fn: m => m[0] },
    { re: /9[0-9]/,  fn: m => m[0] },
  ];
  for (const p of patterns) {
    const m = t.match(p.re);
    if (m) return p.fn(m);
  }
  // Yazılı sayı desteği (Türkçe): doksan dokuz, doksan vb.
  const wordMap = {
    'DOKSANSEKIZ': '98', 'DOKSANDOKUZ': '99', 'DOKSANYEDI': '97',
    'DOKSANALTI': '96', 'DOKSANBEŞ': '95', 'DOKSANDÖRT': '94',
    'DOKSANÜÇ': '93',   'DOKSANIKI': '92',  'DOKUZONU': '91',
    'DOKSAN': '90',
  };
  for (const [word, code] of Object.entries(wordMap)) {
    if (t.includes(word)) return code;
  }
  return null;
}

// ── STATE ─────────────────────────────────────────────
let username      = '';
let panicTimer    = null;
let panicAnim     = null;
let panicStart    = 0;
let gpsLat        = null;
let gpsLng        = null;
let myCalls       = [];
let selectedCode  = null;   // seçili acil kod
let recognition   = null;   // SpeechRecognition instance
let voiceActive   = false;

// ══════════════════════════════════════════════════════
// BAŞLANGIÇ
// ══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('ocst_mobile_username');
  if (saved) { username = saved; showMain(); }

  document.getElementById('name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveName();
  });
});

function saveName() {
  const val = document.getElementById('name-input').value.trim();
  if (!val) { document.getElementById('name-error').textContent = '► Ad boş olamaz'; return; }
  username = val;
  localStorage.setItem('ocst_mobile_username', val);
  showMain();
}

// ══════════════════════════════════════════════════════
// EKRANLAR
// ══════════════════════════════════════════════════════
function showMain() {
  ['screen-name','screen-call','screen-sent'].forEach(id =>
    document.getElementById(id).style.display = 'none'
  );
  document.getElementById('screen-main').style.display = 'block';
  document.getElementById('mob-username').textContent   = username.toUpperCase();
  renderRecentCalls();
  connectWS();
}

function showCallForm() {
  document.getElementById('screen-main').style.display = 'none';
  document.getElementById('screen-call').style.display = 'block';
  document.getElementById('cf-title').value    = '';
  document.getElementById('cf-detail').value   = '';
  document.getElementById('cf-location').value = '';
  document.getElementById('cf-error').textContent      = '';
  document.getElementById('cf-gps-status').textContent = '';
  gpsLat = null; gpsLng = null;
}

function showSent() {
  ['screen-name','screen-call','screen-main'].forEach(id =>
    document.getElementById(id).style.display = 'none'
  );
  document.getElementById('screen-sent').style.display = 'block';
}

// ══════════════════════════════════════════════════════
// KOD BUTON SEÇİMİ
// ══════════════════════════════════════════════════════
function toggleCode(btn, code) {
  const allBtns = document.querySelectorAll('.code-btn');
  const panicBtn = document.getElementById('panic-btn');
  const subtextEl = document.getElementById('panic-subtext');
  const hintEl    = document.getElementById('panic-hint');
  const labelEl   = document.getElementById('selected-code-label');

  if (selectedCode === code) {
    // Seçimi kaldır
    selectedCode = null;
    allBtns.forEach(b => b.classList.remove('selected'));
    panicBtn.classList.remove('code-ready');
    subtextEl.textContent = 'BASMAK İÇİN TIKLAYIP TUTUN';
    hintEl.textContent    = '0.3 saniye basılı tutun';
    labelEl.textContent   = '';
  } else {
    // Yeni seç
    selectedCode = code;
    allBtns.forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    panicBtn.classList.add('code-ready');
    const info = EMERGENCY_CODES[code];
    subtextEl.textContent = `KOD ${code} SEÇİLİ`;
    hintEl.textContent    = '0.3 saniye → direkt SMS';
    labelEl.textContent   = info ? `► ${info.label}` : '';
  }
}

// ══════════════════════════════════════════════════════
// PANİK BUTONU
// ══════════════════════════════════════════════════════
function startPanicPress() {
  const btn    = document.getElementById('panic-btn');
  const circle = document.getElementById('panic-circle');
  const total  = 339.3;

  btn.classList.add('pressing');
  panicStart = Date.now();

  panicAnim = setInterval(() => {
    const elapsed  = Date.now() - panicStart;
    const progress = Math.min(elapsed / PANIC_HOLD, 1);
    circle.style.strokeDashoffset = total * (1 - progress);

    if (progress >= 1) {
      cancelPanicPress();
      onPanicFired();
    }
  }, 16);
}

function cancelPanicPress() {
  if (panicAnim) { clearInterval(panicAnim); panicAnim = null; }
  const btn    = document.getElementById('panic-btn');
  const circle = document.getElementById('panic-circle');
  btn.classList.remove('pressing');
  circle.style.strokeDashoffset = '339.3';
}

async function onPanicFired() {
  if (selectedCode) {
    // Kod seçili → konum al, direkt SMS
    await sendEmergencySms(selectedCode);
  } else {
    // Kod seçili değil → sesli komut
    startVoiceRecognition();
  }
}

// ══════════════════════════════════════════════════════
// SES TANIMA (Web Speech API)
// ══════════════════════════════════════════════════════
function startVoiceRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    // Tarayıcı desteklemiyorsa kullanıcıya sor
    const code = prompt('Tarayıcınız mikrofonu desteklemiyor.\nAcil kodunuzu girin (90-99):');
    if (code && EMERGENCY_CODES[code.trim().toUpperCase()]) {
      sendEmergencySms(code.trim().toUpperCase());
    }
    return;
  }

  document.getElementById('voice-overlay').style.display = 'flex';
  voiceActive = true;

  recognition = new SpeechRec();
  recognition.lang = 'tr-TR';
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 5;

  const transcriptEl = document.getElementById('voice-transcript');

  recognition.onresult = (e) => {
    let interim = '';
    let final   = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t;
    }

    const current = (final || interim).trim();
    transcriptEl.textContent = current;

    // Kod algılandı mı?
    const code = parseVoiceCode(current);
    if (code && EMERGENCY_CODES[code]) {
      transcriptEl.textContent = `✓ KOD ${code}`;
      setTimeout(() => {
        cancelVoice();
        sendEmergencySms(code);
      }, 400);
    }
  };

  recognition.onerror = (e) => {
    if (e.error !== 'aborted') {
      cancelVoice();
      document.getElementById('panic-status').textContent = '❌ Mikrofon hatası: ' + e.error;
      document.getElementById('panic-status').className   = 'panic-status error';
    }
  };

  recognition.onend = () => {
    if (voiceActive) {
      // Kod algılanmadı, yeniden dene
      try { recognition.start(); } catch {}
    }
  };

  recognition.start();
}

function cancelVoice() {
  voiceActive = false;
  document.getElementById('voice-overlay').style.display = 'none';
  if (recognition) { try { recognition.stop(); } catch {} recognition = null; }
}

// ══════════════════════════════════════════════════════
// SMS GÖNDER (konum al + taslak oluştur + SMS uygulamasını aç)
// ══════════════════════════════════════════════════════
async function sendEmergencySms(code) {
  const statusEl = document.getElementById('panic-status');
  statusEl.textContent = '📍 KONUM ALIYOR...';
  statusEl.className   = 'panic-status sending';

  let lat = null, lng = null;
  let locStr   = 'Konum alınamadı';
  let coords   = 'N/A';
  let mapsLink = 'https://maps.google.com';

  try {
    const pos = await getPositionPromise();
    lat = pos.coords.latitude;
    lng = pos.coords.longitude;

    // Tersine geocode (adres bilgisi)
    locStr   = await reverseGeocode(lat, lng);
    coords   = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    mapsLink = `https://maps.google.com/?q=${lat},${lng}`;
  } catch {
    locStr = 'Konum izni verilmedi';
  }

  // SMS gövdesi
  const body = buildSmsBody(code, locStr, mapsLink, coords);

  // PC sunucusuna da gönder
  sendToServer(code, locStr, lat, lng, body);

  // SMS uygulamasını aç
  const smsUri = `sms:${SMS_NUMBER}?body=${encodeURIComponent(body)}`;
  window.location.href = smsUri;

  // Status güncelle
  statusEl.textContent = `✅ KOD ${code} — SMS UYGULAMASI AÇILDI`;
  statusEl.className   = 'panic-status sent';
  saveMyCalls({ type:'panic', title:`PANİK KOD ${code}`, location: locStr, createdAt: Date.now() });
  setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'panic-status'; }, 8000);
}

// ══════════════════════════════════════════════════════
// TERSINE GEOCODE (OpenStreetMap Nominatim — ücretsiz)
// ══════════════════════════════════════════════════════
async function reverseGeocode(lat, lng) {
  try {
    const url  = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=tr&zoom=18&addressdetails=1`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'tr', 'User-Agent': 'OCST-Mobil/1.0' } });
    const data = await res.json();
    const a    = data.address || {};

    // İl — province veya state (city degil, Istanbul'da city de "Istanbul" donuyor)
    const il = a.province || a.state || '';

    // Ilce — Istanbul'da 'town' doner (Fatih, Besiktas vb.), diger sehirlerde district/county
    const ilce = a.town || a.city_district || a.district || a.county || a.municipality || '';

    // Mahalle/semt
    const mahalle = a.suburb || a.neighbourhood || a.quarter || a.hamlet || '';

    // Cadde/sokak
    const cadde = a.road || a.pedestrian || a.footway || a.street || '';

    const parts = [];
    if (il)      parts.push(il);
    if (ilce)    parts.push(ilce);
    if (mahalle) parts.push(mahalle);
    if (cadde)   parts.push(cadde);

    return parts.length
      ? parts.join(' / ')
      : (data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

// ══════════════════════════════════════════════════════
// PC SUNUCUSUNA GÖNDERİM
// ══════════════════════════════════════════════════════
async function sendToServer(code, locStr, lat, lng, smsBody) {
  try {
    const info  = EMERGENCY_CODES[code] || { title: `KOD ${code}` };
    await fetch(`${SERVER_URL}/api/calls`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body:    JSON.stringify({
        type:     'panic',
        title:    `🚨 ${info.title}`,
        detail:   smsBody,
        location: locStr,
        lat, lng,
        author:   username,
        code:     code,
      })
    });
  } catch {
    // Sunucu hatası SMS akışını engellemesin
  }
}

// ══════════════════════════════════════════════════════
// GPS
// ══════════════════════════════════════════════════════
function getPositionPromise() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('GPS desteklenmiyor')); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      timeout: 8000, maximumAge: 0, enableHighAccuracy: true
    });
  });
}

async function getGPS(prefix) {
  const statusEl = document.getElementById(`${prefix}-gps-status`);
  statusEl.textContent = '📍 Konum alınıyor...';
  try {
    const pos = await getPositionPromise();
    gpsLat = pos.coords.latitude;
    gpsLng = pos.coords.longitude;
    const locStr = `${gpsLat.toFixed(5)}, ${gpsLng.toFixed(5)}`;
    document.getElementById(`${prefix}-location`).value = locStr;
    statusEl.textContent = '✅ Konum alındı';
    statusEl.style.color = '#00cc44';
  } catch {
    statusEl.textContent = '❌ Konum alınamadı — izin verin veya manuel girin';
    statusEl.style.color = '#ff4444';
  }
}

// ══════════════════════════════════════════════════════
// WEBSOCKET
// ══════════════════════════════════════════════════════
let ws = null;
function connectWS() {
  if (ws) return;
  try {
    const proto = SERVER_URL.startsWith('https') ? 'wss' : 'ws';
    const host  = SERVER_URL.replace(/^https?:\/\//, '');
    ws = new WebSocket(`${proto}://${host}`);
    ws.onopen  = () => setWSDot(true);
    ws.onclose = () => { setWSDot(false); ws = null; setTimeout(connectWS, 5000); };
    ws.onerror = () => { setWSDot(false); };
    ws.onmessage = () => {};
  } catch { setWSDot(false); }
}

function setWSDot(ok) {
  const dot   = document.getElementById('mob-ws-dot');
  const label = document.getElementById('mob-ws-label');
  if (!dot || !label) return;
  dot.className     = ok ? 'ws-dot-green' : 'ws-dot-red';
  dot.textContent   = '●';
  label.textContent = ok ? 'CANLI BAĞLANTI' : 'BAĞLANIYOR...';
  label.style.color = ok ? '#00cc44' : '#6a8aaa';
}

// ══════════════════════════════════════════════════════
// NORMAL ÇAĞRI GÖNDER
// ══════════════════════════════════════════════════════
async function submitCall() {
  const title    = document.getElementById('cf-title').value.trim();
  const detail   = document.getElementById('cf-detail').value.trim();
  const location = document.getElementById('cf-location').value.trim();
  const errEl    = document.getElementById('cf-error');
  errEl.textContent = '';

  if (!title) { errEl.textContent = '► Başlık zorunludur'; return; }

  try {
    const res = await fetch(`${SERVER_URL}/api/calls`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body:    JSON.stringify({
        type: 'normal', title, detail,
        location: location || 'Belirtilmedi',
        lat: gpsLat, lng: gpsLng,
        author: username
      })
    });
    const data = await res.json();
    if (data.success) {
      saveMyCalls({ type:'normal', title, location: location||'Belirtilmedi', createdAt: Date.now() });
      showSent();
    } else {
      errEl.textContent = '► ' + (data.error || 'Gönderilemedi');
    }
  } catch {
    errEl.textContent = '► Sunucu bağlantı hatası';
  }
}

// ══════════════════════════════════════════════════════
// SON ÇAĞRILAR (localStorage)
// ══════════════════════════════════════════════════════
function saveMyCalls(call) {
  const saved = JSON.parse(localStorage.getItem('ocst_my_calls') || '[]');
  saved.unshift(call);
  if (saved.length > 10) saved.pop();
  localStorage.setItem('ocst_my_calls', JSON.stringify(saved));
  myCalls = saved;
}

function renderRecentCalls() {
  myCalls = JSON.parse(localStorage.getItem('ocst_my_calls') || '[]');
  const el = document.getElementById('recent-calls');
  if (!myCalls.length) {
    el.innerHTML = '<div style="font-size:11px;color:#4a6a8a;padding:8px 0">► Henüz çağrı gönderilmedi.</div>';
    return;
  }
  el.innerHTML = myCalls.slice(0,5).map(c => {
    const isPanic = c.type === 'panic';
    const time    = formatTime(c.createdAt);
    return `<div class="recent-item ${isPanic?'ri-panic':''}">
      <div class="ri-title">${isPanic?'🚨 ':''} ${escH(c.title)}</div>
      <div class="ri-meta">${escH(c.location)} · ${time}</div>
    </div>`;
  }).join('');
}

function formatTime(ts) {
  if (!ts) return '---';
  const d = new Date(ts), p = n => String(n).padStart(2,'0');
  return `${p(d.getDate())}.${p(d.getMonth()+1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function escH(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
