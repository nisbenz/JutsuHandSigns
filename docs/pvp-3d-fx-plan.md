# PvP duel: 3D effects plan

Goal: make the 1v1 duel feel like an Ultimate Ninja Storm fight. Each player
glows with their own chakra, their hands charge up while they hold a seal,
hits strike the opponent's **body** in 3D, and finishing a jutsu plays that
character's real 3D technique (the same effects as training mode) before it
slams into the other player.

This builds on the 3D effects engine that is already in the repo
(`web/src/vfx`: `Stage`, `Tracker`, `kit.js`, `elements.js` and about 40
effect classes). It does not add a new renderer. Read
[web/src/vfx/README.md](../web/src/vfx/README.md) and
[VFX_GUIDE.md](../web/src/vfx/VFX_GUIDE.md) first.

---

## 0. What the current engine can't do yet (and why this plan is shaped this way)

| Gap | Where | Consequence for PvP |
|---|---|---|
| Tracking reads **one** person: `numHands: 1`, `numPoses: 1`, `numFaces: 1`, then `landmarks[0]` | `vfx/tracking.js` | It can't tell P1's hands from P2's. Effects would jump between players. |
| Effects are **4.5–7 s full-screen casts** built around one player | `vfx/effects/*` | A duel lands a hit every 1–3 s, so playing them as-is would cover the fight. |
| 21 places in the effects fall back to the **screen centre** (`width / 2`, `fallbackBody(W, H)`) when tracking is lost | `vfx/effects/*` | In a split screen the screen centre is the divider line, so an untracked effect would sit on the line. |
| The Stage colour grade (`darken`, `desaturate`, `tint`) applies to the **whole** frame, and it has 2 light slots | `vfx/stage.js` | It can't grey out only the loser's half, or light both players at once. |
| The duel background is the backend's JPEG (about 12 fps, delayed by the round trip) | `PvpDuel.jsx` | 3D effects drawn over a laggy picture won't line up with the people in it. |

### Defaults (change before coding if you want)

| # | Decision | Default |
|---|---|---|
| D1 | Do signs keep counting while a jutsu finisher plays? | **Yes.** The fight never pauses, and the finisher is a short "duel cut" (D2). |
| D2 | Finisher length | **3.2 s max.** Longer effects are time-compressed (`timeScale = duration / 3.2`), and the strike lands at about 1.4 s. |
| D3 | Two finishers at once | **One at a time.** The second waits up to 1.2 s, and if it still can't play it only does the strike and impact (no cinematic). |
| D4 | Skills with no 3D effect yet (about half the roster, listed in the vfx README) | They get a **generic elemental finisher** built from kit parts, tinted by element. |
| D5 | If WebGL or MediaPipe is unavailable or slow | **Fall back** to today's 2D effects (`duelFx.js` plus the backend JPEG). The same happens with `?fx=2d`. |

---

## 1. Architecture

```
<PvpDuel>
 ├─ <DuelStage>  (new)  one persistent Three.js Stage, full screen, live <video> as background
 │    ├─ DuelTracker (new)    two-person tracking → players[0|1].{hand, hands[], face, body, segment}
 │    ├─ PlayerFx ×2 (new)    always-on: aura, hand charge, low-HP, KO / victory
 │    ├─ StrikeFx  (new)      3D bolt from attacker to defender's body + impact
 │    └─ FinisherDirector (new) runs registry effects scoped to one player, queues them
 ├─ HUD (unchanged)  health bars, seal cards, timer, damage numbers, banner
 └─ 2D fallback      today's <img> + duelFx.js canvas (D5)
```

- **Live video background.** `DuelStage` renders the webcam itself at full
  frame rate, so effects line up with the players. The backend's JPEG is
  then no longer drawn; it is only used for the 2D fallback.
- **Lock-on reticles.** The backend already knows each detection box. It will
  send it in the state as `players[i].bbox`, normalised and already in
  mirrored screen space. The duel draws a 3D reticle there: green when the
  sign matches, cyan when it doesn't. That replaces the boxes drawn on the
  JPEG.
