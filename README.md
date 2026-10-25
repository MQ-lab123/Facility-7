# FACILITY 7 — Multiplayer Server

A Node.js WebSocket server (`ws` package only) that owns rooms, player HP, and relays state
between players, matching the multiplayer client code already in `facility7.html`.

## Install and run locally

```bash
cd mp-server
npm install
npm start
```

You should see:

```
... FACILITY 7 multiplayer server listening on 0.0.0.0:3000
```

Open `http://localhost:3000/` in a browser — you should get a plain text "server is
running" response. That's an HTTP health check, not the game; the game connects over
WebSocket, not this page.

### Point the game at it

In `facility7.html`, go to **Multiplayer**, and enter this as the server address:

```
ws://localhost:3000
```

This only works for you, on the same machine — it is not reachable from another device
until you deploy it (below).

## Deploy to Render

1. Push the `mp-server` folder to a GitHub repository (see "What to upload to GitHub"
   below).
2. In Render: **New → Web Service**, connect that repo.
3. Settings:
   - **Root Directory:** `mp-server` (if `server.js` isn't at the repo root)
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** the free tier works for testing
4. Do **not** set a `PORT` environment variable — Render sets it automatically, and the
   server already reads `process.env.PORT`.
5. Deploy. Render gives you a URL like `https://facility7-mp.onrender.com`.

### What URL the client should use

Once deployed behind HTTPS (which Render does automatically), use **`wss://`**, not
`ws://`:

```
wss://facility7-mp.onrender.com
```

Enter that exact address (no trailing slash needed) in FACILITY 7's Multiplayer screen.
Browsers will refuse to open a plain `ws://` connection from an HTTPS page (like your
Netlify-hosted game), so `wss://` is required once everything is live — `ws://` only works
for the `localhost` case above.

**Free-tier note:** Render's free web services spin down after inactivity and take a few
seconds to wake back up on the next connection. The first player connecting after a period
of idleness may see the connection fail or hang briefly — that's Render's cold start, not a
bug in this server. A paid instance (or pinging it periodically) avoids this.

## What to upload to GitHub

Just this folder's contents:

```
mp-server/
├── server.js
├── package.json
└── README.md
```

Do not upload `node_modules` — Render runs `npm install` itself from `package.json`. If
you're initializing a fresh repo, a one-line `.gitignore` with `node_modules/` is enough.

## How another person joins your game

1. You deploy the server once (above) and share the `wss://...` address with them.
2. Either of you: FACILITY 7 → Multiplayer → enter that server address.
3. One of you clicks **Create Room** and gets a 5-character room code; share it.
4. The other clicks **Join Room** and enters that code.
5. Both click **Ready**; the host clicks **Start Match**.

## Environment variables

- `PORT` — which port to listen on. Render sets this automatically; you don't need to.
  Locally it defaults to `3000` if unset.

There is nothing else to configure — no database, no API keys, no `.env` file needed.

## Production behavior this server actually implements

- **Rooms & room codes**: in-memory `Map`, 5-character codes avoiding ambiguous characters
  (no `0/O/1/I`), capped at 200 concurrent rooms and 8 players per room.
- **Host transfer**: if the host disconnects, the next player in the room automatically
  becomes host and a `hostChanged` message is broadcast; the match continues.
- **Player HP is server-owned**: a client's own `state` updates never set its displayed HP —
  the server always relays its own authoritative value. HP only changes through the
  validated `hit` message (see below).
- **Damage validation**: each `hit` message is checked against a per-weapon damage ceiling
  (base damage × headshot multiplier × small margin) and a per-weapon fire-rate limit before
  being applied — a modified client claiming impossible damage or firing far faster than a
  weapon allows has those values clamped or rejected outright.
- **Movement sanity check**: `state` updates implying a speed far beyond anything the game
  allows are dropped rather than trusted. This is a basic heuristic, not full physics/collision
  validation — this server doesn't know the level geometry, so it can't currently catch a
  modified client ignoring walls locally. That would require porting the game's collision
  code into this server, which is a larger follow-up project, not something folded into this.
- **Enemies/waves**: simulated by the room's host (the existing FACILITY 7 client behavior);
  this server only relays the current host's `enemyState` snapshots to everyone else, and
  forwards other players' `enemyHit` reports back to the host. Only the real host's snapshots
  are ever relayed.
- **Malformed input**: unparseable JSON, missing fields, and unknown message types are all
  logged and ignored rather than crashing the connection or the process. Every per-message
  handler runs inside a `try/catch`, and `uncaughtException`/`unhandledRejection` are caught
  at the process level as a last resort.
- **Dead connections**: a ping/pong heartbeat every 20s terminates sockets that stop
  responding (closed laptop lid, lost network, etc.) so rooms don't fill up with ghosts.
- **Logging**: connection open/close, room create/join/leave, match start, kills, and errors
  are all logged with timestamps to stdout — on Render these show up in the service's Logs
  tab.

## Revision notes (hardening pass)

- `startMatch` now carries `mode` (`coop`/`pvp`); before, every match silently became co-op.
- Weapon table now covers all 12 client weapons (ak12, scar, vec, aa12, usp, fiveseven were missing, so their PvP hits were discarded). Pellet weapons may send one `hit` per pellet within one fire-rate window.
- `hit` is PvP-only, rejects self-hits, and checks shooter/target distance against the weapon range using the last positions received.
- `respawn` needs a 2.5 s delay; a player recently damaged in PvP cannot heal by respawning.
- `start` needs every non-host player ready, a valid map id (0-9), and only works once per match.
- `enemyState` now relays `ev`, `bo` and `alarm` (blackout/mutant events) and sanitises entries; `enemyHit` is co-op only, host-bound, normalised and capped.
- A socket already in a room cannot create/join another. `ping` is answered with `pong`. `playerLeft` is broadcast.
- Payloads over 128 KB close the socket; a per-connection message flood bucket drops excess; optional `ALLOWED_ORIGINS` env var (comma-separated) restricts browser origins.
- Known limit: if the host leaves mid co-op match, the new host's client has no enemy simulation, so enemies stop updating.

## Testing

`npm install && npm test` starts the server on port 3917 and runs 45 checks with real WebSocket clients (rooms, joining, ready/start rules, movement, PvP combat, co-op relay, disconnect/host migration, room isolation, malformed input). It tests this server only, not the browser client and not your Render deployment.
