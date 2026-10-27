'use strict';
/*
 * FACILITY-7 multiplayer client-logic harness.
 *
 * WHAT THIS IS: it pulls the REAL multiplayer functions out of the HTML file (by name, no copies) and runs them inside
 * a Node `vm` sandbox with (a) a fake WebSocket, (b) a deterministic fake clock, (c) tiny DOM stand-ins, and (d) no-op
 * stubs for everything graphical. Scripted "server" messages are fed to the real message handler.
 *
 * WHAT THIS IS NOT: it does not run the game in a browser (three.js is a CDN script and the sandbox has no network), it
 * does not talk to the real Render server, and the "server" here is just the messages each test sends. It tests the
 * CLIENT's reaction logic only.
 */
const fs = require('fs');
const vm = require('vm');

function extract(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const find = re => { const i = lines.findIndex(l => re.test(l)); if (i < 0) throw new Error('harness: not found ' + re); return i; };
  const fn = name => {
    const i = find(new RegExp('^(async )?function ' + name + '\\('));
    let j = i + 1; while (j < lines.length && (/^\s/.test(lines[j]) || /^[}\])]+;?\s*$/.test(lines[j]))) j++;
    return lines.slice(i, j).join('\n');
  };
  const decl = re => lines[find(re)].replace(/\b(let|const) /g, 'var ');
  return { fn, decl };
}

