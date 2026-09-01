// Simulates a full game against the rules engine, then a socket round-trip.
const assert = require('assert');
const { STATIONS, travelTimes, haversineMeters, getCity, listCities } = require('./stations');
const { createGame, setOptions, setHider, move, walk, ask, guess, photoReply, viewFor, RULES,
  board, disembark, linesAt, alongLineMins } = require('./game');

// --- Every city must be a single connected graph ---
const cityList = listCities();
assert(cityList.some((c) => c.id === 'sf') && cityList.some((c) => c.id === 'nyc'), 'sf + nyc registered');
for (const { id } of cityList) {
  const city = getCity(id);
  const reach = city.travelTimes(city.startStation);
  const orphans = Object.keys(city.stations).filter((s) => reach[s] === undefined);
  assert.deepStrictEqual(orphans, [], `${id}: unreachable stations ${orphans}`);
  // every line stop must be a real station
  for (const line of city.lines)
    for (const stop of line.stops)
      assert(city.stations[stop], `${id}: line ${line.id} references missing station ${stop}`);
  console.log(`✓ ${id}: ${Object.keys(city.stations).length} stations, ${city.lines.length} lines, all connected from ${city.startStation}`);
}

// A full NYC game: hide near Coney Island, confirm questions answer correctly
const nyc = getCity('nyc');
const ny = createGame('HN', 'Hider', 'nyc');
ny.players.push({ id: 'SN', name: 'Seeker', role: 'seeker' });
ny.phase = 'hiding';
assert.strictEqual(ny.seekerStation, 'TSQ', 'NYC seekers start at Times Sq');
const coney = nyc.stations.CONEY;
assert(setHider(ny, 'HN', 'CONEY', coney.lat + 0.001, coney.lng).ok);
ny.coins = 30;
let nr = ask(ny, 'compass', { axis: 'ns' }); // Coney is far south of Times Sq
assert.strictEqual(nr.answer, 'SOUTH', `expected SOUTH, got ${nr.answer}`);
nr = ask(ny, 'rightStation'); // at Times Sq, not Coney
assert(nr.answer.startsWith('NO'));
assert(viewFor(ny, 'SN').cityId === 'nyc' && viewFor(ny, 'SN').hider === undefined);
// matching: seeker at Times Sq (nearest zoo = Central Park), hider at Coney
// Island (nearest zoo = Prospect Park) → different
ny.coins = 30;
const mr = ask(ny, 'matching', { category: 'zoo' });
assert(mr.ok, `matching should succeed: ${mr.error}`);
const mEntry = ny.feed.find((f) => f.type === 'matching');
assert(mEntry.category === 'zoo' && mEntry.poiId, 'matching records category + matched landmark');
assert(mr.answer.startsWith('NO'), `Times Sq vs Coney zoos differ, got ${mr.answer}`);
console.log('✓ NYC matching question: nearest-zoo compare answers + records poiId');

// Borough matching: seeker at Times Sq (Manhattan), hider at Coney (Brooklyn)
ny.coins = 30;
const br = ask(ny, 'matching', { category: 'borough' });
assert(br.ok && br.answer.startsWith('NO'), `Manhattan vs Brooklyn should differ, got ${br.answer}`);
assert(getCity('nyc').pois.filter((p) => p.category === 'borough').length === 5, 'NYC has 5 boroughs');
assert(getCity('sf').pois.some((p) => p.category === 'district'), 'SF has districts');
// region categories carry the region flag for the client
const { matchCategoriesFor } = require('./game');
assert(matchCategoriesFor(getCity('nyc')).find((c) => c.id === 'borough')?.region === true);
assert(!matchCategoriesFor(getCity('nyc')).find((c) => c.id === 'borough')?.label.includes('district'));
console.log('✓ borough/district region matching: same-region compare + region flag');

