// FACILITY 7 — multiplayer server (hardened revision)
//
// Node.js + the "ws" package only. Speaks the message protocol of the FACILITY 7 client
// (facility7.html multiplayer code). See README.md for what is and is not validated here.
//
// Run locally:  npm install && npm start      (listens on :3000 unless PORT is set)
// Render:       Build "npm install", Start "npm start". Render sets PORT itself.

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const MAX_ROOMS = 200;
const MAX_CLIENTS = 500;
const MAX_PLAYERS_PER_ROOM = 8;
const MAX_HP = 100;
const MAX_SPEED = 10;            // units/s; sprint is ~8.2 in the client
const MAP_COUNT = 10;            // MAPS.length in the client (indexes 0..9)
const MAX_PAYLOAD = 128 * 1024;  // ws default is 100 MB
const MAX_ENEMIES = 400;
const RESPAWN_MIN_MS = 2500;     // client waits 3 s before asking to respawn
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

// Mirrors the client's weapon table (the `W` array incl. the W.push(...) armory).
// rng = client max range. If you change weapon stats in the client, update this too.
const WEAPONS = {
  ar:        { dmg: 22, rate: 0.095, hs: 2.2,  pel: 1, rng: 120 },
  sg:        { dmg: 14, rate: 0.85,  hs: 1.8,  pel: 8, rng: 35 },
  pi:        { dmg: 30, rate: 0.2,   hs: 2.2,  pel: 1, rng: 80 },
  smg:       { dmg: 13, rate: 0.065, hs: 1.8,  pel: 1, rng: 50 },
  dmr:       { dmg: 65, rate: 0.55,  hs: 2.5,  pel: 1, rng: 200 },
  rev:       { dmg: 80, rate: 0.75,  hs: 2.2,  pel: 1, rng: 100 },
  ak12:      { dmg: 26, rate: 0.105, hs: 2.15, pel: 1, rng: 115 },
  scar:      { dmg: 34, rate: 0.145, hs: 2.25, pel: 1, rng: 145 },
  vec:       { dmg: 11, rate: 0.045, hs: 1.8,  pel: 1, rng: 42 },
  aa12:      { dmg: 10, rate: 0.22,  hs: 1.7,  pel: 8, rng: 32 },
  usp:       { dmg: 38, rate: 0.24,  hs: 2.2,  pel: 1, rng: 78 },
  fiveseven: { dmg: 25, rate: 0.16,  hs: 2.15, pel: 1, rng: 95 },
};
const MAX_BASE_DMG = 80;

function log(...args) { console.log(new Date().toISOString(), ...args); }

function roomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[crypto.randomInt(A.length)];
  return s;
}
function newId() { return crypto.randomBytes(6).toString('hex'); }
function cleanName(v) {
  return String(v).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16);
}
const fin = (...v) => v.every(n => typeof n === 'number' && Number.isFinite(n));

/** @type {Map<string, Room>} */
const rooms = new Map();

// ---- QUICK MATCH queue ------------------------------------------------------------------------
// Client protocol: quickmatch{name,mode} -> mmQueued | (mmFound + joined{quick:true}); mmcancel -> mmCancelled.
// Players are paired FIFO within the same mode (coop/pvp). Exactly 2 players per quick room.
const QM_SIZE = 2;
/** @type {Array<{p: Player, mode: string}>} */
let mmQueue = [];
function mmRemove(p) {
  const n = mmQueue.length;
  mmQueue = mmQueue.filter(e => e.p !== p);
  return mmQueue.length !== n;
}
function mmBroadcastStatus() {
  for (const mode of ['coop', 'pvp']) {
    const q = mmQueue.filter(e => e.mode === mode);
    for (const e of q) safeSend(e.p.ws, { t: 'mmStatus', state: q.length >= QM_SIZE ? 'searching' : 'none', queued: q.length });
  }
}

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.hostId = null;
    this.state = 'lobby';   // 'lobby' | 'match'
    this.mode = 'coop';     // 'coop' | 'pvp'
    this.mapId = 0;
    this.lastEnemyStateAt = 0;
    this.round = 1; this.roundResetAt = 0; this.roundResetIds = new Set();
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
    this.badStates = 0;
    this.lastShotMsgAt = 0;
    this.slots = {};            // weaponKey -> { t, n } fire-rate / pellet allowance
    this.lastDamagedAt = 0;
    this.diedAt = 0;
    this.lastRespawnAt = 0;
    this.ehWin = { t: 0, n: 0 }; // enemyHit per-second window
    this.tokens = 300; this.tokAt = Date.now(); // message flood bucket
  }
  resetForMatch() {
    this.hp = MAX_HP; this.alive = true; this.kills = 0;
    this.lastStateAt = 0; this.badStates = 0; this.slots = {};
    this.lastDamagedAt = 0; this.diedAt = 0; this.lastRespawnAt = Date.now();
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
  p.ready = false;
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
  room.broadcast({ t: 'playerLeft', id: p.id });
  room.broadcast({ t: 'playerList', players: room.playerList() });
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('FACILITY 7 multiplayer server is running.\n');
});

