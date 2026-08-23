const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { getCity, listCities } = require('./stations');
const {
  createGame, setOptions, setHider, move, walk, ask, guess, photoReply, viewFor, PHOTO_KINDS,
  createSoloGame, placeSoloHider, soloPhoto, matchCategoriesFor,
} = require('./game');

const STREET_VIEW_KEY = process.env.GOOGLE_MAPS_KEY || '';
// Separate browser key for the in-app Street View iframe (Maps Embed API).
// Safe to expose to clients; restrict it to your domain in Google Cloud.
const EMBED_KEY = process.env.GOOGLE_MAPS_BROWSER_KEY || '';

const app = express();
const server = http.createServer(app);
// maxHttpBufferSize raised so photo screenshots (data URLs) fit in one event
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 2e6 });

// GAME_PORT (not PORT) so dev-harness PORT injection can't collide with vite
const PORT = process.env.GAME_PORT || process.env.PORT || 3001;

// Serve the built client in production
const dist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(dist));
// Client config (no secrets beyond the browser-safe embed key)
app.get('/config', (_req, res) => res.json({ embedKey: EMBED_KEY }));

// City list for the picker, and per-city network for the map
app.get('/cities', (_req, res) => res.json(listCities()));
app.get('/network/:cityId', (req, res) => {
  const c = getCity(req.params.cityId);
  res.json({
    id: c.id, name: c.name, center: c.center, zoom: c.zoom,
    startStation: c.startStation, stations: c.stations, lines: c.lines,
    pois: c.pois, matchCategories: matchCategoriesFor(c),
    photoKinds: PHOTO_KINDS,
  });
});

const games = new Map(); // code -> game
const socketsByPlayer = new Map(); // playerId -> socket
const MAX_ROOMS = 200;
// Sent when a client acts on a room the server no longer has — almost always
// because a free-tier restart wiped in-memory state while the tab stayed open.
const GONE = { error: 'This game is no longer on the server (it may have restarted). Starting you fresh…', gone: true };

function broadcast(game) {
  game.lastActivity = Date.now();
  for (const p of game.players) {
    const sock = socketsByPlayer.get(p.id);
    if (sock) sock.emit('state', viewFor(game, p.id));
  }
}

// Public-server hygiene: sweep rooms that are finished, abandoned, or ancient
setInterval(() => {
  const now = Date.now();
  for (const [code, g] of games) {
    const idle = now - (g.lastActivity || 0);
    const anyoneConnected = g.players.some((p) => socketsByPlayer.has(p.id));
    if (
      (g.phase === 'ended' && idle > 60 * 60e3) || // done for an hour
      (!anyoneConnected && idle > 15 * 60e3) ||    // everyone gone 15 min
      idle > 24 * 60 * 60e3                        // day-old no matter what
    ) {
      games.delete(code);
    }
  }
}, 60e3);

