/* ══════════════════════════════════════════════════════════════════
   Speed Runner Pro - game.js
   Complete game engine with all systems
   ══════════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────────────────────────
   SAVE SYSTEM (encrypted with btoa)
   ───────────────────────────────────────────────────────────────── */
const SaveSystem = (() => {
  const KEY = 'srp_v1';
  const defaults = {
    bestScore: 0,
    totalCoins: 0,
    totalJumps: 0,
    totalGames: 0,
    selectedChar: 'boy',
    ownedItems: ['boy'],
    activeEffects: {},
    achievements: {},
    leaderboard: [],
    settings: { muted: false, theme: 'dark' }
  };

  function encode(obj) {
    try { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }
    catch(e) { return JSON.stringify(obj); }
  }
  function decode(str) {
    try { return JSON.parse(decodeURIComponent(escape(atob(str)))); }
    catch(e) { try { return JSON.parse(str); } catch(e2) { return null; } }
  }

  let data = null;

  function load() {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = decode(raw);
      data = parsed ? { ...defaults, ...parsed } : { ...defaults };
    } else {
      data = { ...defaults };
    }
    return data;
  }

  function save() {
    localStorage.setItem(KEY, encode(data));
  }

  function get(key) { return data ? data[key] : defaults[key]; }

  function set(key, value) {
    data[key] = value;
    save();
  }

  function update(key, updater) {
    data[key] = updater(data[key]);
    save();
  }

  return { load, save, get, set, update };
})();

/* ─────────────────────────────────────────────────────────────────
   AUDIO SYSTEM
   ───────────────────────────────────────────────────────────────── */
const AudioSystem = (() => {
  const sounds = {};
  let muted = false;
  let musicPlaying = false;

  // ── AudioContext-based engine (prevents media notification bar) ──
  let ctx = null;
  let musicSource = null;
  let musicBuffer = null;
  let musicGain = null;
  let masterGain = null;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 1;
      masterGain.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.4;
      musicGain.connect(masterGain);
      // ── Prevent browser media session / notification bar ──────────
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
        // Remove all media session action handlers
        ['play','pause','stop','seekbackward','seekforward',
         'previoustrack','nexttrack'].forEach(action => {
          try { navigator.mediaSession.setActionHandler(action, null); } catch(e) {}
        });
      }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  async function decodeAudio(src) {
    return new Promise((resolve, reject) => {
      const req = new XMLHttpRequest();
      req.open('GET', src, true);
      req.responseType = 'arraybuffer';
      req.onload = () => {
        getCtx().decodeAudioData(req.response, resolve, reject);
      };
      req.onerror = reject;
      req.send();
    });
  }

  async function preload(files) {
    getCtx(); // init context early
    const promises = files.map(async ({ key, src, loop = false, volume = 1 }) => {
      try {
        const buffer = await decodeAudio(src);
        sounds[key] = { buffer, loop, volume };
      } catch(e) {
        // Fallback: store null, game will skip
        sounds[key] = null;
      }
    });
    await Promise.allSettled(promises);
  }

  function play(key) {
    if (muted || !sounds[key] || !sounds[key].buffer) return;
    const { buffer, volume } = sounds[key];
    const c = getCtx();
    const gainNode = c.createGain();
    gainNode.gain.value = volume;
    gainNode.connect(masterGain);
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.connect(gainNode);
    source.start(0);
    // Auto-cleanup
    source.onended = () => { gainNode.disconnect(); };
  }

  function startMusic() {
    if (muted || musicPlaying || !sounds.music || !sounds.music.buffer) return;
    const c = getCtx();
    if (musicSource) { try { musicSource.stop(); } catch(e) {} }
    musicSource = c.createBufferSource();
    musicSource.buffer = sounds.music.buffer;
    musicSource.loop = true;
    musicSource.connect(musicGain);
    musicSource.start(0);
    musicPlaying = true;
  }

  function stopMusic() {
    if (musicSource) {
      try { musicSource.stop(); } catch(e) {}
      musicSource = null;
    }
    musicPlaying = false;
  }

  function toggleMute() {
    muted = !muted;
    if (muted) {
      stopMusic();
      if (masterGain) masterGain.gain.value = 0;
    } else {
      if (masterGain) masterGain.gain.value = 1;
      startMusic();
    }
    SaveSystem.update('settings', s => ({ ...s, muted }));
    return muted;
  }

  function setMuted(val) {
    muted = val;
    if (muted) stopMusic();
  }

  function isMuted() { return muted; }

  // Resume AudioContext on first user interaction (browser policy)
  function resumeOnInteraction() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  return { preload, play, startMusic, stopMusic, toggleMute, setMuted, isMuted, resumeOnInteraction, getCtx };
})();

/* ─────────────────────────────────────────────────────────────────
   ASSET LOADER
   ───────────────────────────────────────────────────────────────── */
const AssetLoader = (() => {
  const images = {};

  async function loadImages(list) {
    const promises = list.map(({ key, src }) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { images[key] = img; resolve(); };
        img.onerror = () => { console.warn(`Failed to load: ${src}`); resolve(); };
        img.src = src;
      })
    );
    await Promise.all(promises);
  }

  function get(key) { return images[key] || null; }

  return { loadImages, get };
})();

/* ─────────────────────────────────────────────────────────────────
   OBJECT POOL — prevent garbage collection spikes
   ───────────────────────────────────────────────────────────────── */
class ObjectPool {
  constructor(factory, maxSize = 30) {
    this.pool = [];
    this.active = [];
    this.factory = factory;
    this.maxSize = maxSize;
  }

  acquire(initFn) {
    let obj = this.pool.pop() || this.factory();
    if (initFn) initFn(obj);
    obj.active = true;
    this.active.push(obj);
    return obj;
  }

  release(obj) {
    obj.active = false;
    const idx = this.active.indexOf(obj);
    if (idx !== -1) this.active.splice(idx, 1);
    if (this.pool.length < this.maxSize) this.pool.push(obj);
  }

  releaseInactive() {
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (!this.active[i].active) {
        this.pool.push(this.active.splice(i, 1)[0]);
      }
    }
  }

  clear() { this.active.length = 0; this.pool.length = 0; }
}

/* ─────────────────────────────────────────────────────────────────
   PARTICLE SYSTEM
   ───────────────────────────────────────────────────────────────── */
class ParticleSystem {
  constructor() {
    this.particles = [];
  }

  emit(x, y, options = {}) {
    const count = options.count || 8;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 / count) * i + (Math.random() - .5) * .8;
      const speed = (options.speed || 3) * (.5 + Math.random() * .5);
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        life: 1,
        decay: options.decay || .04,
        size: options.size || 5,
        color: options.color || '#f9ca24'
      });
    }
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      p.vy += .15 * dt * 60;
      p.life -= p.decay * dt * 60;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  draw(ctx) {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  clear() { this.particles.length = 0; }
}

