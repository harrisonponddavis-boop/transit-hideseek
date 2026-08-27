import { useEffect, useMemo, useRef, useState } from 'react';
import { loadGoogleMaps } from './maps-loader';
import { isPointPossible, possibleStations, geoConstraints } from './solver';
import MapView from './MapView';

const RADARS = [{ km: 0.5, c: 5 }, { km: 1, c: 4 }, { km: 2, c: 3 }, { km: 5, c: 2 }];

// The seeker's main screen: you stand at a real station in Street View and do
// everything through your phone — catch a line at the stop, plan on the Maps
// app, and text the hider questions. Real panorama when a Maps key is present;
// a stylised fallback (still fully playable) otherwise.
export default function ImmersiveView({ state, network, act, embedKey, onExit }) {
  const elRef = useRef(null);
  const panoRef = useRef(null);
  const [heading, setHeading] = useState(0);
  const [pos, setPos] = useState(state.seekerPos);
  const [live, setLive] = useState(false);
  const dragRef = useRef(null);

  const [phoneOpen, setPhoneOpen] = useState(false);
  const [app, setApp] = useState('home'); // 'home' | 'bus' | 'maps' | 'texts'
  const [phoneTheme, setPhoneTheme] = useState('dark');
  const [seenTexts, setSeenTexts] = useState(0);
  const [atStop, setAtStop] = useState(false); // have you walked to the boarding point?

  const seekerStation = state.seekerStation;
  const aboard = state.aboard;
  const vehicle = network?.vehicle || 'train';
  const stopWord = vehicle === 'bus' ? 'bus stop' : 'platform';

  const actRef = useRef(act); actRef.current = act;
  const svcRef = useRef(null);

  // station coords are approximate, so snap to the nearest real panorama
  const goToPano = (loc) => {
    const pano = panoRef.current, svc = svcRef.current;
    if (!pano) return;
    if (!svc) { pano.setPosition({ lat: loc.lat, lng: loc.lng }); return; }
    // OUTDOOR (the enum, not the string) filters out non-renderable photospheres
    // that sometimes sit on a station's approximate coordinates; setPano forces
    // that exact road panorama rather than re-snapping to the nearest photosphere.
    const source = window.google?.maps?.StreetViewSource?.OUTDOOR;
    svc.getPanorama({ location: { lat: loc.lat, lng: loc.lng }, radius: 240, ...(source ? { source } : {}) }, (data, status) => {
      if (status === 'OK' && data?.location?.pano) pano.setPano(data.location.pano);
      else pano.setPosition({ lat: loc.lat, lng: loc.lng });
    });
  };

  useEffect(() => {
    if (!embedKey || !elRef.current) return;
    let cancelled = false;
    loadGoogleMaps(embedKey).then((maps) => {
      if (cancelled || !elRef.current) return;
      const pano = new maps.StreetViewPanorama(elRef.current, {
        pov: { heading: 0, pitch: 0 }, addressControl: false, showRoadLabels: false,
        fullscreenControl: false, motionTracking: false, enableCloseButton: false, linksControl: true,
      });
      panoRef.current = pano;
      svcRef.current = new maps.StreetViewService();
      setLive(true);
      pano.addListener('pov_changed', () => setHeading(pano.getPov().heading));
      pano.addListener('position_changed', () => {
        const p = pano.getPosition();
        if (p) setPos({ lat: p.lat(), lng: p.lng() });
      });
      goToPano(state.seekerPos);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [embedKey]);

  useEffect(() => {
    setPos(state.seekerPos);
    goToPano(state.seekerPos);
  }, [state.seekerPos.lat, state.seekerPos.lng]);

  // reaching a new station means you have to walk to its stop again
  useEffect(() => { setAtStop(false); }, [seekerStation]);

  const onDown = (e) => { if (!live) dragRef.current = { x: e.clientX, h: heading }; };
  const onMove = (e) => {
    if (!dragRef.current) return;
    setHeading((((dragRef.current.h + (e.clientX - dragRef.current.x) * 0.25) % 360) + 360) % 360);
  };
  const onUp = () => { dragRef.current = null; };

  const hasIntel = state.feed.some((f) => f.kind === 'question' && f.answer);
  const ruledOut = hasIntel && network && !isPointPossible(network, state.feed, state.rules.HIDE_ZONE_METERS, pos);

  const questionCount = state.feed.filter((f) => f.kind === 'question').length;
  const unread = Math.max(0, questionCount - seenTexts);
  useEffect(() => {
    if (phoneOpen && app === 'texts') setSeenTexts(questionCount);
  }, [phoneOpen, app, questionCount]);

  const openApp = (which) => { setPhoneOpen(true); setApp(which); if (which === 'texts') setSeenTexts(questionCount); };
  const goHome = () => setApp('home');
  const closePhone = () => setPhoneOpen(false);
  const goToStop = () => { setAtStop(true); setPhoneOpen(true); setApp('bus'); };

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

      <div className="imm-here">
        <span className="ih-pin">🚉</span>
        <span className="ih-name">{network?.stations[seekerStation]?.name}</span>
        <span className="ih-city">{network?.name}</span>
      </div>

      {ruledOut && !aboard && <div className="imm-warning">⚠ Your answers have ruled out this spot</div>}

      {/* on a vehicle: a fullscreen interior where you tell the driver your stop */}
      {aboard && <OnboardView state={state} network={network} act={actRef.current} />}

      {!aboard && (
        <>
          <div className="imm-sv-controls">
            <button className="sv-btn ghost" onClick={walkHere} title="Move your standing point to here">Walk here</button>
            <button className="sv-btn" onClick={dropPin} title="Walk here and tag the hider">📍 Drop pin</button>
          </div>

          {/* highlighted boarding point to walk to */}
          {!atStop && !phoneOpen && (
            <button className="stop-marker" onClick={goToStop}>
              <span className="sm-ring" />
              <span className="sm-icon">{vehicle === 'bus' ? '🚏' : '🚉'}</span>
              <span className="sm-label">Walk to the {stopWord}</span>
            </button>
          )}

          {!phoneOpen && (
            <button className="phone-launch" onClick={() => openApp('home')} title="Open your phone">
              <span className="pl-icon">📱</span>
              <span className="pl-label">Phone</span>
              {unread > 0 && <span className="pl-badge">{unread}</span>}
            </button>
          )}

          {phoneOpen && app === 'maps' && (
            <MapsApp network={network} state={state} theme={phoneTheme} onBack={goHome} />
          )}

          {phoneOpen && app !== 'maps' && (
            <div className="phone-backdrop" onClick={closePhone}>
              <div className={`phone ${phoneTheme}`} onClick={(e) => e.stopPropagation()}>
                <div className="phone-notch" />
                <div className="phone-status">
                  <span>{String(9 + (state.clock % 3)).padStart(2, '0')}:{String(state.clock % 60).padStart(2, '0')}</span>
                  <span className="ps-right">
                    <button className="ps-theme" onClick={() => setPhoneTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                      title="Switch light / dark">{phoneTheme === 'dark' ? '☀' : '☾'}</button>
                    <span className="ps-coins">🪙 {state.coins}</span>
                    <span className="ps-batt" />
                  </span>
                </div>
                <div className="phone-screen">
                  {app === 'home' && <PhoneHome unread={unread} vehicle={vehicle} onOpen={openApp} />}
                  {app === 'bus' && <BusApp state={state} network={network} act={actRef.current}
                    atStop={atStop} onGoToStop={() => setAtStop(true)} onBoarded={closePhone} />}
                  {app === 'texts' && <TextsApp state={state} network={network} act={actRef.current} hiderName={hiderName} />}
                </div>
                <button className="phone-homebar" onClick={goHome} title="Home"><span className="hb" /></button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PhoneHome({ unread, vehicle, onOpen }) {
  const transitLabel = vehicle === 'bus' ? 'Bus' : 'Train';
  return (
    <div className="home-screen">
      <div className="home-clock">Field Phone</div>
      <div className="home-apps">
        <button className="app-icon" onClick={() => onOpen('bus')}>
          <span className="ai-glyph bus">{vehicle === 'bus' ? '🚌' : '🚆'}</span>
          <span className="ai-name">{transitLabel}</span>
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
      <p className="home-hint">Catch a {vehicle} at the stop, plan on the map, text the hider.</p>
    </div>
  );
}

function BusApp({ state, network, act, atStop, onGoToStop, onBoarded }) {
  const here = state.seekerStation;
  const vehicle = network.vehicle || 'train';
  const noun = vehicle === 'bus' ? 'bus' : 'train';
  const plural = vehicle === 'bus' ? 'buses' : 'trains';
  const stopWord = vehicle === 'bus' ? 'bus stop' : 'platform';
  const [boarding, setBoarding] = useState(null);

  const lines = (network.lines || []).filter((l) => l.stops.includes(here));

  const board = async (lineId) => {
    setBoarding(lineId);
    const r = await act('board', { lineId });
    setBoarding(null);
    if (!r?.error) onBoarded();
  };

  if (!atStop) {
    return (
      <div className="app-view bus-app">
        <div className="app-bar"><span className="ab-title">{vehicle === 'bus' ? '🚌' : '🚆'} Transit</span></div>
        <div className="board-gate">
          <div className="bg-icon">{vehicle === 'bus' ? '🚏' : '🚉'}</div>
          <p className="bg-text">You're at <b>{network.stations[here]?.name}</b>.<br />Walk over to the {stopWord} to see which {noun}s stop here.</p>
          <button className="primary-btn" onClick={onGoToStop}>Walk to the {stopWord}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-view bus-app">
      <div className="app-bar"><span className="ab-title">{vehicle === 'bus' ? '🚌' : '🚆'} Departures</span></div>
      <div className="app-sub">{network.stations[here]?.name} · next {plural}</div>
      <div className="dep-list">
        {lines.map((l) => {
          const wait = state.lineWaits?.[l.id] ?? '?';
          return (
            <div className="dep-row" key={l.id}>
              <span className="dep-line" style={{ background: l.color, color: readableOn(l.color) }}>{l.name}</span>
              <span className="dep-when">arrives in <b>{wait} min</b></span>
              <button className="dep-board" disabled={boarding} onClick={() => board(l.id)}>
                {boarding === l.id ? '…' : 'Get on'}
              </button>
            </div>
          );
        })}
        {lines.length === 0 && <p className="bg-text">No lines stop here — that shouldn't happen!</p>}
      </div>
    </div>
  );
}

function OnboardView({ state, network, act }) {
  const aboard = state.aboard;
  const vehicle = network.vehicle || 'train';
  const line = (network.lines || []).find((l) => l.id === aboard.lineId);
  const [getting, setGetting] = useState(null);
  if (!line) return null;

  const stops = line.stops
    .map((id) => ({ id, name: network.stations[id]?.name, mins: alongLine(line, aboard.fromStation, id) }))
    .filter((s) => s.id !== aboard.fromStation);

  const getOff = async (id) => { setGetting(id); await act('disembark', { stationId: id }); setGetting(null); };

  return (
    <div className={`onboard ${vehicle}`}>
      <div className="onboard-windows"><div className="scenery" /><div className="scenery s2" /></div>
      <div className="onboard-head">
        <span className="ob-line" style={{ background: line.color, color: readableOn(line.color) }}>{line.name}</span>
        <h2>{vehicle === 'bus' ? "You're on the bus" : "You're on the train"}</h2>
        <p>Tell the driver which stop you want.</p>
      </div>
      <div className="onboard-stops">
        {stops.map((s) => (
          <button className="ob-stop" key={s.id} disabled={getting} onClick={() => getOff(s.id)}>
            <span className="obs-name">{s.name}</span>
            <span className="obs-time">{s.mins} min</span>
            <span className="obs-go">{getting === s.id ? '…' : 'Get off here ▸'}</span>
          </button>
        ))}
      </div>
      <button className="ob-cancel" onClick={() => getOff(aboard.fromStation)}>
        ‹ Get off where I boarded
      </button>
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
        <span className="txt-status">can't lie</span>
      </div>
      <div className="texts-thread" ref={threadRef}>
        {state.feed.map((f, i) => {
          if (f.kind === 'question') {
            const answer = (f.answer && f.answer.trim()) ? f.answer : 'Waiting…';
            return (
              <div className="txt-pair" key={i}>
                <div className="txt-bubble sent">{f.label}</div>
                <div className="txt-bubble recv">
                  {f.img && <img className="txt-img" src={f.img} alt={f.label} />}
                  <span>{answer}</span>
                </div>
              </div>
            );
          }
          if ((f.kind === 'system' || f.kind === 'move' || f.kind === 'walk' || f.kind === 'guess') && f.text) {
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

function MapsApp({ network, state, theme, onBack }) {
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
        theme={theme === 'light' ? 'light' : 'dark'}
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

// Minutes to ride a line between two of its stops (matches the server).
function alongLine(line, fromId, toId) {
  const a = line.stops.indexOf(fromId), b = line.stops.indexOf(toId);
  if (a < 0 || b < 0) return 0;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  let m = 0;
  for (let i = lo; i < hi; i++) m += line.hops[i];
  return m;
}

// Black or white text, whichever is readable on a line's colour.
function readableOn(hex) {
  if (!hex || hex[0] !== '#') return '#000';
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#0b0d11' : '#fff';
}

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
