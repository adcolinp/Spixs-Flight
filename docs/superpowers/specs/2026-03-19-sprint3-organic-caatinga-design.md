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
- Rename `this.zoneGfx` → `this.trunkGfx` everywhere (clear + trunk draw).

**Dynamic player depth:**

Each frame in `_drawPlayer()`:
```js
const isoY = this.wx + this.wy;
this.playerGfx.setDepth(5 + (isoY + WORLD_SPAN) / (WORLD_SPAN * 2));
```
Range maps to ~[5, 6] across the full world span. Birds further "south" (higher isoY) render above birds further "north."

**Shadow stays at depth 4** — always on the ground, always below the bird.

**Trunk collision unchanged** — `ZONE_COL_R = 0.14` is already a small base-only radius. No code change needed here.

---

## 2. Organic Floor — Subtle Wash Tints

### Goal
Each ground tuft gets a randomised earthy tint (Moss, Dust, or Dry Clay) blended at 18% opacity into its base and highlight colors, giving the floor organic variation without overwhelming the Caatinga palette.

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

**Add a color blend helper** (top of file or inside class):
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
```
All three tuft types (dry grass, rock cluster, thorny shrub) apply this blend.

---

## 3. HUD Polish — Ritual Bark Style

### Goal
Energy bar and Year Clock adopt the "Ritual Bark" aesthetic: notched organic border, gold-green glow, and a small label above each element.

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
    gfx.fillRect(i, y - ext + 1,       1, ext); // top edge
    gfx.fillRect(i, y + h - 1,         1, ext); // bottom edge
  }
  for (let j = y; j < y + h; j++) {
    const n = notch[ni++ % notch.length];
    const ext = (j % n === 0) ? 2 : 1;
    gfx.fillRect(x - ext + 1,     j, ext, 1); // left edge
    gfx.fillRect(x + w - 1,       j, ext, 1); // right edge
  }
}
```

### Energy bar (top-right)

Replace current plain `strokeRect` border in `_drawHUD()`:
1. **Glow** — 8 expanding rects, `rgba(140,200,60, i*0.012)` behind the bar.
2. **Trough** — dark fill `0x0e1804`.
3. **Fill gradient** — `0xa8e040` → `0x3a7010` top-to-bottom; 2px shimmer line `rgba(180,255,80,0.4)` at top of fill.
4. **Bark border** — `_barkBorder(hudGfx, ebX-2, ebY-2, ebW+4, ebH+4, 0x8a6830)`.
5. **Label** — `'SPIRIT ENERGY'` in `#8a6830`, 7px monospace, 5px above bar.
6. Low-energy warning color (`0xff7722`) still triggers at `energy < 0.30` — keep existing logic, just change the fill gradient stops.

### Year Clock (top-right, above energy label)

Replace plain `yearText` with a bark-bordered box drawn in `_drawHUD()`:
1. **Glow** — 8 rects, `rgba(180,140,30, i*0.012)`.
2. **Background** — `0x110c04` fill.
3. **Bark border** — `_barkBorder(hudGfx, yx-2, yy-2, yw+4, yh+4, 0x8a6830)`.
4. **`YEAR` label** — `#786028`, 7px monospace, centred inside box top.
5. **Year numeral** — `#d4a840`, bold 13px monospace, centred.

Hide the existing `this.yearText` Phaser Text object (it becomes redundant — drawing replaces it).

---

## 4. Nature's Sway

### Goal
Tree canopies breathe with a subtle wind animation — only the crown moves, giving the impression of a breeze through the Caatinga without the trees appearing unstable.

### Changes

**In `_drawZones()`**, inside the canopy draw block for each tree, compute a per-frame sway offset before drawing canopy ellipses:

```js
const swayAmp  = kind === 'zone' ? 2.5 : 1.2; // saplings sway less
const swayX    = Math.sin(time * 0.65 + obj.phase) * swayAmp;
const swayScaleW = 1 + 0.018 * Math.sin(time * 0.9 + obj.phase);
```

Apply `swayX` as an additive offset to the `s.x` used for canopy ellipses only (trunk `s.x` unchanged). Apply `swayScaleW` to canopy ellipse widths only.

**Existing `phase` field** on each zone and sapling is reused — no new data needed.

---

## Implementation Order

1. `blendHex` helper + tuft tint assignment in `_genWorld` + `_drawTufts` update
2. `_barkBorder` helper + `_drawHUD` energy bar + year clock
3. Split `zoneGfx` → `trunkGfx` + `canopyGfx`, dynamic player depth
4. Sway offsets in `_drawZones` canopy block

---

## Out of Scope

- Audio changes
- Gameplay mechanic changes
- Health bar restyling (not part of this sprint)
