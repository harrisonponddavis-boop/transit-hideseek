import { useEffect, useState } from 'react';
import { fetchLeaderboard } from './auth';

// Per-city fastest solo runs (in-game minutes). Reading is public; your own
// times appear here once you play a solo hunt while signed in.
export default function Leaderboard({ user, onExit }) {
  const [cities, setCities] = useState([]);
  const [city, setCity] = useState('sf');
  const [scores, setScores] = useState(null);

  useEffect(() => {
    fetch('/cities').then((r) => r.json()).then((list) => {
      setCities(list);
      if (list[0]) setCity(list[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!city) return;
    let alive = true;
    setScores(null);
    fetchLeaderboard(city).then((s) => { if (alive) setScores(s); });
    return () => { alive = false; };
  }, [city]);

  const cityName = cities.find((c) => c.id === city)?.name || city;

  return (
    <div className="center-stage">
      <div className="career-card">
        <div className="career-head">
          <button className="ghost small" onClick={onExit}>← Home</button>
          <span className="cw-title">🏆 fastest hunts</span>
        </div>
        <h2 className="career-h">Leaderboards</h2>
        <p className="tag" style={{ marginTop: -4 }}>
          The quickest solo catches in each city, measured in game-minutes. Sign in and
          win a solo hunt to put your time on the board.
        </p>

        <div className="field" style={{ marginTop: 8 }}>
          <label>City</label>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {cities.map((c) => (
              <button key={c.id} className={`small ${city === c.id ? '' : 'ghost'}`}
                onClick={() => setCity(c.id)}>{c.name}</button>
            ))}
          </div>
        </div>

        <div className="career-scroll" style={{ marginTop: 6 }}>
          {scores === null && <p className="hint">Loading {cityName}…</p>}
          {scores && scores.length === 0 && (
            <p className="hint">No times in {cityName} yet — be the first to set one.</p>
          )}
          {scores && scores.length > 0 && (
            <ol className="lb-list">
              {scores.map((s, i) => (
                <li key={i} className={`lb-row ${s.username === user ? 'me' : ''} ${i < 3 ? 'top' : ''}`}>
                  <span className="lb-rank">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</span>
                  <span className="lb-name">{s.username}{s.username === user ? ' (you)' : ''}</span>
                  <span className="lb-mins">{s.mins} min</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
