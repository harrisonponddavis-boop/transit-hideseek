// Scripted hider for manual playtesting: joins a room, takes the hider role,
// hides at a spot, and answers any photo request with a placeholder image.
// Usage: node demo-hider.js ROOMCODE [stationId lat lng]
const { io } = require('socket.io-client');

const code = process.argv[2];
const stationId = process.argv[3] || 'CAS';
const lat = Number(process.argv[4] || 37.764);
const lng = Number(process.argv[5] || -122.4338);
if (!code) { console.error('usage: node demo-hider.js ROOMCODE [stationId lat lng]'); process.exit(1); }

// 1x1 red PNG — stands in for a Street View screenshot
const SAMPLE_IMG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const s = io('http://localhost:3001');
const emit = (ev, data) => new Promise((res) => s.emit(ev, data, res));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let state = null;
s.on('state', (st) => { state = st; });

(async () => {
  const j = await emit('join', { code, name: 'Scripted Hider' });
  if (j.error) { console.error('join failed:', j.error); process.exit(1); }
  await emit('setRole', { role: 'hider' });
  console.log('joined as hider — waiting for host to start...');

  while (!state || state.phase === 'lobby') await sleep(400);
  const r = await emit('placeHider', { stationId, lat, lng });
  console.log(`hid near ${stationId} →`, JSON.stringify(r));
  while (state.phase !== 'seeking') await sleep(300);

  const deadline = Date.now() + 180000;
  while (Date.now() < deadline && state.phase === 'seeking') {
    if (state.pendingPhoto) {
      console.log('photo requested:', state.pendingPhoto.kind, '— sending screenshot');
      console.log('reply →', JSON.stringify(await emit('photoReply', { img: SAMPLE_IMG })));
    }
    await sleep(500);
  }
  console.log('done. phase:', state.phase);
  process.exit(0);
})();