const wss = new WebSocketServer({
  server,
  maxPayload: MAX_PAYLOAD,
  verifyClient: (info) => {
    if (!ALLOWED_ORIGINS.length) return true;
    return ALLOWED_ORIGINS.includes(info.origin);
  },
});

wss.on('connection', (ws, req) => {
  if (wss.clients.size > MAX_CLIENTS) { ws.close(1013, 'server busy'); return; }
  const p = new Player(ws);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  log(`connection opened: ${p.id} from ${req.socket.remoteAddress}`);

  ws.on('message', (raw) => {
    // token bucket: ~150 msgs/s sustained, burst 300; excess is dropped
    const now = Date.now();
    p.tokens = Math.min(300, p.tokens + (now - p.tokAt) * 0.15);
    p.tokAt = now;
    if (p.tokens < 1) return;
    p.tokens -= 1;

    let msg;
    try { msg = JSON.parse(raw); }
    catch (err) { log(`malformed JSON from ${p.id}, ignoring`); return; }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    try { handle(p, msg); }
    catch (err) { log(`error handling '${msg.t}' from ${p.id}:`, err && err.stack || err); }
  });

  ws.on('close', () => { log(`connection closed: ${p.id}`); if (mmRemove(p)) mmBroadcastStatus(); leaveRoom(p); });
  ws.on('error', (err) => { log(`socket error for ${p.id}:`, err.message); });
});

const pingTimer = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  }
}, 20000);
wss.on('close', () => clearInterval(pingTimer));

// Allow `pel` hits per fire-rate window for one weapon (shotguns send one hit per pellet).
function allowShot(p, key, w, now) {
  const minInterval = w.rate * 1000 * 0.6; // slack for jitter and fire-rate upgrades
  const s = p.slots[key];
  if (!s || now - s.t >= minInterval) { p.slots[key] = { t: now, n: 1 }; return true; }
  if (s.n < w.pel) { s.n++; return true; }
  return false;
}

