import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const TILE_URLS = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
};
const MARKER_COLORS = {
  dark: { stroke: '#e8e4d8', fill: '#0b0d11' },
  light: { stroke: '#23252b', fill: '#ffffff' },
};
// Two tones: a faint wash for "outside any station's zone" (unlikely but not
// ruled out by a question), and a heavy shade for areas a question has
// positively eliminated.
const SHADE_COLORS = {
  dark: { faint: 'rgba(0, 0, 0, 0.22)', heavy: 'rgba(0, 0, 0, 0.62)' },
  light: { faint: 'rgba(96, 88, 70, 0.14)', heavy: 'rgba(70, 60, 40, 0.45)' },
};

// Clip a polygon to one half-plane (Sutherland–Hodgman). Keep points p with
// dot(p - mid, dir) >= 0 — i.e. the side of the bisector nearest `star`.
function clipHalfplane(poly, mid, dir) {
  const f = (p) => (p.x - mid.x) * dir.x + (p.y - mid.y) * dir.y;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], prev = poly[(i + poly.length - 1) % poly.length];
    const fc = f(cur), fp = f(prev);
    if (fc >= 0) {
      if (fp < 0) { const t = fp / (fp - fc); out.push({ x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) }); }
      out.push(cur);
    } else if (fp >= 0) {
      const t = fp / (fp - fc);
      out.push({ x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) });
    }
  }
  return out;
}

// The Voronoi cell of `star` against `rivals`, as a pixel polygon clipped to a
// generous box. Intersection of the half-planes nearer to star than each rival.
function voronoiCellPixels(px, star, rivals, w, h) {
  const B = 100000;
  let poly = [{ x: -B, y: -B }, { x: w + B, y: -B }, { x: w + B, y: h + B }, { x: -B, y: h + B }];
  const sp = px(star.lat, star.lng);
  for (const Q of rivals) {
    const qp = px(Q.lat, Q.lng);
    const mid = { x: (sp.x + qp.x) / 2, y: (sp.y + qp.y) / 2 };
    const dir = { x: sp.x - qp.x, y: sp.y - qp.y };
    poly = clipHalfplane(poly, mid, dir);
    if (poly.length < 3) break;
  }
  return poly;
}

function fillPolygon(ctx, poly) {
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
  ctx.fill();
}

