# PvP Duel mode: implementation and verification plan

Two players share **one webcam**. The screen splits down the middle: player 1
on the left, player 2 on the right. Each player has a health bar and their own
hand-sign sequence (the same signs and detector as the main training mode).
Every sign a player holds correctly hits the opponent. The first player to
reach 0 HP loses.

---

## 0. Decisions (defaults, change before coding if needed)

| # | Question | Default in this plan |
|---|----------|----------------------|
| D1 | One shared webcam or two devices? | **One webcam**, frame split into left/right halves. Two devices would need networking/rooms, which is a separate project. |
| D2 | What counts as a hit? | **Each correct sign** = light hit (`SIGN_DAMAGE = 6`). **Finishing the whole sequence** = jutsu hit (`JUTSU_DAMAGE = 20`), then the player gets a new sequence. |
| D3 | Is there a penalty for a wrong sign? | No. A wrong sign only drains your hold gauge, as in the main mode. |
| D4 | HP / time limit | `MAX_HP = 100`, `ROUND_TIME = 90 s`. When time runs out the higher HP wins; equal HP is a draw. |
| D5 | Sequence length | `PVP_SEQUENCE_LENGTH = 3`, which keeps the pace up. |
| D6 | Which jutsu does each player get? | Each player picks a character (the existing `CharacterPicker`) and gets that character's 3 skills from `skills.js`, cycled in order. |
| D7 | 3D cast VFX on jutsu hits? | **Not in v1.** `JutsuCast` is full-screen with one tracker. v1 uses a 2D flash and shake on the victim's half. 3D per half is a stretch goal (§6). |

All numbers live as constants at the top of `backend/game/pvp.py` so they can
be tuned without changing logic.

---

## 1. Prerequisite: fix an existing bug

`backend/game/session.py:115` uses `w`, which is never defined:

```python
x1, x2 = w - x2, w - x1  # NameError
```

Every frame where the detector finds a sign raises `NameError`. The exception
is caught in `main.py`, which sends back `processing_failed`, and the frontend
silently drops it. So **in the current main mode, the HUD freezes whenever a
sign is detected.** Fix: `w = canvas.shape[1]` at the top of `_draw_play_hud`.
PvP draws its boxes the same way, so this has to be fixed first.

---

## 2. Backend

### 2.1 Pull the sign-progress logic out of `JutsuSession`

New file `backend/game/sign_progress.py` with a `SignProgress` class that holds
the hold/grace/advance logic currently inside `JutsuSession.process_frame`:

```python
class SignProgress:
    def __init__(self, sequence): ...
    def update(self, detected_en: str | None, dt: float, now: float) -> bool:
        """Advance hold state; returns True on the frame a sign completes."""
    target_sign, idx, total, hold_progress, misses, complete
```

`JutsuSession` keeps its behavior but uses `SignProgress` internally. Both
modes then share exactly the same rules, so a sign that counts in training also
counts in a duel.

### 2.2 `backend/game/pvp.py`: `PvpMatch`

```python
MAX_HP = 100
SIGN_DAMAGE = 6
JUTSU_DAMAGE = 20
ROUND_TIME = 90.0
COUNTDOWN = 3.0
PVP_SEQUENCE_LENGTH = 3
KO_HOLD = 4.0          # seconds the KO screen stays in stage "ko" before "done"

class PvpMatch:
    def __init__(self, players, detector=None, clock=time.time): ...
    def process_frame(self, frame_bgr) -> (annotated_bgr, state)
```

- **Dependency injection:** `detector` and `clock` can be passed in, so tests
  can script detections and time without a camera, a model, or real waiting.
  By default it creates one `SignDetector()` (one ONNX session, reused for both
  halves).
- **Stages:** `countdown` → `fight` → `ko` → `done`. Signs are ignored during
  `countdown`, `ko` and `done`.
- **Splitting the frame (the tricky part):** the browser shows a *mirrored*
  selfie view, and the backend gets the *raw* frame. The person standing on the
  **left of the screen** is in the **right half of the raw frame**. So:
  - P1 (screen left) = `raw[:, w//2:]`
  - P2 (screen right) = `raw[:, :w//2]`

  Each half is passed to `detector.detect()` on its own. Running two smaller
  inferences, instead of one on the full frame, keeps each player's hands at a
  usable resolution at 416×416 input, and the best detection in a half can
  never belong to the other player.
