// Game rules engine. All question answers are computed by the server from the
// hider's true pin — the hider can't lie, the seekers can't peek.

const { getCity, DEFAULT_CITY, haversineMeters } = require('./stations');

// The city for a given game (each game stores its own cityId)
const cityOf = (game) => getCity(game.cityId);

const RULES = {
  HIDE_ZONE_METERS: 500,   // hiding spot must be this close to chosen station
  WIN_RADIUS_METERS: 15,   // pin-drop accuracy required to find the hider
  CLOSE_RADIUS_METERS: 100, // wrong guesses inside this get a "close" hint
  WRONG_GUESS_PENALTY_MINS: 10,
  STARTING_COINS: 15,
  RIDE_COIN_RATE: 0.5,  // coins earned per minute of riding (longer trips pay more)
  MIN_RIDE_COINS: 2,    // even a one-stop hop is worth this much
  COINS_PER_WALK: 1,
  WALK_PACE_MIN_PER_KM: 12, // ~5 km/h
  MAX_WALK_METERS: 1500,    // per walking leg
  GUESS_RANGE_METERS: 50,   // pins must be dropped this close to where you stand
  WIN_RADIUS_OPTIONS: [10, 15, 25, 50], // host picks one in the lobby
  MAX_BUS_WAIT_MINS: 10,    // next-bus wait is a random 1..this, added on ride
};

const QUESTION_DEFS = {
  radar: {
    label: 'Radar',
    // radiusKm option -> coin cost (tighter = pricier; 0.1/0.25 are endgame tools)
    costs: { 0.1: 7, 0.25: 6, 0.5: 5, 1: 4, 2: 3, 5: 2 },
  },
  thermometer: { label: 'Thermometer', cost: 3 },
  sameLine: { label: 'Line Check', cost: 3 },
  rightStation: { label: 'Right Station', cost: 4 },
  compass: { label: 'Compass', cost: 5 }, // axis: 'ns' | 'ew'
  matching: { label: 'Matching', cost: 4 }, // category -> MATCH_CATEGORIES
  photo: { label: 'Photo' }, // kind -> PHOTO_KINDS; answered by the hider with a screenshot
};

// Street View photo challenges, Jet Lag home-game style
const PHOTO_KINDS = {
  tallest: {
    cost: 5, label: 'tallest structure',
    instructions: 'Screenshot the tallest structure you can see from your Street View spot.',
  },
  sky: {
    cost: 6, label: 'straight up at the sky',
    instructions: 'Point the Street View camera straight up and screenshot the sky (wires, rooflines and trees included).',
  },
  street: {
    cost: 6, label: 'straight down the street',
    instructions: 'Screenshot looking straight down the street, in whichever direction you choose.',
  },
  north: {
    cost: 7, label: 'facing due north',
    instructions: 'Use the Street View compass to face due north, then screenshot what you see.',
  },
};

// Matching-question categories (Jet Lag style). A city only offers a category
// if it has 2+ landmarks of it, so the answer actually narrows the map.
const MATCH_CATEGORIES = {
  borough:   { label: 'borough',             cost: 4, region: true },
  district:  { label: 'district',            cost: 4, region: true },
  ward:      { label: 'ward',                cost: 4, region: true },
  airport:   { label: 'commercial airport',  cost: 4 },
  zoo:       { label: 'zoo',                  cost: 4 },
  amusement: { label: 'amusement park',       cost: 4 },
};

function poisOf(city, category) {
  return (city.pois || []).filter((p) => p.category === category);
}