// --- Every station in a region-city carries a valid neighbourhood label ---
{
  const REGION_CATS = ['borough', 'district', 'ward'];
  for (const { id } of cityList) {
    const c = getCity(id);
    if (!matchCategoriesFor(c).some((x) => x.region)) continue;
    const regionIds = new Set(c.pois.filter((p) => REGION_CATS.includes(p.category)).map((p) => p.id));
    for (const s of Object.values(c.stations)) {
      assert(s.region, `${id}: station ${s.id} has no region label`);
      assert(regionIds.has(s.region), `${id}: station ${s.id} has unknown region "${s.region}"`);
    }
    console.log(`✓ ${id}: all ${Object.keys(c.stations).length} stations labelled with a real region`);
  }
}

// --- Region matching: seeker + hider in the same borough answers YES ---
{
  const g = createGame('HR', 'H', 'nyc');
  g.players.push({ id: 'SR', name: 'S', role: 'seeker' });
  g.phase = 'hiding';
  const coney = getCity('nyc').stations.CONEY;
  assert(setHider(g, 'HR', 'CONEY', coney.lat + 0.001, coney.lng).ok);
  g.coins = 30;
  move(g, 'ATL'); // Atlantic Av–Barclays Ctr is Brooklyn, like Coney
  const same = ask(g, 'matching', { category: 'borough' });
  assert(same.ok && same.answer.startsWith('YES'), `same borough should be YES, got ${same.answer}`);
  console.log('✓ region matching: seeker + hider both in Brooklyn → YES');
}

// --- Ride coins scale with trip length ---
{
  const cg = createGame('CX', 'x');
  cg.players.push({ id: 'cs', name: 's', role: 'seeker' });
  cg.phase = 'hiding';
  assert(setHider(cg, 'CX', 'CAS', STATIONS.CAS.lat + 0.001, STATIONS.CAS.lng).ok);
  let before = cg.coins; move(cg, 'MONT'); const shortGain = cg.coins - before; // 1-min hop
  before = cg.coins; move(cg, 'OB'); const longGain = cg.coins - before;        // long cross-town ride
  assert(longGain > shortGain, `long ride should pay more (short ${shortGain} vs long ${longGain})`);
  console.log(`✓ ride coins scale with trip length: short hop +${shortGain}, long ride +${longGain}`);
}

// --- Board a line at a stop, ride it, and get off ---
{
  const bg = createGame('BX', 'x');
  bg.players.push({ id: 'bs', name: 's', role: 'seeker' });
  bg.phase = 'hiding';
  assert(setHider(bg, 'BX', 'OB', STATIONS.OB.lat + 0.001, STATIONS.OB.lng).ok);
  // seekers start at EMB; the MKT (Market St) line stops there
  const embLines = linesAt(getCity('sf'), 'EMB').map((l) => l.id);
  assert(embLines.includes('MKT') && embLines.includes('BART'), 'EMB served by MKT + BART');
  assert(disembark(bg, 'CIVC').error, 'cannot get off before boarding');
  assert(board(bg, 'N').error, 'N Judah does not stop at EMB');
  const clockBefore = bg.clock, coinsBefore = bg.coins;
  assert(board(bg, 'MKT').ok, 'board the Market St line');
  assert(bg.aboard && bg.aboard.lineId === 'MKT' && bg.aboard.fromStation === 'EMB');
  assert(bg.clock > clockBefore, 'waiting for the vehicle costs time');
  assert(board(bg, 'BART').error, 'cannot board twice');
  // getting off at a stop not on the MKT line is rejected
  assert(disembark(bg, 'OB').error, 'OB is not on the MKT line');
  const mktRide = alongLineMins(getCity('sf').lines.find((l) => l.id === 'MKT'), 'EMB', 'CAS');
  assert(disembark(bg, 'CAS').ok, 'get off at Castro');
  assert.strictEqual(bg.seekerStation, 'CAS', 'now standing at Castro');
  assert.strictEqual(bg.aboard, null, 'no longer aboard');
  assert(bg.coins - coinsBefore >= RULES.MIN_RIDE_COINS, 'riding earns coins');
  assert(bg.clock >= clockBefore + mktRide, 'ride time was added');
  console.log(`✓ board→ride→disembark: waited then rode MKT EMB→Castro (${mktRide} min ride)`);
}

// --- Rules engine simulation ---
const g = createGame('H1', 'Hider');
g.players.push({ id: 'S1', name: 'Seeker', role: 'seeker' });
g.phase = 'hiding';

