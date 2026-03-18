// ─── Constants ────────────────────────────────────────────────────────────────
const TILE_W = 128;
const TILE_H = 64;
const RENDER_R = 12;   // tile render radius — large enough for fog to cover the edge seam

// Movement
const SPEED       = 6.4;
const SPEED_BOOST = 1.45;  // multiplier while Mate is active
const ACCEL       = 32;    // softer ramp-up for bird-like feel
const DRAG        = 7;     // low drag → long glide, not a helicopter stop

// Dash
const DASH_V   = 30;
const DASH_DUR = 0.16;
const DASH_CD  = 0.70;

// World generation
const NUM_ZONES      = 16;     // base count — declines with year
const ZONE_R         = 3.23;   // Caraibeira zone radius
const ZONE_TRUNK_R   = 0.45;   // collideable trunk radius (world units)
const NUM_TRAPS      = 22;
const NUM_SAPLINGS   = 36;     // decorative trees — also collideable
const SAPLING_TRUNK_R = 0.22;  // sapling trunk collision radius
const WORLD_SPAN     = 27;     // 50% larger than original 18 — fits 3600×2700 bounds

// Enemies
const NUM_POACHERS       = 5;
const POACHER_PATROL_R   = 1.5;   // world units ≈ 100 screen px
const POACHER_DETECT_R   = 3.0;   // chase trigger ≈ 200 px
const POACHER_RETURN_R   = 4.5;   // return trigger ≈ 300 px
const POACHER_SPEED      = 125 / 64; // world units/sec ≈ 125 px/s
const POACHER_PATROL_SPD = 0.5;   // rad/sec for patrol orbit
const REAPER_SPEED       = 0.625; // world units/sec ≈ 40 px/s

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

// ─── Scene ────────────────────────────────────────────────────────────────────
class GameScene extends Phaser.Scene {
  constructor() { super({ key: 'Game' }); }

  // ── init ────────────────────────────────────────────────────────────────────
  init(data) {
    this.currentYear  = (data && data.year) ? data.year : 1987;
    this.playerHealth = 3; // placeholder — full bar until health system is built
  }

