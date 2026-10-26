import pytest

from conftest import HalfDetector
from game.pvp import (COUNTDOWN, JUTSU_DAMAGE, KO_HOLD, MAX_HP, PVP_SEQUENCE_LENGTH,
                      ROUND_TIME, SIGN_DAMAGE, FakeDuelDetector, PvpMatch)
from game.sign_progress import HOLD_TIME

DT = 0.0625
PLAYERS = [
    {"character": "naruto", "skills": ["Rasengan", "Shadow Clone Jutsu"]},
    {"character": "sasuke-uchiha", "skills": ["Chidori", "Susanoo"]},
]
# Player 1 stands on the LEFT of the mirrored screen = RIGHT half of the raw frame.
HALF_OF = {0: "raw_right", 1: "raw_left"}


@pytest.fixture
def det():
    return HalfDetector()


@pytest.fixture
def match(det, clock):
    return PvpMatch(PLAYERS, detector=det, clock=clock)


def step(match, frame, clock, seconds=DT):
    states = []
    for _ in range(max(1, round(seconds / DT))):
        clock.advance(DT)
        states.append(match.process_frame(frame)[1])
    return states


def events(states):
    return [e for s in states for e in s["events"]]


def start_fight(match, frame, clock):
    step(match, frame, clock, COUNTDOWN)
    assert match.stage == "fight"


def land_signs(match, det, frame, clock, player, n):
    """Have `player` hold their current target until `n` signs have landed."""
    states = []
    for _ in range(n):
        det.signs[HALF_OF[player]] = match.players[player].progress.target_sign
        states += step(match, frame, clock, HOLD_TIME)
        det.signs[HALF_OF[player]] = None
    return states


def test_countdown_then_fight(match, painted_frame, clock):
    states = step(match, painted_frame, clock, COUNTDOWN - DT)
    assert {s["stage"] for s in states} == {"countdown"}
    assert [s["countdown"] for s in states][0] == 3 and states[-1]["countdown"] == 1
    states = step(match, painted_frame, clock)
    assert states[0]["stage"] == "fight" and states[0]["time_left"] == ROUND_TIME


def test_sign_hit_damages_opponent_only(match, det, painted_frame, clock):
    start_fight(match, painted_frame, clock)
    states = land_signs(match, det, painted_frame, clock, 0, 1)
    p1, p2 = states[-1]["players"]
    assert p1["hp"] == MAX_HP and p2["hp"] == MAX_HP - SIGN_DAMAGE
    assert events(states) == [{"type": "hit", "attacker": 0, "defender": 1,
                               "damage": SIGN_DAMAGE, "kind": "sign"}]
    assert p1["idx"] == 1


def test_player_two_hits_player_one(match, det, painted_frame, clock):
    start_fight(match, painted_frame, clock)
    states = land_signs(match, det, painted_frame, clock, 1, 1)
    p1, p2 = states[-1]["players"]
    assert p1["hp"] == MAX_HP - SIGN_DAMAGE and p2["hp"] == MAX_HP


def test_full_sequence_jutsu_bonus(match, det, painted_frame, clock):
    start_fight(match, painted_frame, clock)
    first_seq = match.players[0].progress.sequence
    states = land_signs(match, det, painted_frame, clock, 0, PVP_SEQUENCE_LENGTH)
    p1, p2 = states[-1]["players"]
    assert p2["hp"] == MAX_HP - PVP_SEQUENCE_LENGTH * SIGN_DAMAGE - JUTSU_DAMAGE
    jutsu = [e for e in events(states) if e["kind"] == "jutsu"]
    assert jutsu == [{"type": "hit", "attacker": 0, "defender": 1,
                      "damage": JUTSU_DAMAGE, "kind": "jutsu", "skill": "Rasengan"}]
    assert p1["skill"] == "Shadow Clone Jutsu" and p1["idx"] == 0
    assert p1["jutsu_landed"] == 1
    assert p1["sequence"] != first_seq


def test_skills_cycle(match, det, painted_frame, clock):
    start_fight(match, painted_frame, clock)
    land_signs(match, det, painted_frame, clock, 0, 2 * PVP_SEQUENCE_LENGTH)
    assert match.players[0].skill == "Rasengan"


def test_halves_isolated_and_mirrored(match, det, painted_frame, clock):
    start_fight(match, painted_frame, clock)
    # Player 1's target shown in the raw LEFT half (= player 2's side) does nothing for P1.
    det.signs["raw_left"] = match.players[0].progress.target_sign
    det.signs["raw_right"] = None
    if det.signs["raw_left"] == match.players[1].progress.target_sign:
        pytest.skip("both players share a first target")
    step(match, painted_frame, clock, 2.0)
    assert match.players[0].progress.idx == 0
    assert match.players[0].detected is None
    # Each crop is exactly one half of the frame.
    assert {shape for _half, shape in det.calls} == {(360, 320, 3)}


def test_ko_and_clamp(match, det, painted_frame, clock):
    start_fight(match, painted_frame, clock)
    match.players[1].hp = 4
    states = land_signs(match, det, painted_frame, clock, 0, 1)
    final = states[-1]
    assert final["players"][1]["hp"] == 0
    assert final["stage"] == "ko" and final["winner"] == 0
    assert [e for e in events(states) if e["type"] == "ko"] == [{"type": "ko", "winner": 0}]
    states = step(match, painted_frame, clock, KO_HOLD)
    assert not [e for e in events(states) if e["type"] == "ko"]
    assert states[-1]["stage"] == "done" and states[-1]["winner"] == 0


