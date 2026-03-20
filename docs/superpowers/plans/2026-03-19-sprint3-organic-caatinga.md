# Sprint 3: The Organic Caatinga — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four visual polish features to game.js: earthy tuft tints, Ritual Bark HUD, proper isometric depth sorting with split canopy layer, and canopy wind sway.

**Architecture:** All changes are confined to a single file (`game.js`). Tasks are ordered by independence — Tasks 1 and 2 touch different functions and can be verified separately. Task 3 (depth split) must come before Task 4 (sway), as sway targets the canopy-only draw block that Task 3 creates.

**Tech Stack:** Phaser.js 3, vanilla JavaScript, browser devtools for visual verification.

---

## File Modified

- `game.js` — single file, all changes below

---

## Task 1: Organic Floor — Earthy Tuft Tints

**Functions touched:** `toScreen` area (top of file, line ~56), `_genWorld()` (line ~1046), `_drawTufts()` (lines 726–753)

**What it does:** Each ground tuft gets a random earthy tint (Moss/Dust/Dry Clay) baked in at world-gen time. `_drawTufts` blends that tint 18% into the base and highlight colors of each tuft, giving the floor organic variation.

---

- [ ] **Step 1: Add `blendHex` helper after `toScreen`**

  Open `game.js`. Find line 56:
  ```js
  function toScreen(wx, wy) {
    return { x: (wx - wy) * 64, y: (wx + wy) * 32 };
  }
  ```
  Insert directly after it (line 59 area):
  ```js
  // Blend two packed hex colours by factor t (0=base, 1=tint)
  function blendHex(base, tint, t) {
    const br = (base >> 16) & 0xff, bg = (base >> 8) & 0xff, bb = base & 0xff;
    const tr = (tint >> 16) & 0xff, tg = (tint >> 8) & 0xff, tb = tint & 0xff;
    const r = Math.round(br + (tr - br) * t);
    const g = Math.round(bg + (tg - bg) * t);
    const b = Math.round(bb + (tb - bb) * t);
    return (r << 16) | (g << 8) | b;
  }
  ```

- [ ] **Step 2: Assign a random tint to each tuft in `_genWorld`**

  In `_genWorld()`, find the section that generates `groundTufts`. It contains a loop that does `this.groundTufts.push({ wx, wy, type, size })` (around line 1115–1130 area).

  Place this constant **above** the loop (define it once, not per-iteration):
  ```js
  const EARTHY_TINTS = [0x4a7c3f, 0xc4a882, 0xc4703f]; // Moss, Dust, Dry Clay
  ```
  Then change the `push` call inside the loop to include the tint:
  ```js
  this.groundTufts.push({ wx, wy, type, size, tint: EARTHY_TINTS[Math.floor(Math.random() * 3)] });
  ```

- [ ] **Step 3: Apply tint blend in `_drawTufts`**

  Replace the entire body of `_drawTufts` (lines 726–753) with the version below. The only change is that each hardcoded hex color is passed through `blendHex(..., t.tint, 0.18)` before use. Alphas are unchanged.

  ```js
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
  ```

- [ ] **Step 4: Visual verification**

  Open `index.html` in a browser. Move around the map. The ground tufts should look nearly identical to before but with subtle variation — some slightly mossy-green, some dusty/beige, some warm clay-red. If all tufts look identical, check that `t.tint` is being assigned in `_genWorld`.

- [ ] **Step 5: Commit**

  ```bash
  git add game.js
  git commit -m "feat: earthy tint wash on ground tufts (Moss/Dust/DyClay)"
  ```

---

## Task 2: HUD Polish — Ritual Bark Style

**Functions touched:** `create()` (lines ~161–176), `_drawHUD()` (lines 1264–1337)

**What it does:** Adds a `_barkBorder()` helper that draws organic pixel-notch borders. Replaces the plain energy bar border with a gold-green glowing bark-bordered bar. Replaces the year text with a bark-bordered box containing a `YEAR` label and a separate bold year numeral.

