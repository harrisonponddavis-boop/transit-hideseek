import { useEffect, useMemo, useState } from 'react';
import {
  JOBS, SHOP, DOT_SKINS, jobStatus, jobsDone, effectiveBonusCoins, equippedTitleName,
} from './career';

const Stars = ({ n, max = 3 }) => (
  <span className="stars" aria-label={`${n} of ${max} stars`}>
    {Array.from({ length: max }, (_, i) => (
      <span key={i} className={`star ${i < n ? 'on' : ''}`}>★</span>
    ))}
  </span>
);

export default function CareerHub({ career, commit, onPlayJob, onExit }) {
  const [tab, setTab] = useState('jobs');
  const [cityNames, setCityNames] = useState({});

  useEffect(() => {
    fetch('/cities').then((r) => r.json())
      .then((list) => setCityNames(Object.fromEntries(list.map((c) => [c.id, c.name]))))
      .catch(() => {});
  }, []);

  const done = jobsDone(career);
  const bonus = effectiveBonusCoins(career);

  // group jobs: arcs first (in order), then standalone
  const arcs = useMemo(() => {
    const map = new Map();
    for (const j of JOBS) if (j.arc) {
      if (!map.has(j.arc)) map.set(j.arc, []);
      map.get(j.arc).push(j);
    }
    return [...map.entries()];
  }, []);
  const standalone = JOBS.filter((j) => !j.arc);

  const JobCard = ({ job }) => {
    const st = jobStatus(job, career);
    return (
      <div className={`job-card ${st.locked ? 'locked' : ''} ${st.done ? 'done' : ''}`}>
        <div className="job-top">
          <span className={`tone-chip ${job.tone}`}>{job.tone === 'spy' ? '🕶 Spy' : '🔎 Finder'}</span>
          <span className="job-city">{cityNames[job.city] || job.city}</span>
          {st.done && <Stars n={st.stars} />}
        </div>
        <h4 className="job-title">{job.title}</h4>
        <div className="job-giver">{job.giver}</div>
        <p className="job-brief">{job.brief}</p>
        <div className="job-foot">
          <span className="job-reward">💵 {job.reward}{st.stars < 3 ? '+' : ''}</span>
          {st.locked ? (
            <span className="job-lock">🔒 {st.lockReason}</span>
          ) : (
            <button className="small" onClick={() => onPlayJob(job)}>
              {st.done ? (st.stars < 3 ? 'Replay ↑' : 'Replay') : 'Take job ▸'}
            </button>
          )}
        </div>
      </div>
    );
  };

  const owned = (id) => (career.owned || []).includes(id);
  const buy = (item) => {
    if (owned(item.id) || career.cash < item.price) return;
    commit({ ...career, cash: career.cash - item.price, owned: [...career.owned, item.id] });
  };
  const equip = (kind, id) => commit({ ...career, equipped: { ...career.equipped, [kind]: id } });

  const ShopRow = ({ item, kind, swatch }) => {
    const have = owned(item.id);
    const isOn = career.equipped[kind] === item.id;
    return (
      <div className="shop-row">
        {swatch}
        <div className="shop-info">
          <b>{item.name}</b>
          {item.desc && <span className="shop-desc">{item.desc}</span>}
        </div>
        {have ? (
          kind === 'perk' ? (
            <span className="shop-owned">Owned</span>
          ) : isOn ? (
            <span className="shop-on">Equipped</span>
          ) : (
            <button className="small ghost" onClick={() => equip(kind, item.id)}>Equip</button>
          )
        ) : (
          <button className="small" disabled={career.cash < item.price} onClick={() => buy(item)}>
            💵 {item.price}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="center-stage">
      <div className="career-card">
        <div className="career-head">
          <button className="ghost small" onClick={onExit}>← Home</button>
          <div className="career-wallet">
            <span className="cw-title">{equippedTitleName(career)}</span>
            <span className="cw-cash">💵 {career.cash}</span>
          </div>
        </div>
        <h2 className="career-h">Career</h2>
        <p className="tag" style={{ marginTop: -4 }}>
          You're a finder for hire. Take jobs across the world, get graded on speed,
          bank the cash, and kit yourself out. {done} job{done === 1 ? '' : 's'} done
          {bonus ? ` · +${bonus} start coins` : ''}.
        </p>

        <div className="career-tabs">
          <button className={tab === 'jobs' ? '' : 'ghost'} onClick={() => setTab('jobs')}>Jobs</button>
          <button className={tab === 'shop' ? '' : 'ghost'} onClick={() => setTab('shop')}>Shop</button>
        </div>

        {tab === 'jobs' && (
          <div className="career-scroll">
            {arcs.map(([name, jobs]) => (
              <div className="job-arc" key={name}>
                <div className="arc-label">📖 {name} <span>· story arc</span></div>
                {jobs.map((j) => <JobCard key={j.id} job={j} />)}
              </div>
            ))}
            <div className="arc-label">🗂 Odd jobs</div>
            {standalone.map((j) => <JobCard key={j.id} job={j} />)}
          </div>
        )}

        {tab === 'shop' && (
          <div className="career-scroll">
            <div className="shop-section">Marker skins <span>· your dot on every map</span></div>
            {SHOP.dots.map((d) => (
              <ShopRow key={d.id} item={d} kind="dot"
                swatch={<span className="dot-swatch" style={{ background: DOT_SKINS[d.id]?.color }} />} />
            ))}
            <div className="shop-section">Titles <span>· shown on your profile</span></div>
            {SHOP.titles.map((t) => (
              <ShopRow key={t.id} item={t} kind="title" swatch={<span className="title-swatch">🏷</span>} />
            ))}
            <div className="shop-section">Perks <span>· a head start on every job</span></div>
            {SHOP.perks.map((p) => (
              <ShopRow key={p.id} item={p} kind="perk" swatch={<span className="title-swatch">🎫</span>} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Shown after finishing a career job.
export function CareerReward({ job, stars, payout, onContinue }) {
  return (
    <div className="end-menu-overlay">
      <div className="end-menu career-reward">
        <h2>{job.arc ? job.arc : 'Job complete'}</h2>
        <p className="tag">{job.title} — found.</p>
        <div className="reward-stars"><Stars n={stars} /></div>
        <div className="reward-pay">+ 💵 {payout}</div>
        <p className="hint" style={{ marginBottom: 16 }}>
          {stars === 3 ? 'Flawless work — top rate.'
            : stars === 2 ? 'Solid. Sharpen up for the full bonus.'
            : 'Case closed. Faster next time pays more.'}
        </p>
        <button style={{ width: '100%' }} onClick={onContinue}>Back to career</button>
      </div>
    </div>
  );
}