function handle(p, msg) {
  switch (msg.t) {
    case 'ping': {
      safeSend(p.ws, { t: 'pong', ts: msg.ts });
      break;
    }
    case 'create': {
      if (p.room) { safeSend(p.ws, { t: 'error', msg: 'Already in a room.' }); return; }
      const nm = cleanName(msg.name); if (nm) p.name = nm;
      if (rooms.size >= MAX_ROOMS) {
        safeSend(p.ws, { t: 'error', msg: 'Server is full — too many active rooms. Try again shortly.' });
        return;
      }
      let code = roomCode();
      while (rooms.has(code)) code = roomCode();
      const room = new Room(code);
      room.players.set(p.id, p);
      room.hostId = p.id;
      p.room = room; p.ready = false;
      rooms.set(code, room);
      safeSend(p.ws, { t: 'joined', id: p.id, room: code, isHost: true, players: room.playerList() });
      log(`room ${code} created by ${p.id} (${p.name})`);
      break;
    }
    case 'join': {
      if (p.room) { safeSend(p.ws, { t: 'error', msg: 'Already in a room.' }); return; }
      const nm = cleanName(msg.name); if (nm) p.name = nm;
      const code = String(msg.room || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { safeSend(p.ws, { t: 'error', msg: 'Room not found.' }); return; }
      if (room.quick) { safeSend(p.ws, { t: 'error', msg: 'Room not found.' }); return; }
      if (room.state !== 'lobby') { safeSend(p.ws, { t: 'error', msg: 'Match already in progress.' }); return; }
      if (room.players.size >= MAX_PLAYERS_PER_ROOM) { safeSend(p.ws, { t: 'error', msg: 'Room is full.' }); return; }
      room.players.set(p.id, p);
      p.room = room; p.ready = false;
      safeSend(p.ws, { t: 'joined', id: p.id, room: code, isHost: false, players: room.playerList() });
      room.broadcast({ t: 'playerJoined', player: { id: p.id, name: p.name } }, p.id);
      room.broadcast({ t: 'playerList', players: room.playerList() }, p.id);
      log(`${p.id} (${p.name}) joined room ${code}`);
      break;
    }
    case 'ready': {
      const room = p.room; if (!room || room.state !== 'lobby') return;
      p.ready = !!msg.v;
      room.broadcast({ t: 'playerList', players: room.playerList() });
      break;
    }
    case 'start': {
      const room = p.room; if (!room) return;
      if (room.hostId !== p.id) { safeSend(p.ws, { t: 'error', msg: 'Only the host can start the match.' }); return; }
      if (room.state !== 'lobby') return;
      if ([...room.players.values()].some(q => q.id !== p.id && !q.ready)) {
        safeSend(p.ws, { t: 'error', msg: 'All players must be ready.' });
        return;
      }
      const mapId = Number(msg.mapId);
      room.mapId = Number.isInteger(mapId) && mapId >= 0 && mapId < MAP_COUNT ? mapId : 0;
      room.mode = msg.mode === 'pvp' ? 'pvp' : 'coop';
      room.state = 'match';
      room.round = 1; room.roundResetAt = 0; room.roundResetIds.clear();
      for (const q of room.players.values()) q.resetForMatch();
      room.broadcast({ t: 'startMatch', mapId: room.mapId, mode: room.mode });
      log(`room ${room.code}: ${room.mode} match started on map ${room.mapId} by host ${p.id}`);
      break;
    }
    case 'state': {
      const room = p.room; if (!room || room.state !== 'match' || !p.alive) return;
      const x = Number(msg.x), y = Number(msg.y), z = Number(msg.z), yaw = Number(msg.yaw);
      if (!fin(x, y, z, yaw) || Math.abs(x) > 1000 || Math.abs(z) > 1000 || Math.abs(y) > 200) return;
      const now = Date.now();
      if (p.lastStateAt) {
        const dt = Math.max(0.001, (now - p.lastStateAt) / 1000);
        const dist = Math.hypot(x - p.x, z - p.z);
        if (dist / dt > MAX_SPEED * 2) {
          // implausible jump: drop it, but accept after a few in a row so legitimate
          // teleports (ladders, respawns) resync instead of freezing the avatar
          if (++p.badStates < 5) return;
        }
      }
      p.badStates = 0;
      p.x = x; p.y = y; p.z = z; p.yaw = yaw; p.lastStateAt = now;
      const pitch = Number(msg.pitch);
      room.broadcast({
        t: 'state', id: p.id, x, y, z, yaw,
        pitch: Number.isFinite(pitch) ? pitch : 0,
        weapon: typeof msg.weapon === 'string' && WEAPONS[msg.weapon] ? msg.weapon : '',
        moving: !!msg.moving, crouch: !!msg.crouch, fire: !!msg.fire,
        hp: p.hp, // server's own value, never the client's self-report
      }, p.id);
      break;
    }
    case 'shot': {
      const room = p.room; if (!room || room.state !== 'match' || !p.alive) return;
      const now = Date.now();
      if (now - p.lastShotMsgAt < 25) return;
      p.lastShotMsgAt = now;
      const { x, y, z, dx, dy, dz } = msg;
      if (!fin(x, y, z, dx, dy, dz) || Math.abs(dx) > 2 || Math.abs(dy) > 2 || Math.abs(dz) > 2) return;
      room.broadcast({ t: 'shot', id: p.id, x, y, z, dx, dy, dz, weapon: WEAPONS[msg.weapon] ? msg.weapon : '' }, p.id);
      break;
    }
    case 'hit': {
      // The only place player damage is applied. PvP rooms only.
      const room = p.room; if (!room || room.state !== 'match' || room.mode !== 'pvp') return;
      if (room.roundResetAt) return; // no combat during the post-elimination transition
      if (!p.alive || msg.targetId === p.id) return;
      const target = room.players.get(msg.targetId);
      if (!target || !target.alive) return;
      const key = msg.weapon;
      const grenade = key === 'grenade';
      const w = Object.prototype.hasOwnProperty.call(WEAPONS, key) ? WEAPONS[key] : null;
      if (!w && !grenade) return;
      const now = Date.now();
      // Validate grenade splash against server-known player positions; the client supplies only the falloff damage.
      if (p.lastStateAt && target.lastStateAt) {
        const d = Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z);
        if (grenade ? d > 10.5 : d > w.rng * 1.2 + 4) return;
      }
      if (grenade) {
        if (now - (p.lastGrenadeHitAt || 0) < 250) return;
        p.lastGrenadeHitAt = now;
      } else if (!allowShot(p, key, w, now)) return;
      let dmg = Number(msg.dmg);
      if (!Number.isFinite(dmg) || dmg <= 0) return;
      dmg = Math.min(dmg, grenade ? 260 : w.dmg * w.hs * 1.15);
      target.hp = Math.max(0, target.hp - dmg);
      target.lastDamagedAt = now;
      if (target.hp <= 0) {
        target.alive = false; target.diedAt = now; p.kills++;
        room.round += 1;
        room.roundResetAt = now;
        room.roundResetIds = new Set(room.players.keys());
        room.broadcast({ t: 'death', id: target.id, by: p.id });
        room.broadcast({ t: 'roundReset', round: room.round, roamMs: 3000, countdownMs: 5000 });
        log(`room ${room.code}: ${p.id} eliminated ${target.id}; round ${room.round} reset scheduled`);
      }
      room.broadcast({ t: 'health', id: target.id, hp: target.hp, alive: target.alive });
      room.broadcast({ t: 'playerList', players: room.playerList() });
      break;
    }
    case 'respawn': {
      const room = p.room; if (!room || room.state !== 'match') return;
      const now = Date.now();
      const roundRespawn = room.mode === 'pvp' && room.roundResetAt > 0 && room.roundResetIds.has(p.id);
      if (roundRespawn) {
        // Round flow: 3 s post-kill roam, then 5 s countdown. The server is the final gate.
        if (now - room.roundResetAt < 7500) return;
      } else if (!p.alive) {
        if (now - p.diedAt < RESPAWN_MIN_MS) return;
      } else {
        // The client can die locally (co-op enemies, environment) without the server knowing.
        // Allow that, but a player who was just shot in PvP can't heal by "respawning".
        if (now - p.lastRespawnAt < RESPAWN_MIN_MS) return;
        if (room.mode === 'pvp' && now - p.lastDamagedAt < 8000) return;
      }
      const x = Number(msg.x), y = Number(msg.y), z = Number(msg.z);
      if (!fin(x, y, z) || Math.abs(x) > 1000 || Math.abs(z) > 1000 || Math.abs(y) > 200) return;
      p.hp = MAX_HP; p.alive = true; p.lastRespawnAt = now;
      p.x = x; p.y = y; p.z = z; p.lastStateAt = 0; p.badStates = 0;
      room.broadcast({ t: 'respawn', id: p.id, x, y, z });
      room.broadcast({ t: 'health', id: p.id, hp: p.hp, alive: true });
      if (roundRespawn) {
        room.roundResetIds.delete(p.id);
        if (room.roundResetIds.size === 0) { room.roundResetAt = 0; room.roundResetIds.clear(); }
      }
      break;
    }
    case 'enemyState': {
      const room = p.room;
      if (!room || room.state !== 'match' || room.mode !== 'coop' || room.hostId !== p.id) return;
      if (!Array.isArray(msg.enemies) || msg.enemies.length > MAX_ENEMIES) return;
      const now = Date.now();
      if (now - room.lastEnemyStateAt < 50) return;
      room.lastEnemyStateAt = now;
      const enemies = [];
      for (const e of msg.enemies) {
        if (!e || typeof e !== 'object') continue;
        if (!fin(e.id, e.x, e.y, e.z, e.yaw) || typeof e.k !== 'string' || e.k.length > 16) continue;
        enemies.push({ id: e.id, k: e.k, x: e.x, y: e.y, z: e.z, yaw: e.yaw, dead: !!e.dead });
      }
      const out = { t: 'enemyState', enemies, alarm: !!msg.alarm };
      if (fin(msg.obj)) out.obj = msg.obj;
      if (fin(msg.wave)) out.wave = msg.wave;
      if (fin(msg.bo)) out.bo = msg.bo;
      out.ev = typeof msg.ev === 'string' && msg.ev.length <= 16 ? msg.ev : null;
      room.broadcast(out, p.id);
      break;
    }
    case 'enemyHit': {
      // Non-host co-op player reports an enemy hit; forwarded to the host (who simulates enemies).
      const room = p.room;
      if (!room || room.state !== 'match' || room.mode !== 'coop' || !p.alive) return;
      if (room.hostId === p.id) return;
      const host = room.players.get(room.hostId);
      if (!host) return;
      const { ox, oy, oz, dx, dy, dz } = msg;
      let dmg = Number(msg.dmg);
      if (!fin(ox, oy, oz, dx, dy, dz, dmg) || dmg <= 0) return;
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.5 || len > 1.5) return;
      if (p.lastStateAt && Math.hypot(ox - p.x, oz - p.z) > 6) return; // origin must be near the shooter
      const now = Date.now();
      if (now - p.ehWin.t >= 1000) p.ehWin = { t: now, n: 0 };
      if (++p.ehWin.n > 60) return;
      dmg = Math.min(dmg, MAX_BASE_DMG);
      const part = ['head', 'torso', 'legs', 'arm'].includes(msg.part) ? msg.part : 'torso';
      safeSend(host.ws, {
        t: 'enemyHit', from: p.id, enemyId: msg.enemyId, dmg, part,
        ox, oy, oz, dx: dx / len, dy: dy / len, dz: dz / len,
      });
      break;
    }
    case 'quickmatch': {
      if (p.room) { safeSend(p.ws, { t: 'error', msg: 'Already in a room.' }); return; }
      const nm = cleanName(msg.name); if (nm) p.name = nm;
      const mode = msg.mode === 'pvp' ? 'pvp' : 'coop';
      mmRemove(p);                                   // never queued twice
      const idx = mmQueue.findIndex(e => e.mode === mode && e.p.ws.readyState === e.p.ws.OPEN && !e.p.room);
      if (idx < 0) {
        mmQueue.push({ p, mode });
        safeSend(p.ws, { t: 'mmQueued', mode });
        mmBroadcastStatus();
        log(`quickmatch: ${p.id} (${p.name}) queued for ${mode} (${mmQueue.length} waiting)`);
        break;
      }
      if (rooms.size >= MAX_ROOMS) { safeSend(p.ws, { t: 'error', msg: 'Server is full — too many active rooms. Try again shortly.' }); return; }
      const other = mmQueue.splice(idx, 1)[0].p;     // earliest waiter becomes host
      let code = roomCode();
      while (rooms.has(code)) code = roomCode();
      const room = new Room(code);
      room.quick = true; room.mode = mode;
      room.players.set(other.id, other); room.players.set(p.id, p);
      room.hostId = other.id;
      other.room = room; p.room = room; other.ready = false; p.ready = false;
      rooms.set(code, room);
      const list = room.playerList();
      for (const q of [other, p]) {
        safeSend(q.ws, { t: 'mmFound', players: QM_SIZE });
        safeSend(q.ws, { t: 'joined', id: q.id, room: code, isHost: q.id === room.hostId, players: list, quick: true, mode });
      }
      mmBroadcastStatus();
      log(`quickmatch: room ${code} (${mode}) created for ${other.id} (${other.name}) + ${p.id} (${p.name})`);
      break;
    }
    case 'mmcancel': {
      const was = mmRemove(p);
      safeSend(p.ws, { t: 'mmCancelled' });
      if (was) { log(`quickmatch: ${p.id} cancelled`); mmBroadcastStatus(); }
      break;
    }
    case 'vote': {
      const room = p.room; if (!room || room.state !== 'lobby') return;
      const mapId = Number(msg.mapId);
      if (!Number.isInteger(mapId) || mapId < 0 || mapId >= MAP_COUNT) return;
      room.broadcast({ t: 'vote', id: p.id, mapId }, p.id);
      break;
    }
    case 'leave': {
      leaveRoom(p);
      break;
    }
    default:
      break;
  }
}

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    log(`FACILITY 7 multiplayer server listening on ${HOST}:${PORT}`);
  });
  process.on('uncaughtException', (err) => log('uncaughtException:', err && err.stack || err));
  process.on('unhandledRejection', (err) => log('unhandledRejection:', err && err.stack || err));
}
module.exports = { server, wss, rooms };
