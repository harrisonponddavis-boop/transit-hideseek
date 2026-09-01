import { useEffect, useMemo, useRef, useState } from 'react';
import { loadGoogleMaps } from './maps-loader';
import { isPointPossible, possibleStations, geoConstraints, metersBetween, bearingBetween } from './solver';
import MapView from './MapView';

const RADARS = [{ km: 0.5, c: 5 }, { km: 1, c: 4 }, { km: 2, c: 3 }, { km: 5, c: 2 }];
const BOARD_RADIUS = 35;   // metres you must be within to board (~100 ft)
const WALK_RADIUS = 250;   // how far you can walk from your station on the map

// The seeker's main screen: you stand at a real station in Street View and do
// everything through your phone — catch a line at the stop, plan on the Maps
// app, and text the hider questions. Once you confirm the hider's station it
// flips to an endgame view with the hider's photo and map beside the panorama.
export default function ImmersiveView({ state, network, act, embedKey, onExit }) {
  const elRef = useRef(null);
  const panoRef = useRef(null);
  const svcRef = useRef(null);
  const stopPosRef = useRef(null); // where the stop is (first pano position on arrival)
  const [heading, setHeading] = useState(0);
  const [pos, setPos] = useState(state.seekerPos);
  const [live, setLive] = useState(false);
  const dragRef = useRef(null);

  const [phoneOpen, setPhoneOpen] = useState(false);
  const [app, setApp] = useState('home'); // 'home' | 'bus' | 'maps' | 'texts'
  const [phoneTheme, setPhoneTheme] = useState(() => {
    try { return localStorage.getItem('ths-phone-theme') || 'dark'; } catch { return 'dark'; }
  });
  const [lightbox, setLightbox] = useState(null);

  const seekerStation = state.seekerStation;
  const aboard = state.aboard;
  const vehicle = network?.vehicle || 'train';
  const confirmed = !!state.stationConfirmed;

  const actRef = useRef(act); actRef.current = act;

  useEffect(() => {
    try { localStorage.setItem('ths-phone-theme', phoneTheme); } catch { /* ignore */ }
  }, [phoneTheme]);

  const goToPano = (loc) => {
    const pano = panoRef.current, svc = svcRef.current;
    if (!pano) return;
    if (!svc) { pano.setPosition({ lat: loc.lat, lng: loc.lng }); return; }
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
        if (!p) return;
        const np = { lat: p.lat(), lng: p.lng() };
        setPos(np);
        if (!stopPosRef.current) stopPosRef.current = np; // first fix at a station = the stop
      });
      goToPano(state.seekerPos);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [embedKey]);

  // a NEW station means a new stop — forget the old one so the next pano fix
  // (the spawn point) becomes the stop. Walking doesn't change the station, so
  // the stop stays put and the return-compass keeps pointing back to it.
  useEffect(() => { stopPosRef.current = null; }, [seekerStation]);

  // follow the seeker's position (a ride or a walk) by recentring the panorama
  useEffect(() => {
    setPos(state.seekerPos);
    goToPano(state.seekerPos);
  }, [state.seekerPos.lat, state.seekerPos.lng]);

  const onDown = (e) => { if (!live) dragRef.current = { x: e.clientX, h: heading }; };
  const onMove = (e) => {
    if (!dragRef.current) return;
    setHeading((((dragRef.current.h + (e.clientX - dragRef.current.x) * 0.25) % 360) + 360) % 360);
  };
  const onUp = () => { dragRef.current = null; };

  const stopPos = stopPosRef.current;
  const distFromStop = stopPos ? metersBetween(pos, stopPos) : 0;
  const nearStop = !stopPos || distFromStop <= BOARD_RADIUS;

  const hasIntel = state.feed.some((f) => f.kind === 'question' && f.answer);
  const ruledOut = hasIntel && network && !isPointPossible(network, state.feed, state.rules.HIDE_ZONE_METERS, pos);

  const openApp = (which) => { setPhoneOpen(true); setApp(which); };
  const goHome = () => setApp('home');
  const closePhone = () => setPhoneOpen(false);
  const returnToStop = () => stopPos && goToPano(stopPos);

  const dropPin = async () => {
    const r = await act('walk', pos);
    if (!r?.error) act('guess', pos);
  };
  const walkHere = () => act('walk', pos);

  const hider = state.players?.find((p) => p.role === 'hider');
  const hiderName = hider?.name || 'The Hider';
  const latestPhoto = [...state.feed].reverse().find((f) => f.img)?.img || null;

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

      {aboard && <OnboardView state={state} network={network} act={actRef.current} />}

      {/* ENDGAME: right station confirmed — hunt in Street View with photo + map */}
      {!aboard && (
        <>
          {confirmed ? (
            <EndgameView state={state} network={network} act={actRef.current} latestPhoto={latestPhoto}
              theme={phoneTheme} onDropPin={dropPin} onPhoto={() => latestPhoto && setLightbox(latestPhoto)} />
          ) : (
            <>
              {ruledOut && <div className="imm-warning">⚠ Your answers have ruled out this spot</div>}

              {/* wayfinding back to the stop once you wander off */}
              {stopPos && !nearStop && (
                <button className="stop-compass" onClick={returnToStop} title="Return to the stop">
                  <span className="sc-arrow" style={{ transform: `rotate(${norm(bearingBetween(pos, stopPos) - heading)}deg)` }}>▲</span>
                  <span className="sc-text">{vehicle === 'bus' ? 'Bus stop' : 'Station'}<i>{Math.round(distFromStop)}m · tap to return</i></span>
                </button>
              )}

              <div className="imm-sv-controls">
                <button className="sv-btn ghost" onClick={walkHere} title="Move your standing point to here">Walk here</button>
                <button className="sv-btn" onClick={dropPin} title="Walk here and tag the hider">📍 Drop pin</button>
              </div>
            </>
          )}

          {!phoneOpen && (
            <button className="phone-launch" onClick={() => openApp('home')} title="Open your phone">
              <span className="pl-icon">📱</span>
              <span className="pl-label">Phone</span>
            </button>
          )}

          {phoneOpen && app === 'maps' && (
            <MapsApp network={network} state={state} theme={phoneTheme} act={actRef.current} onBack={goHome} />
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
                  {app === 'home' && <PhoneHome vehicle={vehicle} onOpen={openApp} />}
                  {app === 'bus' && <BusApp state={state} network={network} act={actRef.current}
                    nearStop={nearStop} distFromStop={distFromStop} onReturn={() => { returnToStop(); }} onBoarded={closePhone} />}
                  {app === 'texts' && <TextsApp state={state} network={network} act={actRef.current}
                    hiderName={hiderName} onOpenPhoto={(img) => setLightbox(img)} />}
                </div>
                <button className="phone-homebar" onClick={goHome} title="Home"><span className="hb" /></button>
              </div>
            </div>
          )}
        </>
      )}

      {lightbox && (
        <div className="imm-lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="hider photo" onClick={(e) => e.stopPropagation()} />
          <button className="imm-lightbox-close" onClick={() => setLightbox(null)}>Close ✕</button>
        </div>
      )}
    </div>
  );
}

