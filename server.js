// FACILITY 7 — multiplayer server
//
// Node.js + the "ws" package only. Matches the message protocol already implemented in
// facility7.html's multiplayer client code exactly (message types, field names, and the
// host-relays-enemies model that client already expects).
//
// Run locally:
//   npm install
//   npm start                  (listens on :3000 by default)
//
// Deploy on Render as a Web Service:
//   Build Command: npm install
//   Start Command: npm start
// Render sets process.env.PORT itself — you do not need to set it.
//
// What is and isn't validated here, briefly (see README.md for the full explanation):
//   - Rooms, room codes, ready/start state, and every player's HP are owned by this
//     server. Damage is checked against a weapon table + fire-rate limit before it's
//     applied; a client cannot set its own or anyone else's HP directly.
//   - Position/rotation are relayed with a basic speed-sanity clamp, not full physics
//     validation (this server doesn't know the level geometry).
//   - Enemies/waves are simulated by the room's host (that's the existing FACILITY 7
//     client behavior); this server just relays the host's enemy snapshots to everyone
//     else in the room, and relays other players' "I hit this enemy" reports back to the
//     host. Only the current host's snapshots are ever relayed, so a non-host client
//     can't inject fake enemy state.

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const MAX_ROOMS = 200;
const MAX_PLAYERS_PER_ROOM = 8;
const MAX_HP = 100;
const MAX_SPEED = 10; // units/sec — generous upper bound; sprint is ~8.2 in the client

// Mirrors facility7.html's weapon table closely enough to validate reported damage.
// If you change weapon stats in the client's `W` array, update this too — these are two
// separate files and nothing keeps them in sync automatically.
const WEAPONS = {
  ar:  { dmg: 22, rate: 0.095, hs: 2.2 },
  sg:  { dmg: 14, rate: 0.85,  hs: 1.8 },
  pi:  { dmg: 30, rate: 0.2,   hs: 2.2 },
  smg: { dmg: 13, rate: 0.065, hs: 1.8 },
  dmr: { dmg: 65, rate: 0.55,  hs: 2.5 },
  rev: { dmg: 80, rate: 0.75,  hs: 2.2 },
};

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function roomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I, avoids ambiguous codes
  let s = '';
  for (let i = 0; i < 5; i++) s += A[(Math.random() * A.length) | 0];
  return s;
}
function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** @type {Map<string, Room>} */
const rooms = new Map();

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map(); // id -> Player
    this.hostId = null;
    this.state = 'lobby'; // 'lobby' | 'match'
    this.mapId = 0;
    this.createdAt = Date.now();
  }
  broadcast(msg, exceptId) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.id === exceptId) continue;
      safeSend(p.ws, s);
    }
  }
  playerList() {
    return [...this.players.values()].map(p => ({
      id: p.id, name: p.name, ready: p.ready, isHost: p.id === this.hostId,
      hp: p.hp, alive: p.alive, kills: p.kills,
    }));
  }
}

class Player {
  constructor(ws) {
    this.ws = ws;
    this.id = newId();
    this.name = 'OPERATIVE';
    this.room = null;
    this.ready = false;
    this.hp = MAX_HP;
    this.alive = true;
    this.kills = 0;
    this.x = 0; this.y = 0; this.z = 0; this.yaw = 0;
    this.lastStateAt = 0;
    this.lastShotAt = {}; // weaponKey -> timestamp, for fire-rate limiting
  }
}

function safeSend(ws, data) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  try { ws.send(typeof data === 'string' ? data : JSON.stringify(data)); }
  catch (err) { log('send failed:', err.message); }
}

function leaveRoom(p) {
  const room = p.room;
  if (!room) return;
  room.players.delete(p.id);
  p.room = null;
  log(`player ${p.id} (${p.name}) left room ${room.code}`);
  if (room.players.size === 0) {
    rooms.delete(room.code);
    log(`room ${room.code} closed (empty)`);
    return;
  }
  if (room.hostId === p.id) {
    const next = room.players.values().next().value;
    room.hostId = next.id;
    room.broadcast({ t: 'hostChanged', hostId: next.id });
    log(`room ${room.code}: host left, ${next.id} (${next.name}) is now host`);
  }
  room.broadcast({ t: 'playerList', players: room.playerList() });
}

