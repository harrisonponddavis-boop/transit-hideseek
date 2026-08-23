import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from './maps-loader';
import { neighborsWithBearing, isPointPossible } from './solver';
import MiniMap from './MiniMap';

const RADARS = [{ km: 0.5, c: 5 }, { km: 1, c: 4 }, { km: 2, c: 3 }, { km: 5, c: 2 }];
const FOV = 90; // approximate Street View horizontal field of view
const norm = (a) => (((a % 360) + 540) % 360) - 180;

// The seeker's main screen: you stand in the city in Street View and travel by
// facing the station you want. Real panorama when a Maps key is present; a
// stylised fallback (still fully playable) otherwise.
export default function ImmersiveView({ state, network, act, embedKey, onExit }) {
  const elRef = useRef(null);
  const panoRef = useRef(null);
  const [heading, setHeading] = useState(0);
  const [pos, setPos] = useState(state.seekerPos); // live pano position (for the warning + drop pin)
  const [live, setLive] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [mapBig, setMapBig] = useState(false);
  const [mapTheme, setMapTheme] = useState('dark');
  const dragRef = useRef(null);

  const seekerStation = state.seekerStation;
  const neighbors = network ? neighborsWithBearing(network, seekerStation) : [];

  // stable ride handler so the mini-map never remounts just because we re-rendered
  const actRef = useRef(act); actRef.current = act;
  const rideRef = useRef((id) => actRef.current('move', { stationId: id }));
  const ride = (id) => actRef.current('move', { stationId: id });

  // load the panorama (no-op without a key → faux background path)
  useEffect(() => {
    if (!embedKey || !elRef.current) return;
    let cancelled = false;
    loadGoogleMaps(embedKey).then((maps) => {
      if (cancelled || !elRef.current) return;
      const pano = new maps.StreetViewPanorama(elRef.current, {
        position: { lat: state.seekerPos.lat, lng: state.seekerPos.lng },
        pov: { heading: 0, pitch: 0 }, addressControl: false, showRoadLabels: false,
        fullscreenControl: false, motionTracking: false, enableCloseButton: false, linksControl: true,
      });
      panoRef.current = pano;
      setLive(true);
      pano.addListener('pov_changed', () => setHeading(pano.getPov().heading));
      pano.addListener('position_changed', () => {
        const p = pano.getPosition();
        if (p) setPos({ lat: p.lat(), lng: p.lng() });
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [embedKey]);

  // recenter the panorama whenever a ride changes where we stand
  useEffect(() => {
    setPos(state.seekerPos);
    if (panoRef.current) panoRef.current.setPosition({ lat: state.seekerPos.lat, lng: state.seekerPos.lng });
  }, [state.seekerPos.lat, state.seekerPos.lng]);

  // faux-mode drag to look around
  const onDown = (e) => { if (!live) dragRef.current = { x: e.clientX, h: heading }; };
  const onMove = (e) => {
    if (!dragRef.current) return;
    setHeading((((dragRef.current.h + (e.clientX - dragRef.current.x) * 0.25) % 360) + 360) % 360);
  };
  const onUp = () => { dragRef.current = null; };

  // only warn about a ruled-out spot once at least one question has been answered
  const hasIntel = state.feed.some((f) => f.kind === 'question' && f.answer);
  const ruledOut = hasIntel && network && !isPointPossible(network, state.feed, state.rules.HIDE_ZONE_METERS, pos);

  // recent answers / events, newest first, so questions visibly do something
  const recent = state.feed
    .filter((f) => f.kind === 'question' || f.kind === 'system' || f.kind === 'guess')
    .slice(-4).reverse();

  return (
    <div className="imm" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
      <div ref={elRef} className={`imm-pano ${live ? 'on' : 'faux'}`} />
      {!live && <div className="imm-faux-scene" style={{ '--immh': heading }} />}

      <div className="imm-hud">
        <h1>Transit <span>Hide+Seek</span></h1>
        <div className="imm-stat">
          <div><span>clock</span><b>{state.clock}m</b></div>
          <div><span>coins</span><b>{state.coins}</b></div>
          <div><span>room</span><b>{state.code}</b></div>
          <button className="imm-exit" onClick={onExit} title="Classic map view">Map view</button>
        </div>
      </div>
      <div className="imm-here">{network?.stations[seekerStation]?.name} · {network?.name}</div>

      {/* recent answers so you can see questions land */}
      {recent.length > 0 && (
        <div className="imm-log">
          {recent.map((f, i) => (
            <div className={`imm-log-item ${f.kind}`} key={state.feed.length - i}>
              {f.kind === 'question' ? <>{f.label} — <b>{f.answer}</b></> : f.text}
            </div>
          ))}
        </div>
      )}

      {/* floating ride buttons, anchored to each neighbour's real-world bearing */}
      {neighbors.map((n) => {
        const d = norm(n.bearing - heading);
        const mins = state.travelTimes?.[n.id];
        const coins = Math.max(2, Math.round((mins || 0) * 0.5));
        if (Math.abs(d) <= FOV / 2) {
          return (
            <button key={n.id} className="imm-stbtn"
              style={{ left: `${50 + (d / (FOV / 2)) * 42}%`, top: '55%' }}
              onClick={() => ride(n.id)}>
              <span className="dot" style={{ background: n.color }} />
              <span className="lbl"><b>{n.name}</b><i>ride · {mins} min · +{coins}¢</i></span>
              <span className="go">▸</span>
            </button>
          );
        }
        return (
          <button key={n.id} className={`imm-nudge ${d > 0 ? 'right' : 'left'}`} onClick={() => ride(n.id)}>
            <span className="arr">{d > 0 ? '›' : '‹'}</span>
            <span className="nm">{n.name}</span><span className="t">turn</span>
          </button>
        );
      })}

      {ruledOut && <div className="imm-warning">⚠ Your answers have ruled out this spot</div>}

      <div className="imm-actions">
        <button className="btn" onClick={() => setAskOpen((v) => !v)}>{askOpen ? 'Close' : 'Ask'}</button>
        <button className="btn ghost" onClick={() => act('guess', pos)}>Drop pin here</button>
      </div>

      {askOpen && (
        <div className="imm-ask">
          <h3>Ask the hider</h3>
          <div className="qgrid">
            {RADARS.map((r) => (
              <button key={r.km} disabled={state.coins < r.c} onClick={() => act('ask', { type: 'radar', params: { radiusKm: r.km } })}>
                Radar {r.km}km <span>{r.c}¢</span>
              </button>
            ))}
            {state.thermoStart
              ? <button disabled={state.coins < 3} onClick={() => act('ask', { type: 'thermometer', params: { action: 'end' } })}>Read thermo <span>3¢</span></button>
              : <button onClick={() => act('ask', { type: 'thermometer', params: { action: 'start' } })}>Start thermo <span>free</span></button>}
            <button disabled={state.coins < 3} onClick={() => act('ask', { type: 'sameLine' })}>Line check <span>3¢</span></button>
            <button disabled={state.coins < 5} onClick={() => act('ask', { type: 'compass', params: { axis: 'ns' } })}>Compass N/S <span>5¢</span></button>
            <button disabled={state.coins < 5} onClick={() => act('ask', { type: 'compass', params: { axis: 'ew' } })}>Compass E/W <span>5¢</span></button>
            <button disabled={state.coins < 4} onClick={() => act('ask', { type: 'rightStation' })}>Right station <span>4¢</span></button>
            {(network?.matchCategories || []).map((c) => (
              <button key={c.id} disabled={state.coins < c.cost} onClick={() => act('ask', { type: 'matching', params: { category: c.id } })}>
                {c.region ? `Same ${c.label}` : `Near ${c.label}`} <span>{c.cost}¢</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`imm-map ${mapBig ? 'big' : 'small'}`}>
        <button className="imm-map-theme" onClick={() => setMapTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          title="Switch map light / dark">{mapTheme === 'dark' ? '☀ Light map' : '☾ Dark map'}</button>
        <button className="imm-map-tab" onClick={() => setMapBig((v) => !v)}>{mapBig ? 'Shrink' : 'Pin open'}</button>
        <MiniMap network={network} feed={state.feed}
          zoneR={state.rules.HIDE_ZONE_METERS} seekerPos={state.seekerPos}
          seekerStation={seekerStation} travelTimes={state.travelTimes}
          theme={mapTheme} onRide={rideRef.current} />
      </div>
    </div>
  );
}