---

- [ ] **Step 1: Add `_barkBorder` helper method**

  Find `_drawHUD()` in `game.js` (line ~1264). Insert the following new method **immediately before** `_drawHUD`:

  ```js
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
  ```

- [ ] **Step 2: Restyle HUD text objects in `create()`**

  The `create()` method (lines ~161–176) declares `yearText` and `energyLabel`. Replace both declarations and add `yearNumText`:

  **a) Replace `yearText`** — repurposed as a small static `'YEAR'` label in bark style. The year number will be a separate text object. Replace the existing `yearText` declaration:
  ```js
  // 'YEAR' label inside bark box — top-right corner
  this.yearText = this.add.text(0, 0, 'YEAR', {
    fontFamily: 'monospace', fontSize: '7px', color: '#786028',
  }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);
  ```

  **b) Add `yearNumText`** immediately after the new `yearText` declaration:
  ```js
  // Year numeral — updated each frame in _drawHUD
  this.yearNumText = this.add.text(0, 0, '1987', {
    fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold', color: '#d4a840',
  }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(100);
  ```

  **c) Replace `energyLabel`** — restyled to bark theme and positioned by `_drawHUD` each frame:
  ```js
  // 'SPIRIT ENERGY' label above energy bar — positioned each frame in _drawHUD
  this.energyLabel = this.add.text(0, 0, 'SPIRIT ENERGY', {
    fontFamily: 'monospace', fontSize: '7px', color: '#8a6830',
  }).setOrigin(0, 1).setScrollFactor(0).setDepth(100);
  ```

- [ ] **Step 3: Rewrite energy bar block in `_drawHUD`**

  Find the energy bar block in `_drawHUD` (lines 1327–1336):
  ```js
  // ── Energy bar — top-right, below year text ───────────────────────────
  const SW = this.scale.width;
  const ebW = 120, ebH = 10, ebX = SW - 140, ebY = 60;
  this.hudGfx.fillStyle(0x222222, 0.8);
  this.hudGfx.fillRect(ebX, ebY, ebW, ebH);
  const eColor = this.energy > 0.30 ? 0x44aaff : 0xff7722;
  this.hudGfx.fillStyle(eColor, 0.9);
  this.hudGfx.fillRect(ebX, ebY, ebW * this.energy, ebH);
  this.hudGfx.lineStyle(1.5, 0xffffff, 0.5);
  this.hudGfx.strokeRect(ebX, ebY, ebW, ebH);
  ```

  Replace with:
  ```js
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
  } else {
    this.hudGfx.fillStyle(0xff7722, 0.9);
    this.hudGfx.fillRect(ebX, ebY, fillW, ebH);
  }
  // Shimmer line at top of fill
  this.hudGfx.fillStyle(0xb4ff50, 0.4);
  this.hudGfx.fillRect(ebX, ebY, fillW, 2);
  // Bark border
  this._barkBorder(this.hudGfx, ebX - 2, ebY - 2, ebW + 4, ebH + 4, 0x8a6830);
  // Position 'SPIRIT ENERGY' label 10px above the bar
  this.energyLabel.setPosition(ebX, ebY - 10);
  ```

- [ ] **Step 4: Rewrite year clock block in `_drawHUD`**

  Find the year text update line in `_drawHUD`. It currently reads:
  ```js
  this.yearText.setText(`Year: ${this.currentYear}`);
  ```
  **Delete that line entirely** and replace it with the full bark-bordered year clock box. Note that `SW` is already declared earlier in the same function (in the energy bar block above — Step 3 adds it), so do not redeclare it here:
  ```js
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
  ```

  > **Why delete, not replace:** The old `yearText.setText(...)` called `setText` with a full "Year: 1987" string. Now `yearText` is a static `'YEAR'` label (set once in `create()`), and `yearNumText` shows the number. Leaving the old `setText` call would overwrite the static label text every frame.

