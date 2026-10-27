'use strict';
const { makeEnv } = require('./harness.js');
const file = process.argv[2];
if (!file) { console.error('usage: node run-tests.js <html file>'); process.exit(2); }

const results = [];
function test(id, title, fn) {
  let E;
  try { E = makeEnv(file); } catch (e) { results.push({ id, title, pass: false, why: 'harness setup failed: ' + e.message }); return; }
  try {
    const r = fn(E);
    const errs = E.errors.length ? ' | uncaught timer/handler errors: ' + E.errors.map(e => e.message).join('; ') : '';
    results.push({ id, title, pass: r.pass && !E.errors.length, why: r.why + errs });
  } catch (e) { results.push({ id, title, pass: false, why: 'threw: ' + e.message }); }
}
const pt = (E, id) => Math.round(E.clock.t) + 'ms';
const death = (s, id) => s._msg({ t: 'death', id });
const respawn = (s, id) => s._msg({ t: 'respawn', id, x: 1, y: 0, z: 1 });

/* ---------- Priority 1: disconnect / match termination ---------- */

test('D1', 'Opponent leaves lobby before match: removed from list, no forfeit, no stale avatar', E => {
  const s = E.connect();
  const both = [{ id: 'A', name: 'A#1', isHost: true }, { id: 'B', name: 'B#2' }];
  E.join(both, 'A', true);
  s._msg({ t: 'playerLeft', id: 'B' });
  s._msg({ t: 'playerList', players: [both[0]] });
  const ok = !E.mp.forfeitResult && E.mp.inMatch === false && E.base.state === 'menu' && E.mp.playersList.length === 1;
  return { pass: ok, why: `forfeitResult=${E.mp.forfeitResult} inMatch=${E.mp.inMatch} state=${E.base.state} players=${E.mp.playersList.length}` };
});

test('D2', 'PvP 1v1: opponent leaves mid-round -> forfeit win shown once, local state cleaned', E => {
  const s = E.startPvp();
  s._msg({ t: 'playerLeft', id: 'B' });
  E.advance(1500);
  const shown = E.shown.filter(x => x === 'FORFEIT_SCREEN').length;
  const ok = E.base.state === 'mpend' && E.mp.inMatch === false && E.mp.pv === null && shown === 1 && E.base.mpRoundLocked === false;
  return { pass: ok, why: `state=${E.base.state} inMatch=${E.mp.inMatch} pv=${E.mp.pv} forfeitScreens=${shown} roundLocked=${E.base.mpRoundLocked}` };
});

test('D3', 'playerLeft + server "forfeit" arriving back-to-back (either order) -> processed once', E => {
  let s = E.startPvp();
  s._msg({ t: 'playerLeft', id: 'B' }); s._msg({ t: 'forfeit', winnerId: 'A', id: 'B', name: 'Bob' });
  E.advance(1500);
  const a = E.shown.filter(x => x === 'FORFEIT_SCREEN').length;
  const E2 = makeEnv(file); s = E2.startPvp();
  s._msg({ t: 'forfeit', winnerId: 'A', id: 'B', name: 'Bob' }); s._msg({ t: 'playerLeft', id: 'B' });
  E2.advance(1500);
  const b = E2.shown.filter(x => x === 'FORFEIT_SCREEN').length;
  return { pass: a === 1 && b === 1 && !E.errors.length && !E2.errors.length, why: `order playerLeft->forfeit: ${a} screen(s); order forfeit->playerLeft: ${b} screen(s)` };
});

test('D4', 'Socket drops during a live PvP round: avatars cleared, HUD hidden, no leftover state or timers', E => {
  const s = E.startPvp();
  s._serverClose(1006);
  E.advance(20000);
  const ok = E.mp.inMatch === false && E.base.MPP.size === 0 && E.base.mpRoundLocked === false && E.base.mpRespawnPending === false &&
    !E.getEl('mppv')._c.has('on') && E.mp.room === null && E.activeTimers() === 0;
  return { pass: ok, why: `inMatch=${E.mp.inMatch} avatars=${E.base.MPP.size} roundLocked=${E.base.mpRoundLocked} respawnPending=${E.base.mpRespawnPending} room=${E.mp.room} timersLeft=${E.activeTimers()}` };
});

