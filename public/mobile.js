/* ══════════════════════════════════════════════════════
   OCST MOBİL — mobile.js
══════════════════════════════════════════════════════ */

// Ana sunucu URL — mobil sitenin bağlanacağı Railway URL
const SERVER_URL = 'https://ocst-arsiv-database.up.railway.app';
const API_KEY    = 'OCSTMLBL2020';
const PANIC_HOLD = 1500; // ms — basılı tutma süresi

let username   = '';
let panicTimer = null;
let panicAnim  = null;
let panicStart = 0;
let gpsLat     = null;
let gpsLng     = null;
let myCalls    = [];

// ══════════════════════════════════════════════════════
// BAŞLANGIÇ
// ══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('ocst_mobile_username');
  if (saved) {
    username = saved;
    showMain();
  }

  // Enter ile devam
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
  document.getElementById('screen-name').style.display  = 'none';
  document.getElementById('screen-call').style.display  = 'none';
  document.getElementById('screen-sent').style.display  = 'none';
  document.getElementById('screen-main').style.display  = 'block';
  document.getElementById('mob-username').textContent   = username.toUpperCase();
  renderRecentCalls();
  connectWS();
}

function showCallForm() {
  document.getElementById('screen-main').style.display = 'none';
  document.getElementById('screen-call').style.display = 'block';
  document.getElementById('cf-title').value   = '';
  document.getElementById('cf-detail').value  = '';
  document.getElementById('cf-location').value = '';
  document.getElementById('cf-error').textContent = '';
  document.getElementById('cf-gps-status').textContent = '';
  gpsLat = null; gpsLng = null;
}

function showMain() {
  ['screen-name','screen-call','screen-sent'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById('screen-main').style.display = 'block';
  document.getElementById('mob-username').textContent  = username.toUpperCase();
  renderRecentCalls();
  connectWS();
}

function showSent() {
  ['screen-name','screen-call','screen-main'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById('screen-sent').style.display = 'block';
}

// ══════════════════════════════════════════════════════
// WEBSOCKET (durum göstergesi için)
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
    ws.onmessage = () => {}; // mobil sadece gönderir
  } catch { setWSDot(false); }
}

function setWSDot(ok) {
  const dot   = document.getElementById('mob-ws-dot');
  const label = document.getElementById('mob-ws-label');
  if (!dot || !label) return;
  dot.className   = ok ? 'ws-dot-green' : 'ws-dot-red';
  dot.textContent = '●';
  label.textContent   = ok ? 'CANLI BAĞLANTI' : 'BAĞLANIYOR...';
  label.style.color   = ok ? '#00cc44' : '#6a8aaa';
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
      triggerPanic();
    }
  }, 30);
}

function cancelPanicPress() {
  if (panicAnim) { clearInterval(panicAnim); panicAnim = null; }
  const btn    = document.getElementById('panic-btn');
  const circle = document.getElementById('panic-circle');
  btn.classList.remove('pressing');
  circle.style.strokeDashoffset = '339.3';
}

async function triggerPanic() {
  const statusEl = document.getElementById('panic-status');
  statusEl.textContent = 'PANİK GÖNDERİLİYOR...';
  statusEl.className   = 'panic-status sending';

  // GPS al
  let lat = null, lng = null, locStr = 'GPS alınamadı';
  try {
    const pos = await getPositionPromise();
    lat    = pos.coords.latitude;
    lng    = pos.coords.longitude;
    locStr = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch { locStr = 'Konum izni verilmedi'; }

  try {
    const res = await fetch(`${SERVER_URL}/api/calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({
        type:     'panic',
        title:    '🚨 PANİK BUTONU',
        detail:   '',
        location: locStr,
        lat, lng,
        author:   username
      })
    });
    const data = await res.json();
    if (data.success) {
      statusEl.textContent = '✅ PANİK GÖNDERİLDİ — MERKEZ BİLGİLENDİRİLDİ';
      statusEl.className   = 'panic-status sent';
      saveMyCalls({ type:'panic', title:'PANİK BUTONU', location:locStr, createdAt:Date.now() });
      setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'panic-status'; }, 6000);
    } else {
      throw new Error(data.error);
    }
  } catch (e) {
    statusEl.textContent = '❌ GÖNDERILEMEDI: ' + (e.message || 'Sunucu hatası');
    statusEl.className   = 'panic-status error';
    setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'panic-status'; }, 5000);
  }
}

// ══════════════════════════════════════════════════════
// GPS
// ══════════════════════════════════════════════════════
function getPositionPromise() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('GPS desteklenmiyor')); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 0 });
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({
        type: 'normal', title, detail,
        location: location || 'Belirtilmedi',
        lat: gpsLat, lng: gpsLng,
        author: username
      })
    });
    const data = await res.json();
    if (data.success) {
      saveMyCalls({ type:'normal', title, location: location||'Belirtilmedi', createdAt:Date.now() });
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
