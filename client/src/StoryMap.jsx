import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { JOBS, jobStatus, jobsDone, equippedTitleName, equippedDotColor, effectiveBonusCoins } from './career';
import { speak, stopSpeaking } from './voice';
import { VoiceToggle } from './Radio';

// Physical relief tiles, aged to parchment in CSS (sepia + paper grain + vignette).
const TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}';

// Where each city sits, plus which way its banner unfurls so the crowded
// US north-east (Boston / NYC / DC) doesn't pile up on itself.
const CITY_META = {
  sf:      { center: [37.77, -122.42], dir: 'w',  name: 'San Francisco' },
  la:      { center: [34.05, -118.25], dir: 'sw', name: 'Los Angeles' },
  chicago: { center: [41.88, -87.63],  dir: 'nw', name: 'Chicago' },
  boston:  { center: [42.36, -71.06],  dir: 'ne', name: 'Boston' },
  nyc:     { center: [40.73, -73.99],  dir: 'e',  name: 'New York City' },
  dc:      { center: [38.90, -77.03],  dir: 'se', name: 'Washington DC' },
  london:  { center: [51.51, -0.12],   dir: 'nw', name: 'London' },
  paris:   { center: [48.86, 2.35],    dir: 'sw', name: 'Paris' },
  berlin:  { center: [52.52, 13.40],   dir: 'ne', name: 'Berlin' },
  tokyo:   { center: [35.68, 139.76],  dir: 'e',  name: 'Tokyo' },
};

const AT_KEY = 'ths-story-at';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

// A gentle arc between two points (a quadratic curve bowed to one side), like
// a route inked on an old chart.
function arcPoints(a, b, n = 40) {
  const [la1, lo1] = a, [la2, lo2] = b;
  const mx = (la1 + la2) / 2, my = (lo1 + lo2) / 2;
  const dx = la2 - la1, dy = lo2 - lo1;
  const bow = 0.18;
  const cx = mx - dy * bow, cy = my + dx * bow;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push([u * u * la1 + 2 * u * t * cx + t * t * la2, u * u * lo1 + 2 * u * t * cy + t * t * lo2]);
  }
  return pts;
}

