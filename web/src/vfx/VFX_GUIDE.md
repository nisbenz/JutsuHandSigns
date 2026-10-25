# Making jutsu VFX that don't look cheap

A craft guide for designing new technique effects. The code side (files,
APIs, registering an effect) is in [README.md](README.md); this is about what
makes an effect feel like it belongs in an Ultimate Ninja Storm cutscene
instead of a phone filter.

Every lesson below was learned on this project: the first Rasengan was a
white blob, the first dragon was a worm, the first Susanoo looked like a
balloon animal, and the first Sharingan made the player's eyes slide away.

---

## 1. Start from reference, not from a shape

Before writing code, collect 5–10 frames of the technique from the anime and
the Storm games, and answer:

- **What is its silhouette?** Chidori is a spiky ball with long cracks; Rasengan
  is a perfect sphere with spiral bands; Amaterasu is a ragged black teardrop.
  If you can't recognise it as a solid black shape, neither will the player.
- **Where does it live?** In the palm, on the eyes, around the body, in the
  room? That decides the tracking it needs and its scale.
- **What are its three beats?** Almost every jutsu has a *build-up*, a
  *payoff* and a *release*. Write them down with timings before you start.
- **What makes it *this* jutsu and not a generic one?** For Itachi's Susanoo
  it's the long tengu nose and the cowl; for Kamui it's the spiral pulling the
  world in. Spend most of your effort on that one signature feature.

A generic "blue glow + particles" will always read as cheap, however well it
is executed.

## 2. Timing is most of the quality

Cheap effects appear, sit there, and disappear. Good ones have rhythm.

- **Anticipation (0.3–1 s).** Something gathers before the payoff: particles
  sucked in (Rasengan), embers inhaled (Great Dragon Fire), a seal drawn on
  the ground (summons), tomoe spinning out of the pupil (Sharingan).
- **Impact frame.** The payoff lands *hard*, within 1–3 frames: a flash, a
  shake, a chromatic-aberration spike, a sound. Use exponential decays
  (`Math.exp(-(t - hit) * 5)`) for the flash, never linear fades.
- **Sustain with life.** While the effect holds, something must keep moving:
  rotation, flicker, breathing scale, embers. A static frame for even one
  second reads as frozen.
- **Follow-through.** Don't just fade out. Burst, collapse, scatter, sink into
  the ground (Rasengan's shockwave, Water Prison's splash, coffins sinking).
- **Ease everything.** Use `easeOutBack` for things that pop into existence,
  `smooth` for camera-like moves, squared curves for things falling or
  accelerating. Linear motion looks mechanical.
- **Vary the speeds.** Nothing should move at one constant rate. Make inner
  layers faster than outer ones and small things faster than big ones, and
  randomise each particle a little.
- **Respect the total length.** Most casts sit between 4.5 and 7 s. Longer
  feels like waiting; shorter doesn't let the payoff breathe.

## 3. Build in layers

One mesh with one material is never enough. Think in three layers:

| Layer | Role | Examples here |
|---|---|---|
| **Core** | The recognisable shape, brightest value | Rasengan's sphere, Chidori's bolts, the Susanoo body |
| **Secondary** | Motion and structure around the core | rings, forks, flames on the shoulders, tomoe |
| **Tertiary** | Small, numerous, cheap detail that sells scale | sparks, embers, droplets, dust, leaves, ash |

Then add the **world response** (section 5) on top. When an effect feels thin,
it is almost always missing the tertiary layer or the world response, not a
better core.

## 4. Control value and colour

The most common way this project's effects broke was **too much brightness**.

- **Glow is a budget.** Only HDR colours (> 1) bloom. Keep the core bright and
  everything else clearly dimmer, or it all merges into one white blob. Start
  low and raise intensities; never start high.
- **Additive layers stack.** Five overlapping additive layers at 0.5 each are
  2.5, which is pure white. Overlapping translucent volumes need a depth
  pre-pass (Susanoo) or much lower values.
- **White is for the hottest point only.** A Rasengan should be blue with a
  white heart, not white with a blue fringe. Keep saturation in the mid-tones.
- **One hue family per jutsu,** plus at most one accent: Chidori is cold blue
  with white; Amaterasu is black with a purple-red rim; Mangekyō is red and
  black. Matching the character's chakra colour (Sasuke purple, Itachi red,
  Madara blue) is what makes it feel canon.
- **Contrast with dark.** Dark parts make the glow pop: the black tomoe, the
  limbal ring, Amaterasu's black flames, shadow tendrils. Darken the scene
  slightly during the payoff (`stage.darken`) so the effect is the brightest
  thing on screen.
- **Judge it on a real camera image.** The fake test camera is bright green;
  colours that look fine on it can look grey on a real room, and the reverse.

## 5. Make it belong in the room

An effect that doesn't affect the camera image looks pasted on. This is the
single biggest difference between "AR filter" and "it's really happening".

- **Light the player.** `stage.setLight` at the effect's position: blue on the
  palm for Rasengan, warm on the face for fire, red around the eyes for the
  Sharingan.
- **Grade the world.** Cold and desaturated for lightning, warm for fire,
  grey-red for genjutsu, a red negative for Tsukuyomi. Ramp the grade with
  the effect's energy instead of switching it on.