/* ─────────────────────────────────────────────────────────────────
   PLAYER CLASS
   ───────────────────────────────────────────────────────────────── */
class Player {
  constructor(canvas) {
    this.canvas = canvas;
    this.w = 52;
    this.h = 64;
    this.x = 80;
    this.groundY = 0;
    this.y = 0;
    this.vy = 0;
    this.gravity = 1400;
    this.jumpForce = -620;
    this.isOnGround = true;
    this.isSliding = false;
    this.isDead = false;
    this.isShielded = false;
    this.canDoubleJump = false;
    this.hasDoubleJump = false;
    this.jumpCount = 0;
    this.jumpTotal = 0;
    this.slideTimer = 0;
    this.slideDuration = 0.6;
    this.animFrame = 0;
    this.animTimer = 0;
    this.invincible = false;
    this.invincibleTimer = 0;

    // Hitbox (smaller than sprite for fairness)
    this.hitboxOffsetX = 6;
    this.hitboxOffsetY = 4;
    this.hitboxW = this.w - 12;
    this.hitboxH = this.h - 8;
    this.slideHitboxH = 32;
  }

  resize(groundY) {
    this.groundY = groundY;
    if (this.isOnGround) this.y = this.groundY - this.h;
  }

  jump() {
    if (this.isSliding) { this.stopSlide(); return; }
    if (this.isOnGround) {
      this.vy = this.jumpForce;
      this.isOnGround = false;
      this.jumpCount = 1;
      this.jumpTotal++;
      AudioSystem.play('jump');
    } else if (this.hasDoubleJump && this.jumpCount < 2) {
      this.vy = this.jumpForce * .85;
      this.jumpCount++;
      this.jumpTotal++;
      AudioSystem.play('jump');
    }
  }

  slide() {
    if (!this.isOnGround || this.isSliding) return;
    this.isSliding = true;
    this.slideTimer = this.slideDuration;
    AudioSystem.play('slide');
  }

  stopSlide() {
    this.isSliding = false;
    this.slideTimer = 0;
  }

  setShield(on) {
    this.isShielded = on;
    if (on) { this.invincible = true; }
  }

  takeDamage() {
    if (this.invincible) {
      // shield absorbs hit
      this.isShielded = false;
      this.invincible = true;
      this.invincibleTimer = 1.5;
      return false; // survived
    }
    return true; // died
  }

  update(dt) {
    if (this.isDead) return;

    // Slide timer
    if (this.isSliding) {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0) this.stopSlide();
    }

    // Gravity
    if (!this.isOnGround) {
      this.vy += this.gravity * dt;
      this.y += this.vy * dt;
    }

    // Land
    if (this.y >= this.groundY - this.h) {
      this.y = this.groundY - this.h;
      this.vy = 0;
      this.isOnGround = true;
      this.jumpCount = 0;
    }

    // Invincibility flash timer
    if (this.invincibleTimer > 0) {
      this.invincibleTimer -= dt;
      if (this.invincibleTimer <= 0) {
        this.invincibleTimer = 0;
        this.invincible = false;
      }
    }

    // Animate
    this.animTimer += dt;
    if (this.animTimer > .1) { this.animTimer = 0; this.animFrame = (this.animFrame + 1) % 4; }
  }

  getHitbox() {
    const h = this.isSliding ? this.slideHitboxH : this.hitboxH;
    const yOff = this.isSliding ? (this.h - this.slideHitboxH) : this.hitboxOffsetY;
    return {
      x: this.x + this.hitboxOffsetX,
      y: this.y + yOff,
      w: this.hitboxW,
      h
    };
  }

  draw(ctx) {
    if (this.isDead) return;

    // Invincibility flash
    if (this.invincible && Math.floor(this.invincibleTimer * 10) % 2 === 0) return;

    const img = AssetLoader.get('player');
    const drawY = this.isSliding ? this.y + (this.h - this.slideHitboxH) : this.y;
    const drawH = this.isSliding ? this.slideHitboxH : this.h;

    ctx.save();
    // Subtle bounce when running
    const bounce = this.isOnGround ? Math.sin(this.animFrame * Math.PI * .5) * 2 : 0;
    ctx.translate(this.x + this.w / 2, drawY + drawH / 2 + bounce);

    // Shield glow
    if (this.isShielded) {
      ctx.shadowColor = '#3498db';
      ctx.shadowBlur = 20;
      ctx.strokeStyle = 'rgba(52,152,219,.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(this.w, drawH) / 2 + 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (img) {
      ctx.drawImage(img, -this.w / 2, -drawH / 2, this.w, drawH);
    } else {
      // Fallback shape
      ctx.fillStyle = '#3498db';
      ctx.fillRect(-this.w / 2, -drawH / 2, this.w, drawH);
      ctx.fillStyle = '#f0a070';
      ctx.fillRect(-14, -drawH / 2 - 14, 28, 28);
    }

    ctx.restore();
  }
}

/* ─────────────────────────────────────────────────────────────────
   OBSTACLE CLASS (pooled)
   ───────────────────────────────────────────────────────────────── */
class Obstacle {
  constructor() { this.reset(); }

  reset() {
    this.x = 0; this.y = 0;
    this.w = 52; this.h = 64;
    this.type = 'normal'; // normal | tall | flying
    this.active = false;
    this.speed = 0;
  }

  init(canvasW, groundY, speed, variant) {
    this.speed = speed;
    this.active = true;
    this.x = canvasW + 50;
    this.type = variant || 'normal';

    switch (this.type) {
      case 'normal':
        this.w = 52; this.h = 64;
        this.y = groundY - this.h;
        break;
      case 'tall':
        this.w = 44; this.h = 96;
        this.y = groundY - this.h;
        break;
      case 'flying':
        this.w = 52; this.h = 40;
        this.y = groundY - 130;
        break;
      case 'small':
        this.w = 36; this.h = 36;
        this.y = groundY - this.h;
        break;
    }
  }

  update(dt) {
    this.x -= this.speed * dt;
  }

  getHitbox() {
    return { x: this.x + 6, y: this.y + 4, w: this.w - 12, h: this.h - 8 };
  }

  draw(ctx) {
    const img = AssetLoader.get('obstacle');
    ctx.save();
    if (this.type === 'flying') {
      ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
      ctx.rotate(Math.sin(Date.now() * .003) * .08);
      if (img) ctx.drawImage(img, -this.w / 2, -this.h / 2, this.w, this.h);
      else { ctx.fillStyle = '#e74c3c'; ctx.fillRect(-this.w/2, -this.h/2, this.w, this.h); }
    } else {
      if (img) ctx.drawImage(img, this.x, this.y, this.w, this.h);
      else { ctx.fillStyle = '#e74c3c'; ctx.fillRect(this.x, this.y, this.w, this.h); }
    }

    if (this.type === 'tall') {
      ctx.fillStyle = 'rgba(231,76,60,.3)';
      ctx.fillRect(this.x, this.y, this.w, this.h);
    }
    ctx.restore();
  }
}