// Network sanity: every station reachable from Embarcadero
const times = travelTimes('EMB');
const unreachable = Object.keys(STATIONS).filter((id) => times[id] === undefined);
assert.deepStrictEqual(unreachable, [], `Unreachable stations: ${unreachable}`);
console.log('✓ all', Object.keys(STATIONS).length, 'stations reachable from EMB');
console.log('  e.g. EMB → Ocean Beach:', times.OB, 'min; EMB → SF Zoo:', times.ZOO, 'min');

// Hider hides 200m from Castro station
const castro = STATIONS.CAS;
const hideLat = castro.lat + 0.0015, hideLng = castro.lng + 0.001; // ~190m NE
assert(haversineMeters(castro.lat, castro.lng, hideLat, hideLng) < RULES.HIDE_ZONE_METERS);

// Too-far placement rejected
const far = setHider(g, 'H1', 'CAS', castro.lat + 0.02, castro.lng);
assert(far.error, 'far placement should fail');
console.log('✓ out-of-zone hiding spot rejected');

assert(setHider(g, 'H1', 'CAS', hideLat, hideLng).ok);
assert.strictEqual(g.phase, 'seeking');
console.log('✓ hider placed near Castro, phase=seeking');

// Seeker view must not contain hider location
const sView = viewFor(g, 'S1');
assert.strictEqual(sView.hider, undefined, 'seeker must not see hider');
const hView = viewFor(g, 'H1');
assert(hView.hider && hView.hider.lat === hideLat, 'hider sees own location');
console.log('✓ hider location hidden from seekers, visible to hider');

// Radar from EMB with 2km: Castro is ~4km away -> NO
let r = ask(g, 'radar', { radiusKm: 2 });
assert(r.answer.startsWith('NO'), `expected NO, got ${r.answer}`);
console.log('✓ radar 2km from EMB: NO (hider is in the Castro)');

// Thermometer is a two-step tool: start at EMB, move toward the hider, read.
assert(ask(g, 'thermometer', { action: 'end' }).error, 'reading before starting is blocked');
assert(ask(g, 'thermometer', { action: 'start' }).ok);
assert(move(g, 'CHU').ok);
r = ask(g, 'thermometer', { action: 'end' });
assert.strictEqual(r.answer, 'WARMER');
// reading again without restarting is blocked
assert(ask(g, 'thermometer', { action: 'end' }).error);
console.log('✓ thermometer: start → move → read WARMER; re-read blocked until restarted');

// Move to Castro, radar 0.5km should be YES (need coins: started 10, spent 3+3, earned 4)
assert(move(g, 'CAS').ok);
r = ask(g, 'radar', { radiusKm: 0.5 });
assert(r.answer.startsWith('YES'), `expected YES, got ${r.answer}`);
console.log('✓ radar 0.5km from Castro: YES | coins:', g.coins, '| clock:', g.clock);

// sameLine: hider zone station CAS shares MKT line with seeker at CAS
r = ask(g, 'sameLine');
assert(r.answer.startsWith('YES'));

// broke: compass costs 5 — must error without touching state
g.coins = 0;
assert(ask(g, 'compass', { axis: 'ns' }).error, 'broke seekers must be refused');
console.log('✓ question refused when out of coins');

// right station: we're at CAS, hider's zone station is CAS.
// Confirming the zone triggers the once-per-game endgame coin triple.
g.coins = 10;
r = ask(g, 'rightStation');
assert(r.answer.startsWith('YES'), `expected YES, got ${r.answer}`);
assert.strictEqual(g.coins, (10 - 4) * 3, 'coins should triple after zone confirmation');
assert(g.endgameBonus);
assert(g.stationConfirmed, 'Right Station YES unlocks Street View');
assert(viewFor(g, 'S1').stationConfirmed === true);
assert(g.feed.some((f) => f.text?.includes('tripled')), 'bonus message in feed');
console.log('✓ right station: YES triples coins once + unlocks Street View');

// compass: hider is north of Castro station
g.coins = 10; // top up for the rest of the sim
r = ask(g, 'compass', { axis: 'ns' });
assert.strictEqual(r.answer, 'NORTH');
console.log('✓ line check + compass answers correct');

