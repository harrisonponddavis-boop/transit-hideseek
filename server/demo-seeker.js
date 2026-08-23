// Scripted seeker for manual playtesting: joins a room, waits for the hider,
// then hunts. Usage: node demo-seeker.js ROOMCODE [hideLat hideLng]
const { io } = require('socket.io-client');

const code = process.argv[2];
const hideLat = Number(process.argv[3] || 37.764);
const hideLng = Number(process.argv[4] || -122.4338);
if (!code) { console.error('usage: node demo-seeker.js ROOMCODE [lat lng]'); process.exit(1); }

const s = io('http://localhost:3001');
const emit = (ev, data) => new Promise((res) => s.emit(ev, data, res));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let state = null;
s.on('state', (st) => { state = st; });

(async () => {
  s.on('connect', () => console.log('connected', s.id));
  const j = await emit('join', { code, name: 'Scripted Seeker' });
  if (j.error) { console.error('join failed:', j.error); process.exit(1); }
  console.log('joined room', code, '— waiting for the hider to lock in...');

  while (!state || state.phase !== 'seeking') await sleep(500);
  console.log('seeking! hunting near', hideLat, hideLng);

  const step = async (label, ev, data) => {
    const r = await emit(ev, data);
    console.log(label, '→', JSON.stringify(r));
    await sleep(1200); // let humans watch the feed update
  };

  await step('radar 5km from EMB', 'ask', { type: 'radar', params: { radiusKm: 5 } });
  await step('ride to Church', 'move', { stationId: 'CHU' });
  await step('thermometer', 'ask', { type: 'thermometer' });
  await step('ride to Castro', 'move', { stationId: 'CAS' });
  await step('radar 0.5km', 'ask', { type: 'radar', params: { radiusKm: 0.5 } });
  await step('walk toward the hider', 'walk', { lat: hideLat + 0.0004, lng: hideLng });
  await step('radar 100m from foot position', 'ask', { type: 'radar', params: { radiusKm: 0.1 } });
  await step('wrong guess ~60m off', 'guess', { lat: hideLat + 0.00055, lng: hideLng });
  await step('final guess on the spot', 'guess', { lat: hideLat + 0.00005, lng: hideLng });

  console.log('final phase:', state.phase, 'winner:', state.winner, 'clock:', state.clock);
  process.exit(0);
})();
