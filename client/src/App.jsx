import { useEffect, useMemo, useRef, useState } from 'react';
import { socket, send, streetViewUrl } from './socket';
import { metersBetween, possibleStations, geoConstraints } from './solver';
import MapView from './MapView';
import StreetViewPanel from './StreetViewPanel';
import MiniMap from './MiniMap';
import ImmersiveView from './ImmersiveView';

const RADAR_OPTIONS = [
  { km: 0.5, cost: 5 },
  { km: 1, cost: 4 },
  { km: 2, cost: 3 },
  { km: 5, cost: 2 },
];
const ENDGAME_RADAR = [
  { km: 0.1, label: '100m', cost: 7 },
  { km: 0.25, label: '250m', cost: 6 },
];

export default function App() {
  const [state, setState] = useState(null); // server view of the game
  const [network, setNetwork] = useState(null);
  const [toast, setToast] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('ths-theme') || 'dark');
  const [embedKey, setEmbedKey] = useState('');
  const [immersive, setImmersive] = useState(true); // seeker's default main screen

  useEffect(() => {
    socket.on('state', setState);
    fetch('/config').then((r) => r.json()).then((c) => setEmbedKey(c.embedKey || '')).catch(() => {});
    return () => socket.off('state', setState);
  }, []);

  // load the right city's network whenever the game's city is known/changes
  const cityId = state?.cityId;
  useEffect(() => {
    if (!cityId) return;
    let alive = true;
    fetch(`/network/${cityId}`).then((r) => r.json()).then((n) => alive && setNetwork(n));
    return () => { alive = false; };
  }, [cityId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('ths-theme', theme);
  }, [theme]);

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };
  const act = async (event, data) => {
    const r = await send(event, data);
    if (r?.error) flash(r.error);
    if (r?.gone) { setState(null); setNetwork(null); } // server lost the room — back to home
    return r;
  };

  const seekerSeeking = state && state.phase === 'seeking' && state.you.role === 'seeker';

  let view, immersiveActive = false;
  if (!state) view = <Home flash={flash} />;
  else if (state.phase === 'lobby') view = <Lobby state={state} act={act} />;
  else if (state.phase === 'hiding')
    view = state.you.role === 'hider'
      ? <HideSetup network={network} act={act} theme={theme} />
      : <WaitingBoard text={`The hider is choosing a spot somewhere in ${network?.name || 'the city'}`} />;
  else if (seekerSeeking && immersive && network) {
    immersiveActive = true;
    view = <ImmersiveView state={state} network={network} act={act} embedKey={embedKey} onExit={() => setImmersive(false)} />;
  } else {
    view = <GameBoard state={state} network={network} act={act} flash={flash} theme={theme} embedKey={embedKey}
      onEnterImmersive={seekerSeeking ? () => setImmersive(true) : null} />;
  }

  return (
    <div className="shell">
      {!immersiveActive && <Board state={state} network={network} theme={theme} setTheme={setTheme} />}
      {view}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Board({ state, network, theme, setTheme }) {
  const inGame = state && state.phase !== 'lobby' && state.phase !== 'hiding';
  const sub = network?.name ? network.name.toUpperCase() : 'REAL TRANSIT · REAL CITIES';
  return (
    <header className="board">
      <h1>Transit <span>Hide+Seek</span></h1>
      <div className="sub">{sub}</div>
      <div className="stat">
        {inGame && (
          <>
            <div><span className="lbl">Game clock</span><b>{state.clock} min</b></div>
            <div><span className="lbl">Coins</span><b>{state.coins}</b></div>
          </>
        )}
        {state && <div><span className="lbl">Room</span><b>{state.code}</b></div>}
        <button className="ghost small" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? '☀ Light' : '☾ Dark'}
        </button>
      </div>
    </header>
  );
}