- [ ] **Step 5: Confirm `shadowGfx` depth is correct**

  We removed the block that called `this.shadowGfx.setDepth(sd)` every frame. Confirm `shadowGfx` is initialized at the right depth in `create()` (line ~79):
  ```js
  this.shadowGfx = this.add.graphics().setDepth(4);
  ```
  Depth 4 is correct — shadow on the ground, below the bird (depth ~5–6), below canopies (depth 7). No change needed, just verify this line exists as-is.

- [ ] **Step 6: Visual verification**

  Reload. Top-right should show:
  - A dark bark-bordered box with amber glow — `YEAR` small label on top, bold gold year number below
  - Energy bar with green gradient, shimmer line, notched bark border, `SPIRIT ENERGY` label above
  - No double labels, no plain white borders

  If two year labels appear, confirm the old `yearText.setText(...)` line in `_drawHUD` was deleted in Step 4.

- [ ] **Step 7: Commit**

  ```bash
  git add game.js
  git commit -m "feat: Ritual Bark HUD — bark borders, glow, restyle year clock & energy bar"
  ```

---

## Task 3: Depth Sorting — Split Canopy Layer & Dynamic Player Depth

**Functions touched:** `create()` (line ~75), `update()` (lines 220–269), `_drawZones()` (lines 755–843), `_drawPlayer()` (line ~978)

**What it does:** Splits tree drawing into two layers (`trunkGfx` depth 1, `canopyGfx` depth 7) so the bird flies between them. Replaces the old binary depth-sort block with a continuous isoY formula so the bird sorts correctly against all scene objects.

---

- [ ] **Step 1: Add `canopyGfx` and rename `zoneGfx` → `trunkGfx` in `create()`**

  In `create()`, find line 75:
  ```js
  this.zoneGfx   = this.add.graphics().setDepth(1);
  ```
  Replace with:
  ```js
  this.trunkGfx  = this.add.graphics().setDepth(1);
  this.canopyGfx = this.add.graphics().setDepth(7);
  ```

- [ ] **Step 2: Update the comment in `update()` that mentions `zoneGfx`**

  Find line ~221:
  ```js
  // Trees on zoneGfx (depth 1) occlude entities with depth < 1.
  ```
  Change to:
  ```js
  // Trunks on trunkGfx (depth 1), canopies on canopyGfx (depth 7).
  ```

- [ ] **Step 3a: Delete the old binary depth-sort block from `update()`**

  Find and **delete the entire block** from:
  ```js
  let pd = 6, sd = 5.9, td = 5.8, ed = 5.5;
  ```
  through and including:
  ```js
  this.playerGfx.setDepth(pd);
  this.shadowGfx.setDepth(sd);
  this.trailGfx.setDepth(td);
  this.enemyGfx.setDepth(ed);
  ```
  This is approximately lines 225–268. Delete all of it — every line between those two markers inclusive.

- [ ] **Step 3b: Paste in the condensed enemy-depth block**

  In the gap left by the deletion, paste this replacement. It keeps enemy occlusion behind trees but removes the player/shadow/trail binary system:
  ```js
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
  ```

- [ ] **Step 4: Add continuous depth formula at the top of `_drawPlayer()`**

  Find `_drawPlayer()` (line ~979). It starts:
  ```js
  _drawPlayer() {
    const s   = toScreen(this.wx, this.wy);
  ```
  Insert two lines as the very first lines of the method body:
  ```js
  _drawPlayer() {
    // Dynamic depth: bird sorts between trunks (depth 1) and canopies (depth 7)
    const isoY = this.wx + this.wy;
    this.playerGfx.setDepth(5 + (isoY + WORLD_SPAN) / (WORLD_SPAN * 2));

    const s   = toScreen(this.wx, this.wy);
  ```