// Close-range radar (endgame): 100m from Castro station — hider is ~190m off, NO
g.coins = 20;
r = ask(g, 'radar', { radiusKm: 0.1 });
assert(r.answer.startsWith('NO'), `expected NO, got ${r.answer}`);
// 250m radar: YES — would confirm the zone, but the bonus only fires once
r = ask(g, 'radar', { radiusKm: 0.25 });
assert(r.answer.startsWith('YES'), `expected YES, got ${r.answer}`);
assert.strictEqual(g.coins, 20 - 7 - 6, 'bonus must not fire twice');
console.log('✓ endgame radar 100m NO / 250m YES at ~190m distance; bonus fires once');

// Photo flow: request -> pending -> no double-ask -> hider delivers -> feed has image
r = ask(g, 'photo', { kind: 'sky' });
assert(r.ok && g.pendingPhoto?.kind === 'sky');
assert(ask(g, 'photo', { kind: 'north' }).error, 'second photo while pending must fail');
assert(photoReply(g, 'not-an-image').error, 'non-image reply rejected');
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
assert(photoReply(g, tinyPng).ok);
assert.strictEqual(g.pendingPhoto, null);
const photoEntry = g.feed.find((f) => f.type === 'photo');
assert.strictEqual(photoEntry.img, tinyPng);
assert.strictEqual(photoEntry.answer, 'PHOTO DELIVERED');
assert(photoReply(g, tinyPng).error, 'reply with nothing pending rejected');
console.log('✓ photo request → pending → delivered → image in feed');

// Guessing from the station is blocked — hider is ~190m away, > 50m reach
r = guess(g, hideLat, hideLng);
assert(r.error && r.error.includes('Walk closer'), 'must walk before tagging');

// Walking: too-far leg rejected, then walk to ~55m from the hider
assert(walk(g, hideLat + 0.05, hideLng).error, 'multi-km walk must be rejected');
const clockBeforeWalk = g.clock;
r = walk(g, hideLat + 0.0005, hideLng);
assert(r.ok && g.walkPos, 'walk should succeed');
assert(g.clock > clockBeforeWalk, 'walking costs time');
console.log('✓ guess blocked from afar; walking works and costs minutes |', 'clock:', g.clock);

// Radar from a walked position: 100m radar now reads YES (we are ~55m away)
g.coins += 7;
r = ask(g, 'radar', { radiusKm: 0.1 });
assert(r.answer.startsWith('YES'), `radar should be centered on walked position, got ${r.answer}`);
console.log('✓ radar centers on walked position (100m YES at ~55m)');

// Wrong guess ~60m off the hider but within reach of where we stand
const clockBefore = g.clock;
r = guess(g, hideLat + 0.0005, hideLng + 0.0003);
assert(!r.hit && r.close, 'should be a close miss');
assert.strictEqual(g.clock, clockBefore + RULES.WRONG_GUESS_PENALTY_MINS);

// Guess 20m off: still a miss (15m rule is strict)
r = guess(g, hideLat + 0.00018, hideLng);
assert(!r.hit, '20m off must miss');

// Guess 10m off: hit
r = guess(g, hideLat + 0.00009, hideLng);
assert(r.hit, '10m off must hit');
assert.strictEqual(g.phase, 'ended');
assert.strictEqual(g.winner, 'seekers');
// After game ends, seekers can see hider location
assert(viewFor(g, 'S1').hider);
console.log('✓ guess rules: 60m close-miss, 20m miss, 10m HIT. Final clock:', g.clock, 'min');

