// "Suggest lines" for the Map Maker. First asks OpenStreetMap (Overpass API)
// for the REAL rail / tram / bus routes running through the area on screen.
// If there aren't any, a route planner recommends a line instead: it threads
// the area's real stops (or the player's own unconnected stations) along the
// area's main axis, spaced like a proper transit line.
import { metersBetween } from './solver';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const COLORS = ['#e2231a', '#0077c8', '#009b3a', '#f9a01b', '#7a3fbf', '#00b3b3', '#e2007a', '#66421b'];
const MAX_LINES = 8;
// heavier rail first — metros before trams / cable cars
const RANK = { subway: 0, light_rail: 1, train: 2, monorail: 3, tram: 4, bus: 0, trolleybus: 1 };

async function overpass(q) {
  const r = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(q),
  });
  if (!r.ok) throw new Error(r.status === 429 ? 'OpenStreetMap is busy — try again in a minute' : `OpenStreetMap error ${r.status}`);
  return r.json();
}

const bboxStr = (b) => `${b.south},${b.west},${b.north},${b.east}`;

// Collapse nearby stop nodes into one station (a real station has a node per
// platform / direction). Same name within 400m, or anything within 70m, merges.
function makeStationMerger() {
  const list = [];
  return {
    add(name, lat, lng) {
      for (const s of list) {
        const d = metersBetween(s, { lat, lng });
        if ((name && s.name === name && d < 400) || d < 70) return s.id;
      }
      const id = `sg${list.length + 1}`;
      list.push({ id, name: name || `Stop ${list.length + 1}`, lat, lng });
      return id;
    },
    all: () => Object.fromEntries(list.map((s) => [s.id, s])),
  };
}

// ---- 1) real routes from OpenStreetMap ----
async function realRoutes(bounds, vehicle) {
  const kinds = vehicle === 'bus' ? 'bus|trolleybus' : 'subway|light_rail|tram|train|monorail';
  const bb = bboxStr(bounds);
  const data = await overpass(
    `[out:json][timeout:25];relation["type"="route"]["route"~"^(${kinds})$"](${bb})->.r;.r out body;node(r.r)(${bb});out;`
  );
  const nodes = new Map();
  for (const e of data.elements) if (e.type === 'node') nodes.set(e.id, e);
  const rels = data.elements.filter((e) => e.type === 'relation');

  const merger = makeStationMerger();
  const byKey = new Map(); // one line per ref/name (routes come in both directions)
  for (const rel of rels) {
    const members = rel.members.filter((m) => m.type === 'node' && nodes.has(m.ref));
    let picks = members.filter((m) => /^stop/.test(m.role || ''));
    if (picks.length < 2) picks = members.filter((m) => /^platform/.test(m.role || ''));
    if (picks.length < 2) continue;
    const stops = [];
    for (const m of picks) {
      const n = nodes.get(m.ref);
      const id = merger.add(n.tags?.name, n.lat, n.lon);
      if (stops[stops.length - 1] !== id && !stops.includes(id)) stops.push(id);
    }
    if (stops.length < 2) continue;
    const t = rel.tags || {};
    const key = `${t.route}:${t.ref || t.name || rel.id}`;
    const color = /^#[0-9a-f]{6}$/i.test(t.colour || '') ? t.colour : null;
    const prev = byKey.get(key);
    if (!prev || prev.stops.length < stops.length) {
      byKey.set(key, { rank: RANK[t.route] ?? 5, name: t.ref ? `${t.ref}${t.name ? ' — ' + shortName(t.name, t.ref) : ''}` : (t.name || 'Line'), color, stops });
    }
  }
  const lines = [...byKey.values()]
    .sort((a, b) => a.rank - b.rank || b.stops.length - a.stops.length)
    .slice(0, MAX_LINES)
    .map(({ rank, ...l }, i) => ({ ...l, color: l.color || COLORS[i % COLORS.length] }));
  const stations = merger.all();
  // keep only stations some chosen line actually uses
  const used = new Set(lines.flatMap((l) => l.stops));
  for (const id of Object.keys(stations)) if (!used.has(id)) delete stations[id];
  return { stations, lines };
}