function Home({ flash }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [cities, setCities] = useState([]);
  const [cityId, setCityId] = useState('sf');

  useEffect(() => {
    fetch('/cities').then((r) => r.json()).then((list) => {
      setCities(list);
      if (list[0]) setCityId(list[0].id);
    }).catch(() => {});
  }, []);

  const go = async (event, data) => {
    if (!name.trim()) return flash('Enter a name first');
    const r = await send(event, data);
    if (r?.error) flash(r.error);
  };
  return (
    <div className="center-stage">
      <div className="card">
        <h2>Now Boarding</h2>
        <p className="tag">
          One player hides somewhere near a station. Seekers ride real transit
          times, burn coins on questions, and win by dropping a pin within metres
          of the hiding spot.
        </p>
        <div className="field">
          <label>Your name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Andrew" />
        </div>
        <div className="field">
          <label>City</label>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {cities.map((c) => (
              <button key={c.id} className={`small ${cityId === c.id ? '' : 'ghost'}`}
                onClick={() => setCityId(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <button style={{ width: '100%' }} onClick={() => go('create', { name, cityId })}>
          Create a game
        </button>
        <button className="ghost" style={{ width: '100%', marginTop: 10 }} onClick={() => go('createSolo', { name, cityId })}>
          Hunt the Phantom (solo)
        </button>
        <div className="divider">or join one</div>
        <div className="row">
          <input
            type="text" value={code} placeholder="ROOM CODE" maxLength={4}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            style={{ letterSpacing: '0.3em', textTransform: 'uppercase' }}
          />
          <button className="ghost" onClick={() => go('join', { code, name })}>Join</button>
        </div>
      </div>
    </div>
  );
}

function Lobby({ state, act }) {
  const isHost = state.you.id === state.hostId;
  const hiders = state.players.filter((p) => p.role === 'hider').length;
  const seekers = state.players.filter((p) => p.role === 'seeker').length;
  return (
    <div className="center-stage">
      <div className="card">
        <h2>Platform Lobby</h2>
        <p className="tag">Share this code. Friends join from any device.</p>
        <div className="code-display">{state.code}</div>
        <div className="roster">
          {state.players.map((p) => (
            <div className="pl" key={p.id}>
              {p.name}{p.id === state.you.id && ' (you)'}
              <span className={`role-chip ${p.role}`}>{p.role}</span>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginBottom: 14 }}>
          <button className="ghost small" onClick={() => act('setRole', { role: 'hider' })}>I'll hide</button>
          <button className="ghost small" onClick={() => act('setRole', { role: 'seeker' })}>I'll seek</button>
        </div>
        <div className="field">
          <label>Tag distance — how close the pin must land{!isHost && ' (host picks)'}</label>
          <div className="row">
            {state.rules.WIN_RADIUS_OPTIONS.map((m) => (
              <button key={m} disabled={!isHost}
                className={`small ${state.rules.WIN_RADIUS_METERS === m ? '' : 'ghost'}`}
                onClick={() => act('setOptions', { winRadius: m })}>
                {m}m
              </button>
            ))}
          </div>
        </div>
        {isHost ? (
          <button style={{ width: '100%' }} disabled={hiders !== 1 || seekers < 1} onClick={() => act('start')}>
            {hiders !== 1 || seekers < 1 ? 'Need 1 hider + 1 seeker' : 'Start the game'}
          </button>
        ) : (
          <p className="hint">Waiting for the host to start<span className="blink-dots" /></p>
        )}
      </div>
    </div>
  );
}

function WaitingBoard({ text }) {
  return (
    <div className="waiting">
      <h2 style={{ fontFamily: 'var(--display)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        Stand by
      </h2>
      <p className="hint">{text}<span className="blink-dots" /></p>
    </div>
  );
}

// Hider picks a station, then an exact spot within the zone
function HideSetup({ network, act, theme }) {
  const [stationId, setStationId] = useState(null);
  const [pin, setPin] = useState(null);
  const station = stationId && network ? network.stations[stationId] : null;

  return (
    <div className="main">
      <div className="map-wrap">
        <div className="mode-banner">
          {!stationId ? 'Step 1 · Click a station to hide near' : `Step 2 · Click your exact hiding spot near ${station.name}`}
        </div>
        <MapView
          key={network?.id}
          network={network}
          theme={theme}
          clickMode={!stationId ? 'station' : 'point'}
          onStationClick={(id) => { setStationId(id); setPin(null); }}
          onMapClick={(lat, lng) => setPin({ lat, lng })}
          zone={station ? { lat: station.lat, lng: station.lng, radius: 500 } : null}
          possibleZones={network && { stations: Object.values(network.stations), radius: 500 }}
          pin={pin}
        />
        {stationId && (
          <div className="confirm-bar">
            <span>{pin ? 'Spot picked.' : `Zone: 500m around ${station.name}.`}</span>
            {pin && (
              <a href={streetViewUrl(pin.lat, pin.lng)} target="_blank" rel="noreferrer">
                Open Street View ↗
              </a>
            )}
            <button className="small ghost" onClick={() => { setStationId(null); setPin(null); }}>
              Change station
            </button>
            <button
              className="small" disabled={!pin}
              onClick={async () => {
                const r = await act('placeHider', { stationId, lat: pin.lat, lng: pin.lng });
                if (r?.error) setPin(null);
              }}
            >
              Lock it in
            </button>
          </div>
        )}
      </div>
      <div className="side">
        <div className="panel-section">
          <h3>How to hide</h3>
          <p className="hint">
            Pick any station, then click your exact hiding spot within the 500m
            zone. Open Street View to scope it out — that's your view of the
            world while the seekers hunt. Once you lock in, the clock starts.
          </p>
        </div>
      </div>
    </div>
  );
}

// Shrink a screenshot to a reasonably-sized JPEG data URL
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1200 / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}

// Main game: seekers move/ask/guess; hider watches the hunt
function GameBoard({ state, network, act, flash, theme, embedKey, onEnterImmersive }) {
  const isSeeker = state.you.role === 'seeker';
  const seeking = state.phase === 'seeking';
  const ended = state.phase === 'ended';
  const [mode, setMode] = useState('move'); // 'move' | 'walk' | 'guess'
  const [pendingMove, setPendingMove] = useState(null);
  const [pendingWalk, setPendingWalk] = useState(null);
  const [pendingGuess, setPendingGuess] = useState(null);
  const [preview, setPreview] = useState(null); // hover graphic for the map
  const [lightbox, setLightbox] = useState(null); // expanded feed photo
  const [svOpen, setSvOpen] = useState(false); // in-app Street View overlay
  const [menuDismissed, setMenuDismissed] = useState(false); // end-game menu
  const feedRef = useRef(null);
  const hoverProps = (p) => ({ onMouseEnter: () => setPreview(p), onMouseLeave: () => setPreview(null) });
  // clear preview when asking: a button disabled mid-hover never fires mouseleave
  const askQ = (type, params) => { setPreview(null); act('ask', { type, params }); };

  // drop any stale UI state when the game ends
  useEffect(() => {
    if (ended) { setPreview(null); setPendingMove(null); setPendingWalk(null); setPendingGuess(null); setSvOpen(false); }
  }, [ended]);

  // newest log entries render at the top
  useEffect(() => {
    feedRef.current?.scrollTo(0, 0);
  }, [state.feed.length, state.pendingPhoto]);

  // Hider can answer a photo request by pasting a screenshot (⌘V)
  const isHiderWithRequest = state.you.role === 'hider' && state.pendingPhoto;
  useEffect(() => {
    if (!isHiderWithRequest) return;
    const onPaste = async (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (!item) return;
      const img = await compressImage(item.getAsFile());
      act('photoReply', { img });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [isHiderWithRequest]);

  const sendPhotoFile = async (file) => {
    if (!file) return;
    try {
      const img = await compressImage(file);
      act('photoReply', { img });
    } catch {
      flash('Could not read that image');
    }
  };

  const guesses = state.feed.filter((f) => f.kind === 'guess' && f.lat);
  // answered radar questions stay visible on the map
  const radarHistory = state.feed
    .filter((f) => f.type === 'radar' && f.center)
    .map((f) => ({ center: f.center, radiusKm: f.radiusKm, yes: f.answer.startsWith('YES') }));
  // grey out everywhere the hider cannot be
  const possibleZones = useMemo(
    () => network && {
      stations: possibleStations(network, state.feed, state.rules.HIDE_ZONE_METERS),
      radius: state.rules.HIDE_ZONE_METERS,
      constraints: geoConstraints(state.feed, network),
    },
    [network, state.feed.length]
  );
  const canClick = isSeeker && seeking;
  const moveMins = pendingMove ? state.travelTimes?.[pendingMove] : null;
  const walkMeters = pendingWalk ? metersBetween(state.seekerPos, pendingWalk) : 0;
  const walkMins = Math.max(1, Math.ceil((walkMeters / 1000) * state.rules.WALK_PACE_MIN_PER_KM));
  const BANNERS = {
    move: 'Click a station to ride there',
    walk: `Walk mode · click within ${state.rules.MAX_WALK_METERS}m of where you stand`,
    guess: `Guess mode · pin must be within ${state.rules.GUESS_RANGE_METERS}m of you (15m of the hider wins)`,
  };

  return (
    <div className="main">
      <div className="map-wrap">
        {canClick && <div className="mode-banner">{BANNERS[mode]}</div>}
        {ended && menuDismissed && (
          <div className="end-banner" style={{ cursor: 'pointer' }} onClick={() => setMenuDismissed(false)}>
            <h2>Hider found!</h2>
            <p>Survived {state.clock} game-minutes · click for menu</p>
          </div>
        )}
        <MapView
          key={network?.id}
          network={network}
          theme={theme}
          seekerStation={state.seekerStation}
          seekerPos={state.seekerPos}
          walkPos={state.walkPos}
          thermoStart={state.thermoStart}
          guessRange={canClick && mode === 'guess'
            ? { lat: state.seekerPos.lat, lng: state.seekerPos.lng, radius: state.rules.GUESS_RANGE_METERS }
            : null}
          preview={preview}
          radarHistory={radarHistory}
          possibleZones={possibleZones}
          travelTimes={state.travelTimes}
          hider={state.hider ? { lat: state.hider.lat, lng: state.hider.lng } : null}
          guesses={guesses}
          pin={pendingGuess || pendingWalk}
          clickMode={canClick ? (mode === 'move' ? 'station' : 'point') : null}
          onStationClick={(id) => setPendingMove(id)}
          onMapClick={(lat, lng) => (mode === 'walk' ? setPendingWalk({ lat, lng }) : setPendingGuess({ lat, lng }))}
        />
        {pendingMove && mode === 'move' && canClick && (
          <div className="confirm-bar">
            <span>Ride to <b>{network.stations[pendingMove].name}</b> · {moveMins} min</span>
            <button className="small ghost" onClick={() => setPendingMove(null)}>Cancel</button>
            <button className="small" onClick={async () => { await act('move', { stationId: pendingMove }); setPendingMove(null); }}>
              Ride
            </button>
          </div>
        )}
        {pendingWalk && mode === 'walk' && canClick && (
          <div className="confirm-bar">
            <span>Walk <b>{Math.round(walkMeters)}m</b> · ~{walkMins} min</span>
            <button className="small ghost" onClick={() => setPendingWalk(null)}>Cancel</button>
            <button className="small" disabled={walkMeters > state.rules.MAX_WALK_METERS}
              onClick={async () => { await act('walk', pendingWalk); setPendingWalk(null); }}>
              {walkMeters > state.rules.MAX_WALK_METERS ? 'Too far' : 'Walk'}
            </button>
          </div>
        )}
        {pendingGuess && mode === 'guess' && canClick && (
          <div className="confirm-bar">
            <span>Drop the pin here?</span>
            <a href={streetViewUrl(pendingGuess.lat, pendingGuess.lng)} target="_blank" rel="noreferrer">
              Check Street View ↗
            </a>
            <button className="small ghost" onClick={() => setPendingGuess(null)}>Cancel</button>
            <button className="small" onClick={async () => { await act('guess', pendingGuess); setPendingGuess(null); }}>
              Final answer
            </button>
          </div>
        )}
      </div>

      <div className="side">
        {isSeeker && seeking && (
          <>
            {onEnterImmersive && (
              <div className="panel-section">
                <button style={{ width: '100%' }} onClick={onEnterImmersive}>
                  Enter Street View mode
                </button>
                <p className="hint" style={{ marginTop: 6 }}>Stand in the city and travel by facing each station.</p>
              </div>
            )}
            <div className="panel-section">
              <div className="row">
                <button className={mode === 'move' ? '' : 'ghost'}
                  onClick={() => { setMode('move'); setPendingGuess(null); setPendingWalk(null); }}>
                  Ride
                </button>
                <button className={mode === 'walk' ? '' : 'ghost'}
                  onClick={() => { setMode('walk'); setPendingMove(null); setPendingGuess(null); }}>
                  Walk
                </button>
                <button className={mode === 'guess' ? '' : 'ghost'}
                  onClick={() => { setMode('guess'); setPendingMove(null); setPendingWalk(null); }}>
                  Pin
                </button>
              </div>
              <p className="hint" style={{ marginTop: 8 }}>
                You must walk to the hider: pins only drop within {state.rules.GUESS_RANGE_METERS}m of where
                you stand. Wrong pins cost +{state.rules.WRONG_GUESS_PENALTY_MINS} min; within {state.rules.WIN_RADIUS_METERS}m
                of the hider wins. Greyed-out map areas can't contain the hider.
              </p>
            </div>
            <div className="panel-section">
              <h3>Ask the hider</h3>
              <div className="qgrid">
                {RADAR_OPTIONS.map((o) => (
                  <button key={o.km} className="qbtn" disabled={state.coins < o.cost}
                    {...hoverProps({ type: 'radar', radiusKm: o.km })}
                    onClick={() => askQ('radar', { radiusKm: o.km })}>
                    Radar {o.km}km <span className="cost">{o.cost}¢</span>
                  </button>
                ))}
                {state.thermoStart ? (
                  <button className="qbtn" disabled={state.coins < 3} {...hoverProps({ type: 'thermo' })}
                    onClick={() => askQ('thermometer', { action: 'end' })}>
                    Read thermometer <span className="cost">3¢</span>
                  </button>
                ) : (
                  <button className="qbtn" {...hoverProps({ type: 'thermo' })}
                    onClick={() => askQ('thermometer', { action: 'start' })}>
                    Start thermometer <span className="cost">free</span>
                  </button>
                )}
                <button className="qbtn" disabled={state.coins < 3} {...hoverProps({ type: 'lines' })}
                  onClick={() => askQ('sameLine')}>
                  Line check <span className="cost">3¢</span>
                </button>
                <button className="qbtn" disabled={state.coins < 5} {...hoverProps({ type: 'compass', axis: 'ns' })}
                  onClick={() => askQ('compass', { axis: 'ns' })}>
                  Compass N/S <span className="cost">5¢</span>
                </button>
                <button className="qbtn" disabled={state.coins < 5} {...hoverProps({ type: 'compass', axis: 'ew' })}
                  onClick={() => askQ('compass', { axis: 'ew' })}>
                  Compass E/W <span className="cost">5¢</span>
                </button>
              </div>
              <p className="hint" style={{ marginTop: 8 }}>Longer rides earn more coins; walking earns +{state.rules.COINS_PER_WALK}.</p>
            </div>
            {network?.matchCategories?.length > 0 && (
              <div className="panel-section">
                <h3>Matching</h3>
                <div className="qgrid">
                  {network.matchCategories.map((c) => (
                    <button key={c.id} className="qbtn" disabled={state.coins < c.cost}
                      {...hoverProps({ type: 'match', category: c.id })}
                      onClick={() => askQ('matching', { category: c.id })}>
                      {c.region ? `Same ${c.label}?` : `Nearest ${c.label}?`} <span className="cost">{c.cost}¢</span>
                    </button>
                  ))}
                </div>
                <p className="hint" style={{ marginTop: 8 }}>
                  Same borough / nearest landmark as the hider? — narrows the map to one region.
                </p>
              </div>
            )}
            <div className="panel-section">
              <h3>Endgame</h3>
              <div className="qgrid">
                {ENDGAME_RADAR.map((o) => (
                  <button key={o.km} className="qbtn" disabled={state.coins < o.cost}
                    {...hoverProps({ type: 'radar', radiusKm: o.km })}
                    onClick={() => askQ('radar', { radiusKm: o.km })}>
                    Radar {o.label} <span className="cost">{o.cost}¢</span>
                  </button>
                ))}
                <button className="qbtn" disabled={state.coins < 4}
                  {...hoverProps({ type: 'station' })}
                  onClick={() => askQ('rightStation')}>
                  Right station? <span className="cost">4¢</span>
                </button>
                {state.solo ? (
                  state.photoAvailable && (
                    <button className="qbtn" disabled={state.coins < 7 || state.photoUsed}
                      onClick={() => askQ('photo', {})}>
                      📷 {state.photoUsed ? 'Photo used' : 'The one photo'} <span className="cost">7¢</span>
                    </button>
                  )
                ) : (
                  Object.entries(network?.photoKinds || {}).map(([kind, def]) => (
                    <button key={kind} className="qbtn" disabled={state.coins < def.cost || !!state.pendingPhoto}
                      onClick={() => askQ('photo', { kind })}>
                      📷 {def.label} <span className="cost">{def.cost}¢</span>
                    </button>
                  ))
                )}
              </div>
              <p className="hint" style={{ marginTop: 8 }}>
                {state.solo
                  ? state.photoAvailable
                    ? 'The Phantom sends exactly one Street View photo of its spot per game. Spend it wisely.'
                    : 'No photos in solo mode until a Street View key is set on the server.'
                  : state.pendingPhoto
                    ? 'Waiting for the hider to deliver your photo…'
                    : 'Photos come from the hider’s actual Street View.'}
              </p>
            </div>
            {state.stationConfirmed && (
              <div className="panel-section photo-request">
                <h3>🛰 You found the station</h3>
                <p className="hint">
                  Right station confirmed. Explore Street View around you to pin the exact spot.
                </p>
                {embedKey ? (
                  <button className="small" onClick={() => setSvOpen(true)}>Explore Street View</button>
                ) : (
                  <a className="upload-btn" href={streetViewUrl(state.seekerPos.lat, state.seekerPos.lng)}
                    target="_blank" rel="noreferrer">Open Street View ↗</a>
                )}
              </div>
            )}
          </>
        )}
        {!isSeeker && seeking && (
          <>
            <div className="panel-section">
              <h3>You are hidden</h3>
              <p className="hint">
                Watch the seekers close in. Their questions are answered
                automatically from your true location — no fibbing possible.{' '}
                <a href={streetViewUrl(state.hider.lat, state.hider.lng)} target="_blank" rel="noreferrer">
                  Reopen your Street View ↗
                </a>
              </p>
            </div>
            {state.pendingPhoto && (
              <div className="panel-section photo-request">
                <h3>📷 Photo requested!</h3>
                <p className="hint">{network?.photoKinds?.[state.pendingPhoto.kind]?.instructions}</p>
                <p className="hint" style={{ margin: '8px 0' }}>
                  <a href={streetViewUrl(state.hider.lat, state.hider.lng)} target="_blank" rel="noreferrer">
                    Open your Street View ↗
                  </a>{' '}
                  then screenshot it.
                </p>
                <label className="upload-btn">
                  Upload screenshot
                  <input type="file" accept="image/*" hidden
                    onChange={(e) => { sendPhotoFile(e.target.files[0]); e.target.value = ''; }} />
                </label>
                <p className="hint" style={{ marginTop: 6 }}>…or just paste it here (⌘V)</p>
              </div>
            )}
          </>
        )}
        <div className="panel-section" style={{ borderBottom: 'none', paddingBottom: 4 }}>
          <h3>Transit log</h3>
        </div>
        <div className="feed" ref={feedRef}>
          {[...state.feed].reverse().map((f, i) => (
            <div className={`feed-item ${f.kind}`} key={state.feed.length - i}
              {...(f.type === 'radar' && f.center
                ? hoverProps({ type: 'radarResult', center: f.center, radiusKm: f.radiusKm, yes: f.answer.startsWith('YES') })
                : f.type === 'matching'
                ? hoverProps({ type: 'matchResult', category: f.category, poiId: f.poiId, yes: f.answer.startsWith('YES') })
                : {})}>
              <span className="t">T+{f.clock} min</span>
              {f.kind === 'question' ? (
                <>{f.label} — <span className="ans">{f.answer}</span></>
              ) : (
                f.text
              )}
              {f.img && <img className="feed-img" src={f.img} alt={f.label} onClick={() => setLightbox(f.img)} />}
            </div>
          ))}
        </div>
      </div>
      {ended && !menuDismissed && (
        <EndMenu state={state} onSeeMap={() => setMenuDismissed(true)} />
      )}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <div className="lightbox-split" onClick={(e) => e.stopPropagation()}>
            <img src={lightbox} alt="expanded photo" />
            <div className="lightbox-map">
              <div className="lightbox-map-label">Area still in play</div>
              <MiniMap network={network} feed={state.feed} zoneR={state.rules.HIDE_ZONE_METERS}
                seekerPos={state.seekerPos} theme={theme} />
            </div>
          </div>
        </div>
      )}
      {svOpen && embedKey && (
        <StreetViewPanel
          embedKey={embedKey}
          center={state.seekerPos}
          photo={[...state.feed].reverse().find((f) => f.img)?.img || null}
          network={network}
          feed={state.feed}
          zoneR={state.rules.HIDE_ZONE_METERS}
          onClose={() => setSvOpen(false)}
          onGuess={async (p) => { const r = await act('walk', p); if (!r?.error) act('guess', p); }}
          onDone={async (p) => { await act('walk', p); setSvOpen(false); }}
        />
      )}
    </div>
  );
}

// End-of-game summary + menu
function EndMenu({ state, onSeeMap }) {
  const questions = state.feed.filter((f) => f.kind === 'question').length;
  const wrongPins = state.feed.filter((f) => f.kind === 'guess' && f.hit === false).length;
  const rides = state.feed.filter((f) => f.kind === 'move').length;
  return (
    <div className="end-menu-overlay">
      <div className="end-menu">
        <h2>Hider Found</h2>
        <p className="tag">The seekers closed in.</p>
        <div className="summary">
          <div><b>{state.clock}</b><span>game-minutes survived</span></div>
          <div><b>{questions}</b><span>questions asked</span></div>
          <div><b>{rides}</b><span>rides taken</span></div>
          <div><b>{wrongPins}</b><span>wrong pins</span></div>
        </div>
        <button style={{ width: '100%' }} onClick={() => window.location.reload()}>
          Play again
        </button>
        <button className="ghost" style={{ width: '100%', marginTop: 10 }} onClick={onSeeMap}>
          See where the hider was
        </button>
      </div>
    </div>
  );
}
