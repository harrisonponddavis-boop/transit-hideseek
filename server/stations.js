// City registry: loads each city definition and builds the derived data the
// game needs (adjacency graph, per-station line lists, shortest-path times).
// Add a city by dropping a file in cities/ and listing it in CITY_DEFS.

const CITY_DEFS = [
  require('./cities/sf'),
  require('./cities/nyc'),
  require('./cities/chicago'),
  require('./cities/tokyo'),
];
const DEFAULT_CITY = 'sf';

// What you ride inside each city (drives the "inside the vehicle" screen)
const VEHICLES = { sf: 'bus', chicago: 'train', nyc: 'train', tokyo: 'train' };

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

// Backward-compatible SF exports (used by older tests that predate multi-city)
const sf = CITIES[DEFAULT_CITY];

module.exports = {
  getCity, listCities, CITIES, DEFAULT_CITY, haversineMeters,
  STATIONS: sf.stations,
  LINES: sf.lines,
  STATION_LINES: sf.stationLines,
  travelTimes: sf.travelTimes,
};
