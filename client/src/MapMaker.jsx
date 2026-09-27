import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { saveMap, listMyMaps, deleteMap } from './auth';
import { suggestLines } from './suggest';

const TILE = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
const REF = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}';
const LINE_COLORS = ['#e2231a', '#0077c8', '#009b3a', '#f9a01b', '#7a3fbf', '#00b3b3', '#e2007a', '#66421b'];

// A player-made transit map: draw an area, drop stations, connect them into
// lines, then save it or play a solo hunt on it.
export default function MapMaker({ user, accounts, onPlay, onExit }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const idRef = useRef(1);

  const [name, setName] = useState('My Map');
  const [vehicle, setVehicle] = useState('train');
  const [stations, setStations] = useState({});
  const [lines, setLines] = useState([]);
  const [area, setArea] = useState([]);
  const [tool, setTool] = useState('station'); // 'station' | 'line' | 'area'
  const [lineDraft, setLineDraft] = useState(null); // station ids while drawing a line
  const [myMaps, setMyMaps] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [sugg, setSugg] = useState(null);      // { note, stations, lines } from Suggest lines
  const [suggPick, setSuggPick] = useState({}); // line index -> chosen
  const [suggBusy, setSuggBusy] = useState(false);

  // refs so Leaflet event handlers always see current values
  const toolRef = useRef(tool); toolRef.current = tool;
  const draftRef = useRef(lineDraft); draftRef.current = lineDraft;
  const stationsRef = useRef(stations); stationsRef.current = stations;
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 3500); };

  const addStation = (lat, lng, name) => {
    const id = `s${idRef.current++}`;
    setStations((prev) => ({ ...prev, [id]: { id, name: name || `Station ${Object.keys(prev).length + 1}`, lat, lng } }));
    return id;
  };
  const toggleInDraft = (id) => setLineDraft((d) => {
    if (!d) return d;
    if (d[d.length - 1] === id) return d.slice(0, -1); // tap the last again to undo
    return [...d, id];
  });

  // ---- Leaflet setup ----
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { zoomControl: true }).setView([37.79, -122.40], 13);
    L.tileLayer(TILE, { maxZoom: 19 }).addTo(map);
    L.tileLayer(REF, { maxZoom: 19 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    map.on('click', (e) => {
      const t = toolRef.current;
      if (t === 'station') addStation(e.latlng.lat, e.latlng.lng);
      else if (t === 'area') setArea((prev) => [...prev, [e.latlng.lat, e.latlng.lng]]);
      else if (t === 'line') {
        // drawing a line: tapping near a station adds it; tapping empty map
        // drops a new station there and adds that — so you can just draw
        const click = map.latLngToContainerPoint(e.latlng);
        let best = null, bestD = 22;
        for (const s of Object.values(stationsRef.current)) {
          const d = click.distanceTo(map.latLngToContainerPoint([s.lat, s.lng]));
          if (d < bestD) { bestD = d; best = s.id; }
        }
        toggleInDraft(best || addStation(e.latlng.lat, e.latlng.lng));
      }
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ---- redraw overlays whenever the map data changes ----
  useEffect(() => {
    const lg = layerRef.current; if (!lg) return;
    lg.clearLayers();
    if (area.length >= 2) {
      L.polygon(area, { color: '#8a72c8', weight: 2, dashArray: '5 5', fillOpacity: 0.06 }).addTo(lg);
    }
    // saved lines
    lines.forEach((l) => {
      const pts = l.stops.map((id) => stations[id]).filter(Boolean).map((s) => [s.lat, s.lng]);
      if (pts.length >= 2) L.polyline(pts, { color: l.color, weight: 5, opacity: 0.85 }).addTo(lg);
    });
    // line being drawn
    if (lineDraft && lineDraft.length >= 2) {
      const pts = lineDraft.map((id) => stations[id]).filter(Boolean).map((s) => [s.lat, s.lng]);
      L.polyline(pts, { color: LINE_COLORS[lines.length % LINE_COLORS.length], weight: 5, dashArray: '6 6' }).addTo(lg);
    }
    // suggested lines (preview)
    if (sugg) {
      sugg.lines.forEach((l, i) => {
        const pts = l.stops.map((id) => sugg.stations[id] || stations[id]).filter(Boolean).map((s) => [s.lat, s.lng]);
        if (pts.length < 2) return;
        L.polyline(pts, { color: l.color, weight: suggPick[i] ? 6 : 3, opacity: suggPick[i] ? 0.9 : 0.45, dashArray: '8 6' }).addTo(lg);
        pts.forEach((p) => L.circleMarker(p, { radius: 4, weight: 1, color: '#0b0d11', fillColor: '#fff', fillOpacity: suggPick[i] ? 1 : 0.6, interactive: false }).addTo(lg));
      });
    }
    // stations
    Object.values(stations).forEach((s) => {
      const inDraft = lineDraft && lineDraft.includes(s.id);
      const m = L.circleMarker([s.lat, s.lng], {
        radius: 9, weight: 2, color: '#0b0d11', bubblingMouseEvents: false,
        fillColor: inDraft ? '#ffd23f' : '#4b9fff', fillOpacity: 1,
      }).addTo(lg);
      m.bindTooltip(s.name, { permanent: false, direction: 'top' });
      m.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        if (toolRef.current === 'line' && draftRef.current) toggleInDraft(s.id);
      });
    });
  }, [stations, lines, area, lineDraft, sugg, suggPick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (accounts && user) listMyMaps().then(setMyMaps); }, [accounts, user]);

  // ---- line drawing ----
  const startLine = () => { setTool('line'); setLineDraft([]); };
  const finishLine = () => {
    if (!lineDraft || lineDraft.length < 2) { flash('Tap at least 2 stations to make a line'); return; }
    const color = LINE_COLORS[lines.length % LINE_COLORS.length];
    setLines((prev) => [...prev, { id: `L${prev.length + 1}`, name: `Line ${prev.length + 1}`, color, stops: lineDraft }]);
    setLineDraft(null); setTool('station');
  };
  const cancelLine = () => { setLineDraft(null); setTool('station'); };

  // ---- suggested lines: real OSM routes, or a recommended line ----
  const runSuggest = async () => {
    const map = mapRef.current; if (!map || suggBusy) return;
    const b = map.getBounds();
    setSuggBusy(true); setSugg(null);
    try {
      const r = await suggestLines({ north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() }, vehicle, stations, lines);
      setSugg(r);
      setSuggPick(Object.fromEntries(r.lines.map((_, i) => [i, i === 0])));
    } catch (e) { flash(e.message || 'Could not fetch suggestions'); }
    setSuggBusy(false);
  };
  const addSuggested = () => {
    if (!sugg) return;
    const chosen = sugg.lines.filter((_, i) => suggPick[i]);
    if (!chosen.length) { flash('Tick at least one line to add'); return; }
    const nextStations = { ...stations };
    const idFor = {}; // suggestion station id -> map station id
    const resolve = (sid) => {
      if (nextStations[sid] && !sugg.stations[sid]) return sid; // already one of yours
      if (idFor[sid]) return idFor[sid];
      const s = sugg.stations[sid];
      // reuse one of your stations if it's basically the same spot
      const near = Object.values(nextStations).find((x) => Math.abs(x.lat - s.lat) < 0.0006 && Math.abs(x.lng - s.lng) < 0.0008);
      if (near) return (idFor[sid] = near.id);
      const id = `s${idRef.current++}`;
      nextStations[id] = { id, name: s.name, lat: s.lat, lng: s.lng };
      return (idFor[sid] = id);
    };
    const newLines = chosen.map((l, k) => {
      const stops = [];
      for (const sid of l.stops) { const id = resolve(sid); if (stops[stops.length - 1] !== id) stops.push(id); }
      return { id: `L${Date.now().toString(36)}${k}`, name: l.name.replace(/^Recommended: connect your stations$/, 'Recommended line').replace(/^Recommended: /, ''), color: l.color, stops };
    }).filter((l) => l.stops.length >= 2);
    setStations(nextStations);
    setLines((prev) => [...prev, ...newLines]);
    setSugg(null);
    flash(`Added ${newLines.length} line${newLines.length === 1 ? '' : 's'} ✓`);
  };

  const removeStation = (id) => {
    setStations((prev) => { const n = { ...prev }; delete n[id]; return n; });
    setLines((prev) => prev.map((l) => ({ ...l, stops: l.stops.filter((x) => x !== id) })).filter((l) => l.stops.length >= 2));
  };
  const removeLine = (lid) => setLines((prev) => prev.filter((l) => l.id !== lid));
  const renameLine = (lid, nm) => setLines((prev) => prev.map((l) => (l.id === lid ? { ...l, name: nm } : l)));

  const buildDef = () => ({
    name: name.trim() || 'My Map', vehicle, area,
    stations, lines,
    startStation: lines[0]?.stops?.[0] || Object.keys(stations)[0],
  });

  const canPlay = Object.keys(stations).length >= 2 && lines.length >= 1;

  const doSave = async () => {
    if (!user) { flash('Sign in (on the home screen) to save maps'); return; }
    if (!canPlay) { flash('Add at least 2 stations and 1 line first'); return; }
    setBusy(true);
    const r = await saveMap(name.trim() || 'My Map', buildDef(), editingId);
    setBusy(false);
    if (r?.error) { flash(r.error); return; }
    setEditingId(r.id);
    flash('Saved ✓');
    listMyMaps().then(setMyMaps);
  };

  const loadMap = (m) => {
    const d = m.def || {};
    setName(m.name || d.name || 'My Map');
    setVehicle(d.vehicle === 'bus' ? 'bus' : 'train');
    setStations(d.stations || {});
    setLines(d.lines || []);
    setArea(d.area || []);
    setEditingId(m.id);
    setLineDraft(null); setTool('station');
    // bump the id counter past any existing station ids
    const maxN = Object.keys(d.stations || {}).reduce((mx, id) => Math.max(mx, parseInt(String(id).replace(/\D/g, ''), 10) || 0), 0);
    idRef.current = maxN + 1;
    const ids = Object.keys(d.stations || {});
    if (ids.length && mapRef.current) {
      const b = L.latLngBounds(ids.map((id) => [d.stations[id].lat, d.stations[id].lng]));
      mapRef.current.fitBounds(b.pad(0.2));
    }
  };
  const removeMap = async (id) => { await deleteMap(id); if (editingId === id) setEditingId(null); listMyMaps().then(setMyMaps); };

  const search = async (e) => {
    e?.preventDefault?.();
    if (!query.trim()) return;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`);
      const d = await r.json();
      if (d[0] && mapRef.current) mapRef.current.setView([parseFloat(d[0].lat), parseFloat(d[0].lon)], 14);
      else flash('Place not found');
    } catch { flash('Search unavailable'); }
  };

  const stationList = Object.values(stations);

  return (
    <div className="mm-shell">
      <div className="mm-mapwrap">
        <div ref={elRef} className="mm-map" />
        <form className="mm-search" onSubmit={search}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a place (e.g. Seattle)…" />
          <button className="small" type="submit">Go</button>
        </form>
        <div className="mm-toolbar">
          <button className={tool === 'station' ? '' : 'ghost'} onClick={() => { setTool('station'); setLineDraft(null); }}>📍 Add stations</button>
          {tool === 'line' ? (
            <>
              <button onClick={finishLine}>✓ Finish line ({lineDraft?.length || 0})</button>
              <button className="ghost" onClick={cancelLine}>Cancel</button>
            </>
          ) : (
            <button className="ghost" onClick={startLine}>➕ New line</button>
          )}
          <button className={tool === 'area' ? '' : 'ghost'} onClick={() => { setTool('area'); setLineDraft(null); }}>⬡ Area</button>
          {tool === 'area' && area.length > 0 && <button className="ghost" onClick={() => setArea([])}>Clear area</button>}
          <button className="mm-suggest" onClick={runSuggest} disabled={suggBusy}>{suggBusy ? 'Thinking…' : '✨ Suggest lines'}</button>
        </div>
        {sugg && (
          <div className="mm-sugg">
            <div className="mm-sugg-head">✨ {sugg.note}</div>
            <div className="mm-sugg-list">
              {sugg.lines.map((l, i) => (
                <label className="mm-sugg-row" key={i}>
                  <input type="checkbox" checked={!!suggPick[i]} onChange={(e) => setSuggPick((p) => ({ ...p, [i]: e.target.checked }))} />
                  <span className="mm-dot" style={{ background: l.color }} />
                  <span className="mm-sugg-name">{l.name}</span>
                  <span className="hint" style={{ fontSize: 11 }}>{l.stops.length} stops</span>
                </label>
              ))}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="small" onClick={addSuggested}>Add to my map</button>
              <button className="small ghost" onClick={() => setSugg(null)}>Dismiss</button>
            </div>
          </div>
        )}
        <div className="mm-hint" style={sugg ? { display: 'none' } : undefined}>
          {tool === 'station' && 'Click the map to drop a station. Zoom into a real city so it has Street View.'}
          {tool === 'line' && 'Drawing a line: tap stations in order — or tap empty map to drop a new stop there. Tap the last one again to undo, then ✓ Finish.'}
          {tool === 'area' && 'Click to outline your play area (optional — used later for auto-importing real transit).'}
        </div>
        {msg && <div className="mm-msg">{msg}</div>}
      </div>

      <div className="mm-panel">
        <div className="mm-panel-head">
          <button className="ghost small" onClick={onExit}>← Home</button>
          <h2>Map Maker</h2>
        </div>

        <div className="field"><label>Map name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Map" /></div>
        <div className="field"><label>You ride</label>
          <div className="row">
            <button className={`small ${vehicle === 'train' ? '' : 'ghost'}`} onClick={() => setVehicle('train')}>🚆 Train</button>
            <button className={`small ${vehicle === 'bus' ? '' : 'ghost'}`} onClick={() => setVehicle('bus')}>🚌 Bus</button>
          </div>
        </div>

        <div className="mm-scroll">
          <div className="mm-section">Stations · {stationList.length}</div>
          {stationList.length === 0 && <p className="hint">Click the map to add your first station.</p>}
          {stationList.map((s) => (
            <div className="mm-row" key={s.id}>
              <span className="mm-dot" style={{ background: lineDraft?.includes(s.id) ? '#ffd23f' : '#4b9fff' }} />
              <input className="mm-name-input" value={s.name}
                onChange={(e) => setStations((p) => ({ ...p, [s.id]: { ...p[s.id], name: e.target.value } }))} />
              <button className="ghost small" onClick={() => removeStation(s.id)}>✕</button>
            </div>
          ))}

          <div className="mm-section">Lines · {lines.length}</div>
          {lines.length === 0 && <p className="hint">Use “New line” and tap stations to connect them.</p>}
          {lines.map((l) => (
            <div className="mm-row" key={l.id}>
              <span className="mm-dot" style={{ background: l.color }} />
              <input className="mm-name-input" value={l.name} onChange={(e) => renameLine(l.id, e.target.value)} />
              <span className="hint" style={{ fontSize: 11 }}>{l.stops.length} stops</span>
              <button className="ghost small" onClick={() => removeLine(l.id)}>✕</button>
            </div>
          ))}
        </div>

        <div className="mm-actions">
          <button style={{ flex: 1 }} disabled={!canPlay} onClick={() => onPlay(buildDef())}>▶ Play this map</button>
          <button className="ghost" disabled={busy} onClick={doSave}>{editingId ? 'Update' : 'Save'}</button>
        </div>
        {!user && accounts && <p className="hint" style={{ marginTop: 6 }}>Sign in on the home screen to save your maps.</p>}

        {myMaps.length > 0 && (
          <div className="mm-mymaps">
            <div className="mm-section">My Maps</div>
            {myMaps.map((m) => (
              <div className="mm-row" key={m.id}>
                <span className="mm-name-input" style={{ flex: 1 }}>{m.name}</span>
                <button className="ghost small" onClick={() => onPlay(m.def)}>Play</button>
                <button className="ghost small" onClick={() => loadMap(m)}>Edit</button>
                <button className="ghost small" onClick={() => removeMap(m.id)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
