const express    = require('express');
const session    = require('express-session');
const path       = require('path');
const fs         = require('fs');
const http       = require('http');
const nodemailer = require('nodemailer');
const { WebSocketServer } = require('ws');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });
const PORT   = process.env.PORT || 3000;

// ─── VERİ KLASÖRÜ ─────────────────────────────────────
const DATA_DIR      = process.env.DATA_DIR || path.join(__dirname, 'data');
const TOPICS_FILE   = path.join(DATA_DIR, 'topics.json');
const COMMENTS_FILE = path.join(DATA_DIR, 'comments.json');
const CALLS_FILE    = path.join(DATA_DIR, 'calls.json');
const DEVICES_FILE  = path.join(DATA_DIR, 'mobile_devices.json');
const BANNED_FILE   = path.join(DATA_DIR, 'banned_devices.json');

[DATA_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
[TOPICS_FILE, COMMENTS_FILE, CALLS_FILE, DEVICES_FILE, BANNED_FILE].forEach(f => {
  if (!fs.existsSync(f)) fs.writeFileSync(f, '[]');
});

// ─── YARDIMCILAR ──────────────────────────────────────
function readJSON(f)    { try { return JSON.parse(fs.readFileSync(f,'utf8')); } catch { return []; } }
function writeJSON(f,d) { fs.writeFileSync(f, JSON.stringify(d,null,2),'utf8'); }
function genId()        { return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

// ─── BİLDİRİM SABİTLERİ ───────────────────────────────
const DISCORD_WEBHOOK  = 'https://discord.com/api/webhooks/1466651197363454072/LbukP7UrHVqusJLzx7f7s1PMatzpB2L20h5LNT41NeUtLCRe9OMNc9rPlhh9_rrO_34S';
const GMAIL_USER       = 'ladebut619@gmail.com';
const GMAIL_PASSWORD   = 'uyeowgtypypdupqr';
const NOTIFY_EMAILS    = ['ladebut619@gmail.com'];

// ─── SABİT PERSONEL LİSTESİ ───────────────────────────
// İleride buraya yeni kişiler eklenebilir
const PERSONNEL_DB = [
  { username: 'lade', password: 'Mustafa-0808', role: 'admin' },
  // { username: 'yeni', password: 'sifre', role: 'operator' },
];

// ─── NODEMAILER ───────────────────────────────────────
const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_PASSWORD }
});

// ─── BİLDİRİM FONKSİYONLARI ──────────────────────────
async function sendDiscordNotify(call) {
  try {
    const isPanic = call.type === 'panic';
    const payload = {
      content: isPanic ? '@everyone 🚨 ACİL DURUM!' : null,
      embeds: [{
        title:  isPanic ? '🚨 PANİK BUTONU BASILDI' : '📞 YENİ ÇAĞRI',
        color:  isPanic ? 0xff2222 : 0x4a9eff,
        fields: [
          { name: 'Personel', value: call.author,              inline: true  },
          { name: 'Konum',    value: call.location || 'Belirtilmedi', inline: true },
          { name: 'Başlık',   value: call.title,               inline: false },
          ...(call.detail ? [{ name: 'Detay', value: call.detail, inline: false }] : []),
        ],
        footer:    { text: 'OCST Pager System' },
        timestamp: new Date().toISOString()
      }]
    };
    await fetch(DISCORD_WEBHOOK, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });
  } catch (e) { console.error('Discord bildirim hatası:', e.message); }
}

async function sendEmailNotify(call) {
  try {
    const isPanic = call.type === 'panic';
    const subject = isPanic ? '🚨 [OCST] PANİK BUTONU BASILDI' : `📞 [OCST] Yeni Çağrı: ${call.title}`;
    const html = `<div style="font-family:monospace;background:#0d1117;color:#c8d8e8;padding:24px;">
      <div style="font-size:20px;color:${isPanic?'#ff4444':'#4a9eff'};margin-bottom:16px;">${isPanic ? '🚨 PANİK' : '📞 YENİ ÇAĞRI'}</div>
      <table><tr><td style="color:#6a8aaa;width:100px;">PERSONEL</td><td>${call.author}</td></tr>
      <tr><td style="color:#6a8aaa;">BAŞLIK</td><td>${call.title}</td></tr>
      <tr><td style="color:#6a8aaa;">KONUM</td><td>${call.location || 'Belirtilmedi'}</td></tr></table></div>`;
    await mailer.sendMail({ from: `"OCST Pager" <${GMAIL_USER}>`, to: NOTIFY_EMAILS.join(', '), subject, html });
  } catch (e) { console.error('Gmail bildirim hatası:', e.message); }
}