// Two-tone shading. The hider must be within `radius` of a station, so the
// whole map gets a faint wash with the station zones punched clear. Then any
// area a *question* has ruled out (an eliminated zone, or the wrong side of a
// radar / compass / matching answer) is painted with a heavy shade on top.
function drawShade(map, canvas, data) {
  const size = map.getSize();
  canvas.width = size.x;
  canvas.height = size.y;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size.x, size.y);
  // container may not be laid out yet (0x0) — drawImage from a 0-size canvas throws
  if (!data || !data.stations || size.x === 0 || size.y === 0) return;

  const px = (lat, lng) => map.latLngToContainerPoint([lat, lng]);
  const radiusPx = (lat, lng, meters) => {
    const p = px(lat, lng);
    const edge = px(lat, lng + meters / (111320 * Math.cos((lat * Math.PI) / 180)));
    return Math.abs(edge.x - p.x);
  };
  const scratch = (key) => {
    const c = (canvas[key] = canvas[key] || document.createElement('canvas'));
    c.width = size.x; c.height = size.y;
    return c.getContext('2d');
  };
  const fillZones = (g, stations) => {
    g.fillStyle = '#fff';
    for (const s of stations) {
      const p = px(s.lat, s.lng);
      g.beginPath();
      g.arc(p.x, p.y, radiusPx(s.lat, s.lng, data.radius), 0, Math.PI * 2);
      g.fill();
    }
  };

  // allZones = union of EVERY station's zone (the "must be near a station" area)
  const a = scratch('_allMask');
  a.clearRect(0, 0, size.x, size.y);
  fillZones(a, data.allStations || data.stations);

  // mask = where the hider COULD still be: surviving zones, clipped by answers
  const mask = (canvas._mask = canvas._mask || document.createElement('canvas'));
  mask.width = size.x; mask.height = size.y;
  const m = mask.getContext('2d');
  m.clearRect(0, 0, size.x, size.y);
  fillZones(m, data.stations);
  for (const c of data.constraints || []) {
    if (c.kind === 'inside') {
      m.globalCompositeOperation = 'destination-in';
      const p = px(c.center.lat, c.center.lng);
      m.beginPath();
      m.arc(p.x, p.y, radiusPx(c.center.lat, c.center.lng, c.radius), 0, Math.PI * 2);
      m.fill();
    } else if (c.kind === 'outside') {
      m.globalCompositeOperation = 'destination-out';
      const p = px(c.center.lat, c.center.lng);
      m.beginPath();
      m.arc(p.x, p.y, radiusPx(c.center.lat, c.center.lng, c.radius), 0, Math.PI * 2);
      m.fill();
    } else if (c.kind === 'halfplane') {
      m.globalCompositeOperation = 'destination-in';
      const p = px(c.center.lat, c.center.lng);
      if (c.dir === 'NORTH') m.fillRect(0, 0, size.x, p.y);
      else if (c.dir === 'SOUTH') m.fillRect(0, p.y, size.x, size.y - p.y);
      else if (c.dir === 'EAST') m.fillRect(p.x, 0, size.x - p.x, size.y);
      else if (c.dir === 'WEST') m.fillRect(0, 0, p.x, size.y);
    } else if (c.kind === 'cellIn' || c.kind === 'cellOut') {
      const poly = voronoiCellPixels(px, c.star, c.rivals, size.x, size.y);
      if (poly.length >= 3) {
        m.globalCompositeOperation = c.kind === 'cellIn' ? 'destination-in' : 'destination-out';
        fillPolygon(m, poly);
      } else if (c.kind === 'cellIn') {
        m.clearRect(0, 0, size.x, size.y); // empty cell — nothing possible
      }
    }
  }
  m.globalCompositeOperation = 'source-over';

  // 1) faint wash everywhere outside any station zone
  ctx.fillStyle = data.colors.faint;
  ctx.fillRect(0, 0, size.x, size.y);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(a.canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';

  // 2) heavy shade on the eliminated region = allZones minus the possible mask
  const d = scratch('_darkMask');
  d.clearRect(0, 0, size.x, size.y);
  d.drawImage(a.canvas, 0, 0);            // every station zone
  d.globalCompositeOperation = 'destination-out';
  d.drawImage(mask, 0, 0);                // erase what's still possible
  d.globalCompositeOperation = 'source-in';
  d.fillStyle = data.colors.heavy;        // tint the remainder to the heavy shade
  d.fillRect(0, 0, size.x, size.y);
  d.globalCompositeOperation = 'source-over';
  ctx.drawImage(d.canvas, 0, 0);
}

