// ─── Constants ────────────────────────────────────────────────────────────────

// Movement
const SPEED       = 6.4;
const SPEED_BOOST = 1.45;  // multiplier while Mate is active
const ACCEL       = 32;    // softer ramp-up for bird-like feel
const DRAG        = 7;     // low drag → long glide, not a helicopter stop
const GLIDE_SPEED    = SPEED * 0.40; // glide cruise speed — 20% slower than before
const GLIDE_TURN_SPD = 1.70;         // rad/sec — 2× turn rate → 50% tighter radius (~3.7s/loop)

// Dash
const DASH_V   = 30;
const DASH_DUR = 0.16;
const DASH_CD  = 0.70;

// Energy
const DASH_ENERGY_COST  = 0.30;  // 30% of bar consumed per dash
const ENERGY_REFILL_SPD = 0.20;  // 20% per second while anchoring at a Caraíba tree

// World generation
const NUM_ZONES      = 8;      // 50% of original — sparser, harder to find
const ZONE_R         = 2.58;   // Caraibeira zone radius — 20% smaller than original 3.23
const ZONE_TRUNK_R   = 0.45;   // visual/depth-sort trunk radius (world units)
const ZONE_COL_R     = 0.14;   // collision-only radius — just the physical trunk base
const NUM_TRAPS      = 22;
const NUM_SAPLINGS   = 300;    // dense Caatinga; min-distance check keeps it organic
const NUM_TUFTS      = 62;     // 250% of original 25 — rich ground detail
const WORLD_SPAN     = 27;     // 50% larger than original 18 — fits 3600×2700 bounds

// Enemies
const NUM_POACHERS       = 10;
const POACHER_PATROL_R   = 1.5;   // world units ≈ 100 screen px
const POACHER_DETECT_R   = 3.0;   // chase trigger ≈ 200 px
const POACHER_RETURN_R   = 4.5;   // return trigger ≈ 300 px
const POACHER_SPEED      = 125 / 64; // world units/sec ≈ 125 px/s
const POACHER_PATROL_SPD = 0.5;   // rad/sec for patrol orbit
const REAPER_SPEED       = 0.9375; // 50% faster than original 0.625
const NET_SPEED  = 4.5;  // world units/sec
const NET_CD     = 3.0;  // seconds between shots per poacher
const NET_RANGE  = 4.0;  // world units before net fades
const NET_HIT_R  = 0.30; // capture radius

// Scoring / Spirit Anchor
const ZONE_HOLD_TIME   = 5.0;   // seconds to fill the Spirit Meter
const POINTS_TO_WIN    = 3;     // bloomed trees needed to spawn Great Caraibeira
const GHOST_TRAIL_DUR  = 30.0;  // seconds the Speed Ghost trail lasts after blooming

// Mate
const MATE_DUR   = 10.0;  // seconds the Mate follows
const MATE_SPEED = 5.0;   // tile units/sec, flies toward player
const MATE_FADE  = 2.2;   // seconds for spiral-out

// ─── Isometric projection ─────────────────────────────────────────────────────
function toScreen(wx, wy) {
  return { x: (wx - wy) * 64, y: (wx + wy) * 32 };
}

// Blend two packed hex colours by factor t (0=base, 1=tint)
function blendHex(base, tint, t) {
  const br = (base >> 16) & 0xff, bg = (base >> 8) & 0xff, bb = base & 0xff;
  const tr = (tint >> 16) & 0xff, tg = (tint >> 8) & 0xff, tb = tint & 0xff;
  const r = Math.round(br + (tr - br) * t);
  const g = Math.round(bg + (tg - bg) * t);
  const b = Math.round(bb + (tb - bb) * t);
  return (r << 16) | (g << 8) | b;
}

// ─── Scene ────────────────────────────────────────────────────────────────────
class GameScene extends Phaser.Scene {
  constructor() { super({ key: 'Game' }); }

  // ── init ────────────────────────────────────────────────────────────────────
  init(data) {
    this.currentYear  = (data && data.year) ? data.year : 1987;
    this.playerHealth = 3; // placeholder — full bar until health system is built
    this.energy       = 1.0; // Energy bar: 0.0 – 1.0 (full)
    this.glideAngle   = (data && data.glideAngle) ? data.glideAngle : Math.random() * Math.PI * 2;
  }