export default function StoryMap({ career, onPlayJob, onFreeRoam, onShop, onExit }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const youRef = useRef(null);
  const animRef = useRef(null);
  const [names, setNames] = useState({});
  const [at, setAt] = useState(() => { try { return localStorage.getItem(AT_KEY) || 'sf'; } catch { return 'sf'; } });
  const [city, setCity] = useState(null);   // selected city id (panel open)
  const [job, setJob] = useState(null);     // job whose brief is open
  const [traveling, setTraveling] = useState(false);

  useEffect(() => {
    fetch('/cities').then((r) => r.json())
      .then((list) => setNames(Object.fromEntries(list.map((c) => [c.id, c.name]))))
      .catch(() => {});
  }, []);
  useEffect(() => () => stopSpeaking(), []);

  const done = jobsDone(career);
  const chapter = ROMAN[Math.min(ROMAN.length - 1, Math.floor(done / 3))];
  const cityName = (id) => names[id] || CITY_META[id]?.name || id;

  // jobs per city, and a status for the city's medallion
  const byCity = useMemo(() => {
    const m = {};
    for (const id of Object.keys(CITY_META)) m[id] = [];
    for (const j of JOBS) (m[j.city] = m[j.city] || []).push(j);
    return m;
  }, []);
  const cityState = (id) => {
    const js = byCity[id] || [];
    const st = js.map((j) => jobStatus(j, career));
    const open = st.filter((s) => !s.locked && !s.done).length;
    const all = js.length && st.every((s) => s.done);
    return { open, all, total: js.length };
  };

  const clickCity = useRef(null);
  clickCity.current = (id) => travelTo(id);

  // ---- map setup ----
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, {
      zoomControl: false, attributionControl: false, worldCopyJump: false,
      minZoom: 2, maxZoom: 7, zoomSnap: 0.25, maxBounds: [[-70, -200], [80, 200]], maxBoundsViscosity: 0.8,
    });
    L.tileLayer(TILES, { maxNativeZoom: 8, noWrap: true }).addTo(map);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    const pts = Object.values(CITY_META).map((c) => c.center);
    map.fitBounds(L.latLngBounds(pts).pad(0.12), { paddingTopLeft: [60, 90], paddingBottomRight: [60, 120] });
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(elRef.current);
    return () => { ro.disconnect(); cancelAnimationFrame(animRef.current); map.remove(); mapRef.current = null; };
  }, []);

  // ---- city medallions, the inked route, and your token ----
  useEffect(() => {
    const map = mapRef.current, lg = layerRef.current;
    if (!map || !lg) return;
    lg.clearLayers();

    // dotted route from where you are to the city you're looking at
    if (city && city !== at && CITY_META[city]) {
      L.polyline(arcPoints(CITY_META[at].center, CITY_META[city].center), {
        color: '#5b3a17', weight: 3, dashArray: '1 9', lineCap: 'round', opacity: 0.9, interactive: false,
      }).addTo(lg);
    }

    for (const [id, meta] of Object.entries(CITY_META)) {
      const s = cityState(id);
      const cls = [s.all ? 'cleared' : '', s.open ? 'has-work' : '', city === id ? 'sel' : '', at === id ? 'here' : ''].join(' ');
      const icon = L.divIcon({
        className: 'sm-city-icon', iconSize: [0, 0],
        html: `<div class="sm-city dir-${meta.dir} ${cls}">
          <span class="sm-seal">${s.all ? '★' : s.open ? s.open : '·'}</span>
          <span class="sm-flag"><b>${cityName(id)}</b><i>${s.all ? 'all jobs done' : s.open ? `${s.open} job${s.open === 1 ? '' : 's'} open` : 'jobs locked'}</i></span>
        </div>`,
      });
      L.marker(meta.center, { icon, riseOnHover: true, keyboard: true, title: cityName(id) })
        .on('click', () => clickCity.current(id))
        .addTo(lg);
    }

    // your token (a compass rose) at your current city
    youRef.current = L.marker(CITY_META[at]?.center || CITY_META.sf.center, {
      icon: L.divIcon({ className: 'sm-you-icon', iconSize: [0, 0], html: `<div class="sm-you" style="--you:${equippedDotColor(career)}">✦</div>` }),
      interactive: false, zIndexOffset: 1000,
    }).addTo(lg);
  }, [city, at, names, career]); // eslint-disable-line react-hooks/exhaustive-deps

  // Travel: slide your token along the inked arc, then open the city's scroll.
  const travelTo = (id) => {
    if (traveling) return;
    setJob(null);
    const openCity = () => {
      setCity(id);
      const s = cityState(id);
      speak(`${cityName(id)}. ${s.open ? `${s.open} job${s.open === 1 ? '' : 's'} waiting for you here.` : s.all ? 'You have cleared every job here.' : 'Nothing open here yet.'}`, 'narrator');
    };
    if (id === at) { openCity(); return; }
    setCity(id);
    setTraveling(true);
    const path = arcPoints(CITY_META[at].center, CITY_META[id].center, 60);
    const t0 = performance.now(), dur = 1100;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      youRef.current?.setLatLng(path[Math.round(e * (path.length - 1))]);
      if (t < 1) animRef.current = requestAnimationFrame(step);
      else {
        setAt(id);
        try { localStorage.setItem(AT_KEY, id); } catch { /* ignore */ }
        setTraveling(false);
        openCity();
      }
    };
    animRef.current = requestAnimationFrame(step);
    mapRef.current?.flyTo(CITY_META[id].center, Math.max(mapRef.current.getZoom(), 3), { duration: 1.1 });
  };

  const openJob = (j) => {
    setJob(j);
    speak(`${j.title}. From ${j.giver}. ${j.brief}`, 'narrator');
  };

  const jobs = city ? byCity[city] || [] : [];

  return (
    <div className="story-map">
      <div ref={elRef} className="sm-leaflet" />
      <div className="sm-paper" />

      {/* top-left: leave / shop */}
      <div className="sm-topleft">
        <button className="sm-btn" onClick={onExit}>← Home</button>
        <button className="sm-btn" onClick={onShop}>🛒 Outfitter</button>
      </div>

      {/* top-right: chapter plaque */}
      <div className="sm-plaque">
        <span className="sm-chapter">Chapter {chapter}</span>
        <span className="sm-cash">💵 {career.cash}</span>
      </div>

      {/* left: the city scroll (read aloud) */}
      {city && (
        <div className="sm-scroll" key={city}>
          <div className="sm-scroll-rod" />
          <div className="sm-scroll-head">
            <span>{cityName(city)}</span>
            <VoiceToggle />
            <button className="sm-x" onClick={() => { setCity(null); setJob(null); stopSpeaking(); }} title="Close">✕</button>
          </div>
          <div className="sm-scroll-body">
            {!job && (
              <>
                {jobs.map((j) => {
                  const st = jobStatus(j, career);
                  return (
                    <button key={j.id} className={`sm-act ${st.locked ? 'locked' : ''} ${st.done ? 'done' : ''}`}
                      onClick={() => openJob(j)}>
                      <span className="sm-act-ico">{j.arc ? '📜' : j.tone === 'spy' ? '🕶' : '🔎'}</span>
                      <span className="sm-act-main">
                        <b>{j.title}</b>
                        <i>{st.locked ? `🔒 ${st.lockReason}` : j.arc ? `${j.arc} · Part ${j.part}` : j.giver}</i>
                      </span>
                      {st.done && <span className="sm-stars">{'★'.repeat(st.stars)}<em>{'★'.repeat(3 - st.stars)}</em></span>}
                    </button>
                  );
                })}
                <button className="sm-act roam" onClick={() => onFreeRoam(city)}>
                  <span className="sm-act-ico">🧭</span>
                  <span className="sm-act-main"><b>Explore the city</b><i>A free hunt for the Phantom · no pay</i></span>
                </button>
              </>
            )}
            {job && (() => {
              const st = jobStatus(job, career);
              return (
                <div className="sm-brief">
                  <div className="sm-brief-tag">{job.arc ? `${job.arc} · Part ${job.part}` : job.tone === 'spy' ? 'Assignment' : 'Job'}</div>
                  <h3>{job.title}</h3>
                  <div className="sm-giver">— {job.giver}</div>
                  <p>{job.brief}</p>
                  <div className="sm-terms">
                    <span>Pay 💵 {job.reward}{st.stars < 3 ? '+' : ''}</span>
                    <span>★★★ under {job.par} min</span>
                  </div>
                  <div className="sm-brief-actions">
                    <button className="sm-btn ghost" onClick={() => { setJob(null); stopSpeaking(); }}>‹ Back</button>
                    {st.locked
                      ? <span className="sm-lock">🔒 {st.lockReason}</span>
                      : <button className="sm-btn go" onClick={() => onPlayJob(job)}>{st.done ? 'Take it again ▸' : 'Take the job ▸'}</button>}
                  </div>
                </div>
              );
            })()}
          </div>
          <div className="sm-scroll-rod" />
        </div>
      )}

      {/* bottom-right: your character card */}
      <div className="sm-card">
        <div className="sm-portrait" style={{ '--you': equippedDotColor(career) }}>🕵️</div>
        <div className="sm-card-info">
          <b>{equippedTitleName(career)}</b>
          <div className="sm-bar"><span style={{ width: `${Math.round((done / JOBS.length) * 100)}%` }} /></div>
          <span>Jobs {done} / {JOBS.length}</span>
          <span>Now in {cityName(at)}{effectiveBonusCoins(career) ? ` · +${effectiveBonusCoins(career)} start coins` : ''}</span>
        </div>
      </div>

      <div className="sm-hint">{traveling ? 'Travelling…' : city ? 'Pick a job to read the brief' : 'Click a city to travel there'}</div>
    </div>
  );
}