// Lobby options: configurable tag distance
const g2 = createGame('H2', 'Hider2');
assert(setOptions(g2, { winRadius: 99 }).error, 'bad radius rejected');
assert(setOptions(g2, { winRadius: 50 }).ok);
assert.strictEqual(g2.winRadius, 50);
g2.players.push({ id: 'S2', name: 'S', role: 'seeker' });
g2.phase = 'hiding';
assert(setOptions(g2, { winRadius: 10 }).error, 'options locked after lobby');
assert(setHider(g2, 'H2', 'GLEN', STATIONS.GLEN.lat + 0.001, STATIONS.GLEN.lng).ok);
assert(move(g2, 'GLEN').ok);
assert(walk(g2, STATIONS.GLEN.lat + 0.0007, STATIONS.GLEN.lng).ok);
// pin ~33m from hider: a miss at the default 15m, but a hit at 50m
r = guess(g2, STATIONS.GLEN.lat + 0.0007, STATIONS.GLEN.lng);
assert(r.hit, '33m pin should win at the 50m setting');
assert(viewFor(g2, 'S2').rules.WIN_RADIUS_METERS === 50);
console.log('✓ lobby-configurable tag distance (33m pin wins at 50m setting)');

// --- Solo mode: AI hider + one Street View photo ---
async function testSolo() {
  const { createSoloGame, placeSoloHider, soloPhoto, RULES: R } = require('./game');
  const { haversineMeters } = require('./stations');

  // mock Street View: metadata echoes the queried point, photo returns bytes
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    if (url.includes('/metadata')) {
      const m = url.match(/location=([-0-9.]+),([-0-9.]+)/);
      return { ok: true, json: async () => ({ status: 'OK', location: { lat: +m[1], lng: +m[2] } }) };
    }
    return {
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => Buffer.from('fake-jpeg-bytes'),
    };
  };

  const g = createSoloGame('P1', 'Andrew', true);
  assert(g.solo && g.players.find((p) => p.id === 'BOT')?.role === 'hider');
  assert.strictEqual(g.players[0].role, 'seeker');
  await placeSoloHider(g, 'TESTKEY');
  assert.strictEqual(g.phase, 'seeking');
  const zoneStation = STATIONS[g.hider.stationId];
  const d = haversineMeters(zoneStation.lat, zoneStation.lng, g.hider.lat, g.hider.lng);
  assert(d <= R.HIDE_ZONE_METERS, 'AI spot must be inside its hide zone');
  // seeker must not see the bot's spot
  assert.strictEqual(viewFor(g, 'P1').hider, undefined);

  // the one photo
  g.coins = 10;
  let r = await soloPhoto(g, 'TESTKEY');
  assert(r.ok && g.photoUsed && g.coins === 3);
  const entry = g.feed.find((f) => f.type === 'photo');
  assert(entry.img.startsWith('data:image/jpeg;base64,'));
  r = await soloPhoto(g, 'TESTKEY');
  assert(r.error && r.error.includes('one photo'), 'second photo refused');
  // no key configured -> graceful error
  const g2 = createSoloGame('P2', 'B', false);
  await placeSoloHider(g2, '');
  assert((await soloPhoto(g2, '')).error);
  global.fetch = realFetch;
  console.log('✓ solo mode: bot hides in zone, one photo per game, no-key fallback');
}