- **Per-player scoped tracks.** `DuelTracker.view(i)` returns an object shaped
  exactly like today's `Tracker` (`hand`, `face`, `body`, `segment`), but only
  for player *i*. Existing effects can then run unchanged on one player. When
  that player isn't tracked, the view reports `seen: true` with positions
  synthesised in the **centre of their half**, so the 21 screen-centre
  fallbacks never trigger.
- **Events.** The duel's message handler already groups `hit` events per
  attacker. It will call `stageApi.seal(attacker)`, `stageApi.strike(attacker,
  defender, {skill, big})` and `stageApi.ko(winner)`. The HP-on-impact logic
  stays as it is, with the impact callback now coming from `StrikeFx`. The
  timer fallback that makes sure a hit still lands when animation frames are
  paused also stays.

---

## 2. Phases (each one ships on its own and is verifiable)

### Phase 1: DuelStage foundation

1. Wrap `Stage` in `components/DuelStage.jsx`. It is created once per duel,
   runs its render loop, is disposed on exit, and stays alive through
   rematches.
2. Stage additions in `vfx/stage.js`. They are backward compatible, and the
   training casts must look identical:
   - `LIGHTS` 2 → 4, so each player can have 2 lights.
   - `setHalfGrade(side, {desaturate, darken, tint})`: per-half colour grade
     in the background shader (`vUv.x < 0.5` = left half), blended over a
     soft 3 % band at the divider.
3. Backend: add `bbox` to `Player.state()` in `backend/game/pvp.py`, in
   normalised mirrored coordinates and only while the detection is present.
   Covered by a unit test.
4. 3D reticles drawn from `bbox`.
5. Fallback: if the Stage throws, or the WebGL context is lost, PvpDuel
   switches to 2D mode. `?fx=2d` forces it.

### Phase 2: Two-person tracking

1. `vfx/duelTracking.js`: separate landmarker instances (cache keys `pose2`,
   `hand4`, `face2`) with `numPoses: 2`, `numHands: 4`, `numFaces: 2`, so the
   single-person training tracker is untouched.
2. `assignToPlayers(detections, W)` is a pure function. Each detection goes
   to the player whose half holds its anchor (pose: shoulder midpoint; hand:
   wrist; face: nose). Ties near the divider go to the player who owned it in
   the last frame, which stops flicker when someone leans in. Hands are
   assigned to the nearest wrist of that player's pose when pose is
   available, so P1's hand reaching past the line still belongs to P1.
3. Segmentation: one person mask, split per player by keeping columns on the
   player's side, feathered at the divider.
4. Budget: pose and hands alternate frames (about 30 Hz each). Face runs only
   while a finisher needs it. All of it is smoothed like the existing tracker.
5. Debug overlay (`?fxdebug=1`): each player's skeleton and hand points drawn
   in their colour, so assignment can be checked at a glance.

### Phase 3: Player effects (always on)

All of these are anchored to the player's tracked body or hands, with
fallbacks in their half:

| Effect | Trigger | Look |
|---|---|---|
| **Chakra aura** | always during the fight | Flame-like rim around the silhouette (segment mask, edge glow shader) in the character's chakra colour: Sasuke purple, Itachi / Indra red, Hinata / Neji pale lavender, Kakashi blue-white, Madara blue, iron-sand grey for Sasori, and so on (new `data/chakra.js`). Breathes slowly. |
| **Hand charge** | while holding the correct seal (`hold_progress` > 0) | Orb and sparks between both hands, growing with `hold_progress`. Lights the player's hands and face (`setLight`). Particles are sucked in, which is the anticipation beat. |
| **Seal landed** | `seal(attacker)` | Kanji of the seal flashes over the hands, a ring pulses outward, and the aura flares for 0.4 s. |
| **Got hit** | impact on this player | Red light on the torso, a short warp ripple at the impact point, sparks from the chest, and the aura flickers. |
| **Low HP** (< 25) | state | The aura thins and turns ragged, with smoke wisps and a slight desaturation of their half. |
| **KO / victory** | `ko(winner)` | Loser's half: greyscale plus a slow-motion feel (frozen `Ghost` frame, ash particles drifting up). Winner: a golden pillar of light and an aura burst. |
| **Intro** | countdown 3-2-1 | P1's aura ignites on "3", P2's on "2", and both flare on "FIGHT". |