- [ ] **Step 5: Split `_drawZones()` — clear calls and aliases**

  Find `_drawZones()` (line ~756).

  **a)** At the top of `_drawZones`, find:
  ```js
  this.zoneGfx.clear();
  ```
  Replace with:
  ```js
  this.trunkGfx.clear();
  this.canopyGfx.clear();
  ```

  **b)** Find:
  ```js
  const g = this.zoneGfx;
  ```
  Replace with:
  ```js
  const gt = this.trunkGfx;  // trunks and ground auras
  const gc = this.canopyGfx; // canopy ellipses only
  ```

- [ ] **Step 6: Split `_drawZones()` — sapling drawing**

  Find the `if (kind === 'sapling')` block. It currently uses `g.` for everything. Here is the full block with the split applied — replace it entirely:

  ```js
  if (kind === 'sapling') {
    const f = obj.type === 0 ? 0.9 : 0.8;
    // Trunk — draws to trunkGfx
    gt.fillStyle(0x3a1e08, 1);
    gt.fillRect(s.x - Math.round(10 * f), s.y - Math.round(136 * f), Math.round(20 * f), Math.round(132 * f));
    // Canopy — draws to canopyGfx
    gc.fillStyle(0x1a6622, 0.94);
    gc.fillEllipse(s.x, s.y - Math.round(144 * f), Math.round(188 * f), Math.round(94 * f));
    gc.fillStyle(0x2d8834, 0.97);
    gc.fillEllipse(s.x, s.y - Math.round(200 * f), Math.round(140 * f), Math.round(70 * f));
    gc.fillStyle(0x56bb44, 1.0);
    gc.fillEllipse(s.x, s.y - Math.round(244 * f), Math.round(88 * f), Math.round(44 * f));
    continue;
  }
  ```

- [ ] **Step 7: Split `_drawZones()` — Caraibeira zone drawing**

  The large zone drawing block uses `g.` for ground aura, trunk, and canopy. Apply the split: `gt.` for aura + trunk, `gc.` for all canopy ellipses/strokes. Here is the full replacement for both the bloomed and non-bloomed branches:

  ```js
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
    gc.fillEllipse(s.x, s.y - 144, 188, 94);
    gc.fillStyle(0x33ddaa, 0.97);
    gc.fillEllipse(s.x, s.y - 200, 140, 70);
    gc.fillStyle(0x77ffcc, 1.0);
    gc.fillEllipse(s.x, s.y - 244, 88, 44);
    gc.lineStyle(1.5, 0xaaffee, 0.6 * pulse);
    gc.strokeEllipse(s.x, s.y - 200, 140, 70);
  } else {
    gc.fillStyle(0x1a6622, 0.94);
    gc.fillEllipse(s.x, s.y - 144, 188, 94);
    gc.fillStyle(0x2d8834, 0.97);
    gc.fillEllipse(s.x, s.y - 200, 140, 70);
    gc.fillStyle(0x56bb44, 1.0);
    gc.fillEllipse(s.x, s.y - 244, 88, 44);
  }
  ```

- [ ] **Step 8: Visual verification**

  Reload and fly near a large Caraibeira:
  - Moving "north" of a tree (bird appears higher on screen than the tree): bird should hide behind the canopy
  - Moving "south" of a tree (bird appears lower): bird should be fully visible in front
  - Shadow stays on the ground at all times (depth 4 — confirmed in Task 2 Step 5)
  - Trunks always visible regardless of bird position

  If the bird always appears on top of everything: check Step 3a — old `setDepth(pd)` may still be present.
  If the bird always hides behind canopies: check Step 4 — the continuous formula may not be running.

- [ ] **Step 9: Commit**

  ```bash
  git add game.js
  git commit -m "feat: split trunk/canopy layers, continuous isometric depth sorting"
  ```

---

## Task 4: Nature's Sway — Canopy Wind Animation

**Dependency:** Task 3 must be fully complete before this task. Sway applies to canopy ellipses drawn on `canopyGfx` — that split only exists after Task 3.