// --- Matching questions: Voronoi-cell elimination + constraints ---
async function testMatching() {
  const { possibleStations, geoConstraints } = await import('../client/src/solver.js');
  const c = getCity('nyc');
  const net = { stations: c.stations, lines: c.lines, pois: c.pois };

  // Answer NO with seeker's nearest zoo = Central Park → hider is NOT in the
  // Central Park cell, so midtown stations (in that cell) drop, Bronx survives.
  const no = [{ kind: 'question', type: 'matching', category: 'zoo', poiId: 'CPZOO', answer: 'NO — different zoo' }];
  const idsNo = possibleStations(net, no, 500).map((s) => s.id);
  assert(!idsNo.includes('TSQ'), 'Times Sq (Central Park cell) eliminated under NO');
  assert(idsNo.includes('B161'), 'Yankee Stadium (Bronx Zoo cell) survives under NO');

  // Same question answered YES flips it: midtown survives, Bronx drops.
  const yes = [{ kind: 'question', type: 'matching', category: 'zoo', poiId: 'CPZOO', answer: 'YES — same zoo' }];
  const idsYes = possibleStations(net, yes, 500).map((s) => s.id);
  assert(idsYes.includes('TSQ'), 'Times Sq survives under YES');
  assert(!idsYes.includes('B161'), 'Yankee Stadium eliminated under YES');

  const cons = geoConstraints(no, net);
  assert(cons.length === 1 && cons[0].kind === 'cellOut', 'NO emits a cellOut constraint');
  assert(cons[0].star.id === 'CPZOO' && cons[0].rivals.length === 3, 'cell anchored on CP zoo vs 3 rivals');
  assert(geoConstraints(yes, net)[0].kind === 'cellIn', 'YES emits a cellIn constraint');
  console.log('✓ matching solver: Voronoi-cell elimination flips with YES/NO; cellIn/cellOut emitted');

  // region matching filters whole stations by their real borough — no Voronoi
  const bkYes = [{ kind: 'question', type: 'matching', category: 'borough', poiId: 'BKN', region: true, answer: 'YES — same borough' }];
  const keptBk = possibleStations(net, bkYes, 500);
  assert(keptBk.length > 0 && keptBk.every((s) => s.region === 'BKN'), 'region YES keeps only that borough');
  assert(keptBk.some((s) => s.id === 'CONEY'), 'Brooklyn set includes Coney');
  assert(geoConstraints(bkYes, net).length === 0, 'region matching emits no geometric constraint');
  const bkNo = [{ kind: 'question', type: 'matching', category: 'borough', poiId: 'BKN', region: true, answer: 'NO — different borough' }];
  assert(possibleStations(net, bkNo, 500).every((s) => s.region !== 'BKN'), 'region NO drops that borough');
  console.log('✓ region matching solver: keeps/drops whole boroughs by station label');
}

