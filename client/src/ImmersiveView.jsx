import { useEffect, useMemo, useRef, useState } from 'react';
import { loadGoogleMaps } from './maps-loader';
import { isPointPossible, possibleStations, geoConstraints } from './solver';
import MapView from './MapView';

const RADARS = [{ km: 0.5, c: 5 }, { km: 1, c: 4 }, { km: 2, c: 3 }, { km: 5, c: 2 }];

// The seeker's main screen: you stand at a station in Street View and do
// everything through your "phone" — a Bus Schedule to ride, a Maps app to
// plan, and a Texts app to question the hider. Real panorama when a Maps key
// is present; a stylised fallback (still fully playable) otherwise.
export default function ImmersiveView({ state, network, act, embedKey, onExit }) {
  const elRef = useRef(null);
  const panoRef = useRef(null);
  const [heading, setHeading] = useState(0);
  const [pos, setPos] = useState(state.seekerPos); // live pano position (warning + drop pin)
  const [live, setLive] = useState(false);
  const dragRef = useRef(null);

  const [phoneOpen, setPhoneOpen] = useState(false);
  const [app, setApp] = useState('home'); // 'home' | 'bus' | 'maps' | 'texts'
  const [seenTexts, setSeenTexts] = useState(0); // feed-question count already read

  const seekerStation = state.seekerStation;

  // stable act for children
  const actRef = useRef(act); actRef.current = act;

  // load the panorama (no-op without a key -> faux background path)
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

  // faux-mode drag to look around (only when there's no live pano)
  const onDown = (e) => { if (!live) dragRef.current = { x: e.clientX, h: heading }; };
  const onMove = (e) => {
    if (!dragRef.current) return;
    setHeading((((dragRef.current.h + (e.clientX - dragRef.current.x) * 0.25) % 360) + 360) % 360);
  };
  const onUp = () => { dragRef.current = null; };

  // only warn about a ruled-out spot once at least one question is answered
  const hasIntel = state.feed.some((f) => f.kind === 'question' && f.answer);
  const ruledOut = hasIntel && network && !isPointPossible(network, state.feed, state.rules.HIDE_ZONE_METERS, pos);

  const questionCount = state.feed.filter((f) => f.kind === 'question').length;
  const unread = Math.max(0, questionCount - seenTexts);

  // keep the Texts badge cleared while the thread is open and answers arrive
  useEffect(() => {
    if (phoneOpen && app === 'texts') setSeenTexts(questionCount);
  }, [phoneOpen, app, questionCount]);

  const openApp = (which) => { setPhoneOpen(true); setApp(which); if (which === 'texts') setSeenTexts(questionCount); };
  const goHome = () => setApp('home');
  const closePhone = () => setPhoneOpen(false);

  // final catch: walk to where you're standing in the pano, then drop the pin
  const dropPin = async () => {
    const r = await act('walk', pos);
    if (!r?.error) act('guess', pos);
  };
  const walkHere = () => act('walk', pos);

  const hider = state.players?.find((p) => p.role === 'hider');
  const hiderName = hider?.name || 'The Hider';

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
      <div className="imm-here">📍 {network?.stations[seekerStation]?.name} · {network?.name}</div>

      {ruledOut && <div className="imm-warning">⚠ Your answers have ruled out this spot</div>}

      {/* Street View controls for the final catch */}
      <div className="imm-sv-controls">
        <button className="sv-btn ghost" onClick={walkHere} title="Move your standing point to here">Walk to here</button>
        <button className="sv-btn" onClick={dropPin} title="Walk here and tag the hider">📍 Drop pin here</button>
      </div>

      {/* phone launcher */}
      {!phoneOpen && (
        <button className="phone-launch" onClick={() => openApp('home')} title="Open your phone">
          <span className="pl-icon">📱</span>
          <span className="pl-label">Phone</span>
          {unread > 0 && <span className="pl-badge">{unread}</span>}
        </button>
      )}

      {/* Maps app is fullscreen */}
      {phoneOpen && app === 'maps' && (
        <MapsApp network={network} state={state} onBack={goHome} />
      )}

      {/* phone frame (home / bus / texts) */}
      {phoneOpen && app !== 'maps' && (
        <div className="phone-backdrop" onClick={closePhone}>
          <div className="phone" onClick={(e) => e.stopPropagation()}>
            <div className="phone-notch" />
            <div className="phone-status">
              <span>{String(9 + (state.clock % 3)).padStart(2, '0')}:{String(state.clock % 60).padStart(2, '0')}</span>
              <span className="ps-right">🪙 {state.coins}<span className="ps-batt" /></span>
            </div>
            <div className="phone-screen">
              {app === 'home' && <PhoneHome unread={unread} onOpen={openApp} />}
              {app === 'bus' && <BusApp state={state} network={network} act={actRef.current} onRode={closePhone} />}
              {app === 'texts' && <TextsApp state={state} network={network} act={actRef.current} hiderName={hiderName} />}
            </div>
            <button className="phone-homebar" onClick={goHome} title="Home">
              <span className="hb" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PhoneHome({ unread, onOpen }) {
  return (
    <div className="home-screen">
      <div className="home-clock">Field Phone</div>
      <div className="home-apps">
        <button className="app-icon" onClick={() => onOpen('bus')}>
          <span className="ai-glyph bus">🚌</span>
          <span className="ai-name">Bus Schedule</span>
        </button>
        <button className="app-icon" onClick={() => onOpen('maps')}>
          <span className="ai-glyph maps">🗺️</span>
          <span className="ai-name">Maps</span>
        </button>
        <button className="app-icon" onClick={() => onOpen('texts')}>
          <span className="ai-glyph texts">💬</span>
          <span className="ai-name">Texts</span>
          {unread > 0 && <span className="ai-badge">{unread}</span>}
        </button>
      </div>
      <p className="home-hint">Ride the bus, plan on the map, text the hider a question.</p>
    </div>
  );
}

function BusApp({ state, network, act, onRode }) {
  const [riding, setRiding] = useState(null);
  const here = state.seekerStation;
  const rows = useMemo(() => {
    const list = Object.values(network.stations)
      .filter((s) => s.id !== here)
      .map((s) => {
        const wait = state.busWaits?.[s.id] ?? 0;
        const ride = state.travelTimes?.[s.id] ?? 0;
        const coins = Math.max(2, Math.round(ride * 0.5));
        return { id: s.id, name: s.name, wait, ride, total: wait + ride, coins, color: stationColor(network, s.id) };
      })
      .sort((a, b) => a.total - b.total);
    return list;
  }, [network, here, state.busWaits, state.travelTimes]);

  const ride = async (id) => {
    setRiding(id);
    const r = await act('move', { stationId: id });
    setRiding(null);
    if (!r?.error) onRode();
  };

  return (
    <div className="app-view bus-app">
      <div className="app-bar"><span className="ab-title">🚌 Bus Schedule</span></div>
      <div className="app-sub">Departing {network.stations[here]?.name}</div>
      <div className="bus-list">
        {rows.map((r) => (
          <div className="bus-row" key={r.id}>
            <span className="bus-dot" style={{ background: r.color }} />
            <div className="bus-meta">
              <b>{r.name}</b>
              <span className="bus-times">next bus <b>{r.wait}m</b> · ride {r.ride}m · +{r.coins}🪙</span>
            </div>
            <button className="bus-ride" disabled={riding} onClick={() => ride(r.id)}>
              {riding === r.id ? '…' : `Ride`}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TextsApp({ state, network, act, hiderName }) {
  const threadRef = useRef(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    threadRef.current?.scrollTo(0, threadRef.current.scrollHeight);
  }, [state.feed.length, state.pendingPhoto]);

  const send = async (type, params) => {
    setSending(true);
    await act('ask', { type, params });
    setSending(false);
  };

  const chips = buildChips(state, network, send);

  return (
    <div className="app-view texts-app">
      <div className="app-bar texts-bar">
        <span className="txt-avatar">🕵️</span>
        <span className="ab-title">{hiderName}</span>
        <span className="txt-status">the hider · can't lie</span>
      </div>
      <div className="texts-thread" ref={threadRef}>
        {state.feed.map((f, i) => {
          if (f.kind === 'question') {
            return (
              <div className="txt-pair" key={i}>
                <div className="txt-bubble sent">{f.label}</div>
                <div className="txt-bubble recv">
                  {f.img && <img className="txt-img" src={f.img} alt={f.label} />}
                  <span>{f.answer}</span>
                </div>
              </div>
            );
          }
          if (f.kind === 'system' || f.kind === 'move' || f.kind === 'walk' || f.kind === 'guess') {
            return <div className="txt-note" key={i}>{f.text}</div>;
          }
          return null;
        })}
        {state.pendingPhoto && (
          <div className="txt-bubble recv typing"><span className="dot" /><span className="dot" /><span className="dot" /></div>
        )}
      </div>
      <div className="texts-tray">
        <div className="tray-label">Tap to text a question{sending ? ' · sending…' : ''}</div>
        <div className="chip-grid">
          {chips.map((c) => (
            <button key={c.key} className="qchip" disabled={c.disabled || sending} onClick={c.send}>
              <span className="qc-label">{c.label}</span>
              <span className="qc-cost">{c.cost === 0 ? 'free' : `${c.cost}🪙`}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MapsApp({ network, state, onBack }) {
  // which question to "preview" on the map — same graphics the game map uses
  const [sel, setSel] = useState(null);
  const guesses = state.feed.filter((f) => f.kind === 'guess' && f.lat);
  const radarHistory = state.feed
    .filter((f) => f.type === 'radar' && f.center)
    .map((f) => ({ center: f.center, radiusKm: f.radiusKm, yes: f.answer.startsWith('YES') }));
  const possibleZones = useMemo(
    () => network && {
      stations: possibleStations(network, state.feed, state.rules.HIDE_ZONE_METERS),
      radius: state.rules.HIDE_ZONE_METERS,
      constraints: geoConstraints(state.feed, network),
    },
    [network, state.feed.length]
  );
  const tools = previewTools(network);
  const active = tools.find((t) => t.key === sel);
  const toggle = (key) => setSel((cur) => (cur === key ? null : key));

  return (
    <div className="maps-fullscreen">
      <MapView
        key={`maps-${network?.id}`}
        network={network}
        theme="dark"
        seekerStation={state.seekerStation}
        seekerPos={state.seekerPos}
        radarHistory={radarHistory}
        possibleZones={possibleZones}
        travelTimes={state.travelTimes}
        guesses={guesses}
        preview={active?.pv || null}
        clickMode={null}
      />
      <div className="maps-topbar">
        <button className="maps-back" onClick={onBack}>‹ Back to phone</button>
        <span className="maps-hint">
          {active ? active.hint : 'Tap a question below to preview how it splits the map. Shaded areas are already ruled out.'}
        </span>
      </div>
      <div className="map-tools">
        {tools.map((t) => (
          <button key={t.key} className={`map-tool ${sel === t.key ? 'on' : ''}`} onClick={() => toggle(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// The questions you can preview on the map, in the exact `preview` shapes the
// game's MapView already knows how to draw.
function previewTools(network) {
  const t = [
    { key: 'r05', label: 'Radar 0.5km', pv: { type: 'radar', radiusKm: 0.5 }, hint: 'Radar 0.5km — the hider is inside or outside this ring.' },
    { key: 'r1', label: 'Radar 1km', pv: { type: 'radar', radiusKm: 1 }, hint: 'Radar 1km — the hider is inside or outside this ring.' },
    { key: 'r2', label: 'Radar 2km', pv: { type: 'radar', radiusKm: 2 }, hint: 'Radar 2km — the hider is inside or outside this ring.' },
    { key: 'r5', label: 'Radar 5km', pv: { type: 'radar', radiusKm: 5 }, hint: 'Radar 5km — the hider is inside or outside this ring.' },
    { key: 'cns', label: 'Compass N/S', pv: { type: 'compass', axis: 'ns' }, hint: 'Compass N/S — splits the map north vs south of you.' },
    { key: 'cew', label: 'Compass E/W', pv: { type: 'compass', axis: 'ew' }, hint: 'Compass E/W — splits the map east vs west of you.' },
    { key: 'line', label: 'Same line', pv: { type: 'lines' }, hint: 'Same line — highlights every station sharing a line with you.' },
    { key: 'stn', label: 'Right station', pv: { type: 'station' }, hint: 'Right station — is your current station the hider’s home?' },
  ];
  (network?.matchCategories || []).forEach((c) =>
    t.push({ key: `m${c.id}`, label: c.region ? `Same ${c.label}` : `Near ${c.label}`, pv: { type: 'match', category: c.id },
      hint: `Matching — do you share the same ${c.label} region as the hider?` }));
  t.push({ key: 'r100', label: 'Radar 100m', pv: { type: 'radar', radiusKm: 0.1 }, hint: 'Radar 100m — endgame ring right around you.' });
  t.push({ key: 'r250', label: 'Radar 250m', pv: { type: 'radar', radiusKm: 0.25 }, hint: 'Radar 250m — endgame ring around you.' });
  return t;
}

// The first line serving a station gives its dot colour on the schedule.
function stationColor(network, stationId) {
  for (const line of network.lines || []) {
    if (line.stops?.includes(stationId)) return line.color;
  }
  return '#e8b23a';
}

// The set of "text messages" you can send, mirroring the classic question deck.
// `onSend(type, params)` fires the ask (TextsApp manages the sending state).
function buildChips(state, network, onSend) {
  const coins = state.coins;
  const send = (type, params) => () => onSend(type, params);
  const chips = [];
  RADARS.forEach((r) =>
    chips.push({ key: `radar${r.km}`, label: `Radar ${r.km}km`, cost: r.c, disabled: coins < r.c,
      send: send('radar', { radiusKm: r.km }) }));
  if (state.thermoStart) {
    chips.push({ key: 'thermo-read', label: 'Read thermometer', cost: 3, disabled: coins < 3,
      send: send('thermometer', { action: 'end' }) });
  } else {
    chips.push({ key: 'thermo-start', label: 'Start thermometer', cost: 0, disabled: false,
      send: send('thermometer', { action: 'start' }) });
  }
  chips.push({ key: 'line', label: 'Same line?', cost: 3, disabled: coins < 3, send: send('sameLine') });
  chips.push({ key: 'cns', label: 'North or south?', cost: 5, disabled: coins < 5, send: send('compass', { axis: 'ns' }) });
  chips.push({ key: 'cew', label: 'East or west?', cost: 5, disabled: coins < 5, send: send('compass', { axis: 'ew' }) });
  chips.push({ key: 'right', label: 'Your home station?', cost: 4, disabled: coins < 4, send: send('rightStation') });
  (network?.matchCategories || []).forEach((c) =>
    chips.push({ key: `m${c.id}`, label: c.region ? `Same ${c.label}?` : `Nearest ${c.label}?`, cost: c.cost,
      disabled: coins < c.cost, send: send('matching', { category: c.id }) }));
  chips.push({ key: 'radar100', label: 'Radar 100m', cost: 7, disabled: coins < 7, send: send('radar', { radiusKm: 0.1 }) });
  chips.push({ key: 'radar250', label: 'Radar 250m', cost: 6, disabled: coins < 6, send: send('radar', { radiusKm: 0.25 }) });
  // photo(s)
  if (state.solo) {
    if (state.photoAvailable) {
      chips.push({ key: 'photo', label: state.photoUsed ? '📷 Photo used' : '📷 The one photo', cost: 7,
        disabled: coins < 7 || state.photoUsed, send: send('photo', {}) });
    }
  } else {
    Object.entries(network?.photoKinds || {}).forEach(([kind, def]) =>
      chips.push({ key: `photo-${kind}`, label: `📷 ${def.label}`, cost: def.cost,
        disabled: coins < def.cost || !!state.pendingPhoto, send: send('photo', { kind }) }));
  }
  return chips;
}