async function sendNotifications(call) {
  await Promise.allSettled([sendDiscordNotify(call), sendEmailNotify(call)]);
}

// ─── AKTİF PERSONEL (bellek içi) ──────────────────────
const activePersonnel = new Map();

function broadcastPersonnel() {
  broadcast({ type: 'personnel_update', personnel: Array.from(activePersonnel.values()) });
}

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [k, v] of activePersonnel.entries()) {
    if (v.lastSeen < cutoff) activePersonnel.delete(k);
  }
  broadcastPersonnel();
}, 5 * 60 * 1000);

// ─── MOBİL CİHAZ YÖNETİMİ (bellek içi + kalıcı) ──────
// deviceId → { deviceId, username, firstSeen, lastSeen, lat, lng, locationActive }
const mobileDevices = new Map();

// Başlangıçta dosyadan yükle (sunucu yeniden başladığında cihazlar kaybolmasın)
(function loadDevices() {
  try {
    const saved = readJSON(DEVICES_FILE);
    if (Array.isArray(saved)) {
      saved.forEach(d => {
        // Konum bilgisini sıfırla — sunucu kapanmışsa konum artık geçersiz
        mobileDevices.set(d.deviceId, { ...d, locationActive: false, lat: null, lng: null, locUpdatedAt: null });
      });
    }
  } catch {}
})();

// Her 60sn'de cihaz listesini dosyaya kaydet
setInterval(() => {
  try { writeJSON(DEVICES_FILE, Array.from(mobileDevices.values())); } catch {}
}, 60000);

function broadcastMobileDevices() {
  const list = Array.from(mobileDevices.values()).map(d => ({
    ...d,
    // lat/lng sadece locationActive=true ise gönder (gizlilik)
    lat: d.locationActive ? d.lat : null,
    lng: d.locationActive ? d.lng : null,
  }));
  broadcast({ type: 'mobile_devices_update', devices: list });
}

// ─── WEBSOCKET ────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

wss.on('connection', (ws) => {
  const calls = readJSON(CALLS_FILE).slice(-50).reverse();
  ws.send(JSON.stringify({ type: 'init_calls', calls }));
  ws.send(JSON.stringify({ type: 'personnel_update', personnel: Array.from(activePersonnel.values()) }));
  ws.send(JSON.stringify({
    type: 'mobile_devices_update',
    devices: Array.from(mobileDevices.values()).map(d => ({
      ...d,
      lat: d.locationActive ? d.lat : null,
      lng: d.locationActive ? d.lng : null,
    }))
  }));
  ws.on('error', () => {});
});

// ─── SABİTLER ─────────────────────────────────────────
const SITE_PASSWORD   = 'OCSTARŞİV2020';   // Arşiv uygulaması şifresi (legacy)
const DELETE_PASSWORD = '080808';
const MOBILE_KEY      = 'OCSTMLBL2020';
const MENUS = ['kayitlar','kisiler','ek-dosyalar','gorseller'];

// ─── MİDDLEWARE ───────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'ocst-desktop-2020',
  resave: false, saveUninitialized: false,
  cookie: { maxAge: 1000*60*60*8 }
}));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,x-api-key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── STATİK ───────────────────────────────────────────
app.use('/',      express.static(path.join(__dirname, 'public')));
app.use('/arsiv', express.static(path.join(__dirname, 'arsiv-public')));
app.get('/arsiv',  (_,res) => res.sendFile(path.join(__dirname,'arsiv-public','index.html')));
app.get('/arsiv/', (_,res) => res.sendFile(path.join(__dirname,'arsiv-public','index.html')));

// ─── AUTH ──────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  if (req.headers['x-api-key'] === MOBILE_KEY) return next();
  res.status(401).json({ error: 'Yetkisiz.' });
}

function requireDesktopAuth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  res.status(401).json({ error: 'Yetkisiz.' });
}

// ─── DESKTOP GİRİŞ — SABİT PERSONEL ──────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !username.trim()) return res.json({ success:false, message:'Kullanıcı adı boş.' });

  const person = PERSONNEL_DB.find(p => p.username === username.trim() && p.password === password);
  if (!person) return res.json({ success:false, message:'Kullanıcı adı veya şifre hatalı.' });

  req.session.loggedIn  = true;
  req.session.username  = person.username;
  req.session.role      = person.role;
  req.session.sessionId = genId();

  activePersonnel.set(person.username, {
    username:  person.username,
    loginAt:   Date.now(),
    lastSeen:  Date.now(),
    sessionId: req.session.sessionId,
    role:      person.role,
  });
  broadcastPersonnel();
  res.json({ success:true, username: person.username, role: person.role });
});