// --- HTTP: a plain health-check response so Render (or you) can confirm the process is up
// without needing a WebSocket handshake. ---
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('FACILITY 7 multiplayer server is running.\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const p = new Player(ws);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  log(`connection opened: ${p.id} from ${req.socket.remoteAddress}`);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (err) {
      log(`malformed JSON from ${p.id}, ignoring`);
      return; // never let a bad payload take the server down
    }
    if (!msg || typeof msg.t !== 'string') return;
    try {
      handle(p, msg);
    } catch (err) {
      // A bug in handling one message should never kill the process or this connection.
      log(`error handling '${msg.t}' from ${p.id}:`, err && err.stack || err);
    }
  });

  ws.on('close', () => {
    log(`connection closed: ${p.id}`);
    leaveRoom(p);
  });
  ws.on('error', (err) => {
    log(`socket error for ${p.id}:`, err.message);
  });
});

// Drop dead sockets (closed lid, network vanished, etc.) every 20s.
const pingTimer = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  }
}, 20000);
wss.on('close', () => clearInterval(pingTimer));

function handle(p, msg) {
  switch (msg.t) {
    case 'create': {
      if (typeof msg.name === 'string' && msg.name.trim()) p.name = msg.name.slice(0, 16);
      if (rooms.size >= MAX_ROOMS) {
        safeSend(p.ws, { t: 'error', msg: 'Server is full — too many active rooms. Try again shortly.' });
        return;
      }
      let code = roomCode();
      while (rooms.has(code)) code = roomCode();
      const room = new Room(code);
      room.players.set(p.id, p);
      room.hostId = p.id;
      p.room = room;
      rooms.set(code, room);
      safeSend(p.ws, { t: 'joined', id: p.id, room: code, isHost: true, players: room.playerList() });
      log(`room ${code} created by ${p.id} (${p.name})`);
      break;
    }
    case 'join': {
      if (typeof msg.name === 'string' && msg.name.trim()) p.name = msg.name.slice(0, 16);
      const code = String(msg.room || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { safeSend(p.ws, { t: 'error', msg: 'Room not found.' }); return; }
      if (room.state !== 'lobby') { safeSend(p.ws, { t: 'error', msg: 'Match already in progress.' }); return; }
      if (room.players.size >= MAX_PLAYERS_PER_ROOM) { safeSend(p.ws, { t: 'error', msg: 'Room is full.' }); return; }
      room.players.set(p.id, p);
      p.room = room;
      safeSend(p.ws, { t: 'joined', id: p.id, room: code, isHost: false, players: room.playerList() });
      room.broadcast({ t: 'playerList', players: room.playerList() }, p.id);
      log(`${p.id} (${p.name}) joined room ${code}`);
      break;
    }
    case 'ready': {
      const room = p.room; if (!room) return;
      p.ready = !!msg.v;
      room.broadcast({ t: 'playerList', players: room.playerList() });
      break;
    }
    case 'start': {
      const room = p.room; if (!room) return;
      if (room.hostId !== p.id) {
        safeSend(p.ws, { t: 'error', msg: 'Only the host can start the match.' });
        return;
      }
      room.state = 'match';
      room.mapId = Number.isInteger(msg.mapId) ? msg.mapId : 0;
      for (const q of room.players.values()) { q.hp = MAX_HP; q.alive = true; q.kills = 0; }
      room.broadcast({ t: 'startMatch', mapId: room.mapId });
      log(`room ${room.code}: match started on map ${room.mapId} by host ${p.id}`);
      break;
    }
    case 'state': {
      // Position/rotation update. Sanity-clamped against implausible speed, not fully
      // physics-validated (see the header comment). HP is never taken from this message —
      // it's always relayed from this server's own authoritative value for the player.
      const room = p.room; if (!room || room.state !== 'match') return;
      const x = Number(msg.x), y = Number(msg.y), z = Number(msg.z), yaw = Number(msg.yaw);
      if (![x, y, z, yaw].every(Number.isFinite)) return;
      const now = Date.now();
      const dt = Math.max(0.001, (now - (p.lastStateAt || now)) / 1000);
      const dist = Math.hypot(x - p.x, z - p.z);
      if (p.lastStateAt && dist / dt > MAX_SPEED * 2) return; // implausible teleport — drop it
      p.x = x; p.y = y; p.z = z; p.yaw = yaw;
      p.lastStateAt = now;
      room.broadcast({
        t: 'state', id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw,
        pitch: msg.pitch, weapon: msg.weapon, moving: !!msg.moving, crouch: !!msg.crouch,
        fire: !!msg.fire, hp: p.hp, // <- server's own value, never the client's self-report
      }, p.id);
      break;
    }
    case 'shot': {
      // Visual-only relay (muzzle flash / tracer on other clients). Never applies damage.
      const room = p.room; if (!room || room.state !== 'match') return;
      room.broadcast({ t: 'shot', id: p.id, x: msg.x, y: msg.y, z: msg.z, dx: msg.dx, dy: msg.dy, dz: msg.dz, weapon: msg.weapon }, p.id);
      break;
    }
    case 'hit': {
      // A client claims it hit another PLAYER. This is the one place player damage is
      // actually applied, and it's validated, not trusted:
      //  - the weapon must be real, and reported damage is clamped to that weapon's max
      //    possible single-shot value (base damage * headshot multiplier, plus a small
      //    margin for floating-point drift);
      //  - hits are rate-limited using that weapon's own fire-rate stat, so a modified
      //    client claiming far more hits/sec than the weapon allows is rejected.
      const room = p.room; if (!room || room.state !== 'match') return;
      const target = room.players.get(msg.targetId);
      if (!target || !target.alive) return;
      const w = WEAPONS[msg.weapon];
      if (!w) return;
      const now = Date.now();
      const minInterval = w.rate * 1000 * 0.8; // slack for network jitter
      const last = p.lastShotAt[msg.weapon] || 0;
      if (now - last < minInterval) return;
      p.lastShotAt[msg.weapon] = now;
      let dmg = Number(msg.dmg);
      if (!Number.isFinite(dmg) || dmg <= 0) return;
      const maxDmg = w.dmg * w.hs * 1.15;
      if (dmg > maxDmg) dmg = maxDmg;
      target.hp = Math.max(0, target.hp - dmg);
      if (target.hp <= 0 && target.alive) {
        target.alive = false;
        p.kills++;
        room.broadcast({ t: 'death', id: target.id, by: p.id });
        log(`room ${room.code}: ${p.id} eliminated ${target.id}`);
      }
      room.broadcast({ t: 'health', id: target.id, hp: target.hp, alive: target.alive });
      room.broadcast({ t: 'playerList', players: room.playerList() });
      break;
    }
    case 'respawn': {
      const room = p.room; if (!room || room.state !== 'match') return;
      p.hp = MAX_HP; p.alive = true;
      p.x = Number(msg.x) || 0; p.y = Number(msg.y) || 0; p.z = Number(msg.z) || 0;
      room.broadcast({ t: 'respawn', id: p.id, x: p.x, y: p.y, z: p.z });
      break;
    }
    case 'enemyState': {
      // Only the current host's snapshots are ever relayed — anyone else claiming to be
      // host is silently ignored, so a modified client can't inject fake enemies/deaths.
      const room = p.room; if (!room || room.state !== 'match' || room.hostId !== p.id) return;
      room.broadcast({ t: 'enemyState', enemies: msg.enemies, obj: msg.obj, wave: msg.wave }, p.id);
      break;
    }
    case 'enemyHit': {
      // A non-host player reports a hit on an enemy; forwarded to the host (who owns the
      // real enemy simulation) so it can apply the hit and report the result back via its
      // next enemyState snapshot.
      const room = p.room; if (!room || room.state !== 'match') return;
      const host = room.players.get(room.hostId);
      if (!host) return;
      safeSend(host.ws, {
        t: 'enemyHit', from: p.id, enemyId: msg.enemyId, dmg: msg.dmg, part: msg.part,
        ox: msg.ox, oy: msg.oy, oz: msg.oz, dx: msg.dx, dy: msg.dy, dz: msg.dz,
      });
      break;
    }
    case 'leave': {
      leaveRoom(p);
      break;
    }
    default:
      // Unknown message type — ignore rather than error, in case a newer client sends
      // something this server version doesn't know about yet.
      break;
  }
}

server.listen(PORT, HOST, () => {
  log(`FACILITY 7 multiplayer server listening on ${HOST}:${PORT}`);
});

// Last-resort safety nets: log and keep running rather than let one bad event take the
// whole server (and everyone's match) down.
process.on('uncaughtException', (err) => log('uncaughtException:', err && err.stack || err));
process.on('unhandledRejection', (err) => log('unhandledRejection:', err && err.stack || err));
