# 3D jutsu effects (`web/src/vfx`)

Each jutsu cast is a short 3D effect rendered with Three.js on top of the live
camera, anchored to the player with MediaPipe tracking. This folder holds the
renderer, the tracking, a toolkit of reusable pieces, and one class per effect.

This file covers the code. For how to design an effect so it looks premium
rather than cheap (timing, layering, colour, integration, models), read
[VFX_GUIDE.md](VFX_GUIDE.md) first.

## How a cast works

1. The **backend** only checks the hand-sign sequence. When the last sign is
   held, the frontend (`App.jsx`) closes the jutsu WebSocket and mounts
   `components/JutsuCast.jsx`.
2. **JutsuCast** builds a `Stage`, starts a `Tracker` for whatever the effect
   needs, creates the effect, and runs `effect.update(...)` once per frame
   until `Effect.duration` seconds have passed.
3. Skills with no 3D effect fall back to the old backend-drawn cast.

Trackers and models start loading **when the player picks a jutsu**
(`preloadVfx` in `registry.js`), so they are ready by the time the signs are
done.

## Files

| File | What it is |
|---|---|
| `registry.js` | Skill name → effect class. Keyword match, **first match wins**, so order matters (e.g. "deep forest" before "wood release", "mangeky" before "sharingan"). |
| `stage.js` | Renderer, camera, bloom + post pass. The camera feed is drawn *inside* the scene, so effects can light it, warp it, tint it and shake it. |
| `tracking.js` | MediaPipe hand / face / pose / person-segmentation, smoothed, in viewport pixels. |
| `kit.js` | Small helpers: easing, `span`, glow sprites, shockwaves, lightning ribbons, sparks, flames, `Ghost` (frozen camera frame). |
| `elements.js` | Bigger building blocks: `SpineTube` (animated tubes), water / bark / scale materials, fire & smoke `Puffs` + `explode()`, `InkRibbons`, `Cutout` (the player cut out of the frame, frozen or live). |
| `sculpt.js` | Signed-distance "clay" modelling baked into smooth meshes (Susanoo fallback, dragon and snake heads). |
| `dragon.js` | Shared dragon / snake rig (body tube + sculpted head, jaw, legs, spines). |
| `effects/*.js` | The effects, grouped by family (water, explosions, shadow, wood, clones, summons, dojutsu, …). |
| `effects/susanoo-models.js` | Loads the downloaded Susanoo `.glb` files and swaps their materials for the chakra shader. |

Related: `../sfx.js` (sounds), `public/models/` and `public/sfx/` (assets + `CREDITS.md`).

## Writing an effect

```js
// effects/my-jutsu.js
import * as THREE from "three";
import { disposeTree, glowSprite, smooth, span } from "../kit";

export default class MyJutsu {
  static needs = ["hand"];   // any of "hand", "face", "pose", "segment" (or [])
  static duration = 5;       // seconds; JutsuCast ends the cast after this

  // Optional: heavy work (baking sculpts, loading models) done ahead of time.
  // static prebake(character) {}

  constructor(stage, { power, character }) {
    // power: 0.25..1 from how well the signs went; character: e.g. "itachi-uchiha"
    this.stage = stage;
    this.root = new THREE.Group();
    this.glow = glowSprite(new THREE.Color(0.3, 0.6, 1.5));
    this.root.add(this.glow);
    stage.scene.add(this.root);
  }

  update(t, dt, track) {
    const st = this.stage;
    const h = track.hand;
    const x = h.seen ? h.x : st.width / 2;   // always have a fallback position
    const y = h.seen ? h.y : st.height * 0.6;
    st.toWorld(x, y, 0, this.glow.position);
    this.glow.scale.setScalar(st.toWorldSize(h.size || 100) * 2 * smooth(span(t, 0, 0.5)));
    st.setLight(0, x, y, 200, new THREE.Color(0.3, 0.6, 1), 0.8); // light the player
    st.darken = 0.2;
  }

  dispose() {
    disposeTree(this.root);
  }
}
```

Then register it in `registry.js`: `["my jutsu", MyJutsu],` (lower-case keyword
contained in the skill name from `data/skills.js`).

**Timeline idiom.** Every effect is a function of `t`: `span(t, a, b)` gives
0→1 progress between two times, `smooth` / `easeOutBack` shape it. Most effects
use the same three phases: build-up, sustain, release (often with a flash and
shake), then a fade over the last ~0.5 s.

## Coordinates

- **Tracking is in viewport CSS pixels**, already mirrored like a selfie view.
- **The 3D world** has the camera at `z = 10` looking down −z; effects live
  around `z = 0`. Convert with `stage.toWorld(px, py, z)` and
  `stage.toWorldSize(px)`.
- Positive `z` comes toward the viewer (up to ~8 before it clips); negative
  `z` goes behind the player.

### What `track` contains