// Arşiv için legacy login (tek şifre) — arşiv app.js kullanır
app.post('/api/arsiv-login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !username.trim()) return res.json({ success:false, message:'Kullanıcı adı boş.' });
  if (password !== SITE_PASSWORD)   return res.json({ success:false, message:'Hatalı şifre.' });
  req.session.loggedIn  = true;
  req.session.username  = username.trim();
  req.session.sessionId = genId();
  res.json({ success:true, username: username.trim() });
});

app.post('/api/logout', (req, res) => {
  if (req.session && req.session.username) {
    activePersonnel.delete(req.session.username);
    broadcastPersonnel();
  }
  req.session.destroy();
  res.json({ success:true });
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.loggedIn) {
    const p = activePersonnel.get(req.session.username);
    if (p) { p.lastSeen = Date.now(); activePersonnel.set(req.session.username, p); }
    return res.json({ loggedIn:true, username:req.session.username, role:req.session.role });
  }
  res.json({ loggedIn:false });
});

app.post('/api/heartbeat', (req, res) => {
  if (req.session && req.session.loggedIn) {
    const p = activePersonnel.get(req.session.username);
    if (p) { p.lastSeen = Date.now(); activePersonnel.set(req.session.username, p); }
  }
  res.json({ ok: true });
});

// ─── PERSONEL ─────────────────────────────────────────
app.get('/api/personnel', requireAuth, (req, res) => {
  res.json(Array.from(activePersonnel.values()));
});

// ─── MOBİL CİHAZ KAYIT / KONUM ────────────────────────

// Mobil uygulama açıldığında cihazı kaydet/güncelle
app.post('/api/mobile/register', (req, res) => {
  if (req.headers['x-api-key'] !== MOBILE_KEY) return res.status(401).json({ error:'Yetkisiz.' });
  const { deviceId, username } = req.body;
  if (!deviceId || !username) return res.status(400).json({ error:'Eksik alan.' });

  const banned = readJSON(BANNED_FILE);
  if (banned.includes(deviceId)) return res.status(403).json({ error:'Bu cihaz engellenmiş.', banned:true });

  const existing = mobileDevices.get(deviceId) || {};
  const device = {
    deviceId,
    username,
    firstSeen:      existing.firstSeen || Date.now(),
    lastSeen:       Date.now(),
    locationActive: existing.locationActive || false,
    lat:            existing.lat || null,
    lng:            existing.lng || null,
    locUpdatedAt:   existing.locUpdatedAt || null,
  };
  mobileDevices.set(deviceId, device);
  broadcastMobileDevices();
  res.json({ success:true });
});

// Konum güncelle (konum tuşu açıksa 30sn'de bir çağrılır)
app.post('/api/mobile/location', (req, res) => {
  if (req.headers['x-api-key'] !== MOBILE_KEY) return res.status(401).json({ error:'Yetkisiz.' });
  const { deviceId, lat, lng, active } = req.body;
  if (!deviceId) return res.status(400).json({ error:'deviceId eksik.' });

  const banned = readJSON(BANNED_FILE);
  if (banned.includes(deviceId)) return res.status(403).json({ error:'Engellenmiş.', banned:true });

  const device = mobileDevices.get(deviceId);
  if (!device) return res.status(404).json({ error:'Cihaz kayıtlı değil.' });

  device.locationActive = !!active;
  device.lastSeen       = Date.now();
  if (active && lat !== undefined && lng !== undefined) {
    device.lat          = lat;
    device.lng          = lng;
    device.locUpdatedAt = Date.now();
  } else if (!active) {
    // Konum kapatıldı — koordinatları sil
    device.lat          = null;
    device.lng          = null;
    device.locUpdatedAt = null;
  }
  mobileDevices.set(deviceId, device);
  broadcastMobileDevices();
  res.json({ success:true });
});

// Tüm mobil cihazları listele (sadece desktop auth)
app.get('/api/mobile/devices', requireDesktopAuth, (req, res) => {
  const devices = Array.from(mobileDevices.values()).map(d => ({
    ...d,
    lat: d.locationActive ? d.lat : null,
    lng: d.locationActive ? d.lng : null,
  }));
  res.json(devices);
});