**Functions touched:** `_drawZones()` (after Task 3 edits)

**What it does:** Each tree's canopy shifts horizontally and scales slightly based on `Math.sin(time + phase)`, simulating a breeze. Trunks are unaffected.

---

- [ ] **Step 1: Add sway variables inside the draw loop in `_drawZones()`**

  In `_drawZones()`, find the `for (const { kind, obj, s } of list)` loop. Inside the loop body, **before** any drawing (before the `if (kind === 'sapling')` check), add:
  ```js
  // Per-tree wind sway — canopy only; phase field exists on both zones and saplings
  const phase      = obj.phase ?? 0;
  const swayAmp    = kind === 'zone' ? 2.5 : 1.2;
  const swayX      = Math.sin(time * 0.65 + phase) * swayAmp;
  const swayScaleW = 1 + 0.018 * Math.sin(time * 0.9 + phase);
  ```
  The `?? 0` fallback on `phase` prevents a silent NaN bug if any tree object was created without that field.

- [ ] **Step 2: Apply sway to sapling canopy ellipses**

  In the sapling block (updated in Task 3 Step 6), the three `gc.fillEllipse` calls use `s.x` as the x coordinate and a fixed width. Apply `swayX` to x and `swayScaleW` to width:
  ```js
  gc.fillStyle(0x1a6622, 0.94);
  gc.fillEllipse(s.x + swayX, s.y - Math.round(144 * f), Math.round(188 * f) * swayScaleW, Math.round(94 * f));
  gc.fillStyle(0x2d8834, 0.97);
  gc.fillEllipse(s.x + swayX, s.y - Math.round(200 * f), Math.round(140 * f) * swayScaleW, Math.round(70 * f));
  gc.fillStyle(0x56bb44, 1.0);
  gc.fillEllipse(s.x + swayX, s.y - Math.round(244 * f), Math.round(88 * f) * swayScaleW, Math.round(44 * f));
  ```

- [ ] **Step 3: Apply sway to zone canopy ellipses**

  In the zone canopy block (updated in Task 3 Step 7), apply the same pattern to all `gc.fillEllipse` and `gc.strokeEllipse` calls. Both bloomed and non-bloomed branches:

  Bloomed:
  ```js
  gc.fillEllipse(s.x + swayX, s.y - 144, 188 * swayScaleW, 94);
  gc.fillEllipse(s.x + swayX, s.y - 200, 140 * swayScaleW, 70);
  gc.fillEllipse(s.x + swayX, s.y - 244,  88 * swayScaleW, 44);
  gc.strokeEllipse(s.x + swayX, s.y - 200, 140 * swayScaleW, 70);
  ```

  Non-bloomed:
  ```js
  gc.fillEllipse(s.x + swayX, s.y - 144, 188 * swayScaleW, 94);
  gc.fillEllipse(s.x + swayX, s.y - 200, 140 * swayScaleW, 70);
  gc.fillEllipse(s.x + swayX, s.y - 244,  88 * swayScaleW, 44);
  ```

  Trunk `gt.fillRect` calls always use the original `s.x` — do **not** add `swayX` there.

- [ ] **Step 4: Visual verification**

  Reload. Stand still and watch the forest for a few seconds. Tree canopies should gently drift left and right, each at a slightly different rhythm. The drift is subtle (~2–3px for large trees, ~1px for saplings). Trunks should be perfectly still.

  - If all trees sway in sync: check that `phase` (not a shared constant) is used in the `sin` call.
  - If trunks also sway: check that `swayX` is only added to `gc.` calls, not `gt.` calls.
  - If nothing sways: check that the sway variables are inside the loop (not above it).

- [ ] **Step 5: Commit**

  ```bash
  git add game.js
  git commit -m "feat: canopy wind sway — per-tree breathing animation"
  ```

---

## Done

All four Sprint 3 features are implemented. The final commit history should show four clean commits, one per task.
