// Spoken lines for the characters who talk to you (Dispatch, story handlers)
// and for read-aloud panels. Uses the browser's built-in speech voices, with a
// little radio squelch in front so it sounds like it's coming over a handset.

const KEY = 'ths-voice';

export function isVoiceOn() {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setVoiceOn(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  if (!on) stopSpeaking();
  window.dispatchEvent(new Event('ths-voice'));
}

// Each character gets a consistent voice: a preferred list of voice names
// (first one installed wins) plus pitch/rate so they sound distinct.
const CAST = {
  dispatch: { prefer: ['Daniel', 'Google UK English Male', 'Microsoft Ryan', 'Arthur', 'Alex', 'Aaron', 'Fred'], pitch: 0.85, rate: 1.03, radio: true },
  spy:      { prefer: ['Serena', 'Google UK English Female', 'Microsoft Sonia', 'Kate', 'Moira', 'Karen'], pitch: 0.95, rate: 0.98, radio: true },
  grounded: { prefer: ['Samantha', 'Google US English', 'Microsoft Aria', 'Allison', 'Ava', 'Victoria'], pitch: 1.0, rate: 1.02, radio: true },
  narrator: { prefer: ['Daniel', 'Google UK English Male', 'Microsoft Guy', 'Alex', 'Tom'], pitch: 0.8, rate: 0.95, radio: false },
};

let voices = [];
function loadVoices() {
  try { voices = window.speechSynthesis?.getVoices() || []; } catch { voices = []; }
}
if (typeof window !== 'undefined' && window.speechSynthesis) {
  loadVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

function pickVoice(prefer) {
  if (!voices.length) loadVoices();
  const en = voices.filter((v) => /^en/i.test(v.lang));
  for (const name of prefer) {
    const v = en.find((x) => x.name.includes(name));
    if (v) return v;
  }
  return en[0] || voices[0] || null;
}

// A short burst of filtered noise + a click — the "key up" of a radio.
let audioCtx = null;
function squelch() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx;
    const len = Math.floor(ctx.sampleRate * 0.16);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass'; band.frequency.value = 1800; band.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.value = 0.07;
    src.connect(band).connect(gain).connect(ctx.destination);
    src.start();
  } catch { /* audio unavailable — fine, just speak */ }
}

// Speechify voices when the server has a key (asked once via /config);
// otherwise, or if a request fails, the browser's built-in voices.
let premium = null; // null = unknown, then true/false
const premiumReady = fetch('/config').then((r) => r.json())
  .then((c) => { premium = !!c.voices; }).catch(() => { premium = false; });
let audioEl = null;

let token = 0; // bumps on every new line so a delayed start can't talk over a newer one
export function stopSpeaking() {
  token++;
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  if (audioEl) { try { audioEl.pause(); } catch { /* ignore */ } audioEl = null; }
}

async function speakPremium(clean, who, role, mine) {
  const r = await fetch('/tts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: clean, who }),
  });
  if (!r.ok) throw new Error('tts ' + r.status);
  const url = URL.createObjectURL(await r.blob());
  if (mine !== token) { URL.revokeObjectURL(url); return; }
  if (role.radio) squelch();
  const a = new Audio(url);
  audioEl = a;
  a.onended = () => URL.revokeObjectURL(url);
  setTimeout(() => { if (mine === token) a.play().catch(() => {}); }, role.radio ? 170 : 0);
}

// Speak `text` as `who` (a CAST key). Replaces anything already being said.
export async function speak(text, who = 'dispatch') {
  if (!text || !isVoiceOn()) return;
  const role = CAST[who] || CAST.dispatch;
  stopSpeaking();
  const mine = token;
  // strip emoji / decorative symbols so the voice doesn't read them out
  const clean = String(text)
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/[▸‹›★·]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!clean) return;
  if (premium === null) await premiumReady;
  if (mine !== token) return;
  if (premium) {
    try { await speakPremium(clean, who, role, mine); return; } catch { /* fall back below */ }
  }
  if (!window.speechSynthesis || mine !== token) return;
  if (role.radio) squelch();
  const u = new SpeechSynthesisUtterance(clean);
  const v = pickVoice(role.prefer);
  if (v) { u.voice = v; u.lang = v.lang; }
  u.pitch = role.pitch; u.rate = role.rate;
  // let the squelch finish before the words start
  setTimeout(() => { if (mine !== token) return; try { window.speechSynthesis.speak(u); } catch { /* ignore */ } }, role.radio ? 170 : 0);
}
