# Transit Hide+Seek

Online hide-and-seek across real transit networks, inspired by Jet Lag: The
Game. One player hides near a station and opens Google Street View of their
spot. Seekers ride the network using real-ish travel times, spend coins on
Jet Lag-style questions, and win by dropping a pin within metres of the
hiding spot. Pick your city in the lobby — **San Francisco** (Muni + BART),
**New York City** (subway across all five boroughs), **Chicago** (the CTA
'L'), and **Tokyo** (the JR Yamanote loop + crossing lines) ship today.

## Adding a city

Each city is one file in `server/cities/` exporting `{ id, name, center,
zoom, startStation, stations, lines }` (see `sf.js` / `nyc.js`), then listed
in `CITY_DEFS` in `server/stations.js`. The registry builds the graph,
shortest-path times, and line lists automatically; the lobby picker and map
pick it up with no other changes. Stations shared between lines must use the
same id so the graph stays connected — `npm test` verifies connectivity for
every city.

## Run it

```bash
npm install            # root tooling (concurrently)
npm run install:all    # server + client deps
npm run dev            # server :3001 + client :5173
```

Open http://localhost:5173 in two browser windows (or two devices on your
network) — one creates a room, the other joins with the 4-letter code.

## Rules (v1)

- **Hider** picks a station, then an exact spot within 500m of it, and locks in.
- **Seekers** start at Embarcadero and move as one team. Travel time between
  stations comes from a hand-curated graph of the Muni Metro + BART network
  (Dijkstra shortest path, minutes added to the game clock).
- **Walking**: from a station, seekers can walk up to 1.5km per leg
  (~12 min/km on the clock). Questions are answered from wherever the
  seekers stand. Riding again charges the walk back to the platform.
- **Questions** cost coins (start with 15, earn 3 per ride and 1 per walk).
  The server answers automatically from the hider's true pin — no lying:
  - Radar 0.5/1/2/5 km — is the hider within X of us? (5/4/3/2¢)
  - Thermometer — warmer or colder since the last read? (3¢)
  - Line check — does the hider's station share a line with ours? (3¢)
  - Compass N/S or E/W (5¢ each)
- **Endgame tools** for the final block hunt:
  - Close radar 100m (7¢) / 250m (6¢)
  - Right Station (4¢) — is the station you're standing at the hider's?
  - Photo requests (5–7¢): the hider must screenshot their actual Street
    View — tallest structure, straight up at the sky, down the street, or
    facing due north — and upload/paste it back to the seekers
- **Endgame**: you have to walk to the hider — pins only drop within 50m of
  where the seekers stand. Landing within the tag distance (host picks
  10/15/25/50m in the lobby) = found. Wrong pin = +10 min penalty (and a
  "close" hint if within 100m). Hider's score is how many game-minutes they
  survived.
- Answered radar circles stay on the map (green = inside, red = outside);
  photos in the log click to expand. The transit log shows newest first.
- **Exclusion shading**: the map greys out everywhere the hider can't be —
  starting with everything beyond 500m of a station, then narrowing with
  every radar, compass, line-check, and right-station answer.
- **Endgame bonus**: the first time seekers confirm the hider's zone
  (Right Station YES or a ≤250m radar YES), their coins triple — once per
  game — so the final hunt isn't starved by question costs.
- **Matching questions** (Jet Lag style): "is your nearest airport / zoo /
  amusement park the same as ours?" and region matches ("are you in the same
  borough/district as us?"). Each answer carves the map into Voronoi cells
  (every point belongs to its nearest landmark) and keeps or removes the
  seeker's cell. A category only appears if the city has 2+ of that landmark.
- **Two-tone shading**: the map gets a faint wash outside the half-mile
  station zones (where the hider can't be by rule), and a heavy shade only on
  areas a *question* has positively eliminated — so the board reads clearly
  and the answers visibly carve it down.
- **Hover any question** to see what it would tell you: radar coverage
  circles (and past radar answers in the log, green/yes red/no), the
  thermometer comparison leg, the lines through your station, the compass
  dividing line, and for matching, the landmarks plus the Voronoi cell.
- Street View opens via free Google Maps URLs — no API key needed.
- Light/dark theme toggle in the header (persisted per device).

## Solo mode

"Hunt the Phantom" pits one seeker against an AI hider: it picks a random
hiding spot (weighted toward stations far from the start) and answers every
question from its true pin. With a `GOOGLE_MAPS_KEY` env var set (Street
View Static API, 10k free calls/month), the Phantom snaps its spot to a
real Street View panorama and will sell you exactly **one** Street View
photo of it per game (7¢). Without the key, solo works minus photos.

## In-app Street View (optional)

Once seekers confirm the hider's station (a "Right Station" YES), they get an
interactive in-app Street View to scout the exact spot. Walking in it moves
the seeker (option A): "Drop pin here" walks to the spot and guesses; "Done"
walks there and closes. The hider's photo can sit beside the view, and a
warning fires if you wander into an area your answers have ruled out.

Set a browser-safe key in `GOOGLE_MAPS_BROWSER_KEY` with the **Maps
JavaScript API** enabled and restricted to your domain
(`https://<your-app>.onrender.com/*`). Without it (or if the API isn't
enabled) the panel falls back to an external Street View link. Keep
`GOOGLE_MAPS_KEY` (server, Street View **Static** API for the Phantom's
photos) as a separate key so the two restriction styles don't conflict.

## Deploy (Railway)

One service runs everything: `npm run build` compiles the client into
`client/dist`, and `npm start` launches the server, which serves both the
site and the websocket game on Railway's injected `PORT`. Stale rooms are
swept automatically. Every push to `main` redeploys.

## Stack

- `server/` — Node, Express, Socket.io. Game state, station graph, question
  engine. `npm test` runs a full simulated game + socket round-trip.
- `client/` — Vite, React, Leaflet (CARTO dark tiles).

## Ideas for v2

- More cities (any GTFS feed can generate the station graph)
- Hider curses / seeker handicaps from the home game
- Rejoin after disconnect, multiple rounds with role rotation