// Cihazı sil (PC'den)
app.delete('/api/mobile/device/:deviceId', requireDesktopAuth, (req, res) => {
  const { deviceId } = req.params;
  if (!mobileDevices.has(deviceId)) return res.status(404).json({ error:'Cihaz bulunamadı.' });
  mobileDevices.delete(deviceId);
  broadcastMobileDevices();
  res.json({ success:true });
});

// Cihazı engelle (PC'den)
app.post('/api/mobile/ban/:deviceId', requireDesktopAuth, (req, res) => {
  const { deviceId } = req.params;
  const banned = readJSON(BANNED_FILE);
  if (!banned.includes(deviceId)) {
    banned.push(deviceId);
    writeJSON(BANNED_FILE, banned);
  }
  mobileDevices.delete(deviceId);
  broadcastMobileDevices();
  res.json({ success:true });
});

// Engeli kaldır
app.post('/api/mobile/unban/:deviceId', requireDesktopAuth, (req, res) => {
  const { deviceId } = req.params;
  let banned = readJSON(BANNED_FILE);
  banned = banned.filter(id => id !== deviceId);
  writeJSON(BANNED_FILE, banned);
  res.json({ success:true });
});

// Engelli cihaz listesi
app.get('/api/mobile/banned', requireDesktopAuth, (req, res) => {
  res.json(readJSON(BANNED_FILE));
});

// ─── ÇAĞRILAR ─────────────────────────────────────────
app.get('/api/calls', requireAuth, (req, res) => {
  const calls = readJSON(CALLS_FILE).slice(-100).reverse();
  res.json(calls);
});

app.get('/api/call/:id', requireAuth, (req, res) => {
  const call = readJSON(CALLS_FILE).find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Çağrı bulunamadı.' });
  res.json(call);
});

app.post('/api/calls', async (req, res) => {
  const isMobile  = req.headers['x-api-key'] === MOBILE_KEY;
  const isDesktop = req.session && req.session.loggedIn;
  if (!isMobile && !isDesktop) return res.status(401).json({ error: 'Yetkisiz.' });

  // Engel kontrolü
  if (isMobile && req.body.deviceId) {
    const banned = readJSON(BANNED_FILE);
    if (banned.includes(req.body.deviceId)) return res.status(403).json({ error:'Engellenmiş.', banned:true });
  }

  const { type, title, detail, location, lat, lng, author } = req.body;
  if (!type)   return res.status(400).json({ error: 'Tür eksik.' });
  if (!author) return res.status(400).json({ error: 'Yazar eksik.' });

  const calls   = readJSON(CALLS_FILE);
  const newCall = {
    id:         genId(),
    type,
    title:      title    || (type === 'panic' ? '🚨 PANİK BUTONU' : 'Çağrı'),
    detail:     detail   || '',
    location:   location || 'Konum belirtilmedi',
    lat:        lat  || null,
    lng:        lng  || null,
    author,
    assignedTo: null,
    status:     'bekliyor',
    notes:      [],
    createdAt:  Date.now()
  };
  calls.push(newCall);
  writeJSON(CALLS_FILE, calls);
  broadcast({ type: 'new_call', call: newCall });
  sendNotifications(newCall);
  res.json({ success:true, id: newCall.id });
});