def test_double_ko_is_draw(match, det, painted_frame, clock):
    start_fight(match, painted_frame, clock)
    match.players[0].hp = match.players[1].hp = SIGN_DAMAGE
    det.signs["raw_right"] = match.players[0].progress.target_sign
    det.signs["raw_left"] = match.players[1].progress.target_sign
    states = step(match, painted_frame, clock, HOLD_TIME)
    assert states[-1]["stage"] == "ko" and states[-1]["winner"] == "draw"
    assert [p["hp"] for p in states[-1]["players"]] == [0, 0]


def test_timeout_winner(match, det, painted_frame, clock):
    start_fight(match, painted_frame, clock)
    land_signs(match, det, painted_frame, clock, 1, 1)
    states = step(match, painted_frame, clock, ROUND_TIME)
    assert states[-1]["stage"] == "ko" and states[-1]["winner"] == 1


def test_timeout_draw(match, painted_frame, clock):
    start_fight(match, painted_frame, clock)
    states = step(match, painted_frame, clock, ROUND_TIME)
    assert states[-1]["stage"] == "ko" and states[-1]["winner"] == "draw"


def test_no_damage_outside_fight(match, det, painted_frame, clock):
    det.signs["raw_right"] = match.players[0].progress.target_sign
    det.signs["raw_left"] = match.players[1].progress.target_sign
    step(match, painted_frame, clock, COUNTDOWN - DT)
    assert [p.hp for p in match.players] == [MAX_HP, MAX_HP]
    assert det.calls == []  # detector doesn't even run before the fight

    match.players[1].hp = 1
    step(match, painted_frame, clock, 2 * HOLD_TIME)
    assert match.stage == "ko"
    hp_at_ko = [p.hp for p in match.players]
    step(match, painted_frame, clock, KO_HOLD + 2.0)
    assert [p.hp for p in match.players] == hp_at_ko


def test_wrong_sign_no_damage(match, det, painted_frame, clock):
    start_fight(match, painted_frame, clock)
    wrong = next(s for s in ["Rat", "Ox", "Tiger"] if s != match.players[0].progress.target_sign)
    det.signs["raw_right"] = wrong
    states = step(match, painted_frame, clock, 3.0)
    assert match.players[1].hp == MAX_HP and not events(states)
    assert states[-1]["players"][0]["detected_sign"] == wrong


def test_bbox_is_mirrored_and_normalised(match, det, painted_frame, clock):
    start_fight(match, painted_frame, clock)
    # HalfDetector boxes are (10, 10, 50, 50) in crop pixels; the frame is 640x360.
    det.signs["raw_right"] = "Rat"  # player 1's crop starts at raw x=320
    det.signs["raw_left"] = "Ox"    # player 2's crop starts at raw x=0
    state = step(match, painted_frame, clock)[-1]
    p1, p2 = state["players"]
    # P1: raw x 330..370 -> mirrored 270..310 -> left half of the screen.
    assert p1["bbox"] == [round(270 / 640, 4), round(10 / 360, 4), round(310 / 640, 4), round(50 / 360, 4)]
    # P2: raw x 10..50 -> mirrored 590..630 -> right half of the screen.
    assert p2["bbox"] == [round(590 / 640, 4), round(10 / 360, 4), round(630 / 640, 4), round(50 / 360, 4)]
    det.signs["raw_right"] = det.signs["raw_left"] = None
    state = step(match, painted_frame, clock)[-1]
    assert [p["bbox"] for p in state["players"]] == [None, None]


def test_no_bbox_outside_fight(match, det, painted_frame, clock):
    det.signs["raw_right"] = "Rat"
    state = step(match, painted_frame, clock)[-1]
    assert state["stage"] == "countdown" and state["players"][0]["bbox"] is None


PLAYER_KEYS = {"hp": int, "max_hp": int, "character": str, "skill": str, "sequence": list,
               "idx": int, "total": int, "hold_progress": float, "jutsu_landed": int}


def test_state_schema(match, det, painted_frame, clock):
    seen = set()
    match.players[1].hp = SIGN_DAMAGE
    det.signs["raw_right"] = None
    for _ in range(int((COUNTDOWN + HOLD_TIME + KO_HOLD + 2) / DT)):
        det.signs["raw_right"] = match.players[0].progress.target_sign
        clock.advance(DT)
        canvas, state = match.process_frame(painted_frame)
        seen.add(state["stage"])
        assert canvas.shape == painted_frame.shape
        assert set(state) >= {"stage", "winner", "players", "events"}
        assert ("countdown" in state) == (state["stage"] == "countdown")
        assert ("time_left" in state) == (state["stage"] == "fight")
        assert len(state["players"]) == 2
        for p in state["players"]:
            for key, typ in PLAYER_KEYS.items():
                assert isinstance(p[key], typ), (key, p[key])
            assert "target_sign" in p and "detected_sign" in p and "bbox" in p
    assert seen == {"countdown", "fight", "ko", "done"}


def test_fake_detector_plays_a_whole_match(clock, painted_frame):
    import random
    m = PvpMatch(PLAYERS, detector=FakeDuelDetector(clock=clock, rng=random.Random(1)), clock=clock)
    for _ in range(int((COUNTDOWN + ROUND_TIME + KO_HOLD + 1) / DT)):
        clock.advance(DT)
        m.process_frame(painted_frame)
    assert m.stage == "done"
    assert any(p.hp < MAX_HP for p in m.players)