/* ─────────────────────────────────────────────────────────────────
   COIN CLASS (pooled)
   ───────────────────────────────────────────────────────────────── */
class Coin {
  constructor() { this.reset(); }

  reset() {
    this.x = 0; this.y = 0; this.w = 28; this.h = 28;
    this.active = false; this.speed = 0; this.animTimer = 0;
  }

  init(x, y, speed) {
    this.x = x; this.y = y; this.speed = speed; this.active = true; this.animTimer = 0;
  }

  update(dt) {
    this.x -= this.speed * dt;
    this.animTimer += dt;
  }

  getHitbox() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }

  draw(ctx) {
    const img = AssetLoader.get('coin');
    const bob = Math.sin(this.animTimer * 4) * 3;
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2 + bob);
    const scale = .9 + Math.sin(this.animTimer * 3) * .1;
    ctx.scale(scale, 1);
    if (img) ctx.drawImage(img, -this.w / 2, -this.h / 2, this.w, this.h);
    else {
      ctx.fillStyle = '#f9ca24';
      ctx.beginPath(); ctx.arc(0, 0, this.w / 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

/* ─────────────────────────────────────────────────────────────────
   POWER-UP CLASS (pooled)
   ───────────────────────────────────────────────────────────────── */
class PowerUp {
  constructor() { this.reset(); }

  reset() {
    this.x = 0; this.y = 0; this.w = 40; this.h = 40;
    this.type = 'shield'; this.active = false; this.speed = 0; this.animTimer = 0;
  }

  static TYPES = ['shield', 'slowmo', 'magnet', 'doubleJump'];
  static COLORS = { shield: '#3498db', slowmo: '#9b59b6', magnet: '#e74c3c', doubleJump: '#2ecc71' };
  static ICONS  = { shield: '🛡️', slowmo: '⏱️', magnet: '🧲', doubleJump: '⬆⬆' };

  init(x, y, speed) {
    const types = PowerUp.TYPES;
    this.type = types[Math.floor(Math.random() * types.length)];
    this.x = x; this.y = y; this.speed = speed; this.active = true; this.animTimer = 0;
  }

  update(dt) {
    this.x -= this.speed * dt;
    this.animTimer += dt;
  }

  getHitbox() { return { x: this.x + 4, y: this.y + 4, w: this.w - 8, h: this.h - 8 }; }

  draw(ctx) {
    const bob = Math.sin(this.animTimer * 3) * 4;
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2 + bob);
    const glow = PowerUp.COLORS[this.type];
    ctx.shadowColor = glow; ctx.shadowBlur = 16;
    const img = AssetLoader.get('powerup');
    if (img) { ctx.drawImage(img, -this.w / 2, -this.h / 2, this.w, this.h); }
    else {
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(0, 0, this.w / 2, 0, Math.PI * 2); ctx.fill();
    }
    // Type icon
    ctx.shadowBlur = 0;
    ctx.font = '14px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(PowerUp.ICONS[this.type] || '⚡', 0, 0);
    ctx.restore();
  }
}

/* ─────────────────────────────────────────────────────────────────
   BACKGROUND SYSTEM (parallax layers)
   ───────────────────────────────────────────────────────────────── */
class BackgroundSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.layers = [
      { x: 0, speed: 0.1, img: null },  // far sky/buildings
      { x: 0, speed: 0.3, img: null },  // mid buildings
      { x: 0, speed: 1.0, img: null },  // ground (same speed as obstacles)
    ];
    this.groundY = 0;
    this.bgX = 0;
  }

  update(dt, gameSpeed) {
    this.bgX -= gameSpeed * dt;
    if (this.bgX <= -this.canvas.width) this.bgX += this.canvas.width;
  }

  draw(ctx, gameSpeed) {
    const bg = AssetLoader.get('bg');
    const W = this.canvas.width, H = this.canvas.height;

    if (bg) {
      // Tile background
      const bgW = bg.width;
      const bgH = bg.height;
      const scale = H / bgH;
      const scaledW = bgW * scale;
      let drawX = this.bgX % scaledW;
      if (drawX > 0) drawX -= scaledW;
      while (drawX < W) {
        ctx.drawImage(bg, drawX, 0, scaledW, H);
        drawX += scaledW;
      }
    } else {
      // Fallback gradient background
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#1a1a2e');
      grad.addColorStop(0.7, '#16213e');
      grad.addColorStop(1, '#0f3460');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }
  }

  drawGround(ctx, groundY) {
    const W = this.canvas.width;
    // Ground platform
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, groundY, W, this.canvas.height - groundY);
    // Rail lines
    ctx.fillStyle = '#555';
    ctx.fillRect(0, groundY + 4, W, 6);
    ctx.fillRect(0, groundY + 28, W, 6);
    // Sleepers (scrolling)
    ctx.fillStyle = '#3d2b1f';
    const sleeperSpacing = 32;
    const offset = (Date.now() * .3) % sleeperSpacing;
    for (let x = -offset; x < W + sleeperSpacing; x += sleeperSpacing) {
      ctx.fillRect(x, groundY + 4, 22, 30);
    }
  }
}

/* ─────────────────────────────────────────────────────────────────
   SCORE SYSTEM
   ───────────────────────────────────────────────────────────────── */
class ScoreSystem {
  constructor() {
    this.score = 0;
    this.coins = 0;
    this.multiplier = 1;
    this.magnetActive = false;
    this.magnetTimer = 0;
  }

  reset() {
    this.score = 0; this.coins = 0;
    this.multiplier = 1; this.magnetActive = false; this.magnetTimer = 0;
  }

  addScore(pts) {
    this.score += Math.floor(pts * this.multiplier);
  }

  addCoin() {
    this.coins++;
    this.score += Math.floor(10 * this.multiplier);
  }

  update(dt) {
    if (this.magnetTimer > 0) {
      this.magnetTimer -= dt;
      if (this.magnetTimer <= 0) { this.magnetActive = false; }
    }
  }

  activateMagnet(duration = 8) {
    this.magnetActive = true;
    this.magnetTimer = duration;
  }
}

/* ─────────────────────────────────────────────────────────────────
   ACHIEVEMENT SYSTEM
   ───────────────────────────────────────────────────────────────── */