// --- Client exclusion solver (shared module) ---
// Immersive-view geometry: bearings to face stations + neighbour lookup
async function testImmersive() {
  const { bearingBetween, neighborsWithBearing } = await import('../client/src/solver.js');
  const { LINES } = require('./stations');
  const net = { stations: STATIONS, lines: LINES };
  // due-north / due-east sanity
  assert(Math.abs(bearingBetween({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 0) < 1, 'north ≈ 0°');
  assert(Math.abs(bearingBetween({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 90) < 1, 'east ≈ 90°');
  // Embarcadero's neighbours include Montgomery (SW) with a southwest-ish bearing
  const nb = neighborsWithBearing(net, 'EMB');
  const mont = nb.find((n) => n.id === 'MONT');
  assert(mont && mont.bearing > 180 && mont.bearing < 270, `Montgomery should be SW of Embarcadero, got ${mont?.bearing}`);
  assert(nb.every((n) => n.color && n.name), 'each neighbour has a line colour + name');
  console.log('✓ immersive geometry: compass bearings + station neighbours with line colours');
}

async function testSolver() {
  const { possibleStations, geoConstraints } = await import('../client/src/solver.js');
  const { LINES } = require('./stations');
  const network = { stations: STATIONS, lines: LINES };

  const sim = createGame('H', 'h');
  sim.players.push({ id: 'S', name: 's', role: 'seeker' });
  sim.phase = 'hiding';
  setHider(sim, 'H', 'CAS', STATIONS.CAS.lat + 0.0015, STATIONS.CAS.lng + 0.001);
  move(sim, 'POWL');

  ask(sim, 'compass', { axis: 'ew' }); // WEST: hider is west of Powell
  let ids = possibleStations(network, sim.feed, 500).map((s) => s.id);
  assert(!ids.includes('EMB') && !ids.includes('DOG'), 'WEST must eliminate the eastern waterfront');
  assert(ids.includes('CAS') && ids.includes('OB'), 'WEST must keep the west side');

  ask(sim, 'compass', { axis: 'ns' }); // SOUTH from Powell
  ids = possibleStations(network, sim.feed, 500).map((s) => s.id);
  assert(!ids.includes('CTWN'), 'SOUTH must eliminate Chinatown');
  assert(ids.includes('CAS'), 'hider zone always survives');

  sim.coins = 50;
  ask(sim, 'radar', { radiusKm: 2 }); // NO from Powell (~3.4km to hider)
  ask(sim, 'sameLine');               // YES: CAS shares the Market line with POWL
  ids = possibleStations(network, sim.feed, 500).map((s) => s.id);
  assert(!ids.includes('CIVC'), 'radar NO eliminates zones fully inside');
  assert(!ids.includes('OB'), 'sameLine YES eliminates N-only stations');
  assert(ids.includes('CAS'), 'hider zone still survives all answers');

  const cons = geoConstraints(sim.feed);
  assert.strictEqual(cons.filter((c) => c.kind === 'halfplane').length, 2);
  assert.strictEqual(cons.filter((c) => c.kind === 'outside').length, 1);
  console.log('✓ exclusion solver: compass E/W + N/S, radar NO, line check, constraints');
}

// --- Point-in-possible-region (Street View "you've left the area" warning) ---
async function testPointPossible() {
  const { isPointPossible } = await import('../client/src/solver.js');
  const { LINES } = require('./stations');
  const network = { stations: STATIONS, lines: LINES };
  // a single radar YES 1km around Castro: points near Castro possible, far not
  const feed = [{ kind: 'question', type: 'radar', answer: 'YES — inside',
    center: { lat: STATIONS.CAS.lat, lng: STATIONS.CAS.lng }, radiusKm: 1 }];
  assert(isPointPossible(network, feed, 500, { lat: STATIONS.CAS.lat + 0.001, lng: STATIONS.CAS.lng }), 'spot by Castro is possible');
  assert(!isPointPossible(network, feed, 500, { lat: STATIONS.OB.lat, lng: STATIONS.OB.lng }), 'Ocean Beach (outside radar) is ruled out');
  // a point in open water far from any station is never possible
  assert(!isPointPossible(network, [], 500, { lat: 37.81, lng: -122.36 }), 'mid-bay point is impossible (no station nearby)');
  console.log('✓ point-possible test powers the Street View out-of-area warning');
}

// --- Socket round-trip ---
process.env.GAME_PORT = '3197';
require('./index');
const { io } = require('socket.io-client');

(async () => {
  await testSolo();
  await testMatching();
  await testImmersive();
  await testSolver();
  await testPointPossible();
  const url = 'http://localhost:3197';
  const hider = io(url);
  const seeker = io(url);
  const emit = (sock, ev, data) => new Promise((res) => sock.emit(ev, data, res));

  const created = await emit(hider, 'create', { name: 'H' });
  assert(created.ok);
  const joined = await emit(seeker, 'join', { code: created.code, name: 'S' });
  assert(joined.ok);
  assert((await emit(hider, 'start')).ok);
  const placed = await emit(hider, 'placeHider', { stationId: 'GLEN', lat: STATIONS.GLEN.lat + 0.001, lng: STATIONS.GLEN.lng });
  assert(placed.ok);
  const moved = await emit(seeker, 'move', { stationId: 'GLEN' });
  assert(moved.ok);
  const radar = await emit(seeker, 'ask', { type: 'radar', params: { radiusKm: 5 } });
  assert(radar.ok);
  const farGuess = await emit(seeker, 'guess', { lat: STATIONS.GLEN.lat + 0.001, lng: STATIONS.GLEN.lng });
  assert(farGuess.error, 'guess beyond reach must be rejected over sockets too');
  const walked = await emit(seeker, 'walk', { lat: STATIONS.GLEN.lat + 0.001, lng: STATIONS.GLEN.lng });
  assert(walked.ok);
  const win = await emit(seeker, 'guess', { lat: STATIONS.GLEN.lat + 0.001, lng: STATIONS.GLEN.lng });
  assert(win.hit);
  console.log('✓ socket E2E: create → join → start → hide → move → radar → walk → winning guess');

  // A client acting on a room the server doesn't have (e.g. after a restart)
  // must get a clear error, not silence — this is what froze the live game.
  const orphan = io(url);
  const r1 = await emit(orphan, 'ask', { type: 'rightStation' });
  assert(r1 && r1.error && r1.gone, 'action with no room returns a gone error');
  const r2 = await emit(orphan, 'move', { stationId: 'GLEN' });
  assert(r2 && r2.gone, 'move with no room returns a gone error');
  console.log('✓ actions on a missing room return a clear "gone" error (no silent freeze)');

  console.log('\nALL TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