  // ── create ──────────────────────────────────────────────────────────────────
  create() {
    // Ochre Caatinga floor tiles
    this._makeTex('t0', 0xb07828, 0x8a5818);
    this._makeTex('t1', 0xbe8832, 0x7a4810);

    // Tile sprite pool
    const side = RENDER_R * 2 + 1;
    this.tilePool = Array.from({ length: side * side }, () =>
      this.add.sprite(0, 0, 't0').setOrigin(0.5, 0.5).setDepth(0)
    );

    // Graphics layers (depth order matters)
    this.zoneGfx   = this.add.graphics().setDepth(1);
    this.portalGfx = this.add.graphics().setDepth(1.5);
    this.trapGfx   = this.add.graphics().setDepth(2);
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

    // Current Year — top-right corner
    this.yearText = this.add.text(HW - 20, 16, '', {
      fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '18px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(100);

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

    this.cameras.main.setBackgroundColor('#b0a890'); // warm gray — blends with fog edge
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

    this._placeTiles();
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

    // Tree depth: go behind a tree when entity is north of its trunk base
    let pd = 6, sd = 4, td = 3, ed = 5.5;
    const pIsoY = this.wx + this.wy;

    for (const z of this.zones) {
      const zIsoY = z.wx + z.wy;
      if (pd > 1 &&
          Math.hypot(this.wx - z.wx, this.wy - z.wy) < z.radius * 2.5 &&
          pIsoY < zIsoY) {
        pd = 0.5; sd = 0.4; td = 0.3;
      }
      if (ed > 1 &&
          Math.hypot(this.reaper.wx - z.wx, this.reaper.wy - z.wy) < z.radius * 2.0 &&
          this.reaper.wx + this.reaper.wy < zIsoY) {
        ed = 0.6;
      }
      if (ed > 1) {
        for (const p of this.poachers) {
          if (Math.hypot(p.wx - z.wx, p.wy - z.wy) < z.radius * 2.0 &&
              p.wx + p.wy < zIsoY) {
            ed = 0.6; break;
          }
        }
      }
    }
    // Saplings also occlude the player
    if (pd > 1) {
      for (const sp of this.saplings) {
        if (Math.hypot(this.wx - sp.wx, this.wy - sp.wy) < sp.sc * 3.5 &&
            pIsoY < sp.wx + sp.wy) {
          pd = 0.5; sd = 0.4; td = 0.3; break;
        }
      }
    }

    this.playerGfx.setDepth(pd);
    this.shadowGfx.setDepth(sd);
    this.trailGfx.setDepth(td);
    this.enemyGfx.setDepth(ed);
  }

  // ── _move ────────────────────────────────────────────────────────────────────
  _move(dt) {
    const k = this.keys;

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

    // Dash — single press
    const spNow = k.SPACE.isDown;
    if (spNow && !this.prevSpace && !this.dashing && this.dashCD <= 0) {
      this.dashing   = true;
      this.dashTimer = DASH_DUR;
      this.dashCD    = DASH_CD;
      this.ddx = this.fx; this.ddy = this.fy;
      this.vx = this.ddx * DASH_V;
      this.vy = this.ddy * DASH_V;
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
      } else {
        const sp = Math.hypot(this.vx, this.vy);
        if (sp > 0) {
          const ns = Math.max(0, sp - DRAG * dt);
          this.vx *= ns / sp;
          this.vy *= ns / sp;
        }
      }
      const sp = Math.hypot(this.vx, this.vy);
      if (sp > maxSp) { this.vx *= maxSp / sp; this.vy *= maxSp / sp; }
    }

    this.wx += this.vx * dt;
    this.wy += this.vy * dt;

    // Clamp to world bounds (3600×2700 screen pixels centred on origin)
    const ps = toScreen(this.wx, this.wy);
    const csx = Phaser.Math.Clamp(ps.x, -1800, 1800);
    const csy = Phaser.Math.Clamp(ps.y, -1350, 1350);
    if (csx !== ps.x || csy !== ps.y) {
      this.wx = csx / 128 + csy / 64;
      this.wy = csy / 64  - csx / 128;
      this.vx = 0; this.vy = 0;
    }

    // Tree trunk collision — push player out and slide velocity along surface
    const PLAYER_R = 0.35;
    for (const z of this.zones) {
      const dx = this.wx - z.wx, dy = this.wy - z.wy;
      const dist = Math.hypot(dx, dy);
      const minD = ZONE_TRUNK_R + PLAYER_R;
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
      const minD = SAPLING_TRUNK_R + PLAYER_R;
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
      this._triggerDeath();
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
    // Sanctuary: any Caraibeira zone the player is currently inside
    const inSanctuary = this.zones.some(z =>
      Math.hypot(this.wx - z.wx, this.wy - z.wy) < z.radius
    );

    // ── Poachers ──
    for (const p of this.poachers) {
      const distToPlayer = Math.hypot(this.wx - p.wx, this.wy - p.wy);

      if (inSanctuary) {
        p.state = 'return';
      } else if (p.state === 'patrol' && distToPlayer < POACHER_DETECT_R) {
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

    // ── Reaper ──
    if (!inSanctuary) {
      const dx = this.wx - this.reaper.wx, dy = this.wy - this.reaper.wy;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.01) {
        const step = Math.min(dist, REAPER_SPEED * dt);
        this.reaper.wx += (dx / dist) * step;
        this.reaper.wy += (dy / dist) * step;
      }
    }

    // ── Spirit Sense ──
    // Screen-space distance between player and Reaper (player is always at screen centre)
    const ps = toScreen(this.wx, this.wy);
    const rs = toScreen(this.reaper.wx, this.reaper.wy);
    const reaperScreenDist = Math.hypot(rs.x - ps.x, rs.y - ps.y);
    // Fog starts obscuring at ~130px from screen centre; sense range is 300px
    this.spiritSense = !inSanctuary && reaperScreenDist > 130 && reaperScreenDist < 300;
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
  }

  // ── _placeTiles ──────────────────────────────────────────────────────────────
  _placeTiles() {
    const cx = Math.round(this.wx), cy = Math.round(this.wy);
    let i = 0;
    for (let tx = cx - RENDER_R; tx <= cx + RENDER_R; tx++) {
      for (let ty = cy - RENDER_R; ty <= cy + RENDER_R; ty++) {
        const s = toScreen(tx, ty);
        const tile = this.tilePool[i++];
        tile.x = s.x; tile.y = s.y;
        tile.setTexture((tx + ty) % 2 === 0 ? 't0' : 't1');
      }
    }
  }

  // ── _drawZones ───────────────────────────────────────────────────────────────
  _drawZones() {
    this.zoneGfx.clear();
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

    const g = this.zoneGfx;

    for (const { kind, obj, s } of list) {
      if (kind === 'sapling') {
        const sc = obj.sc;
        // Trunk (2× original dimensions)
        g.fillStyle(0x3a1e08, 0.88);
        g.fillRect(s.x - 4, s.y - sc * 92, 8, sc * 88);
        // Lower canopy
        g.fillStyle(0x1e6420, 0.82);
        g.fillEllipse(s.x, s.y - sc * 64, sc * 104, sc * 52);
        // Upper canopy
        g.fillStyle(0x2e8830, 0.88);
        g.fillEllipse(s.x, s.y - sc * 100, sc * 68, sc * 34);
        continue;
      }

      // ── Caraibeira zone tree (2× original dimensions) ────────────────────
      const z = obj;
      const rw = z.radius * 64;
      const rh = z.radius * 32;
      const pulse = z.bloomed
        ? 0.70 + 0.30 * Math.sin(time * 2.5 + z.phase)
        : 0.60 + 0.40 * Math.sin(time * 1.8 + z.phase);

      // Ground aura
      if (z.bloomed) {
        g.fillStyle(0x00ffcc, 0.05 * pulse);
        g.fillEllipse(s.x, s.y, rw * 2.2, rh * 2.2);
        g.fillStyle(0x44ffdd, 0.10 * pulse);
        g.fillEllipse(s.x, s.y, rw * 1.3, rh * 1.3);
        g.lineStyle(1.5, 0x44ffcc, 0.55 * pulse);
        g.strokeEllipse(s.x, s.y, rw * 1.8, rh * 1.8);
      } else {
        g.fillStyle(0x44ff66, 0.04 * pulse);
        g.fillEllipse(s.x, s.y, rw * 2.2, rh * 2.2);
        g.fillStyle(0x66ff88, 0.08 * pulse);
        g.fillEllipse(s.x, s.y, rw * 1.3, rh * 1.3);
        g.lineStyle(1, 0x66ff88, 0.30 * pulse);
        g.strokeEllipse(s.x, s.y, rw * 1.8, rh * 1.8);
      }

      // Trunk — 2× width and height
      g.fillStyle(0x3a1e08, 1);
      g.fillRect(s.x - 10, s.y - 136, 20, 132);

      // Canopy — three tiers at 2× size and height
      if (z.bloomed) {
        g.fillStyle(0x1aaa66, 0.95);
        g.fillEllipse(s.x, s.y - 144, 188, 94);
        g.fillStyle(0x33ddaa, 0.97);
        g.fillEllipse(s.x, s.y - 200, 140, 70);
        g.fillStyle(0x77ffcc, 1.0);
        g.fillEllipse(s.x, s.y - 244, 88, 44);
        g.lineStyle(1.5, 0xaaffee, 0.6 * pulse);
        g.strokeEllipse(s.x, s.y - 200, 140, 70);
      } else {
        g.fillStyle(0x1a6622, 0.94);
        g.fillEllipse(s.x, s.y - 144, 188, 94);
        g.fillStyle(0x2d8834, 0.97);
        g.fillEllipse(s.x, s.y - 200, 140, 70);
        g.fillStyle(0x56bb44, 1.0);
        g.fillEllipse(s.x, s.y - 244, 88, 44);
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

    // Saplings — smaller collideable trees filling out the forest
    this.saplings = [];
    let tries = 0;
    while (this.saplings.length < NUM_SAPLINGS && tries++ < 4000) {
      const wx = (Math.random() - 0.5) * WORLD_SPAN * 2;
      const wy = (Math.random() - 0.5) * WORLD_SPAN * 2;
      if (!inBounds(wx, wy, 40, 40)) continue;
      if (Math.hypot(wx, wy) < 5) continue;
      if (this.zones.some(z => Math.hypot(wx - z.wx, wy - z.wy) < z.radius + 1.5)) continue;
      if (this.saplings.some(s => Math.hypot(wx - s.wx, wy - s.wy) < 2.5)) continue;
      const sc = 0.45 + Math.random() * 0.45;
      this.saplings.push({ wx, wy, sc, phase: Math.random() * Math.PI * 2 });
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
      });
    }

    // Ghost Reaper — starts far from origin
    let rx, ry, rtries = 0;
    do {
      rx = (Math.random() - 0.5) * WORLD_SPAN * 2;
      ry = (Math.random() - 0.5) * WORLD_SPAN * 2;
    } while ((Math.hypot(rx, ry) < 18 || !inBounds(rx, ry, 60, 60)) && rtries++ < 400);
    this.reaper = { wx: rx, wy: ry, alpha: 0.2 };
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
      if (this.zoneHoldTimer >= ZONE_HOLD_TIME) {
        this.zones[inZone].bloomed = true;
        this.score++;
        this.spiritGhostTimer = GHOST_TRAIL_DUR; // grant Speed Ghost trail
        this.zoneHoldTimer = 0;
        this.activeZoneIdx = -1;
        if (this.score >= this.pointsToWin && !this.portalActive) {
          this.portalActive = true;
        }
      }
    } else {
      this.zoneHoldTimer = 0;
      this.activeZoneIdx = -1;
    }
  }

  // ── _drawPortal (Great Caraibeira) ───────────────────────────────────────────
  _drawPortal() {
    this.portalGfx.clear();
    if (!this.portalActive) return;

    const s = toScreen(0, 0);
    const t = this.time.now / 1000;
    const pulse = 0.75 + 0.25 * Math.sin(t * 2.0);

    // Ground aura (isometric ellipses)
    this.portalGfx.fillStyle(0x00cc88, 0.07 * pulse);
    this.portalGfx.fillEllipse(s.x, s.y, 280, 140);
    this.portalGfx.fillStyle(0x22ffaa, 0.13 * pulse);
    this.portalGfx.fillEllipse(s.x, s.y, 160, 80);
    this.portalGfx.fillStyle(0x66ffcc, 0.22 * pulse);
    this.portalGfx.fillEllipse(s.x, s.y, 80, 40);

    // Entry ring — shows where player should walk
    this.portalGfx.lineStyle(2, 0x44ffaa, 0.6 * pulse);
    this.portalGfx.strokeEllipse(s.x, s.y, 128, 64);

    // Trunk — upward column of light
    this.portalGfx.fillStyle(0x55ffcc, 0.65 * pulse);
    this.portalGfx.fillRect(s.x - 5, s.y - 60, 10, 60);
    this.portalGfx.fillStyle(0xaaffee, 0.80 * pulse);
    this.portalGfx.fillRect(s.x - 3, s.y - 60, 6, 60);

    // Canopy — layered ellipses rising above
    this.portalGfx.fillStyle(0x33ffaa, 0.40 * pulse);
    this.portalGfx.fillEllipse(s.x, s.y - 65, 100, 55);
    this.portalGfx.fillStyle(0x66ffcc, 0.55 * pulse);
    this.portalGfx.fillEllipse(s.x, s.y - 72, 64, 36);
    this.portalGfx.fillStyle(0xaaffee, 0.75 * pulse);
    this.portalGfx.fillEllipse(s.x, s.y - 80, 32, 18);

    // Radiating branch lines from canopy centre
    this.portalGfx.lineStyle(1.5, 0x66ffcc, 0.50 * pulse);
    for (let i = 0; i < 6; i++) {
      const a  = t * 0.5 + i * Math.PI / 3;
      const r0 = 14, r1 = 32 + 7 * Math.sin(t * 2.5 + i);
      this.portalGfx.beginPath();
      this.portalGfx.moveTo(s.x + Math.cos(a) * r0, s.y - 72 + Math.sin(a) * r0 * 0.45);
      this.portalGfx.lineTo(s.x + Math.cos(a) * r1, s.y - 72 + Math.sin(a) * r1 * 0.45);
      this.portalGfx.strokePath();
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
    this.yearText.setText(`Year: ${this.currentYear}`);
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
  }

  // ── _triggerLevelClear ───────────────────────────────────────────────────────
  _triggerLevelClear() {
    if (this.levelClearing) return;
    this.levelClearing = true;
    this.dead = true;
    this.vx = 0; this.vy = 0;

    const nextYear = this.currentYear + 2;
    const w = this.scale.width, h = this.scale.height;
    const font = 'Arial, Helvetica, sans-serif';

    // White overlay tweened in — avoids camera.fade() which occludes depth-200+ objects
    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0xffffff)
      .setScrollFactor(0).setDepth(200).setAlpha(0);

    const msg = this.add.text(w / 2, h / 2,
      `The Spirit is strengthened.\nThe year is now ${nextYear}.`, {
        fontFamily: font, fontSize: '34px', color: '#1a2010',
        stroke: '#f0f0f0', strokeThickness: 2, align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0);

    this.tweens.add({ targets: overlay, alpha: 1, duration: 1800 });
    this.tweens.add({ targets: msg,    alpha: 1, duration: 1100, delay: 1600 });
    this.time.delayedCall(6000, () => this.scene.restart({ year: nextYear }));
  }

  // ── _triggerDeath ─────────────────────────────────────────────────────────────
  _triggerDeath() {
    if (this.dead) return;
    this.dead = true;
    this.vx = 0; this.vy = 0;

    const nextYear = this.currentYear + 10;
    const w = this.scale.width, h = this.scale.height;
    const font = 'Arial, Helvetica, sans-serif';

    this.cameras.main.shake(200, 0.025);

    // Black overlay tweened in — avoids camera.fade() which occludes depth-200+ objects
    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x000000)
      .setScrollFactor(0).setDepth(200).setAlpha(0);

    const headline = this.add.text(w / 2, h / 2 - 44,
      `${this.currentYear}: A lineage lost.`, {
        fontFamily: font, fontSize: '46px', color: '#ffffff',
        stroke: '#000000', strokeThickness: 4, align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0);

    const flavour = this.add.text(w / 2, h / 2 + 18,
      'Years pass in silence. The spirit returns...', {
        fontFamily: font, fontSize: '22px', color: '#aabbcc',
        stroke: '#000000', strokeThickness: 3, align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0);

    const sub = this.add.text(w / 2, h / 2 + 60,
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

  // ── _makeTex ─────────────────────────────────────────────────────────────────
  _makeTex(key, fillColor, lineColor) {
    const g = this.make.graphics({ add: false });
    g.fillStyle(fillColor, 1);
    g.beginPath();
    g.moveTo(TILE_W / 2, 0);
    g.lineTo(TILE_W,     TILE_H / 2);
    g.lineTo(TILE_W / 2, TILE_H);
    g.lineTo(0,          TILE_H / 2);
    g.closePath();
    g.fillPath();
    g.lineStyle(1, lineColor, 0.5);
    g.strokePath();
    g.generateTexture(key, TILE_W, TILE_H);
    g.destroy();
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
