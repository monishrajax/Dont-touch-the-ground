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
     13. Main loop & boot

   World coordinates: the game world is 480 units wide. "y" grows downward,
   so climbing means y gets SMALLER. camY is the world y at the top of the
   screen. The canvas is scaled to fit the window, but all game logic uses
   these fixed world units, so resizing never affects collisions.
   ========================================================================== */
(() => {
  'use strict';

  /* ==================================================================
     1. CONSTANTS & TUNING
     ================================================================== */
  const W = 480;                 // world/view width
  const H = 720;                 // view height
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
  const LAVA_MIN_VISIBLE = 40;   // lava is always at least this far onto the screen

  const COLORS = {
    bg: '#080B16', cyan: '#00E5FF', purple: '#A855F7', red: '#FF4D4D',
    green: '#39FF88', text: '#F8FAFC', amber: '#FFB02E', ghost: '#E6F4FF',
  };

  const PLAT_STYLE = {
    normal:  { color: COLORS.cyan,   fill: 'rgba(0,229,255,0.16)' },
    moving:  { color: COLORS.purple, fill: 'rgba(168,85,247,0.22)' },
    bouncy:  { color: COLORS.green,  fill: 'rgba(57,255,136,0.18)' },
    vanish:  { color: COLORS.ghost,  fill: 'rgba(230,244,255,0.07)' },
    crumble: { color: COLORS.amber,  fill: 'rgba(255,176,46,0.18)' },
  };

  // Height (in metres, 1 m = 10 px) at which each difficulty stage begins.
  const STAGE_AT = [0, 120, 280, 480, 720];
  const STAGE_EXTRA_EVERY = 350; // after stage 5, +1 stage every 350 m
  const STAGE_INFO = {
    1: 'WARM-UP',
    2: 'MOVING PLATFORMS',
    3: 'HAZARDS AHEAD',
    4: 'VANISHING PLATFORMS',
    5: 'CRUMBLE & CHAOS',
  };

  const STORE_BEST = 'dttf.best';
  const STORE_SETTINGS = 'dttf.settings';

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

  function weightedPick(weights) {
    let total = 0;
    for (const k in weights) total += weights[k];
    let r = Math.random() * total;
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
    overlays: { menu: $('menu'), paused: $('pause'), gameover: $('gameover') },
  };

  let viewScale = 1; // world units -> device pixels

  /** Fit the 480x720 game into the window, keeping its aspect ratio and using
   *  devicePixelRatio for sharp graphics. Logic coordinates never change. */
  function resize() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const s = Math.min(vw / W, vh / H);
    const cssW = Math.floor(W * s);
    const cssH = Math.floor(H * s);
    stageEl.style.width = cssW + 'px';
    stageEl.style.height = cssH + 'px';
    stageEl.style.fontSize = Math.max(10, 17 * s) + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    viewScale = canvas.width / W;
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
    if (state === 'playing') input.jumpBuffer = PHYS.jumpBuffer;
  }

  const KEYS_LEFT = ['KeyA', 'ArrowLeft'];
  const KEYS_RIGHT = ['KeyD', 'ArrowRight'];
  const KEYS_JUMP = ['Space', 'KeyW', 'ArrowUp'];
  const KEYS_BLOCK = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

  function onKeyDown(e) {
    const code = e.code;
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
        if (confirmKey) { e.preventDefault(); startGame(); }
        break;
      case 'playing':
        if (code === 'KeyP' || code === 'Escape') togglePause();
        else if (code === 'KeyR') startGame(true);
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
  let state = 'menu';          // 'menu' | 'playing' | 'paused' | 'gameover'
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
    };
  }

  /** Completely fresh run: every piece of per-run data is rebuilt here. */
  function resetRun() {
    platforms = [];
    hazards = [];
    particles = [];
    camY = 0;
    lavaY = H - LAVA_MIN_VISIBLE;
    shake = 0;
    flash = 0;
    run = newRunData();

    const start = makePlatform('normal', W / 2 - 90, START_Y, 180);
    start.visited = true;
    platforms.push(start);
    player = makePlayer(W / 2 - PLAYER_W / 2, START_Y - PLAYER_H);
    player.ground = start;

    gen = { lastCx: W / 2, lastY: START_Y, lastType: 'normal', count: 0, unsafeRun: 0, sinceHazard: 0 };
    generatePlatforms();
    updateHud(true);
  }

  /* ==================================================================
     7. PROCEDURAL GENERATION
     Platforms are generated one at a time upward from the last one.
     Every new platform is placed within a jump-reachable distance of the
     previous one, so there is always a valid route.
     ================================================================== */
  function generatePlatforms() {
    while (gen.lastY > camY - 520) addPlatform();
  }

  function addPlatform() {
    const heightM = (START_Y - gen.lastY) / 10;
    // Use a slightly lower height so new mechanics appear roughly when the
    // player (who is a few platforms below the generator) reaches that stage.
    const stage = stageForHeight(heightM - 45);
    const d = Math.min(stage, 9);
    const learning = gen.count < 4;

    // ---- choose platform type ----
    let type = 'normal';
    if (!learning) {
      const unstableAllowed = gen.unsafeRun === 0; // never two unstable platforms in a row
      type = weightedPick({
        normal: Math.max(45, 100 - d * 7),
        moving: stage >= 2 ? 16 + d * 3 : 0,
        bouncy: stage >= 2 ? 7 : 0,
        vanish: stage >= 4 && unstableAllowed ? 10 + (d - 4) * 3 : 0,
        crumble: stage >= 5 && unstableAllowed ? 9 + (d - 5) * 3 : 0,
      });
    }

    // ---- decide whether this gap gets a hazard ----
    let hazardKind = null;
    if (stage >= 3 && gen.sinceHazard >= 2 && !learning) {
      const movingInvolved = type === 'moving' || gen.lastType === 'moving';
      if (Math.random() < Math.min(0.55, 0.25 + 0.05 * (stage - 3)) && (!movingInvolved || stage >= 6)) {
        if (type === 'normal' && Math.random() < 0.4) hazardKind = 'spikes';
        else hazardKind = stage >= 5 && Math.random() < 0.4 ? 'orb' : 'saw';
      }
    }

    // ---- geometry: vertical gap, width, horizontal offset ----
    let dy = Math.min(rand(66, 80 + d * 7), 130);
    if (hazardKind === 'saw' || hazardKind === 'orb') dy = Math.max(dy, 94);
    let w = rand(Math.max(64, 114 - d * 6), Math.max(86, 152 - d * 8));
    if (type === 'moving') w = Math.max(w, 92);
    if (hazardKind === 'spikes') w = Math.max(w, 124);

    // How far sideways a jump of this height can reliably travel (conservative).
    let dxMax = 150 - (dy - 66) * 0.55;
    if (type === 'moving' || gen.lastType === 'moving') dxMax -= 40;

    const range = type === 'moving' ? rand(36, 56) : 0;
    const margin = w / 2 + range + 6;
    let cx = gen.lastCx + rand(-dxMax, dxMax);
    // add some variety: avoid stacking platforms perfectly on top of each other
    if (Math.abs(cx - gen.lastCx) < 30) cx += (Math.random() < 0.5 ? -1 : 1) * 40;
    cx = clamp(cx, margin, W - margin);

    const y = gen.lastY - dy;
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
      p.spikes = { side: Math.random() < 0.5 ? 0 : 1, w: 34 };
    } else if (hazardKind) {
      // Place moving hazards in the middle of the gap, on the side of the
      // screen AWAY from the direct route between the two platforms.
      const midX = (gen.lastCx + cx) / 2;
      const hx = clamp(midX < W / 2 ? midX + 190 : midX - 190, 70, W - 70);
      const hy = (gen.lastY + y) / 2 - 14;
      hazards.push(hazardKind === 'saw'
        ? { kind: 'saw', x: hx, y: hy, baseX: hx, baseY: hy, r: 16, range: rand(55, 75), speed: 1.4 + 0.12 * d, phase: rand(0, 6.28), ang: 0 }
        : { kind: 'orb', x: hx, y: hy, baseX: hx, baseY: hy, r: 13, range: 24, speed: 2.2 + 0.1 * d, phase: rand(0, 6.28), ang: 0 });
    }

    platforms.push(p);
    gen.sinceHazard = hazardKind ? 0 : gen.sinceHazard + 1;
    gen.unsafeRun = (type === 'vanish' || type === 'crumble') ? gen.unsafeRun + 1 : 0;
    gen.lastCx = cx;
    gen.lastY = y;
    gen.lastType = type;
    gen.count++;
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
        spawnParticle(p.x + p.w / 2 + rand(-8, 8), p.y + p.h, rand(-70, 70), rand(10, 70), rand(0.25, 0.45), rand(2, 3.5), COLORS.cyan, {});
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
        spawnParticle(p.x + p.w / 2, pl.y - 40, 0, -45, 0.8, 14, COLORS.green, { shape: 'text', text: '+5' });
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
          spawnParticle(p.x + p.w / 2 + rand(-12, 12), pl.y, rand(-60, 60), rand(-220, -80), rand(0.3, 0.6), rand(2, 3.5), COLORS.green, { g: 400 });
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
      const colors = [COLORS.cyan, COLORS.purple, COLORS.green, COLORS.text];
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
    const color = cause === 'lava' ? COLORS.red : COLORS.cyan;
    for (let i = 0; i < 36; i++) {
      spawnParticle(p.x + p.w / 2, p.y + p.h / 2, rand(-300, 300), rand(-420, 80), rand(0.6, 1.2), rand(2.5, 5), i % 3 ? color : COLORS.amber, { g: 900 });
    }
    p.visible = false;
  }

  /** One fixed-timestep update of the running game. */
  function stepPlaying(dt) {
    if (!run.dead) run.time += dt;
    updatePlatforms(dt, run.time);
    updateHazards(dt, run.time);
    updateLava(dt);

    if (!run.dead) {
      updatePlayer(dt);
      checkHazards();
      if (!run.dead) checkLava();
      updateCamera(dt);
      updateScore();
      generatePlatforms();
      cleanupWorld();
    } else {
      run.deathTimer += dt;
      if (run.deathTimer > 0.9) endRun();
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

    // occasional embers rising from the lava
    if (Math.random() < dt * 9) {
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
     10. MENU ATTRACT SCENE - a demo character hopping between platforms
     ================================================================== */
  const demo = { seq: [0, 1, 2, 3, 2, 1], i: 0, phase: 'rest', t: 0 };

  function initMenuScene() {
    run = newRunData();
    particles = [];
    hazards = [];
    camY = 0;
    lavaY = H - LAVA_MIN_VISIBLE;
    shake = 0;
    flash = 0;
    platforms = [
      makePlatform('normal', 50, 560, 130),
      makePlatform('bouncy', 290, 470, 110),
      makePlatform('moving', 150, 360, 110),
      makePlatform('crumble', 300, 250, 110),
      makePlatform('vanish', 30, 200, 100),
    ];
    const mv = platforms[2];
    mv.baseX = 150; mv.range = 40; mv.speed = 1.2;
    hazards.push({ kind: 'saw', x: 90, y: 120, baseX: 90, baseY: 120, r: 16, range: 50, speed: 1.4, phase: 0, ang: 0 });
    player = makePlayer(0, 0);
    demo.i = 0; demo.phase = 'rest'; demo.t = 0;
    placeDemoHero(platforms[0]);
  }

  function placeDemoHero(pl) {
    player.x = pl.x + pl.w / 2 - PLAYER_W / 2;
    player.y = pl.y - PLAYER_H;
  }

  function stepMenu(dt) {
    run.time += dt;
    updatePlatforms(dt, run.time);
    updateHazards(dt, run.time);
    updateEffects(dt);

    const a = platforms[demo.seq[demo.i]];
    const b = platforms[demo.seq[(demo.i + 1) % demo.seq.length]];
    demo.t += dt;
    if (demo.phase === 'rest') {
      placeDemoHero(a);
      player.vx = 0; player.vy = 0; player.ground = a;
      if (demo.t > 0.45) { demo.phase = 'hop'; demo.t = 0; }
    } else {
      const T = 0.8, arc = 95;
      const u = Math.min(1, demo.t / T);
      const ax = a.x + a.w / 2 - PLAYER_W / 2, ay = a.y - PLAYER_H;
      const bx = b.x + b.w / 2 - PLAYER_W / 2, by = b.y - PLAYER_H;
      player.x = lerp(ax, bx, u);
      player.y = lerp(ay, by, u) - 4 * arc * u * (1 - u);
      player.vx = (bx - ax) / T;
      player.vy = ((by - ay) - 4 * arc * (1 - 2 * u)) / T;
      player.face = bx >= ax ? 1 : -1;
      player.ground = null;
      if (u >= 1) {
        demo.i = (demo.i + 1) % demo.seq.length;
        demo.phase = 'rest';
        demo.t = 0;
        player.squash = 0.4;
        b.glow = 0.3;
        spawnParticle(player.x + PLAYER_W / 2, b.y, 0, 0, 0.35, 10, PLAT_STYLE[b.type].color, { shape: 'ring' });
      }
    }
    player.runPhase += dt * 6;
    if (player.squash > 0) player.squash = Math.max(0, player.squash - dt * 6);
  }

  /* ==================================================================
     11. RENDERING
     ================================================================== */
  function initStars() {
    for (let i = 0; i < 80; i++) {
      stars.push({ x: rand(0, W), y: rand(0, H), z: rand(0.1, 1), tw: rand(0, 6.28), s: rand(0.6, 1.8) });
    }
  }

  function render() {
    const c = ctx;
    c.setTransform(viewScale, 0, 0, viewScale, 0, 0);
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
    if (player && player.visible) {
      drawPlayer(c, player.x, player.y);
      if (player.x < 0) drawPlayer(c, player.x + W, player.y);           // wrap copy
      else if (player.x + player.w > W) drawPlayer(c, player.x - W, player.y);
    }
    drawParticles(c);
    drawLava(c);
    c.restore();

    drawDangerVignette(c);
    if (flash > 0) {
      c.fillStyle = 'rgba(255,255,255,' + (flash * 0.6).toFixed(3) + ')';
      c.fillRect(0, 0, W, H);
    }
  }

  function drawBackground(c) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0B0F24');
    g.addColorStop(1, COLORS.bg);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    // soft nebula blobs (parallax)
    const off = (-camY * 0.05) % (H * 2);
    c.globalAlpha = 0.5;
    const n1 = c.createRadialGradient(110, (180 + off) % (H + 300) - 150, 10, 110, (180 + off) % (H + 300) - 150, 220);
    n1.addColorStop(0, 'rgba(168,85,247,0.22)');
    n1.addColorStop(1, 'rgba(168,85,247,0)');
    c.fillStyle = n1;
    c.fillRect(0, 0, W, H);
    const n2 = c.createRadialGradient(390, (520 + off) % (H + 300) - 150, 10, 390, (520 + off) % (H + 300) - 150, 200);
    n2.addColorStop(0, 'rgba(0,229,255,0.16)');
    n2.addColorStop(1, 'rgba(0,229,255,0)');
    c.fillStyle = n2;
    c.fillRect(0, 0, W, H);
    c.globalAlpha = 1;

    // twinkling parallax stars
    c.fillStyle = '#ffffff';
    for (const s of stars) {
      const y = (((s.y - camY * s.z * 0.25) % H) + H) % H;
      c.globalAlpha = (0.25 + 0.55 * s.z) * (0.6 + 0.4 * Math.sin(visualTime * 2 + s.tw));
      c.fillRect(s.x, y, s.s, s.s);
    }
    c.globalAlpha = 1;

    // faint perspective grid near the bottom for depth
    c.strokeStyle = 'rgba(168,85,247,0.07)';
    c.lineWidth = 1;
    const gridOff = (-camY * 0.3) % 40;
    c.beginPath();
    for (let y = gridOff; y < H; y += 40) { c.moveTo(0, y); c.lineTo(W, y); }
    for (let x = 0; x <= W; x += 40) { c.moveTo(x, 0); c.lineTo(x, H); }
    c.stroke();
  }

  function drawPlatform(c, p) {
    const st = PLAT_STYLE[p.type];
    let x = p.x, y = p.y, alpha = 1;
    if (p.state === 'crumbling') { x += rand(-1.6, 1.6); y += rand(-1, 1); }
    if (p.state === 'vanishing') alpha = p.timer < 0.4 ? (Math.floor(p.timer * 22) % 2 ? 0.25 : 0.85) : 0.9;
    if (p.type === 'vanish' && p.state === 'idle') alpha = 0.75 + 0.2 * Math.sin(visualTime * 4 + p.x);

    c.save();
    c.globalAlpha = alpha;

    // bouncy pads have a spring underneath
    if (p.type === 'bouncy') {
      const cx = x + p.w / 2;
      const ext = 8 + p.bounceAnim * 8;
      c.strokeStyle = COLORS.green;
      c.lineWidth = 2;
      c.beginPath();
      for (let i = 0; i <= 6; i++) {
        c.lineTo(cx + (i % 2 ? 8 : -8), y + p.h + (ext * i) / 6);
      }
      c.stroke();
      y -= p.bounceAnim * 4;
    }

    c.shadowColor = st.color;
    c.shadowBlur = 12 + (p.glow > 0 ? p.glow * 70 : 0);
    roundRect(c, x, y, p.w, p.h, 6);
    c.fillStyle = st.fill;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = st.color;
    if (p.type === 'vanish') c.setLineDash([7, 5]);
    c.stroke();
    c.setLineDash([]);
    c.shadowBlur = 0;

    // top highlight
    c.fillStyle = 'rgba(255,255,255,0.45)';
    c.fillRect(x + 7, y + 2.5, p.w - 14, 1.5);

    // type decorations
    c.fillStyle = st.color;
    c.strokeStyle = st.color;
    if (p.type === 'moving') {
      const my = y + p.h / 2;
      c.beginPath();
      c.moveTo(x + 6, my); c.lineTo(x + 12, my - 4); c.lineTo(x + 12, my + 4);
      c.moveTo(x + p.w - 6, my); c.lineTo(x + p.w - 12, my - 4); c.lineTo(x + p.w - 12, my + 4);
      c.fill();
    } else if (p.type === 'bouncy') {
      const cx = x + p.w / 2;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(cx - 6, y + 10); c.lineTo(cx, y + 5); c.lineTo(cx + 6, y + 10);
      c.stroke();
    } else if (p.type === 'crumble') {
      c.lineWidth = 1.2;
      c.globalAlpha = alpha * 0.8;
      c.beginPath();
      for (let k = 1; k < 4; k++) {
        const kx = x + (p.w * k) / 4;
        c.moveTo(kx - 3, y + 2); c.lineTo(kx + 2, y + 7); c.lineTo(kx - 1, y + p.h - 2);
      }
      c.stroke();
    }

    if (p.spikes) drawSpikes(c, p, x, y);
    c.restore();
  }

  function drawSpikes(c, p, x, y) {
    const sx = x + (p.spikes.side === 0 ? 0 : p.w - p.spikes.w);
    const n = 3;
    const sw = p.spikes.w / n;
    const pulse = 0.6 + 0.4 * Math.sin(visualTime * 6);
    c.save();
    c.shadowColor = COLORS.red;
    c.shadowBlur = 10 + pulse * 8;
    c.fillStyle = COLORS.red;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      c.moveTo(sx + i * sw + 1, y);
      c.lineTo(sx + i * sw + sw / 2, y - 13);
      c.lineTo(sx + (i + 1) * sw - 1, y);
    }
    c.fill();
    c.restore();
  }

  function drawHazard(c, h) {
    c.save();
    c.translate(h.x, h.y);
    c.shadowColor = COLORS.red;
    c.shadowBlur = 16;
    if (h.kind === 'saw') {
      c.rotate(h.ang);
      c.fillStyle = COLORS.red;
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
      c.fillStyle = '#2a0b12';
      c.beginPath(); c.arc(0, 0, h.r - 7, 0, Math.PI * 2); c.fill();
      c.fillStyle = COLORS.amber;
      c.beginPath(); c.arc(0, 0, 3, 0, Math.PI * 2); c.fill();
    } else {
      const pulse = 0.5 + 0.5 * Math.sin(visualTime * 8);
      const g = c.createRadialGradient(0, 0, 2, 0, 0, h.r + 4);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, COLORS.amber);
      g.addColorStop(1, 'rgba(255,77,77,0.2)');
      c.fillStyle = g;
      c.beginPath(); c.arc(0, 0, h.r + pulse * 2, 0, Math.PI * 2); c.fill();
      // crackling electric ring
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

  /** The hero: a little neon robot with a visor, legs and squash/stretch. */
  function drawPlayer(c, x, y) {
    const p = player;
    const w = p.w, h = p.h;
    const grounded = p.ground !== null;
    c.save();
    c.translate(x + w / 2, y + h);

    // squash & stretch
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

    // legs
    const moving = Math.abs(p.vx) > 20;
    const swing = grounded && moving ? Math.sin(p.runPhase) * 4 : 0;
    const tuck = grounded ? 0 : p.vy < 0 ? 4 : -1;
    c.fillStyle = '#7dd3fc';
    c.fillRect(-9, -9 - Math.max(0, swing) - tuck, 7, 9);
    c.fillRect(2, -9 - Math.max(0, -swing) - tuck, 7, 9);

    // body
    const bob = grounded && moving ? Math.abs(Math.sin(p.runPhase)) * 1.5 : 0;
    const by = -h - bob;
    c.shadowColor = COLORS.cyan;
    c.shadowBlur = 16;
    const g = c.createLinearGradient(0, by, 0, by + h - 8);
    g.addColorStop(0, '#5ef2ff');
    g.addColorStop(1, '#7c3aed');
    c.fillStyle = g;
    roundRect(c, -w / 2, by, w, h - 8, 8);
    c.fill();
    c.shadowBlur = 0;
    c.lineWidth = 1.5;
    c.strokeStyle = 'rgba(255,255,255,0.75)';
    c.stroke();

    // antenna
    c.strokeStyle = '#c4b5fd';
    c.beginPath(); c.moveTo(0, by); c.lineTo(p.face * 3, by - 7); c.stroke();
    c.fillStyle = COLORS.green;
    c.shadowColor = COLORS.green;
    c.shadowBlur = 8;
    c.beginPath(); c.arc(p.face * 3, by - 8, 2.4, 0, Math.PI * 2); c.fill();
    c.shadowBlur = 0;

    // visor + eyes (look in facing direction; wide eyes when falling)
    c.fillStyle = '#0a1024';
    roundRect(c, -w / 2 + 4, by + 6, w - 8, 10, 4);
    c.fill();
    c.fillStyle = falling ? COLORS.red : COLORS.green;
    const eyeH = falling ? 5 : 3;
    const ex = p.face * 3;
    c.fillRect(ex - 6, by + 11 - eyeH / 2, 3, eyeH);
    c.fillRect(ex + 3, by + 11 - eyeH / 2, 3, eyeH);
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

  function drawLava(c) {
    const top = lavaY;
    const bottom = camY + H + 30;
    if (top > bottom) return;
    const t = visualTime;

    // glow above the surface
    const glow = c.createLinearGradient(0, top - 90, 0, top);
    glow.addColorStop(0, 'rgba(255,77,77,0)');
    glow.addColorStop(1, 'rgba(255,77,77,0.28)');
    c.fillStyle = glow;
    c.fillRect(0, top - 90, W, 90);

    // wavy body
    c.beginPath();
    c.moveTo(0, bottom);
    for (let x = 0; x <= W; x += 12) {
      c.lineTo(x, top + Math.sin(x * 0.03 + t * 2.2) * 3 + Math.sin(x * 0.075 - t * 3.1) * 2);
    }
    c.lineTo(W, bottom);
    c.closePath();
    const g = c.createLinearGradient(0, top, 0, top + 110);
    g.addColorStop(0, '#FF7A45');
    g.addColorStop(0.15, COLORS.red);
    g.addColorStop(1, '#3b0712');
    c.fillStyle = g;
    c.shadowColor = COLORS.red;
    c.shadowBlur = 25;
    c.fill();
    c.shadowBlur = 0;

    // hot surface line
    c.strokeStyle = '#FFD27A';
    c.lineWidth = 2;
    c.beginPath();
    for (let x = 0; x <= W; x += 12) {
      const y = top + Math.sin(x * 0.03 + t * 2.2) * 3 + Math.sin(x * 0.075 - t * 3.1) * 2;
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();

    // bubbles drifting inside
    c.fillStyle = 'rgba(255,210,122,0.35)';
    for (let i = 0; i < 7; i++) {
      const bx = (i * 83 + t * (12 + i * 3)) % W;
      const by = top + 14 + ((i * 37 + t * 18) % 30);
      c.beginPath(); c.arc(bx, by, 2 + (i % 3), 0, Math.PI * 2); c.fill();
    }
  }

  /** Red edge warning that grows as the player gets close to the lava. */
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
    Sound.init();
    resetRun();
    clearInput();
    ui.toast.classList.remove('show');
    accumulator = 0;
    setState('playing');
  }

  function togglePause() {
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
    ui.overCause.textContent = run.cause === 'lava' ? 'You touched the floor.' : run.cause === 'spikes' ? 'Spiked! Watch the red edges.' : 'A hazard got you.';
    ui.overDetail.textContent = run.heightM + ' m climbed · ' + formatTime(run.time) + ' survived · stage ' + run.stage;
    ui.menuBest.textContent = best;
    if (isRecord && final > 0 && run.prevBest > 0) Sound.record();
    ui.toast.classList.remove('show');
    gameOverAt = performance.now();
    setState('gameover');
  }

  function goToMenu() {
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
      case 'play':
      case 'again':
        if (state === 'gameover' && performance.now() - gameOverAt < 300) return;
        startGame();
        break;
      case 'restart': startGame(); break;
      case 'resume': resume(); break;
      case 'pause': togglePause(); break;
      case 'menu': goToMenu(); break;
      case 'mute': toggleMute(); break;
    }
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
    else if (state === 'menu') stepMenu(dt);
    else if (state === 'gameover') {
      updatePlatforms(dt, run.time);
      updateHazards(dt, run.time);
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
    }
    render();
  }

  function boot() {
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

    // Touch device detection -> show on-screen controls.
    const markTouch = () => document.body.classList.add('is-touch');
    if ((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window) markTouch();
    window.addEventListener('touchstart', markTouch, { once: true, passive: true });

    // Losing focus / hiding the tab: pause and drop held keys, no physics jump on return.
    window.addEventListener('blur', () => {
      clearInput();
      if (state === 'playing' && !run.dead) togglePause();
    });
    document.addEventListener('visibilitychange', () => {
      lastTs = 0;
      accumulator = 0;
      if (document.hidden) {
        clearInput();
        if (state === 'playing' && !run.dead) togglePause();
      }
    });

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
    input,
    /** Simulate `sec` seconds instantly (handy for automated tests). */
    advance(sec) {
      for (let t = 0; t < sec; t += STEP) {
        if (state === 'paused') break;
        step(STEP);
      }
      if (state === 'playing') updateHud(false);
      render();
    },
  };

  boot();
})();