const AchievementSystem = (() => {
  const defs = [
    { id: 'score1k',    icon: '⭐', name: '1000 نقطة',         desc: 'اجمع 1000 نقطة',       check: s => s.score >= 1000 },
    { id: 'score5k',    icon: '🌟', name: '5000 نقطة',         desc: 'اجمع 5000 نقطة',       check: s => s.score >= 5000 },
    { id: 'score10k',   icon: '💫', name: '10000 نقطة',        desc: 'اجمع 10000 نقطة',      check: s => s.score >= 10000 },
    { id: 'jumps50',    icon: '🦘', name: '50 قفزة',           desc: 'اقفز 50 مرة إجمالاً',   check: (s,d) => d.totalJumps >= 50 },
    { id: 'coins200',   icon: '🪙', name: '200 عملة',          desc: 'اجمع 200 عملة إجمالاً', check: (s,d) => d.totalCoins >= 200 },
    { id: 'games10',    icon: '🎮', name: '10 ألعاب',          desc: 'العب 10 مرات',          check: (s,d) => d.totalGames >= 10 },
    { id: 'noCoins',    icon: '💎', name: 'جامع مواظب',        desc: 'اجمع 20 عملة في لعبة', check: s => s.coins >= 20 },
    { id: 'speedDemon', icon: '⚡', name: 'وحش السرعة',        desc: '500 نقطة بدون قفز',    check: s => false }, // special
  ];

  function check(sessionScore, sessionCoins) {
    const saved = SaveSystem.get('achievements') || {};
    const data = { totalJumps: SaveSystem.get('totalJumps'), totalCoins: SaveSystem.get('totalCoins'), totalGames: SaveSystem.get('totalGames') };
    const sessionData = { score: sessionScore, coins: sessionCoins };
    const newUnlocks = [];

    for (const def of defs) {
      if (!saved[def.id] && def.check(sessionData, data)) {
        saved[def.id] = true;
        newUnlocks.push(def);
      }
    }

    if (newUnlocks.length) {
      SaveSystem.set('achievements', saved);
    }
    return newUnlocks;
  }

  function getDefs() { return defs; }
  function getSaved() { return SaveSystem.get('achievements') || {}; }

  return { check, getDefs, getSaved };
})();

/* ─────────────────────────────────────────────────────────────────
   SHOP SYSTEM
   ───────────────────────────────────────────────────────────────── */
const ShopSystem = (() => {
  const items = [
    { id: 'girl',       category: 'char',    icon: '👧', name: 'شخصية البنت',     desc: 'شخصية بديلة',         price: 500,  type: 'unlock' },
    { id: 'x2score',    category: 'effect',  icon: '×2', name: 'مضاعف النقاط',    desc: 'ضاعف نقاطك لمدة لعبة', price: 300,  type: 'consumable', uses: 3 },
    { id: 'jumpTrail',  category: 'effect',  icon: '🌟', name: 'أثر القفز',       desc: 'جزيئات ذهبية عند القفز',price: 200, type: 'cosmetic' },
    { id: 'startShield',category: 'effect',  icon: '🛡️', name: 'درع البداية',     desc: 'ابدأ بدرع جاهز',       price: 400,  type: 'consumable', uses: 3 },
  ];

  function getItems() { return items; }

  function buy(id) {
    const item = items.find(i => i.id === id);
    if (!item) return { success: false, msg: 'عنصر غير موجود' };
    const owned = SaveSystem.get('ownedItems') || [];
    if (owned.includes(id)) return { success: false, msg: 'تملكه بالفعل' };
    const coins = SaveSystem.get('totalCoins');
    if (coins < item.price) return { success: false, msg: 'عملات غير كافية' };
    SaveSystem.update('totalCoins', c => c - item.price);
    SaveSystem.update('ownedItems', arr => [...arr, id]);
    return { success: true, msg: `تم شراء ${item.name}!` };
  }

  function isOwned(id) { return (SaveSystem.get('ownedItems') || []).includes(id); }

  return { getItems, buy, isOwned };
})();

/* ─────────────────────────────────────────────────────────────────
   SPAWN SYSTEM — smart anti-impossible spawning
   ───────────────────────────────────────────────────────────────── */
class SpawnSystem {
  constructor() {
    this.obstacleTimer = 0;
    this.coinTimer = 0;
    this.powerupTimer = 0;
    this.lastObstacleType = null;
    this.consecutiveSame = 0;
    this.minObstacleGap = 1.8;
    this.maxObstacleGap = 3.2;
    this.nextObstacleTime = 2.0;
    this.nextCoinTime = 1.5;
    this.nextPowerupTime = 12;
  }

  reset() {
    this.obstacleTimer = 0; this.coinTimer = 0; this.powerupTimer = 0;
    this.nextObstacleTime = 2.0; this.nextCoinTime = 1.5; this.nextPowerupTime = 12;
    this.lastObstacleType = null; this.consecutiveSame = 0;
  }

  update(dt, difficulty, callbacks) {
    this.obstacleTimer += dt;
    this.coinTimer += dt;
    this.powerupTimer += dt;

    // Scale gaps with difficulty (harder = shorter gaps, min 0.9s)
    const minGap = Math.max(0.9, this.minObstacleGap - difficulty * 0.04);
    const maxGap = Math.max(1.4, this.maxObstacleGap - difficulty * 0.04);

    if (this.obstacleTimer >= this.nextObstacleTime) {
      this.obstacleTimer = 0;
      this.nextObstacleTime = minGap + Math.random() * (maxGap - minGap);
      const variant = this.pickVariant(difficulty);
      callbacks.spawnObstacle(variant);
    }

    if (this.coinTimer >= this.nextCoinTime) {
      this.coinTimer = 0;
      this.nextCoinTime = 0.8 + Math.random() * 1.8;
      callbacks.spawnCoins();
    }

    if (this.powerupTimer >= this.nextPowerupTime) {
      this.powerupTimer = 0;
      this.nextPowerupTime = 10 + Math.random() * 10;
      callbacks.spawnPowerup();
    }
  }

  pickVariant(difficulty) {
    const variants = ['normal', 'normal', 'normal'];
    if (difficulty > 3) variants.push('small', 'tall');
    if (difficulty > 6) variants.push('flying', 'flying');
    if (difficulty > 10) variants.push('tall', 'flying');

    let variant;
    let tries = 0;
    do {
      variant = variants[Math.floor(Math.random() * variants.length)];
      tries++;
    } while (variant === this.lastObstacleType && this.consecutiveSame >= 2 && tries < 10);

    if (variant === this.lastObstacleType) this.consecutiveSame++;
    else { this.consecutiveSame = 0; this.lastObstacleType = variant; }

    return variant;
  }
}

/* ─────────────────────────────────────────────────────────────────
   GAME ENGINE — main controller
   ───────────────────────────────────────────────────────────────── */