test('D5', 'Socket drops DURING round-transition lock: local player must not stay frozen', E => {
  const s = E.startPvp();
  death(s, 'B'); s._msg({ t: 'roundReset', round: 2 });
  E.advance(3500);                              // inside the lock window (3 s -> 8 s)
  const lockedBefore = E.base.mpRoundLocked;
  s._serverClose(1006);
  E.advance(20000);
  const ok = lockedBefore === true && E.base.mpRoundLocked === false && !E.getEl('mpcd')._c.has('on') && E.activeTimers() === 0;
  return { pass: ok, why: `lockedBeforeDrop=${lockedBefore} lockedAfterDrop=${E.base.mpRoundLocked} countdownVisible=${E.getEl('mpcd')._c.has('on')} timersLeft=${E.activeTimers()}` };
});

test('D6', 'Lobby disconnect (before match): room cleared, error shown, no timers left', E => {
  const s = E.connect();
  E.join([{ id: 'A', name: 'A#1', isHost: true }, { id: 'B', name: 'B#2' }], 'A', true);
  s._serverClose(1006);
  E.advance(20000);
  const ok = E.mp.room === null && /DISCONNECTED/.test(E.mp.err) && E.activeTimers() === 0;
  return { pass: ok, why: `room=${E.mp.room} err="${E.mp.err.slice(0, 40)}" timersLeft=${E.activeTimers()}` };
});

test('D7', 'Reconnect after a drop: old socket ignored, exactly one heartbeat interval, one room state', E => {
  const s1 = E.connect();
  E.join([{ id: 'A', name: 'A#1', isHost: true }], 'A', true);
  s1._serverClose(1006);
  const s2 = E.connect();
  E.join([{ id: 'A2', name: 'A#1', isHost: true }], 'A2', true);
  const before = E.mp.playersList.length;
  s1._msg({ t: 'playerList', players: [{ id: 'ghost', name: 'ghost' }, { id: 'ghost2', name: 'ghost2' }] }); // late packet on the dead socket
  const ok = E.intervals(3000) === 1 && E.mp.playersList.length === before && E.mp.id === 'A2' && s1 !== s2;
  return { pass: ok, why: `heartbeatIntervals=${E.intervals(3000)} playersAfterStalePacket=${E.mp.playersList.length}(expected ${before}) id=${E.mp.id}` };
});

test('D8', 'Leave match -> new match: no duplicate heartbeat, old socket closed, state reset', E => {
  let s = E.startPvp();
  E.run('mpLeaveRoom()');
  const closed = s.readyState === 3;
  s = E.startPvp();
  const ok = closed && E.intervals(3000) === 1 && E.mp.inMatch === true && E.mp.matchMode === 'pvp';
  return { pass: ok, why: `oldSocketClosed=${closed} heartbeatIntervals=${E.intervals(3000)} inMatch=${E.mp.inMatch}` };
});

test('D9', 'Second match in the same page session: opponent leaving is still detected (no stale forfeit flag)', E => {
  let s = E.startPvp();
  s._msg({ t: 'playerLeft', id: 'B' }); E.advance(1500);
  const first = E.base.state === 'mpend';
  E.run('mpLeaveRoom()');                       // RETURN TO MENU button on the forfeit screen
  s = E.startPvp();                              // brand-new room, brand-new match
  s._msg({ t: 'playerLeft', id: 'B' }); E.advance(1500);
  const second = E.base.state === 'mpend' && E.mp.inMatch === false;
  return { pass: first && second, why: `firstForfeitHandled=${first} secondForfeitHandled=${second} (forfeitResult carried over: ${JSON.stringify(E.mp.forfeitResult)})` };
});

