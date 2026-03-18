// ─── Constants ────────────────────────────────────────────────────────────────
const TILE_W = 128;
const TILE_H = 64;
const RENDER_R = 12;   // tile render radius — large enough for fog to cover the edge seam

// Movement
const SPEED       = 6.4;  // reduced 20%
const SPEED_BOOST = 1.45;  // multiplier while Mate is active
const ACCEL       = 42;
const DRAG        = 34;

// Dash
const DASH_V   = 30;
const DASH_DUR = 0.16;
const DASH_CD  = 0.70;

// World generation
const NUM_ZONES  = 4;
const ZONE_R     = 3.8;   // Caraibeira zone radius in tile units
const NUM_TRAPS  = 10;
const WORLD_SPAN = 18;    // half-size of the world (tiles) — fits 2400×1800 bounds
const NUM_ROCKS  = 18;    // collideable boulder obstacles
const ROCK_R     = 1.0;   // obstacle collision radius (world units)

// Enemies
const NUM_POACHERS       = 3;
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
    this.zoneGfx     = this.add.graphics().setDepth(1);
    this.portalGfx   = this.add.graphics().setDepth(1.5);
    this.trapGfx     = this.add.graphics().setDepth(2);
    this.obstacleGfx = this.add.graphics().setDepth(2.5);
    this.trailGfx    = this.add.graphics().setDepth(3);
    this.shadowGfx = this.add.graphics().setDepth(4);
    this.mateGfx   = this.add.graphics().setDepth(5);
    this.enemyGfx  = this.add.graphics().setDepth(5.5);
    this.playerGfx = this.add.graphics().setDepth(6);
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
    this.keys      = this.input.keyboard.addKeys('W,A,S,D,SPACE');
    this.prevSpace = false;

    // Zone hold countdown (hidden — Spirit Meter arc replaces the number)
    this.timerText = this.add.text(0, 0, '', {
      fontFamily: 'Georgia, serif', fontSize: '28px', color: '#aaffaa',
      stroke: '#1a3318', strokeThickness: 4,
    }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(61).setVisible(false);

    // Trees Saved counter — top-left HUD
    this.spiritCountText = this.add.text(16, 14, '', {
      fontFamily: 'Georgia, serif', fontSize: '17px', color: '#ffffff',
      stroke: '#1a1a1a', strokeThickness: 3,
    }).setOrigin(0, 0).setScrollFactor(0).setDepth(61);

    this.cameras.main.setBackgroundColor('#b0a890'); // warm gray — blends with fog edge
    this.cameras.main.setBounds(-1200, -900, 2400, 1800);
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

    this._placeTiles();
    this._drawZones();
    this._drawPortal();
    this._drawTraps();
    this._drawObstacles();
    this._drawEnemies();
    this._drawTrail();
    this._drawShadow();
    this._drawMate();
    this._drawPlayer();
    this._drawHUD();

    const s = toScreen(this.wx, this.wy);
    this.cameras.main.centerOn(s.x, s.y);

    // Tree depth: go behind zone when entity is north of it (smaller iso-Y)
    let pd = 6, sd = 4, td = 3, ed = 5.5;
    const pIsoY = this.wx + this.wy;

    for (const z of this.zones) {
      const zIsoY = z.wx + z.wy;
      // Player
      if (pd > 1 &&
          Math.hypot(this.wx - z.wx, this.wy - z.wy) < z.radius * 2.0 &&
          pIsoY < zIsoY) {
        pd = 0.5; sd = 0.4; td = 0.3;
      }
      // Reaper
      if (ed > 1 &&
          Math.hypot(this.reaper.wx - z.wx, this.reaper.wy - z.wy) < z.radius * 2.0 &&
          this.reaper.wx + this.reaper.wy < zIsoY) {
        ed = 0.6;
      }
      // Any Poacher
      if (ed > 1) {
        for (const p of this.poachers) {
          if (Math.hypot(p.wx - z.wx, p.wy - z.wy) < z.radius * 2.0 &&
              p.wx + p.wy < zIsoY) {
            ed = 0.6; break;
          }
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

    // Clamp to world bounds (2400×1800 screen pixels centred on origin)
    const ps = toScreen(this.wx, this.wy);
    const csx = Phaser.Math.Clamp(ps.x, -1200, 1200);
    const csy = Phaser.Math.Clamp(ps.y, -900, 900);
    if (csx !== ps.x || csy !== ps.y) {
      this.wx = csx / 128 + csy / 64;
      this.wy = csy / 64  - csx / 128;
      this.vx = 0; this.vy = 0;
    }

    // Obstacle collision — push player out and slide velocity along surface
    for (const r of this.rocks) {
      const dx   = this.wx - r.wx;
      const dy   = this.wy - r.wy;
      const dist = Math.hypot(dx, dy);
      const minD = r.radius + 0.35; // 0.35 ≈ player body radius
      if (dist < minD && dist > 0.001) {
        const nx = dx / dist, ny = dy / dist;
        this.wx = r.wx + nx * minD;
        this.wy = r.wy + ny * minD;
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
      if (Math.hypot(this.wx - t.wx, this.wy - t.wy) < 0.75) {
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

  // ── _drawObstacles ───────────────────────────────────────────────────────────
  _drawObstacles() {
    this.obstacleGfx.clear();
    const cam = toScreen(this.wx, this.wy);

    // Sort back-to-front so rocks overlap correctly
    const visible = this.rocks
      .map(r => ({ r, s: toScreen(r.wx, r.wy), isoY: r.wx + r.wy }))
      .filter(({ s }) => Math.abs(s.x - cam.x) < 800 && Math.abs(s.y - cam.y) < 500)
      .sort((a, b) => a.isoY - b.isoY);

    for (const { r, s } of visible) {
      const hw = r.radius * 60;   // screen half-width (matches iso tile ratio)
      const hh = r.radius * 30;   // screen half-height
      const ht = r.radius * 36;   // rock visual height (above ground plane)

      // Right face (darkest — in shadow)
      this.obstacleGfx.fillStyle(0x3a2008, 1);
      this.obstacleGfx.beginPath();
      this.obstacleGfx.moveTo(s.x,       s.y);
      this.obstacleGfx.lineTo(s.x + hw,  s.y - hh);
      this.obstacleGfx.lineTo(s.x + hw,  s.y - hh - ht);
      this.obstacleGfx.lineTo(s.x,       s.y - ht);
      this.obstacleGfx.closePath();
      this.obstacleGfx.fillPath();

      // Left face (mid tone)
      this.obstacleGfx.fillStyle(0x543014, 1);
      this.obstacleGfx.beginPath();
      this.obstacleGfx.moveTo(s.x,      s.y);
      this.obstacleGfx.lineTo(s.x - hw, s.y - hh);
      this.obstacleGfx.lineTo(s.x - hw, s.y - hh - ht);
      this.obstacleGfx.lineTo(s.x,      s.y - ht);
      this.obstacleGfx.closePath();
      this.obstacleGfx.fillPath();

      // Top face (lightest — sun-lit)
      this.obstacleGfx.fillStyle(0x7a4c24, 1);
      this.obstacleGfx.beginPath();
      this.obstacleGfx.moveTo(s.x,      s.y - ht);
      this.obstacleGfx.lineTo(s.x + hw, s.y - hh - ht);
      this.obstacleGfx.lineTo(s.x,      s.y - hh * 2 - ht);
      this.obstacleGfx.lineTo(s.x - hw, s.y - hh - ht);
      this.obstacleGfx.closePath();
      this.obstacleGfx.fillPath();

      // Crisp outline
      this.obstacleGfx.lineStyle(1, 0x1e0e04, 0.8);
      this.obstacleGfx.beginPath();
      this.obstacleGfx.moveTo(s.x,      s.y - ht);
      this.obstacleGfx.lineTo(s.x + hw, s.y - hh - ht);
      this.obstacleGfx.lineTo(s.x,      s.y - hh * 2 - ht);
      this.obstacleGfx.lineTo(s.x - hw, s.y - hh - ht);
      this.obstacleGfx.closePath();
      this.obstacleGfx.strokePath();
      this.obstacleGfx.beginPath();
      this.obstacleGfx.moveTo(s.x, s.y);
      this.obstacleGfx.lineTo(s.x, s.y - ht);
      this.obstacleGfx.moveTo(s.x + hw, s.y - hh);
      this.obstacleGfx.lineTo(s.x + hw, s.y - hh - ht);
      this.obstacleGfx.moveTo(s.x - hw, s.y - hh);
      this.obstacleGfx.lineTo(s.x - hw, s.y - hh - ht);
      this.obstacleGfx.strokePath();
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

    for (const z of this.zones) {
      const s = toScreen(z.wx, z.wy);
      if (Math.abs(s.x - cam.x) > 900 || Math.abs(s.y - cam.y) > 550) continue;

      const rw = z.radius * 64;
      const rh = z.radius * 32;

      if (z.bloomed) {
        // Bloomed — bright cyan glow, faster pulse
        const pulse = 0.7 + 0.3 * Math.sin(time * 2.5 + z.phase);
        this.zoneGfx.fillStyle(0x00ffcc, 0.06 * pulse);
        this.zoneGfx.fillEllipse(s.x, s.y, rw * 3.2, rh * 3.2);
        this.zoneGfx.fillStyle(0x44ffcc, 0.13 * pulse);
        this.zoneGfx.fillEllipse(s.x, s.y, rw * 2, rh * 2);
        this.zoneGfx.fillStyle(0x88ffee, 0.22 * pulse);
        this.zoneGfx.fillEllipse(s.x, s.y, rw * 1.2, rh * 1.2);
        this.zoneGfx.lineStyle(2, 0x44ffcc, 0.7 * pulse);
        this.zoneGfx.strokeEllipse(s.x, s.y, rw * 2, rh * 2);
      } else {
        // Normal — green glow
        const pulse = 0.6 + 0.4 * Math.sin(time * 1.8 + z.phase);
        this.zoneGfx.fillStyle(0x44ff66, 0.05 * pulse);
        this.zoneGfx.fillEllipse(s.x, s.y, rw * 3.2, rh * 3.2);
        this.zoneGfx.fillStyle(0x44ff66, 0.09 * pulse);
        this.zoneGfx.fillEllipse(s.x, s.y, rw * 2, rh * 2);
        this.zoneGfx.fillStyle(0x88ff88, 0.13 * pulse);
        this.zoneGfx.fillEllipse(s.x, s.y, rw * 1.2, rh * 1.2);
        this.zoneGfx.lineStyle(1.5, 0x66ff88, 0.4 * pulse);
        this.zoneGfx.strokeEllipse(s.x, s.y, rw * 2, rh * 2);
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
    this.shadowGfx.fillStyle(0x000000, 0.25);
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
    // Helper: checks that a world point projects inside the camera bounds
    // with a given screen-pixel margin on each axis.
    const inBounds = (wx, wy, mX, mY) => {
      const sx = (wx - wy) * 64, sy = (wx + wy) * 32;
      return Math.abs(sx) + mX < 1150 && Math.abs(sy) + mY < 850;
    };

    // Caraibeira zones — spread out, not overlapping, not at origin, fully inside map
    this.zones = [];
    for (let i = 0; i < NUM_ZONES; i++) {
      let wx, wy, ok, tries = 0;
      do {
        wx = (Math.random() - 0.5) * WORLD_SPAN * 2;
        wy = (Math.random() - 0.5) * WORLD_SPAN * 2;
        ok = Math.hypot(wx, wy) > 10 &&
             this.zones.every(z => Math.hypot(wx - z.wx, wy - z.wy) > ZONE_R * 2.8) &&
             inBounds(wx, wy, ZONE_R * 64, ZONE_R * 32); // zone visual fits inside map
      } while (!ok && ++tries < 200);
      this.zones.push({ wx, wy, radius: ZONE_R, phase: Math.random() * Math.PI * 2, bloomed: false });
    }

    // Traps — in open areas, away from zones and player start
    this.traps = [];
    let tries = 0;
    while (this.traps.length < NUM_TRAPS && tries++ < 1200) {
      const wx = (Math.random() - 0.5) * WORLD_SPAN * 2;
      const wy = (Math.random() - 0.5) * WORLD_SPAN * 2;
      if (Math.hypot(wx, wy) < 7) continue;
      if (!inBounds(wx, wy, 40, 40)) continue;
      if (this.zones.some(z => Math.hypot(wx - z.wx, wy - z.wy) < z.radius + 1.5)) continue;
      this.traps.push({ wx, wy });
    }

    // Rocky obstacles — scattered boulders the player must navigate around
    this.rocks = [];
    tries = 0;
    while (this.rocks.length < NUM_ROCKS && tries++ < 2000) {
      const wx = (Math.random() - 0.5) * WORLD_SPAN * 2;
      const wy = (Math.random() - 0.5) * WORLD_SPAN * 2;
      if (Math.hypot(wx, wy) < 4) continue;   // keep origin clear
      if (!inBounds(wx, wy, 80, 60)) continue;
      if (this.zones.some(z => Math.hypot(wx - z.wx, wy - z.wy) < z.radius + ROCK_R + 1.5)) continue;
      if (this.traps.some(t => Math.hypot(wx - t.wx, wy - t.wy) < ROCK_R + 1.5)) continue;
      if (this.rocks.some(r => Math.hypot(wx - r.wx, wy - r.wy) < ROCK_R * 2 + 1.0)) continue;
      this.rocks.push({ wx, wy, radius: ROCK_R });
    }

    // Poachers — spread across the world, away from start and zones
    this.poachers = [];
    tries = 0;
    while (this.poachers.length < NUM_POACHERS && tries++ < 1200) {
      const wx = (Math.random() - 0.5) * WORLD_SPAN * 2;
      const wy = (Math.random() - 0.5) * WORLD_SPAN * 2;
      if (Math.hypot(wx, wy) < 8) continue;
      if (!inBounds(wx, wy, 60, 60)) continue;
      if (this.zones.some(z => Math.hypot(wx - z.wx, wy - z.wy) < z.radius + 2)) continue;
      this.poachers.push({
        wx, wy, wx0: wx, wy0: wy,
        state: 'patrol',
        patrolAngle: Math.random() * Math.PI * 2,
      });
    }

    // Ghost Reaper — starts far from origin, inside bounds
    let rx, ry, rtries = 0;
    do {
      rx = (Math.random() - 0.5) * WORLD_SPAN * 2;
      ry = (Math.random() - 0.5) * WORLD_SPAN * 2;
    } while ((Math.hypot(rx, ry) < 12 || !inBounds(rx, ry, 60, 60)) && rtries++ < 400);
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
        if (this.score >= POINTS_TO_WIN && !this.portalActive) {
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

    // ── Trees Saved counter (top-left) ──
    const ghostSuffix = this.spiritGhostTimer > 0
      ? `  ✦ ${Math.ceil(this.spiritGhostTimer)}s` : '';
    this.spiritCountText.setText(
      `Trees Saved: ${this.score} / ${POINTS_TO_WIN}${ghostSuffix}`
    );
  }

  // ── _triggerLevelClear ───────────────────────────────────────────────────────
  _triggerLevelClear() {
    if (this.levelClearing) return;
    this.levelClearing = true;
    this.dead = true;
    this.vx = 0; this.vy = 0;

    this.cameras.main.fade(1800, 255, 255, 255); // fade to white
    this.cameras.main.once('camerafadeoutcomplete', () => {
      const w = this.scale.width;
      const h = this.scale.height;
      const opts = { fontFamily: 'Georgia, "Times New Roman", serif' };

      // White background fill so text sits on pure white
      const bg = this.add.rectangle(w / 2, h / 2, w, h, 0xffffff)
        .setScrollFactor(0).setDepth(199);

      const msg = this.add.text(w / 2, h / 2,
        'The spirit has guided this generation to safety.\nThe legacy continues…', {
          ...opts, fontSize: '26px', color: '#1a2010', align: 'center',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(200).setAlpha(0);

      this.tweens.add({ targets: msg, alpha: 1, duration: 1100, delay: 300 });
      this.time.delayedCall(5000, () => this.scene.restart());
    });
  }

  // ── _triggerDeath ─────────────────────────────────────────────────────────────
  _triggerDeath() {
    if (this.dead) return;
    this.dead = true;
    this.vx = 0; this.vy = 0;

    this.cameras.main.shake(200, 0.025);
    this.time.delayedCall(200, () => {
    this.cameras.main.fade(1200, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      const w = this.scale.width;
      const h = this.scale.height;
      const opts = { fontFamily: 'Georgia, "Times New Roman", serif' };

      const year = this.add.text(w / 2, h / 2 - 55, '1990', {
        ...opts, fontSize: '58px', color: '#d4a84b',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(200).setAlpha(0);

      const msg = this.add.text(w / 2, h / 2 + 18,
        'A lineage lost to the trade.\nThe next generation takes flight…', {
          ...opts, fontSize: '22px', color: '#e8dfc0', align: 'center',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(200).setAlpha(0);

      this.tweens.add({ targets: [year, msg], alpha: 1, duration: 900, delay: 250 });
      this.time.delayedCall(5200, () => this.scene.restart());
    });
    }); // end shake delayedCall
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