app.post('/api/call/:id/status', requireAuth, (req, res) => {
  const { status, note } = req.body;
  const valid = ['bekliyor','yanitlandi','kapatildi'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Geçersiz durum.' });
  const calls = readJSON(CALLS_FILE);
  const idx   = calls.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Çağrı bulunamadı.' });
  calls[idx].status    = status;
  calls[idx].updatedAt = Date.now();
  if (note && note.trim()) {
    if (!calls[idx].notes) calls[idx].notes = [];
    calls[idx].notes.push({ text: note.trim(), by: req.session.username || 'Sistem', at: Date.now() });
  }
  writeJSON(CALLS_FILE, calls);
  broadcast({ type: 'update_call', call: calls[idx] });
  res.json({ success:true });
});

app.post('/api/call/:id/assign', requireAuth, (req, res) => {
  const { assignTo } = req.body;
  const calls = readJSON(CALLS_FILE);
  const idx   = calls.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Çağrı bulunamadı.' });
  calls[idx].assignedTo = assignTo || null;
  calls[idx].updatedAt  = Date.now();
  if (!calls[idx].notes) calls[idx].notes = [];
  calls[idx].notes.push({ text: assignTo ? `${assignTo} çağrıya atandı.` : 'Atama kaldırıldı.', by: req.session.username || 'Sistem', at: Date.now() });
  writeJSON(CALLS_FILE, calls);
  broadcast({ type: 'update_call', call: calls[idx] });
  res.json({ success:true });
});

app.delete('/api/call/:id', requireAuth, (req, res) => {
  if (req.body.deletePassword !== DELETE_PASSWORD)
    return res.status(403).json({ error: 'Şifre hatalı.' });
  let calls = readJSON(CALLS_FILE);
  if (!calls.find(c => c.id === req.params.id))
    return res.status(404).json({ error: 'Çağrı bulunamadı.' });
  calls = calls.filter(c => c.id !== req.params.id);
  writeJSON(CALLS_FILE, calls);
  broadcast({ type: 'delete_call', id: req.params.id });
  res.json({ success:true });
});

// ─── ARŞİV KONULARI ───────────────────────────────────
app.get('/api/topics/:menu', requireAuth, (req, res) => {
  const { menu } = req.params;
  if (!MENUS.includes(menu)) return res.status(400).json({ error: 'Geçersiz menü.' });
  const comments = readJSON(COMMENTS_FILE);
  const topics   = readJSON(TOPICS_FILE)
    .filter(t => t.menu === menu)
    .sort((a,b) => b.createdAt - a.createdAt)
    .map(t => ({ ...t, commentCount: comments.filter(c => c.topicId===t.id).length }));
  res.json(topics);
});

app.get('/api/topic/:id', requireAuth, (req, res) => {
  const t = readJSON(TOPICS_FILE).find(t => t.id===req.params.id);
  if (!t) return res.status(404).json({ error: 'Konu bulunamadı.' });
  res.json(t);
});

app.post('/api/topics', requireAuth, (req, res) => {
  const { menu, title, content, tag } = req.body;
  if (!MENUS.includes(menu))       return res.status(400).json({ error: 'Geçersiz menü.' });
  if (!title   || !title.trim())   return res.status(400).json({ error: 'Başlık boş.' });
  if (!content || !content.trim()) return res.status(400).json({ error: 'İçerik boş.' });
  const topics = readJSON(TOPICS_FILE);
  const t = { id:genId(), menu, title:title.trim(), content:content.trim(), tag:tag||'', author:req.session.username, createdAt:Date.now() };
  topics.push(t);
  writeJSON(TOPICS_FILE, topics);
  res.json({ success:true, id:t.id });
});

app.delete('/api/topic/:id', requireAuth, (req, res) => {
  if (req.body.deletePassword !== DELETE_PASSWORD) return res.status(403).json({ error: 'Şifre hatalı.' });
  let topics = readJSON(TOPICS_FILE);
  if (!topics.find(t => t.id===req.params.id)) return res.status(404).json({ error: 'Konu bulunamadı.' });
  writeJSON(TOPICS_FILE, topics.filter(t => t.id!==req.params.id));
  writeJSON(COMMENTS_FILE, readJSON(COMMENTS_FILE).filter(c => c.topicId!==req.params.id));
  res.json({ success:true });
});

// ─── YORUMLAR ─────────────────────────────────────────
app.get('/api/comments/:topicId', requireAuth, (req, res) => {
  res.json(readJSON(COMMENTS_FILE).filter(c=>c.topicId===req.params.topicId).sort((a,b)=>a.createdAt-b.createdAt));
});

app.post('/api/comments', requireAuth, (req, res) => {
  const { topicId, content } = req.body;
  if (!topicId || !content || !content.trim()) return res.status(400).json({ error: 'Eksik alan.' });
  const comments = readJSON(COMMENTS_FILE);
  const c = { id:genId(), topicId, content:content.trim(), author:req.session.username, createdAt:Date.now() };
  comments.push(c);
  writeJSON(COMMENTS_FILE, comments);
  res.json({ success:true, id:c.id });
});

app.delete('/api/comment/:id', requireAuth, (req, res) => {
  if (req.body.deletePassword !== DELETE_PASSWORD) return res.status(403).json({ error: 'Şifre hatalı.' });
  let comments = readJSON(COMMENTS_FILE);
  if (!comments.find(c=>c.id===req.params.id)) return res.status(404).json({ error: 'Yorum bulunamadı.' });
  writeJSON(COMMENTS_FILE, comments.filter(c=>c.id!==req.params.id));
  res.json({ success:true });
});

// ─── BAŞLAT ───────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║   OCST BİLGİ SİSTEMLERİ v4.3         ║`);
  console.log(`║   http://localhost:${PORT}              ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
  if (PERSONNEL_DB.length) {
    console.log('Tanımlı personel:', PERSONNEL_DB.map(p=>p.username).join(', '));
  }
});
