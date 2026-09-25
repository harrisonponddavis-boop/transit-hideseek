// Career / story mode: a catalog of jobs across the ten cities, a shop of
// cosmetics + perks, and the local profile. Each job is played as a normal solo
// hunt in its city; finishing pays out cash scaled by a 1–3 star grade.
//
// The profile is the source of truth for progress. It lives in localStorage and,
// when the player is signed in, syncs to their account (handled in App.jsx).

const KEY = 'ths-career';

// ---- Jobs ---------------------------------------------------------------
// requires: null = open from the start; { job: id } = finish that job first
// (used for multi-part arcs); { done: n } = finish any n jobs first.
// par = target game-minutes for a 3-star grade.
export const JOBS = [
  // Arc: "The Ledger" — grounded finder-for-hire
  { id: 'led1', city: 'sf', tone: 'grounded', arc: 'The Ledger', part: 1,
    title: 'The No-Show Tenant', giver: 'Marisol, landlord',
    brief: 'A tenant cleared out owing three months’ rent and left a forwarding address that doesn’t exist. Last seen near a Muni stop. Find where they’re really holed up.',
    reward: 70, par: 20, requires: null },
  { id: 'led2', city: 'chicago', tone: 'grounded', arc: 'The Ledger', part: 2,
    title: 'Follow the Money', giver: 'Marisol, landlord',
    brief: 'The deadbeat wired cash to a contact in Chicago. Marisol wants you to find that contact before the trail goes cold along the ‘L’.',
    reward: 100, par: 22, requires: { job: 'led1' } },
  { id: 'led3', city: 'nyc', tone: 'grounded', arc: 'The Ledger', part: 3,
    title: 'The Last Address', giver: 'Marisol, landlord',
    brief: 'It ends in New York. One more person knows where the money went — track them down and Marisol finally closes the ledger.',
    reward: 150, par: 24, requires: { job: 'led2' } },

  // Arc: "Nightingale" — spy thriller
  { id: 'ngt1', city: 'london', tone: 'spy', arc: 'Nightingale', part: 1,
    title: 'Cold Meet', giver: 'Handler "Wren"',
    brief: 'An asset codenamed Nightingale wants to come in. She’ll surface near a Tube station and vanish fast. Reach her before the other side does.',
    reward: 90, par: 20, requires: null },
  { id: 'ngt2', city: 'berlin', tone: 'spy', arc: 'Nightingale', part: 2,
    title: 'The Wall Has Ears', giver: 'Handler "Wren"',
    brief: 'Nightingale ran to Berlin with a courier on her tail. Find the courier first and you find her. Watch the U-Bahn.',
    reward: 130, par: 22, requires: { job: 'ngt1' } },
  { id: 'ngt3', city: 'paris', tone: 'spy', arc: 'Nightingale', part: 3,
    title: 'Burn Notice', giver: 'Handler "Wren"',
    brief: 'Extraction, Paris. Nightingale has one window to make the meet before her cover burns for good. Bring her in.',
    reward: 200, par: 24, requires: { job: 'ngt2' } },

  // Standalone jobs
  { id: 'sf_dog', city: 'sf', tone: 'grounded', arc: null,
    title: 'Runaway Mascot', giver: 'The Ferry Building',
    brief: 'The market’s beloved mascot wandered off during the morning rush. Someone spotted the costume near a stop — go reunite them with their oversized head.',
    reward: 60, par: 18, requires: null },
  { id: 'bos_reunion', city: 'boston', tone: 'grounded', arc: null,
    title: 'Reunion on the Red Line', giver: 'Eleanor, 81',
    brief: 'Eleanor hasn’t seen her college roommate in sixty years. She just moved back to Boston. Find her before the reunion dinner.',
    reward: 80, par: 20, requires: null },
  { id: 'tok_regular', city: 'tokyo', tone: 'grounded', arc: null,
    title: 'The Vanishing Regular', giver: 'A tiny ramen bar',
    brief: 'A loyal regular stopped showing up. The owner is worried. Find where they’ve been eating instead — and why.',
    reward: 110, par: 22, requires: { done: 2 } },
  { id: 'la_star', city: 'la', tone: 'grounded', arc: null,
    title: 'Star Search', giver: 'A frantic agent',
    brief: 'A rising actor ghosted their own premiere and was last seen boarding the Metro. Find them before the studio does.',
    reward: 120, par: 24, requires: { done: 2 } },
  { id: 'dc_quiet', city: 'dc', tone: 'spy', arc: null,
    title: 'Quiet in Georgetown', giver: 'An unlisted number',
    brief: 'A analyst went dark after leaving a message: "they know." Locate them across the Metro before anyone else reads that message.',
    reward: 150, par: 24, requires: { done: 4 } },
  { id: 'nyc_drop', city: 'nyc', tone: 'spy', arc: null,
    title: 'Dead Drop Downtown', giver: 'Handler "Wren"',
    brief: 'A courier is holding a package that shouldn’t exist. They’ll blend into the crowd near a downtown station. Get to them first.',
    reward: 160, par: 24, requires: { done: 4 } },
  { id: 'par_flaneur', city: 'paris', tone: 'grounded', arc: null,
    title: 'Le Flâneur', giver: 'A worried sister',
    brief: 'Her brother quit his job to "walk Paris and think." He isn’t answering. Find him somewhere along the Métro and tell him to call home.',
    reward: 170, par: 24, requires: { done: 6 } },
];

