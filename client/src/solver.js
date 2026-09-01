// Exclusion solver: which station zones can still contain the hider?
// Pure module (no React/Leaflet) so the server test suite can import it.

export function metersBetween(a, b) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Compass bearing in degrees (0 = north, 90 = east) from point a to point b.
export function bearingBetween(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// The stations one hop away from `stationId`, with the bearing to face to reach
// each and a line colour. Used to float "ride here" buttons over Street View.
export function neighborsWithBearing(network, stationId) {
  const here = network.stations[stationId];
  if (!here) return [];
  const seen = new Map(); // neighborId -> { id, name, bearing, color }
  for (const line of network.lines) {
    const i = line.stops.indexOf(stationId);
    if (i === -1) continue;
    for (const j of [i - 1, i + 1]) {
      const nid = line.stops[j];
      if (!nid || seen.has(nid)) continue;
      const n = network.stations[nid];
      seen.set(nid, { id: nid, name: n.name, bearing: bearingBetween(here, n), color: line.color });
    }
  }
  return [...seen.values()];
}

// For a matching answer, find the landmark the seekers matched against (star)
// and the rest of that category (rivals). The hider's nearest landmark is the
// star (YES) or one of the rivals (NO) — i.e. the hider is inside / outside the
// star's Voronoi cell.
export function matchPois(network, q) {
  const pois = (network.pois || []).filter((p) => p.category === q.category);
  const star = pois.find((p) => p.id === q.poiId);
  if (!star) return null;
  return { star, rivals: pois.filter((p) => p.id !== star.id) };
}

// Geometric constraints for pixel-exact shading: the hider's point itself
// must satisfy these, so the map can grey partial zones (e.g. the wrong half
// of a zone a compass line cuts through, or the wrong Voronoi cell).
export function geoConstraints(feed, network) {
  return feed
    .filter((f) => f.kind === 'question' && f.answer)
    .flatMap((q) => {
      if (q.type === 'radar' && q.center) {
        return [{
          kind: q.answer.startsWith('YES') ? 'inside' : 'outside',
          center: q.center,
          radius: q.radiusKm * 1000,
        }];
      }
      if (q.type === 'compass' && q.center) {
        return [{ kind: 'halfplane', center: q.center, dir: q.answer }];
      }
      if (q.type === 'matching' && network) {
        if (q.region) return []; // regions filter whole stations, no point-level shape
        const m = matchPois(network, q);
        if (!m || !m.rivals.length) return [];
        return [{ kind: q.answer.startsWith('YES') ? 'cellIn' : 'cellOut', star: m.star, rivals: m.rivals }];
      }
      return [];
    });
}

// The hider must be within `zoneR` of some station, so each answer either
// keeps or eliminates whole zones. Conservative: a zone survives unless the
// answer rules out ALL of it.
export function possibleStations(network, feed, zoneR) {
  const linesOf = {};
  for (const l of network.lines) for (const s of l.stops) (linesOf[s] = linesOf[s] || []).push(l.id);
  const latPad = zoneR / 111320;
  const questions = feed.filter((f) => f.kind === 'question' && f.answer);

  return Object.values(network.stations).filter((s) => {
    const lngPad = zoneR / (111320 * Math.cos((s.lat * Math.PI) / 180));
    for (const q of questions) {
      const yes = q.answer.startsWith('YES');
      if (q.type === 'radar' && q.center) {
        const d = metersBetween(q.center, s);
        const R = q.radiusKm * 1000;
        if (yes && d - zoneR > R) return false;   // hider inside R, zone fully outside
        if (!yes && d + zoneR <= R) return false; // hider outside R, zone fully inside
      } else if (q.type === 'rightStation' && q.stationId) {
        if (yes ? s.id !== q.stationId : s.id === q.stationId) return false;
      } else if (q.type === 'sameLine' && q.stationId) {
        const shares = (linesOf[s.id] || []).some((l) => (linesOf[q.stationId] || []).includes(l));
        if (yes ? !shares : shares) return false;
      } else if (q.type === 'compass' && q.center) {
        // answer = the side the hider is on; eliminate zones fully on the other side
        if (q.answer === 'NORTH' && s.lat + latPad < q.center.lat) return false;
        if (q.answer === 'SOUTH' && s.lat - latPad > q.center.lat) return false;
        if (q.answer === 'EAST' && s.lng + lngPad < q.center.lng) return false;
        if (q.answer === 'WEST' && s.lng - lngPad > q.center.lng) return false;
      } else if (q.type === 'matching' && q.region) {
        // same-region questions keep/drop whole stations by their real region
        if (yes ? s.region !== q.poiId : s.region === q.poiId) return false;
      } else if (q.type === 'matching') {
        const m = matchPois(network, q);
        if (m && m.rivals.length) {
          const dStar = metersBetween(s, m.star);
          if (yes) {
            // hider in star's cell — drop zones lying entirely in a rival's cell
            for (const Q of m.rivals)
              if (metersBetween(s, Q) + zoneR < dStar - zoneR) return false;
          } else {
            // hider NOT in star's cell — drop zones lying entirely in star's cell
            const minRival = Math.min(...m.rivals.map((Q) => metersBetween(s, Q)));
            if (dStar + zoneR < minRival - zoneR) return false;
          }
        }
      }
    }
    return true;
  });
}

// Could the hider be standing at this exact point? Used to warn a seeker who
// wanders (in Street View) into an area their own answers have ruled out.
// The point must be within zoneR of a still-possible station AND satisfy every
// geometric answer exactly.
export function isPointPossible(network, feed, zoneR, pt) {
  const near = possibleStations(network, feed, zoneR).some((s) => metersBetween(s, pt) <= zoneR);
  if (!near) return false;
  for (const c of geoConstraints(feed, network)) {
    if (c.kind === 'inside' && metersBetween(c.center, pt) > c.radius) return false;
    if (c.kind === 'outside' && metersBetween(c.center, pt) <= c.radius) return false;
    if (c.kind === 'halfplane') {
      if (c.dir === 'NORTH' && pt.lat < c.center.lat) return false;
      if (c.dir === 'SOUTH' && pt.lat > c.center.lat) return false;
      if (c.dir === 'EAST' && pt.lng < c.center.lng) return false;
      if (c.dir === 'WEST' && pt.lng > c.center.lng) return false;
    }
    if (c.kind === 'cellIn' || c.kind === 'cellOut') {
      const dStar = metersBetween(c.star, pt);
      const inCell = c.rivals.every((Q) => metersBetween(Q, pt) >= dStar);
      if (c.kind === 'cellIn' && !inCell) return false;
      if (c.kind === 'cellOut' && inCell) return false;
    }
  }
  return true;
}