function makeEnv(file) {
  const X = extract(file);
  const errors = [], shown = [], sockets = [], posSets = [];
  const clock = { t: 0, id: 1, timers: new Map() };
  const addT = (fn, ms, iv) => { const id = clock.id++; clock.timers.set(id, { fn, at: clock.t + (ms || 0), iv }); return id; };
  const advance = ms => {
    const end = clock.t + ms;
    for (;;) {
      let best = null;
      for (const [id, x] of clock.timers) if (x.at <= end && (!best || x.at < best[1].at)) best = [id, x];
      if (!best) break;
      clock.t = best[1].at;
      if (best[1].iv) best[1].at += best[1].iv; else clock.timers.delete(best[0]);
      try { best[1].fn(); } catch (e) { errors.push(e); }
    }
    clock.t = end;
  };

  function stub() {
    const f = function () { return stub(); };
    return new Proxy(f, {
      get(t, k) {
        if (k === Symbol.toPrimitive) return () => 0;
        if (k === Symbol.iterator) return () => ({ next: () => ({ done: true }) });
        if (k === 'then') return undefined;
        if (Object.prototype.hasOwnProperty.call(t, k)) return t[k];
        return stub();
      },
      apply() { return stub(); }
    });
  }

  const els = new Map();
  const getEl = id => {
    if (!els.has(id)) {
      const c = new Set();
      els.set(id, { id, textContent: '', innerHTML: '', classList: { add: (...a) => a.forEach(x => c.add(x)), remove: (...a) => a.forEach(x => c.delete(x)), contains: x => c.has(x), toggle() {} }, _c: c });
    }
    return els.get(id);
  };

  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(s) { if (this.readyState !== 1) throw new Error('send on non-open socket'); this.sent.push(JSON.parse(s)); }
    close() { this.readyState = 3; }
    _open() { this.readyState = 1; this.onopen && this.onopen(); }
    _msg(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); }
    _serverClose(code) { this.readyState = 3; this.onclose && this.onclose({ code: code || 1006, reason: '', wasClean: false }); }
  }

  const base = {
    document: { getElementById: getEl, createElement: () => getEl('__c' + Math.random()), body: { classList: getEl('__body').classList, appendChild() {} }, exitPointerLock() {}, activeElement: null },
    location: { protocol: 'https:', origin: 'https://example.test' },
    WebSocket: FakeWS,
    setTimeout: (f, ms) => addT(f, ms, 0), clearTimeout: id => clock.timers.delete(id),
    setInterval: (f, ms) => addT(f, ms, ms), clearInterval: id => clock.timers.delete(id),
    performance: { now: () => clock.t }, Date: { now: () => clock.t },
    P: { hp: 100, alive: true, pos: { set: (...a) => posSets.push(a) }, vel: { set() {} }, vy: 0, pitch: 0, yaw: 0, arm: 0, cr: 0 },
    state: 'menu', fire: false, mm: { hold: false, q: [], state: 'idle' },
    MAPS: Array.from({ length: 12 }, () => ({ en: [], pk: [], n: 'M', d: 'd' })), EN: [], PK: [],
    $: id => getEl(id), $t: k => String(k), $x: s => String(s),
    mpWarm: (u, d) => d(), mmOnClose: () => false, mmActive: () => false, mmAbort() {}, mpDiagRender() {},
    show: h => { shown.push(String(h)); }, SC: { mp: () => 'SC.mp', mpRoom: () => 'SC.mpRoom', menu: () => 'SC.menu' },
    mpForfeitHTML: () => 'FORFEIT_SCREEN', mpPvEndHTML: () => 'PVEND_SCREEN',
    toMenu() { base.state = 'menu'; },
    Math, JSON, Number, String, Boolean, Array, Object, Set, Map, WeakMap, RegExp, Error, TypeError, Promise, Symbol,
    isFinite, isNaN, parseInt, parseFloat, console: { log() {}, info() {}, warn() {}, error() {} },
    Infinity, NaN, undefined: undefined
  };
  const SPECIAL = new Set(['undefined', 'NaN', 'Infinity']);
  const g = new Proxy(base, {
    has: () => true,
    get(t, k) {
      if (typeof k !== 'string') return t[k];
      if (SPECIAL.has(k)) return t[k];
      if (k in t) return t[k];
      return (t[k] = stub());
    },
    set(t, k, v) { t[k] = v; return true; }
  });
  const ctx = vm.createContext(g);

  const names = ['mpNormUrl', 'mpNote', 'mpFail', 'mpOpStart', 'mpOpDone', 'mpDropSocket', 'mpConnect', 'mpSend', 'mpEsc', 'mpWho',
    'mpPvEl', 'mpPvName', 'mpPvInit', 'mpPvHud', 'mpPvUp', 'mpPvDeath', 'mpPvRoundReset', 'mpPvEnd', 'mpLocalDeath', 'mpLeaveRoom',
    'mpPrune', 'clearRemotePlayers', 'mpHandle', 'mpBeginMatch'];
  const code = [
    X.decl(/^let mp=\{/), X.decl(/^const MPP=new Map\(\)/), X.decl(/^let mpConnT=/), X.decl(/^const mpDiag=/),
    X.decl(/^let mpRespawnPending=/), X.decl(/^const MP_PV_MAX=/), X.decl(/^let mpRoundLocked=/),
    ...names.map(n => X.fn(n)),
    ...['mpClearPvpState', 'mpOthersLeft'].map(n => { try { return X.fn(n); } catch (e) { return ''; } })   /* only exist in the fixed file */
  ].join('\n');
  vm.runInContext(code, ctx, { filename: 'extracted-multiplayer-code.js' });

  const E = {
    base, errors, shown, sockets, posSets, clock, advance, getEl,
    get mp() { return base.mp; },
    sock() { return sockets[sockets.length - 1]; },
    sentOf(sock, t) { return sock.sent.filter(m => m.t === t); },
    activeTimers() { return clock.timers.size; },
    intervals(ms) { return [...clock.timers.values()].filter(x => x.iv === ms).length; },
    connect() { vm.runInContext("mpConnect('wss://test.invalid',()=>{},'create')", ctx); advance(0); const s = E.sock(); s._open(); return s; },
    run(c) { return vm.runInContext(c, ctx); },
    join(players, id, host) {
      const s = E.sock();
      s._msg({ t: 'joined', room: 'ABCDE', id: id || 'A', isHost: host !== false, players });
      return s;
    },
    startPvp(playerIds, myId) {
      const ids = playerIds || ['A', 'B'], me = myId || 'A';
      const players = ids.map((p, i) => ({ id: p, name: 'Player' + p + '#' + (10 + i), ready: true, isHost: i === 0 }));
      const s = E.connect();
      E.join(players, me, me === ids[0]);
      s._msg({ t: 'playerList', players });
      s._msg({ t: 'startMatch', mapId: 0, mode: 'pvp' });
      // a remote avatar for each opponent, as state packets would create
      for (const p of ids) if (p !== me) base.MPP.set(p, { g: { visible: true, position: { set() {} } }, hp: 100, seen: clock.t });
      return s;
    },
    resetAll() { clock.timers.clear(); }
  };
  return E;
}

module.exports = { makeEnv };