const GameEngine = (() => {

  // ── Core vars
  let canvas, ctx;
  let animFrameId = null;
  let lastTime = 0;
  let state = 'idle'; // idle | playing | paused | dead

  // ── Systems
  let player;
  let bgSystem;
  let scoreSystem;
  let spawnSystem;
  let particles;
  let obstaclePool;
  let coinPool;
  let powerupPool;

  // ── Difficulty
  let gameSpeed = 320;          // px/s
  const BASE_SPEED = 320;
  const MAX_SPEED = 720;
  let difficulty = 0;           // 0..15+
  let distanceTravelled = 0;
  let slowmoActive = false;
  let slowmoTimer = 0;

  // ── FPS
  let fps = 0;
  let fpsTimer = 0;
  let frameCount = 0;
  let devMode = false;

  // ── Active power-up info
  let activePowerupType = null;
  let activePowerupTimer = 0;

  // ── Canvas size
  let W = 800, H = 400, groundY = 0;

  // ── Debounce jump
  let jumpCooldown = 0;

  // ─────────── INIT ───────────────────────────────────────────────
  function init() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', () => { resize(); if (player) player.resize(groundY); });
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state === 'playing') togglePause();
    });
    // Dev mode: Ctrl+D
    window.addEventListener('keydown', e => {
      if (e.ctrlKey && e.key === 'd') { e.preventDefault(); devMode = !devMode; }
    });

    // ── Full-screen tap / click to jump ──────────────────────────
    // touchstart للموبايل (بدون تأخير 300ms)
    canvas.addEventListener('touchstart', e => {
      e.preventDefault(); // يمنع zoom وscroll
      AudioSystem.resumeOnInteraction();
      if (state !== 'playing') return;
      const touch = e.changedTouches[0];
      spawnRipple(touch.clientX, touch.clientY);
      dismissTouchHint();
      if (jumpCooldown <= 0) { player.jump(); jumpCooldown = 0.12; }
    }, { passive: false });

    // click للماوس / desktop
    canvas.addEventListener('mousedown', e => {
      AudioSystem.resumeOnInteraction();
      if (state !== 'playing') return;
      spawnRipple(e.clientX, e.clientY);
      dismissTouchHint();
      if (jumpCooldown <= 0) { player.jump(); jumpCooldown = 0.12; }
    });
  }

  // تأثير دائرة عند اللمس
  function spawnRipple(x, y) {
    const container = document.getElementById('gameContainer');
    const r = document.createElement('div');
    r.className = 'tap-ripple';
    const size = 60;
    r.style.cssText = `width:${size}px;height:${size}px;left:${x - size/2}px;top:${y - size/2}px;`;
    container.appendChild(r);
    setTimeout(() => r.remove(), 450);
  }

  // إخفاء تلميح اللمس عند أول ضغطة
  let hintDismissed = false;
  function dismissTouchHint() {
    if (hintDismissed) return;
    hintDismissed = true;
    const hint = document.getElementById('touchHint');
    if (hint) { hint.classList.add('fade-out'); setTimeout(() => hint.remove(), 500); }
  }

  function resize() {
    W = canvas.offsetWidth || window.innerWidth;
    H = canvas.offsetHeight || (window.innerHeight - 120);
    canvas.width = W;
    canvas.height = H;
    groundY = H - 60;
  }

  // ─────────── START ──────────────────────────────────────────────
  function start(charType) {
    // Init all systems fresh
    player        = new Player(canvas);
    bgSystem      = new BackgroundSystem(canvas);
    scoreSystem   = new ScoreSystem();
    spawnSystem   = new SpawnSystem();
    particles     = new ParticleSystem();

    obstaclePool  = new ObjectPool(() => new Obstacle(), 20);
    coinPool      = new ObjectPool(() => new Coin(), 40);
    powerupPool   = new ObjectPool(() => new PowerUp(), 6);

    gameSpeed       = BASE_SPEED;
    difficulty      = 0;
    distanceTravelled = 0;
    slowmoActive    = false;
    slowmoTimer     = 0;
    activePowerupType = null;
    activePowerupTimer = 0;
    jumpCooldown    = 0;
    state           = 'playing';

    player.resize(groundY);

    // Start shield if purchased
    if (ShopSystem.isOwned('startShield')) {
      player.setShield(true);
    }

    // Score multiplier
    if (ShopSystem.isOwned('x2score')) {
      scoreSystem.multiplier = 2;
    }

    AudioSystem.startMusic();

    // Start loop
    lastTime = performance.now();
    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = requestAnimationFrame(loop);
  }

  // ─────────── MAIN LOOP ──────────────────────────────────────────
  function loop(timestamp) {
    animFrameId = requestAnimationFrame(loop);

    let rawDt = Math.min((timestamp - lastTime) / 1000, .05); // cap at 50ms
    lastTime = timestamp;

    // FPS counter
    frameCount++;
    fpsTimer += rawDt;
    if (fpsTimer >= .5) {
      fps = Math.round(frameCount / fpsTimer);
      frameCount = 0; fpsTimer = 0;
      if (devMode) document.getElementById('fpsDisplay').textContent = `FPS: ${fps}`;
    }

    if (state === 'paused' || state === 'dead') {
      render(0);
      return;
    }

    // Delta time (slowmo modifier)
    const dt = slowmoActive ? rawDt * 0.35 : rawDt;

    update(dt, rawDt);
    render(dt);
  }

  // ─────────── UPDATE ─────────────────────────────────────────────
  function update(dt, rawDt) {
    if (jumpCooldown > 0) jumpCooldown -= rawDt;

    // Slow-mo timer
    if (slowmoActive) {
      slowmoTimer -= rawDt;
      if (slowmoTimer <= 0) { slowmoActive = false; }
    }

    // Power-up timer
    if (activePowerupTimer > 0) {
      activePowerupTimer -= rawDt;
      if (activePowerupTimer <= 0) {
        deactivatePowerup();
      }
      const el = document.getElementById('powerupIndicator');
      el.classList.remove('hidden');
      el.textContent = `${PowerUp.ICONS[activePowerupType] || '⚡'} ${activePowerupTimer.toFixed(1)}s`;
    }

    // Score / distance
    scoreSystem.addScore(gameSpeed * dt * 0.03);
    scoreSystem.update(dt);
    distanceTravelled += gameSpeed * rawDt;

    // Progressive difficulty
    difficulty = distanceTravelled / 1500;
    gameSpeed = Math.min(MAX_SPEED, BASE_SPEED + difficulty * 25);

    // Magnet: pull nearby coins
    if (scoreSystem.magnetActive) {
      for (const c of coinPool.active) {
        if (!c.active) continue;
        const dx = player.x + player.w / 2 - (c.x + c.w / 2);
        const dy = player.y + player.h / 2 - (c.y + c.h / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 180) {
          c.x += dx * .12;
          c.y += dy * .12;
        }
      }
    }

    // Update player
    player.update(dt);

    // Update spawner
    spawnSystem.update(rawDt, difficulty, {
      spawnObstacle: (variant) => {
        if (obstaclePool.active.length < 12) {
          const o = obstaclePool.acquire();
          o.init(W, groundY, gameSpeed, variant);
        }
      },
      spawnCoins: () => {
        const patterns = ['line', 'arc', 'cluster'];
        const pattern = patterns[Math.floor(Math.random() * patterns.length)];
        const baseX = W + 60;
        const count = 3 + Math.floor(Math.random() * 5);
        for (let i = 0; i < count; i++) {
          if (coinPool.active.length >= 30) break;
          const c = coinPool.acquire();
          const gapH = groundY - 40;
          if (pattern === 'line') {
            c.init(baseX + i * 38, groundY - 80 - Math.random() * (gapH * .5), gameSpeed);
          } else if (pattern === 'arc') {
            const a = (i / count) * Math.PI;
            c.init(baseX + i * 32, groundY - 60 - Math.sin(a) * 80, gameSpeed);
          } else {
            c.init(baseX + Math.random() * 80, groundY - 50 - Math.random() * 100, gameSpeed);
          }
        }
      },
      spawnPowerup: () => {
        if (powerupPool.active.length < 2) {
          const p = powerupPool.acquire();
          p.init(W + 40, groundY - 80, gameSpeed);
        }
      }
    });

    // Update obstacles
    for (let i = obstaclePool.active.length - 1; i >= 0; i--) {
      const o = obstaclePool.active[i];
      o.speed = gameSpeed;
      o.update(dt);
      // Collision
      if (rectOverlap(player.getHitbox(), o.getHitbox())) {
        const died = player.takeDamage();
        if (died) { handleDeath(); return; }
        else {
          particles.emit(player.x + player.w, player.y + player.h / 2, { color: '#3498db', count: 12, speed: 5 });
          obstaclePool.release(o);
        }
      }
      if (o.x + o.w < -50) obstaclePool.release(o);
    }

    // Update coins
    for (let i = coinPool.active.length - 1; i >= 0; i--) {
      const c = coinPool.active[i];
      c.speed = gameSpeed;
      c.update(dt);
      if (rectOverlap(player.getHitbox(), c.getHitbox())) {
        scoreSystem.addCoin();
        particles.emit(c.x + c.w / 2, c.y + c.h / 2, { color: '#f9ca24', count: 6, size: 4, speed: 4, decay: .06 });
        AudioSystem.play('coin');
        coinPool.release(c);
      }
      if (c.x + c.w < -50) coinPool.release(c);
    }

    // Update powerups
    for (let i = powerupPool.active.length - 1; i >= 0; i--) {
      const p = powerupPool.active[i];
      p.speed = gameSpeed;
      p.update(dt);
      if (rectOverlap(player.getHitbox(), p.getHitbox())) {
        activatePowerup(p.type);
        particles.emit(p.x + p.w / 2, p.y + p.h / 2, { color: PowerUp.COLORS[p.type], count: 15, speed: 5 });
        AudioSystem.play('powerup');
        powerupPool.release(p);
      }
      if (p.x + p.w < -50) powerupPool.release(p);
    }

    // Update particles
    particles.update(dt);

    // Update background
    bgSystem.update(dt, gameSpeed);

    // Update HUD
    document.getElementById('scoreDisplay').textContent = Math.floor(scoreSystem.score).toLocaleString();
    document.getElementById('coinDisplay').textContent = `🪙 ${scoreSystem.coins}`;
  }

  // ─────────── POWERUP LOGIC ──────────────────────────────────────
  function activatePowerup(type) {
    activePowerupType = type;
    activePowerupTimer = 8;
    document.getElementById('powerupIndicator').classList.remove('hidden');

    switch(type) {
      case 'shield':
        player.setShield(true);
        break;
      case 'slowmo':
        slowmoActive = true;
        slowmoTimer = 8;
        break;
      case 'magnet':
        scoreSystem.activateMagnet(8);
        break;
      case 'doubleJump':
        player.hasDoubleJump = true;
        break;
    }
    GameUI.showNotification(`${PowerUp.ICONS[type]} ${type === 'shield' ? 'درع!' : type === 'slowmo' ? 'تبطيء الزمن!' : type === 'magnet' ? 'مغناطيس!' : 'قفزة مزدوجة!'}`);
  }

  function deactivatePowerup() {
    if (activePowerupType === 'shield') player.setShield(false);
    if (activePowerupType === 'slowmo') slowmoActive = false;
    if (activePowerupType === 'magnet') scoreSystem.magnetActive = false;
    if (activePowerupType === 'doubleJump') player.hasDoubleJump = false;
    activePowerupType = null;
    activePowerupTimer = 0;
    document.getElementById('powerupIndicator').classList.add('hidden');
  }

  // ─────────── RENDER ─────────────────────────────────────────────
  function render(dt) {
    ctx.clearRect(0, 0, W, H);

    bgSystem.draw(ctx, gameSpeed);
    bgSystem.drawGround(ctx, groundY);

    // Draw obstacles
    for (const o of obstaclePool.active) o.draw(ctx);

    // Draw coins
    for (const c of coinPool.active) c.draw(ctx);

    // Draw powerups
    for (const p of powerupPool.active) p.draw(ctx);

    // Draw particles
    particles.draw(ctx);

    // Draw player
    player.draw(ctx);

    // Slowmo overlay
    if (slowmoActive) {
      ctx.fillStyle = 'rgba(155,89,182,.06)';
      ctx.fillRect(0, 0, W, H);
    }

    // Dev overlay
    if (devMode) {
      ctx.strokeStyle = 'rgba(255,0,0,.5)';
      ctx.lineWidth = 1;
      const ph = player.getHitbox();
      ctx.strokeRect(ph.x, ph.y, ph.w, ph.h);
      for (const o of obstaclePool.active) {
        const oh = o.getHitbox();
        ctx.strokeRect(oh.x, oh.y, oh.w, oh.h);
      }
      ctx.fillStyle = '#0f0';
      ctx.font = '12px monospace';
      ctx.fillText(`spd:${Math.floor(gameSpeed)} dif:${difficulty.toFixed(1)} obs:${obstaclePool.active.length} coins:${coinPool.active.length}`, 10, 20);
    }
  }

  // ─────────── COLLISION ──────────────────────────────────────────
  function rectOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // ─────────── DEATH ──────────────────────────────────────────────
  function handleDeath() {
    state = 'dead';
    player.isDead = true;
    AudioSystem.play('crash');
    AudioSystem.stopMusic();
    deactivatePowerup();

    particles.emit(player.x + player.w / 2, player.y + player.h / 2, {
      color: '#e74c3c', count: 20, speed: 6, decay: .03
    });

    const score = Math.floor(scoreSystem.score);
    const coins = scoreSystem.coins;
    const jumps = player.jumpTotal;

    // Save stats
    SaveSystem.update('totalCoins', c => c + coins);
    SaveSystem.update('totalJumps', j => j + jumps);
    SaveSystem.update('totalGames', g => g + 1);

    const prevBest = SaveSystem.get('bestScore');
    let newRecord = false;
    if (score > prevBest) {
      SaveSystem.set('bestScore', score);
      newRecord = true;
      AudioSystem.play('record');
      setTimeout(() => AudioSystem.play('gameover'), 400);
    } else {
      AudioSystem.play('gameover');
    }

    // Leaderboard
    const lb = SaveSystem.get('leaderboard') || [];
    lb.push({ score, date: new Date().toLocaleDateString('ar') });
    lb.sort((a, b) => b.score - a.score);
    SaveSystem.set('leaderboard', lb.slice(0, 10));

    // Check achievements
    const unlocks = AchievementSystem.check(score, coins);
    if (unlocks.length) {
      setTimeout(() => {
        unlocks.forEach((ach, i) => {
          setTimeout(() => GameUI.showNotification(`${ach.icon} إنجاز مفتوح: ${ach.name}`), i * 1500);
        });
      }, 1500);
    }

    // Show game over screen after animation
    setTimeout(() => {
      GameUI.showGameOver({ score, coins, jumps, newRecord, best: SaveSystem.get('bestScore') });
    }, 800);
  }

  // ─────────── INPUT ──────────────────────────────────────────────
  function onKeyDown(e) {
    if (state !== 'playing') return;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      if (jumpCooldown <= 0) { player.jump(); jumpCooldown = 0.12; }
    }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault();
      player.slide();
    }
    if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  }

  function handleTouch(action) {
    if (state !== 'playing') return;
    if (action === 'jump') {
      if (jumpCooldown <= 0) { player.jump(); jumpCooldown = 0.12; }
    } else if (action === 'slide') {
      player.slide();
    }
  }

  // ─────────── PAUSE ──────────────────────────────────────────────
  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
      document.getElementById('pauseScreen').classList.remove('hidden');
      document.getElementById('pauseScore').textContent = Math.floor(scoreSystem.score).toLocaleString();
      AudioSystem.stopMusic();
    } else if (state === 'paused') {
      state = 'playing';
      document.getElementById('pauseScreen').classList.add('hidden');
      AudioSystem.startMusic();
      lastTime = performance.now(); // reset delta to prevent jump
    }
  }

  // ─────────── RESTART ────────────────────────────────────────────
  function restart() {
    hintDismissed = false; // أعد تلميح اللمس
    document.getElementById('gameOverScreen').classList.add('hidden');
    GameUI.showScreen('gameContainer');
    const char = SaveSystem.get('selectedChar') || 'boy';
    start(char);
  }

  return { init, start, restart, togglePause };
})();