### Phase 4: 3D strikes

`StrikeFx` replaces the 2D bolt whenever 3D is on.

- **Path:** from the attacker's hands (tracked) to the defender's chest
  (pose torso), arcing out of the screen (positive `z`) so it comes at the
  camera a little before diving into the other half.
- **Per element**, built from existing kit parts:
  - lightning: `LightningRibbons` and `boltPath`, with a cold blue grade
    flash;
  - fire: `Puffs` fireball and embers;
  - water: `SpineTube` water jet with `waterMaterial`, then a splash;
  - wood: `barkMaterial` spikes;
  - shadow / genjutsu: `InkRibbons`;
  - wind / default: a `Shockwave` ring with sparks.
- **Impact** on the defender's body: `Shockwave`, `Sparks`, `setLight` on the
  torso, `setWarp` ripple, `shake`, aberration spike, and the "Got hit"
  player effect. Sign hits are small. Jutsu hits are big, with 3× the
  particles, a stronger shake and a half-screen flash.
- The impact callback drives the HP bar, damage number and sound, exactly as
  the 2D bolt does today.

### Phase 5: Jutsu finishers

`FinisherDirector`:

1. On a jutsu hit, look up `vfxFor(skill)`. If it finds an effect, create it
   with `stage` and the attacker's scoped tracker view, and run it on a
   compressed timeline (D2). If it doesn't, use `GenericFinisher(element)`
   (D4).
2. At the strike beat (about 1.4 s into the duel cut), fire a big `StrikeFx`
   toward the defender. The finisher keeps playing around the attacker while
   it fades out.
3. Queue rules from D3. The Stage's global controls (`darken`, `flash`,
   `shake`) are owned by whichever finisher is playing. Player effects only
   use per-half grading, so they never fight with it.
4. `preloadVfx` for both players' skills when the duel starts, so trackers
   and baked sculpts (Susanoo, dragons) are ready before the first finisher.

### Phase 6: Polish and performance

- A quality setting (`high` / `low`) that caps particle counts and bloom
  resolution. It picks `low` automatically if the frame rate stays under
  40 fps for 3 s.
- `?fxstats=1` shows fps, render ms and tracking ms.
- Tune every element on a real webcam image, not the fake camera (VFX guide
  §4).

---

## 3. Verification

### 3.1 Acceptance criteria

| ID | Criterion |
|---|---|
| FX1 | The 3D duel renders the live camera at full frame rate. HUD, damage and KO behave exactly as in 2D mode. |
| FX2 | Detection reticles sit on each player's hands, in the right colour. |
| FX3 | With two people, each player's aura and hand effects follow **only that player**, including when they lean up to 20 % across the divider. |
| FX4 | When a player isn't tracked, their effects sit in the centre of **their own half**, never on the divider or the other half. |
| FX5 | Hand charge grows with `hold_progress`, and a landed seal triggers the seal burst on the attacker. |
| FX6 | Strikes travel attacker → defender's body, and HP drops at impact. If animation frames are paused, HP still drops (the timer guard still works). |
| FX7 | A jutsu plays that skill's registry effect around the attacker, compressed to ≤ 3.2 s. Skills with no 3D effect play the generic finisher. Every skill in `data/skills.js` resolves to one or the other. |
| FX8 | Two jutsu at once follow D3 (queued or strike-only), with no stuck state. |
| FX9 | KO greys out the loser's half only, and the winner gets the victory effect. Rematch clears everything. |
| FX10 | Training mode looks and behaves exactly as before (Stage changes are backward compatible). |
| FX11 | Performance: ≥ 45 fps median during a finisher with tracking on, at 1280×720, on this machine. The backend frame stream keeps its 80 ms cadence. |
| FX12 | No WebGL / MediaPipe, or `?fx=2d` → the 2D duel, fully working. No console errors in either mode. |

### 3.2 Automated tests

Add **vitest** (dev dependency) for the frontend's pure logic, run with
`npm test` in `web/` and from `make test`:

- `assignToPlayers`: detections on each side, a lean across the divider with
  hysteresis, the pose-wrist rule for hands, and no detections at all (FX3,
  FX4).
- `splitMask`: the columns kept per side and the feathered seam.
- Scoped view fallbacks: an untracked player gets `seen: true` positions
  inside their own half (FX4).
- `FinisherDirector` timeline: the compression maths, the strike beat at
  1.4 s, and the queue / strike-only rules (D2, D3, FX8), driven by a fake
  clock.
- Coverage: every skill in `SKILLS` and `DEFAULT_SKILLS` maps to a registry
  effect or a `GenericFinisher` element (FX7).

Backend (pytest): `bbox` is present, normalised and mirrored in
`players[i]`, and absent when nothing is detected (FX2).

### 3.3 Duel FX lab (dev-only harness)

`?fxlab=duel` opens the duel screen with no backend. It has a small panel to
fire any event on demand:

- seal for P1 / P2;
- strike (sign / jutsu, with any skill from a dropdown);
- set HP, set `hold_progress`;
- KO P1 / P2 / draw;
- toggle tracking on/off, toggle 2D / 3D.

It works with the fake camera (the effects use their half-centre fallbacks)
or the real webcam. This is where every effect gets checked and tuned, and
where the screenshots for FX4, FX5, FX7 and FX9 come from. It also gives a
deterministic "freeze frame" button, so screenshots don't depend on timing.

### 3.4 Browser checks (with the fake detector + fake camera)

1. A full round in 3D mode. Check the HUD and HP against the server state,
   check there are no console errors, and run the existing layout audit at
   4 sizes (FX1).
2. The same round with animation frames disabled after the fight starts: HP
   still drops and the KO is correct (FX6).
3. `?fx=2d`: the 2D duel works, and simulated WebGL context loss falls back
   to it (FX12).
4. Training-mode regression: cast Rasengan, Chidori and Susanoo in training,
   and compare screenshots before and after the Stage changes (FX10).
5. `?fxstats=1` during back-to-back finishers (FX11).

### 3.5 Real two-player acceptance (final gate)

- [ ] Each aura hugs the right person, and swapping places swaps nothing incorrectly (FX3).
- [ ] One player steps out of frame → their effects wait in their half (FX4).
- [ ] Holding a seal visibly charges the hands, and landing it bursts (FX5).
- [ ] A strike visibly hits the other player's chest, and the bar drops on impact (FX6).
- [ ] Each character's finisher plays around its caster, and the fight keeps going (FX7, D1).
- [ ] Both players finish a jutsu within a second of each other (FX8).
- [ ] KO greys out the loser; Rematch is clean (FX9).
- [ ] The frame rate feels smooth, and `?fxstats=1` shows ≥ 45 fps (FX11).

### 3.6 Definition of done

All of §3.2 is green, every FX criterion has its check, the screenshots from
§3.3 and §3.4 are attached to the PR, and §3.5 is ticked by two real players.

---

## 4. Implementation order

1. Phase 1 (DuelStage, bbox, reticles, fallback) → FX1, FX2, FX10, FX12.
2. Phase 2 (two-person tracking + debug overlay + vitest) → FX3, FX4.
3. FX lab (§3.3). Built early, because the later phases are tuned in it.
4. Phase 3 (player effects) → FX5, FX9.
5. Phase 4 (3D strikes) → FX6.
6. Phase 5 (finishers) → FX7, FX8.
7. Phase 6 (quality, stats, tuning on a real camera) → FX11, then §3.5.

## 5. Risks

- **GPU load.** Bloom, two-person tracking and a full finisher together may
  be heavy. Mitigations: alternate-frame tracking, the quality auto-drop, and
  the 2D fallback. FX11 is measured early (phase 1 and 2), not at the end.
- **Effects that assume one centred person** (Susanoo, summons with an
  occluder) may still read oddly in a half. Each finisher gets checked in
  the FX lab, and any that can't be scoped is mapped to the generic finisher
  until it's adapted.
- **Tracking two people close together** confuses MediaPipe. Hysteresis and
  the pose-wrist rule help. The remaining limitation (players must stay on
  their own side) is the same as for the backend's sign detection.