function nearestPoi(pois, pos) {
  let best = null, bestD = Infinity;
  for (const p of pois) {
    const d = haversineMeters(pos.lat, pos.lng, p.lat, p.lng);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

// Categories a city can actually offer (2+ landmarks), with labels + costs
function matchCategoriesFor(city) {
  return Object.entries(MATCH_CATEGORIES)
    .filter(([cat]) => poisOf(city, cat).length >= 2)
    .map(([id, def]) => ({ id, label: def.label, cost: def.cost, region: !!def.region }));
}

const SOLO = {
  BOT_ID: 'BOT',
  BOT_NAME: 'The Phantom',
  PHOTO_COST: 7,
  MIN_SPOT_METERS: 80, // don't hide on the platform itself
};

function makeCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createGame(hostId, hostName, cityId = DEFAULT_CITY) {
  const city = getCity(cityId);
  return {
    code: makeCode(),
    cityId: city.id,
    phase: 'lobby', // lobby -> hiding -> seeking -> ended
    hostId,
    players: [{ id: hostId, name: hostName, role: 'hider' }],
    hider: null, // { stationId, lat, lng } — never sent to seekers
    seekerStation: city.startStation,
    winRadius: RULES.WIN_RADIUS_METERS, // host-configurable in the lobby
    walkPos: null, // { lat, lng } when seekers have walked away from their station
    thermoStart: null, // { lat, lng, label } once a thermometer reading is started
    stationConfirmed: false, // a Right Station YES unlocks in-app Street View
    clock: 0, // game minutes elapsed
    endgameBonus: false, // coins triple once when the right zone is confirmed
    coins: RULES.STARTING_COINS,
    feed: [], // { kind: 'move'|'question'|'guess'|'system', ... }
    pendingPhoto: null, // { kind, feedIndex } while the hider owes a screenshot
    winner: null,
  };
}

// Where the seekers actually stand: walked position, else their station
function seekerPos(game) {
  if (game.walkPos) return game.walkPos;
  const s = cityOf(game).stations[game.seekerStation];
  return { lat: s.lat, lng: s.lng };
}

// "near Castro" while walked, plain station name otherwise
function posLabel(game) {
  const name = cityOf(game).stations[game.seekerStation].name;
  return game.walkPos ? `near ${name}` : name;
}

function walkMinutes(a, b) {
  const km = haversineMeters(a.lat, a.lng, b.lat, b.lng) / 1000;
  return Math.max(1, Math.ceil(km * RULES.WALK_PACE_MIN_PER_KM));
}

function hiderDistFrom(game, pos) {
  return haversineMeters(pos.lat, pos.lng, game.hider.lat, game.hider.lng);
}

// --- Solo mode: an AI hider ("The Phantom") picks a spot and sends one photo ---

function createSoloGame(hostId, hostName, photoAvailable, cityId = DEFAULT_CITY) {
  const g = createGame(hostId, hostName, cityId);
  g.solo = true;
  g.photoAvailable = !!photoAvailable;
  g.photoUsed = false;
  g.players[0].role = 'seeker';
  g.players.push({ id: SOLO.BOT_ID, name: SOLO.BOT_NAME, role: 'hider' });
  return g;
}

// Random station weighted by distance from the start (farther = likelier),
// then a random point inside its hide zone
function pickSoloSpot(city) {
  const times = city.travelTimes(city.startStation);
  const ids = Object.keys(city.stations).filter((id) => id !== city.startStation);
  const weights = ids.map((id) => (times[id] || 1) ** 1.5);
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  let stationId = ids[ids.length - 1];
  for (let i = 0; i < ids.length; i++) {
    roll -= weights[i];
    if (roll <= 0) { stationId = ids[i]; break; }
  }
  const st = city.stations[stationId];
  const angle = Math.random() * 2 * Math.PI;
  const r = SOLO.MIN_SPOT_METERS + Math.random() * (RULES.HIDE_ZONE_METERS - SOLO.MIN_SPOT_METERS - 50);
  return {
    stationId,
    lat: st.lat + (r * Math.cos(angle)) / 111320,
    lng: st.lng + (r * Math.sin(angle)) / (111320 * Math.cos((st.lat * Math.PI) / 180)),
  };
}

// Snap a point to the nearest real Street View panorama so the Phantom's
// photo matches the exact pin the seeker must hit
async function snapToStreetView(lat, lng, key) {
  const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&radius=120&source=outdoor&key=${key}`;
  try {
    const res = await fetch(url);
    const meta = await res.json();
    if (meta.status === 'OK' && meta.location) return { lat: meta.location.lat, lng: meta.location.lng };
  } catch { /* fall through */ }
  return null;
}

async function placeSoloHider(game, key) {
  const city = cityOf(game);
  for (let i = 0; i < 10; i++) {
    const spot = pickSoloSpot(city);
    let { lat, lng } = spot;
    if (key) {
      const snapped = await snapToStreetView(lat, lng, key);
      if (!snapped) continue;
      lat = snapped.lat;
      lng = snapped.lng;
    }
    const r = setHider(game, SOLO.BOT_ID, spot.stationId, lat, lng);
    if (r.ok) return r; // setHider enforces the hide zone; snap can overshoot it
  }
  const spot = pickSoloSpot(city); // give up on snapping, point is valid by construction
  return setHider(game, SOLO.BOT_ID, spot.stationId, spot.lat, spot.lng);
}

// The one photo per game: a real Street View image of the hiding spot
async function soloPhoto(game, key) {
  if (!key) return { error: 'Photos are not configured on this server' };
  if (game.photoUsed) return { error: 'The Phantom only sends one photo per game' };
  if (game.coins < SOLO.PHOTO_COST)
    return { error: `Not enough coins (need ${SOLO.PHOTO_COST}, have ${game.coins})` };
  const heading = Math.floor(Math.random() * 360);
  const url =
    `https://maps.googleapis.com/maps/api/streetview?size=640x400` +
    `&location=${game.hider.lat},${game.hider.lng}&heading=${heading}&fov=90&pitch=0&key=${key}`;
  try {
    const res = await fetch(url);
    const ctype = res.headers.get('content-type') || '';
    // Google returns its rejection reason as text/plain (billing off, API not
    // enabled, key restricted, etc.) — log it so the failure isn't a mystery
    if (!res.ok || !ctype.startsWith('image/')) {
      const body = await res.text().catch(() => '');
      console.error(`[streetview] ${res.status} ${ctype} :: ${body.slice(0, 300)}`);
      return { error: `Street View refused: ${body.slice(0, 120) || res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const img = `data:image/jpeg;base64,${buf.toString('base64')}`;
    game.photoUsed = true;
    game.coins -= SOLO.PHOTO_COST;
    game.feed.push({
      kind: 'question', clock: game.clock, type: 'photo',
      label: "The Phantom's one photo", answer: 'PHOTO DELIVERED',
      cost: SOLO.PHOTO_COST, img,
      text: "The Phantom's one photo — delivered",
    });
    return { ok: true };
  } catch (e) {
    console.error('[streetview] fetch threw:', e.message);
    return { error: 'Street View photo failed — try again' };
  }
}

// Lobby-only game options (host sets them before start)
function setOptions(game, opts = {}) {
  if (game.phase !== 'lobby') return { error: 'Options are locked once the game starts' };
  if (opts.winRadius !== undefined) {
    const r = Number(opts.winRadius);
    if (!RULES.WIN_RADIUS_OPTIONS.includes(r)) return { error: 'Invalid tag distance' };
    game.winRadius = r;
  }
  return { ok: true };
}

function setHider(game, playerId, stationId, lat, lng) {
  const city = cityOf(game);
  const station = city.stations[stationId];
  if (!station) return { error: 'Unknown station' };
  const d = haversineMeters(station.lat, station.lng, lat, lng);
  if (d > RULES.HIDE_ZONE_METERS) {
    return { error: `Hiding spot must be within ${RULES.HIDE_ZONE_METERS}m of ${station.name} (you were ${Math.round(d)}m away)` };
  }
  game.hider = { playerId, stationId, lat, lng };
  game.phase = 'seeking';
  const startName = city.stations[city.startStation].name;
  game.feed.push({ kind: 'system', clock: 0, text: `The hider is hidden. Seekers depart ${startName}.` });
  return { ok: true };
}

// Longer rides pay more — coins scale with the time spent riding
function rideCoins(rideMins) {
  return Math.max(RULES.MIN_RIDE_COINS, Math.round(rideMins * RULES.RIDE_COIN_RATE));
}

// Minutes until the next bus to a destination. Deterministic from where you
// stand, the destination, and the current clock — so it's stable while you
// plan, matches what you're charged when you ride, and refreshes every time
// the clock moves (a ride or a walk). Feels like catching a real bus.
function busWait(game, toStationId) {
  const seed = `${game.seekerStation}|${toStationId}|${game.clock}`;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 1 + ((h >>> 0) % RULES.MAX_BUS_WAIT_MINS); // 1..MAX
}

function move(game, toStationId) {
  const city = cityOf(game);
  if (!city.stations[toStationId]) return { error: 'Unknown station' };
  if (toStationId === game.seekerStation && !game.walkPos) return { error: 'Already there' };
  const times = city.travelTimes(game.seekerStation);
  const rideMins = times[toStationId] || 0;
  // walked seekers first walk back to their station before riding
  const walkBack = game.walkPos ? walkMinutes(game.walkPos, city.stations[game.seekerStation]) : 0;
  const waitMins = busWait(game, toStationId); // time spent waiting for the next bus
  const mins = rideMins + walkBack + waitMins;
  const earned = rideCoins(rideMins);
  game.clock += mins;
  game.coins += earned;
  game.feed.push({
    kind: 'move', clock: game.clock,
    from: game.seekerStation, to: toStationId, mins, waitMins,
    text: `Seekers ${walkBack ? `walked back to ${city.stations[game.seekerStation].name} and ` : ''}waited ${waitMins} min, then rode to ${city.stations[toStationId].name} (${mins} min total, +${earned} coins)`,
  });
  game.seekerStation = toStationId;
  game.walkPos = null;
  return { ok: true };
}

function walk(game, lat, lng) {
  const pos = seekerPos(game);
  const meters = haversineMeters(pos.lat, pos.lng, lat, lng);
  if (meters > RULES.MAX_WALK_METERS)
    return { error: `Too far to walk in one go (${Math.round(meters)}m, max ${RULES.MAX_WALK_METERS}m) — ride instead` };
  const mins = walkMinutes(pos, { lat, lng });
  game.clock += mins;
  game.coins += RULES.COINS_PER_WALK;
  game.walkPos = { lat, lng };
  game.feed.push({
    kind: 'walk', clock: game.clock, lat, lng, mins,
    text: `Seekers walked ${Math.round(meters)}m ${posLabel(game)} (${mins} min, +${RULES.COINS_PER_WALK} coin)`,
  });
  return { ok: true };
}

function ask(game, type, params = {}) {
  const def = QUESTION_DEFS[type];
  if (!def) return { error: 'Unknown question type' };

  let answer, label, extra = {};
  const city = cityOf(game);
  const here = seekerPos(game);
  const hereLabel = posLabel(game);

  // Thermometer is a two-step tool: start it here (free), move, then read it.
  if (type === 'thermometer' && params.action === 'start') {
    game.thermoStart = { lat: here.lat, lng: here.lng, label: hereLabel };
    game.feed.push({ kind: 'system', clock: game.clock, text: `Thermometer started at ${hereLabel}. Move, then read it.` });
    return { ok: true };
  }

  // Resolve cost and validate BEFORE touching any state
  let cost;
  if (type === 'radar') {
    cost = def.costs[Number(params.radiusKm)];
    if (!cost) return { error: 'Invalid radar radius' };
  } else if (type === 'photo') {
    cost = PHOTO_KINDS[params.kind]?.cost;
    if (!cost) return { error: 'Invalid photo kind' };
    if (game.pendingPhoto) return { error: 'The hider still owes you a photo — wait for it' };
  } else if (type === 'matching') {
    const cat = MATCH_CATEGORIES[params.category];
    if (!cat) return { error: 'Invalid matching category' };
    if (poisOf(city, params.category).length < 2)
      return { error: `Not enough ${cat.label}s in this city to compare` };
    cost = cat.cost;
  } else {
    cost = def.cost;
  }
  if (game.coins < cost) return { error: `Not enough coins (need ${cost}, have ${game.coins})` };
  if (type === 'thermometer') {
    if (!game.thermoStart) return { error: 'Start the thermometer first, then move and read it' };
    if (haversineMeters(game.thermoStart.lat, game.thermoStart.lng, here.lat, here.lng) < 30)
      return { error: 'Move away from where you started before reading the thermometer' };
  }

  if (type === 'radar') {
    const radiusKm = Number(params.radiusKm);
    const d = hiderDistFrom(game, here);
    answer = d <= radiusKm * 1000 ? 'YES — inside' : 'NO — outside';
    label = `Radar ${radiusKm}km from ${hereLabel}: is the hider inside?`;
    extra = { center: { lat: here.lat, lng: here.lng }, radiusKm };
  } else if (type === 'thermometer') {
    const dNow = hiderDistFrom(game, here);
    const dStart = hiderDistFrom(game, game.thermoStart);
    answer = dNow < dStart ? 'WARMER' : dNow > dStart ? 'COLDER' : 'SAME';
    label = `Thermometer: ${game.thermoStart.label} → ${hereLabel}`;
    game.thermoStart = null;
  } else if (type === 'rightStation') {
    const right = game.seekerStation === game.hider.stationId;
    answer = right ? 'YES — this is it' : 'NO — wrong station';
    label = `Right Station: is ${city.stations[game.seekerStation].name} the hider's home station?`;
    extra = { stationId: game.seekerStation };
    if (right) game.stationConfirmed = true; // unlocks in-app Street View
  } else if (type === 'sameLine') {
    const seekerLines = city.stationLines[game.seekerStation];
    const hiderLines = city.stationLines[game.hider.stationId];
    const shared = seekerLines.some((l) => hiderLines.includes(l));
    answer = shared ? 'YES — shares a line' : 'NO — different lines';
    label = `Line Check: does the hider's station share a line with ${city.stations[game.seekerStation].name}?`;
    extra = { stationId: game.seekerStation };
  } else if (type === 'compass') {
    const axis = params.axis === 'ew' ? 'ew' : 'ns';
    if (axis === 'ns') {
      answer = game.hider.lat > here.lat ? 'NORTH' : 'SOUTH';
      label = `Compass N/S of ${hereLabel}`;
    } else {
      answer = game.hider.lng > here.lng ? 'EAST' : 'WEST';
      label = `Compass E/W of ${hereLabel}`;
    }
    extra = { center: { lat: here.lat, lng: here.lng }, axis };
  } else if (type === 'matching') {
    const cat = MATCH_CATEGORIES[params.category];
    const pois = poisOf(city, params.category);
    const ourNearest = nearestPoi(pois, here);
    const hiderNearest = nearestPoi(pois, { lat: game.hider.lat, lng: game.hider.lng });
    const same = ourNearest.id === hiderNearest.id;
    answer = same ? `YES — same ${cat.label}` : `NO — different ${cat.label}`;
    label = cat.region
      ? `Region: are you in the same ${cat.label} as us? (ours: ${ourNearest.name})`
      : `Matching: is your nearest ${cat.label} the same as ours? (ours: ${ourNearest.name})`;
    extra = { category: params.category, poiId: ourNearest.id };
  } else if (type === 'photo') {
    const kind = PHOTO_KINDS[params.kind];
    answer = 'WAITING FOR THE HIDER…';
    label = `Photo request: ${kind.label}`;
    game.pendingPhoto = { kind: params.kind, feedIndex: game.feed.length };
  }

  game.coins -= cost;
  game.feed.push({ kind: 'question', clock: game.clock, type, label, answer, cost, text: `${label} — ${answer}`, ...extra });

  // Endgame bonus: confirming the hider's zone triples the coin purse, once
  // per game — so the final hunt isn't starved by question costs.
  const confirmedZone =
    (type === 'rightStation' && answer.startsWith('YES')) ||
    (type === 'radar' && Number(params.radiusKm) <= 0.25 && answer.startsWith('YES'));
  if (!game.endgameBonus && confirmedZone) {
    game.endgameBonus = true;
    game.coins *= 3;
    game.feed.push({
      kind: 'system', clock: game.clock,
      text: `ZONE CONFIRMED — endgame bonus! Coins tripled to ${game.coins}.`,
    });
  }
  return { ok: true, answer };
}

// Hider delivers the screenshot for the pending photo request
function photoReply(game, img) {
  if (!game.pendingPhoto) return { error: 'No photo has been requested' };
  if (typeof img !== 'string' || !img.startsWith('data:image/'))
    return { error: 'Send an image file' };
  if (img.length > 1_500_000) return { error: 'Image too large — try a smaller screenshot' };
  const entry = game.feed[game.pendingPhoto.feedIndex];
  entry.answer = 'PHOTO DELIVERED';
  entry.img = img;
  game.pendingPhoto = null;
  return { ok: true };
}

function guess(game, lat, lng) {
  // you have to actually walk to the hider — pins only drop near where you stand
  const pos = seekerPos(game);
  const reach = haversineMeters(pos.lat, pos.lng, lat, lng);
  if (reach > RULES.GUESS_RANGE_METERS)
    return { error: `Too far to tag — that pin is ${Math.round(reach)}m from you (max ${RULES.GUESS_RANGE_METERS}m). Walk closer first.` };
  const d = haversineMeters(lat, lng, game.hider.lat, game.hider.lng);
  if (d <= game.winRadius) {
    game.phase = 'ended';
    game.winner = 'seekers';
    game.feed.push({
      kind: 'guess', clock: game.clock, lat, lng, hit: true,
      text: `FOUND! Pin landed ${Math.round(d)}m from the hider. Hider survived ${game.clock} game-minutes.`,
    });
    return { ok: true, hit: true, distance: d };
  }
  game.clock += RULES.WRONG_GUESS_PENALTY_MINS;
  const close = d <= RULES.CLOSE_RADIUS_METERS;
  game.feed.push({
    kind: 'guess', clock: game.clock, lat, lng, hit: false, close,
    text: close
      ? `Wrong pin — but CLOSE (within ${RULES.CLOSE_RADIUS_METERS}m). +${RULES.WRONG_GUESS_PENALTY_MINS} min penalty.`
      : `Wrong pin. +${RULES.WRONG_GUESS_PENALTY_MINS} min penalty.`,
  });
  return { ok: true, hit: false, close };
}

// What each role is allowed to see
function viewFor(game, playerId) {
  const player = game.players.find((p) => p.id === playerId);
  const isHider = player?.role === 'hider';
  const base = {
    code: game.code,
    cityId: game.cityId,
    phase: game.phase,
    hostId: game.hostId,
    players: game.players,
    you: player,
    seekerStation: game.seekerStation,
    walkPos: game.walkPos,
    seekerPos: seekerPos(game),
    thermoStart: game.thermoStart,
    stationConfirmed: game.stationConfirmed || false,
    clock: game.clock,
    coins: game.coins,
    feed: game.feed,
    pendingPhoto: game.pendingPhoto,
    solo: game.solo || false,
    photoAvailable: game.photoAvailable || false,
    photoUsed: game.photoUsed || false,
    winner: game.winner,
    rules: { ...RULES, WIN_RADIUS_METERS: game.winRadius },
  };
  // Hider location revealed only to the hider, or to everyone once the game ends
  if (isHider || game.phase === 'ended') base.hider = game.hider;
  // Travel times from the seekers' current station (for the move UI),
  // including the walk back to the platform if they've wandered off
  if (game.phase === 'seeking') {
    const city = cityOf(game);
    const t = city.travelTimes(game.seekerStation);
    const wb = game.walkPos ? walkMinutes(game.walkPos, city.stations[game.seekerStation]) : 0;
    base.travelTimes = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v + wb]));
    // next-bus wait for each destination, shown in the Bus Schedule app
    base.busWaits = Object.fromEntries(Object.keys(t).map((k) => [k, busWait(game, k)]));
  }
  return base;
}

module.exports = {
  RULES, QUESTION_DEFS, PHOTO_KINDS, SOLO, MATCH_CATEGORIES, matchCategoriesFor,
  createGame, setOptions, setHider, move, walk, ask, guess, photoReply, viewFor,
  createSoloGame, placeSoloHider, soloPhoto, pickSoloSpot,
};
