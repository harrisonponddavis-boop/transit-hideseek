import { useState } from 'react';
import { SHOP, DOT_SKINS } from './career';
import StoryMap from './StoryMap';

const Stars = ({ n, max = 3 }) => (
  <span className="stars" aria-label={`${n} of ${max} stars`}>
    {Array.from({ length: max }, (_, i) => (
      <span key={i} className={`star ${i < n ? 'on' : ''}`}>★</span>
    ))}
  </span>
);

// The career hub is a world map (StoryMap): travel between cities and take
// the jobs waiting in each. The Outfitter (shop) opens over it.
export default function CareerHub({ career, commit, onPlayJob, onFreeRoam, onExit }) {
  const [shop, setShop] = useState(false);

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
    <>
      <StoryMap career={career} onPlayJob={onPlayJob} onFreeRoam={onFreeRoam}
        onShop={() => setShop(true)} onExit={onExit} />
      {shop && (
        <div className="sm-modal" onClick={() => setShop(false)}>
          <div className="sm-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="sm-modal-head">
              <span>The Outfitter</span>
              <span className="sm-cash">💵 {career.cash}</span>
              <button className="sm-x" onClick={() => setShop(false)}>✕</button>
            </div>
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
          </div>
        </div>
      )}
    </>
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
