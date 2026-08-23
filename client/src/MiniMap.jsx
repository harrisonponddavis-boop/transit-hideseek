import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { possibleStations } from './solver';

const TILES = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
};

// Compact map: still-possible station zones (amber) + the seeker's position.
// When `onRide` is given, every station becomes tappable to ride there (a
// popup confirms with the travel time) — so you can travel from the map even
// in Street View mode. Read-only otherwise (e.g. beside the photo lightbox).
export default function MiniMap({ network, feed, zoneR, seekerPos, seekerStation, travelTimes, onRide, theme = 'dark' }) {
  const ref = useRef(null);
  const onRideRef = useRef(onRide); onRideRef.current = onRide;
  const travelRef = useRef(travelTimes); travelRef.current = travelTimes;

  useEffect(() => {
    if (!network || !ref.current) return;
    const map = L.map(ref.current, {
      zoomControl: !!onRide, attributionControl: false, keyboard: false,
    });
    L.tileLayer(TILES[theme] || TILES.dark, { maxZoom: 20 }).addTo(map);

    for (const line of network.lines) {
      const pts = line.stops.map((id) => [network.stations[id].lat, network.stations[id].lng]);
      L.polyline(pts, { color: line.color, weight: 3, opacity: 0.7 }).addTo(map);
    }

    const possible = possibleStations(network, feed, zoneR);
    const latlngs = [];
    for (const s of possible) {
      L.circle([s.lat, s.lng], {
        radius: zoneR, color: '#ffb000', weight: 1, fillColor: '#ffb000', fillOpacity: 0.18,
      }).addTo(map);
      latlngs.push([s.lat, s.lng]);
    }

    // tappable station markers for travelling from the map
    if (onRide) {
      for (const s of Object.values(network.stations)) {
        if (s.id === seekerStation) continue;
        const m = L.circleMarker([s.lat, s.lng], {
          radius: 6, color: '#e8e4d8', weight: 2, fillColor: '#0b0d11', fillOpacity: 1,
        }).addTo(map);
        const mins = travelRef.current?.[s.id];
        const coins = Math.max(2, Math.round((mins || 0) * 0.5));
        const box = document.createElement('div');
        box.className = 'mini-pop';
        box.innerHTML = `<b>${s.name}</b><span>${mins != null ? `ride · ${mins} min · +${coins}¢` : ''}</span>`;
        const btn = document.createElement('button');
        btn.textContent = 'Ride here';
        btn.onclick = () => { onRideRef.current?.(s.id); map.closePopup(); };
        box.appendChild(btn);
        m.bindPopup(box, { closeButton: false });
      }
    }

    if (seekerPos) {
      L.circleMarker([seekerPos.lat, seekerPos.lng], {
        radius: 7, color: '#ffb000', weight: 3, fillColor: '#1b1407', fillOpacity: 1,
      }).addTo(map);
      latlngs.push([seekerPos.lat, seekerPos.lng]);
    }

    if (latlngs.length) map.fitBounds(L.latLngBounds(latlngs).pad(0.4), { maxZoom: 15 });
    else map.setView(network.center || [0, 0], network.zoom || 12);

    if (import.meta.env.DEV && onRide) window.__mini = map;

    // re-fit tiles repeatedly across the CSS size transition, and on any resize
    const timers = [60, 220, 420].map((ms) => setTimeout(() => map.invalidateSize(), ms));
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(ref.current);
    return () => { timers.forEach(clearTimeout); ro.disconnect(); map.remove(); };
  }, [network, feed.length, seekerPos?.lat, seekerPos?.lng, seekerStation, zoneR, theme]);

  return <div className="mini-map" ref={ref} />;
}
