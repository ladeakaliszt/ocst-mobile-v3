const express = require('express');
const path    = require('path');
const https   = require('https');
const app     = express();
const PORT    = process.env.PORT || 3001;

// Gemini API key — Railway'de environment variable olarak tanımla:
// GEMINI_API_KEY=your_key_here
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── GEMİNİ PROXY ──────────────────────────────────────
// Frontend key görmez, tüm Gemini istekleri buradan geçer
app.post('/api/gemini', async (req, res) => {
  if (!GEMINI_KEY) {
    return res.status(500).json({ error: 'Gemini API key tanımlı değil.' });
  }

  const { contents, system_instruction, generationConfig } = req.body;

  const payload = JSON.stringify({
    system_instruction,
    contents,
    generationConfig: generationConfig || { temperature: 0.1, maxOutputTokens: 300 }
  });

  const options = {
    hostname: 'generativelanguage.googleapis.com',
    path:     `/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
    method:   'POST',
    headers:  {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const proxyReq = https.request(options, proxyRes => {
    let data = '';
    proxyRes.on('data', chunk => data += chunk);
    proxyRes.on('end', () => {
      try {
        res.json(JSON.parse(data));
      } catch {
        res.status(500).json({ error: 'Gemini yanıtı parse edilemedi.' });
      }
    });
  });

  proxyReq.on('error', err => {
    res.status(500).json({ error: err.message });
  });

  proxyReq.write(payload);
  proxyReq.end();
});

// ── SPA FALLBACK ───────────────────────────────────────
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`OCST Mobil: http://localhost:${PORT}`);
  if (!GEMINI_KEY) console.warn('⚠️  GEMINI_API_KEY environment variable tanımlı değil!');
});
