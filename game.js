/* ==========================================================================
   DON'T TOUCH THE FLOOR
   A neon arcade platformer written in plain JavaScript + Canvas.

   File layout (search for the "====" banners):
     1.  Constants & tuning
     2.  Small helpers (math, storage)
     3.  Sound (Web Audio, procedural)
     4.  DOM references & screen resizing
     5.  Input (keyboard + touch)
     6.  World state & run reset
     7.  Procedural platform / hazard generation
     8.  Update: platforms, hazards, player, collisions, lava, camera, score
     9.  Particles & effects
     10. Menu attract scene
     11. Rendering
     12. Game-state management (menu / playing / paused / gameover)
     12b. Multiplayer (lobby, match, ghosts, results - transport is in net.js)
     13. Main loop & boot

   World coordinates: the game world is W units wide (480 on phones, up to
   1280 on wide screens, so the game always fills the screen). "y" grows downward,
   so climbing means y gets SMALLER. camY is the world y at the top of the
   screen. The canvas is scaled to fit the window, but all game logic uses
   these fixed world units, so resizing never affects collisions.
   ========================================================================== */
(() => {
  'use strict';

  /* ==================================================================
     1. CONSTANTS & TUNING
     ================================================================== */
  const W_MIN = 480;             // narrowest world (phones in portrait)
  const W_MAX = 1280;            // widest world (wide monitors)
  let W = W_MIN;                 // current world/view width (set by resize())
  let worldLock = 0;             // while a run exists its width is locked (0 = follow the screen)
  const H_MIN = 720;             // normal view height (2:3)
  const H_MAX = 960;             // tall phones get to see up to this much
  let H = H_MIN;                 // current view height (set by resize())
  const START_Y = 580;           // top of the starting platform
  const STEP = 1 / 120;          // fixed physics timestep (seconds)

  const PHYS = {
    gravity: 1900,               // px/s^2
    jumpSpeed: 790,              // initial upward speed of a jump
    bounceSpeed: 1120,           // launch speed from bouncy platforms
    maxFall: 1100,               // terminal velocity
    lowJumpGravity: 2.4,         // extra gravity when jump is released early (variable jump)
    groundAccel: 2800,
    airAccel: 2000,              // slightly reduced air control
    groundFriction: 2600,
    airFriction: 700,
    maxSpeed: 270,
    coyoteTime: 0.08,            // grace period to jump after walking off a ledge
    jumpBuffer: 0.12,            // jump pressed slightly before landing still counts
  };

  const PLAYER_W = 26;
  const PLAYER_H = 34;
  const PLAT_H = 14;
  // The deadly floor is a laser alarm grid. (In code it's still called "lava":
  // lavaY is its surface.) It is always at least this far onto the screen.
  const LAVA_MIN_VISIBLE = 40;

  // Prison-break palette
  const COLORS = {
    bg: '#121417',        // dark concrete
    primary: '#FF8A1F',   // prison orange
    steel: '#8FA3BF',     // steel blue-gray
    red: '#FF3B3B',       // alarms, lasers, hazards
    yellow: '#FFD23F',    // searchlights, highlights
    text: '#F1F1EE',
    amber: '#FFB02E',
    dust: '#A8A29E',      // concrete dust
  };

  // Platform looks: `color` is the accent (top edge, particles), `body` the fill,
  // `edge` the outline.
  const PLAT_STYLE = {
    normal:  { color: '#AEB8C6', body: '#48505C', edge: '#262B33' }, // steel girder
    moving:  { color: '#6E9BFF', body: '#2C4A8C', edge: '#18294D' }, // blue moving beam
    bouncy:  { color: '#EDE7D3', body: '#B9B19B', edge: '#5F5848' }, // bunk mattress
    vanish:  { color: '#C9D4E0', body: 'rgba(201,212,224,0.08)', edge: '#C9D4E0' }, // chain-link mesh
    crumble: { color: '#D2774A', body: '#8A4A2E', edge: '#4A2414' }, // crumbling bricks
  };

  // Height (in metres, 1 m = 10 px) at which each difficulty stage begins.
  const STAGE_AT = [0, 120, 280, 480, 720];
  const STAGE_EXTRA_EVERY = 350; // after stage 5, +1 stage every 350 m
  const STAGE_INFO = {
    1: 'CELL BLOCK',
    2: 'MOVING PLATFORMS',
    3: 'HAZARDS AHEAD',
    4: 'VANISHING PLATFORMS',
    5: 'CRUMBLE & CHAOS',
  };

  const STORE_BEST = 'dttf.best';
  const STORE_SETTINGS = 'dttf.settings';
  const STORE_NAME = 'dttf.name';

  // Prisoner jumpsuits. Index 0 is the default (single player / host).
  // suit = main colour, stripe = stripe colour, color = UI accent (name tags, scoreboard).
  const LOOKS = [
    { suit: '#F2F2EE', stripe: '#24262B', color: '#F2F2EE' }, // classic black & white
    { suit: '#FF8A1F', stripe: '#A84F00', color: '#FF8A1F' }, // orange
    { suit: '#5AA9FF', stripe: '#1D4E89', color: '#5AA9FF' }, // blue
    { suit: '#45D98F', stripe: '#13704A', color: '#45D98F' }, // green
    { suit: '#FF6FAE', stripe: '#9C1F57', color: '#FF6FAE' }, // pink
    { suit: '#FFD23F', stripe: '#A67C00', color: '#FFD23F' }, // yellow
  ];
  const MAX_PLAYERS = LOOKS.length;

  /* ==================================================================
     2. HELPERS
     ================================================================== */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const lerp = (a, b, t) => a + (b - a) * t;

  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  /** Small seeded random generator (mulberry32). The same seed always gives
   *  the same numbers, which is how every multiplayer player gets the same tower. */
  function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function weightedPick(weights, rng = Math.random) {
    let total = 0;
    for (const k in weights) total += weights[k];
    let r = rng() * total;
    for (const k in weights) {
      r -= weights[k];
      if (r <= 0) return k;
    }
    return 'normal';
  }

  // LocalStorage can throw (private mode, disabled storage) - never let that break the game.
  const Store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    },
  };

  function stageForHeight(m) {
    let s = 1;
    for (let i = 1; i < STAGE_AT.length; i++) if (m >= STAGE_AT[i]) s = i + 1;
    const last = STAGE_AT[STAGE_AT.length - 1];
    if (m >= last) s += Math.floor((m - last) / STAGE_EXTRA_EVERY);
    return s;
  }

  function formatTime(sec) {
    const s = Math.floor(sec);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /* ==================================================================
     3. SOUND - tiny procedural effects with the Web Audio API.
     The AudioContext is only created after the first user gesture.
     If audio is unavailable every call silently does nothing.
     ================================================================== */
  const Sound = {
    ctx: null,
    muted: !!Store.get(STORE_SETTINGS, {}).muted,

    init() {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) { this.ctx = null; }
    },

    tone(freq, dur, { type = 'square', vol = 0.06, slide = 0, delay = 0 } = {}) {
      if (!this.ctx || this.muted) return;
      try {
        const t = this.ctx.currentTime + delay;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
        gain.gain.setValueAtTime(vol, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + dur + 0.02);
      } catch (e) { /* ignore */ }
    },

    noise(dur, vol = 0.08, delay = 0) {
      if (!this.ctx || this.muted) return;
      try {
        const len = Math.floor(this.ctx.sampleRate * dur);
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = this.ctx.createBufferSource();
        const gain = this.ctx.createGain();
        src.buffer = buf;
        gain.gain.value = vol;
        src.connect(gain).connect(this.ctx.destination);
        src.start(this.ctx.currentTime + delay);
      } catch (e) { /* ignore */ }
    },

    jump()    { this.tone(380, 0.14, { slide: 380, vol: 0.045 }); },
    land()    { this.tone(150, 0.08, { type: 'sine', slide: -60, vol: 0.09 }); },
    bounce()  { this.tone(260, 0.28, { type: 'triangle', slide: 900, vol: 0.08 }); },
    crack()   { this.noise(0.22, 0.12); this.tone(110, 0.2, { type: 'sawtooth', slide: -60, vol: 0.04 }); },
    vanish()  { this.tone(900, 0.12, { type: 'sine', slide: -600, vol: 0.05 }); },
    click()   { this.tone(720, 0.05, { vol: 0.035 }); },
    stage()   { this.tone(523, 0.1, { type: 'triangle', vol: 0.06 }); this.tone(784, 0.16, { type: 'triangle', vol: 0.06, delay: 0.1 }); },
    record()  { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.16, { type: 'triangle', vol: 0.07, delay: i * 0.09 })); },
    tick()    { this.tone(440, 0.12, { type: 'triangle', vol: 0.07 }); },
    go()      { this.tone(880, 0.3, { type: 'triangle', vol: 0.08 }); },
    step()    { this.tone(70 + Math.random() * 25, 0.06, { type: 'sine', vol: 0.08 }); },
    /** Two-tone prison siren lasting `dur` seconds. */
    siren(dur) {
      if (!this.ctx || this.muted) return;
      try {
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(620, t);
        for (let i = 1; i * 0.45 <= dur; i++) osc.frequency.linearRampToValueAtTime(i % 2 ? 880 : 620, t + i * 0.45);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.03, t + 0.08);
        gain.gain.setValueAtTime(0.03, t + Math.max(0.1, dur - 0.4));
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + dur + 0.05);
        this.sirenOsc = osc;
      } catch (e) { /* ignore */ }
    },
    stopSiren() {
      try { if (this.sirenOsc) this.sirenOsc.stop(); } catch (e) { /* ignore */ }
      this.sirenOsc = null;
    },
    join()    { this.tone(660, 0.08, { type: 'sine', vol: 0.06 }); this.tone(990, 0.12, { type: 'sine', vol: 0.06, delay: 0.08 }); },
    gameOver() {
      this.noise(0.35, 0.14);
      [392, 294, 220, 131].forEach((f, i) => this.tone(f, 0.22, { type: 'sawtooth', vol: 0.05, delay: 0.08 + i * 0.13 }));
    },
  };

  /* ==================================================================
     4. DOM REFERENCES & RESIZING
     ================================================================== */
  const $ = (id) => document.getElementById(id);
  const stageEl = $('stage');
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const ui = {
    hudScore: $('hudScore'), hudBest: $('hudBest'), hudStage: $('hudStage'),
    hudHeight: $('hudHeight'), hudTime: $('hudTime'), toast: $('toast'),
    menuBest: $('menuBest'), overScore: $('overScore'), overBest: $('overBest'),
    overPrev: $('overPrev'), overCause: $('overCause'), overDetail: $('overDetail'),
    newRecord: $('newRecord'),
    // multiplayer
    mpName: $('mpName'), mpCode: $('mpCode'), mpStatus: $('mpStatus'),
    lobbyCode: $('lobbyCode'), lobbyPlayers: $('lobbyPlayers'), lobbyStatus: $('lobbyStatus'),
    mpStartBtn: $('mpStartBtn'), mpBoard: $('mpBoard'), specText: $('specText'),
    hudBar: $('hudBar'), mpBoardWrap: $('mpBoardWrap'),
    resultsWinner: $('resultsWinner'), resultsList: $('resultsList'), resultsNote: $('resultsNote'),
    overlays: {
      menu: $('menu'), help: $('help'), paused: $('pause'), gameover: $('gameover'),
      mp: $('mp'), lobby: $('lobby'), results: $('results'),
    },
  };

  let viewScale = 1; // world units -> device pixels

  /** Phone notch / home-bar insets in CSS pixels (0 on normal screens). */
  function safeArea() {
    const cs = getComputedStyle($('safeProbe'));
    return {
      top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0,
    };
  }

  /** Usable screen size in CSS pixels (minus any phone notch). */
  function screenSize() {
    const safe = safeArea();
    return {
      vw: window.innerWidth - safe.left - safe.right,
      vh: window.innerHeight - safe.top - safe.bottom,
    };
  }

  /** World width that would fill this screen at the normal 720 view height:
   *  480 on portrait phones, up to 1280 on wide monitors. */
  function preferredWidth() {
    const { vw, vh } = screenSize();
    return clamp(Math.round((H_MIN * vw) / vh), W_MIN, W_MAX);
  }

  /** Fit the game to the window so it fills the screen. Wide screens get a
   *  wider world, tall phones a taller view (up to 960). While a run is in
   *  progress the world width is locked (worldLock) and the view just
   *  rescales. devicePixelRatio keeps graphics sharp. */
  function resize() {
    const { vw, vh } = screenSize();
    const isTouch = document.body.classList.contains('is-touch');
    W = worldLock || preferredWidth();
    const s = Math.min(vw / W, vh / H_MIN);
    const fontPx = Math.max(10, 17 * s);

    // Touch controls go underneath the game if the screen has spare height.
    const barH = fontPx * 6.6;
    const below = isTouch && vh - H_MIN * s >= barH;
    H = clamp(Math.floor((vh - (below ? barH : 0)) / s), H_MIN, H_MAX);

    const cssW = Math.floor(W * s);
    const cssH = Math.floor(H * s);
    stageEl.style.width = cssW + 'px';
    stageEl.style.height = cssH + 'px';
    stageEl.style.fontSize = fontPx + 'px';

    const touchBar = document.querySelector('.touch');
    document.body.classList.toggle('touch-below', below);
    touchBar.style.fontSize = fontPx + 'px';
    touchBar.style.width = below ? cssW + 'px' : '';
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    viewScale = canvas.width / W;
    measureHud();
  }

  /* ==================================================================
     5. INPUT - keyboard and touch both write into the same flags.
     ================================================================== */
  const input = {
    kLeft: false, kRight: false, kJump: false,   // keyboard held
    tLeft: false, tRight: false, tJump: false,   // touch held
    jumpBuffer: 0,                               // >0 means "a jump was just pressed"
    get left() { return this.kLeft || this.tLeft; },
    get right() { return this.kRight || this.tRight; },
    get jumpHeld() { return this.kJump || this.tJump; },
  };

  function clearInput() {
    input.kLeft = input.kRight = input.kJump = false;
    input.tLeft = input.tRight = input.tJump = false;
    input.jumpBuffer = 0;
    document.querySelectorAll('.tbtn.active').forEach((b) => b.classList.remove('active'));
  }

  function pressJump() {
    if (state === 'playing' && run.countdown <= 0) input.jumpBuffer = PHYS.jumpBuffer;
  }

  const KEYS_LEFT = ['KeyA', 'ArrowLeft'];
  const KEYS_RIGHT = ['KeyD', 'ArrowRight'];
  const KEYS_JUMP = ['Space', 'KeyW', 'ArrowUp'];
  const KEYS_BLOCK = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

  function onKeyDown(e) {
    const code = e.code;
    // Typing a name or game code: let the text field have the keys.
    if (e.target && e.target.tagName === 'INPUT') {
      if (code === 'Enter') {
        e.preventDefault();
        // Enter joins if a code has been typed, otherwise hosts.
        if (state === 'mp') handleAction(ui.mpCode.value.trim() ? 'mpJoin' : 'mpHost');
      } else if (code === 'Escape') {
        e.target.blur();
      }
      return;
    }
    if (KEYS_BLOCK.has(code)) e.preventDefault(); // never scroll the page
    Sound.init();

    if (KEYS_LEFT.includes(code)) input.kLeft = true;
    if (KEYS_RIGHT.includes(code)) input.kRight = true;
    if (KEYS_JUMP.includes(code)) {
      if (!input.kJump && !e.repeat) pressJump();
      input.kJump = true;
    }
    if (e.repeat) return;

    const confirmKey = code === 'Enter' || code === 'Space';
    switch (state) {
      case 'menu':
        if (confirmKey) { e.preventDefault(); beginSoloEscape(); }
        break;
      case 'escape':
        if (confirmKey || code === 'Escape') { e.preventDefault(); skipEscape(); }
        break;
      case 'playing':
        if (code === 'KeyP' || code === 'Escape') togglePause();
        else if (code === 'KeyR' && mode === 'solo') startGame(true);
        break;
      case 'mp':
        if (code === 'Escape') goToMenu();
        break;
      case 'help':
        if (confirmKey || code === 'Escape') { e.preventDefault(); setState('menu'); }
        break;
      case 'lobby':
        if (code === 'Enter' && Net.role === 'host') { e.preventDefault(); hostStartMatch(); }
        break;
      case 'results':
        if (code === 'Enter' && Net.role === 'host') { e.preventDefault(); hostStartMatch(); }
        break;
      case 'paused':
        if (code === 'KeyP' || code === 'Escape' || code === 'Enter') { e.preventDefault(); resume(); }
        else if (code === 'KeyR') startGame();
        break;
      case 'gameover':
        // short delay so a panicked key mash at death doesn't instantly restart
        if ((confirmKey || code === 'KeyR') && performance.now() - gameOverAt > 600) { e.preventDefault(); startGame(); }
        else if (code === 'Escape') goToMenu();
        break;
    }
    if (code === 'KeyM') toggleMute();
  }

  function onKeyUp(e) {
    const code = e.code;
    if (KEYS_LEFT.includes(code)) input.kLeft = false;
    if (KEYS_RIGHT.includes(code)) input.kRight = false;
    if (KEYS_JUMP.includes(code)) input.kJump = false;
  }

  /** On-screen buttons: pointer capture means releasing anywhere ends the hold,
   *  and pointercancel covers interrupted touches, so movement never sticks. */
  function bindTouchButton(btn) {
    const key = btn.dataset.hold;
    const set = (down) => {
      if (key === 'left') input.tLeft = down;
      if (key === 'right') input.tRight = down;
      if (key === 'jump') {
        if (down && !input.tJump) pressJump();
        input.tJump = down;
      }
      btn.classList.toggle('active', down);
    };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      Sound.init();
      try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      set(true);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => btn.addEventListener(ev, () => set(false)));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /* ==================================================================
     6. WORLD STATE
     ================================================================== */
  let state = 'menu';          // 'menu' | 'playing' | 'paused' | 'gameover' | 'mp' | 'lobby' | 'results'
  let mode = 'solo';           // 'solo' | 'multi'
  let myLook = LOOKS[0];       // colours of the local player
  const remotes = new Map();   // multiplayer: other players' ghosts, by id
  let platforms = [];
  let hazards = [];
  let particles = [];
  let player = null;
  let run = null;              // everything that belongs to the current run
  let gen = null;              // procedural generator cursor
  let camY = 0;
  let lavaY = H - LAVA_MIN_VISIBLE;
  let shake = 0;               // camera shake time remaining
  let flash = 0;               // white screen flash alpha
  let visualTime = 0;          // drives purely cosmetic animation
  let best = Math.max(0, Number(Store.get(STORE_BEST, 0)) || 0);
  let gameOverAt = 0;
  let toastTimer = 0;
  const stars = [];

  function makePlayer(x, y) {
    return {
      x, y, w: PLAYER_W, h: PLAYER_H,
      vx: 0, vy: 0,
      ground: null,            // platform currently stood on (or null in the air)
      coyote: 0,
      face: 1,
      runPhase: 0,
      squash: 0,               // landing squash amount (decays)
      bounced: false,          // true while rising from a bouncy pad (ignore variable-jump cut)
      visible: true,
    };
  }

  function makePlatform(type, x, y, w) {
    return {
      type, x, y, w, h: PLAT_H,
      baseX: x, range: 0, speed: 0, phase: 0, dx: 0,
      state: 'idle',           // 'idle' | 'crumbling' | 'vanishing' | 'gone'
      timer: 0,
      glow: 0,
      bounceAnim: 0,
      visited: false,
      spikes: null,            // { side: 0|1, w } for stationary spike hazards
    };
  }

  function newRunData() {
    return {
      score: 0, bonus: 0, maxHeightPx: 0, heightM: 0, time: 0, stage: 1,
      platformsLanded: 0, prevBest: best, celebrated: false,
      dead: false, deathTimer: 0, cause: '', lastSecond: -1,
      clock: 0,          // world clock (moving platforms/hazards); keeps running after death
      countdown: 0,      // multiplayer "3, 2, 1" before the run starts
      goFlash: 0,
      spectating: false, // multiplayer: fallen and watching the others
      spectateName: '',
    };
  }

  /** Completely fresh run: every piece of per-run data is rebuilt here.
   *  `seed` fixes the level layout (multiplayer); omit it for a random tower. */
  function resetRun(seed) {
    platforms = [];
    hazards = [];
    particles = [];
    camY = H_MIN - H; // taller screens see extra sky; the bottom lines up the same everywhere
    lavaY = camY + H - LAVA_MIN_VISIBLE;
    shake = 0;
    flash = 0;
    run = newRunData();

    const start = makePlatform('normal', W / 2 - 90, START_Y, 180);
    start.visited = true;
    platforms.push(start);
    player = makePlayer(W / 2 - PLAYER_W / 2, START_Y - PLAYER_H);
    player.ground = start;

    const s = seed === undefined ? Math.floor(Math.random() * 4294967296) : seed;
    gen = { rng: seededRandom(s), cols: makeColumns() };
    generatePlatforms();
    updateHud(true);
  }

  /* ==================================================================
     7. PROCEDURAL GENERATION
     The world is split into side-by-side columns (just one on narrow
     screens, 2-3 on wide ones). Each column is its own tower: platforms are
     generated one at a time upward, each within a jump-reachable distance
     of the one before, so every column always has a valid route up.
     ================================================================== */
  function makeColumns() {
    const k = Math.max(1, Math.floor(W / 380));
    const cols = [];
    for (let i = 0; i < k; i++) {
      const x0 = (W * i) / k;
      const x1 = (W * (i + 1)) / k;
      cols.push({
        x0, x1,
        lastCx: clamp(W / 2, x0 + 90, x1 - 90), // start each tower as close to the start platform as it can
        lastY: START_Y, lastType: 'normal', count: 0, unsafeRun: 0, sinceHazard: 0,
      });
    }
    return cols;
  }

  /** Keep generating until every column reaches 520 px above the screen.
   *  Always extending the lowest column first keeps the order (and therefore
   *  the seeded tower) identical on every player's machine. */
  function generatePlatforms() {
    for (;;) {
      let col = null;
      for (const c of gen.cols) if (!col || c.lastY > col.lastY) col = c;
      if (col.lastY <= camY - 520) break;
      addPlatform(col);
    }
  }

  function addPlatform(col) {
    // All randomness here comes from the seeded generator, so a given seed
    // (and world width) always builds exactly the same tower.
    const R = gen.rng;
    const rand = (a, b) => a + R() * (b - a);
    const heightM = (START_Y - col.lastY) / 10;
    // Use a slightly lower height so new mechanics appear roughly when the
    // player (who is a few platforms below the generator) reaches that stage.
    const stage = stageForHeight(heightM - 45);
    const d = Math.min(stage, 9);
    const learning = col.count < 4;

    // ---- choose platform type ----
    let type = 'normal';
    if (!learning) {
      const unstableAllowed = col.unsafeRun === 0; // never two unstable platforms in a row
      type = weightedPick({
        normal: Math.max(45, 100 - d * 7),
        moving: stage >= 2 ? 16 + d * 3 : 0,
        bouncy: stage >= 2 ? 7 : 0,
        vanish: stage >= 4 && unstableAllowed ? 10 + (d - 4) * 3 : 0,
        crumble: stage >= 5 && unstableAllowed ? 9 + (d - 5) * 3 : 0,
      }, R);
    }

    // ---- decide whether this gap gets a hazard ----
    let hazardKind = null;
    if (stage >= 3 && col.sinceHazard >= 2 && !learning) {
      const movingInvolved = type === 'moving' || col.lastType === 'moving';
      if (R() < Math.min(0.55, 0.25 + 0.05 * (stage - 3)) && (!movingInvolved || stage >= 6)) {
        if (type === 'normal' && R() < 0.4) hazardKind = 'spikes';
        else hazardKind = stage >= 5 && R() < 0.4 ? 'orb' : 'saw';
      }
    }

    // ---- geometry: vertical gap, width, horizontal offset ----
    let dy = Math.min(rand(66, 80 + d * 7), 130);
    if (hazardKind === 'saw') dy = Math.max(dy, 94);
    if (hazardKind === 'orb') dy = Math.max(dy, 110); // orbs bob up and down, so they need a taller gap
    let w = rand(Math.max(64, 114 - d * 6), Math.max(86, 152 - d * 8));
    if (type === 'moving') w = Math.max(w, 92);
    if (hazardKind === 'spikes') w = Math.max(w, 124);

    // How far sideways a jump of this height can reliably travel (conservative).
    let dxMax = 150 - (dy - 66) * 0.55;
    if (type === 'moving' || col.lastType === 'moving') dxMax -= 40;

    const range = type === 'moving' ? rand(36, 56) : 0;
    const margin = w / 2 + range + 6;
    const lo = col.x0 + margin, hi = col.x1 - margin;
    let cx = col.lastCx + rand(-dxMax, dxMax);
    // add some variety: avoid stacking platforms perfectly on top of each other
    if (Math.abs(cx - col.lastCx) < 30) cx += (R() < 0.5 ? -1 : 1) * 40;
    // bounce off the column edges instead of sticking to them (never moves
    // the platform further from the previous one, so it stays reachable)
    if (cx < lo) cx = lo + (lo - cx);
    if (cx > hi) cx = hi - (cx - hi);
    cx = clamp(cx, lo, hi);

    const y = col.lastY - dy;
    const p = makePlatform(type, cx - w / 2, y, w);
    if (type === 'moving') {
      p.range = range;
      p.speed = rand(1.0, 1.5) + d * 0.08;
      p.phase = rand(0, Math.PI * 2);
      p.baseX = p.x;
      p.x = p.baseX + Math.sin(p.phase) * p.range;
    }

    // ---- hazards ----
    if (hazardKind === 'spikes') {
      p.spikes = { side: R() < 0.5 ? 0 : 1, w: 34 };
    } else if (hazardKind) {
      // Moving hazards sit in the middle of the gap, on the side of the
      // column AWAY from the direct route between the two platforms, and
      // never sweep closer than 60 px to that route or into a neighbouring column.
      const midX = (col.lastCx + cx) / 2;
      const zoneMid = (col.x0 + col.x1) / 2;
      const hx = clamp(midX < zoneMid ? midX + 190 : midX - 190, col.x0 + 60, col.x1 - 60);
      const hy = (col.lastY + y) / 2 - 14;
      const clear = Math.abs(hx - midX) - 60;
      const roll = rand(55, 75);
      const phase = rand(0, 6.28);
      if (hazardKind === 'saw') {
        let sweep = Math.min(roll, clear);
        if (col.x0 > 0) sweep = Math.min(sweep, hx - col.x0 - 22);
        if (col.x1 < W) sweep = Math.min(sweep, col.x1 - hx - 22);
        if (sweep >= 15) {
          hazards.push({ kind: 'saw', x: hx, y: hy, baseX: hx, baseY: hy, r: 16, range: sweep, speed: 1.4 + 0.12 * d, phase, ang: 0 });
        } else hazardKind = null;
      } else if (clear >= 0) {
        // keep the bobbing inside the open space between the upper platform's
        // underside and the head of a player standing on the lower one
        const oy = (col.lastY + y) / 2 - 10;
        const bob = clamp((col.lastY - PLAYER_H - (y + PLAT_H)) / 2 - 13 - 2, 6, 24);
        hazards.push({ kind: 'orb', x: hx, y: oy, baseX: hx, baseY: oy, r: 13, range: bob, speed: 2.2 + 0.1 * d, phase, ang: 0 });
      } else hazardKind = null;
    }

    platforms.push(p);
    col.sinceHazard = hazardKind ? 0 : col.sinceHazard + 1;
    col.unsafeRun = (type === 'vanish' || type === 'crumble') ? col.unsafeRun + 1 : 0;
    col.lastCx = cx;
    col.lastY = y;
    col.lastType = type;
    col.count++;
  }

  /** Remove platforms/hazards far below the camera (they can never matter again). */
  function cleanupWorld() {
    const limit = camY + H + 160;
    for (let i = platforms.length - 1; i >= 0; i--) {
      if (platforms[i].y > limit) platforms.splice(i, 1);
    }
    for (let i = hazards.length - 1; i >= 0; i--) {
      if (hazards[i].baseY > limit) hazards.splice(i, 1);
    }
  }

  /* ==================================================================
     8. UPDATE
     ================================================================== */
  function updatePlatforms(dt, time) {
    for (const p of platforms) {
      p.dx = 0;
      if (p.glow > 0) p.glow -= dt;
      if (p.bounceAnim > 0) p.bounceAnim = Math.max(0, p.bounceAnim - dt * 4);
      if (p.state === 'gone') continue;

      if (p.type === 'moving') {
        const nx = p.baseX + Math.sin(p.phase + time * p.speed) * p.range;
        p.dx = nx - p.x;
        p.x = nx;
      }
      if (p.state === 'crumbling' || p.state === 'vanishing') {
        p.timer -= dt;
        if (p.timer <= 0) breakPlatform(p);
      }
    }
  }

  function breakPlatform(p) {
    p.state = 'gone';
    if (player && player.ground === p) player.ground = null;
    const st = PLAT_STYLE[p.type];
    if (p.type === 'crumble') {
      for (let i = 0; i < 14; i++) {
        spawnParticle(p.x + rand(0, p.w), p.y + rand(0, p.h), rand(-60, 60), rand(-80, 40), rand(0.6, 1), rand(4, 8), st.color, { g: 1200, shape: 'rect' });
      }
      flash = Math.max(flash, 0.18);
      Sound.crack();
    } else {
      for (let i = 0; i < 12; i++) {
        spawnParticle(p.x + rand(0, p.w), p.y + p.h / 2, rand(-40, 40), rand(-60, 20), rand(0.4, 0.7), rand(2, 3.5), st.color, {});
      }
      flash = Math.max(flash, 0.08);
      Sound.vanish();
    }
  }

  function updateHazards(dt, time) {
    for (const h of hazards) {
      if (h.kind === 'saw') h.x = h.baseX + Math.sin(h.phase + time * h.speed) * h.range;
      else h.y = h.baseY + Math.sin(h.phase + time * h.speed) * h.range;
      h.ang += dt * (h.kind === 'saw' ? 7 : 2);
    }
  }

  /** Player movement, jumping, gravity and platform landing (one-way platforms). */
  function updatePlayer(dt) {
    const p = player;
    const wasGrounded = p.ground !== null;

    // ---- horizontal movement with acceleration + friction ----
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir !== 0) {
      let accel = wasGrounded ? PHYS.groundAccel : PHYS.airAccel;
      if (Math.sign(p.vx) === -dir) accel *= 1.6; // snappy turnarounds
      p.vx += dir * accel * dt;
      p.face = dir;
    } else {
      const fr = (wasGrounded ? PHYS.groundFriction : PHYS.airFriction) * dt;
      p.vx = Math.abs(p.vx) <= fr ? 0 : p.vx - Math.sign(p.vx) * fr;
    }
    p.vx = clamp(p.vx, -PHYS.maxSpeed, PHYS.maxSpeed);

    if (p.ground) p.x += p.ground.dx; // ride moving platforms
    p.x += p.vx * dt;

    // Screen wrap: leaving one side brings you back on the other.
    const cx = p.x + p.w / 2;
    if (cx < 0) p.x += W;
    else if (cx > W) p.x -= W;

    // ---- jumping (only when grounded or within coyote time) ----
    p.coyote = wasGrounded ? PHYS.coyoteTime : Math.max(0, p.coyote - dt);
    if (input.jumpBuffer > 0) input.jumpBuffer -= dt;
    if (input.jumpBuffer > 0 && p.coyote > 0) {
      p.vy = -PHYS.jumpSpeed;
      p.ground = null;
      p.coyote = 0;
      p.bounced = false;
      input.jumpBuffer = 0;
      Sound.jump();
      for (let i = 0; i < 7; i++) {
        spawnParticle(p.x + p.w / 2 + rand(-8, 8), p.y + p.h, rand(-70, 70), rand(10, 70), rand(0.25, 0.45), rand(2, 3.5), COLORS.dust, {});
      }
    }

    // ---- gravity (heavier when jump released early = variable jump height) ----
    let g = PHYS.gravity;
    if (p.vy < 0 && !input.jumpHeld && !p.bounced) g *= PHYS.lowJumpGravity;
    p.vy = Math.min(p.vy + g * dt, PHYS.maxFall);
    if (p.vy >= 0) p.bounced = false;

    const prevBottom = p.y + p.h;
    p.y += p.vy * dt;
    p.ground = null;

    // ---- landing: only when falling and the feet crossed a platform top ----
    if (p.vy >= 0) {
      const bottom = p.y + p.h;
      let hit = null;
      for (const pl of platforms) {
        if (pl.state === 'gone') continue;
        if (prevBottom > pl.y + 2 || bottom < pl.y) continue;
        if (!overlapsX(p.x + 3, p.w - 6, pl.x, pl.w)) continue;
        if (!hit || pl.y < hit.y) hit = pl;
      }
      if (hit) landOn(hit, wasGrounded);
    }

    // ---- cosmetic animation state ----
    if (p.ground) p.runPhase += Math.abs(p.vx) * dt * 0.07;
    if (p.squash > 0) p.squash = Math.max(0, p.squash - dt * 6);
  }

  /** Horizontal overlap test that also checks the wrapped copies of the player. */
  function overlapsX(x, w, px, pw) {
    for (const off of [0, -W, W]) {
      if (x + off < px + pw && x + off + w > px) return true;
    }
    return false;
  }

  function landOn(pl, wasGrounded) {
    const p = player;
    const impact = p.vy;
    p.y = pl.y - p.h;
    p.vy = 0;
    p.ground = pl;

    if (!wasGrounded) {
      // fresh landing - feedback
      p.squash = clamp(impact / 1400, 0.15, 0.6);
      pl.glow = 0.3;
      spawnParticle(p.x + p.w / 2, pl.y, 0, 0, 0.35, 10, PLAT_STYLE[pl.type].color, { shape: 'ring' });
      for (let i = 0; i < 5; i++) {
        spawnParticle(p.x + p.w / 2 + rand(-10, 10), pl.y, rand(-90, 90), rand(-60, -10), rand(0.2, 0.4), rand(1.5, 3), PLAT_STYLE[pl.type].color, { g: 300 });
      }
      if (pl.type !== 'bouncy') Sound.land();

      if (!pl.visited) {
        pl.visited = true;
        run.platformsLanded++;
        run.bonus += 5;
        spawnParticle(p.x + p.w / 2, pl.y - 40, 0, -45, 0.8, 14, COLORS.yellow, { shape: 'text', text: '+5' });
      }
    }

    switch (pl.type) {
      case 'bouncy':
        p.vy = -PHYS.bounceSpeed;
        p.ground = null;
        p.coyote = 0;
        p.bounced = true;
        pl.bounceAnim = 1;
        Sound.bounce();
        for (let i = 0; i < 10; i++) {
          spawnParticle(p.x + p.w / 2 + rand(-12, 12), pl.y, rand(-60, 60), rand(-220, -80), rand(0.3, 0.6), rand(2, 3.5), PLAT_STYLE.bouncy.color, { g: 400 });
        }
        break;
      case 'crumble':
        if (pl.state === 'idle') { pl.state = 'crumbling'; pl.timer = 0.5; }
        break;
      case 'vanish':
        if (pl.state === 'idle') { pl.state = 'vanishing'; pl.timer = 0.85; }
        break;
    }
  }

  /** Hazard collision uses a slightly shrunken player hitbox so deaths feel fair. */
  function checkHazards() {
    const p = player;
    const hx = p.x + 4, hy = p.y + 4, hw = p.w - 8, hh = p.h - 6;
    for (const off of [0, -W, W]) {
      const x = hx + off;
      for (const h of hazards) {
        const nx = clamp(h.x, x, x + hw);
        const ny = clamp(h.y, hy, hy + hh);
        const r = h.r * 0.85;
        if ((h.x - nx) ** 2 + (h.y - ny) ** 2 < r * r) return die('hazard');
      }
      for (const pl of platforms) {
        if (!pl.spikes || pl.state === 'gone') continue;
        const sx = pl.x + (pl.spikes.side === 0 ? 0 : pl.w - pl.spikes.w) + 3;
        const sy = pl.y - 11;
        if (x < sx + pl.spikes.w - 6 && x + hw > sx && hy < pl.y && hy + hh > sy) return die('spikes');
      }
    }
  }

  function lavaSpeed() {
    return Math.min(12 + run.stage * 6, 70); // px per second
  }

  /** The floor rises slowly (after a short grace period) and is always kept
   *  on screen, so falling off the bottom of the view means touching it. */
  function updateLava(dt) {
    if (run.time > 4 && !run.dead) lavaY -= lavaSpeed() * dt;
    lavaY = Math.min(lavaY, camY + H - LAVA_MIN_VISIBLE);
  }

  function checkLava() {
    // Real collision: the player's feet passing the lava surface ends the run.
    if (player.y + player.h > lavaY + 3) die('lava');
  }

  /** Camera only moves up, smoothly, keeping the player in the lower-middle. */
  function updateCamera(dt) {
    const target = player.y - H * 0.58;
    if (target < camY) camY += (target - camY) * Math.min(1, dt * 7);
  }

  function updateScore() {
    const h = Math.max(0, START_Y - (player.y + player.h));
    if (h > run.maxHeightPx) run.maxHeightPx = h;
    run.heightM = Math.floor(run.maxHeightPx / 10);
    // Height is the main source of points; first landing on each platform gives +5.
    run.score = run.heightM + run.bonus;

    const st = stageForHeight(run.heightM);
    if (st > run.stage) {
      run.stage = st;
      showToast('STAGE ' + st + ' · ' + (STAGE_INFO[st] || 'FASTER!'));
      ui.hudStage.classList.remove('flash');
      void ui.hudStage.offsetWidth;
      ui.hudStage.classList.add('flash');
      Sound.stage();
    }

    if (!run.celebrated && run.prevBest > 0 && run.score > run.prevBest) {
      run.celebrated = true;
      showToast('NEW RECORD!', 'record');
      Sound.record();
      const colors = [COLORS.primary, COLORS.yellow, COLORS.steel, COLORS.text];
      for (let i = 0; i < 40; i++) {
        spawnParticle(player.x + player.w / 2, player.y, rand(-260, 260), rand(-420, -120), rand(0.8, 1.4), rand(3, 5), colors[i % 4], { g: 700, shape: 'rect' });
      }
    }
  }

  function die(cause) {
    if (run.dead) return;
    run.dead = true;
    run.deathTimer = 0;
    run.cause = cause;
    shake = 0.55;
    flash = 0.35;
    Sound.gameOver();
    const p = player;
    const color = cause === 'lava' ? COLORS.red : myLook.color;
    for (let i = 0; i < 36; i++) {
      spawnParticle(p.x + p.w / 2, p.y + p.h / 2, rand(-300, 300), rand(-420, 80), rand(0.6, 1.2), rand(2.5, 5), i % 3 ? color : COLORS.amber, { g: 900 });
    }
    p.visible = false;
  }

  /** One fixed-timestep update of the running game. */
  function stepPlaying(dt) {
    // Multiplayer "3, 2, 1, GO" - the world is frozen until it finishes.
    if (run.countdown > 0) {
      const before = Math.ceil(run.countdown);
      run.countdown -= dt;
      const after = Math.ceil(Math.max(0, run.countdown));
      if (after !== before) {
        if (after > 0) Sound.tick();
        else { Sound.go(); run.goFlash = 0.7; }
      }
      updateRemotes(dt);
      updateEffects(dt);
      return;
    }
    if (run.goFlash > 0) run.goFlash -= dt;

    run.clock += dt;
    if (!run.dead) run.time += dt;
    updatePlatforms(dt, run.clock);
    updateHazards(dt, run.clock);
    updateRemotes(dt);

    if (!run.dead) {
      updateLava(dt);
      updatePlayer(dt);
      checkHazards();
      if (!run.dead) checkLava();
      updateCamera(dt);
      updateScore();
    } else {
      run.deathTimer += dt;
      if (run.spectating) updateSpectate(dt);
      else if (run.deathTimer > 0.9) {
        if (mode === 'multi') enterSpectate();
        else endRun();
      }
    }
    if (state === 'playing') {
      generatePlatforms();
      cleanupWorld();
    }
    updateEffects(dt);
  }

  /* ==================================================================
     9. PARTICLES & EFFECTS
     ================================================================== */
  const MAX_PARTICLES = 350;

  function spawnParticle(x, y, vx, vy, life, size, color, opts) {
    if (particles.length >= MAX_PARTICLES) return;
    particles.push({ x, y, vx, vy, life, max: life, size, color, g: opts.g || 0, shape: opts.shape || 'dot', text: opts.text || '' });
  }

  function updateEffects(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.life -= dt;
      if (q.life <= 0) {
        // swap-remove: O(1) and no new arrays
        particles[i] = particles[particles.length - 1];
        particles.pop();
        continue;
      }
      q.vy += q.g * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
    }
    if (shake > 0) shake = Math.max(0, shake - dt);
    if (flash > 0) flash = Math.max(0, flash - dt * 1.6);

    // occasional sparks rising from the alarm floor (in-game only)
    if ((state === 'playing' || state === 'gameover') && Math.random() < dt * 9) {
      spawnParticle(rand(0, W), lavaY + 4, rand(-10, 10), rand(-70, -30), rand(0.6, 1.3), rand(1.5, 3), Math.random() < 0.5 ? COLORS.red : COLORS.amber, {});
    }
  }

  function showToast(text, cls) {
    ui.toast.textContent = text;
    ui.toast.className = 'toast show' + (cls ? ' ' + cls : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1900);
  }

  /* ==================================================================
     10. JAIL CELL (menu + lobby) and the ESCAPE CUTSCENE
     The menu and the multiplayer lobby show the prisoner(s) pacing inside a
     cell. Starting a game plays a short escape: the alarm goes off, the bars
     slide open, everyone sprints down the cell-block corridor (pseudo-3D:
     points are projected with a simple perspective camera), and bursts out
     into daylight - then the game begins.
     ================================================================== */
  const CELL_SCALE = 2;                 // prisoners are drawn twice as big in the cell
  const cell = { cast: new Map() };     // key -> pacing prisoner ('me' = the local player)

  /** Screens that show the cell behind their menu. */
  const isCellState = () => state === 'menu' || state === 'help' || state === 'mp' || state === 'lobby';

  function cellFloorY() { return H - Math.max(46, H * 0.075); }

  function initMenuScene() {
    worldLock = 0; // no run any more: the world follows the screen size again
    resize();
    run = newRunData();
    particles = [];
    hazards = [];
    platforms = [];
    camY = 0;
    lavaY = H + 100;
    shake = 0;
    flash = 0;
    player = makePlayer(0, 0);
    syncCell();
  }

  /** The fields drawPlayer() needs to animate a prisoner. */
  function makeSprite() {
    return { w: PLAYER_W, h: PLAYER_H, vx: 0, vy: 0, face: 1, ground: true, runPhase: Math.random() * 6, squash: 0 };
  }

  /** Who is in the cell: just you, or everyone in the multiplayer lobby. */
  function cellEntries() {
    if (mode === 'multi' && mp.players.length) {
      return mp.players.map((p) => ({ key: p.id === mp.myId ? 'me' : p.id, name: p.name, look: lookFor(p.color) }));
    }
    return [{ key: 'me', name: '', look: LOOKS[0] }];
  }

  function syncCell() {
    const entries = cellEntries();
    const keys = new Set(entries.map((e) => e.key));
    for (const k of [...cell.cast.keys()]) if (!keys.has(k)) cell.cast.delete(k);
    for (const e of entries) {
      let pr = cell.cast.get(e.key);
      if (!pr) {
        pr = { ...makeSprite(), x: rand(80, Math.max(90, W - 80)), tx: 0, wait: rand(0.2, 1.5) };
        pr.tx = pr.x;
        cell.cast.set(e.key, pr);
        // a puff of dust when someone new lands in the cell
        for (let i = 0; i < 14; i++) {
          spawnParticle(pr.x, cellFloorY() - 20, rand(-90, 90), rand(-120, -20), rand(0.4, 0.8), rand(3, 6), COLORS.dust, { g: 300 });
        }
      }
      pr.key = e.key;
      pr.name = e.name;
      pr.look = e.look;
    }
  }

  /** Prisoners wander around the cell, stop, and sometimes turn to face you. */
  function stepCell(dt) {
    syncCell();
    updateEffects(dt);
    const minX = 50, maxX = Math.max(60, W - 50);
    for (const pr of cell.cast.values()) {
      pr.x = clamp(pr.x, minX, maxX);
      if (pr.wait > 0) {
        pr.wait -= dt;
        pr.vx = 0;
        if (pr.wait <= 0) pr.tx = rand(minX, maxX);
      } else {
        const dx = pr.tx - pr.x;
        if (Math.abs(dx) < 4) {
          pr.wait = rand(0.6, 2.6);
          if (Math.random() < 0.5) pr.face = 0; // look out through the bars
        } else {
          pr.face = Math.sign(dx);
          pr.vx = Math.sign(dx) * 200;           // only drives the walking animation
          pr.x += Math.sign(dx) * Math.min(Math.abs(dx), 85 * dt);
          pr.runPhase += dt * 9;
        }
      }
    }
  }

  /** Draw a prisoner with its feet at (sx, footY), `scale` times normal size. */
  function drawPrisoner(c, p, look, sx, footY, scale, alpha = 1) {
    c.save();
    c.translate(sx, footY);
    c.scale(scale, scale);
    drawPlayer(c, p, -p.w / 2, -p.h, look, alpha);
    c.restore();
  }

  function cellNameTag(c, text, color, x, y) {
    c.save();
    c.font = 'bold 13px "Trebuchet MS", sans-serif';
    c.textAlign = 'center';
    const w = c.measureText(text).width + 14;
    c.fillStyle = 'rgba(8,9,11,0.78)';
    roundRect(c, x - w / 2, y - 14, w, 19, 6);
    c.fill();
    c.fillStyle = color;
    c.fillText(text, x, y);
    c.restore();
  }

  /** The cell itself. `alarmT` (seconds) turns on the spinning red alarm light. */
  function drawCellRoom(c, alarmT) {
    const t = visualTime;
    const fy = cellFloorY();

    // back wall with bricks, dark at the top
    c.fillStyle = '#1C1F24';
    c.fillRect(0, 0, W, fy);
    c.strokeStyle = 'rgba(255,255,255,0.05)';
    c.lineWidth = 1;
    c.beginPath();
    for (let r = 0, y = 0; y < fy; r++, y += 26) {
      c.moveTo(0, y); c.lineTo(W, y);
      for (let x = (r & 1) ? -28 : 0; x < W; x += 56) { c.moveTo(x, y); c.lineTo(x, Math.min(y + 26, fy)); }
    }
    c.stroke();
    const shade = c.createLinearGradient(0, 0, 0, fy);
    shade.addColorStop(0, 'rgba(0,0,0,0.55)');
    shade.addColorStop(1, 'rgba(0,0,0,0.05)');
    c.fillStyle = shade;
    c.fillRect(0, 0, W, fy);

    // barred window with a shaft of moonlight
    const wx = W * 0.7 - 55, wy = H * 0.1;
    c.fillStyle = 'rgba(170,190,255,0.07)';
    c.beginPath();
    c.moveTo(wx, wy + 72); c.lineTo(wx + 110, wy + 72); c.lineTo(wx + 40, fy); c.lineTo(wx - 110, fy);
    c.closePath();
    c.fill();
    c.fillStyle = '#0B0C0F';
    c.fillRect(wx - 6, wy - 6, 122, 84);
    const moon = c.createLinearGradient(0, wy, 0, wy + 72);
    moon.addColorStop(0, '#2A3A55');
    moon.addColorStop(1, '#17202F');
    c.fillStyle = moon;
    c.fillRect(wx, wy, 110, 72);
    c.fillStyle = 'rgba(220,230,255,0.6)';
    c.beginPath(); c.arc(wx + 80, wy + 22, 8, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#3B4048';
    for (let b = 1; b < 6; b++) c.fillRect(wx + b * 18.3 - 2, wy, 4, 72);
    c.fillRect(wx, wy + 34, 110, 4);

    // tally marks scratched into the wall
    c.strokeStyle = 'rgba(235,230,215,0.3)';
    c.lineWidth = 2;
    c.beginPath();
    for (let g = 0; g < 4; g++) {
      const gx = W * 0.18 + g * 38, gy = H * 0.3;
      for (let i = 0; i < 4; i++) { c.moveTo(gx + i * 6, gy); c.lineTo(gx + i * 6 + 1, gy + 26); }
      c.moveTo(gx - 4, gy + 20); c.lineTo(gx + 24, gy + 6);
    }
    c.stroke();

    // bunk bed (left)
    const bx = Math.max(16, W * 0.04), bw = 190;
    c.fillStyle = '#5A616C';
    c.fillRect(bx, fy - 150, 6, 150);
    c.fillRect(bx + bw - 6, fy - 150, 6, 150);
    for (const by of [fy - 130, fy - 58]) {
      c.fillStyle = '#4A5059';
      c.fillRect(bx, by + 14, bw, 6);
      c.fillStyle = '#CFC8B4';
      roundRect(c, bx + 4, by, bw - 8, 16, 5); c.fill();
      c.fillStyle = 'rgba(70,90,140,0.3)';
      for (let sx = bx + 12; sx < bx + bw - 10; sx += 12) c.fillRect(sx, by + 3, 4, 11);
      c.fillStyle = '#EDE9DD';
      roundRect(c, bx + 10, by - 7, 42, 11, 5); c.fill();
    }

    // steel toilet + sink (right)
    const tx = W - Math.max(16, W * 0.04) - 70;
    c.fillStyle = '#9AA3AE';
    roundRect(c, tx + 8, fy - 96, 46, 12, 4); c.fill();
    c.fillRect(tx + 26, fy - 84, 10, 24);
    c.fillStyle = '#8D96A1';
    c.fillRect(tx + 40, fy - 70, 22, 34);
    c.fillStyle = '#B8C0CA';
    roundRect(c, tx, fy - 40, 58, 14, 6); c.fill();
    c.fillStyle = '#8D96A1';
    c.fillRect(tx + 14, fy - 28, 30, 28);

    // swinging light bulb
    const ax = W * 0.42, len = H * 0.22, ang = Math.sin(t * 1.3) * 0.12;
    const lx = ax + Math.sin(ang) * len, ly = Math.cos(ang) * len;
    const glow = c.createRadialGradient(lx, ly, 2, lx, ly, H * 0.5);
    glow.addColorStop(0, 'rgba(255,220,140,0.22)');
    glow.addColorStop(1, 'rgba(255,220,140,0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, W, fy);
    c.strokeStyle = '#2A2D33';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(ax, 0); c.lineTo(lx, ly); c.stroke();
    c.fillStyle = '#FFE6A8';
    c.beginPath(); c.arc(lx, ly + 6, 7, 0, Math.PI * 2); c.fill();

    // concrete floor
    c.fillStyle = '#25282E';
    c.fillRect(0, fy, W, H - fy);
    c.fillStyle = 'rgba(255,255,255,0.08)';
    c.fillRect(0, fy, W, 2);
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 30; x < W + 30; x += 90) { c.moveTo(x, fy + 2); c.lineTo(x - 30, H); }
    c.stroke();

    // alarm: spinning red beacon
    if (alarmT !== undefined) {
      const cx = W / 2;
      c.save();
      const beam = c.createRadialGradient(cx, 10, 4, cx, 10, Math.max(W, H));
      beam.addColorStop(0, 'rgba(255,40,40,0.5)');
      beam.addColorStop(1, 'rgba(255,40,40,0)');
      c.fillStyle = beam;
      for (const off of [0, Math.PI]) {
        const a = alarmT * 7 + off;
        c.beginPath();
        c.moveTo(cx, 10);
        c.lineTo(cx + Math.cos(a - 0.3) * W, 10 + Math.abs(Math.sin(a - 0.3)) * H);
        c.lineTo(cx + Math.cos(a + 0.3) * W, 10 + Math.abs(Math.sin(a + 0.3)) * H);
        c.closePath();
        c.fill();
      }
      c.restore();
      c.fillStyle = COLORS.red;
      c.beginPath(); c.arc(cx, 10, 9, 0, Math.PI * 2); c.fill();
    }
  }

  /** The cell's front bars (in front of everything). `offset` slides the gate. */
  function drawCellBars(c, offset) {
    const fy = cellFloorY();
    const cy = fy * 0.58;
    c.save();
    c.translate(offset, 0);
    c.fillStyle = '#2E3238';
    c.fillRect(0, 0, W, 12);
    c.fillRect(0, cy, W, 8);
    c.fillRect(0, H - 10, W, 10);
    for (let x = 18; x < W; x += 64) {
      c.fillStyle = '#3A3F47';
      c.fillRect(x, 0, 8, H);
      c.fillStyle = 'rgba(255,255,255,0.16)';
      c.fillRect(x + 1, 0, 2, H);
    }
    c.fillStyle = '#4A5059';
    c.fillRect(W - 64, cy - 16, 34, 40);           // lock box
    c.fillStyle = COLORS.yellow;
    c.fillRect(W - 51, cy, 8, 8);
    c.restore();
  }

  /** Menu / lobby: everyone pacing in the cell, behind the bars. */
  function renderCell(c) {
    drawCellRoom(c);
    const fy = cellFloorY();
    const list = [...cell.cast.values()].sort((a, b) => a.x - b.x);
    for (const pr of list) {
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.beginPath(); c.ellipse(pr.x, fy, 18, 4, 0, 0, Math.PI * 2); c.fill();
      drawPrisoner(c, pr, pr.look, pr.x, fy, CELL_SCALE);
    }
    drawParticles(c);
    drawCellBars(c, 0);
    if (mode === 'multi') {
      for (const pr of list) {
        cellNameTag(c, pr.name + (pr.key === 'me' ? ' (you)' : ''), pr.look.color, pr.x, fy - PLAYER_H * CELL_SCALE - 22);
      }
    }
  }

  // ---------------- the escape cutscene ----------------
  const ESC = { BREAK: 1.3, RUN_END: 4.3, END: 5.0 };   // timeline (seconds)
  const escape = { t: 0, cast: [], done: null, skippable: false, stepT: 0 };

  /** Play the escape with these prisoners, then call done(). */
  function playEscape(cast, done, skippable) {
    const n = cast.length;
    escape.t = 0;
    escape.stepT = 0;
    escape.done = done;
    escape.skippable = skippable;
    escape.cast = cast.map((e, i) => {
      const pr = cell.cast.get(e.key);
      return { ...e, idx: i, n, startX: pr ? pr.x : W / 2 + (i - (n - 1) / 2) * 90, p: makeSprite() };
    });
    clearInput();
    ui.toast.classList.remove('show');
    setState('escape');
    Sound.init();
    Sound.siren(ESC.END);
  }

  function finishEscape() {
    const done = escape.done;
    escape.done = null;
    if (done) done();
  }

  function skipEscape() {
    if (state !== 'escape' || !escape.skippable) return;
    Sound.stopSiren();
    finishEscape();
  }

  function stepEscape(dt) {
    if (escape.frozen) return; // test hook: __dttf.escapeAt()
    const prev = escape.t;
    escape.t += dt;
    const t = escape.t;
    const crossed = (mark) => prev < mark && t >= mark;
    if (crossed(0.55)) Sound.crack();                       // the bars give way
    if (t > ESC.BREAK && t < ESC.RUN_END + 0.3) {           // running footsteps
      escape.stepT -= dt;
      if (escape.stepT <= 0) { escape.stepT = 0.16; Sound.step(); }
    }
    if (crossed(ESC.RUN_END + 0.2)) Sound.record();         // made it out!
    updateEffects(dt);
    if (t >= ESC.END) finishEscape();
  }

  /** Big stencil caption across the middle of the screen. */
  function caption(c, text, y, size, color, alpha) {
    if (alpha <= 0) return;
    c.save();
    c.globalAlpha = alpha;
    c.font = size + 'px Impact, Haettenschweiler, "Arial Black", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = Math.max(2, size / 9);
    c.lineJoin = 'round'; // no sharp spikes on letter tips
    c.strokeStyle = 'rgba(0,0,0,0.85)';
    c.strokeText(text, W / 2, y);
    c.fillStyle = color;
    c.fillText(text, W / 2, y);
    c.restore();
  }

  function renderEscape(c) {
    const t = escape.t;
    if (t < ESC.BREAK) renderBreakout(c, t);
    else renderCorridor(c, t - ESC.BREAK);
    if (escape.skippable && t < ESC.END - 0.7) {
      c.save();
      c.font = 'bold 12px "Trebuchet MS", sans-serif';
      c.textAlign = 'center';
      c.fillStyle = 'rgba(241,241,238,0.55)';
      c.fillText('SPACE / TAP TO SKIP', W / 2, H - 18);
      c.restore();
    }
  }

  /** Part 1: alarm in the cell, the gate slides open, everyone sprints at you. */
  function renderBreakout(c, t) {
    const fy = cellFloorY();
    const amt = t < 0.6 ? 4 : 1.5;
    const go = clamp((t - 0.7) / (ESC.BREAK - 0.7), 0, 1);
    const ease = go * go;
    const bars = t < 0.55 ? Math.sin(t * 60) * 3 : -Math.pow((t - 0.55) / 0.5, 2) * (W + 80);

    c.save();
    c.translate(rand(-amt, amt), rand(-amt, amt));
    drawCellRoom(c, t);
    if (go > 0.3) drawCellBars(c, bars); // once they're through the gate, they're in front of it
    for (const r of escape.cast) {
      const p = r.p;
      p.face = 0;
      p.vx = go > 0 ? 300 : 0;
      p.runPhase = t * 18 + r.idx;
      const spread = (r.idx - (r.n - 1) / 2) * Math.min(150, (W * 0.7) / r.n);
      const sx = lerp(r.startX, W / 2 + spread * (1 + ease), ease);
      drawPrisoner(c, p, r.look, sx, fy + ease * H * 0.16, CELL_SCALE * (1 + ease * 2.6));
    }
    if (go <= 0.3) drawCellBars(c, bars);
    c.restore();

    c.fillStyle = 'rgba(255,20,20,' + (0.1 + 0.1 * Math.sin(t * 16)).toFixed(3) + ')';
    c.fillRect(0, 0, W, H);
    caption(c, 'LOCKDOWN BREACH!', H * 0.17, Math.round(Math.min(W, 900) * 0.085 * (1 + 0.05 * Math.sin(t * 20))),
      COLORS.red, Math.sin(t * 12) > -0.3 ? 1 : 0.45);
    const white = clamp((t - (ESC.BREAK - 0.22)) / 0.22, 0, 1);
    if (white > 0) {
      c.fillStyle = 'rgba(255,255,255,' + white.toFixed(3) + ')';
      c.fillRect(0, 0, W, H);
    }
  }

  /** Part 2: pseudo-3D run down the cell-block corridor, straight at the camera.
   *  World units: x across, y up, z into the screen; P() projects to the screen. */
  function renderCorridor(c, u) {
    const runEnd = ESC.RUN_END - ESC.BREAK;         // seconds of running
    const camZ = -u * 7;                             // the camera flies backwards...
    const camX = Math.sin(u * 2.1) * 0.18;
    const camH = 1.45 + Math.abs(Math.sin(u * 11)) * 0.07; // ...with a running bob
    const f = Math.min(W * 0.75, H);
    const hx = W / 2 + Math.sin(u * 1.7) * 6, hy = H * 0.45;
    const NEAR = 0.3, FAR = 64, CW = 2.4, CH = 3.3;
    const zn = camZ + NEAR, zf = camZ + FAR;
    const P = (x, y, z) => {
      const dz = Math.max(0.05, z - camZ);
      return [hx + ((x - camX) * f) / dz, hy + ((camH - y) * f) / dz, dz];
    };
    const quad = (a, b, d, e, fill) => {
      c.beginPath();
      c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(d[0], d[1]); c.lineTo(e[0], e[1]);
      c.closePath();
      c.fillStyle = fill;
      c.fill();
    };

    // corridor box: floor, ceiling, walls
    c.fillStyle = '#060708';
    c.fillRect(0, 0, W, H);
    quad(P(-CW, 0, zn), P(CW, 0, zn), P(CW, 0, zf), P(-CW, 0, zf), '#2B2E34');
    quad(P(-CW, CH, zn), P(CW, CH, zn), P(CW, CH, zf), P(-CW, CH, zf), '#17191D');
    quad(P(-CW, 0, zn), P(-CW, CH, zn), P(-CW, CH, zf), P(-CW, 0, zf), '#32363D');
    quad(P(CW, 0, zn), P(CW, CH, zn), P(CW, CH, zf), P(CW, 0, zf), '#2C3036');

    // seams every 2 units rushing past - this is what sells the speed
    c.lineWidth = 1.5;
    for (let z = Math.ceil(zn / 2) * 2; z < zf; z += 2) {
      const a = clamp(1 - (z - camZ) / FAR, 0, 1) * 0.55;
      const l0 = P(-CW, 0, z), r0 = P(CW, 0, z), l1 = P(-CW, CH, z), r1 = P(CW, CH, z);
      c.strokeStyle = 'rgba(0,0,0,' + a.toFixed(3) + ')';
      c.beginPath();
      c.moveTo(l1[0], l1[1]); c.lineTo(l0[0], l0[1]); c.lineTo(r0[0], r0[1]); c.lineTo(r1[0], r1[1]);
      c.stroke();
    }

    // barred cell doors along both walls
    for (let z = Math.floor(zn / 6) * 6; z < zf; z += 6) {
      for (const side of [-1, 1]) {
        const x = side * CW, z0 = z - 1 + (side > 0 ? 3 : 0), z1 = z0 + 2;
        if (z0 < zn) continue;
        quad(P(x, 0, z0), P(x, 2.4, z0), P(x, 2.4, z1), P(x, 0, z1), '#121417');
        c.strokeStyle = '#5A616C';
        c.lineWidth = Math.max(1, (0.05 * f) / (z0 - camZ));
        c.beginPath();
        for (let k = 0; k <= 6; k++) {
          const zz = z0 + (k / 6) * 2;
          const a = P(x, 0, zz), b = P(x, 2.4, zz);
          c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
        }
        const m0 = P(x, 1.2, z0), m1 = P(x, 1.2, z1);
        c.moveTo(m0[0], m0[1]); c.lineTo(m1[0], m1[1]);
        c.stroke();
      }
    }

    // ceiling lamps with pools of light on the floor
    for (let z = Math.floor(zn / 6) * 6 + 3; z < zf; z += 6) {
      if (z < zn) continue;
      const dz = z - camZ, fade = clamp(1 - dz / FAR, 0, 1);
      const pool = P(0, 0, z), rx = (1.7 * f) / dz, ry = (0.55 * f) / dz;
      const g = c.createRadialGradient(pool[0], pool[1], 0, pool[0], pool[1], rx);
      g.addColorStop(0, 'rgba(255,225,150,' + (0.35 * fade).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,225,150,0)');
      c.save();
      c.translate(pool[0], pool[1]);
      c.scale(1, ry / rx);
      c.fillStyle = g;
      c.beginPath(); c.arc(0, 0, rx, 0, Math.PI * 2); c.fill();
      c.restore();
      const lamp = P(0, CH - 0.05, z);
      c.fillStyle = 'rgba(255,236,190,' + (0.9 * fade).toFixed(3) + ')';
      c.fillRect(lamp[0] - (0.5 * f) / dz, lamp[1] - 2, f / dz, Math.max(2, (0.08 * f) / dz));
    }

    // red alarm beacons on the walls
    const blink = Math.sin(u * 14) > 0;
    for (let z = Math.floor(zn / 12) * 12 + 6; z < zf; z += 12) {
      if (z < zn) continue;
      for (const side of [-1, 1]) {
        const b = P(side * (CW - 0.02), 2.9, z), r = Math.max(1.5, (0.14 * f) / b[2]);
        if (blink) {
          const gg = c.createRadialGradient(b[0], b[1], 0, b[0], b[1], r * 6);
          gg.addColorStop(0, 'rgba(255,40,40,0.35)');
          gg.addColorStop(1, 'rgba(255,40,40,0)');
          c.fillStyle = gg;
          c.beginPath(); c.arc(b[0], b[1], r * 6, 0, Math.PI * 2); c.fill();
        }
        c.fillStyle = blink ? 'rgba(255,50,50,0.95)' : 'rgba(120,20,20,0.9)';
        c.beginPath(); c.arc(b[0], b[1], r, 0, Math.PI * 2); c.fill();
      }
    }

    // darkness swallowing the far end...
    const fog = c.createRadialGradient(hx, hy, 0, hx, hy, H * 0.55);
    fog.addColorStop(0, 'rgba(3,3,4,0.95)');
    fog.addColorStop(0.35, 'rgba(3,3,4,0.55)');
    fog.addColorStop(1, 'rgba(3,3,4,0)');
    c.fillStyle = fog;
    c.fillRect(0, 0, W, H);

    // ...with the guards' flashlights sweeping out of it
    for (let i = 0; i < 2; i++) {
      const ox = hx + (i ? 18 : -18), oy = hy + 8, len = H * 0.95, sp = 0.2;
      const ang = Math.PI / 2 + (i ? 0.6 : -0.6) + Math.sin(u * 2.2 + i * 1.7) * 0.45;
      const g = c.createRadialGradient(ox, oy, 0, ox, oy, len);
      g.addColorStop(0, 'rgba(255,240,180,0.3)');
      g.addColorStop(1, 'rgba(255,240,180,0)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(ox, oy);
      c.lineTo(ox + Math.cos(ang - sp) * len, oy + Math.sin(ang - sp) * len);
      c.lineTo(ox + Math.cos(ang + sp) * len, oy + Math.sin(ang + sp) * len);
      c.closePath();
      c.fill();
    }

    // the prisoners, running straight at you (far ones first)
    const burst = clamp((u - (runEnd - 0.5)) / 0.7, 0, 1); // final dash past the camera
    const runners = escape.cast.map((r) => {
      const spacing = Math.min(1.15, 3.6 / r.n);
      const x = (r.idx - (r.n - 1) / 2) * spacing + Math.sin(u * 3 + r.idx) * 0.12;
      const lag = (r.idx % 2) * 1.2 + (r.idx % 3) * 0.4;
      const ahead = 6 + lag + Math.sin(u * 2 + r.idx) * 0.3 - u * 0.35;
      return { r, x, z: camZ + lerp(ahead, -0.4, burst * burst) };
    }).sort((a, b) => b.z - a.z);
    for (const { r, x, z } of runners) {
      const dz = z - camZ;
      if (dz < 0.45) continue;
      const foot = P(x, 0, z);
      const scale = (1.75 * f) / dz / PLAYER_H;
      c.fillStyle = 'rgba(0,0,0,0.4)';
      c.beginPath(); c.ellipse(foot[0], foot[1], (0.45 * f) / dz, (0.12 * f) / dz, 0, 0, Math.PI * 2); c.fill();
      const p = r.p;
      p.face = 0;
      p.vx = 300;
      p.runPhase = u * 16 + r.idx * 1.7;
      drawPrisoner(c, p, r.look, foot[0], foot[1], scale);
      if (mode === 'multi' && r.name) {
        cellNameTag(c, r.name + (r.key === 'me' ? ' (you)' : ''), r.look.color, foot[0], foot[1] - PLAYER_H * scale - 14);
      }
    }

    c.fillStyle = 'rgba(255,20,20,' + (blink ? 0.08 : 0.03) + ')';
    c.fillRect(0, 0, W, H);
    caption(c, 'RUN!', H * 0.2, Math.round(Math.min(W, 900) * 0.16 * (1 + Math.max(0, 0.8 - u) * 0.3)),
      COLORS.yellow, clamp((0.8 - u) / 0.3, 0, 1));

    // fade in from the breakout's white flash
    if (u < 0.25) {
      c.fillStyle = 'rgba(255,255,255,' + (1 - u / 0.25).toFixed(3) + ')';
      c.fillRect(0, 0, W, H);
    }
    // daylight floods in as they burst out
    const day = clamp((u - (runEnd - 0.1)) / 0.45, 0, 1);
    if (day > 0) {
      c.fillStyle = 'rgba(255,248,225,' + day.toFixed(3) + ')';
      c.fillRect(0, 0, W, H);
      caption(c, 'ESCAPED!', H * 0.45, Math.round(Math.min(W, 900) * 0.15), COLORS.primary, clamp((u - runEnd) / 0.25, 0, 1));
    }
  }

  /* ==================================================================
     11. RENDERING
     ================================================================== */
  function initStars() {
    for (let i = 0; i < 160; i++) {
      // x and y are stored as 0..1 so the dust fills the view whatever its size
      stars.push({ x: Math.random(), y: Math.random(), z: rand(0.1, 1), tw: rand(0, 6.28), s: rand(0.6, 1.8) });
    }
  }

  function render() {
    const c = ctx;
    c.setTransform(viewScale, 0, 0, viewScale, 0, 0);
    if (state === 'escape') { renderEscape(c); return; }
    if (isCellState()) { renderCell(c); return; }
    drawBackground(c);

    c.save();
    if (shake > 0) {
      const a = shake * 18;
      c.translate(rand(-a, a), rand(-a, a));
    }
    c.translate(0, -camY);
    for (const p of platforms) {
      if (p.state === 'gone' || p.y - camY > H + 40 || p.y - camY < -60) continue;
      drawPlatform(c, p);
    }
    for (const h of hazards) {
      if (h.y - camY > H + 40 || h.y - camY < -60) continue;
      drawHazard(c, h);
    }
    // other players are drawn as see-through ghosts behind you
    for (const r of remotes.values()) {
      if (!r.alive) continue;
      drawPlayerWrapped(c, r, r.look, 0.5);
      drawNameTag(c, r);
    }
    if (player && player.visible) drawPlayerWrapped(c, player, myLook, 1);
    drawParticles(c);
    drawFloor(c);
    c.restore();

    drawDangerVignette(c);
    if (mode === 'multi' && state === 'playing') drawOffscreenPlayers(c);
    drawCountdown(c);
    if (flash > 0) {
      c.fillStyle = 'rgba(255,255,255,' + (flash * 0.6).toFixed(3) + ')';
      c.fillRect(0, 0, W, H);
    }
  }

  /** Draw a character, plus a second copy when it is wrapping across a screen edge. */
  function drawPlayerWrapped(c, p, look, alpha) {
    drawPlayer(c, p, p.x, p.y, look, alpha);
    if (p.x < 0) drawPlayer(c, p, p.x + W, p.y, look, alpha);
    else if (p.x + p.w > W) drawPlayer(c, p, p.x - W, p.y, look, alpha);
  }

  function drawNameTag(c, r) {
    c.save();
    c.font = 'bold 11px "Trebuchet MS", sans-serif';
    c.textAlign = 'center';
    c.fillStyle = r.look.color;
    c.globalAlpha = 0.85;
    const x = clamp(r.x + r.w / 2, 24, W - 24);
    c.fillText(r.name, x, r.y - 19);
    c.restore();
  }

  // Where the HUD bar and the scoreboard sit, in world units (kept up to date
  // by measureHud) so the off-screen arrows never hide underneath them.
  const hudBox = { barBottom: 96, boardLeft: W, boardBottom: 0 };

  function measureHud() {
    const st = stageEl.getBoundingClientRect();
    if (!st.width) return;
    const k = W / st.width;
    const bar = ui.hudBar.getBoundingClientRect();
    hudBox.barBottom = (bar.bottom - st.top) * k - 16; // the bottom of the bar is a soft fade
    const b = ui.mpBoardWrap.getBoundingClientRect();
    if (b.width) {
      hudBox.boardLeft = (b.left - st.left) * k;
      hudBox.boardBottom = (b.bottom - st.top) * k;
    } else {
      hudBox.boardLeft = W;
      hudBox.boardBottom = 0;
    }
  }

  /** Little arrows at the top/bottom edge pointing at players you can't see. */
  function drawOffscreenPlayers(c) {
    c.save();
    c.font = 'bold 10px "Trebuchet MS", sans-serif';
    c.textAlign = 'center';
    for (const r of remotes.values()) {
      if (!r.alive) continue;
      const sy = r.y - camY;
      const above = sy + r.h < hudBox.barBottom;   // hidden behind the HUD or above the view
      const below = sy > H - 20;
      if (!above && !below) continue;
      const x = clamp(r.x + r.w / 2, 18, W - 18);
      let y = above ? hudBox.barBottom + 16 : H - 66;
      if (above && x > hudBox.boardLeft - 40) y = Math.max(y, hudBox.boardBottom + 16);
      const dir = above ? -1 : 1;
      c.globalAlpha = 0.85;
      c.fillStyle = r.look.color;
      c.beginPath();
      c.moveTo(x, y + dir * 8);
      c.lineTo(x - 6, y);
      c.lineTo(x + 6, y);
      c.fill();
      const diff = r.height - run.heightM;
      c.fillText(r.name + ' ' + (diff >= 0 ? '+' : '') + diff + 'm', x, y - dir * 10 + (above ? 4 : 0));
    }
    c.restore();
  }

  /** "3, 2, 1, GO!" at the start of a multiplayer round. */
  function drawCountdown(c) {
    if (state !== 'playing' || !run || (run.countdown <= 0 && run.goFlash <= 0)) return;
    const counting = run.countdown > 0;
    const txt = counting ? String(Math.ceil(run.countdown)) : 'GO!';
    const frac = counting ? run.countdown % 1 : clamp(run.goFlash / 0.7, 0, 1);
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = '900 ' + Math.round(80 + frac * 40) + 'px "Trebuchet MS", sans-serif';
    c.fillStyle = counting ? COLORS.text : COLORS.yellow;
    c.shadowColor = counting ? COLORS.primary : COLORS.yellow;
    c.shadowBlur = 30;
    c.globalAlpha = counting ? 1 : frac;
    c.fillText(txt, W / 2, H * 0.4);
    c.restore();
  }

  /** Prison wall: concrete bricks, barred windows, sweeping searchlights and a
   *  mugshot-style height chart. Layers scroll at different speeds (parallax). */
  function drawBackground(c) {
    c.fillStyle = COLORS.bg;
    c.fillRect(0, 0, W, H);
    const shade = c.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, 'rgba(0,0,0,0.45)');
    shade.addColorStop(1, 'rgba(40,44,52,0.25)');
    c.fillStyle = shade;
    c.fillRect(0, 0, W, H);

    // brick wall (parallax 0.35)
    const par = camY * 0.35;
    const BH = 22, BW = 48;
    c.strokeStyle = 'rgba(255,255,255,0.045)';
    c.lineWidth = 1;
    c.beginPath();
    const firstRow = Math.floor(par / BH);
    for (let r = firstRow; r * BH - par < H; r++) {
      const y = r * BH - par;
      c.moveTo(0, y);
      c.lineTo(W, y);
      const shift = (r & 1) ? BW / 2 : 0;
      for (let x = -shift; x < W; x += BW) {
        c.moveTo(x, y);
        c.lineTo(x, y + BH);
      }
    }
    c.stroke();

    // barred windows with moonlight (same parallax as the bricks)
    const WIN_GAP = 520;
    for (let k = Math.floor((par - 120) / WIN_GAP); k * WIN_GAP - par < H; k++) {
      const wy = k * WIN_GAP + 150 - par;
      for (let col = 0; col * 360 < W; col++) { // one window per 360 px of width
        const wx = col * 360 + (((k + col) & 1) ? 242 : 40);
        if (wx + 106 > W) continue;
        c.fillStyle = '#0B0C0F';
        c.fillRect(wx - 6, wy - 6, 112, 82);
        const moon = c.createLinearGradient(0, wy, 0, wy + 70);
        moon.addColorStop(0, '#2A3A55');
        moon.addColorStop(1, '#17202F');
        c.fillStyle = moon;
        c.fillRect(wx, wy, 100, 70);
        c.fillStyle = 'rgba(220,230,255,0.55)';
        c.beginPath();
        c.arc(wx + 72, wy + 20, 7, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#3B4048';
        for (let b = 1; b < 6; b++) c.fillRect(wx + b * 16.6 - 2, wy, 4, 70);
        c.fillRect(wx, wy + 32, 100, 4);
      }
    }

    // two searchlights sweeping across the wall
    for (let i = 0; i < 2; i++) {
      const sx = i ? W + 30 : -30;
      const ang = Math.PI / 2 + (i ? 0.55 : -0.55) + Math.sin(visualTime * 0.45 + i * 2.1) * 0.42;
      const len = H * 1.3, spread = 0.16;
      const beam = c.createRadialGradient(sx, -40, 10, sx, -40, len);
      beam.addColorStop(0, 'rgba(255,226,140,0.16)');
      beam.addColorStop(1, 'rgba(255,226,140,0)');
      c.fillStyle = beam;
      c.beginPath();
      c.moveTo(sx, -40);
      c.lineTo(sx + Math.cos(ang - spread) * len, -40 + Math.sin(ang - spread) * len);
      c.lineTo(sx + Math.cos(ang + spread) * len, -40 + Math.sin(ang + spread) * len);
      c.closePath();
      c.fill();
    }

    // mugshot height chart on the left wall (moves with the world, 1 tick = 10 m)
    c.font = 'bold 9px "Trebuchet MS", sans-serif';
    c.textAlign = 'left';
    c.strokeStyle = 'rgba(241,241,238,0.22)';
    c.fillStyle = 'rgba(241,241,238,0.32)';
    c.beginPath();
    const topM = Math.ceil((START_Y - (camY + H)) / 100) * 10;
    for (let m = Math.max(0, topM); START_Y - m * 10 - camY > -10; m += 10) {
      const y = START_Y - m * 10 - camY;
      const major = m % 50 === 0;
      c.moveTo(0, y);
      c.lineTo(major ? 22 : 12, y);
      if (major) c.fillText(m + 'm', 4, y - 3);
    }
    c.stroke();

    // drifting dust in the light
    c.fillStyle = '#D6D3CC';
    for (const s of stars) {
      const y = (((s.y * H - camY * s.z * 0.25 + visualTime * 6 * s.z) % H) + H) % H;
      c.globalAlpha = (0.05 + 0.15 * s.z) * (0.6 + 0.4 * Math.sin(visualTime + s.tw));
      c.fillRect(s.x * W, y, s.s, s.s);
    }
    c.globalAlpha = 1;
  }

  function drawPlatform(c, p) {
    const st = PLAT_STYLE[p.type];
    let x = p.x, y = p.y, alpha = 1;
    if (p.state === 'crumbling') { x += rand(-1.6, 1.6); y += rand(-1, 1); }
    if (p.state === 'vanishing') alpha = p.timer < 0.4 ? (Math.floor(p.timer * 22) % 2 ? 0.25 : 0.85) : 0.9;

    c.save();
    c.globalAlpha = alpha;

    // bunk mattresses sit on a spring
    if (p.type === 'bouncy') {
      const cx = x + p.w / 2;
      const ext = 8 + p.bounceAnim * 8;
      c.strokeStyle = '#9AA3AE';
      c.lineWidth = 2;
      c.beginPath();
      for (let i = 0; i <= 6; i++) c.lineTo(cx + (i % 2 ? 8 : -8), y + p.h + (ext * i) / 6);
      c.stroke();
      y -= p.bounceAnim * 4;
    }

    // body + outline (a short flash of light when landed on)
    if (p.glow > 0) {
      c.shadowColor = COLORS.yellow;
      c.shadowBlur = p.glow * 60;
    }
    roundRect(c, x, y, p.w, p.h, p.type === 'bouncy' ? 6 : 3);
    c.fillStyle = st.body;
    c.fill();
    c.shadowBlur = 0;
    c.lineWidth = 1.5;
    c.strokeStyle = st.edge;
    if (p.type === 'vanish') c.setLineDash([6, 4]);
    c.stroke();
    c.setLineDash([]);

    // top edge highlight
    c.fillStyle = st.color;
    c.fillRect(x + 2, y + 1.5, p.w - 4, 2);

    c.save();
    roundRect(c, x, y, p.w, p.h, 3);
    c.clip();
    if (p.type === 'normal' || p.type === 'moving') {
      // rivets
      c.fillStyle = st.color;
      for (let rx = x + 8; rx < x + p.w - 4; rx += 16) {
        c.beginPath();
        c.arc(rx, y + p.h / 2 + 2, 1.4, 0, Math.PI * 2);
        c.fill();
      }
    } else if (p.type === 'bouncy') {
      // mattress ticking stripes
      c.fillStyle = 'rgba(70,90,140,0.35)';
      for (let sx = x + 5; sx < x + p.w; sx += 9) c.fillRect(sx, y + 4, 3, p.h - 5);
    } else if (p.type === 'vanish') {
      // chain-link mesh
      c.strokeStyle = 'rgba(201,212,224,0.45)';
      c.lineWidth = 1;
      c.beginPath();
      for (let mx = x - p.h; mx < x + p.w; mx += 7) {
        c.moveTo(mx, y); c.lineTo(mx + p.h, y + p.h);
        c.moveTo(mx + p.h, y); c.lineTo(mx, y + p.h);
      }
      c.stroke();
    } else if (p.type === 'crumble') {
      // bricks + cracks
      c.strokeStyle = 'rgba(30,12,6,0.7)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x, y + p.h / 2 + 1); c.lineTo(x + p.w, y + p.h / 2 + 1);
      for (let bx = x + 14; bx < x + p.w; bx += 14) { c.moveTo(bx, y + 3); c.lineTo(bx, y + p.h / 2 + 1); }
      for (let bx = x + 7; bx < x + p.w; bx += 14) { c.moveTo(bx, y + p.h / 2 + 1); c.lineTo(bx, y + p.h); }
      c.stroke();
    }
    c.restore();

    // arrows on moving beams
    if (p.type === 'moving') {
      const my = y + p.h / 2 + 1;
      c.fillStyle = st.color;
      c.beginPath();
      c.moveTo(x + 5, my); c.lineTo(x + 11, my - 4); c.lineTo(x + 11, my + 4);
      c.moveTo(x + p.w - 5, my); c.lineTo(x + p.w - 11, my - 4); c.lineTo(x + p.w - 11, my + 4);
      c.fill();
    }

    if (p.spikes) drawBarbedWire(c, p, x, y);
    c.restore();
  }

  /** Stationary hazard: a coil of barbed wire on one end of a platform.
   *  (Its hitbox is the same 13 px tall strip the old spikes used.) */
  function drawBarbedWire(c, p, x, y) {
    const sx = x + (p.spikes.side === 0 ? 0 : p.w - p.spikes.w);
    const sw = p.spikes.w;
    const pulse = 0.5 + 0.5 * Math.sin(visualTime * 6);
    c.save();
    c.shadowColor = COLORS.red;
    c.shadowBlur = 6 + pulse * 8;
    c.strokeStyle = '#D9DEE5';
    c.lineWidth = 1.4;
    // coil loops
    c.beginPath();
    for (let i = 0; i <= 3; i++) c.ellipse(sx + 4 + i * ((sw - 8) / 3), y - 6, 5, 6, 0, 0, Math.PI * 2);
    c.stroke();
    // barbs
    c.shadowBlur = 0;
    c.strokeStyle = COLORS.red;
    c.lineWidth = 1.6;
    c.beginPath();
    for (let i = 0; i < 4; i++) {
      const bx = sx + 3 + i * ((sw - 6) / 3);
      c.moveTo(bx - 3, y - 13); c.lineTo(bx + 3, y - 7);
      c.moveTo(bx + 3, y - 13); c.lineTo(bx - 3, y - 7);
    }
    c.stroke();
    c.restore();
  }

  function drawHazard(c, h) {
    c.save();
    c.translate(h.x, h.y);
    c.shadowColor = COLORS.red;
    c.shadowBlur = 14;
    if (h.kind === 'saw') {
      // spinning steel sawblade with a red hub
      c.rotate(h.ang);
      c.fillStyle = '#C8CED6';
      c.beginPath();
      const teeth = 10;
      for (let i = 0; i < teeth * 2; i++) {
        const a = (i / (teeth * 2)) * Math.PI * 2;
        const r = i % 2 ? h.r - 4 : h.r + 3;
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath();
      c.fill();
      c.shadowBlur = 0;
      c.strokeStyle = '#6B7380';
      c.lineWidth = 1;
      c.beginPath(); c.arc(0, 0, h.r - 7, 0, Math.PI * 2); c.stroke();
      c.fillStyle = COLORS.red;
      c.beginPath(); c.arc(0, 0, 4.5, 0, Math.PI * 2); c.fill();
    } else {
      // crackling shock orb
      const pulse = 0.5 + 0.5 * Math.sin(visualTime * 8);
      const g = c.createRadialGradient(0, 0, 2, 0, 0, h.r + 4);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, COLORS.yellow);
      g.addColorStop(1, 'rgba(255,59,59,0.25)');
      c.fillStyle = g;
      c.beginPath(); c.arc(0, 0, h.r + pulse * 2, 0, Math.PI * 2); c.fill();
      c.rotate(h.ang);
      c.strokeStyle = COLORS.red;
      c.lineWidth = 1.5;
      c.beginPath();
      for (let i = 0; i <= 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r = h.r + 4 + (i % 2 ? 4 : 0);
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.stroke();
    }
    c.restore();
  }

  /** The prisoner: striped jumpsuit, cap, and a ball & chain on one ankle.
   *  `p` is the local player or a remote ghost; `look` picks the jumpsuit colours. */
  function drawPlayer(c, p, x, y, look, alpha) {
    const w = p.w, h = p.h;
    const grounded = !!p.ground;
    c.save();
    c.globalAlpha = alpha;

    // ---- ball & chain (trails behind; dangles while airborne) ----
    const footX = x + w / 2 - p.face * 5;
    const footY = y + h - 2;
    const front = p.face === 0; // facing the camera (cell scene / escape cutscene)
    const ballX = front ? x + w / 2 + 12 : footX - p.face * 14 - clamp(p.vx / 45, -6, 6);
    const ballY = front ? y + h - 4 - Math.abs(Math.sin(p.runPhase)) * (Math.abs(p.vx) > 20 ? 5 : 0)
      : grounded ? y + h - 5 : y + h + 4 - clamp(p.vy / 150, -6, 6);
    c.strokeStyle = '#B4BAC4';
    c.lineWidth = 1.2;
    for (let i = 1; i <= 4; i++) {
      const t = i / 5;
      c.beginPath();
      c.arc(lerp(footX, ballX, t), lerp(footY, ballY, t) + Math.sin(t * Math.PI) * 2, 1.5, 0, Math.PI * 2);
      c.stroke();
    }
    c.fillStyle = '#5B626D';
    c.beginPath(); c.arc(ballX, ballY, 5.5, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#C9CED6';
    c.lineWidth = 1;
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.beginPath(); c.arc(ballX - 1.6, ballY - 1.6, 1.7, 0, Math.PI * 2); c.fill();

    // ---- body (squash & stretch around the feet) ----
    c.translate(x + w / 2, y + h);
    let sx = 1, sy = 1;
    if (!grounded) {
      const st = clamp(Math.abs(p.vy) / 1700, 0, 0.2);
      sy += st; sx -= st * 0.6;
    }
    sy -= p.squash * 0.35;
    sx += p.squash * 0.35;
    c.scale(sx, sy);

    const falling = !grounded && p.vy > 450;
    if (falling) c.rotate(Math.sin(visualTime * 20) * 0.1);   // flailing while falling
    else if (!grounded) c.rotate(clamp(p.vx / 2000, -0.12, 0.12));

    const moving = Math.abs(p.vx) > 20;
    const swing = grounded && moving ? Math.sin(p.runPhase) * 4 : 0;
    const tuck = grounded ? 0 : p.vy < 0 ? 4 : -1;
    const bob = grounded && moving ? Math.abs(Math.sin(p.runPhase)) * 1.5 : 0;

    // legs (striped trousers + boots)
    const leg = (lx, lift) => {
      c.fillStyle = look.suit;
      c.fillRect(lx, -10 - lift - tuck, 7, 8);
      c.fillStyle = look.stripe;
      c.fillRect(lx, -7 - lift - tuck, 7, 2);
      c.fillStyle = '#1B1D22';
      c.fillRect(lx - 0.5, -3 - lift - tuck, 8, 3);
    };
    leg(-9, Math.max(0, swing));
    leg(2, Math.max(0, -swing));

    // torso with horizontal stripes
    const top = -h - bob;           // top of the head
    const ty = top + 13;            // top of the torso
    c.save();
    roundRect(c, -w / 2 + 1, ty, w - 2, -9 - ty, 4);
    c.clip();
    c.fillStyle = look.suit;
    c.fillRect(-w / 2, ty, w, -9 - ty);
    c.fillStyle = look.stripe;
    for (let s = ty + 2; s < -9; s += 5) c.fillRect(-w / 2, s, w, 2.4);
    c.restore();

    // arms (thrown up when in the air)
    c.fillStyle = look.suit;
    const armUp = grounded ? 0 : 6;
    c.fillRect(-w / 2 - 2, ty + 2 - armUp, 3.5, 9);
    c.fillRect(w / 2 - 1.5, ty + 2 - armUp, 3.5, 9);
    c.fillStyle = '#E8B98A';
    c.fillRect(-w / 2 - 2, ty + 10 - armUp, 3.5, 2.5);
    c.fillRect(w / 2 - 1.5, ty + 10 - armUp, 3.5, 2.5);

    // head
    c.fillStyle = '#E8B98A';
    roundRect(c, -8, top + 1, 16, 13, 5);
    c.fill();
    // stubble
    c.fillStyle = 'rgba(60,40,30,0.25)';
    c.fillRect(-6, top + 10, 12, 3);

    // striped prison cap
    c.fillStyle = look.suit;
    roundRect(c, -8.5, top - 2, 17, 6, 3);
    c.fill();
    c.fillStyle = look.stripe;
    c.fillRect(-8.5, top + 0.5, 17, 1.6);
    c.fillStyle = look.suit;
    if (p.face === 0) c.fillRect(-5, top + 2.5, 10, 2); // peak
    else c.fillRect(p.face > 0 ? 2 : -11, top + 2.5, 9, 2);

    // eyes look where you're going; wide eyes + open mouth when falling
    const ex = p.face * 2;
    c.fillStyle = '#1B1D22';
    if (falling) {
      c.beginPath();
      c.arc(ex - 3.5, top + 7, 1.9, 0, Math.PI * 2);
      c.arc(ex + 3.5, top + 7, 1.9, 0, Math.PI * 2);
      c.fill();
      c.beginPath(); c.arc(ex, top + 11.5, 1.6, 0, Math.PI * 2); c.fill();
    } else {
      c.fillRect(ex - 4.5, top + 6, 2, 2.6);
      c.fillRect(ex + 2.5, top + 6, 2, 2.6);
      c.fillRect(ex - 2, top + 11, 4, 1);
    }
    c.restore();
  }

  function drawParticles(c) {
    for (const q of particles) {
      const t = q.life / q.max;
      c.globalAlpha = Math.min(1, t * 1.5);
      if (q.shape === 'ring') {
        c.strokeStyle = q.color;
        c.lineWidth = 2 * t;
        c.beginPath();
        c.ellipse(q.x, q.y, q.size * (1 + (1 - t) * 3), q.size * 0.35 * (1 + (1 - t) * 2), 0, 0, Math.PI * 2);
        c.stroke();
      } else if (q.shape === 'text') {
        c.fillStyle = q.color;
        c.font = 'bold ' + q.size + 'px "Trebuchet MS", sans-serif';
        c.textAlign = 'center';
        c.fillText(q.text, q.x, q.y);
      } else {
        c.fillStyle = q.color;
        const s = q.shape === 'rect' ? q.size : q.size * (0.5 + t * 0.5);
        c.fillRect(q.x - s / 2, q.y - s / 2, s, s);
      }
    }
    c.globalAlpha = 1;
  }

  /** The deadly floor: a red laser alarm grid. Its top edge (lavaY) is the
   *  real collision line used by checkLava(). */
  function drawFloor(c) {
    const top = lavaY;
    const bottom = camY + H + 30;
    if (top > bottom) return;
    const t = visualTime;

    // red warning glow above the beam
    const glow = c.createLinearGradient(0, top - 110, 0, top);
    glow.addColorStop(0, 'rgba(255,40,40,0)');
    glow.addColorStop(1, 'rgba(255,40,40,0.24)');
    c.fillStyle = glow;
    c.fillRect(0, top - 110, W, 110);

    // dark floor with a scrolling laser grid
    c.fillStyle = '#1C0B0E';
    c.fillRect(0, top, W, bottom - top);
    c.strokeStyle = 'rgba(255,59,59,0.28)';
    c.lineWidth = 1;
    c.beginPath();
    for (let y = top + 10; y < bottom; y += 12) { c.moveTo(0, y); c.lineTo(W, y); }
    const shift = (t * 30) % 24;
    for (let x = -24 + shift; x < W; x += 24) { c.moveTo(x, top); c.lineTo(x, bottom); }
    c.stroke();

    // warning label
    c.font = 'bold 11px "Trebuchet MS", sans-serif';
    c.textAlign = 'center';
    c.fillStyle = 'rgba(255,90,90,' + (0.35 + 0.2 * Math.sin(t * 5)).toFixed(3) + ')';
    c.fillText('!  LASER ALARM FLOOR  !', W / 2, top + 26);

    // the main beam (slight flicker)
    const flick = 0.8 + 0.2 * Math.sin(t * 37) * Math.sin(t * 7);
    c.save();
    c.shadowColor = '#FF2A2A';
    c.shadowBlur = 18;
    c.strokeStyle = 'rgba(255,59,59,' + flick.toFixed(3) + ')';
    c.lineWidth = 4;
    c.beginPath(); c.moveTo(0, top); c.lineTo(W, top); c.stroke();
    c.shadowBlur = 0;
    c.strokeStyle = 'rgba(255,225,225,0.9)';
    c.lineWidth = 1.2;
    c.stroke();
    c.restore();

    // emitters on both walls
    for (const ex of [0, W - 10]) {
      c.fillStyle = '#2A2D33';
      c.fillRect(ex, top - 8, 10, 16);
      c.fillStyle = COLORS.red;
      c.fillRect(ex + 3, top - 2, 4, 4);
    }
  }

  /** Red edge warning that grows as the player gets close to the alarm floor. */
  function drawDangerVignette(c) {
    if (state !== 'playing' && state !== 'paused') return;
    if (!player || run.dead) return;
    const dist = lavaY - (player.y + player.h);
    const k = clamp(1 - dist / 200, 0, 1);
    if (k <= 0) return;
    const pulse = 0.75 + 0.25 * Math.sin(visualTime * 10);
    const g = c.createLinearGradient(0, H - 260, 0, H);
    g.addColorStop(0, 'rgba(255,77,77,0)');
    g.addColorStop(1, 'rgba(255,77,77,' + (0.35 * k * pulse).toFixed(3) + ')');
    c.fillStyle = g;
    c.fillRect(0, H - 260, W, 260);
  }

  /* ==================================================================
     12. GAME-STATE MANAGEMENT
     ================================================================== */
  function setState(next) {
    state = next;
    stageEl.dataset.state = next;
    for (const key in ui.overlays) {
      ui.overlays[key].setAttribute('aria-hidden', key === next ? 'false' : 'true');
    }
    // move keyboard focus to the main button of the new screen
    const overlay = ui.overlays[next];
    if (overlay) {
      const btn = overlay.querySelector('.btn.primary');
      if (btn) setTimeout(() => { if (state === next) btn.focus({ preventScroll: true }); }, 60);
    } else if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
  }

  /** Start a fresh run. `force` allows restarting a run that is in progress (R key). */
  function startGame(force) {
    if (state === 'playing' && !force) return; // guard against double triggers (key + click)
    if (mode === 'multi') return;
    Sound.init();
    myLook = LOOKS[0];
    remotes.clear();
    worldLock = preferredWidth(); // the world fills this screen, and keeps that width for the whole run
    resize();
    resetRun();
    clearInput();
    ui.toast.classList.remove('show');
    accumulator = 0;
    setState('playing');
  }

  /** PLAY from the menu: watch the escape, then the run starts. */
  function beginSoloEscape() {
    if (state !== 'menu') return;
    playEscape([{ key: 'me', name: '', look: LOOKS[0] }], () => {
      startGame(true);
      flash = 0.9;
      run.goFlash = 0.7;
    }, true);
  }

  function togglePause() {
    // A multiplayer match can't be paused for everyone; offer to leave instead.
    if (mode === 'multi') {
      if (state === 'playing') stageEl.classList.toggle('leave-open');
      return;
    }
    if (state === 'playing' && !run.dead) {
      setState('paused');
      clearInput();
    } else if (state === 'paused') {
      resume();
    }
  }

  function resume() {
    if (state !== 'paused') return;
    clearInput();
    lastTs = 0;          // no time jump after the pause
    accumulator = 0;
    setState('playing');
  }

  function endRun() {
    const final = run.score;
    const isRecord = final > run.prevBest;
    if (isRecord) {
      best = final;
      Store.set(STORE_BEST, best); // only written on a new personal best
    }
    ui.overScore.textContent = final;
    ui.overBest.textContent = best;
    ui.overPrev.textContent = run.prevBest;
    ui.newRecord.classList.toggle('show', isRecord && final > 0);
    ui.overCause.textContent = run.cause === 'lava' ? 'Busted! You tripped the laser alarm floor.' : run.cause === 'spikes' ? 'Snagged on the barbed wire!' : 'A hazard got you.';
    ui.overDetail.textContent = run.heightM + ' m climbed · ' + formatTime(run.time) + ' survived · stage ' + run.stage;
    ui.menuBest.textContent = best;
    if (isRecord && final > 0 && run.prevBest > 0) Sound.record();
    ui.toast.classList.remove('show');
    gameOverAt = performance.now();
    setState('gameover');
  }

  function goToMenu() {
    if (mode === 'multi' || Net.role) leaveMultiplayer();
    initMenuScene();
    ui.menuBest.textContent = best;
    ui.toast.classList.remove('show');
    clearInput();
    setState('menu');
  }

  function toggleMute() {
    Sound.muted = !Sound.muted;
    Store.set(STORE_SETTINGS, { muted: Sound.muted });
    refreshMuteButtons();
    if (!Sound.muted) { Sound.init(); Sound.click(); }
  }

  function refreshMuteButtons() {
    document.querySelectorAll('.mute-btn').forEach((b) => {
      b.classList.toggle('off', Sound.muted);
      b.setAttribute('aria-pressed', String(Sound.muted));
    });
  }

  /** HUD is DOM-based; only touch the DOM when a value actually changes. */
  const hudCache = {};
  function setHud(key, el, value) {
    if (hudCache[key] === value) return false;
    hudCache[key] = value;
    el.textContent = value;
    return true;
  }

  function updateHud(force) {
    if (force) for (const k in hudCache) delete hudCache[k];
    if (setHud('score', ui.hudScore, run.score) && !force) {
      ui.hudScore.classList.remove('bump');
      void ui.hudScore.offsetWidth; // restart the CSS animation
      ui.hudScore.classList.add('bump');
    }
    setHud('best', ui.hudBest, Math.max(best, run.score));
    setHud('stage', ui.hudStage, 'STAGE ' + run.stage);
    setHud('height', ui.hudHeight, run.heightM);
    setHud('time', ui.hudTime, formatTime(run.time));
  }

  function handleAction(action) {
    switch (action) {
      case 'play': beginSoloEscape(); break;
      case 'again':
        if (state === 'gameover' && performance.now() - gameOverAt < 300) return;
        startGame();
        break;
      case 'restart': startGame(); break;
      case 'resume': resume(); break;
      case 'pause': togglePause(); break;
      case 'menu': goToMenu(); break;
      case 'mute': toggleMute(); break;
      case 'help': if (state === 'menu') setState('help'); break;
      case 'helpBack': if (state === 'help') setState('menu'); break;
      // ---- multiplayer ----
      case 'mp': openMultiplayer(); break;
      case 'mpHost': hostGame(); break;
      case 'mpJoin': joinGame(); break;
      case 'mpStart':
      case 'mpAgain': hostStartMatch(); break;
      case 'mpLobby': hostBackToLobby(); break;
      case 'mpCopy': copyCode(); break;
      case 'mpLeave':
      case 'leaveConfirm': goToMenu(); break;
      case 'leaveCancel': stageEl.classList.remove('leave-open'); break;
    }
  }

  /* ==================================================================
     12b. MULTIPLAYER
     Everyone climbs the same tower (shared seed) in their own copy of the
     world and sees the others as ghosts. Each player simulates only
     themselves and sends their position ~15 times a second; the host
     relays it to everyone else. When everyone has fallen, the host
     announces the results. The network transport lives in net.js.
     ================================================================== */
  const mp = {
    myId: '',             // 'h' for the host, 'p1', 'p2'... for others
    players: [],          // lobby roster: [{ id, name, color }]
    inMatch: false,       // a round is running
    roster: [],           // players taking part in the current round
    alive: new Set(),     // host only: ids still climbing
    finals: new Map(),    // host only: id -> final result
    sendTimer: 0,
    boardTimer: 0,
    busy: false,          // a host/join request is in progress
  };

  // Never trust data from the network: coerce and limit everything.
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const cleanName = (n) => String(n || '').replace(/[^\p{L}\p{N} _.!?-]/gu, '').trim().slice(0, 12) || 'Player';
  const colorIndex = (c) => clamp(Math.floor(num(c)), 0, LOOKS.length - 1);
  const lookFor = (c) => LOOKS[colorIndex(c)];

  function cleanRoster(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, MAX_PLAYERS).map((p) => ({
      id: String(p && p.id), name: cleanName(p && p.name), color: colorIndex(p && p.color),
    }));
  }

  function cleanResults(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, MAX_PLAYERS).map((r) => ({
      id: String(r && r.id), name: cleanName(r && r.name), color: colorIndex(r && r.color),
      score: Math.max(0, Math.floor(num(r && r.score))), height: Math.max(0, Math.floor(num(r && r.height))),
      left: !!(r && r.left),
    }));
  }

  function cleanState(m) {
    return {
      t: 'st',
      x: clamp(num(m.x), -W, 2 * W), y: num(m.y),
      vx: clamp(num(m.vx), -2000, 2000), vy: clamp(num(m.vy), -3000, 3000),
      f: num(m.f) < 0 ? -1 : 1, g: m.g ? 1 : 0,
      s: Math.max(0, Math.floor(num(m.s))), h: Math.max(0, Math.floor(num(m.h))),
      l: num(m.l, H),
    };
  }

  function myName() {
    const name = cleanName(ui.mpName.value);
    ui.mpName.value = name;
    Store.set(STORE_NAME, name);
    return name;
  }

  function mpStatus(text, isError) {
    ui.mpStatus.textContent = text || '';
    ui.mpStatus.classList.toggle('error', !!isError);
  }

  function setMode(next) {
    mode = next;
    stageEl.classList.toggle('multi', next === 'multi');
    stageEl.classList.toggle('is-host', Net.role === 'host');
  }

  /** Disconnect and reset every piece of multiplayer state. */
  function leaveMultiplayer() {
    Net.leave();
    mp.myId = '';
    mp.players = [];
    mp.roster = [];
    mp.inMatch = false;
    mp.alive.clear();
    mp.finals.clear();
    remotes.clear();
    stageEl.classList.remove('spectating', 'leave-open');
    myLook = LOOKS[0];
    setMode('solo');
  }

  // ---------------- screens ----------------
  function openMultiplayer() {
    if (state !== 'menu' && state !== 'mp') initMenuScene();
    mpStatus('');
    setState('mp');
  }

  async function hostGame() {
    if (mp.busy || state !== 'mp') return;
    mp.busy = true;
    const name = myName();
    mpStatus('Creating game…');
    try {
      await Net.host();
      if (state !== 'mp') { Net.leave(); return; } // player backed out meanwhile
      mp.myId = 'h';
      mp.players = [{ id: 'h', name, color: 0 }];
      mp.inMatch = false;
      setMode('multi');
      enterLobby();
      Sound.join();
    } catch (err) {
      Net.leave();
      if (state === 'mp') mpStatus(Net.describe(err), true);
    } finally {
      mp.busy = false;
    }
  }

  async function joinGame() {
    if (mp.busy || state !== 'mp') return;
    const code = Net.normalizeCode(ui.mpCode.value);
    if (code.length !== Net.CODE_LEN) {
      mpStatus('Enter the ' + Net.CODE_LEN + '-character code from your friend.', true);
      ui.mpCode.focus();
      return;
    }
    mp.busy = true;
    const name = myName();
    mpStatus('Joining ' + code + '…');
    try {
      await Net.join(code);
      if (state !== 'mp') { Net.leave(); return; }
      setMode('multi');
      Net.send({ t: 'hello', name, v: 1, w: preferredWidth() }); // w: how wide a world fits my screen
      mpStatus('Connected! Waiting for the host…');
    } catch (err) {
      Net.leave();
      if (state === 'mp') mpStatus(Net.describe(err), true);
    } finally {
      mp.busy = false;
    }
  }

  function enterLobby() {
    initMenuScene();
    remotes.clear();
    stageEl.classList.remove('spectating', 'leave-open');
    renderLobby();
    setState('lobby');
  }

  function tagEl(text) {
    const b = document.createElement('b');
    b.className = 'tag';
    b.textContent = text;
    return b;
  }

  function renderLobby() {
    ui.lobbyCode.textContent = Net.code || '-----';
    ui.lobbyPlayers.textContent = '';
    for (const p of mp.players) {
      const li = document.createElement('li');
      const dot = document.createElement('i');
      dot.className = 'dot';
      dot.style.background = lookFor(p.color).color;
      const name = document.createElement('span');
      name.textContent = p.name; // textContent: names can never inject HTML
      li.append(dot, name);
      if (p.id === 'h') li.append(tagEl('HOST'));
      if (p.id === mp.myId) li.append(tagEl('YOU'));
      ui.lobbyPlayers.append(li);
    }
    const host = Net.role === 'host';
    let status;
    if (mp.inMatch) status = host ? 'A match is running.' : "A match is in progress - you'll join the next round.";
    else if (host) status = mp.players.length < 2 ? 'Waiting for friends… (or start now to play alone)' : mp.players.length + ' players ready!';
    else status = 'Waiting for the host to start…';
    ui.lobbyStatus.textContent = status;
    ui.mpStartBtn.disabled = mp.inMatch;
  }

  function copyCode() {
    const code = Net.code;
    if (!code) return;
    // A link only helps if friends can open it, i.e. the game is hosted online.
    const link = location.protocol === 'https:' ? location.origin + location.pathname + '?join=' + code : '';
    const done = () => showToast(link ? 'Invite link copied!' : 'Code ' + code + ' copied!');
    const fail = () => showToast('Your code: ' + code);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link || code).then(done, fail);
    else fail();
  }

  // ---------------- host logic ----------------
  function hostBroadcastLobby() {
    Net.broadcast({ t: 'lobby', players: mp.players, inMatch: mp.inMatch });
    if (state === 'lobby') renderLobby();
  }

  function onHostMessage(from, msg) {
    switch (msg.t) {
      case 'hello': {
        if (mp.players.some((p) => p.id === from)) return;
        if (mp.players.length >= MAX_PLAYERS) {
          Net.sendTo(from, { t: 'reject', reason: 'That game is full (' + MAX_PLAYERS + ' players max).' });
          Net.kick(from);
          return;
        }
        const used = new Set(mp.players.map((p) => p.color));
        let color = 0;
        while (used.has(color)) color++;
        const name = cleanName(msg.name);
        mp.players.push({ id: from, name, color, w: clamp(Math.round(num(msg.w, W_MIN)), W_MIN, W_MAX) });
        Net.sendTo(from, { t: 'welcome', id: from });
        hostBroadcastLobby();
        showToast(name + ' joined');
        Sound.join();
        break;
      }
      case 'st': {
        if (!mp.inMatch || !mp.alive.has(from)) return;
        const s = cleanState(msg);
        s.id = from; // the host decides who sent it, so nobody can fake another player
        applyRemoteState(from, s);
        Net.broadcast(s, from);
        break;
      }
      case 'dead':
        if (mp.inMatch) hostPlayerDone(from, msg);
        break;
    }
  }

  function onHostPeerLeave(id) {
    const p = mp.players.find((pl) => pl.id === id);
    mp.players = mp.players.filter((pl) => pl.id !== id);
    if (mp.inMatch && mp.alive.has(id)) {
      const r = remotes.get(id);
      hostPlayerDone(id, { score: r ? r.score : 0, height: r ? r.height : 0, left: true });
    }
    if (p) showToast(p.name + ' left');
    hostBroadcastLobby();
  }

  function hostStartMatch() {
    if (Net.role !== 'host' || mp.inMatch) return;
    if (state !== 'lobby' && state !== 'results') return;
    const seed = Math.floor(Math.random() * 4294967296);
    mp.roster = mp.players.map((p) => ({ ...p }));
    mp.alive = new Set(mp.roster.map((p) => p.id));
    mp.finals = new Map();
    mp.inMatch = true;
    // Everyone plays the same world width: the widest one that fits every player's screen.
    mp.players[0].w = preferredWidth();
    const worldW = Math.min(...mp.players.map((p) => p.w || W_MIN));
    Net.broadcast({ t: 'start', seed, roster: mp.roster, w: worldW });
    beginMatch(seed, mp.roster, worldW);
  }

  /** Host: a player fell (or disconnected). Ends the round when nobody is left. */
  function hostPlayerDone(id, data) {
    if (!mp.alive.has(id)) return;
    mp.alive.delete(id);
    const p = mp.roster.find((r) => r.id === id) || { name: 'Player', color: 0 };
    const result = {
      id, name: p.name, color: p.color,
      score: Math.max(0, Math.floor(num(data.score))),
      height: Math.max(0, Math.floor(num(data.height))),
      left: !!data.left,
    };
    mp.finals.set(id, result);
    Net.broadcast({ t: 'dead', id, score: result.score, height: result.height }, id);
    if (id !== mp.myId) markRemoteDead(id, result);
    if (mp.alive.size === 0) hostFinishMatch();
  }

  function hostFinishMatch() {
    mp.inMatch = false;
    const list = [...mp.finals.values()].sort((a, b) => b.score - a.score);
    Net.broadcast({ t: 'results', list });
    Net.broadcast({ t: 'lobby', players: mp.players, inMatch: false });
    showResults(list);
  }

  function hostBackToLobby() {
    if (Net.role !== 'host' || mp.inMatch) return;
    Net.broadcast({ t: 'toLobby' });
    hostBroadcastLobby();
    enterLobby();
  }

  // ---------------- client logic ----------------
  function onClientMessage(msg) {
    switch (msg.t) {
      case 'welcome':
        mp.myId = String(msg.id);
        enterLobby();
        Sound.join();
        break;
      case 'reject':
        leaveMultiplayer();
        openMultiplayer();
        mpStatus(String(msg.reason || 'Could not join that game.').slice(0, 120), true);
        break;
      case 'lobby':
        mp.players = cleanRoster(msg.players);
        mp.inMatch = !!msg.inMatch;
        if (state === 'lobby') renderLobby();
        break;
      case 'start':
        if (!mp.myId) return;
        beginMatch(Math.floor(num(msg.seed)) >>> 0, cleanRoster(msg.roster), msg.w);
        break;
      case 'st': {
        const id = String(msg.id);
        if (id !== mp.myId) applyRemoteState(id, cleanState(msg));
        break;
      }
      case 'dead':
        markRemoteDead(String(msg.id), { score: Math.floor(num(msg.score)), height: Math.floor(num(msg.height)) });
        break;
      case 'results':
        mp.inMatch = false;
        // Players who joined mid-round stay in the lobby instead.
        if (state !== 'lobby' && mp.roster.some((r) => r.id === mp.myId)) showResults(cleanResults(msg.list));
        break;
      case 'toLobby':
        mp.inMatch = false;
        enterLobby();
        break;
    }
  }

  // ---------------- the match itself (host and clients) ----------------
  function beginMatch(seed, roster, worldW) {
    mp.roster = roster;
    mp.inMatch = true;
    const meIndex = roster.findIndex((r) => r.id === mp.myId);
    if (meIndex < 0) { // joined mid-round: wait in the lobby for the next one
      if (state === 'lobby') renderLobby();
      return;
    }
    Sound.init();
    worldLock = clamp(Math.round(num(worldW, W_MIN)), W_MIN, W_MAX); // same width for everyone...
    resize();
    resetRun(seed);           // ...and same seed => identical tower for everyone
    myLook = lookFor(roster[meIndex].color);

    // spread everyone out across the starting platform
    const n = roster.length;
    const startX = (i) => W / 2 - PLAYER_W / 2 + (i - (n - 1) / 2) * 24;
    player.x = startX(meIndex);
    remotes.clear();
    roster.forEach((r, i) => {
      if (r.id !== mp.myId) remotes.set(r.id, makeRemote(r, startX(i), START_Y - PLAYER_H));
    });

    stageEl.classList.remove('spectating', 'leave-open');
    clearInput();
    ui.toast.classList.remove('show');
    accumulator = 0;
    mp.sendTimer = 0;
    mp.boardTimer = 1; // refresh the leaderboard right away
    // everyone in the match escapes together (not skippable, so nobody starts early)
    const cast = roster.map((r) => ({ key: r.id === mp.myId ? 'me' : r.id, name: r.name, look: lookFor(r.color) }));
    playEscape(cast, () => {
      run.countdown = 3;
      Sound.tick();
      accumulator = 0;
      flash = 0.9;
      setState('playing');
    }, false);
  }

  function makeRemote(r, x, y) {
    return {
      id: r.id, name: r.name, look: lookFor(r.color),
      x, y, tx: x, ty: y, w: PLAYER_W, h: PLAYER_H,
      vx: 0, vy: 0, face: 1, ground: true, runPhase: 0, squash: 0,
      score: 0, height: 0, lava: H - LAVA_MIN_VISIBLE, alive: true, age: 0,
    };
  }

  function applyRemoteState(id, s) {
    const r = remotes.get(id);
    if (!r || !r.alive) return;
    r.tx = s.x; r.ty = s.y;
    r.vx = s.vx; r.vy = s.vy;
    r.face = s.f; r.ground = !!s.g;
    r.score = s.s; r.height = s.h;
    r.lava = s.l;
    r.age = 0;
  }

  function markRemoteDead(id, result) {
    const r = remotes.get(id);
    if (!r || !r.alive) return;
    r.alive = false;
    r.score = result.score;
    r.height = result.height;
    for (let i = 0; i < 20; i++) {
      spawnParticle(r.x + r.w / 2, r.y + r.h / 2, rand(-220, 220), rand(-300, 60), rand(0.5, 1), rand(2, 4), r.look.color, { g: 800 });
    }
  }

  /** Move ghosts smoothly toward their latest network position. Between
   *  updates they keep moving with their last velocity (for a short while). */
  function updateRemotes(dt) {
    const k = Math.min(1, dt * 14);
    for (const r of remotes.values()) {
      r.age += dt;
      if (r.age < 0.25) {
        r.tx += r.vx * dt;
        if (!r.ground) r.ty += r.vy * dt;
      }
      if (Math.abs(r.tx - r.x) > W / 2) r.x = r.tx; // wrapped across the screen edge: snap
      else r.x += (r.tx - r.x) * k;
      r.y += (r.ty - r.y) * k;
      if (r.ground) r.runPhase += Math.abs(r.vx) * dt * 0.07;
    }
  }

  /** Called every frame in multiplayer: send our state, refresh the leaderboard. */
  function netTick(dt) {
    mp.sendTimer += dt;
    if (state === 'playing' && run.countdown <= 0 && !run.dead && mp.sendTimer >= 1 / 15) {
      mp.sendTimer = 0;
      const msg = {
        t: 'st',
        x: Math.round(player.x * 10) / 10, y: Math.round(player.y * 10) / 10,
        vx: Math.round(player.vx), vy: Math.round(player.vy),
        f: player.face, g: player.ground ? 1 : 0,
        s: run.score, h: run.heightM, l: Math.round(lavaY),
      };
      if (Net.role === 'host') { msg.id = mp.myId; Net.broadcast(msg); }
      else Net.send(msg);
    }
    mp.boardTimer += dt;
    if (mp.boardTimer >= 0.25) {
      mp.boardTimer = 0;
      if (state === 'playing') updateBoard();
    }
  }

  /** Live scoreboard in the top-right corner: rank, colour, name, score. */
  function updateBoard() {
    const rows = [{ name: 'You', look: myLook, score: run.score, alive: !run.dead, me: true }];
    for (const r of remotes.values()) rows.push({ name: r.name, look: r.look, score: r.score, alive: r.alive });
    rows.sort((a, b) => b.score - a.score);
    ui.mpBoard.textContent = '';
    rows.forEach((row, i) => {
      const li = document.createElement('li');
      if (!row.alive) li.classList.add('out');
      if (row.me) li.classList.add('me');
      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = i + 1;
      const dot = document.createElement('i');
      dot.style.background = row.look.color;
      dot.style.color = row.look.color;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = row.name;
      li.append(rank, dot, name);
      if (!row.alive) {
        const out = document.createElement('span');
        out.className = 'out-tag';
        out.textContent = 'OUT';
        li.append(out);
      }
      const score = document.createElement('b');
      score.textContent = row.score;
      li.append(score);
      ui.mpBoard.append(li);
    });
    measureHud();
    if (run.spectating) {
      ui.specText.textContent = 'Score ' + run.score + ' · ' + (run.spectateName ? 'watching ' + run.spectateName : 'waiting for results…');
    }
  }

  /** Local player fell in multiplayer: report it and watch the others. */
  function enterSpectate() {
    run.spectating = true;
    const final = run.score;
    if (final > best) {
      best = final;
      Store.set(STORE_BEST, best);
      ui.menuBest.textContent = best;
    }
    stageEl.classList.add('spectating');
    updateBoard();
    const data = { t: 'dead', score: final, height: run.heightM };
    if (Net.role === 'host') hostPlayerDone(mp.myId, data);
    else Net.send(data);
  }

  /** While spectating, the camera (and lava) follow the highest player still alive. */
  function updateSpectate(dt) {
    let leader = null;
    for (const r of remotes.values()) {
      if (r.alive && (!leader || r.y < leader.y)) leader = r;
    }
    run.spectateName = leader ? leader.name : '';
    if (!leader) return;
    const k = Math.min(1, dt * 3);
    camY += (leader.y - H * 0.58 - camY) * k;
    lavaY += (leader.lava - lavaY) * k;
  }

  function showResults(list) {
    mp.inMatch = false;
    stageEl.classList.remove('spectating', 'leave-open');
    ui.resultsList.textContent = '';
    list.forEach((r, i) => {
      const li = document.createElement('li');
      if (r.id === mp.myId) li.className = 'me';
      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = i + 1;
      const dot = document.createElement('i');
      dot.style.background = lookFor(r.color).color;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = r.name + (r.id === mp.myId ? ' (you)' : '') + (r.left ? ' · left' : '');
      const height = document.createElement('small');
      height.textContent = r.height + ' m';
      const score = document.createElement('b');
      score.textContent = r.score;
      li.append(rank, dot, name, height, score);
      ui.resultsList.append(li);
    });
    const winner = list[0];
    const iWon = !!winner && winner.id === mp.myId;
    ui.resultsWinner.textContent = !winner ? '' : list.length === 1 ? 'Solo round complete!' : iWon ? '★ YOU WIN! ★' : '★ ' + winner.name + ' WINS! ★';
    ui.resultsWinner.style.color = winner ? lookFor(winner.color).color : '';
    const mine = list.find((r) => r.id === mp.myId);
    ui.resultsNote.textContent = mine ? 'Your score: ' + mine.score + ' · Personal best: ' + best : '';
    if (iWon && list.length > 1) Sound.record();
    else Sound.stage();
    setState('results');
  }

  /* ==================================================================
     13. MAIN LOOP & BOOT
     A fixed 120 Hz physics step keeps behaviour identical on 60/120/144 Hz
     screens; rendering happens once per animation frame.
     ================================================================== */
  let lastTs = 0;
  let accumulator = 0;

  function step(dt) {
    if (state === 'playing') stepPlaying(dt);
    else if (state === 'escape') stepEscape(dt);
    else if (isCellState()) stepCell(dt);
    else if (state === 'gameover' || state === 'results') {
      run.clock += dt;
      updatePlatforms(dt, run.clock);
      updateHazards(dt, run.clock);
      updateEffects(dt);
    }
    // 'paused' -> nothing updates
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    dt = Math.min(Math.max(dt, 0), 0.1); // never simulate huge jumps (tab switches, hitches)

    if (state !== 'paused') {
      visualTime += dt;
      accumulator = Math.min(accumulator + dt, 0.1);
      while (accumulator >= STEP) {
        step(STEP);
        accumulator -= STEP;
      }
      if (state === 'playing') updateHud(false);
      if (mode === 'multi') netTick(dt);
    }
    render();
  }

  function boot() {
    // Touch device detection -> show on-screen controls (must run before resize()).
    const markTouch = () => {
      if (document.body.classList.contains('is-touch')) return;
      document.body.classList.add('is-touch');
      resize();
    };
    if ((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window) {
      document.body.classList.add('is-touch');
    }
    window.addEventListener('touchstart', markTouch, { once: true, passive: true });

    resize();
    initStars();
    initMenuScene();
    ui.menuBest.textContent = best;
    refreshMuteButtons();
    setState('menu');

    // ---- event listeners: registered exactly once ----
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // Buttons use data-action; one delegated listener handles them all.
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      Sound.init();
      Sound.click();
      handleAction(btn.dataset.action);
      if (btn.blur && !btn.classList.contains('primary')) btn.blur();
    });
    document.querySelectorAll('[data-hold]').forEach(bindTouchButton);
    stageEl.addEventListener('pointerdown', () => { if (state === 'escape') skipEscape(); });

    // Losing focus / hiding the tab: pause and drop held keys, no physics jump on return.
    // (Multiplayer matches can't pause, so there we only drop held keys.)
    window.addEventListener('blur', () => {
      clearInput();
      if (state === 'playing' && !run.dead && mode === 'solo') togglePause();
    });
    document.addEventListener('visibilitychange', () => {
      lastTs = 0;
      accumulator = 0;
      if (document.hidden) {
        clearInput();
        if (state === 'playing' && !run.dead && mode === 'solo') togglePause();
      }
    });

    // ---- multiplayer wiring ----
    ui.mpName.value = Store.get(STORE_NAME, '');
    ui.mpCode.addEventListener('input', () => {
      ui.mpCode.value = Net.normalizeCode(ui.mpCode.value);
    });
    Net.on('message', (from, msg) => {
      if (!msg || typeof msg.t !== 'string') return;
      if (Net.role === 'host') onHostMessage(from, msg);
      else if (Net.role === 'client') onClientMessage(msg);
    });
    Net.on('peerLeave', (id) => { if (Net.role === 'host') onHostPeerLeave(id); });
    Net.on('closed', (reason) => {
      if (mode !== 'multi') return;
      leaveMultiplayer();
      openMultiplayer();
      mpStatus(reason, true);
    });
    Net.on('error', (text) => showToast(text));

    // Invite links (?join=CODE) open the join screen with the code filled in.
    const joinParam = new URLSearchParams(location.search).get('join');
    if (joinParam) {
      ui.mpCode.value = Net.normalizeCode(joinParam);
      openMultiplayer();
    }

    requestAnimationFrame(frame);
  }

  // Small read-only hook that makes debugging/testing from the console easy.
  window.__dttf = {
    get state() { return state; },
    get player() { return player; },
    get platforms() { return platforms; },
    get hazards() { return hazards; },
    get run() { return run; },
    get lavaY() { return lavaY; },
    get camY() { return camY; },
    get viewHeight() { return H; },
    get mode() { return mode; },
    remotes,
    mp,
    input,
    /** Freeze the escape cutscene at `t` seconds (for screenshots/tests); null resumes. */
    escapeAt(t) {
      escape.frozen = t !== null;
      if (t !== null) escape.t = t;
      render();
    },
    /** Simulate `sec` seconds instantly (handy for automated tests). */
    advance(sec) {
      for (let t = 0; t < sec; t += STEP) {
        if (state === 'paused') break;
        step(STEP);
      }
      if (state === 'playing') updateHud(false);
      if (mode === 'multi') netTick(sec);
      render();
    },
  };

  boot();
})();