- **Distort the world.** Refraction behind water and the Rasengan, heat haze
  above fire, the vortex pulling the room into Kamui (`stage.setWarp`).
  *Exception:* never warp near the face during eye effects; the real eyes
  slide out from under the irises.
- **Physical reaction.** Shake on impacts, aberration on flashes, a frozen
  frame for Shadow Possession, droplets on the lens after a water hit.
- **Depth and occlusion.** Big things behind the player (Susanoo, the toad,
  the snake) must have the player redrawn in front from the live person mask.
  Things coming at the viewer should grow in perspective (positive `z`), not
  just scale up.
- **Anchor everything.** Effects follow the palm, the eyes or the shoulders,
  and every effect needs a sensible fallback position for when tracking is
  lost, so it never jumps to a corner or vanishes.

## 6. Shapes and models

Primitive spheres and tubes glued together are the fastest way to look cheap.

- **No visible seams.** Separate primitives that touch show hard creases.
  Either sculpt one continuous shape (`sculpt.js`: smooth union melts parts
  together) or use a proper downloaded model.
- **Silhouette first, detail second.** A dragon is a dragon because of its
  head (snout, jaw, horns, brow, mane) and its back spines. A tube with
  spheres for eyes is a worm, however good the shader is.
- **Proportion.** Necks thinner than bodies, tails tapering to a point, heads
  big enough to read at a distance. Check the model from the front *and* from
  the side.
- **Faces carry identity.** Spend detail where the eye goes: the head, the
  hands, the point of contact. Bodies can stay simpler.
- **Downloaded models**: hide the parts you don't need (the human Madara in
  the Madara file), find the anchor and scale from a preview with rulers, and
  replace their materials with the jutsu's shader so every effect shares one
  look. Keep the model's own texture as surface detail. Credit the author.
- **Flat shapes must be rare.** Planes and sprites are fine for flames, glints
  and sheets of paper, but anything structural (fins, armor, coffins) needs
  thickness, or it vanishes when seen edge-on.

## 7. Shading that reads as energy or matter

Decide early whether the thing is **energy** (chakra, lightning, fire) or
**matter** (wood, clay, water, paper, flesh). They need different shaders.

- **Energy:** additive, a bright fresnel rim, a dimmer body, animated noise
  flowing through it (always moving upward for flames), a little key light so
  the volume still has form. No hard specular.
- **Matter:** lit (key + fill light), a real surface pattern (bark grain,
  snake scales, water caustics), a specular highlight where it is wet or
  polished, alpha-blended rather than additive.
- **Water** is in between: translucent body, strong rim, caustic glints,
  refraction of the room behind it.
- **Smooth normals.** Faceted lighting on a round shape gives it away
  instantly. Use enough segments, or sculpt it.
- **Noise everywhere, never tiled.** Edges of flames, smoke, shadow tendrils
  and ink should waver with animated noise. Perfectly crisp, static edges look
  like stickers.

## 8. Anime style, not realism

Naruto effects are stylised. Some anime tricks that read well here:

- **Impact frames:** a 1–3 frame flash, shake and colour inversion or tint at
  the moment of contact.
- **Speed lines** and afterimages for fast movement (Body Flicker).
- **Graphic shapes:** comet tails on rings, comma-shaped tomoe, crescent
  slashes. Clean, readable curves beat physically accurate chaos.
- **Glints:** a horizontal streak across the eyes when a dōjutsu activates.
- **Held poses:** let the payoff hold still for a beat while particles keep
  moving around it.

## 9. Sound sells half of it

Sync a sound to every impact frame: `sfx.taiko()` for big reveals and hits,
`sfx.boom()` for explosions, `sfx.poof()` for smoke, `sfx.slash()` for claws,
`sfx.tick()` for small knocks. A silent impact feels weak however good it
looks; an impact with sound but no visual change feels broken. Play each
sound once per event (guard it with a flag), never per frame.

## 10. Performance is part of quality

A stutter destroys the illusion faster than any visual flaw.

- Keep one draw call per system: batch with `InstancedMesh`, `Points`, or
  ribbons that rebuild one buffer, not hundreds of meshes.
- Don't allocate new geometry every frame; rebuild existing buffers
  (`SpineTube`, `LightningRibbons`).
- Move heavy work to `static prebake()` (model loading, sculpt baking); it
  runs while the player is still doing the hand signs.
- Particle counts in the low hundreds are usually enough when they are well
  placed; thousands only for haze-like effects (C4 Karura).

## Checklist before calling an effect done

- [ ] Recognisable as *that* jutsu from its silhouette alone
- [ ] Clear build-up → impact → release, 4.5–7 s total
- [ ] Core, secondary and tertiary layers
- [ ] No white blow-out; the brightest point is small
- [ ] Colours match the technique and the character's chakra
- [ ] Lights, grades and/or warps the camera image
- [ ] Shake, flash and sound on the impact frame
- [ ] Stays anchored when the player moves; sensible fallback when tracking is lost
- [ ] Looks right from the actual camera angle, on a real (not test) image
- [ ] No visible seams, flat cut-outs or faceted lighting on round shapes
- [ ] Runs smoothly; heavy work is prebaked
- [ ] Credits added for any downloaded asset