// ---- Shop ---------------------------------------------------------------
// Dot skins are just a colour for your "YOU" marker on every map.
export const DOT_SKINS = {
  dot_gold:    { color: '#ffd23f' },
  dot_crimson: { color: '#ff4b5c' },
  dot_emerald: { color: '#2ecc71' },
  dot_violet:  { color: '#a55eea' },
  dot_cyan:    { color: '#22d3ee' },
  dot_white:   { color: '#f5f2e8' },
  dot_pink:    { color: '#ff6bcb' },
};

export const SHOP = {
  dots: [
    { id: 'dot_gold',    name: 'Gold (default)', price: 0 },
    { id: 'dot_crimson', name: 'Crimson',        price: 70 },
    { id: 'dot_emerald', name: 'Emerald',        price: 70 },
    { id: 'dot_violet',  name: 'Violet',         price: 90 },
    { id: 'dot_cyan',    name: 'Cyan',           price: 90 },
    { id: 'dot_white',   name: 'Bone White',     price: 120 },
    { id: 'dot_pink',    name: 'Hot Pink',       price: 140 },
  ],
  titles: [
    { id: 't_rookie',       name: 'Rookie',          price: 0 },
    { id: 't_bloodhound',   name: 'The Bloodhound',  price: 120 },
    { id: 't_cartographer', name: 'Cartographer',    price: 160 },
    { id: 't_ghost',        name: 'The Ghost',       price: 220 },
    { id: 't_nightingale',  name: 'Nightingale',     price: 320 },
  ],
  perks: [
    { id: 'perk_card', name: 'Transit Card',      price: 100, bonusCoins: 4,
      desc: 'Start every job with +4 coins.' },
    { id: 'perk_gold', name: 'Gold Transit Card', price: 260, bonusCoins: 8,
      desc: 'Start every job with +8 coins (replaces the standard card).' },
  ],
};

const DEFAULT = {
  cash: 0,
  jobs: {},                                   // { jobId: { stars: 1..3 } }
  owned: ['dot_gold', 't_rookie'],            // shop item ids
  equipped: { dot: 'dot_gold', title: 't_rookie' },
};

export function defaultCareer() {
  return JSON.parse(JSON.stringify(DEFAULT));
}

// Merge a stored/loaded profile onto the defaults so new fields never break it.
export function normalizeCareer(raw) {
  const p = defaultCareer();
  if (raw && typeof raw === 'object') {
    if (typeof raw.cash === 'number') p.cash = Math.max(0, Math.floor(raw.cash));
    if (raw.jobs && typeof raw.jobs === 'object') p.jobs = raw.jobs;
    if (Array.isArray(raw.owned)) p.owned = Array.from(new Set([...DEFAULT.owned, ...raw.owned]));
    if (raw.equipped && typeof raw.equipped === 'object') p.equipped = { ...p.equipped, ...raw.equipped };
  }
  return p;
}

export function loadCareer() {
  try { return normalizeCareer(JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch { return defaultCareer(); }
}
export function saveCareerLocal(profile) {
  try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* ignore */ }
  // mirror the equipped dot colour where the maps can read it without prop-drilling
  try { localStorage.setItem('ths-dot-color', equippedDotColor(profile)); } catch { /* ignore */ }
}

// ---- Pure helpers -------------------------------------------------------
export function jobsDone(profile) {
  return Object.values(profile.jobs || {}).filter((j) => j && j.stars > 0).length;
}

export function jobStatus(job, profile) {
  const done = !!(profile.jobs && profile.jobs[job.id]);
  let locked = false, lockReason = '';
  const r = job.requires;
  if (r && r.job && !(profile.jobs && profile.jobs[r.job])) {
    locked = true;
    const prev = JOBS.find((j) => j.id === r.job);
    lockReason = `Finish "${prev ? prev.title : r.job}" first`;
  } else if (r && typeof r.done === 'number' && jobsDone(profile) < r.done) {
    locked = true;
    lockReason = `Complete ${r.done} jobs to unlock`;
  }
  return { done, locked, lockReason, stars: done ? profile.jobs[job.id].stars : 0 };
}

// Final game-clock -> 1..3 stars against the job's par.
export function starsFor(job, clockMins) {
  if (clockMins <= job.par) return 3;
  if (clockMins <= Math.round(job.par * 1.8)) return 2;
  return 1;
}

// Payout for a grade. First clear pays full; a replay that beats your old grade
// pays the *difference* in value so you can grind a job up to 3 stars but not farm it.
const STAR_MULT = { 1: 1, 2: 1.5, 3: 2 };
export function payoutFor(job, stars, prevStars) {
  const value = (s) => Math.round(job.reward * (STAR_MULT[s] || 1));
  if (!prevStars) return value(stars);
  return Math.max(0, value(Math.max(stars, prevStars)) - value(prevStars));
}

export function effectiveBonusCoins(profile) {
  let best = 0;
  for (const perk of SHOP.perks) {
    if ((profile.owned || []).includes(perk.id)) best = Math.max(best, perk.bonusCoins);
  }
  return best;
}

export function equippedDotColor(profile) {
  const skin = DOT_SKINS[profile?.equipped?.dot] || DOT_SKINS.dot_gold;
  return skin.color;
}

export function equippedTitleName(profile) {
  const t = SHOP.titles.find((x) => x.id === profile?.equipped?.title);
  return t ? t.name : 'Rookie';
}

// The colour any map should paint the "YOU" marker (read at draw time).
export function currentDotColor() {
  try { return localStorage.getItem('ths-dot-color') || '#ffd23f'; } catch { return '#ffd23f'; }
}