- **Hits:** when `SignProgress.update` returns True for player A, the defender
  B takes `SIGN_DAMAGE`. If that sign also completed A's sequence, B takes
  `JUTSU_DAMAGE` too, and A moves to the next skill (`sequence_for(skill,
  PVP_SEQUENCE_LENGTH)`). HP is clamped at 0. When HP reaches 0, the stage
  becomes `ko` and the attacker is `winner`.
- **Simultaneous KO** (both reach 0 on the same frame): the result is a draw.
- **Timeout:** at `ROUND_TIME` the stage becomes `ko` and the winner is decided
  by HP (or `"draw"`).
- **Annotated frame:** mirror the canvas (like `JutsuSession`), draw a center
  divider line, and draw each player's detection box mapped back into
  mirrored full-frame coordinates (offset by the half's x origin, then
  mirrored). Green if the box matches that player's target sign, cyan if not.

### 2.3 State payload (backend → frontend)

```jsonc
{
  "stage": "countdown" | "fight" | "ko" | "done",
  "countdown": 2,               // whole seconds, only in "countdown"
  "time_left": 73.4,            // seconds, in "fight"
  "winner": null | 0 | 1 | "draw",
  "players": [
    {
      "hp": 82, "max_hp": 100,
      "character": "naruto-uzumaki",
      "skill": "Rasengan",
      "sequence": ["Ram", "Snake", "Tiger"],
      "idx": 1, "total": 3,
      "target_sign": "Snake",
      "hold_progress": 0.4,
      "detected_sign": "Snake" | null,
      "jutsu_landed": 2
    },
    { /* player 2 */ }
  ],
  "events": [                   // only what happened THIS frame; usually []
    { "type": "hit", "attacker": 0, "defender": 1, "damage": 6, "kind": "sign" },
    { "type": "hit", "attacker": 0, "defender": 1, "damage": 20, "kind": "jutsu", "skill": "Rasengan" },
    { "type": "ko", "winner": 0 }
  ]
}
```

`events` are one-shot, so the frontend can trigger sounds and animations
without having to diff state.

### 2.4 `main.py`: `/ws/pvp`

Same shape as `/ws/jutsu`:

- `{"type":"start","players":[{"character":id,"skills":[...]}, {...}]}` →
  creates a new `PvpMatch` and replies `{"status":"started"}`. Sending `start`
  again during a match acts as **rematch**.
- `{"type":"frame","image":dataUrl}` → `{"status":"frame","image":...,"state":...}`
- Malformed start (not exactly 2 players, or empty skills) →
  `{"status":"error","message":"bad_start"}`.
- Env var `PVP_FAKE_DETECTOR=1` (dev only) swaps in a scripted detector that
  "performs" each player's current target sign after a random 0.5–2 s delay.
  This lets the entire UI loop run in a browser with no real hands (see §4.3).

---

## 3. Frontend

### 3.1 Entry and flow

- New stages in `App.jsx`: `PVP_SETUP` and `PVP`.
- A **"Duel (1v1)"** `Prompt` is added to the camera HUD prompt bar and the
  result screen prompt bar.
- `PVP_SETUP`: "Player 1, choose your shinobi" opens the existing
  `CharacterPicker`, then the same for Player 2, then the duel starts. The
  "Back" button returns to the previous stage.
- `PVP`: renders `<PvpDuel video={videoRef.current} players={[c1, c2]} onExit={...} />`.
  The `<video>` stays mounted (hidden), the same way JUTSU mode does it, so the
  camera stream is never restarted.

### 3.2 Shared frame streaming

Pull the `sendFrame` + interval + WS lifecycle code out of App's jutsu effect
into `web/src/useFrameSocket.js` (`useFrameSocket(url, startMsg, onMessage,
active)`). Both JUTSU and PVP modes use it. This avoids a second copy of
canvas capture code. The interval stays at 80 ms, and JPEG quality drops to
0.75 in PvP, because the backend now runs two inferences per frame.

### 3.3 `web/src/components/PvpDuel.jsx`

Layout (CSS grid, two equal columns over the annotated frame):

```
┌───────────────────────┬───────────────────────┐
│ P1 Naruto  ████████░░ │ ░░██████████ Sasuke P2│  ← HealthBar (anchored at the outer edge, empties from the center line)
│                       │                       │
│     [Snake icon]      │     [Tiger icon]      │  ← target sign (HandSignIcon) + name
│      ● ● ○            │      ● ○ ○            │  ← sequence dots
│     ▓▓▓▓▓░░░ hold     │     ▓░░░░░░░ hold     │  ← chakra gauge
│                       │                       │
│               ⏱ 73   (center divider)         │
└───────────────────────┴───────────────────────┘
```