function PhoneHome({ vehicle, onOpen }) {
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
        </button>
      </div>
      <p className="home-hint">Catch a {vehicle} at the stop, plan on the map, text the hider.</p>
    </div>
  );
}

function BusApp({ state, network, act, nearStop, distFromStop, onReturn, onBoarded }) {
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

  if (!nearStop) {
    return (
      <div className="app-view bus-app">
        <div className="app-bar"><span className="ab-title">{vehicle === 'bus' ? '🚌' : '🚆'} Transit</span></div>
        <div className="board-gate">
          <div className="bg-icon">{vehicle === 'bus' ? '🚏' : '🚉'}</div>
          <p className="bg-text">You've wandered <b>{Math.round(distFromStop)}m</b> from the {stopWord}.<br />Get back within {BOARD_RADIUS}m to catch a {noun}.</p>
          <button className="primary-btn" onClick={onReturn}>Walk back to the {stopWord}</button>
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

function TextsApp({ state, network, act, hiderName, onOpenPhoto }) {
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
                  {f.img && <img className="txt-img" src={f.img} alt="hider photo" onClick={() => onOpenPhoto(f.img)} />}
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

function MapsApp({ network, state, theme, act, onBack }) {
  const [sel, setSel] = useState(null);
  const [pendingWalk, setPendingWalk] = useState(null);
  const [walkMsg, setWalkMsg] = useState(null);
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

  const here = state.seekerPos;
  const onMapClick = (lat, lng) => {
    const d = metersBetween({ lat, lng }, here);
    if (d > WALK_RADIUS) { setWalkMsg(`That's ${Math.round(d)}m — you can only walk ${WALK_RADIUS}m from here.`); setPendingWalk(null); return; }
    setWalkMsg(null);
    setPendingWalk({ lat, lng, mins: Math.max(1, Math.ceil((d / 1000) * state.rules.WALK_PACE_MIN_PER_KM)), meters: Math.round(d) });
  };
  const doWalk = async () => { const p = pendingWalk; setPendingWalk(null); await act('walk', { lat: p.lat, lng: p.lng }); };

  return (
    <div className="maps-fullscreen">
      <MapView
        key={`maps-${network?.id}`}
        network={network}
        theme={theme === 'light' ? 'light' : 'dark'}
        seekerStation={state.seekerStation}
        seekerPos={here}
        radarHistory={radarHistory}
        possibleZones={possibleZones}
        travelTimes={state.travelTimes}
        guesses={guesses}
        preview={active?.pv || null}
        guessRange={{ lat: here.lat, lng: here.lng, radius: WALK_RADIUS }}
        pin={pendingWalk}
        clickMode="point"
        onMapClick={onMapClick}
      />
      <div className="maps-topbar">
        <button className="maps-back" onClick={onBack}>‹ Back to phone</button>
        <span className="maps-hint">
          {walkMsg || (active ? active.hint : 'Tap inside the ring to walk there; tap a question below to preview how it splits the map.')}
        </span>
      </div>
      <MapLegend lines={network?.lines || []} />
      {pendingWalk && (
        <div className="maps-walkbar">
          <span>Walk <b>{pendingWalk.meters}m</b> here · ~{pendingWalk.mins} min</span>
          <button className="mw-cancel" onClick={() => setPendingWalk(null)}>Cancel</button>
          <button className="mw-go" onClick={doWalk}>Walk here</button>
        </div>
      )}
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

function MapLegend({ lines }) {
  const [open, setOpen] = useState(true);
  if (!lines.length) return null;
  return (
    <div className={`map-legend ${open ? 'open' : ''}`}>
      <button className="ml-toggle" onClick={() => setOpen((v) => !v)}>{open ? 'Lines ▾' : 'Lines ▸'}</button>
      {open && (
        <div className="ml-list">
          {lines.map((l) => (
            <div className="ml-row" key={l.id}>
              <span className="ml-swatch" style={{ background: l.color }} />
              <span className="ml-name">{l.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EndgameView({ state, network, act, latestPhoto, theme, onDropPin, onPhoto }) {
  const [pendingWalk, setPendingWalk] = useState(null);
  const here = state.seekerPos;
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
  const onMapClick = (lat, lng) => {
    const d = metersBetween({ lat, lng }, here);
    if (d > WALK_RADIUS) { setPendingWalk(null); return; }
    setPendingWalk({ lat, lng, meters: Math.round(d), mins: Math.max(1, Math.ceil((d / 1000) * state.rules.WALK_PACE_MIN_PER_KM)) });
  };
  const doWalk = async () => { const p = pendingWalk; setPendingWalk(null); await act('walk', { lat: p.lat, lng: p.lng }); };

  return (
    <div className="endgame">
      <div className="eg-banner">🎯 Right station! Walk the street (or tap the map) to the exact spot, then drop your pin.</div>
      <aside className="eg-side">
        {latestPhoto && (
          <div className="eg-photo" onClick={onPhoto} title="Tap to enlarge">
            <div className="eg-panel-label">Hider's photo — tap to enlarge</div>
            <img src={latestPhoto} alt="hider photo" />
          </div>
        )}
        <div className="eg-map">
          <div className="eg-panel-label">Still-possible area — tap in the ring to walk</div>
          <div className="eg-map-inner">
            <MapView
              key={`eg-${network?.id}`}
              network={network}
              theme={theme === 'light' ? 'light' : 'dark'}
              seekerStation={state.seekerStation}
              seekerPos={here}
              radarHistory={radarHistory}
              possibleZones={possibleZones}
              travelTimes={state.travelTimes}
              guesses={guesses}
              guessRange={{ lat: here.lat, lng: here.lng, radius: WALK_RADIUS }}
              pin={pendingWalk}
              clickMode="point"
              onMapClick={onMapClick}
              focus={{ lat: here.lat, lng: here.lng, zoom: 16 }}
            />
          </div>
          {pendingWalk && (
            <div className="eg-walkbar">
              <span>Walk <b>{pendingWalk.meters}m</b> · ~{pendingWalk.mins} min</span>
              <button className="mw-cancel" onClick={() => setPendingWalk(null)}>Cancel</button>
              <button className="mw-go" onClick={doWalk}>Walk</button>
            </div>
          )}
        </div>
      </aside>
      <div className="eg-controls">
        <button className="sv-btn eg-drop" onClick={onDropPin}>📍 Drop pin & tag</button>
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
    t.push({ key: `m${c.id}`, label: c.region ? `Same ${c.label}` : `Near ${c.label}`, pv: { type: 'match', category: c.id, region: !!c.region },
      hint: c.region ? `Same ${c.label} — lights up every station in your ${c.label}.` : `Nearest ${c.label} — splits the map by closest ${c.label}.` }));
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

const norm = (a) => (((a % 360) + 540) % 360) - 180;

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