// "Bus 38: Geary → Ferry" style names are long; trim to the useful part.
function shortName(name, ref) {
  let n = name.replace(new RegExp(`^(Bus|Tram|Train|Subway|Line)?\\s*${ref}\\s*[:\\-–]?\\s*`, 'i'), '');
  if (n.length > 28) n = n.slice(0, 27) + '…';
  return n || name;
}

// ---- 2) the route planner fallback ----
// Principal axis of a point cloud (in local metres) — the "long way" across it.
function principalAxis(pts) {
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lng0 = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  const xy = pts.map((p) => ({ x: (p.lng - lng0) * kx, y: (p.lat - lat0) * ky }));
  let sxx = 0, syy = 0, sxy = 0;
  for (const q of xy) { sxx += q.x * q.x; syy += q.y * q.y; sxy += q.x * q.y; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(ang), uy = Math.sin(ang);
  return xy.map((q) => ({ along: q.x * ux + q.y * uy, off: -q.x * uy + q.y * ux }));
}

// Thread a line through candidate stops: stay near the main axis, keep a
// sensible spacing, and run end to end.
function threadLine(cands, maxStops = 10) {
  if (cands.length < 2) return [];
  const proj = principalAxis(cands);
  const span = Math.max(...proj.map((p) => p.along)) - Math.min(...proj.map((p) => p.along));
  const corridor = Math.max(250, span * 0.18);
  const spacing = Math.max(300, span / (maxStops + 1));
  const inCorridor = cands.map((c, i) => ({ c, ...proj[i] }))
    .filter((p) => Math.abs(p.off) <= corridor)
    .sort((a, b) => a.along - b.along);
  const out = [];
  for (const p of inCorridor) {
    const last = out[out.length - 1];
    if (!last || p.along - last.along >= spacing) out.push(p);
  }
  return out.slice(0, maxStops).map((p) => p.c);
}

// a) connect the player's own stations that no line serves yet
function ownStationsLine(userStations, userLines) {
  const onLine = new Set(userLines.flatMap((l) => l.stops));
  const loose = Object.values(userStations).filter((s) => !onLine.has(s.id));
  if (loose.length < 3) return null;
  const picked = threadLine(loose, 14);
  if (picked.length < 2) return null;
  return { name: 'Recommended: connect your stations', color: COLORS[userLines.length % COLORS.length], stops: picked.map((s) => s.id) };
}

async function plannedLine(bounds, userLines) {
  // b) real stops in the area, threaded into one strong line
  let cands = [];
  try {
    const bb = bboxStr(bounds);
    const data = await overpass(
      `[out:json][timeout:20];(node["railway"~"^(station|halt|tram_stop)$"](${bb});node["public_transport"="station"](${bb});node["highway"="bus_stop"](${bb}););out 400;`
    );
    const merger = makeStationMerger();
    for (const e of data.elements) merger.add(e.tags?.name, e.lat, e.lon);
    cands = Object.values(merger.all());
  } catch { /* offline / busy — fall through to geometry */ }
  if (cands.length < 4) {
    // c) no stops mapped — run the line down the area's main road instead
    try {
      const bb = bboxStr(bounds);
      const data = await overpass(
        `[out:json][timeout:20];way["highway"~"^(trunk|primary|secondary|tertiary)$"](${bb});out geom 300;`
      );
      const byRoad = new Map(); // road name -> { len, pts }
      const dLat = (bounds.north - bounds.south) * 0.25, dLng = (bounds.east - bounds.west) * 0.25;
      const inner = (g) => g.lat <= bounds.north - dLat && g.lat >= bounds.south + dLat && g.lon <= bounds.east - dLng && g.lon >= bounds.west + dLng;
      for (const w of data.elements) {
        if (!w.geometry || w.geometry.length < 2) continue;
        const nm = w.tags?.name || w.tags?.ref || 'Main road';
        const r = byRoad.get(nm) || { len: 0, pts: [] };
        // only road length through the middle of the view counts — the line
        // should run through town, not along a highway at the edge
        for (let i = 1; i < w.geometry.length; i++) {
          if (!inner(w.geometry[i]) || !inner(w.geometry[i - 1])) continue;
          r.len += metersBetween({ lat: w.geometry[i - 1].lat, lng: w.geometry[i - 1].lon }, { lat: w.geometry[i].lat, lng: w.geometry[i].lon });
        }
        const inView = w.geometry.filter((g) => g.lat <= bounds.north && g.lat >= bounds.south && g.lon <= bounds.east && g.lon >= bounds.west);
        r.pts.push(...inView.map((g) => ({ lat: g.lat, lng: g.lon })));
        byRoad.set(nm, r);
      }
      const [road, best] = [...byRoad.entries()].sort((x, y) => y[1].len - x[1].len)[0] || [];
      if (best && best.pts.length >= 4) {
        cands = best.pts.map((p, i) => ({ id: `sg${i + 1}`, name: road, lat: p.lat, lng: p.lng }));
        const picked = threadLine(cands, 8).map((p, i) => ({ ...p, name: `${road} · Stop ${i + 1}` }));
        if (picked.length >= 2) {
          return {
            stations: Object.fromEntries(picked.map((p) => [p.id, p])),
            lines: [{ name: `Recommended: ${road} line`, color: COLORS[userLines.length % COLORS.length], stops: picked.map((p) => p.id) }],
          };
        }
      }
    } catch { /* fall through to geometry */ }
    // d) nothing mapped at all — lay stations along the long axis of the view
    const n = 7;
    const { north, south, east, west } = bounds;
    const wide = (east - west) * Math.cos((((north + south) / 2) * Math.PI) / 180) > (north - south);
    cands = Array.from({ length: n }, (_, i) => {
      const t = 0.12 + (0.76 * i) / (n - 1);
      return wide
        ? { id: `sg${i + 1}`, name: `Stop ${i + 1}`, lat: (north + south) / 2, lng: west + (east - west) * t }
        : { id: `sg${i + 1}`, name: `Stop ${i + 1}`, lat: south + (north - south) * t, lng: (east + west) / 2 };
    });
  }
  const picked = threadLine(cands, 10);
  return {
    stations: Object.fromEntries(picked.map((s) => [s.id, s])),
    lines: [{ name: 'Recommended line', color: COLORS[userLines.length % COLORS.length], stops: picked.map((s) => s.id) }],
  };
}

// bounds: { north, south, east, west }. Returns { source, note, stations, lines }.
export async function suggestLines(bounds, vehicle, userStations, userLines) {
  const spanKm = metersBetween({ lat: bounds.south, lng: bounds.west }, { lat: bounds.north, lng: bounds.east }) / 1000;
  if (spanKm > 60) throw new Error('Zoom in to a city first — the area on screen is too big to search');
  const own = ownStationsLine(userStations, userLines); // stops are the player's station ids
  let real = null;
  try { real = await realRoutes(bounds, vehicle); } catch (e) { if (/busy/.test(e.message)) throw e; }
  if (real && real.lines.length) {
    return {
      source: 'osm',
      note: `Found ${real.lines.length} real ${vehicle === 'bus' ? 'bus route' : 'line'}${real.lines.length === 1 ? '' : 's'} here on OpenStreetMap.`,
      stations: real.stations,
      lines: own ? [own, ...real.lines] : real.lines,
    };
  }
  if (own) return { source: 'planner', note: 'Here\'s a recommended line threading your stations end to end.', stations: {}, lines: [own] };
  const plan = await plannedLine(bounds, userLines);
  return { source: 'planner', note: `No real ${vehicle === 'bus' ? 'bus routes' : 'rail lines'} mapped here — here's a recommended line through the area.`, ...plan };
}
