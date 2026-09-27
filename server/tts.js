// Speechify voices for the game's characters. The API key stays on the server;
// the browser posts a line of text + a character and gets back an mp3.
// Everything is gated on SPEECHIFY_API_KEY — without it the client just uses
// the browser's built-in voices.

const KEY = process.env.SPEECHIFY_API_KEY || '';
const BASE = process.env.SPEECHIFY_API_URL || 'https://api.speechify.ai';

// character -> Speechify voice id (override any with SPEECHIFY_VOICE_<NAME>)
const CAST = {
  dispatch: process.env.SPEECHIFY_VOICE_DISPATCH || 'henry',
  spy: process.env.SPEECHIFY_VOICE_SPY || 'sabrina',
  grounded: process.env.SPEECHIFY_VOICE_GROUNDED || 'carly',
  narrator: process.env.SPEECHIFY_VOICE_NARRATOR || 'george',
};

// Lines repeat a lot (tutorial, briefs) — cache the audio so each costs once.
const cache = new Map();
const CACHE_MAX = 300;

async function synth(text, who) {
  const voice = CAST[who] || CAST.dispatch;
  const k = `${voice}|${text}`;
  if (cache.has(k)) return cache.get(k);
  const r = await fetch(`${BASE}/v1/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: text, voice_id: voice, audio_format: 'mp3', language: 'en-US' }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Speechify ${r.status}: ${body.slice(0, 200)}`);
  }
  const d = await r.json();
  const buf = Buffer.from(d.audio_data || '', 'base64');
  if (!buf.length) throw new Error('Speechify returned no audio');
  cache.set(k, buf);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return buf;
}

// keep strangers from burning through the Speechify quota: ~30 lines/min per IP
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const h = (hits.get(ip) || []).filter((t) => now - t < 60000);
  h.push(now);
  hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  return h.length > 30;
}

function mount(app) {
  app.post('/tts', async (req, res) => {
    if (!KEY) return res.status(404).json({ error: 'voices not configured' });
    if (limited(req.ip)) return res.status(429).json({ error: 'slow down' });
    const text = String(req.body?.text || '').replace(/\s+/g, ' ').trim().slice(0, 700);
    const who = String(req.body?.who || 'dispatch');
    if (!text) return res.status(400).json({ error: 'no text' });
    try {
      const buf = await synth(text, who);
      res.set('Content-Type', 'audio/mpeg').set('Cache-Control', 'public, max-age=86400').send(buf);
    } catch (e) {
      console.error('[tts]', e.message);
      res.status(502).json({ error: 'voice unavailable' });
    }
  });
}

module.exports = { mount, enabled: !!KEY };