  // ── create ──────────────────────────────────────────────────────────────────
  create() {
    // Graphics layers (depth order matters)
    this.grassGfx  = this.add.graphics().setDepth(0.5);
    this.tuftGfx   = this.add.graphics().setDepth(0.55); // ground tufts, above grass, below trees
    this.trunkGfx  = this.add.graphics().setDepth(1);
    this.canopyGfx = this.add.graphics().setDepth(7);
    this.portalGfx = this.add.graphics().setDepth(1.5);
    this.trapGfx   = this.add.graphics().setDepth(0.7);
    this.trailGfx  = this.add.graphics().setDepth(3);
    this.shadowGfx = this.add.graphics().setDepth(4);
    this.mateGfx   = this.add.graphics().setDepth(5);
    this.enemyGfx  = this.add.graphics().setDepth(5.5);
    this.playerGfx = this.add.graphics().setDepth(6);
    this.revealGfx = this.add.graphics().setDepth(55); // above fog (50), below HUD (100)
    this.hudGfx    = this.add.graphics().setScrollFactor(0).setDepth(60);

    // ── Player ──────────────────────────────────────────────────────────────
    this.wx = 0; this.wy = 0;
    this.vx = 0; this.vy = 0;
    this.fx = -0.707; this.fy = -0.707; // initial facing: screen-up
    this.dashing   = false;
    this.dashTimer = 0;
    this.dashCD    = 0;
    this.ddx = 0; this.ddy = 0;
    this.dead = false;
    this.orbitRadius = null; // null = not in orbit; set to current dist on zone entry

    // ── Mate ────────────────────────────────────────────────────────────────
    this.mateActive    = false;
    this.mateTimer     = 0;
    this.mateFading    = false;
    this.mateFadeTimer = 0;
    this.mateWx = 0; this.mateWy = 0;
    this.mateFx = -0.707; this.mateFy = -0.707;
    this.mateAlpha     = 0;
    this.mateSpiralAng = 0;
    this.mateSpiralR   = 0;
    this.mateSpiralBase = null;
    this.lastZoneIdx   = -1;

    // ── Scoring / Spirit Anchor ───────────────────────────────────────────────
    this.score            = 0;
    this.zoneHoldTimer    = 0;
    this.activeZoneIdx    = -1;
    this.portalActive     = false;
    this.levelClearing    = false;
    this.spiritGhostTimer = 0;   // countdown for Speed Ghost trail

    // Particles (dash sparks + ghost trail)
    this.particles = [];

    // ── World ───────────────────────────────────────────────────────────────
    this._genWorld();

    // Reaper breathing tween (drives reaper.alpha between 0.2 and 0.6)
    this.tweens.add({
      targets:  this.reaper,
      alpha:    0.6,
      duration: 1800,
      ease:     'Sine.easeInOut',
      yoyo:     true,
      repeat:   -1,
    });

    // Spirit Sense state (Reaper within 300px but in fog)
    this.spiritSense = false;

    // ── Input ───────────────────────────────────────────────────────────────
    this.keys      = this.input.keyboard.addKeys('W,A,S,D,SPACE,E');
    this.prevSpace = false;

    // ── Ancestral Call ───────────────────────────────────────────────────────
    this.ancestralCD      = 0;    // cooldown remaining (seconds)
    this.ancestralReveal  = 0;    // remaining duration of zone reveal (seconds)
    this.ancestralRipples = [];   // array of expanding ring objects
    this.prevE            = false;

    // Zone hold countdown (hidden — Spirit Meter arc replaces the number)
    this.timerText = this.add.text(0, 0, '', {
      fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '28px', color: '#aaffaa',
      stroke: '#1a3318', strokeThickness: 4,
    }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(100).setVisible(false);

    // ── Persistent HUD — fixed to camera, always above Fog of War (depth 50) ──
    const HW = this.scale.width;

    // Trees Saved — top-left corner
    this.treesSavedText = this.add.text(20, 16, '', {
      fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '18px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0, 0).setScrollFactor(0).setDepth(100);

    // 'YEAR' label inside bark box — top-right corner
    this.yearText = this.add.text(0, 0, 'YEAR', {
      fontFamily: 'monospace', fontSize: '7px', color: '#786028',
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);

    // Year numeral — updated each frame in _drawHUD
    this.yearNumText = this.add.text(0, 0, '1987', {
      fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold', color: '#d4a840',
    }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(100);

    // 'SPIRIT ENERGY' label above energy bar — positioned each frame in _drawHUD
    this.energyLabel = this.add.text(0, 0, 'SPIRIT ENERGY', {
      fontFamily: 'monospace', fontSize: '7px', color: '#8a6830',
    }).setOrigin(0, 1).setScrollFactor(0).setDepth(100);

    // Health label (bar is drawn in _drawHUD via hudGfx)
    this.healthLabel = this.add.text(20, 44, 'Health', {
      fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '12px', color: '#cccccc',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0, 0).setScrollFactor(0).setDepth(100);

    // Ancestral Call cooldown label
    this.ancestralText = this.add.text(20, 82, '', {
      fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '12px', color: '#88ccff',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0, 0).setScrollFactor(0).setDepth(100);

    this.cameras.main.setBackgroundColor('#b07828'); // solid ochre Caatinga floor
    this.cameras.main.setBounds(-1800, -1350, 3600, 2700); // 50% larger map
    this._makeFog();
  }

  // ── update ──────────────────────────────────────────────────────────────────
  update(_, delta) {
    if (this.dead) return;
    const dt = delta / 1000;

    this._move(dt);
    this._updateMate(dt);
    this._updateEnemies(dt);
    this._checkTraps();
    this._updateParticles(dt);
    this._updateScore(dt);
    this._updateAncestralCall(dt);

    this._drawGrass();
    this._drawTufts();
    this._drawZones();
    this._drawPortal();
    this._drawTraps();
    this._drawEnemies();
    this._drawTrail();
    this._drawShadow();
    this._drawMate();
    this._drawPlayer();
    this._drawAncestralCall();
    this._drawHUD();

    const s = toScreen(this.wx, this.wy);
    this.cameras.main.centerOn(s.x, s.y);

    // ── Y-sort depth: entity depth is determined by isoY position vs each tree ──
    // Trunks on trunkGfx (depth 1), canopies on canopyGfx (depth 7).

    // Enemy depth — occlude behind large Caraibeira zones
    if (this.reaper) {
      const rIsoY = this.reaper.wx + this.reaper.wy;
      let ed = 5.5;
      for (const z of this.zones) {
        if (rIsoY < z.wx + z.wy &&
            Math.hypot(this.reaper.wx - z.wx, this.reaper.wy - z.wy) < z.radius * 2.0)
          { ed = 0.6; break; }
      }
      for (const p of this.poachers) {
        if (ed <= 0.6) break; // already occluded
        for (const z of this.zones) {
          if (p.wx + p.wy < z.wx + z.wy &&
              Math.hypot(p.wx - z.wx, p.wy - z.wy) < z.radius * 2.0)
            { ed = 0.6; break; }
        }
      }
      this.enemyGfx.setDepth(ed);
    }
  }

  // ── _move ────────────────────────────────────────────────────────────────────
  _move(dt) {
    const k = this.keys;
    let kineticMove = false; // set true when position is placed directly (skip vx/vy integration)

    // WASD → isometric screen directions
    // W=screen-up(-1,-1)  S=screen-down(+1,+1)
    // A=screen-left(-1,+1) D=screen-right(+1,-1)
    let ix = 0, iy = 0;
    if (k.W.isDown) { ix -= 1; iy -= 1; }
    if (k.S.isDown) { ix += 1; iy += 1; }
    if (k.A.isDown) { ix -= 1; iy += 1; }
    if (k.D.isDown) { ix += 1; iy -= 1; }

    const il = Math.hypot(ix, iy);
    if (il > 0) {
      ix /= il; iy /= il;
      // Smooth facing rotation (lerp) so the triangle glides to new directions
      const lerp = 1 - Math.pow(0.001, dt * 6);
      this.fx += (ix - this.fx) * lerp;
      this.fy += (iy - this.fy) * lerp;
      const fl = Math.hypot(this.fx, this.fy);
      if (fl > 0) { this.fx /= fl; this.fy /= fl; }
    }

    // Dash — single press; requires Energy > 0; consumes 30% of bar
    const spNow = k.SPACE.isDown;
    if (spNow && !this.prevSpace && !this.dashing && this.dashCD <= 0 && this.energy > 0) {
      this.dashing   = true;
      this.dashTimer = DASH_DUR;
      this.dashCD    = DASH_CD;
      this.ddx = this.fx; this.ddy = this.fy;
      this.vx = this.ddx * DASH_V;
      this.vy = this.ddy * DASH_V;
      this.energy = Math.max(0, this.energy - DASH_ENERGY_COST);
    }
    this.prevSpace = spNow;
    if (this.dashCD > 0) this.dashCD -= dt;

    const maxSp = this.mateActive ? SPEED * SPEED_BOOST : SPEED;

    if (this.dashing) {
      this.dashTimer -= dt;
      if (this.dashTimer <= 0) {
        this.dashing = false;
        this.vx = this.ddx * maxSp * 0.5;
        this.vy = this.ddy * maxSp * 0.5;
      }
    } else {
      if (il > 0) {
        this.vx += ix * ACCEL * dt;
        this.vy += iy * ACCEL * dt;
        // Keep glide angle synced so the thermal circle picks up smoothly when input stops
        const spd = Math.hypot(this.vx, this.vy);
        if (spd > 0.5) this.glideAngle = Math.atan2(this.vy, this.vx);
      } else {
        // No input — check if inside a safe zone; if so, lock to an orbital glide around it
        const orbitZone = this.zones
          ? this.zones.find(z => Math.hypot(this.wx - z.wx, this.wy - z.wy) < z.radius)
          : null;

        if (orbitZone) {
          // Orbital glide: smoothly pulls the bird onto a circle at 50% zone radius.
          const targetR = orbitZone.radius * 0.50;

          // On first frame inside zone, seed orbitRadius from current distance
          const odx = this.wx - orbitZone.wx;
          const ody = this.wy - orbitZone.wy;
          const curDist = Math.hypot(odx, ody) || targetR;
          if (this.orbitRadius === null) this.orbitRadius = curDist;

          // Lerp radius toward target (~1.5 s to settle)
          this.orbitRadius += (targetR - this.orbitRadius) * Math.min(1, dt * 2.5);

          // Advance angle from current position, then place bird at blended radius
          this.glideAngle = Math.atan2(ody, odx) + GLIDE_TURN_SPD * dt;
          this.wx = orbitZone.wx + Math.cos(this.glideAngle) * this.orbitRadius;
          this.wy = orbitZone.wy + Math.sin(this.glideAngle) * this.orbitRadius;

          // Tangent velocity for dash/particles; no integration step needed
          const tangX = -Math.sin(this.glideAngle);
          const tangY =  Math.cos(this.glideAngle);
          const orbitSpd = this.orbitRadius * GLIDE_TURN_SPD;
          this.vx = tangX * orbitSpd;
          this.vy = tangY * orbitSpd;

          // Smoothly steer facing toward tangent direction
          const fl = 1 - Math.pow(0.001, dt * 4);
          this.fx += (tangX - this.fx) * fl;
          this.fy += (tangY - this.fy) * fl;
          const fn = Math.hypot(this.fx, this.fy);
          if (fn > 0) { this.fx /= fn; this.fy /= fn; }

          kineticMove = true;
        } else {
          // Leaving or outside all zones — reset orbit state
          this.orbitRadius = null;

          // Free thermal glide: wide lazy circle with no input
          this.glideAngle += GLIDE_TURN_SPD * dt;
          const gx = Math.cos(this.glideAngle);
          const gy = Math.sin(this.glideAngle);
          this.vx += (gx * GLIDE_SPEED - this.vx) * 2.5 * dt;
          this.vy += (gy * GLIDE_SPEED - this.vy) * 2.5 * dt;
          const gl = 1 - Math.pow(0.01, dt * 3);
          this.fx += (gx - this.fx) * gl;
          this.fy += (gy - this.fy) * gl;
          const fl2 = Math.hypot(this.fx, this.fy);
          if (fl2 > 0) { this.fx /= fl2; this.fy /= fl2; }
        }
      }
      const sp = Math.hypot(this.vx, this.vy);
      if (sp > maxSp) { this.vx *= maxSp / sp; this.vy *= maxSp / sp; }
    }

    if (!kineticMove) {
      this.wx += this.vx * dt;
      this.wy += this.vy * dt;
    }

    // Clamp to world bounds (3600×2700 screen pixels centred on origin)
    const ps = toScreen(this.wx, this.wy);
    const csx = Phaser.Math.Clamp(ps.x, -1800, 1800);
    const csy = Phaser.Math.Clamp(ps.y, -1350, 1350);
    if (csx !== ps.x || csy !== ps.y) {
      this.wx = csx / 128 + csy / 64;
      this.wy = csy / 64  - csx / 128;
      this.vx = 0; this.vy = 0;
    }

    // Tree trunk collision — only the physical base of the trunk (canopy has no hitbox)
    const PLAYER_R = 0.35;
    for (const z of this.zones) {
      const dx = this.wx - z.wx, dy = this.wy - z.wy;
      const dist = Math.hypot(dx, dy);
      const minD = ZONE_COL_R + PLAYER_R;
      if (dist < minD && dist > 0.001) {
        const nx = dx / dist, ny = dy / dist;
        this.wx = z.wx + nx * minD;
        this.wy = z.wy + ny * minD;
        const dot = this.vx * nx + this.vy * ny;
        if (dot < 0) { this.vx -= dot * nx; this.vy -= dot * ny; }
      }
    }
    for (const sp of this.saplings) {
      const dx = this.wx - sp.wx, dy = this.wy - sp.wy;
      const dist = Math.hypot(dx, dy);
      const minD = sp.trunkR * 0.32 + PLAYER_R; // 0.32× = trunk base only, canopy passable
      if (dist < minD && dist > 0.001) {
        const nx = dx / dist, ny = dy / dist;
        this.wx = sp.wx + nx * minD;
        this.wy = sp.wy + ny * minD;
        const dot = this.vx * nx + this.vy * ny;
        if (dot < 0) { this.vx -= dot * nx; this.vy -= dot * ny; }
      }
    }
  }

  // ── _updateMate ──────────────────────────────────────────────────────────────
  _updateMate(dt) {
    // ── Check for zone entry (only when no Mate is active) ─────────────────
    if (!this.mateActive && !this.mateFading) {
      for (let i = 0; i < this.zones.length; i++) {
        if (i === this.lastZoneIdx) continue;
        const z = this.zones[i];
        if (Math.hypot(this.wx - z.wx, this.wy - z.wy) < z.radius) {
          this.mateActive    = true;
          this.mateTimer     = MATE_DUR;
          this.mateFading    = false;
          this.mateAlpha     = 1;
          this.lastZoneIdx   = i;
          this.mateWx = this.wx;
          this.mateWy = this.wy;
          this.mateFx = this.fx;
          this.mateFy = this.fy;
          break;
        }
      }
      return;
    }

    // ── Spiral-out departure ────────────────────────────────────────────────
    if (this.mateFading) {
      this.mateFadeTimer -= dt;
      this.mateSpiralAng += 5.5 * dt;
      this.mateSpiralR   += 3.0 * dt;
      this.mateAlpha = Math.max(0, this.mateFadeTimer / MATE_FADE);
      if (this.mateFadeTimer <= 0) {
        this.mateActive  = false;
        this.mateFading  = false;
        this.mateAlpha   = 0;
        this.lastZoneIdx = -1; // zone available again
      }
      return;
    }

    // ── Fly toward player ────────────────────────────────────────────────────
    this.mateTimer -= dt;
    if (this.mateTimer <= 0) {
      this.mateFading     = true;
      this.mateFadeTimer  = MATE_FADE;
      this.mateSpiralBase = { wx: this.mateWx, wy: this.mateWy };
      this.mateSpiralAng  = 0;
      this.mateSpiralR    = 0;
      return;
    }

    const dx = this.wx - this.mateWx;
    const dy = this.wy - this.mateWy;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.01) {
      const step = Math.min(dist, MATE_SPEED * dt);
      this.mateWx += (dx / dist) * step;
      this.mateWy += (dy / dist) * step;
      this.mateFx  = dx / dist;
      this.mateFy  = dy / dist;
    }
  }

  // ── _checkTraps ──────────────────────────────────────────────────────────────
  _checkTraps() {
    for (const t of this.traps) {
      if (Math.hypot(this.wx - t.wx, this.wy - t.wy) < 0.42) {
        this._triggerDeath(); return;
      }
    }
    for (const p of this.poachers) {
      if (Math.hypot(this.wx - p.wx, this.wy - p.wy) < 0.6) {
        this._triggerDeath(); return;
      }
    }
    if (Math.hypot(this.wx - this.reaper.wx, this.wy - this.reaper.wy) < 0.85) {
      this._triggerDeath(); return;
    }
    for (let i = this.nets.length - 1; i >= 0; i--) {
      if (Math.hypot(this.wx - this.nets[i].wx, this.wy - this.nets[i].wy) < NET_HIT_R) {
        this._triggerDeath(); return;
      }
    }
  }

  // ── _updateParticles ─────────────────────────────────────────────────────────
  _updateParticles(dt) {
    // Spawn bonus particles during dash while Mate is active
    if (this.dashing && this.mateActive) {
      for (let i = 0; i < 5; i++) {
        const life = 0.3 + Math.random() * 0.25;
        this.particles.push({
          wx: this.wx + (Math.random() - 0.5) * 0.5,
          wy: this.wy + (Math.random() - 0.5) * 0.5,
          vwx: (Math.random() - 0.5) * 4,
          vwy: (Math.random() - 0.5) * 4,
          life, maxLife: life,
        });
      }
    }

    // Speed Ghost trail — spawn while moving and timer is active
    if (this.spiritGhostTimer > 0) {
      this.spiritGhostTimer = Math.max(0, this.spiritGhostTimer - dt);
      if (Math.hypot(this.vx, this.vy) > 0.5) {
        for (let i = 0; i < 3; i++) {
          const life = 0.4 + Math.random() * 0.3;
          this.particles.push({
            wx:  this.wx + (Math.random() - 0.5) * 0.35,
            wy:  this.wy + (Math.random() - 0.5) * 0.35,
            vwx: (Math.random() - 0.5) * 1.2,
            vwy: (Math.random() - 0.5) * 1.2,
            life, maxLife: life,
            ghost: true,
          });
        }
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.wx += p.vwx * dt;
      p.wy += p.vwy * dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  // ── _updateEnemies ───────────────────────────────────────────────────────────
  _updateEnemies(dt) {
    // ── Poachers — keep wandering/chasing regardless of safe zones ──
    for (const p of this.poachers) {
      const distToPlayer = Math.hypot(this.wx - p.wx, this.wy - p.wy);

      if (p.state === 'patrol' && distToPlayer < POACHER_DETECT_R) {
        p.state = 'chase';
      } else if (p.state === 'chase' && distToPlayer > POACHER_RETURN_R) {
        p.state = 'return';
      }

      if (p.state === 'chase') {
        const dx = this.wx - p.wx, dy = this.wy - p.wy;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.01) {
          const step = Math.min(dist, POACHER_SPEED * dt);
          p.wx += (dx / dist) * step;
          p.wy += (dy / dist) * step;
        }
      } else if (p.state === 'return') {
        const dx = p.wx0 - p.wx, dy = p.wy0 - p.wy;
        const dist = Math.hypot(dx, dy);
        if (dist > POACHER_PATROL_R * 0.5) {
          const step = Math.min(dist, POACHER_SPEED * 0.7 * dt);
          p.wx += (dx / dist) * step;
          p.wy += (dy / dist) * step;
        } else {
          // Sync angle to current offset before entering patrol to prevent position jump
          p.patrolAngle = Math.atan2(p.wy - p.wy0, p.wx - p.wx0);
          p.state = 'patrol';
        }
      } else { // patrol
        p.patrolAngle += POACHER_PATROL_SPD * dt;
        p.wx = p.wx0 + Math.cos(p.patrolAngle) * POACHER_PATROL_R;
        p.wy = p.wy0 + Math.sin(p.patrolAngle) * POACHER_PATROL_R;
      }
    }

    // ── Net shooting ──
    for (const p of this.poachers) {
      if (p.netCD > 0) p.netCD -= dt;
      if (p.state === 'chase' && p.netCD <= 0) {
        const dist = Math.hypot(this.wx - p.wx, this.wy - p.wy);
        if (dist < POACHER_DETECT_R && dist > 0.01) {
          const nx = (this.wx - p.wx) / dist;
          const ny = (this.wy - p.wy) / dist;
          this.nets.push({ wx: p.wx, wy: p.wy, vx: nx * NET_SPEED, vy: ny * NET_SPEED, dist: 0 });
          p.netCD = NET_CD;
        }
      }
    }

    // ── Update nets ──
    for (let i = this.nets.length - 1; i >= 0; i--) {
      const n = this.nets[i];
      n.wx += n.vx * dt;
      n.wy += n.vy * dt;
      n.dist += Math.hypot(n.vx * dt, n.vy * dt);
      if (n.dist > NET_RANGE) this.nets.splice(i, 1);
    }

    // ── Reaper — always pursues, safe zones offer no respite ──
    const dx = this.wx - this.reaper.wx, dy = this.wy - this.reaper.wy;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.01) {
      const step = Math.min(dist, REAPER_SPEED * dt);
      this.reaper.wx += (dx / dist) * step;
      this.reaper.wy += (dy / dist) * step;
    }

    // ── Spirit Sense ──
    // Screen-space distance between player and Reaper (player is always at screen centre)
    const ps = toScreen(this.wx, this.wy);
    const rs = toScreen(this.reaper.wx, this.reaper.wy);
    const reaperScreenDist = Math.hypot(rs.x - ps.x, rs.y - ps.y);
    // Fog starts obscuring at ~130px from screen centre; sense range is 300px
    this.spiritSense = reaperScreenDist > 130 && reaperScreenDist < 300;
  }

  // ── _drawEnemies ─────────────────────────────────────────────────────────────
  _drawEnemies() {
    this.enemyGfx.clear();
    const cam = toScreen(this.wx, this.wy);

    // Collect visible entities and sort back-to-front (ascending isoY = drawn first = further away)
    const drawList = [];

    for (const p of this.poachers) {
      const s = toScreen(p.wx, p.wy);
      if (Math.abs(s.x - cam.x) > 800 || Math.abs(s.y - cam.y) > 500) continue;
      drawList.push({ type: 'poacher', data: p, s, isoY: p.wx + p.wy });
    }

    // Reaper: only draw within the fog's visible radius (~300px from player/screen-centre)
    const rs = toScreen(this.reaper.wx, this.reaper.wy);
    const reaperScreenDist = Math.hypot(rs.x - cam.x, rs.y - cam.y);
    if (reaperScreenDist <= 300) {
      drawList.push({ type: 'reaper', data: this.reaper, s: rs, isoY: this.reaper.wx + this.reaper.wy });
    }

    drawList.sort((a, b) => a.isoY - b.isoY); // back-to-front

    for (const e of drawList) {
      const { s } = e;
      if (e.type === 'poacher') {
        const p    = e.data;
        const size = 18;
        const fill = p.state === 'chase' ? 0xff2222 : 0xcc1a1a;
        this.enemyGfx.fillStyle(fill, 1);
        this.enemyGfx.fillRect(s.x - size / 2, s.y - size / 2, size, size);
        this.enemyGfx.lineStyle(2, 0xff9999, 0.85);
        this.enemyGfx.strokeRect(s.x - size / 2, s.y - size / 2, size, size);

      } else { // reaper
        const alpha = e.data.alpha; // driven by Phaser tween
        const SZ    = 38;
        this.enemyGfx.fillStyle(0xffffff, alpha);
        this.enemyGfx.lineStyle(2, 0xffffff, Math.min(1, alpha + 0.2));
        this.enemyGfx.beginPath();
        this.enemyGfx.moveTo(s.x,             s.y - SZ);
        this.enemyGfx.lineTo(s.x + SZ * 0.75, s.y + SZ * 0.55);
        this.enemyGfx.lineTo(s.x - SZ * 0.75, s.y + SZ * 0.55);
        this.enemyGfx.closePath();
        this.enemyGfx.fillPath();
        this.enemyGfx.strokePath();
      }
    }

    // ── Nets ──
    for (const n of this.nets) {
      const s = toScreen(n.wx, n.wy);
      if (Math.abs(s.x - cam.x) > 800 || Math.abs(s.y - cam.y) > 500) continue;
      const alpha = 1.0 - n.dist / NET_RANGE;
      const hw = 12, hh = 7;
      // Outer diamond
      this.enemyGfx.lineStyle(1.5, 0xddddaa, alpha);
      this.enemyGfx.beginPath();
      this.enemyGfx.moveTo(s.x,      s.y - hh);
      this.enemyGfx.lineTo(s.x + hw, s.y);
      this.enemyGfx.lineTo(s.x,      s.y + hh);
      this.enemyGfx.lineTo(s.x - hw, s.y);
      this.enemyGfx.closePath();
      this.enemyGfx.strokePath();
      // Net cross-lines
      this.enemyGfx.lineStyle(1, 0xbbbb88, alpha * 0.75);
      this.enemyGfx.beginPath();
      this.enemyGfx.moveTo(s.x - hw * 0.6, s.y - hh * 0.5);
      this.enemyGfx.lineTo(s.x + hw * 0.6, s.y + hh * 0.5);
      this.enemyGfx.moveTo(s.x + hw * 0.6, s.y - hh * 0.5);
      this.enemyGfx.lineTo(s.x - hw * 0.6, s.y + hh * 0.5);
      this.enemyGfx.strokePath();
    }
  }


  // ── _drawGrass ───────────────────────────────────────────────────────────────
  _drawGrass() {
    this.grassGfx.clear();
    const cam = toScreen(this.wx, this.wy);
    for (const gp of this.grassPatches) {
      const s = toScreen(gp.wx, gp.wy);
      if (Math.abs(s.x - cam.x) > 900 || Math.abs(s.y - cam.y) > 600) continue;
      const rw = gp.size * 64;
      const rh = gp.size * 32;
      this.grassGfx.fillStyle(gp.color, gp.alpha);
      this.grassGfx.fillEllipse(s.x, s.y, rw, rh);
    }
  }

  // ── _drawTufts ───────────────────────────────────────────────────────────────
  _drawTufts() {
    this.tuftGfx.clear();
    const cam = toScreen(this.wx, this.wy);
    for (const t of this.groundTufts) {
      const s = toScreen(t.wx, t.wy);
      if (Math.abs(s.x - cam.x) > 900 || Math.abs(s.y - cam.y) > 600) continue;
      const sz = t.size * 33;
      const T  = 0.18;
      if (t.type === 0) {
        // Dry grass tuft
        this.tuftGfx.fillStyle(blendHex(0x7a5c14, t.tint, T), 0.85);
        this.tuftGfx.fillEllipse(s.x, s.y, sz * 1.5, sz * 0.55);
        this.tuftGfx.fillStyle(blendHex(0xa87c28, t.tint, T), 0.55);
        this.tuftGfx.fillEllipse(s.x - sz * 0.2, s.y - sz * 0.12, sz * 0.75, sz * 0.28);
      } else if (t.type === 1) {
        // Rock cluster
        this.tuftGfx.fillStyle(blendHex(0x848078, t.tint, T), 0.82);
        this.tuftGfx.fillEllipse(s.x, s.y, sz * 1.3, sz * 0.50);
        this.tuftGfx.fillStyle(blendHex(0xaaa89a, t.tint, T), 0.48);
        this.tuftGfx.fillEllipse(s.x - sz * 0.28, s.y - sz * 0.14, sz * 0.62, sz * 0.24);
      } else {
        // Thorny shrub
        this.tuftGfx.fillStyle(blendHex(0x3e3010, t.tint, T), 0.90);
        this.tuftGfx.fillEllipse(s.x, s.y, sz * 1.1, sz * 0.44);
        this.tuftGfx.fillStyle(blendHex(0x5a4418, t.tint, T), 0.55);
        this.tuftGfx.fillEllipse(s.x, s.y - sz * 0.13, sz * 0.72, sz * 0.30);
      }
    }
  }

  // ── _drawZones ───────────────────────────────────────────────────────────────
  _drawZones() {
    this.trunkGfx.clear();
    this.canopyGfx.clear();
    const time = this.time.now / 1000;
    const cam  = toScreen(this.wx, this.wy);

    // Build a unified draw-list of Caraibeira zones + saplings, sorted back-to-front
    const list = [];
    for (const z of this.zones) {
      const s = toScreen(z.wx, z.wy);
      if (Math.abs(s.x - cam.x) > 1000 || Math.abs(s.y - cam.y) > 650) continue;
      list.push({ kind: 'zone', obj: z, s, isoY: z.wx + z.wy });
    }
    for (const sp of this.saplings) {
      const s = toScreen(sp.wx, sp.wy);
      if (Math.abs(s.x - cam.x) > 1000 || Math.abs(s.y - cam.y) > 650) continue;
      list.push({ kind: 'sapling', obj: sp, s, isoY: sp.wx + sp.wy });
    }
    list.sort((a, b) => a.isoY - b.isoY); // ascending isoY = further back = draw first

    const gt = this.trunkGfx;  // trunks and ground auras
    const gc = this.canopyGfx; // canopy ellipses only

    for (const { kind, obj, s } of list) {
      // Per-tree wind sway — canopy only; phase field exists on both zones and saplings
      const phase      = obj.phase ?? 0;
      const swayAmp    = kind === 'zone' ? 2.5 : 1.2;
      const swayX      = Math.sin(time * 0.65 + phase) * swayAmp;
      const swayScaleW = 1 + 0.018 * Math.sin(time * 0.9 + phase);

      if (kind === 'sapling') {
        const f = obj.type === 0 ? 0.9 : 0.8;
        // Trunk — draws to trunkGfx
        gt.fillStyle(0x3a1e08, 1);
        gt.fillRect(s.x - Math.round(10 * f), s.y - Math.round(136 * f), Math.round(20 * f), Math.round(132 * f));
        // Canopy — draws to canopyGfx
        gc.fillStyle(0x1a6622, 0.94);
        gc.fillEllipse(s.x + swayX, s.y - Math.round(144 * f), Math.round(188 * f) * swayScaleW, Math.round(94 * f));
        gc.fillStyle(0x2d8834, 0.97);
        gc.fillEllipse(s.x + swayX, s.y - Math.round(200 * f), Math.round(140 * f) * swayScaleW, Math.round(70 * f));
        gc.fillStyle(0x56bb44, 1.0);
        gc.fillEllipse(s.x + swayX, s.y - Math.round(244 * f), Math.round(88 * f) * swayScaleW, Math.round(44 * f));
        continue;
      }

      // ── Caraibeira zone tree (2× original dimensions) ────────────────────
      const z = obj;
      const rw = z.radius * 64;
      const rh = z.radius * 32;
      const pulse = z.bloomed
        ? 0.70 + 0.30 * Math.sin(time * 2.5 + z.phase)
        : 0.60 + 0.40 * Math.sin(time * 1.8 + z.phase);

      // Ground aura — trunkGfx
      if (z.bloomed) {
        gt.fillStyle(0x00ffcc, 0.05 * pulse);
        gt.fillEllipse(s.x, s.y, rw * 2.2, rh * 2.2);
        gt.fillStyle(0x44ffdd, 0.10 * pulse);
        gt.fillEllipse(s.x, s.y, rw * 1.3, rh * 1.3);
        gt.lineStyle(1.5, 0x44ffcc, 0.55 * pulse);
        gt.strokeEllipse(s.x, s.y, rw * 1.8, rh * 1.8);
      } else {
        gt.fillStyle(0x44ff66, 0.04 * pulse);
        gt.fillEllipse(s.x, s.y, rw * 2.2, rh * 2.2);
        gt.fillStyle(0x66ff88, 0.08 * pulse);
        gt.fillEllipse(s.x, s.y, rw * 1.3, rh * 1.3);
        gt.lineStyle(1, 0x66ff88, 0.30 * pulse);
        gt.strokeEllipse(s.x, s.y, rw * 1.8, rh * 1.8);
      }

      // Trunk — trunkGfx
      gt.fillStyle(0x3a1e08, 1);
      gt.fillRect(s.x - 10, s.y - 136, 20, 132);

      // Canopy — canopyGfx
      if (z.bloomed) {
        gc.fillStyle(0x1aaa66, 0.95);
        gc.fillEllipse(s.x + swayX, s.y - 144, 188 * swayScaleW, 94);
        gc.fillStyle(0x33ddaa, 0.97);
        gc.fillEllipse(s.x + swayX, s.y - 200, 140 * swayScaleW, 70);
        gc.fillStyle(0x77ffcc, 1.0);
        gc.fillEllipse(s.x + swayX, s.y - 244, 88 * swayScaleW, 44);
        gc.lineStyle(1.5, 0xaaffee, 0.6 * pulse);
        gc.strokeEllipse(s.x + swayX, s.y - 200, 140 * swayScaleW, 70);
      } else {
        gc.fillStyle(0x1a6622, 0.94);
        gc.fillEllipse(s.x + swayX, s.y - 144, 188 * swayScaleW, 94);
        gc.fillStyle(0x2d8834, 0.97);
        gc.fillEllipse(s.x + swayX, s.y - 200, 140 * swayScaleW, 70);
        gc.fillStyle(0x56bb44, 1.0);
        gc.fillEllipse(s.x + swayX, s.y - 244, 88 * swayScaleW, 44);
      }
    }
  }

  // ── _drawTraps ───────────────────────────────────────────────────────────────
  _drawTraps() {
    this.trapGfx.clear();
    const cam = toScreen(this.wx, this.wy);
    const hw = 24, hh = 12;

    for (const t of this.traps) {
      const s = toScreen(t.wx, t.wy);
      if (Math.abs(s.x - cam.x) > 800 || Math.abs(s.y - cam.y) > 500) continue;

      // Brown isometric diamond
      this.trapGfx.fillStyle(0x7a3808, 1);
      this.trapGfx.beginPath();
      this.trapGfx.moveTo(s.x,      s.y - hh);
      this.trapGfx.lineTo(s.x + hw, s.y);
      this.trapGfx.lineTo(s.x,      s.y + hh);
      this.trapGfx.lineTo(s.x - hw, s.y);
      this.trapGfx.closePath();
      this.trapGfx.fillPath();

      // X cross marking it as a trap
      this.trapGfx.lineStyle(1.5, 0x2a0c02, 0.85);
      this.trapGfx.beginPath();
      this.trapGfx.moveTo(s.x - hw * 0.45, s.y - hh * 0.5);
      this.trapGfx.lineTo(s.x + hw * 0.45, s.y + hh * 0.5);
      this.trapGfx.moveTo(s.x + hw * 0.45, s.y - hh * 0.5);
      this.trapGfx.lineTo(s.x - hw * 0.45, s.y + hh * 0.5);
      this.trapGfx.strokePath();

      // Outline
      this.trapGfx.lineStyle(1, 0x4a1804, 1);
      this.trapGfx.beginPath();
      this.trapGfx.moveTo(s.x,      s.y - hh);
      this.trapGfx.lineTo(s.x + hw, s.y);
      this.trapGfx.lineTo(s.x,      s.y + hh);
      this.trapGfx.lineTo(s.x - hw, s.y);
      this.trapGfx.closePath();
      this.trapGfx.strokePath();
    }
  }

  // ── _drawTrail ───────────────────────────────────────────────────────────────
  _drawTrail() {
    this.trailGfx.clear();

    if (this.dashing) {
      const steps  = this.mateActive ? 12 : 6;
      const col    = this.mateActive ? 0x55ccff : 0x3399ff;
      const bright = this.mateActive ? 0.45 : 0.28;
      for (let i = 1; i <= steps; i++) {
        const f   = i / steps;
        const ts  = toScreen(this.wx - this.ddx * f * 0.55, this.wy - this.ddy * f * 0.55);
        this.trailGfx.fillStyle(col, (1 - f) * bright);
        this.trailGfx.fillCircle(ts.x, ts.y, 20 * (1 - f * 0.45));
      }
    }

    // Blue particle sparks (mate-boosted dash only — skip ghost particles)
    for (const p of this.particles) {
      if (p.ghost) continue;
      const ps    = toScreen(p.wx, p.wy);
      const alpha = (p.life / p.maxLife) * 0.7;
      this.trailGfx.fillStyle(0x55ccff, alpha);
      this.trailGfx.fillCircle(ps.x, ps.y, 5.5 * (p.life / p.maxLife));
    }

    // Speed Ghost trail (cyan-white wisps)
    for (const p of this.particles) {
      if (!p.ghost) continue;
      const ps    = toScreen(p.wx, p.wy);
      const frac  = p.life / p.maxLife;
      this.trailGfx.fillStyle(0xaaffee, frac * 0.55);
      this.trailGfx.fillCircle(ps.x, ps.y, 7 * frac);
    }
  }

  // ── _drawShadow ──────────────────────────────────────────────────────────────
  _drawShadow() {
    this.shadowGfx.clear();
    const s = toScreen(this.wx, this.wy);

    // Shadow turns red and pulses when the player is close to a trap
    const nearTrap = this.traps.some(t => Math.hypot(this.wx - t.wx, this.wy - t.wy) < 1.1);
    if (nearTrap) {
      const flicker = 0.40 + 0.45 * Math.abs(Math.sin(this.time.now / 130));
      this.shadowGfx.fillStyle(0xcc1100, 0.60 * flicker);
    } else {
      this.shadowGfx.fillStyle(0x000000, 0.25);
    }
    this.shadowGfx.fillEllipse(s.x, s.y + 40, 38, 14);
  }

  // ── _drawMate ────────────────────────────────────────────────────────────────
  _drawMate() {
    this.mateGfx.clear();
    if (!this.mateActive && !this.mateFading) return;

    // Position: follow path or spiral during departure
    let ms;
    if (this.mateFading && this.mateSpiralBase) {
      const base = toScreen(this.mateSpiralBase.wx, this.mateSpiralBase.wy);
      const r    = this.mateSpiralR * 55;
      ms = {
        x: base.x + Math.cos(this.mateSpiralAng) * r,
        y: base.y + Math.sin(this.mateSpiralAng) * r * 0.5, // flatten to iso ellipse
      };
    } else {
      ms = toScreen(this.mateWx, this.mateWy);
    }

    // Facing angle
    const fsx   = this.mateFx - this.mateFy;
    const fsy   = (this.mateFx + this.mateFy) * 0.5;
    const angle = Math.atan2(fsy, fsx) + Math.PI / 2;
    const cos   = Math.cos(angle), sin = Math.sin(angle);
    const SZ    = 17;
    const R     = (lx, ly) => ({ x: ms.x + lx * cos - ly * sin, y: ms.y + lx * sin + ly * cos });

    const a = this.mateAlpha;
    this.mateGfx.fillStyle(0x87d8ff, a);
    this.mateGfx.lineStyle(2, 0xd8f4ff, a * 0.9);

    const tip = R(0, -SZ), bl = R(-SZ * 0.65, SZ * 0.6), br = R(SZ * 0.65, SZ * 0.6);
    this.mateGfx.beginPath();
    this.mateGfx.moveTo(tip.x, tip.y);
    this.mateGfx.lineTo(bl.x,  bl.y);
    this.mateGfx.lineTo(br.x,  br.y);
    this.mateGfx.closePath();
    this.mateGfx.fillPath();
    this.mateGfx.strokePath();
  }

  // ── _drawPlayer ──────────────────────────────────────────────────────────────
  _drawPlayer() {
    // Dynamic depth: bird sorts between trunks (depth 1) and canopies (depth 7)
    const isoY = this.wx + this.wy;
    this.playerGfx.setDepth(5 + (isoY + WORLD_SPAN) / (WORLD_SPAN * 4));
    this.trailGfx.setDepth(this.playerGfx.depth - 0.15);

    const s   = toScreen(this.wx, this.wy);
    const SZ  = 20;
    const fsx = this.fx - this.fy;
    const fsy = (this.fx + this.fy) * 0.5;
    const angle = Math.atan2(fsy, fsx) + Math.PI / 2;
    const cos   = Math.cos(angle), sin = Math.sin(angle);
    const R     = (lx, ly) => ({ x: s.x + lx * cos - ly * sin, y: s.y + lx * sin + ly * cos });

    this.playerGfx.clear();

    // Spirit Anchor: blue light pulse rings while holding a zone
    if (this.activeZoneIdx >= 0) {
      const t = this.time.now / 1000;
      for (let ring = 0; ring < 2; ring++) {
        const phase = t * 4.5 + ring * Math.PI;
        const r = 28 + ring * 11 + 5 * Math.sin(phase);
        const a = 0.20 + 0.20 * Math.sin(phase);
        this.playerGfx.lineStyle(ring === 0 ? 2 : 1.5, 0x44ccff, a);
        this.playerGfx.strokeCircle(s.x, s.y, r);
      }
    }

    // Spirit Pulse — blue charging glow while anchoring
    if (this.activeZoneIdx >= 0) {
      const t2 = this.time.now / 1000;
      const pulse = 0.20 + 0.20 * Math.abs(Math.sin(t2 * 5.0));
      this.playerGfx.fillStyle(0x33aaff, pulse);
      this.playerGfx.fillCircle(s.x, s.y, SZ * 1.6);
    }

    const fill = this.dashing ? 0x88ccff : 0x1e8fff;
    this.playerGfx.fillStyle(fill, 1);
    this.playerGfx.lineStyle(2, 0xbde8ff, 1);

    const tip = R(0, -SZ), bl = R(-SZ * 0.65, SZ * 0.6), br = R(SZ * 0.65, SZ * 0.6);
    this.playerGfx.beginPath();
    this.playerGfx.moveTo(tip.x, tip.y);
    this.playerGfx.lineTo(bl.x,  bl.y);
    this.playerGfx.lineTo(br.x,  br.y);
    this.playerGfx.closePath();
    this.playerGfx.fillPath();
    this.playerGfx.strokePath();

    // Spirit Sense: red flicker outline when Reaper is near but hidden in fog
    if (this.spiritSense) {
      const flicker = 0.35 + 0.65 * Math.abs(Math.sin(this.time.now / 160));
      this.playerGfx.lineStyle(3, 0xff2200, flicker * 0.9);
      this.playerGfx.beginPath();
      this.playerGfx.moveTo(tip.x, tip.y);
      this.playerGfx.lineTo(bl.x,  bl.y);
      this.playerGfx.lineTo(br.x,  br.y);
      this.playerGfx.closePath();
      this.playerGfx.strokePath();
    }

    // Dash cooldown arc
    if (!this.dashing && this.dashCD > 0) {
      const frac = 1 - (this.dashCD / DASH_CD);
      this.playerGfx.lineStyle(2, 0x4488ff, 0.55);
      this.playerGfx.beginPath();
      this.playerGfx.arc(s.x, s.y, SZ + 7, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      this.playerGfx.strokePath();
    }
  }

  // ── _genWorld ────────────────────────────────────────────────────────────────
  _genWorld() {
    // Helper: checks that a world point is safely inside the camera bounds.
    const inBounds = (wx, wy, mX, mY) => {
      const sx = (wx - wy) * 64, sy = (wx + wy) * 32;
      return Math.abs(sx) + mX < 1750 && Math.abs(sy) + mY < 1300;
    };

    // Habitat decline: fewer Caraibeira trees as years pass
    const yearDelta  = Math.max(0, this.currentYear - 1987);
    const numZones   = Math.max(1, NUM_ZONES - Math.floor(yearDelta / 20));
    this.pointsToWin = Math.min(POINTS_TO_WIN, numZones);

    // Caraibeira zones — spread out, not overlapping
    this.zones = [];
    for (let i = 0; i < numZones; i++) {
      let wx, wy, ok, tries = 0;
      do {
        wx = (Math.random() - 0.5) * WORLD_SPAN * 2;
        wy = (Math.random() - 0.5) * WORLD_SPAN * 2;
        ok = Math.hypot(wx, wy) > 15 &&
             this.zones.every(z => Math.hypot(wx - z.wx, wy - z.wy) > ZONE_R * 2.0) &&
             inBounds(wx, wy, ZONE_R * 64, ZONE_R * 32);
      } while (!ok && ++tries < 500);
      this.zones.push({ wx, wy, radius: ZONE_R, phase: Math.random() * Math.PI * 2, bloomed: false });
    }

    // Saplings — two sizes of obstacle trees filling out the dense Caatinga forest
    // Type 0 = 90% of Caraibeira size, Type 1 = 80% of Caraibeira size
    this.saplings = [];
    let tries = 0;
    while (this.saplings.length < NUM_SAPLINGS && tries++ < 9000) {
      const wx = (Math.random() - 0.5) * WORLD_SPAN * 2;
      const wy = (Math.random() - 0.5) * WORLD_SPAN * 2;
      if (!inBounds(wx, wy, 40, 40)) continue;
      if (Math.hypot(wx, wy) < 5) continue;
      if (this.zones.some(z => Math.hypot(wx - z.wx, wy - z.wy) < z.radius + 1.5)) continue;
      if (this.saplings.some(s => Math.hypot(wx - s.wx, wy - s.wy) < 2.0)) continue;
      const type   = Math.random() < 0.5 ? 0 : 1;
      const trunkR = type === 0 ? 0.40 : 0.36;
      this.saplings.push({ wx, wy, type, trunkR, phase: Math.random() * Math.PI * 2 });
    }

    // Ground tufts — decorative Caatinga details (dry grass, rocks, shrubs); NO hitbox
    this.groundTufts = [];
    tries = 0;
    const EARTHY_TINTS = [0x4a7c3f, 0xc4a882, 0xc4703f]; // Moss, Dust, Dry Clay
    while (this.groundTufts.length < NUM_TUFTS && tries++ < 2000) {
      const wx = (Math.random() - 0.5) * WORLD_SPAN * 2;
      const wy = (Math.random() - 0.5) * WORLD_SPAN * 2;
      if (!inBounds(wx, wy, 60, 60)) continue;
      if (Math.hypot(wx, wy) < 4) continue;
      if (this.zones.some(z   => Math.hypot(wx - z.wx,  wy - z.wy)  < z.radius)) continue;
      if (this.saplings.some(s => Math.hypot(wx - s.wx,  wy - s.wy)  < 1.2))     continue;
      this.groundTufts.push({
        wx, wy,
        type: Math.floor(Math.random() * 3), // 0 = dry grass, 1 = rocks, 2 = thorny shrub
        size: 0.7 + Math.random() * 0.6,
        tint: EARTHY_TINTS[Math.floor(Math.random() * 3)],
      });
    }

    // Grass patches — green spots scattered over the ochre ground
    this.grassPatches = [];
    tries = 0;
    const grassColors = [0x4a8c2a, 0x5ab030, 0x3d7a1e, 0x66b844, 0x438c28];
    while (this.grassPatches.length < 200 && tries++ < 3000) {
      const wx = (Math.random() - 0.5) * WORLD_SPAN * 2;
      const wy = (Math.random() - 0.5) * WORLD_SPAN * 2;
      if (!inBounds(wx, wy, 80, 80)) continue;
      const size  = 0.5 + Math.random() * 1.0;
      const color = grassColors[Math.floor(Math.random() * grassColors.length)];
      const alpha = 0.22 + Math.random() * 0.22;
      this.grassPatches.push({ wx, wy, size, color, alpha });
    }

    // Traps — kept clear of all trees
    this.traps = [];
    tries = 0;
    while (this.traps.length < NUM_TRAPS && tries++ < 3000) {
      const wx = (Math.random() - 0.5) * WORLD_SPAN * 2;
      const wy = (Math.random() - 0.5) * WORLD_SPAN * 2;
      if (Math.hypot(wx, wy) < 10) continue;
      if (!inBounds(wx, wy, 40, 40)) continue;
      if (this.zones.some(z => Math.hypot(wx - z.wx, wy - z.wy) < z.radius + 1.5)) continue;
      if (this.saplings.some(s => Math.hypot(wx - s.wx, wy - s.wy) < 1.5)) continue;
      this.traps.push({ wx, wy });
    }

    // Poachers
    this.poachers = [];
    tries = 0;
    while (this.poachers.length < NUM_POACHERS && tries++ < 2000) {
      const wx = (Math.random() - 0.5) * WORLD_SPAN * 2;
      const wy = (Math.random() - 0.5) * WORLD_SPAN * 2;
      if (Math.hypot(wx, wy) < 12) continue;
      if (!inBounds(wx, wy, 60, 60)) continue;
      if (this.zones.some(z => Math.hypot(wx - z.wx, wy - z.wy) < z.radius + 2)) continue;
      this.poachers.push({
        wx, wy, wx0: wx, wy0: wy,
        state: 'patrol',
        patrolAngle: Math.random() * Math.PI * 2,
        netCD: Math.random() * NET_CD,  // stagger initial cooldowns
      });
    }

    // Ghost Reaper — starts far from origin
    let rx, ry, rtries = 0;
    do {
      rx = (Math.random() - 0.5) * WORLD_SPAN * 2;
      ry = (Math.random() - 0.5) * WORLD_SPAN * 2;
    } while ((Math.hypot(rx, ry) < 18 || !inBounds(rx, ry, 60, 60)) && rtries++ < 400);
    this.reaper = { wx: rx, wy: ry, alpha: 0.2 };

    // Poacher nets — fired projectiles
    this.nets = [];
  }

  // ── _updateScore ─────────────────────────────────────────────────────────────
  _updateScore(dt) {
    if (this.levelClearing) return;

    // Great Caraibeira entry check (world origin, generous radius)
    if (this.portalActive && Math.hypot(this.wx, this.wy) < 2.0) {
      this._triggerLevelClear();
      return;
    }

    // Find which un-bloomed zone the player is standing in
    let inZone = -1;
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i];
      if (!z.bloomed && Math.hypot(this.wx - z.wx, this.wy - z.wy) < z.radius) {
        inZone = i;
        break;
      }
    }

    if (inZone >= 0) {
      this.activeZoneIdx = inZone;
      this.zoneHoldTimer += dt;
      this.energy = Math.min(1.0, this.energy + ENERGY_REFILL_SPD * dt); // refill while anchoring
      if (this.zoneHoldTimer >= ZONE_HOLD_TIME) {
        this.zones[inZone].bloomed = true;
        this.score++;
        this.spiritGhostTimer = GHOST_TRAIL_DUR; // grant Speed Ghost trail
        this.zoneHoldTimer = 0;
        this.activeZoneIdx = -1;
        // Wind gust burst from the newly-bloomed tree
        const bz = this.zones[inZone];
        for (let wi = 0; wi < 24; wi++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 1.8 + Math.random() * 3.2;
          const life  = 0.5 + Math.random() * 0.9;
          this.particles.push({
            wx: bz.wx + (Math.random() - 0.5) * bz.radius * 0.6,
            wy: bz.wy + (Math.random() - 0.5) * bz.radius * 0.6,
            vwx: Math.cos(angle) * speed,
            vwy: Math.sin(angle) * speed,
            life, maxLife: life,
            wind: true,
          });
        }
        if (this.score >= this.pointsToWin && !this.portalActive) {
          this.portalActive = true;
        }
      }
    } else {
      this.zoneHoldTimer = 0;
      this.activeZoneIdx = -1;
    }
  }

  // ── _drawPortal (Great Caraibeira — 2× scale, golden/white) ─────────────────
  _drawPortal() {
    this.portalGfx.clear();
    if (!this.portalActive) return;

    const s = toScreen(0, 0);
    const t = this.time.now / 1000;
    const pulse = 0.75 + 0.25 * Math.sin(t * 2.0);

    // Ground aura — golden rings (2× radius vs regular tree)
    this.portalGfx.fillStyle(0xcc8800, 0.07 * pulse);
    this.portalGfx.fillEllipse(s.x, s.y, 560, 280);
    this.portalGfx.fillStyle(0xffcc22, 0.13 * pulse);
    this.portalGfx.fillEllipse(s.x, s.y, 320, 160);
    this.portalGfx.fillStyle(0xffffff, 0.22 * pulse);
    this.portalGfx.fillEllipse(s.x, s.y, 160, 80);

    // Entry ring — golden beacon, shows where player should walk
    this.portalGfx.lineStyle(3, 0xffdd44, 0.75 * pulse);
    this.portalGfx.strokeEllipse(s.x, s.y, 256, 128);

    // Trunk — 2× width and height, warm gold
    this.portalGfx.fillStyle(0xffcc33, 0.65 * pulse);
    this.portalGfx.fillRect(s.x - 10, s.y - 120, 20, 120);
    this.portalGfx.fillStyle(0xffffff, 0.80 * pulse);
    this.portalGfx.fillRect(s.x - 6,  s.y - 120, 12, 120);

    // Canopy — three layered tiers at 2× size, golden to white at top
    this.portalGfx.fillStyle(0xffcc22, 0.40 * pulse);
    this.portalGfx.fillEllipse(s.x, s.y - 130, 200, 110);
    this.portalGfx.fillStyle(0xffee77, 0.55 * pulse);
    this.portalGfx.fillEllipse(s.x, s.y - 144, 128,  72);
    this.portalGfx.fillStyle(0xffffff, 0.80 * pulse);
    this.portalGfx.fillEllipse(s.x, s.y - 160,  64,  36);

    // Radiating branch lines — 2× reach, golden
    this.portalGfx.lineStyle(2, 0xffee66, 0.55 * pulse);
    for (let i = 0; i < 8; i++) {
      const a  = t * 0.4 + i * Math.PI / 4;
      const r0 = 28, r1 = 64 + 14 * Math.sin(t * 2.5 + i);
      this.portalGfx.beginPath();
      this.portalGfx.moveTo(s.x + Math.cos(a) * r0, s.y - 144 + Math.sin(a) * r0 * 0.45);
      this.portalGfx.lineTo(s.x + Math.cos(a) * r1, s.y - 144 + Math.sin(a) * r1 * 0.45);
      this.portalGfx.strokePath();
    }
  }

  // Draws an organic pixel-notch border around a rectangle.
  // gfx: Phaser.Graphics | x,y,w,h: box coords | col: packed hex color
  _barkBorder(gfx, x, y, w, h, col) {
    const notch = [3, 1, 3, 2, 2, 1, 3, 1, 2, 3, 1, 2];
    let ni = 0;
    gfx.fillStyle(col, 1);
    for (let i = x; i < x + w; i++) {
      const n = notch[ni++ % notch.length];
      const ext = (i % n === 0) ? 2 : 1;
      gfx.fillRect(i, y - ext + 1, 1, ext); // top edge
      gfx.fillRect(i, y + h - 1,   1, ext); // bottom edge
    }
    for (let j = y; j < y + h; j++) {
      const n = notch[ni++ % notch.length];
      const ext = (j % n === 0) ? 2 : 1;
      gfx.fillRect(x - ext + 1, j, ext, 1); // left edge
      gfx.fillRect(x + w - 1,   j, ext, 1); // right edge
    }
  }

  // ── _drawHUD ─────────────────────────────────────────────────────────────────
  _drawHUD() {
    this.hudGfx.clear();

    // ── Spirit Meter — circular progress bar above the player ──
    if (this.activeZoneIdx >= 0) {
      const ws  = toScreen(this.wx, this.wy);
      const cam = this.cameras.main;
      const sx  = ws.x - cam.scrollX;
      const sy  = ws.y - cam.scrollY;
      const cy  = sy - 52;   // centre of the ring
      const R   = 22;
      const frac = this.zoneHoldTimer / ZONE_HOLD_TIME;

      // Track (background ring)
      this.hudGfx.lineStyle(4, 0x1a3322, 0.7);
      this.hudGfx.strokeCircle(sx, cy, R);

      // Progress arc — white, sweeps clockwise from top
      if (frac > 0) {
        this.hudGfx.lineStyle(4, 0xffffff, 0.92);
        this.hudGfx.beginPath();
        this.hudGfx.arc(sx, cy, R, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        this.hudGfx.strokePath();
      }

      // Leading-edge glow dot
      if (frac > 0 && frac < 1) {
        const ea = -Math.PI / 2 + frac * Math.PI * 2;
        this.hudGfx.fillStyle(0xffffff, 1.0);
        this.hudGfx.fillCircle(sx + Math.cos(ea) * R, cy + Math.sin(ea) * R, 3.5);
      }

      // Full burst flash when meter completes
      if (frac >= 1) {
        const t = this.time.now / 1000;
        this.hudGfx.fillStyle(0xffffff, 0.5 + 0.4 * Math.abs(Math.sin(t * 6)));
        this.hudGfx.fillCircle(sx, cy, 10);
      }
    }
    this.timerText.setVisible(false);

    // ── Persistent HUD texts ─────────────────────────────────────────────────
    const ghostSuffix = this.spiritGhostTimer > 0
      ? `  ✦ ${Math.ceil(this.spiritGhostTimer)}s` : '';
    this.treesSavedText.setText(`Trees Saved: ${this.score} / ${this.pointsToWin}${ghostSuffix}`);

    // Ancestral Call status
    if (this.ancestralCD > 0) {
      this.ancestralText.setColor('#666688').setText(`[E] Ancestral Call — ${Math.ceil(this.ancestralCD)}s`);
    } else {
      this.ancestralText.setColor('#88ccff').setText('[E] Ancestral Call');
    }

    // ── Health bar ───────────────────────────────────────────────────────────
    const hbX = 20, hbY = 60, hbW = 120, hbH = 10;
    const maxHp = 3, hp = this.playerHealth;
    this.hudGfx.fillStyle(0x222222, 0.8);
    this.hudGfx.fillRect(hbX, hbY, hbW, hbH);
    this.hudGfx.fillStyle(0x44cc44, 0.9);
    this.hudGfx.fillRect(hbX, hbY, hbW * (hp / maxHp), hbH);
    this.hudGfx.lineStyle(1.5, 0xffffff, 0.5);
    this.hudGfx.strokeRect(hbX, hbY, hbW, hbH);

    // ── Energy bar — Ritual Bark style ────────────────────────────────────
    const SW = this.scale.width;
    const ebW = 120, ebH = 10, ebX = SW - 140, ebY = 60;

    // Glow behind bar
    for (let i = 8; i > 0; i--) {
      this.hudGfx.fillStyle(0x8cc83c, i * 0.012);
      this.hudGfx.fillRect(ebX - i, ebY - i, ebW + i * 2, ebH + i * 2);
    }
    // Dark trough
    this.hudGfx.fillStyle(0x0e1804, 1);
    this.hudGfx.fillRect(ebX, ebY, ebW, ebH);
    // Fill — green gradient approximated with two rects; orange warning when low
    const fillW = ebW * this.energy;
    if (this.energy > 0.30) {
      this.hudGfx.fillStyle(0x3a7010, 1);
      this.hudGfx.fillRect(ebX, ebY, fillW, ebH);
      this.hudGfx.fillStyle(0xa8e040, 0.55);
      this.hudGfx.fillRect(ebX, ebY, fillW, Math.ceil(ebH * 0.45));
      // Shimmer line — only on green fill state
      this.hudGfx.fillStyle(0xb4ff50, 0.4);
      this.hudGfx.fillRect(ebX, ebY, fillW, 2);
    } else {
      this.hudGfx.fillStyle(0xff7722, 0.9);
      this.hudGfx.fillRect(ebX, ebY, fillW, ebH);
    }
    // Bark border
    this._barkBorder(this.hudGfx, ebX - 2, ebY - 2, ebW + 4, ebH + 4, 0x8a6830);
    // Position 'SPIRIT ENERGY' label 10px above the bar
    this.energyLabel.setPosition(ebX, ebY - 10);

    // ── Year clock — Ritual Bark style ────────────────────────────────────
    const yw = 88, yh = 28, yx = SW - yw - 16, yy = 14;
    // Glow
    for (let i = 8; i > 0; i--) {
      this.hudGfx.fillStyle(0xb48c1e, i * 0.012);
      this.hudGfx.fillRect(yx - i, yy - i, yw + i * 2, yh + i * 2);
    }
    // Background
    this.hudGfx.fillStyle(0x110c04, 1);
    this.hudGfx.fillRect(yx, yy, yw, yh);
    // Bark border
    this._barkBorder(this.hudGfx, yx - 2, yy - 2, yw + 4, yh + 4, 0x8a6830);
    // Position 'YEAR' label and year numeral inside the box
    this.yearText.setPosition(yx + yw / 2, yy + 5);
    this.yearNumText.setPosition(yx + yw / 2, yy + yh - 4).setText(String(this.currentYear));
  }

  // ── _triggerLevelClear ───────────────────────────────────────────────────────
  _triggerLevelClear() {
    if (this.levelClearing) return;
    this.levelClearing = true;
    this.dead = true;
    this.vx = 0; this.vy = 0;

    const nextYear = this.currentYear + 1; // successful preservation — only +1 year
    const w = this.scale.width, h = this.scale.height;
    const font = 'Arial, Helvetica, sans-serif';

    // White fade-to-light — the Sanctuary welcomes the spirit
    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0xfff8e0)
      .setScrollFactor(0).setDepth(200).setAlpha(0);

    const headline = this.add.text(w / 2, h / 2 - 48,
      'The Legacy Continues', {
        fontFamily: font, fontSize: '52px', color: '#3a2400',
        stroke: '#fff8e0', strokeThickness: 3, align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0);

    const sub = this.add.text(w / 2, h / 2 + 20,
      `The spirit has marked the path.\nThe year advances to ${nextYear}.`, {
        fontFamily: font, fontSize: '22px', color: '#5a3a00',
        stroke: '#fff8e0', strokeThickness: 2, align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0);

    this.tweens.add({ targets: overlay,             alpha: 1, duration: 1800 });
    this.tweens.add({ targets: [headline, sub],     alpha: 1, duration: 1000, delay: 1500 });
    this.time.delayedCall(6000, () => this.scene.restart({ year: nextYear }));
  }

  // ── _triggerDeath ─────────────────────────────────────────────────────────────
  _triggerDeath() {
    if (this.dead) return;
    this.dead = true;
    this.vx = 0; this.vy = 0;

    const nextYear = this.currentYear + 2; // each failure costs 2 years (one generation)
    const w = this.scale.width, h = this.scale.height;
    const font = 'Arial, Helvetica, sans-serif';

    this.cameras.main.shake(200, 0.025);

    // ── EXTINCTION — year has reached 2000 ───────────────────────────────
    if (nextYear >= 2000) {
      const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x000000)
        .setScrollFactor(0).setDepth(200).setAlpha(0);

      const headline = this.add.text(w / 2, h / 2 - 60,
        'EXTINCTION', {
          fontFamily: font, fontSize: '72px', color: '#cc2200',
          stroke: '#000000', strokeThickness: 6, align: 'center',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0);

      const flavour = this.add.text(w / 2, h / 2 + 14,
        `The year 2000 has arrived.\nThe last Spix's Macaw falls silent.\nThe jungle remembers only the echo of wings.`, {
          fontFamily: font, fontSize: '22px', color: '#aabbcc',
          stroke: '#000000', strokeThickness: 3, align: 'center',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0);

      const sub = this.add.text(w / 2, h / 2 + 110,
        'Press SPACE to begin again.', {
          fontFamily: font, fontSize: '16px', color: '#666688',
          stroke: '#000000', strokeThickness: 2, align: 'center',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0);

      this.tweens.add({ targets: overlay,            alpha: 1, duration: 1600, delay: 200 });
      this.tweens.add({ targets: [headline, flavour], alpha: 1, duration: 900,  delay: 1200 });
      this.tweens.add({ targets: sub,                alpha: 1, duration: 700,  delay: 2400 });

      // Restart from 1987 on SPACE
      this.time.delayedCall(1600, () => {
        this.input.keyboard.once('keydown-SPACE', () => {
          this.scene.restart({ year: 1987 });
        });
      });
      return;
    }

    // ── GENERATION LOST — year < 2000 after penalty ───────────────────────
    // Black overlay tweened in — avoids camera.fade() which occludes depth-200+ objects
    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x000000)
      .setScrollFactor(0).setDepth(200).setAlpha(0);

    const headline = this.add.text(w / 2, h / 2 - 54,
      'Generation Lost', {
        fontFamily: font, fontSize: '54px', color: '#ffffff',
        stroke: '#000000', strokeThickness: 5, align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0);

    const flavour = this.add.text(w / 2, h / 2 + 14,
      `The clock jumps to ${nextYear}.\nThe spirit endures — but time runs short.`, {
        fontFamily: font, fontSize: '22px', color: '#aabbcc',
        stroke: '#000000', strokeThickness: 3, align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0);

    const sub = this.add.text(w / 2, h / 2 + 80,
      'Press SPACE to return as the next generation.', {
        fontFamily: font, fontSize: '16px', color: '#666688',
        stroke: '#000000', strokeThickness: 2, align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0);

    this.tweens.add({ targets: overlay,            alpha: 1, duration: 1200, delay: 200 });
    this.tweens.add({ targets: [headline, flavour], alpha: 1, duration: 900,  delay: 900 });
    this.tweens.add({ targets: sub,                alpha: 1, duration: 700,  delay: 2000 });

    // Listen for SPACE after overlay has faded in
    this.time.delayedCall(1200, () => {
      this.input.keyboard.once('keydown-SPACE', () => {
        this.scene.restart({ year: nextYear });
      });
    });
  }

  // ── _updateAncestralCall ──────────────────────────────────────────────────────
  _updateAncestralCall(dt) {
    if (this.ancestralCD > 0)     this.ancestralCD     = Math.max(0, this.ancestralCD - dt);
    if (this.ancestralReveal > 0) this.ancestralReveal = Math.max(0, this.ancestralReveal - dt);

    // Advance each ripple ring outward and age it
    for (let i = this.ancestralRipples.length - 1; i >= 0; i--) {
      const rip = this.ancestralRipples[i];
      rip.r    += 9 * dt;  // expand 9 world-units/sec
      rip.life -= dt;
      if (rip.life <= 0) this.ancestralRipples.splice(i, 1);
    }

    // Single-press detection for E
    const eNow = this.keys.E.isDown;
    if (eNow && !this.prevE && this.ancestralCD <= 0) {
      this.ancestralCD     = 10;
      this.ancestralReveal = 2;
      // Spawn 3 staggered rings from player position
      for (let i = 0; i < 3; i++) {
        const life = 1.6 + i * 0.25;
        this.ancestralRipples.push({
          wx: this.wx, wy: this.wy,
          r: i * 1.8,      // stagger so rings don't all start at the same radius
          life, maxLife: life,
        });
      }
    }
    this.prevE = eNow;
  }

  // ── _drawAncestralCall ────────────────────────────────────────────────────────
  _drawAncestralCall() {
    this.revealGfx.clear();

    // ── Wind gust burst particles (above fog, from bloomed trees) ──
    for (const p of this.particles) {
      if (!p.wind) continue;
      const ps   = toScreen(p.wx, p.wy);
      const frac = p.life / p.maxLife;
      this.revealGfx.fillStyle(0x55ffcc, frac * 0.9);
      this.revealGfx.fillCircle(ps.x, ps.y, 5 * frac + 2);
      this.revealGfx.fillStyle(0xffffff, frac * 0.5);
      this.revealGfx.fillCircle(ps.x, ps.y, 2.2 * frac);
    }

    // ── Spirit Path — animated flowing dots from player toward Sanctuary ──
    if (this.portalActive && !this.levelClearing) {
      const playerS = toScreen(this.wx, this.wy);
      const sanctS  = toScreen(0, 0);
      const dxS = sanctS.x - playerS.x;
      const dyS = sanctS.y - playerS.y;
      const pathLen = Math.hypot(dxS, dyS);
      if (pathLen > 20) {
        const t = this.time.now / 1000;
        const steps = Math.floor(pathLen / 16);
        for (let i = 1; i < steps; i++) {
          const frac  = i / steps;
          // Animate: offset phase over time for flowing "marching dots" effect
          const phase = (frac - t * 0.28 + 20) % 1.0;
          if (phase > 0.42) continue; // gap between dashes
          const px = playerS.x + dxS * frac;
          const py = playerS.y + dyS * frac;
          const r  = 3.5 * (1 - frac * 0.55);        // taper toward sanctuary
          const a  = ((0.42 - phase) / 0.42) * 0.75;  // fade toward tip
          this.revealGfx.fillStyle(0x44aaff, a);
          this.revealGfx.fillCircle(px, py, r);
        }
        // Bright dot at sanctuary end
        this.revealGfx.fillStyle(0xffffff, 0.7 + 0.3 * Math.abs(Math.sin(this.time.now / 300)));
        this.revealGfx.fillCircle(sanctS.x, sanctS.y, 6);
      }
    }

    // ── Expanding ripple rings (drawn in world space, above fog) ──
    for (const rip of this.ancestralRipples) {
      const s     = toScreen(rip.wx, rip.wy);
      const alpha = (rip.life / rip.maxLife) * 0.85;
      const rw    = rip.r * 128;   // iso half-width (world × tile width)
      const rh    = rip.r * 64;    // iso half-height
      this.revealGfx.lineStyle(2.5, 0x44aaff, alpha);
      this.revealGfx.strokeEllipse(s.x, s.y, rw, rh);
      // Inner fill shimmer
      this.revealGfx.fillStyle(0x88ccff, alpha * 0.08);
      this.revealGfx.fillEllipse(s.x, s.y, rw, rh);
    }

    // ── Zone reveal — bright beacon rings above fog for 2 seconds ──
    if (this.ancestralReveal > 0) {
      const pulse  = 0.65 + 0.35 * Math.abs(Math.sin(this.time.now / 160));
      const fadeIn = Math.min(1, this.ancestralReveal / 0.3);  // quick fade-in
      const alpha  = pulse * fadeIn;
      for (const z of this.zones) {
        if (z.bloomed) continue;
        const s  = toScreen(z.wx, z.wy);
        const rw = z.radius * 128;
        const rh = z.radius * 64;
        this.revealGfx.fillStyle(0x22ddff, 0.14 * alpha);
        this.revealGfx.fillEllipse(s.x, s.y, rw * 2.4, rh * 2.4);
        this.revealGfx.lineStyle(3, 0x44eeff, 0.95 * alpha);
        this.revealGfx.strokeEllipse(s.x, s.y, rw * 2.0, rh * 2.0);
        // Bright centre dot so it's visible even fully inside fog
        this.revealGfx.fillStyle(0xaaffff, 0.7 * alpha);
        this.revealGfx.fillCircle(s.x, s.y, 8);
      }
    }
  }

  // ── _makeFog ─────────────────────────────────────────────────────────────────
  _makeFog() {
    const W = 1280, H = 720;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Warm gray fog: fully transparent at centre, fully opaque at edge.
    // The outer color matches the camera background so the tile boundary is invisible.
    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.22,   // clear radius
                                           W / 2, H / 2, H * 0.88);  // fully opaque radius
    grad.addColorStop(0.00, 'rgba(176, 168, 144, 0)');    // clear centre
    grad.addColorStop(0.40, 'rgba(176, 168, 144, 0.18)'); // light haze begins
    grad.addColorStop(0.72, 'rgba(176, 168, 144, 0.72)'); // thick fog
    grad.addColorStop(1.00, 'rgba(176, 168, 144, 1.0)');  // fully opaque — hides tile edge

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    this.textures.addCanvas('fog', canvas);
    this.add.image(0, 0, 'fog').setOrigin(0, 0).setScrollFactor(0).setDepth(50);
  }

}

// ─── Boot ─────────────────────────────────────────────────────────────────────
new Phaser.Game({
  type:   Phaser.AUTO,
  width:  1280,
  height: 720,
  scale:  { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  backgroundColor: '#8c6420',
  scene:  GameScene,
});