io.on('connection', (socket) => {
  let playerId = null;
  let gameCode = null;

  const game = () => games.get(gameCode);

  socket.on('create', ({ name, cityId }, cb) => {
    if (games.size >= MAX_ROOMS) return cb({ error: 'Server is full — try again in a bit' });
    playerId = socket.id;
    socketsByPlayer.set(playerId, socket);
    const g = createGame(playerId, (name || 'Host').slice(0, 20), cityId);
    games.set(g.code, g);
    gameCode = g.code;
    cb({ ok: true, code: g.code });
    broadcast(g);
  });

  socket.on('createSolo', async ({ name, cityId }, cb) => {
    if (games.size >= MAX_ROOMS) return cb({ error: 'Server is full — try again in a bit' });
    playerId = socket.id;
    socketsByPlayer.set(playerId, socket);
    const g = createSoloGame(playerId, (name || 'Seeker').slice(0, 20), !!STREET_VIEW_KEY, cityId);
    games.set(g.code, g);
    gameCode = g.code;
    await placeSoloHider(g, STREET_VIEW_KEY);
    cb({ ok: true, code: g.code });
    broadcast(g);
  });

  socket.on('join', ({ code, name }, cb) => {
    const g = games.get((code || '').toUpperCase());
    if (!g) return cb({ error: 'Room not found' });
    if (g.phase !== 'lobby') return cb({ error: 'Game already started' });
    playerId = socket.id;
    socketsByPlayer.set(playerId, socket);
    gameCode = g.code;
    g.players.push({ id: playerId, name: (name || 'Player').slice(0, 20), role: 'seeker' });
    cb({ ok: true, code: g.code });
    broadcast(g);
  });

  socket.on('setRole', ({ role }, cb) => {
    const g = game();
    if (!g || g.phase !== 'lobby') return cb?.({ error: 'Not in a lobby' });
    if (role !== 'hider' && role !== 'seeker') return cb?.({ error: 'Bad role' });
    if (role === 'hider') {
      // only one hider at a time
      for (const p of g.players) if (p.role === 'hider') p.role = 'seeker';
    }
    const me = g.players.find((p) => p.id === playerId);
    if (me) me.role = role;
    cb?.({ ok: true });
    broadcast(g);
  });

  socket.on('setOptions', (opts, cb) => {
    const g = game();
    if (!g) return cb?.(GONE);
    if (playerId !== g.hostId) return cb?.({ error: 'Only the host can change options' });
    const r = setOptions(g, opts || {});
    cb?.(r);
    if (r.ok) broadcast(g);
  });

  socket.on('start', (_data, cb) => {
    const g = game();
    if (!g) return cb?.(GONE);
    if (g.phase !== 'lobby') return cb?.({ error: 'Game already started' });
    if (playerId !== g.hostId) return cb?.({ error: 'Only the host can start' });
    const hiders = g.players.filter((p) => p.role === 'hider');
    const seekers = g.players.filter((p) => p.role === 'seeker');
    if (hiders.length !== 1 || seekers.length < 1)
      return cb?.({ error: 'Need exactly 1 hider and at least 1 seeker' });
    g.phase = 'hiding';
    cb?.({ ok: true });
    broadcast(g);
  });

  socket.on('placeHider', ({ stationId, lat, lng }, cb) => {
    const g = game();
    if (!g) return cb?.(GONE);
    if (g.phase !== 'hiding') return cb?.({ error: 'Not in the hiding phase' });
    const me = g.players.find((p) => p.id === playerId);
    if (me?.role !== 'hider') return cb?.({ error: 'Only the hider can hide' });
    const r = setHider(g, playerId, stationId, lat, lng);
    cb?.(r);
    if (r.ok) broadcast(g);
  });

  socket.on('move', ({ stationId }, cb) => {
    const g = game();
    if (!g) return cb?.(GONE);
    if (g.phase !== 'seeking') return cb?.({ error: 'The game is not in the seeking phase' });
    const me = g.players.find((p) => p.id === playerId);
    if (me?.role !== 'seeker') return cb?.({ error: 'Only seekers can move' });
    const r = move(g, stationId);
    cb?.(r);
    if (r.ok) broadcast(g);
  });

  socket.on('walk', ({ lat, lng }, cb) => {
    const g = game();
    if (!g) return cb?.(GONE);
    if (g.phase !== 'seeking') return cb?.({ error: 'The game is not in the seeking phase' });
    const me = g.players.find((p) => p.id === playerId);
    if (me?.role !== 'seeker') return cb?.({ error: 'Only seekers can walk' });
    const r = walk(g, lat, lng);
    cb?.(r);
    if (r.ok) broadcast(g);
  });

  socket.on('ask', async ({ type, params }, cb) => {
    const g = game();
    if (!g) return cb?.(GONE);
    if (g.phase !== 'seeking') return cb?.({ error: 'The game is not in the seeking phase' });
    const me = g.players.find((p) => p.id === playerId);
    if (me?.role !== 'seeker') return cb?.({ error: 'Only seekers can ask' });
    // solo games: the AI hider answers photo requests itself, one per game
    const r = g.solo && type === 'photo' ? await soloPhoto(g, STREET_VIEW_KEY) : ask(g, type, params);
    cb?.(r);
    if (r.ok) broadcast(g);
  });

  socket.on('photoReply', ({ img }, cb) => {
    const g = game();
    if (!g) return cb?.(GONE);
    if (g.phase !== 'seeking') return cb?.({ error: 'The game is not in the seeking phase' });
    const me = g.players.find((p) => p.id === playerId);
    if (me?.role !== 'hider') return cb?.({ error: 'Only the hider sends photos' });
    const r = photoReply(g, img);
    cb?.(r);
    if (r.ok) broadcast(g);
  });

  socket.on('guess', ({ lat, lng }, cb) => {
    const g = game();
    if (!g) return cb?.(GONE);
    if (g.phase !== 'seeking') return cb?.({ error: 'The game is not in the seeking phase' });
    const me = g.players.find((p) => p.id === playerId);
    if (me?.role !== 'seeker') return cb?.({ error: 'Only seekers can guess' });
    const r = guess(g, lat, lng);
    cb?.(r);
    if (r.ok) broadcast(g);
  });

  socket.on('disconnect', () => {
    socketsByPlayer.delete(playerId);
    const g = game();
    if (!g) return;
    if (g.phase === 'lobby') {
      g.players = g.players.filter((p) => p.id !== playerId);
      if (g.players.length === 0) games.delete(g.code);
      else {
        if (g.hostId === playerId) g.hostId = g.players[0].id;
        broadcast(g);
      }
    }
    // mid-game disconnects keep the seat; rejoin support is a future feature
  });
});

server.listen(PORT, () => {
  console.log(`transit-hideseek server on :${PORT}`);
  console.log(
    STREET_VIEW_KEY
      ? `Street View photos: ENABLED (key ends in …${STREET_VIEW_KEY.slice(-4)})`
      : 'Street View photos: DISABLED (no GOOGLE_MAPS_KEY env var)'
  );
});