- `HealthBar.jsx`: Storm-styled, with a fast front bar and a delayed "damage
  trail" bar behind it (fighting-game style). Color goes green → amber (<50) →
  red (<25).
- On a `hit` event: a floating "-6" / "-20 RASENGAN!" on the defender's half,
  plus a shake and red flash on that half (CSS class toggled for 400 ms).
  Sounds: `sfx.seal()` for sign hits, `sfx.taiko()` for jutsu hits.
- Countdown stage: big "3 / 2 / 1 / FIGHT!" medallion in the center.
- KO stage: winner panel ("PLAYER 1 WINS" with character image, or "DRAW"),
  then the prompts **Rematch** (sends `start` again) and **Exit**.
- Phone or narrow widths: the two columns stay side by side (it's a split
  camera), and the HUD scales with `clamp()` font sizes.

---

## 4. Verification

Each acceptance criterion (AC) below is mapped to the check that proves it.

### 4.1 Acceptance criteria

| ID | Criterion |
|----|-----------|
| AC1 | Holding the correct sign for `HOLD_TIME` in your half reduces the *opponent's* HP by `SIGN_DAMAGE`, and your own HP is unchanged. |
| AC2 | Finishing a sequence deals `SIGN_DAMAGE + JUTSU_DAMAGE` and gives that player the next skill's sequence. |
| AC3 | A sign shown in P1's half never advances P2, and the reverse is also true (half isolation, mirror mapping correct). |
| AC4 | HP never drops below 0. Reaching 0 → `ko`, and the correct `winner` is set. |
| AC5 | Both reaching 0 on the same frame → `winner == "draw"`. |
| AC6 | Timeout → the higher HP wins, equal HP → draw. |
| AC7 | Signs during `countdown`, `ko` and `done` do nothing. |
| AC8 | Wrong sign / no sign never deals damage. Grace and hold-decay rules behave exactly as in training mode. |
| AC9 | `/ws/pvp` start, frame and rematch work. A bad start returns `bad_start`, and the socket stays open after a bad frame. |
| AC10 | Main training mode still works, and the `w` NameError is gone. |
| AC11 | UI: split view with the live camera, two health bars, per-player target sign, hit feedback, countdown, KO screen, rematch and exit. |
| AC12 | Performance: in PvP the backend keeps up with 80 ms frames on CPU (median `process_frame` ≤ 60 ms). |

### 4.2 Automated backend tests: `backend/tests/` (pytest, no camera, no model)

Add `pytest` to `backend/requirements.txt` and a `make test` target that runs
`cd backend && ../.venv/bin/pytest -q`.

Helpers: `FakeClock` (manual `advance(dt)`), and `ScriptedDetector`, which
returns a given sign depending on *which half* it was called with. It tells
the halves apart by painting each half of a dummy frame a distinct solid color
and checking the crop's mean color, so the test also proves the crop
coordinates.

`test_sign_progress.py`
- hold → completes exactly at `HOLD_TIME`. Wrong sign decays at 2× speed.
  Grace gap < `GRACE` keeps the hold, and a longer gap resets it. (AC8)
- `JutsuSession` behaves the same before and after the refactor (same
  sequence of `idx` values for a scripted run). (AC10)

`test_jutsu_session.py`
- `process_frame` with a detection present returns no exception, and the bbox
  is mirrored correctly (box at raw x=[10,50] on a 640-wide frame → drawn at
  [590,630]). (AC10)

`test_pvp.py`
- `test_sign_hit_damages_opponent_only`: P1 holds target → P2 hp 94, P1 hp
  100, one `hit` event. (AC1)
- `test_full_sequence_jutsu_bonus`: P1 completes 3 signs → P2 hp = 100 − 3×6 −
  20 = 62. The `skill` moves to skill #2 and the sequence changes. (AC2)
- `test_halves_isolated_and_mirrored`: the detector reports P1's sign only in
  the **raw right half** → only P1 advances. Swap → only P2 advances. (AC3)
- `test_ko_and_clamp`: set P2 hp to 4 and land a sign → hp 0 (not −2),
  `stage == "ko"`, `winner == 0`, `ko` event emitted once. (AC4)
- `test_double_ko_is_draw`. (AC5)
- `test_timeout_winner` and `test_timeout_draw`. (AC6)
- `test_no_damage_outside_fight`: signs held during countdown or after KO do
  not change HP. (AC7)