/* ─────────────────────────────────────────────────────────────────
   UI CONTROLLER
   ───────────────────────────────────────────────────────────────── */
const GameUI = (() => {

  let selectedChar = 'boy';
  let installPromptEvent = null;
  let notifTimer = null;

  // ─── Screen management ─────────────────────────────────────────
  function showScreen(id) {
    const screens = ['loadingScreen','charSelectScreen','mainMenu','gameContainer',
                     'shopScreen','achievementsScreen','leaderboardScreen'];
    screens.forEach(s => {
      const el = document.getElementById(s);
      if (el) el.classList.add('hidden');
    });
    const target = document.getElementById(id);
    if (target) target.classList.remove('hidden');

    // Refresh data when showing specific screens
    if (id === 'mainMenu') refreshMainMenu();
    if (id === 'shopScreen') refreshShop();
    if (id === 'achievementsScreen') refreshAchievements();
    if (id === 'leaderboardScreen') refreshLeaderboard();
  }

  // ─── Main menu ─────────────────────────────────────────────────
  function refreshMainMenu() {
    document.getElementById('menuBest').textContent = (SaveSystem.get('bestScore') || 0).toLocaleString();
    document.getElementById('menuCoins').textContent = (SaveSystem.get('totalCoins') || 0).toLocaleString();
    document.getElementById('muteBtn').textContent = AudioSystem.isMuted() ? '🔇' : '🔊';
    document.getElementById('themeBtn') && (document.getElementById('themeBtn').textContent =
      document.body.classList.contains('light-mode') ? '☀️' : '🌙');
  }

  // ─── Character select ──────────────────────────────────────────
  function selectChar(char) {
    if (char === 'girl' && !ShopSystem.isOwned('girl')) {
      showNotification('اشتر الشخصية من المتجر أولاً!');
      return;
    }
    selectedChar = char;
    document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
    const card = document.querySelector(`[data-char="${char}"]`);
    if (card) card.classList.add('selected');
    SaveSystem.set('selectedChar', char);
  }

  function startFromCharSelect() {
    showScreen('gameContainer');
    GameEngine.start(selectedChar);
  }

  // ─── Game Over ─────────────────────────────────────────────────
  function showGameOver({ score, coins, jumps, newRecord, best }) {
    document.getElementById('gameOverScreen').classList.remove('hidden');
    document.getElementById('finalScore').textContent = score.toLocaleString();
    document.getElementById('finalBest').textContent = best.toLocaleString();
    document.getElementById('finalCoins').textContent = coins;
    document.getElementById('finalJumps').textContent = jumps;
    const banner = document.getElementById('newRecordBanner');
    if (newRecord) { banner.classList.remove('hidden'); }
    else { banner.classList.add('hidden'); }
    document.getElementById('gameOverTitle').textContent = newRecord ? '🏆 رقم قياسي!' : '💀 انتهت اللعبة';
  }

  function quitToMenu() {
    document.getElementById('gameOverScreen').classList.add('hidden');
    document.getElementById('pauseScreen').classList.add('hidden');
    document.getElementById('gameContainer').classList.add('hidden');
    AudioSystem.stopMusic();
    showScreen('mainMenu');
  }

  // ─── Shop ──────────────────────────────────────────────────────
  function refreshShop() {
    document.getElementById('shopCoins').textContent = (SaveSystem.get('totalCoins') || 0).toLocaleString();
    const grid = document.getElementById('shopGrid');
    grid.innerHTML = '';
    ShopSystem.getItems().forEach(item => {
      const owned = ShopSystem.isOwned(item.id);
      const div = document.createElement('div');
      div.className = `shop-item${owned ? ' owned' : ''}`;
      div.innerHTML = `
        <div class="shop-item-icon">${item.icon}</div>
        <h4>${item.name}</h4>
        <p>${item.desc}</p>
        <button onclick="GameUI.buyItem('${item.id}')">
          ${owned ? '✓ مملوك' : `🪙 ${item.price}`}
        </button>`;
      grid.appendChild(div);
    });
  }

  function buyItem(id) {
    const result = ShopSystem.buy(id);
    showNotification(result.msg);
    if (result.success) refreshShop();
    // Unlock girl character card
    if (id === 'girl' && result.success) {
      const card = document.getElementById('girlCard');
      if (card) card.classList.remove('locked');
    }
  }

  // ─── Achievements ──────────────────────────────────────────────
  function refreshAchievements() {
    const list = document.getElementById('achievementsList');
    list.innerHTML = '';
    const saved = AchievementSystem.getSaved();
    AchievementSystem.getDefs().forEach(def => {
      const unlocked = !!saved[def.id];
      const div = document.createElement('div');
      div.className = `achievement-item ${unlocked ? 'unlocked' : 'locked-ach'}`;
      div.innerHTML = `
        <div class="ach-icon">${unlocked ? def.icon : '🔒'}</div>
        <div class="ach-info"><h4>${def.name}</h4><p>${def.desc}</p></div>
        <div class="ach-progress">${unlocked ? '✓' : ''}</div>`;
      list.appendChild(div);
    });
  }

  // ─── Leaderboard ───────────────────────────────────────────────
  function refreshLeaderboard() {
    const lb = SaveSystem.get('leaderboard') || [];
    const list = document.getElementById('leaderboardList');
    list.innerHTML = '';
    if (!lb.length) { list.innerHTML = '<p style="text-align:center;opacity:.5">لا توجد نتائج بعد</p>'; return; }
    lb.forEach((entry, i) => {
      const div = document.createElement('div');
      div.className = 'lb-item';
      const medals = ['🥇','🥈','🥉'];
      div.innerHTML = `
        <span class="lb-rank">${medals[i] || (i + 1)}</span>
        <span class="lb-name">لاعب ${i + 1}</span>
        <span class="lb-score">${entry.score.toLocaleString()}</span>
        <span style="font-size:.75rem;color:var(--text2);margin-right:8px">${entry.date || ''}</span>`;
      list.appendChild(div);
    });
  }

  function clearLeaderboard() {
    SaveSystem.set('leaderboard', []);
    refreshLeaderboard();
    showNotification('تم مسح لوحة الصدارة');
  }

  // ─── Theme ─────────────────────────────────────────────────────
  function toggleTheme() {
    document.body.classList.toggle('light-mode');
    document.body.classList.toggle('dark-mode');
    const btn = document.getElementById('themeBtn') || document.querySelector('[onclick="GameUI.toggleTheme()"]');
    if (btn) btn.textContent = document.body.classList.contains('light-mode') ? '☀️' : '🌙';
    SaveSystem.update('settings', s => ({ ...s, theme: document.body.classList.contains('light-mode') ? 'light' : 'dark' }));
  }

  // ─── Mute ──────────────────────────────────────────────────────
  function toggleMute() {
    const muted = AudioSystem.toggleMute();
    document.getElementById('muteBtn').textContent = muted ? '🔇' : '🔊';
  }

  // ─── PWA Install ───────────────────────────────────────────────
  function installApp() {
    if (installPromptEvent) {
      installPromptEvent.prompt();
      installPromptEvent.userChoice.then(result => {
        if (result.outcome === 'accepted') showNotification('تم تثبيت اللعبة! 🎉');
        installPromptEvent = null;
        document.getElementById('installBtn').style.display = 'none';
      });
    }
  }

  // ─── Notification ──────────────────────────────────────────────
  function showNotification(msg) {
    const el = document.getElementById('notification');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(notifTimer);
    notifTimer = setTimeout(() => el.classList.add('hidden'), 2500);
  }

  return {
    showScreen, selectChar, startFromCharSelect, showGameOver, quitToMenu,
    buyItem, refreshShop, clearLeaderboard, toggleTheme, toggleMute,
    installApp, showNotification,
    _setInstallPrompt: (e) => {
      installPromptEvent = e;
      document.getElementById('installBtn').style.display = '';
    }
  };
})();

