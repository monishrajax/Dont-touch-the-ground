/* ==========================================================================
   net.js - multiplayer transport for DON'T TOUCH THE FLOOR

   How it works:
   - Players talk directly to each other over WebRTC data channels, using
     the PeerJS library. PeerJS's free public server is only used to
     introduce players to each other; no game data goes through it.
   - The host's game code is part of their PeerJS id, so joining a game is
     just "connect to the peer whose id contains this code".
   - Everyone connects to the host, and the host relays messages to the
     others (a "star" network). game.js decides what the messages mean.
   - PeerJS is loaded from a CDN only when Multiplayer is opened, so single
     player still works fully offline.

   Events (register with Net.on(name, fn)):
     'message'   (fromId, msg)  a message arrived ('h' = from the host)
     'peerJoin'  (id)           host only: a player connected
     'peerLeave' (id)           host only: a player disconnected
     'closed'    (reason)       client only: lost the connection to the host
     'error'     (text)         a non-fatal network problem, human-readable
   ========================================================================== */
window.Net = (() => {
  'use strict';

  const PEERJS_URLS = [
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js',
    'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
  ];
  const ID_PREFIX = 'dttf-neon-floor-';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I mix-ups
  const CODE_LEN = 5;
  const TIMEOUT_MS = 12000;

  let peer = null;          // our PeerJS peer
  let hostConn = null;      // client: the connection to the host
  const conns = new Map();  // host: playerId -> connection
  let nextId = 1;
  let loading = null;
  const handlers = {};

  const Net = {
    role: null,             // null | 'host' | 'client'
    code: '',
    on(type, fn) { handlers[type] = fn; },
    host, join, send, sendTo, broadcast, kick, leave, describe, normalizeCode,
    CODE_LEN,
  };

  function emit(type, ...args) {
    const fn = handlers[type];
    if (!fn) return;
    try { fn(...args); } catch (e) { console.error(e); }
  }

  const PeerClass = () => window.Peer || (window.peerjs && window.peerjs.Peer);

  /** Load PeerJS on demand (tries a second CDN if the first fails). */
  function loadLibrary() {
    if (PeerClass()) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      let i = 0;
      const next = () => {
        if (i >= PEERJS_URLS.length) { loading = null; reject({ type: 'load' }); return; }
        const s = document.createElement('script');
        s.src = PEERJS_URLS[i++];
        s.async = true;
        s.onload = () => (PeerClass() ? resolve() : next());
        s.onerror = () => { s.remove(); next(); };
        document.head.appendChild(s);
      };
      next();
    });
    return loading;
  }

  function makeCode() {
    const buf = new Uint32Array(CODE_LEN);
    crypto.getRandomValues(buf);
    let s = '';
    for (const n of buf) s += CODE_CHARS[n % CODE_CHARS.length];
    return s;
  }

  function normalizeCode(text) {
    return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
  }

  /** Create a peer and wait until it's registered with the PeerJS server. */
  function openPeer(id) {
    return new Promise((resolve, reject) => {
      const Peer = PeerClass();
      let settled = false;
      let p;
      try {
        p = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
      } catch (e) {
        reject({ type: 'browser-incompatible' });
        return;
      }
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { p.destroy(); } catch (e) { /* ignore */ }
        reject(err);
      };
      const timer = setTimeout(() => fail({ type: 'timeout' }), TIMEOUT_MS);
      p.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(p);
      });
      p.on('error', fail);
    });
  }

  /** Host a new game. Resolves with the game code. */
  async function host() {
    leave();
    await loadLibrary();
    let lastErr = null;
    for (let attempt = 0; attempt < 4 && !peer; attempt++) {
      const code = makeCode();
      try {
        peer = await openPeer(ID_PREFIX + code);
        Net.code = code;
      } catch (err) {
        lastErr = err;
        if (err.type !== 'unavailable-id') throw err; // code taken -> try another
      }
    }
    if (!peer) throw lastErr || { type: 'unknown' };

    const myPeer = peer;
    Net.role = 'host';

    myPeer.on('connection', (conn) => {
      const id = 'p' + nextId++;
      conn.on('open', () => {
        conns.set(id, conn);
        emit('peerJoin', id);
      });
      conn.on('data', (d) => {
        if (d && typeof d === 'object') emit('message', id, d);
      });
      const gone = () => {
        if (conns.get(id) !== conn) return;
        conns.delete(id);
        emit('peerLeave', id);
      };
      conn.on('close', gone);
      conn.on('error', gone);
    });
    // Losing the PeerJS server only stops NEW players joining; reconnect quietly.
    myPeer.on('disconnected', () => {
      setTimeout(() => {
        if (peer === myPeer && !myPeer.destroyed) {
          try { myPeer.reconnect(); } catch (e) { /* ignore */ }
        }
      }, 2000);
    });
    myPeer.on('error', (err) => {
      if (peer === myPeer && err.type !== 'peer-unavailable') emit('error', describe(err));
    });
    return Net.code;
  }

  /** Join a friend's game by code. Resolves once connected to the host. */
  async function join(rawCode) {
    leave();
    const code = normalizeCode(rawCode);
    if (code.length !== CODE_LEN) throw { type: 'bad-code' };
    await loadLibrary();
    const p = await openPeer(null);
    peer = p;
    const conn = p.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });

    try {
      await new Promise((resolve, reject) => {
        let settled = false;
        const done = (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (err) reject(err); else resolve();
        };
        const timer = setTimeout(() => done({ type: 'timeout' }), TIMEOUT_MS);
        conn.on('open', () => done());
        conn.on('error', (e) => done(e || { type: 'connection' }));
        p.on('error', (e) => done(e));
      });
    } catch (err) {
      leave();
      throw err;
    }

    hostConn = conn;
    Net.role = 'client';
    Net.code = code;
    conn.on('data', (d) => {
      if (d && typeof d === 'object') emit('message', 'h', d);
    });
    const lost = () => {
      if (hostConn !== conn) return;
      leave();
      emit('closed', 'The host left the game.');
    };
    conn.on('close', lost);
    conn.on('error', lost);
  }

  /** Client -> host. */
  function send(msg) {
    if (hostConn && hostConn.open) {
      try { hostConn.send(msg); } catch (e) { /* ignore */ }
    }
  }

  /** Host -> one player. */
  function sendTo(id, msg) {
    const c = conns.get(id);
    if (c && c.open) {
      try { c.send(msg); } catch (e) { /* ignore */ }
    }
  }

  /** Host -> every player (optionally skipping one). */
  function broadcast(msg, exceptId) {
    for (const [id, c] of conns) {
      if (id === exceptId || !c.open) continue;
      try { c.send(msg); } catch (e) { /* ignore */ }
    }
  }

  /** Host: drop a player without firing 'peerLeave' (used for rejected joins). */
  function kick(id) {
    const c = conns.get(id);
    if (!c) return;
    conns.delete(id);
    setTimeout(() => { try { c.close(); } catch (e) { /* ignore */ } }, 400);
  }

  /** Close everything and go back to offline. Safe to call any time. */
  function leave() {
    Net.role = null;
    Net.code = '';
    for (const c of conns.values()) {
      try { c.close(); } catch (e) { /* ignore */ }
    }
    conns.clear();
    if (hostConn) {
      const c = hostConn;
      hostConn = null;
      try { c.close(); } catch (e) { /* ignore */ }
    }
    if (peer) {
      const p = peer;
      peer = null;
      try { p.destroy(); } catch (e) { /* ignore */ }
    }
    nextId = 1;
  }

  /** Turn a PeerJS / internal error into a friendly sentence. */
  function describe(err) {
    const type = err && err.type;
    switch (type) {
      case 'peer-unavailable': return 'No game found with that code. Check it and try again.';
      case 'bad-code': return 'Game codes are ' + CODE_LEN + ' characters long.';
      case 'load': return "Couldn't load multiplayer. Are you online?";
      case 'timeout': return 'Connection timed out. Try again.';
      case 'browser-incompatible': return "This browser doesn't support online play.";
      case 'network':
      case 'server-error':
      case 'socket-error':
      case 'socket-closed':
      case 'unavailable-id':
        return "Can't reach the multiplayer server. Check your internet connection.";
      default:
        return 'Connection problem' + (type ? ' (' + type + ')' : '') + '. Try again.';
    }
  }

  window.addEventListener('pagehide', leave);
  return Net;
})();
