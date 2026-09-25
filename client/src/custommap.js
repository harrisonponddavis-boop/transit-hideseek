import { metersBetween } from './solver';

// Ride time (minutes) between consecutive stops, from distance — mirrors the
// server's buildCustomCity so the client and server agree on a custom map.
export function computeHops(stations, stops) {
  const hops = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stations[stops[i]], b = stations[stops[i + 1]];
    if (!a || !b) { hops.push(1); continue; }
    const km = metersBetween(a, b) / 1000;
    hops.push(Math.max(1, Math.round(km * 2)));
  }
  return hops;
}

// The client "network" shape (what /network/:city returns) for a custom map,
// so a custom solo game renders without a server round-trip.
export function buildCustomNetwork(def) {
  const stations = def.stations || {};
  const ids = Object.keys(stations);
  const cLat = ids.reduce((s, id) => s + stations[id].lat, 0) / (ids.length || 1);
  const cLng = ids.reduce((s, id) => s + stations[id].lng, 0) / (ids.length || 1);
  const lines = (def.lines || []).map((l) => ({ ...l, hops: computeHops(stations, l.stops) }));
  return {
    id: 'custom',
    name: def.name || 'Custom Map',
    center: def.center || [cLat, cLng],
    zoom: def.zoom || 13,
    vehicle: def.vehicle === 'bus' ? 'bus' : 'train',
    startStation: def.startStation || lines[0]?.stops?.[0] || ids[0],
    stations,
    lines,
    pois: [],
    matchCategories: [],
    photoKinds: {},
  };
}
