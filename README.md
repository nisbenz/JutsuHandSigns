# Jutsu Hand Signs

A Naruto-inspired webcam game: choose your ninja and difficulty, then perform
real hand-sign sequences tracked with [MediaPipe](https://developers.google.com/mediapipe).
Complete the sequence and your jutsu erupts on your hand — a swirling
**Rasengan** or crackling **Chidori** — drawn with a pseudo-3D additive
particle engine in OpenCV.

## Run

```bash
pip install -r requirements.txt
python main.py
```

A webcam is required. Open your hand near the camera so the tracker locks on.

### With Docker

```bash
docker compose up --build
```

Then open <http://localhost:5177>. The backend listens on port 8000; if either
port is taken, override it, e.g. `BACKEND_PORT=8002 FRONTEND_PORT=5180 docker compose up --build`.
The webcam is used by the browser, so no device needs to be passed to the containers.

## Controls

| Key                | Action                          |
| ------------------ | ------------------------------- |
| `1` / `2`          | choose Naruto / Sasuke          |
| `1` / `2` / `3`    | choose Easy / Medium / Hard     |
| `Enter` / `Space`  | confirm selection               |
| `H`                | toggle hint pictograms (in game)|
| `V`                | toggle hand skeleton overlay    |
| `R`                | retry                           |
| `M`                | back to menu                    |
| `ESC` / `Q`        | quit                            |

## Signs

In-game display name -> pose you must make with **one hand**:

| Sign   | Pose                          |
| ------ | ----------------------------- |
| MONKEY | fist                          |
| TIGER  | open palm                     |
| OX     | index finger only             |
| RAM    | two fingers (index + middle)  |
| BIRD   | three fingers                 |
| HARE   | thumbs up                     |
| SNAKE  | pinky only ("hook")           |

Hold each sign for the difficulty's hold time while it's highlighted.
Hard mode hides the pose pictures — you only see sign names.

## Project layout

```
main.py              entry point / game loop
src/
  camera.py          webcam capture + mirroring
  hand_tracker.py    MediaPipe Hands wrapper (palm anchor, hand scale)
  signs.py           rule-based pose classifier from landmarks
  jutsus.py          characters, jutsu sequences, difficulties
  game.py            state machine + gameplay logic
  ui.py              menus, HUD, pose pictograms
  effects/
    engine.py        additive glow, perspective projection, particles
    rasengan.py      swirling 3D-ish chakra orb
    chidori.py       flickering lightning bolts + sparks
tools/
  selftest.py        headless checks (classifier, game flow, effects)
```

## PvP duel (1v1, web app)

Two players share one webcam: player 1 stands on the left half of the screen,
player 2 on the right. Pick **Duel (1v1)**, choose a shinobi for each player,
then form your seals. Every seal you land costs your opponent 6 HP, and
finishing a whole jutsu sequence deals a 20 HP bonus hit. First to 0 HP loses,
and when the 90 s timer runs out the higher HP wins. Design and acceptance
checks are in [docs/pvp-plan.md](docs/pvp-plan.md).

Try it without a camera or players (dev only): start the backend with
`PVP_FAKE_DETECTOR=1`, which "performs" each player's seals automatically, and
open the frontend with `?fakecam=1`, which uses a generated video stream
instead of the webcam.

### 3D duel effects

The duel draws the camera in 3D (Three.js + MediaPipe, see
[docs/pvp-3d-fx-plan.md](docs/pvp-3d-fx-plan.md)). Each player gets:
- a chakra aura in their character's colour;
- hands that charge while a seal is held, and a kanji burst when it lands;
- strikes that fly into the opponent's body;
- the technique's own 3D cast as a finisher when they complete a jutsu.

URL flags:

| Flag | Effect |
| --- | --- |
| `?fx=2d` | 2D duel (also used automatically if WebGL fails) |
| `?fxquality=low` / `high` | force a quality level (default: auto) |
| `?fxstats=1` | fps / render / tracking times |
| `?fxdebug=1` | each player's tracked joints and hands |
| `?fxlab=duel` | dev-only FX lab: fire any duel event on demand, no backend needed |
| `?fakecam=chars` | dev-only fake camera with two character pictures, for the trackers |

```bash
make test                          # backend + frontend tests, no camera/model needed
.venv/bin/python tools/pvp_smoke.py  # real detector on two sign photos side by side
```

## Testing

```bash
python tools/selftest.py
```

Runs without a camera: classifies synthetic hand poses, plays a full jutsu
sequence through the game logic, and renders both effects into a dummy frame.
