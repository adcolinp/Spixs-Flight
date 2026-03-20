# Sprint 3: The Organic Caatinga — Design Spec

**Date:** 2026-03-19
**Project:** Caraíba's Path (game.js / Phaser.js)
**Status:** Approved

---

## Overview

Four self-contained improvements that deepen the game's visual authenticity and "spirit" atmosphere without changing gameplay mechanics.

---

## 1. Hitbox Cleanup & Depth Sorting

### Goal
The bird should fly *behind* tree canopies and *in front of* trunks, sorted by isometric Y position. Tree collision remains at the physical trunk base only.

### Changes

**Split tree rendering into two graphics layers:**

| Layer | Depth | Contents |
|-------|-------|----------|
| `trunkGfx` (rename existing `zoneGfx`) | 1 | Ground aura, trunk rectangles |
| `canopyGfx` (new) | 7 | Canopy ellipses only |

- Add `this.canopyGfx = this.add.graphics().setDepth(7)` in `create()`.
- Split `_drawZones()` so trunk/aura draws to `trunkGfx` and canopy ellipses draw to `canopyGfx`.
- Rename `this.zoneGfx` → `this.trunkGfx` everywhere (clear + trunk draw). Note: `tuftGfx` (depth 0.55) is a separate object used only in `_drawTufts()` and is **not** affected by this rename.

**Replace the binary depth-sorting block with the continuous formula:**

The existing depth-sorting block in `update()` (lines ~220–268) uses a binary occlusion system (`pd = 6` or `pd = 0.5`) that overwrites `playerGfx` depth every frame. This block must be **replaced** with a continuous depth set at the top of `_drawPlayer()`:

```js
const isoY = this.wx + this.wy;
this.playerGfx.setDepth(5 + (isoY + WORLD_SPAN) / (WORLD_SPAN * 2));
```

Range maps to ~[5, 6] across the full world span. The bird renders above trunks (depth 1) and below canopies (depth 7), sorted correctly against other objects at depth 5–6 (shadow at 4, mate at 5, enemies at 5.5). Remove all lines in the old block that set `pd`, `sd`, `td`; the `ed` (enemy depth) portion of that block can be kept for enemy occlusion if desired, but `playerGfx.setDepth` must only happen via the new formula.

**Shadow stays at depth 4** — always on the ground, always below the bird.

**Trunk collision unchanged** — `ZONE_COL_R = 0.14` is already a small base-only radius. No code change needed here.

---

## 2. Organic Floor — Subtle Wash Tints

### Goal
Each ground tuft gets a randomised earthy tint (Moss, Dust, or Dry Clay) blended at 18% opacity into its base and highlight colors, giving the floor organic variation without overwhelming the Caatinga palette.

Note: tufts draw on `tuftGfx` (depth 0.55) which is separate from `zoneGfx`/`trunkGfx`. No layer changes needed here.

### Tint palette

| Name | Hex | RGB |
|------|-----|-----|
| Moss | `#4a7c3f` | (74, 124, 63) |
| Dust | `#c4a882` | (196, 168, 130) |
| Dry Clay | `#c4703f` | (196, 112, 63) |

### Changes

**In `_genWorld()`**, when generating `groundTufts`, assign a random tint to each:
```js
const EARTHY_TINTS = [0x4a7c3f, 0xc4a882, 0xc4703f];
t.tint = EARTHY_TINTS[Math.floor(Math.random() * 3)];
```

**Add a color blend helper** (top of file, alongside `toScreen`):
```js
function blendHex(base, tint, t) {
  const br = (base >> 16) & 0xff, bg = (base >> 8) & 0xff, bb = base & 0xff;
  const tr = (tint >> 16) & 0xff, tg = (tint >> 8) & 0xff, tb = tint & 0xff;
  const r = Math.round(br + (tr - br) * t);
  const g = Math.round(bg + (tg - bg) * t);
  const b = Math.round(bb + (tb - bb) * t);
  return (r << 16) | (g << 8) | b;
}
```

**In `_drawTufts()`**, replace hardcoded `fillStyle` colors with blended versions:
```js
const T = 0.18;
const baseCol = blendHex(/* original base hex */, t.tint, T);
const hiCol   = blendHex(/* original hi hex */,   t.tint, T);
this.tuftGfx.fillStyle(baseCol, /* original alpha */);
```
All three tuft types (dry grass `0x7a5c14`/`0xa87c28`, rock `0x848078`/`0xaaa89a`, shrub `0x3e3010`/`0x5a4418`) apply this blend.

---

## 3. HUD Polish — Ritual Bark Style

### Goal
Energy bar and Year Clock adopt the "Ritual Bark" aesthetic: notched organic border, gold-green glow, and a small label above each element.

**Existing Phaser Text objects to hide in `_drawHUD()`:**
- `this.yearText.setVisible(false)` — replaced by the bark-bordered drawn box.
- `this.energyLabel.setVisible(false)` — replaced by the `'SPIRIT ENERGY'` canvas label drawn 5px above the bar.

