// Local integration test: spawns server.js on a free port and drives it with real WebSocket clients.
// Run:  npm install && node test.js
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 3917;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, name) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + name); };

class C {
  constructor(label) { this.label = label; this.msgs = []; this.ws = new WebSocket('ws://127.0.0.1:' + PORT);
    this.ws.on('message', d => this.msgs.push(JSON.parse(d))); }
  open() { return new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); }); }
  send(o) { this.ws.send(typeof o === 'string' ? o : JSON.stringify(o)); }
  async wait(pred, ms = 1500) { const t = Date.now(); while (Date.now() - t < ms) { const m = this.msgs.find(pred); if (m) return m; await sleep(15); } return null; }
  has(pred) { return this.msgs.some(pred); }
  clear() { this.msgs.length = 0; }
}
async function mk(label) { const c = new C(label); await c.open(); return c; }

(async () => {
  const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT }, stdio: ['ignore', 'pipe', 'pipe'] });
  let slog = ''; srv.stdout.on('data', d => slog += d); srv.stderr.on('data', d => slog += d);
  await sleep(700);
  ok(/listening on 0\.0\.0\.0:3917/.test(slog), 'server listens on 0.0.0.0:$PORT');

  const A = await mk('A'), B = await mk('B');
  A.send({ t: 'ping', ts: 42 });
  ok(!!(await A.wait(m => m.t === 'pong' && m.ts === 42)), 'ping -> pong');

  A.send({ t: 'create', name: 'Alice#1' });
  const ja = await A.wait(m => m.t === 'joined');
  ok(ja && ja.isHost && /^[A-Z2-9]{5}$/.test(ja.room), 'A creates room, gets 5-char code + host');
  A.send({ t: 'create', name: 'x' });
  ok(!!(await A.wait(m => m.t === 'error' && /Already/.test(m.msg))), 'creating a second room while in one is rejected');

  B.send({ t: 'join', name: 'Bob#2', room: ja.room.toLowerCase() });
  const jb = await B.wait(m => m.t === 'joined');
  ok(jb && !jb.isHost && jb.players.length === 2 && jb.id !== ja.id, 'B joins with lowercase code, unique id, sees 2 players');
  ok(!!(await A.wait(m => m.t === 'playerList' && m.players.length === 2)), 'A receives updated player list');
  B.send({ t: 'join', name: 'Bob', room: ja.room });
  ok(!!(await B.wait(m => m.t === 'error' && /Already/.test(m.msg))), 'duplicate join by same socket rejected');

  const X = await mk('X'); X.send({ t: 'join', name: 'X', room: 'ZZZZZ' });
  ok(!!(await X.wait(m => m.t === 'error' && /not found/.test(m.msg))), 'joining unknown room rejected');

  // second independent room
  const C2 = await mk('C'), D2 = await mk('D');
  C2.send({ t: 'create', name: 'Cat' }); const jc = await C2.wait(m => m.t === 'joined');
  D2.send({ t: 'join', name: 'Dan', room: jc.room }); await D2.wait(m => m.t === 'joined');
  ok(jc.room !== ja.room, 'second room has a different code');

  // start rules
  B.send({ t: 'start', mapId: 1, mode: 'pvp' });
  ok(!!(await B.wait(m => m.t === 'error' && /host/.test(m.msg))), 'non-host cannot start');
  A.send({ t: 'start', mapId: 1, mode: 'pvp' });
  ok(!!(await A.wait(m => m.t === 'error' && /ready/.test(m.msg))), 'host cannot start until others are ready');
  B.send({ t: 'ready', v: true });
  await A.wait(m => m.t === 'playerList' && m.players.some(p => p.ready));
  A.clear(); B.clear();
  A.send({ t: 'start', mapId: 99, mode: 'pvp' });
  const sa = await A.wait(m => m.t === 'startMatch'), sb = await B.wait(m => m.t === 'startMatch');
  ok(sa && sb && sa.mode === 'pvp' && sb.mode === 'pvp', 'startMatch reaches both players WITH mode=pvp');
  ok(sa.mapId === 0, 'out-of-range mapId (99) is replaced by a valid one');
  A.send({ t: 'start', mapId: 2, mode: 'coop' }); await sleep(150);
  ok(A.msgs.filter(m => m.t === 'startMatch').length === 1, 'second start in a running match is ignored');
  X.clear(); const E = await mk('E'); E.send({ t: 'join', name: 'E', room: ja.room });
  ok(!!(await E.wait(m => m.t === 'error' && /in progress/.test(m.msg))), 'joining a running match is rejected');

  // movement sync both ways, not echoed
  A.clear(); B.clear(); C2.clear(); D2.clear();
  A.send({ t: 'state', x: 1, y: 0, z: 2, yaw: 0.5, pitch: 0.1, weapon: 'ak12', moving: true, crouch: false, fire: false, hp: 5 });
  const sA = await B.wait(m => m.t === 'state' && m.id === ja.id);
  ok(sA && sA.x === 1 && sA.z === 2 && sA.hp === 100, 'A->B movement relayed; client-claimed hp ignored (server value 100)');
  ok(!A.has(m => m.t === 'state'), 'A does not get its own state echoed');
  B.send({ t: 'state', x: 3, y: 0, z: 2, yaw: 1, weapon: { evil: 1 } });
  const sB = await A.wait(m => m.t === 'state' && m.id === jb.id);
  ok(sB && sB.x === 3 && sB.weapon === '', 'B->A movement relayed; bogus weapon field sanitised');
  await sleep(150);
  ok(!C2.has(m => m.t === 'state') && !D2.has(m => m.t === 'state'), 'room 1 traffic never reaches room 2');
  A.send({ t: 'state', x: 500, y: 0, z: 500, yaw: 0 }); await sleep(120);
  ok(!B.msgs.some(m => m.t === 'state' && m.x === 500), 'teleport-speed state is dropped');
  A.send({ t: 'state', x: 'NaN', y: 0, z: 0, yaw: 0 }); await sleep(60);

  // combat (pvp)
  A.send({ t: 'state', x: 1.1, y: 0, z: 2, yaw: 0 }); await sleep(30);
  A.clear(); B.clear();
  A.send({ t: 'hit', targetId: jb.id, weapon: 'ak12', dmg: 26 });
  const h1 = await B.wait(m => m.t === 'health' && m.id === jb.id);
  ok(h1 && h1.hp === 74 && h1.alive, 'valid hit with new-armory weapon (ak12) applies 26 dmg');
  A.send({ t: 'hit', targetId: jb.id, weapon: 'ak12', dmg: 26 }); await sleep(30);
  ok(B.msgs.filter(m => m.t === 'health').length === 1, 'hit faster than weapon fire-rate is rejected');
  await sleep(100);
  A.send({ t: 'hit', targetId: jb.id, weapon: 'ak12', dmg: 9999 });
  const h2 = await B.wait(m => m.t === 'health' && m.hp < 74);
  ok(h2 && h2.hp >= 74 - 26 * 2.15 * 1.15 - 0.01 && h2.hp > 0, 'inflated damage is clamped to weapon ceiling');
  A.send({ t: 'hit', targetId: ja.id, weapon: 'ak12', dmg: 26 }); await sleep(100);
  ok(!A.has(m => m.t === 'health' && m.id === ja.id), 'self-hit rejected');
  A.send({ t: 'hit', targetId: jb.id, weapon: 'laser', dmg: 50 }); await sleep(60);
  ok(!B.has(m => m.t === 'health' && m.hp === 24), 'unknown weapon rejected');
  // shotgun: several pellets in one window all count
  A.clear(); B.clear(); await sleep(900);
  for (let i = 0; i < 8; i++) A.send({ t: 'hit', targetId: jb.id, weapon: 'aa12', dmg: 1 });
  await sleep(200);
  ok(B.msgs.filter(m => m.t === 'health').length === 8, 'pellet weapon: 8 pellets in one trigger pull are accepted');
  // kill
  let killed = false;
  for (let i = 0; i < 40 && !killed; i++) { A.send({ t: 'hit', targetId: jb.id, weapon: 'rev', dmg: 80 }); await sleep(650); killed = A.has(m => m.t === 'death' && m.id === jb.id); }
  ok(killed, 'kill produces death message to both');
  ok(B.has(m => m.t === 'death' && m.id === jb.id), 'victim also receives death');
  B.send({ t: 'respawn', x: 0, y: 0, z: 0 }); await sleep(100);
  ok(!A.has(m => m.t === 'respawn'), 'respawn before 2.5 s is rejected');
  await sleep(2600); B.send({ t: 'respawn', x: 0, y: 0, z: 0 });
  ok(!!(await A.wait(m => m.t === 'respawn' && m.id === jb.id)), 'respawn after delay accepted and broadcast');
  // heal-by-respawn exploit in pvp
  B.clear(); await sleep(2600);
  A.send({ t: 'state', x: 0.2, y: 0, z: 0, yaw: 0 }); B.send({ t: 'state', x: 0, y: 0, z: 0, yaw: 0 }); await sleep(30);
  A.send({ t: 'hit', targetId: jb.id, weapon: 'rev', dmg: 80 }); await sleep(100);
  A.clear(); B.send({ t: 'respawn', x: 0, y: 0, z: 0 }); await sleep(150);
  ok(!A.has(m => m.t === 'respawn'), 'recently-damaged living player cannot heal by respawning');

  // co-op separation: hits ignored, enemy relay
  const F = await mk('F'), G2 = await mk('G');
  F.send({ t: 'create', name: 'F' }); const jf = await F.wait(m => m.t === 'joined');
  G2.send({ t: 'join', name: 'G', room: jf.room }); const jg = await G2.wait(m => m.t === 'joined');
  G2.send({ t: 'ready', v: true }); await F.wait(m => m.t === 'playerList' && m.players.some(p => p.ready));
  F.send({ t: 'start', mapId: 3, mode: 'coop' }); await G2.wait(m => m.t === 'startMatch');
  F.clear(); G2.clear();
  F.send({ t: 'hit', targetId: jg.id, weapon: 'rev', dmg: 80 }); await sleep(100);
  ok(!G2.has(m => m.t === 'health'), 'co-op: player-vs-player hits are ignored');
  G2.send({ t: 'enemyState', enemies: [{ id: 1, k: 'sol', x: 0, y: 0, z: 0, yaw: 0, dead: false }], obj: 9 }); await sleep(100);
  ok(!F.has(m => m.t === 'enemyState'), 'non-host cannot inject enemyState');
  F.send({ t: 'enemyState', enemies: [{ id: 1, k: 'sol', x: 1, y: 0, z: 2, yaw: 0, dead: false }, { id: 'bad' }], obj: 2, wave: 1, ev: 'blackout', bo: 3, alarm: true });
  const es = await G2.wait(m => m.t === 'enemyState');
  ok(es && es.enemies.length === 1 && es.ev === 'blackout' && es.bo === 3 && es.alarm === true && es.wave === 1, 'host enemyState relayed incl. ev/bo/alarm; bad entries dropped');
  G2.send({ t: 'enemyHit', enemyId: 1, dmg: 22, part: 'head', ox: 0, oy: 1.6, oz: 0, dx: 0, dy: 0, dz: 1 });
  const eh = await F.wait(m => m.t === 'enemyHit');
  ok(eh && eh.dz === 1 && eh.dmg === 22 && !G2.has(m => m.t === 'enemyHit'), 'enemyHit forwarded to host only');
  G2.send({ t: 'enemyHit', enemyId: 1, dmg: 99999, ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1 }); await sleep(100);
  ok(F.msgs.filter(m => m.t === 'enemyHit').pop().dmg === 80, 'enemyHit damage is capped');

  // abuse: garbage must not crash server
  A.ws.send('not json'); A.ws.send('{"t":5}'); A.ws.send('[]'); A.send({ t: 'hit' }); A.send({ t: 'state' });
  const big = new C('big'); await big.open(); big.ws.send('x'.repeat(300 * 1024)); await sleep(300);
  ok(big.ws.readyState !== 1, 'oversize message closes that socket');
  const probe = await mk('probe'); probe.send({ t: 'ping', ts: 1 });
  ok(!!(await probe.wait(m => m.t === 'pong')) && srv.exitCode === null, 'server still alive after malformed / oversize input');

  // disconnect + host migration
  A.clear(); B.clear();
  B.ws.close();
  ok(!!(await A.wait(m => m.t === 'playerLeft' && m.id === jb.id)), 'A is told B left (playerLeft)');
  const pl = await A.wait(m => m.t === 'playerList' && m.players.length === 1);
  ok(!!pl, 'room keeps running with 1 player');
  A.send({ t: 'state', x: 0, y: 0, z: 0, yaw: 0 }); await sleep(50);
  ok(srv.exitCode === null, 'remaining player can keep sending after a disconnect');
  F.clear(); F.ws.close();
  const hc = await G2.wait(m => m.t === 'hostChanged');
  ok(hc && hc.hostId === jg.id, 'host leaving promotes the remaining player');
  ok(!C2.has(m => m.t === 'hostChanged' || m.t === 'playerLeft'), 'room 2 unaffected by room 1 / room 3 events');
  D2.send({ t: 'ready', v: true }); await sleep(60);
  ok(C2.has(m => m.t === 'playerList'), 'room 2 still functional');
  A.ws.close(); G2.ws.close(); await sleep(150);
  const R = await mk('R'); R.send({ t: 'join', name: 'R', room: ja.room });
  ok(!!(await R.wait(m => m.t === 'error' && /not found/.test(m.msg))), 'empty room is deleted');

  srv.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