test('D10', 'After the match is already decided, the other player leaving must NOT flip the loser to "victory by forfeit"', E => {
  const s = E.startPvp();
  for (let i = 0; i < 5; i++) {
    s._msg({ t: 'health', id: 'A', hp: 0, alive: false });          // my death (local death handler waits for the server's roundReset)
    if (i < 4) { s._msg({ t: 'roundReset', round: i + 2 }); E.advance(8100); respawn(s, 'A'); }
  }
  E.advance(1500);
  const lost = E.mp.pvRes && E.mp.pvRes.lost === true && E.base.state === 'mpend';
  const winnerLeaves = () => { s._msg({ t: 'playerLeft', id: 'B' }); E.advance(1500); };
  winnerLeaves();
  const last = E.shown[E.shown.length - 1];
  const ok = lost && !E.mp.forfeitResult && last === 'PVEND_SCREEN';
  return { pass: ok, why: `loserScreenReached=${lost} forfeitResult=${JSON.stringify(E.mp.forfeitResult)} lastScreen=${last}` };
});

test('D11', '3-player PvP room: one player leaving must not end the match for the others', E => {
  const s = E.startPvp(['A', 'B', 'C']);
  s._msg({ t: 'playerLeft', id: 'C' });
  s._msg({ t: 'playerList', players: [{ id: 'A', name: 'PlayerA#10' }, { id: 'B', name: 'PlayerB#11' }] });
  E.advance(1500);
  const ok = E.mp.inMatch === true && E.base.state === 'play' && !E.mp.forfeitResult && !E.base.MPP.has('C') && E.base.MPP.has('B');
  return { pass: ok, why: `inMatch=${E.mp.inMatch} state=${E.base.state} forfeitResult=${JSON.stringify(E.mp.forfeitResult)} avatarC=${E.base.MPP.has('C')} avatarB=${E.base.MPP.has('B')}` };
});

/* ---------- Priority 3: round transitions ---------- */

test('R1', 'Every death produces its own round transition (3 deaths -> 3 respawn requests, rounds 2,3,4)', E => {
  const s = E.startPvp();
  const rounds = [];
  for (let r = 2; r <= 4; r++) {
    death(s, r % 2 ? 'A' : 'B');
    s._msg({ t: 'roundReset', round: r });
    E.advance(3100); const lockedMid = E.base.mpRoundLocked;
    E.advance(5000);
    rounds.push({ r, lockedMid, unlocked: E.base.mpRoundLocked === false });
    respawn(s, 'A'); respawn(s, 'B');
  }
  const reqs = E.sentOf(s, 'respawn').length;
  const ok = reqs === 3 && rounds.every(x => x.lockedMid && x.unlocked) && E.mp.pv.round === 4;
  return { pass: ok, why: `respawnRequestsSent=${reqs}/3 roundShown=${E.mp.pv.round} perRound=${JSON.stringify(rounds)}` };
});

test('R2', 'Duplicate roundReset while a transition is running is ignored (single respawn request, one countdown)', E => {
  const s = E.startPvp();
  death(s, 'B');
  s._msg({ t: 'roundReset', round: 2 }); s._msg({ t: 'roundReset', round: 2 }); E.advance(1000); s._msg({ t: 'roundReset', round: 2 });
  E.advance(10000);
  const reqs = E.sentOf(s, 'respawn').length;
  return { pass: reqs === 1 && E.base.mpRoundLocked === false, why: `respawnRequestsSent=${reqs} (expected 1) roundLocked=${E.base.mpRoundLocked}` };
});

test('R3', 'Timers from a finished match must not touch the next match (no teleport, lock or respawn request)', E => {
  let s = E.startPvp();
  death(s, 'B'); s._msg({ t: 'roundReset', round: 2 });
  E.advance(1000);                               // transition for match 1 is mid-flight (fires at 3 s and 8 s)
  E.run('mpLeaveRoom()');
  s = E.startPvp();                              // match 2 starts 1 s later
  const posBefore = E.posSets.length;
  E.advance(12000);
  const stray = E.sentOf(s, 'respawn').length;
  const moved = E.posSets.length - posBefore;
  const ok = stray === 0 && moved === 0 && E.base.mpRoundLocked === false && !E.getEl('mpcd')._c.has('on');
  return { pass: ok, why: `strayRespawnRequests=${stray} strayTeleports=${moved} roundLocked=${E.base.mpRoundLocked} countdownVisible=${E.getEl('mpcd')._c.has('on')}` };
});

