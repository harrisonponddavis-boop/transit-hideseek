// City registry: loads each city definition and builds the derived data the
// game needs (adjacency graph, per-station line lists, shortest-path times).
// Add a city by dropping a file in cities/ and listing it in CITY_DEFS.

const CITY_DEFS = [
  require('./cities/sf'),
  require('./cities/nyc'),
  require('./cities/chicago'),
  require('./cities/tokyo'),
  require('./cities/london'),
  require('./cities/paris'),
  require('./cities/la'),
  require('./cities/boston'),
  require('./cities/dc'),
  require('./cities/berlin'),
];
const DEFAULT_CITY = 'sf';

// What you ride inside each city (drives the "inside the vehicle" screen)
const VEHICLES = {
  sf: 'bus', chicago: 'train', nyc: 'train', tokyo: 'train',
  london: 'train', paris: 'train', la: 'train', boston: 'train', dc: 'train', berlin: 'train',
};

const TRANSFER_PENALTY = 0; // kept simple

function buildCity(def) {
  // tag each station with its real neighbourhood/borough/ward for region matching
  if (def.stationRegions) {
    for (const [id, region] of Object.entries(def.stationRegions)) {
      if (def.stations[id]) def.stations[id].region = region;
    }
  }

  const graph = {};
  for (const id of Object.keys(def.stations)) graph[id] = [];
  for (const line of def.lines) {
    for (let i = 0; i < line.stops.length - 1; i++) {
      const a = line.stops[i], b = line.stops[i + 1], mins = line.hops[i];
      graph[a].push({ to: b, mins });
      graph[b].push({ to: a, mins });
    }
  }

  const stationLines = {};
  for (const id of Object.keys(def.stations)) stationLines[id] = [];
  for (const line of def.lines) {
    for (const stop of line.stops) stationLines[stop].push(line.id);
  }

  // Dijkstra: travel time in minutes from `from` to every reachable station
  function travelTimes(from) {
    const dist = { [from]: 0 };
    const visited = new Set();
    while (true) {
      let cur = null, best = Infinity;
      for (const [id, d] of Object.entries(dist)) {
        if (!visited.has(id) && d < best) { best = d; cur = id; }
      }
      if (cur === null) break;
      visited.add(cur);
      for (const { to, mins } of graph[cur]) {
        const nd = dist[cur] + mins + TRANSFER_PENALTY;
        if (dist[to] === undefined || nd < dist[to]) dist[to] = nd;
      }
    }
    return dist;
  }

  return {
    id: def.id,
    name: def.name,
    center: def.center,
    zoom: def.zoom,
    vehicle: def.vehicle || VEHICLES[def.id] || 'train',
    startStation: def.startStation,
    stations: def.stations,
    lines: def.lines,
    pois: def.pois || [],
    graph,
    stationLines,
    travelTimes,
  };
}

const CITIES = {};
for (const def of CITY_DEFS) CITIES[def.id] = buildCity(def);

function getCity(cityId) {
  return CITIES[cityId] || CITIES[DEFAULT_CITY];
}

function listCities() {
  return CITY_DEFS.map((d) => ({ id: d.id, name: d.name }));
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---- Custom (player-made) maps ----------------------------------------
// Turn a raw map definition (from the in-app Map Maker) into a playable city,
// validating and clamping everything and filling in travel times from distance.
function sanitizeColor(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#4b9fff';
}
function buildCustomCity(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('bad map');
  const stations = {};
  const rawStations = raw.stations && typeof raw.stations === 'object' ? raw.stations : {};
  for (const id of Object.keys(rawStations).slice(0, 250)) {
    const s = rawStations[id];
    if (!s || typeof s.lat !== 'number' || typeof s.lng !== 'number') continue;
    if (Math.abs(s.lat) > 90 || Math.abs(s.lng) > 180) continue;
    stations[id] = { id, name: String(s.name || id).slice(0, 40), lat: s.lat, lng: s.lng };
    if (s.region) stations[id].region = String(s.region).slice(0, 40);
  }
  const ids = Object.keys(stations);
  if (ids.length < 2) throw new Error('a map needs at least 2 stations');

  const lines = (Array.isArray(raw.lines) ? raw.lines : []).slice(0, 40).map((l, li) => {
    const stops = (Array.isArray(l.stops) ? l.stops : []).filter((id) => stations[id]);
    const hops = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stations[stops[i]], b = stations[stops[i + 1]];
      const km = haversineMeters(a.lat, a.lng, b.lat, b.lng) / 1000;
      hops.push(Math.max(1, Math.round(km * 2))); // ~30 km/h incl. stops
    }
    return { id: l.id || `L${li}`, name: String(l.name || `Line ${li + 1}`).slice(0, 40),
      color: sanitizeColor(l.color), stops, hops };
  }).filter((l) => l.stops.length >= 2);
  if (!lines.length) throw new Error('a map needs at least one line connecting 2+ stations');

  const cLat = ids.reduce((s, id) => s + stations[id].lat, 0) / ids.length;
  const cLng = ids.reduce((s, id) => s + stations[id].lng, 0) / ids.length;
  const startStation = stations[raw.startStation] ? raw.startStation : lines[0].stops[0];

  const def = {
    id: 'custom', name: String(raw.name || 'Custom Map').slice(0, 40),
    center: [cLat, cLng], zoom: Number(raw.zoom) || 12,
    startStation, stations, lines,
    stationRegions: raw.stationRegions && typeof raw.stationRegions === 'object' ? raw.stationRegions : undefined,
    pois: Array.isArray(raw.pois) ? raw.pois.slice(0, 60) : [],
    vehicle: raw.vehicle === 'bus' ? 'bus' : 'train',
    custom: true,
  };
  const city = buildCity(def);
  city.custom = true;
  return city;
}

// Backward-compatible SF exports (used by older tests that predate multi-city)
const sf = CITIES[DEFAULT_CITY];

module.exports = {
  getCity, listCities, CITIES, DEFAULT_CITY, haversineMeters,
  buildCity, buildCustomCity,
  STATIONS: sf.stations,
  LINES: sf.lines,
  STATION_LINES: sf.stationLines,
  travelTimes: sf.travelTimes,
};