### Bark border helper

Add `_barkBorder(gfx, x, y, w, h, col)` to the class:
```js
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

### Energy bar (top-right)

Existing variables in `_drawHUD()`: `ebX = SW - 140`, `ebY = 60`, `ebW = 120`, `ebH = 10` (unchanged).

Replace current plain `strokeRect` border:
1. **Glow** — 8 expanding rects, `rgba(140,200,60, i*0.012)` at `(ebX-i, ebY-i, ebW+i*2, ebH+i*2)`.
2. **Trough** — `fillStyle(0x0e1804, 1)` fill.
3. **Fill gradient** — `0xa8e040` → `0x3a7010` top-to-bottom; 2px shimmer line `rgba(180,255,80,0.4)` at top of fill. Low-energy warning (`energy < 0.30`) still uses `0xff7722` for the fill color.
4. **Bark border** — `this._barkBorder(this.hudGfx, ebX-2, ebY-2, ebW+4, ebH+4, 0x8a6830)`.
5. **Label** — draw `'SPIRIT ENERGY'` via `hudGfx` as a 7px text alternative: use a small pixel-font approach or simply keep the Phaser Text object repositioned/restyled. Simplest: keep `this.energyLabel` but set its text to `'SPIRIT ENERGY'`, color `#8a6830`, hide via `setVisible(false)` and draw position manually with a separate small Phaser text. *(See note below.)*

> **Note on labels:** Phaser's `Graphics` object cannot draw text directly. Labels (`'SPIRIT ENERGY'`, `'YEAR'`) must remain as Phaser `Text` objects but need to be repositioned/restyled to match the bark theme. Update `this.energyLabel` style in `create()` to `{ color: '#8a6830', fontSize: '7px', fontFamily: 'monospace' }` and reposition to `(ebX, ebY - 10)`. Similarly update `this.yearText`.

### Year Clock (top-right)

Define box coordinates in `_drawHUD()`:
```js
const SW = this.scale.width;
const yw = 88, yh = 28, yx = SW - yw - 16, yy = 14;
```

1. **Glow** — 8 rects, `rgba(180,140,30, i*0.012)` at `(yx-i, yy-i, yw+i*2, yh+i*2)`.
2. **Background** — `fillStyle(0x110c04, 1)` fill rect.
3. **Bark border** — `this._barkBorder(this.hudGfx, yx-2, yy-2, yw+4, yh+4, 0x8a6830)`.
4. **`YEAR` label** — update `this.yearText` style in `create()`: `{ color: '#786028', fontSize: '7px', fontFamily: 'monospace' }`, positioned at `(yx + yw/2, yy + 8)`, origin `(0.5, 0)`. This shows `'YEAR'` static text.
5. **Year numeral** — add a second Phaser Text `this.yearNumText` in `create()`: `{ color: '#d4a840', fontSize: '13px', fontStyle: 'bold', fontFamily: 'monospace' }`, positioned at `(yx + yw/2, yy + yh - 6)`, origin `(0.5, 1)`. Updated each frame in `_drawHUD()` with `this.currentYear`.

---

## 4. Nature's Sway

**Dependency:** Step 4 must be done after Step 3 (the `zoneGfx` split into `trunkGfx` + `canopyGfx`) is complete. Sway targets canopy ellipses only, which only exist in their own draw block after the split.

### Goal
Tree canopies breathe with a subtle wind animation — only the crown moves, giving the impression of a breeze through the Caatinga without the trees appearing unstable.

### Changes

**In `_drawZones()`**, inside the canopy draw block (drawing to `canopyGfx`), compute a per-frame sway offset for each tree:

```js
const swayAmp    = kind === 'zone' ? 2.5 : 1.2; // saplings sway less
const swayX      = Math.sin(time * 0.65 + obj.phase) * swayAmp;
const swayScaleW = 1 + 0.018 * Math.sin(time * 0.9 + obj.phase);
```

Apply `swayX` as an additive offset to `s.x` for all canopy `fillEllipse` calls. Apply `swayScaleW` to canopy ellipse widths. Trunk draw calls use the original unmodified `s.x`.

**Existing `phase` field** on each zone and sapling is reused — no new data needed.

---

## Implementation Order

1. `blendHex` helper + tuft tint assignment in `_genWorld` + `_drawTufts` update *(tuftGfx unaffected by later rename)*
2. `_barkBorder` helper + `_drawHUD` energy bar + year clock + Phaser Text restyling
3. Split `zoneGfx` → `trunkGfx` + `canopyGfx`; replace binary depth-sort block with continuous formula in `_drawPlayer`
4. Sway offsets in `_drawZones` canopy block *(requires Step 3 complete)*

---

## Out of Scope

- Audio changes
- Gameplay mechanic changes
- Health bar restyling (not part of this sprint)