test('M1', 'Both clients agree on match end: my 5th death ends the match on MY client too (not only on the opponent\'s)', E => {
  const me = E.startPvp();                                   // client of player A, who dies five times
  for (let i = 0; i < 5; i++) {
    me._msg({ t: 'health', id: 'A', hp: 0, alive: false });
    if (i < 4) { me._msg({ t: 'roundReset', round: i + 2 }); E.advance(8100); respawn(me, 'A'); }
  }
  E.advance(1500);
  const E2 = makeEnv(file); const opp = E2.startPvp(['A', 'B'], 'B');   // client of player B watching A die five times
  for (let i = 0; i < 5; i++) { opp._msg({ t: 'death', id: 'A' }); if (i < 4) { opp._msg({ t: 'roundReset', round: i + 2 }); E2.advance(8100); opp._msg({ t: 'respawn', id: 'A', x: 1, y: 0, z: 1 }); } }
  E2.advance(1500);
  const mineEnded = !!(E.mp.pv && E.mp.pv.over), oppEnded = !!(E2.mp.pv && E2.mp.pv.over);
  return { pass: mineEnded && oppEnded && E.mp.pv.d.A === 5, why: `A's client: matchEnded=${mineEnded} deathsCountedForA=${E.mp.pv ? E.mp.pv.d.A : 'n/a'}/5 | B's client: matchEnded=${oppEnded} deathsCountedForA=${E2.mp.pv ? E2.mp.pv.d.A : 'n/a'}/5` };
});

/* ---------- Priority 2 (client side only): duplicate / ordering protection ---------- */

test('H1', 'Duplicate death / health(alive:false) events count one death until a respawn arrives', E => {
  const s = E.startPvp();
  death(s, 'B'); death(s, 'B'); s._msg({ t: 'health', id: 'B', hp: 0, alive: false });
  const afterDup = E.mp.pv.d.B;
  respawn(s, 'B'); death(s, 'B');
  const afterRespawn = E.mp.pv.d.B;
  return { pass: afterDup === 1 && afterRespawn === 2, why: `deathsAfterDuplicates=${afterDup}(expected 1) deathsAfterRespawnThenDeath=${afterRespawn}(expected 2)` };
});

test('H2', 'Own damage: hp drop on me raises hit feedback once; a health packet for the opponent does not touch my hp', E => {
  const s = E.startPvp();
  E.base.P.hp = 100; s._msg({ t: 'health', id: 'B', hp: 40, alive: true });
  const mine1 = E.base.P.hp;
  s._msg({ t: 'health', id: 'A', hp: 70, alive: true });
  return { pass: mine1 === 100 && E.base.P.hp === 70 && E.base.MPP.get('B').hp === 40, why: `myHpAfterOpponentPacket=${mine1} myHpAfterMyPacket=${E.base.P.hp} opponentHp=${E.base.MPP.get('B').hp}` };
});

test('H3', 'Match ends at 5 deaths exactly once, later death packets are ignored', E => {
  const s = E.startPvp();
  for (let i = 0; i < 5; i++) { death(s, 'B'); if (i < 4) respawn(s, 'B'); }
  const over = E.mp.pv.over; const rows = E.mp.pvRes && E.mp.pvRes.rows;
  death(s, 'B'); death(s, 'A'); E.advance(2000);
  const screens = E.shown.filter(x => x === 'PVEND_SCREEN').length;
  return { pass: over === 1 && screens === 1 && E.mp.pv.d.B === 5, why: `over=${over} resultScreens=${screens} deathsB=${E.mp.pv.d.B}` };
});

/* ---------- report ---------- */
let pass = 0;
for (const r of results) { if (r.pass) pass++; console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.id.padEnd(4) + r.title + '\n        ' + r.why); }
console.log(`\n${pass}/${results.length} passed   (${file.split('/').pop()})`);
process.exit(pass === results.length ? 0 : 1);