/* ─────────────────────────────────────────────────────────────────
   SERVICE WORKER REGISTRATION
   ───────────────────────────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js')
      .then(() => console.log('SW registered'))
      .catch(e => console.warn('SW error:', e));
  });
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  GameUI._setInstallPrompt(e);
});

/* ─────────────────────────────────────────────────────────────────
   BOOTSTRAP — preload then start
   ───────────────────────────────────────────────────────────────── */
(async function bootstrap() {
  // Load saved data
  SaveSystem.load();

  const settings = SaveSystem.get('settings') || {};
  if (settings.theme === 'light') {
    document.body.classList.remove('dark-mode');
    document.body.classList.add('light-mode');
  }

  // Init canvas engine immediately
  GameEngine.init();

  const bar = document.getElementById('loadingBar');
  const loadingText = document.getElementById('loadingText');

  function setProgress(pct, msg) {
    bar.style.width = pct + '%';
    loadingText.textContent = msg;
  }

  setProgress(10, 'تحميل الصور...');

  // Load images
  await AssetLoader.loadImages([
    { key: 'player',   src: 'assets/player.png' },
    { key: 'obstacle', src: 'assets/obstacle.png' },
    { key: 'bg',       src: 'assets/background.png' },
    { key: 'coin',     src: 'assets/coin.png' },
    { key: 'powerup',  src: 'assets/powerup.png' },
  ]);
  setProgress(50, 'تحميل الأصوات...');

  // Load sounds
  await AudioSystem.preload([
    { key: 'music',    src: 'sounds/music.wav',    loop: true, volume: 0.4 },
    { key: 'jump',     src: 'sounds/jump.wav',     volume: 0.7 },
    { key: 'slide',    src: 'sounds/slide.wav',    volume: 0.6 },
    { key: 'coin',     src: 'sounds/coin.wav',     volume: 0.8 },
    { key: 'crash',    src: 'sounds/crash.wav',    volume: 0.9 },
    { key: 'powerup',  src: 'sounds/powerup.wav',  volume: 0.8 },
    { key: 'gameover', src: 'sounds/gameover.wav', volume: 0.8 },
    { key: 'record',   src: 'sounds/record.wav',   volume: 0.9 },
  ]);
  setProgress(90, 'جاهز تقريباً...');

  // Apply saved mute
  if (settings.muted) AudioSystem.setMuted(true);

  // Restore char select state
  const savedChar = SaveSystem.get('selectedChar') || 'boy';
  if (ShopSystem.isOwned('girl')) {
    const girlCard = document.getElementById('girlCard');
    if (girlCard) girlCard.classList.remove('locked');
  }

  await new Promise(r => setTimeout(r, 400));
  setProgress(100, 'يلا نلعب! 🎮');

  await new Promise(r => setTimeout(r, 500));

  // Hide loading, show main menu
  document.getElementById('loadingScreen').classList.add('hidden');
  GameUI.showScreen('mainMenu');

  console.log('%c⚡ Speed Runner Pro loaded!', 'color:#e94560;font-size:1.2em;font-weight:bold');
  console.log('%cCtrl+D = Dev Mode (FPS + Hitboxes)', 'color:#888');
})();