| Key | Fields (pixels) |
|---|---|
| `hand` | `seen`, `presence` (0..1 fade), `x`, `y` (palm centre), `size` (wrist→knuckle), `dirX`, `dirY` (wrist→palm) |
| `face` | `seen`, `presence`, `eyes[2]` (`x`, `y`, `r`, `cx`, `cy`, `halfW`, `halfH`), `roll`, `span`, `mouthX/Y`, `mouthOpen`, `noseX/Y` |
| `body` | `seen`, `presence`, `span` (shoulder width), `torsoX/Y`, `joints.{nose, l/rShoulder, l/rElbow, l/rWrist, l/rHip}`; use `fallbackBody(w, h)` when not seen |
| `segment` | `seen`, `width`, `height`, `data` (person mask, 0..255, raw video orientation) |

## Stage controls (reset every frame)

Set these in `update()`. They go back to neutral each frame, so an effect only
describes what it wants *now*.

| Control | Effect |
|---|---|
| `setLight(i, px, py, radiusPx, color, intensity)` | Light falling on the player (2 slots: `i` = 0 or 1). |
| `setWarp(px, py, radiusPx, pinch, twist)` | Refraction / swirl of the camera image. |
| `darken`, `desaturate`, `invert`, `contrast`, `tint` (Color) | Colour grade of the camera feed. |
| `flash` (Color) | Additive full-screen flash. |
| `vignette`, `vignetteColor`, `aberration`, `bloom.strength` | Post effects. |
| `shake(amount)` | Screen shake in screen fractions (0.01 = 1 %); decays by itself. |
| `snapshot()` | Freeze the current camera frame into a texture (see `Ghost`, `Cutout`). |

## Rules that keep effects looking right

- **Glow = HDR colour.** The bloom threshold is 0.95 and the camera feed is
  capped below it, so only colours above 1 glow. Use `ADDITIVE` from `kit.js`
  for glowing materials (`toneMapped: false`).
- **Additive layers stack into white.** If a glowing object has overlapping
  parts, add a depth pre-pass (see `susanoo.js`) or lower the intensities.
  Tune on a real camera image, not on a bright test pattern.
- **Never warp the image near the face** in eye effects. The irises are placed
  from tracking, so warping the pixels under them makes the real eyes slide
  away from the overlay.
- **Things "behind" the player** (Susanoo, toad, snake) need the player redrawn
  on top: a live `Cutout` with `uMix = 0` (see `Occluder` in `summons.js`).
- **Custom `ShaderMaterial` on an `InstancedMesh`** must apply `instanceMatrix`
  itself (`#ifdef USE_INSTANCING`), otherwise every instance renders at the
  origin.
- **Always have a fallback** when tracking hasn't locked on yet (centre of
  frame, `fallbackBody`, `FULL_MASK`), so the cast still reads.

## Models

- **Sculpts** (`sculpt.js`): build a shape from `sphere`, `ellipsoid`, `cone`,
  `chain`, `box`, `torus`, combine with `union(parts, k)` (smooth blend) and
  `subtract(base, cut, k)`, mirror pairs with `mirrorX` / `mirrorZ`, then
  `bake(key, makeShape, bounds, res)`. Baking takes ~1–2 s, so it is cached
  by key and should be triggered from `static prebake()`.
- **Downloaded `.glb` models**: put them in `public/models/<family>/`, add an
  entry to `CREDITS.md` (most Sketchfab models are CC-BY and need credit), and
  describe them like the entries in `susanoo-models.js`: which mesh indices to
  hide, where the anchor point is in model units, and the scale. Replace their
  materials with your effect's shader so they match the rest of the cast.

## Sounds

`import { sfx } from "../../sfx"` and call `sfx.taiko()`, `sfx.boom(gain)`,
`sfx.poof()`, `sfx.slash()`, `sfx.tick()` etc. from effects for impacts.

## Testing

- Run the app (backend + `npm run dev` in `web/`), use **Choose character** on
  the scan screen to reach any character, pick a technique and do the signs.
  Characters whose techniques have a 3D effect show a **3D** badge.
- For faster iteration you can render one effect without doing the signs:
  make a throwaway HTML page in `web/` that creates a `Stage` on a webcam
  `<video>`, instantiates the effect from `vfxFor("Skill Name")`, and calls
  `stage.beginFrame(dt); effect.update(t, dt, track); stage.render(dt)` every
  frame with a hand-written `track` object. Delete it when done.
- `npx vite build` and `npx oxlint src` must both pass.

## Still to do

Techniques that still use the old effect (as of this writing): the taijutsu
and impacts (Eight Gates, Primary Lotus, Leaf Hurricane, Gentle Fist, Palm
Rotation, 64 Palms, Fang Over Fang, Twin Wolf Fang, Cherry Blossom Impact,
Earth-Shattering Punch, Lava-Melting Chop), body transformations (Sage Mode,
Snake Sage Mode, Hundred Seal, Partial Expansion, Human Boulder, Butterfly
Mode), swarms (Paper Release, Shikigami, Iron Sand), the Mind techniques,
healing (Chakra Scalpel, Byakugō), puppets, Six Paths of Pain and Living
Corpse Reincarnation. Run the coverage check by comparing `registry.js`
keywords against `data/skills.js`.
