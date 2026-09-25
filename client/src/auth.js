// Client-side account helpers. The JWT + username live in localStorage; the
// token is sent as a Bearer header on the /me/* endpoints. Guests (no token)
// simply never call these and keep using localStorage-only features.
const TOKEN_KEY = 'ths-token';
const USER_KEY = 'ths-username';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
export function getUsername() {
  try { return localStorage.getItem(USER_KEY) || ''; } catch { return ''; }
}
export function isSignedIn() { return !!getToken(); }

function setSession(token, username) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, username);
  } catch { /* ignore */ }
}
export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch { /* ignore */ }
}

async function jsonPost(url, body, withAuth, method = 'POST') {
  const headers = { 'Content-Type': 'application/json' };
  if (withAuth) headers.Authorization = `Bearer ${getToken()}`;
  const r = await fetch(url, { method, headers, body: JSON.stringify(body || {}) });
  return r.json();
}

export async function register(username, password) {
  const r = await jsonPost('/auth/register', { username, password });
  if (r.ok) setSession(r.token, r.username);
  return r;
}
export async function login(username, password) {
  const r = await jsonPost('/auth/login', { username, password });
  if (r.ok) setSession(r.token, r.username);
  return r;
}

// Returns { studyQuestions, prefs, stats } or null if the session is invalid.
export async function fetchMyData() {
  try {
    const r = await fetch('/me/data', { headers: { Authorization: `Bearer ${getToken()}` } });
    if (r.status === 401) { clearSession(); return null; }
    return await r.json();
  } catch { return null; }
}

export async function saveMyData(patch) {
  try { return await jsonPost('/me/data', patch, true, 'PUT'); }
  catch { return { error: 'offline' }; }
}

export async function recordGame(result) {
  try { return await jsonPost('/me/game', result, true); }
  catch { return { error: 'offline' }; }
}

// Leaderboards: submit a finished solo time (authed), read a city's top times (public).
export async function submitScore(city, mins) {
  try { return await jsonPost('/me/score', { city, mins }, true); }
  catch { return { error: 'offline' }; }
}
export async function fetchLeaderboard(city) {
  try {
    const r = await fetch(`/leaderboard/${encodeURIComponent(city)}`);
    const d = await r.json();
    return Array.isArray(d.scores) ? d.scores : [];
  } catch { return []; }
}