// One Leaflet map. Static network drawn once; dynamic layer redrawn per render.
export default function MapView({
  network,            // { stations, lines }
  theme = 'dark',     // swaps tile set + marker contrast
  seekerStation,      // station id to highlight
  seekerPos,          // { lat, lng } where seekers actually stand
  walkPos,            // { lat, lng } when off-station (draws tether + foot marker)
  thermoStart,        // { lat, lng, label } where the thermometer was started, or null
  guessRange,         // { lat, lng, radius } pin reach circle (guess mode)
  preview,            // hover graphic: radar/radarResult/thermo/lines/compass/station
  radarHistory,       // [{ center, radiusKm, yes }] answered radars, always visible
  possibleZones,      // { stations: [{lat,lng}], radius } — everything else is greyed out
  hider,              // { lat, lng, stationId } or null
  zone,               // { lat, lng, radius } hiding-zone circle
  pin,                // { lat, lng } pending pin (hide spot or guess)
  guesses,            // [{ lat, lng, hit }]
  travelTimes,        // { stationId: mins } for tooltips
  clickMode,          // null | 'station' | 'point'
  onStationClick,
  onMapClick,
}) {
  const mapRef = useRef(null);
  const tileRef = useRef(null);
  const dynLayer = useRef(null);
  const shadeCanvas = useRef(null);
  const shadeData = useRef(null);
  const stationMarkers = useRef({});
  const handlers = useRef({});
  handlers.current = { onStationClick, onMapClick, clickMode };

  // init once network is loaded
  useEffect(() => {
    if (!network || mapRef.current) return;
    const map = L.map('map', { zoomControl: true, attributionControl: true });
    map.setView(network.center || [37.7649, -122.4394], network.zoom || 13);
    tileRef.current = L.tileLayer(TILE_URLS[theme] || TILE_URLS.dark, {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 20,
    }).addTo(map);

    for (const line of network.lines) {
      const pts = line.stops.map((id) => {
        const s = network.stations[id];
        return [s.lat, s.lng];
      });
      L.polyline(pts, { color: line.color, weight: 4, opacity: 0.75 }).addTo(map);
    }
    for (const s of Object.values(network.stations)) {
      const m = L.circleMarker([s.lat, s.lng], {
        radius: 6, color: '#e8e4d8', weight: 2, fillColor: '#0b0d11', fillOpacity: 1,
      }).addTo(map);
      m.on('click', () => {
        if (handlers.current.clickMode === 'station') handlers.current.onStationClick?.(s.id);
      });
      stationMarkers.current[s.id] = m;
    }
    map.on('click', (e) => {
      if (handlers.current.clickMode === 'point') handlers.current.onMapClick?.(e.latlng.lat, e.latlng.lng);
    });

    // exclusion shade: fixed to the map container (not a transformed pane)
    // and redrawn every frame, so panning/zooming never leaves it stale
    const canvas = document.createElement('canvas');
    canvas.style.pointerEvents = 'none';
    canvas.style.position = 'absolute';
    canvas.style.top = 0;
    canvas.style.left = 0;
    canvas.style.zIndex = 450; // above overlay SVG (400), below tooltips (650)
    map.getContainer().appendChild(canvas);
    shadeCanvas.current = canvas;
    const redrawShade = () => drawShade(map, canvas, shadeData.current);
    map.on('move zoom moveend zoomend viewreset resize', redrawShade);

    dynLayer.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    if (import.meta.env.DEV) window.__ths = { map, stationMarkers: stationMarkers.current };
  }, [network]);

  // exclusion shade: redraw when the possible zones or theme change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !shadeCanvas.current) return;
    shadeData.current = possibleZones
      ? {
          ...possibleZones,
          allStations: possibleZones.allStations || (network ? Object.values(network.stations) : possibleZones.stations),
          colors: SHADE_COLORS[theme] || SHADE_COLORS.dark,
        }
      : null;
    drawShade(map, shadeCanvas.current, shadeData.current);
    // repeat after layout settles — the first draw can land before the
    // container has a size (fresh mount), which leaves the shade blank
    const raf = requestAnimationFrame(() => drawShade(map, shadeCanvas.current, shadeData.current));
    return () => cancelAnimationFrame(raf);
  }, [possibleZones, theme, network]);

  // theme swap: tiles change, marker colors are handled by the dynamic effect
  useEffect(() => {
    tileRef.current?.setUrl(TILE_URLS[theme] || TILE_URLS.dark);
  }, [theme]);

  // dynamic layer: seeker/hider/zone/pin/guesses + tooltips
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !network) return;
    dynLayer.current.clearLayers();

    const mc = MARKER_COLORS[theme] || MARKER_COLORS.dark;
    for (const [id, m] of Object.entries(stationMarkers.current)) {
      const s = network.stations[id];
      const mins = travelTimes?.[id];
      const isSeeker = id === seekerStation;
      m.setStyle({
        color: isSeeker ? '#ffb000' : mc.stroke,
        fillColor: mc.fill,
        weight: isSeeker ? 3 : 2,
        radius: isSeeker ? 9 : 6,
      });
      m.unbindTooltip();
      m.bindTooltip(
        `<span class="station-tip"><b>${s.name}</b>${
          mins !== undefined && !isSeeker ? `<br/>${mins} min away` : isSeeker ? '<br/>SEEKERS HERE' : ''
        }</span>`,
        { direction: 'top', offset: [0, -8] }
      );
    }

    const dl = dynLayer.current;
    // overlays must never swallow clicks meant for stations or the map
    const passive = { interactive: false };
    if (seekerStation && network.stations[seekerStation]) {
      const s = network.stations[seekerStation];
      dl.addLayer(L.circle([s.lat, s.lng], { radius: 90, color: '#ffb000', weight: 1, fillOpacity: 0.15, ...passive }));
    }
    if (zone) {
      dl.addLayer(L.circle([zone.lat, zone.lng], {
        radius: zone.radius, color: '#ffb000', dashArray: '6 6', weight: 1.5, fillOpacity: 0.06, ...passive,
      }));
    }
    // answered radars stay on the map: faint green (inside) / red (outside)
    for (const rh of radarHistory || []) {
      const c = rh.yes ? '#28c76f' : '#ef4b5d';
      dl.addLayer(L.circle([rh.center.lat, rh.center.lng], {
        radius: rh.radiusKm * 1000, color: c, dashArray: '3 7', weight: 1.2, opacity: 0.55,
        fillColor: c, fillOpacity: rh.yes ? 0.05 : 0.015, ...passive,
      }));
    }
    if (hider) {
      dl.addLayer(L.circleMarker([hider.lat, hider.lng], {
        radius: 8, color: '#28c76f', weight: 3, fillColor: mc.fill, fillOpacity: 1,
      }).bindTooltip('<b>HIDER</b>', { permanent: false, direction: 'top' }));
    }
    if (pin) {
      dl.addLayer(L.circleMarker([pin.lat, pin.lng], {
        radius: 7, color: '#ef4b5d', weight: 3, fillColor: '#ef4b5d', fillOpacity: 0.4, ...passive,
      }));
    }
    for (const g of guesses || []) {
      dl.addLayer(L.circleMarker([g.lat, g.lng], {
        radius: 5, color: g.hit ? '#28c76f' : '#ef4b5d', weight: 2, fillOpacity: 0.25,
      }).bindTooltip(g.hit ? 'FOUND HERE' : 'wrong guess'));
    }

    // seekers on foot: dashed tether from station + a solid amber dot
    if (walkPos && seekerStation && network.stations[seekerStation]) {
      const s = network.stations[seekerStation];
      dl.addLayer(L.polyline([[s.lat, s.lng], [walkPos.lat, walkPos.lng]], {
        color: '#ffb000', dashArray: '4 7', weight: 2, opacity: 0.8, ...passive,
      }));
      dl.addLayer(L.circleMarker([walkPos.lat, walkPos.lng], {
        radius: 7, color: '#ffb000', weight: 3, fillColor: '#ffb000', fillOpacity: 0.55, ...passive,
      }));
    }

    // pin reach while in guess mode
    if (guessRange) {
      dl.addLayer(L.circle([guessRange.lat, guessRange.lng], {
        radius: guessRange.radius, color: '#ef4b5d', dashArray: '4 7', weight: 1.5, fillOpacity: 0.06, ...passive,
      }));
    }

    // hover previews for questions
    if (preview && seekerPos) {
      if (preview.type === 'radar') {
        dl.addLayer(L.circle([seekerPos.lat, seekerPos.lng], {
          radius: preview.radiusKm * 1000, color: '#ffb000', dashArray: '8 8', weight: 2, fillColor: '#ffb000', fillOpacity: 0.08, ...passive,
        }));
      } else if (preview.type === 'radarResult') {
        const c = preview.yes ? '#28c76f' : '#ef4b5d';
        dl.addLayer(L.circle([preview.center.lat, preview.center.lng], {
          radius: preview.radiusKm * 1000, color: c, dashArray: '8 8', weight: 2, fillColor: c, fillOpacity: 0.08, ...passive,
        }));
      } else if (preview.type === 'thermo') {
        if (thermoStart) {
          // reading: show the leg from where it was started to where we are now
          dl.addLayer(L.polyline([[thermoStart.lat, thermoStart.lng], [seekerPos.lat, seekerPos.lng]], {
            color: '#ffb000', weight: 3, dashArray: '2 8', opacity: 0.9, ...passive,
          }));
          dl.addLayer(L.circleMarker([thermoStart.lat, thermoStart.lng], {
            radius: 7, color: '#4a90d9', weight: 3, fillOpacity: 0.3, ...passive,
          }).bindTooltip(`<b>STARTED HERE</b><br/>${thermoStart.label}`, { permanent: true, direction: 'bottom' }));
          dl.addLayer(L.circleMarker([seekerPos.lat, seekerPos.lng], {
            radius: 7, color: '#ef4b5d', weight: 3, fillOpacity: 0.3, ...passive,
          }).bindTooltip('<b>WARMER OR COLDER HERE?</b>', { permanent: true, direction: 'top' }));
        } else {
          // starting: just mark where the reading will begin
          dl.addLayer(L.circleMarker([seekerPos.lat, seekerPos.lng], {
            radius: 7, color: '#4a90d9', weight: 3, fillOpacity: 0.3, ...passive,
          }).bindTooltip('<b>START THERMOMETER HERE</b>', { permanent: true, direction: 'top' }));
        }
      } else if (preview.type === 'lines' && seekerStation) {
        for (const line of network.lines.filter((l) => l.stops.includes(seekerStation))) {
          const pts = line.stops.map((id) => [network.stations[id].lat, network.stations[id].lng]);
          dl.addLayer(L.polyline(pts, { color: line.color, weight: 12, opacity: 0.35, ...passive }));
        }
      } else if (preview.type === 'station' && seekerStation) {
        const s = network.stations[seekerStation];
        dl.addLayer(L.circle([s.lat, s.lng], {
          radius: 150, color: '#ffb000', weight: 3, dashArray: '6 6', fillColor: '#ffb000', fillOpacity: 0.12, ...passive,
        }));
      } else if (preview.type === 'compass') {
        // span the current view (padded) so the divider is visible in any city
        const b = map.getBounds().pad(1.5);
        const pts = preview.axis === 'ew'
          ? [[b.getSouth(), seekerPos.lng], [b.getNorth(), seekerPos.lng]]
          : [[seekerPos.lat, b.getWest()], [seekerPos.lat, b.getEast()]];
        dl.addLayer(L.polyline(pts, { color: '#ffb000', dashArray: '10 10', weight: 2, opacity: 0.9, ...passive }));
        dl.addLayer(L.circleMarker([seekerPos.lat, seekerPos.lng], {
          radius: 6, color: '#ffb000', weight: 3, fillOpacity: 0.4, ...passive,
        }));
      } else if ((preview.type === 'match' || preview.type === 'matchResult') && network.pois) {
        const pois = network.pois.filter((p) => p.category === preview.category);
        // which landmark anchors the cell: the answered one, or the seeker's nearest
        let star;
        if (preview.type === 'matchResult') {
          star = pois.find((p) => p.id === preview.poiId);
        } else {
          let bd = Infinity;
          for (const p of pois) {
            const d = (p.lat - seekerPos.lat) ** 2 + (p.lng - seekerPos.lng) ** 2;
            if (d < bd) { bd = d; star = p; }
          }
        }
        // every landmark in the category, star highlighted
        for (const p of pois) {
          dl.addLayer(L.circleMarker([p.lat, p.lng], {
            radius: p === star ? 8 : 5, color: '#ffb000',
            weight: p === star ? 3 : 2, fillColor: '#1b1407', fillOpacity: 0.9, ...passive,
          }).bindTooltip(`<b>${p.name}</b>`, { direction: 'top' }));
        }
        if (star) {
          const rivals = pois.filter((p) => p.id !== star.id);
          const yes = preview.type === 'match' ? true : preview.yes;
          const color = preview.type === 'matchResult' ? (yes ? '#28c76f' : '#ef4b5d') : '#ffb000';
          const poly = voronoiCellPixels((lat, lng) => map.latLngToContainerPoint([lat, lng]), star, rivals, map.getSize().x, map.getSize().y);
          if (poly.length >= 3) {
            const latlngs = poly.map((pt) => map.containerPointToLatLng([pt.x, pt.y]));
            dl.addLayer(L.polygon(latlngs, {
              color, weight: 2, dashArray: '6 6', fillColor: color, fillOpacity: 0.1, ...passive,
            }));
          }
        }
      }
    }
  }, [network, seekerStation, seekerPos, walkPos, thermoStart, guessRange, preview, radarHistory, hider, zone, pin, guesses, travelTimes, theme]);

  return <div id="map" />;
}