- `test_wrong_sign_no_damage`. (AC8)
- `test_state_schema`: every key in §2.3 is present with the right type, for
  every stage.

`test_ws_pvp.py` (FastAPI `TestClient`, `PvpMatch` detector monkeypatched)
- start → `started`, frame → `frame` with `state.players` of length 2. (AC9)
- start with 1 player → `bad_start`. Garbage image → `bad_image`, and the next
  valid frame still works. (AC9)
- second `start` resets HP to 100 (rematch). (AC9)

### 4.3 Real-model smoke test: `tools/pvp_smoke.py`

Covers what the fakes can't: the real YOLOX detector combined with the real
crop and mirror math.

1. Build one 1280×720 frame by placing hand-sign photo A on the raw **right**
   half and photo B on the raw **left** half. The photos come from
   `web/public/hand-signs/*.jpg`.
2. Run a real `PvpMatch` on it for 1 s of fake-clock frames, with P1's target
   forced to A and P2's to B.
3. Assert P1 detected A, P2 detected B, and both dealt a hit (AC3 with the
   real model). Print the median and p95 `process_frame` time (AC12).

If the reference photos are too stylized for the model to detect, the script
falls back to frames captured from the webcam with `--capture`. This is
written down so it isn't mistaken for a pass.

### 4.4 Frontend checks

1. `cd web && npm run lint && npm run build`: no errors.
2. **Browser run with no real players.** Start the backend with
   `PVP_FAKE_DETECTOR=1` and the frontend with `?fakecam=1`. That dev-only flag
   swaps `getUserMedia` for a `canvas.captureStream()` test pattern, so it works
   in a browser with no webcam. Then drive the app in the browser pane:
   - Duel → pick P1 → pick P2 → countdown 3-2-1 → fight. Screenshot.
   - Watch HP drop on both sides over time. Read the DOM health-bar widths and
     check they match `state.players[i].hp`. Screenshot showing a floating
     damage number. (AC11)
   - Wait for KO → winner panel → Rematch → HP back to 100 → Exit → back to
     the previous screen. (AC11, AC9)
   - Check the console for errors, and check the network panel for WS
     reconnect storms.
   - Resize to mobile (375 px) and check there is no horizontal scroll and the
     HUD is readable. (AC11)
3. Regression: the normal flow (scan → result → Train → sign HUD updates)
   still works with the fake camera. (AC10)

### 4.5 Manual acceptance, two real people (final gate)

Run `make run`, with two players standing shoulder to shoulder about 1.5 m from
the camera.

- [ ] Each player sees their own target sign on *their* side of the screen.
- [ ] P1 forms the correct sign → P2's bar drops, and P1's doesn't. Repeat for P2. (AC1, AC3)
- [ ] P1 forms *P2's* target sign in P1's own half → nothing happens to P2's progress. (AC3)
- [ ] Finish a full sequence → big hit + "RASENGAN!" style callout + taiko. (AC2)
- [ ] Play to KO → correct winner shown. Rematch works. (AC4, AC11)
- [ ] One player leans across the center line → write down what happens. This
      is a known limitation; there is no player tracking, only halves.
- [ ] Main training mode: sign HUD updates live while signing. (AC10)

### 4.6 Definition of done

All of §4.2 green, §4.3 passes (or its fallback is documented), §4.4 has
screenshots of the countdown, fight, hit, KO and mobile views, and §4.5 is
ticked by a human.

---

## 5. Implementation order (each step ends in a passing check)

1. Fix the `w` bug + `test_jutsu_session.py`. → §4.2 subset green.
2. `SignProgress` refactor + `test_sign_progress.py`. Training mode unchanged.
3. `PvpMatch` + `test_pvp.py`.
4. `/ws/pvp` + fake detector + `test_ws_pvp.py`.
5. `tools/pvp_smoke.py` with the real model. → §4.3.
6. `useFrameSocket` refactor (JUTSU mode regression-checked in the browser).
7. `HealthBar`, `PvpDuel`, setup flow, `?fakecam`. → §4.4.
8. Polish: sounds, hit animations, KO screen, mobile. → §4.5 with real people.

## 6. Out of scope / stretch

- 3D jutsu VFX in the victim's half (needs `Stage`/`Tracker` to render into
  half-width viewports).
- Blocking/defense signs, combos, special meter.
- Two devices over the network (rooms, latency, sync).
- Per-player tracking instead of fixed halves.
