# Start here 👋

This is **Transit Hide+Seek** — an online hide-and-seek game played across real
transit maps (San Francisco, New York, Chicago, Tokyo), inspired by Jet Lag:
The Game. One player hides near a station; seekers ride the network, spend
coins on questions, and explore Street View to find them.

It's yours now — run it, change it, break it, make it better.

## 1. Install the one thing you need

**Node.js** (this runs the game). Download the "LTS" version from
<https://nodejs.org> and install it. That's the only requirement.

## 2. Run the game

Open the Terminal app, go into this folder, and run two commands:

```bash
cd path/to/transit-hideseek      # drag the folder into Terminal to get the path
npm run install:all              # one time: downloads the building blocks
npm run dev                      # starts the game
```

Then open **http://localhost:5173** in your browser. Open it in two tabs (or two
devices on the same Wi-Fi) to play hider vs. seeker. To stop it, press `Ctrl+C`
in the Terminal.

## 3. Keep building it with Claude

You have Claude Pro, which includes **Claude Code** — Claude that can read and
edit this project for you. Install it once:

```bash
npm install -g @anthropic-ai/claude-code
```

Then, inside the project folder, just run:

```bash
claude
```

Tell it what you want ("add a London map", "make the hider get a power-up",
"change the colors") and it'll do it. Ask it to "explain how this project
works" first — it'll walk you through everything.

## 4. How the project is laid out

| Folder | What's in it |
|---|---|
| `server/` | The game brain — rules, questions, scoring (`game.js`), and the cities in `server/cities/` |
| `client/` | What you see — the React app in `client/src/` (the map is `MapView.jsx`, Street View is `ImmersiveView.jsx`) |
| `server/cities/` | One file per city. **Copy one to add your own city** — it's just a list of stations and lines |
| `README.md` | The full rulebook and feature list |

Run `npm test` (inside `server/`) to check you haven't broken the game logic.

## 5. The optional Google Maps keys

The real Street View and the AI hider's photos need Google Maps API keys. The
game runs fine **without** them (you get a stylized stand-in and no photos), so
don't worry about this to start. When you want the real thing, ask Claude:
"how do I set up the Google Maps keys" — it's a free Google account + two
settings.

## 6. Putting it online (optional)

The game is live at **https://transit-hideseek.onrender.com** (on Dad's
account). If you want your *own* live version, ask Claude to "help me deploy
this to Render with my own account" — it's free and takes about 10 minutes.

Have fun. 🚇
