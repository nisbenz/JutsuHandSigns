from game.sign_progress import GRACE, HOLD_TIME, SignProgress

DT = 0.0625  # exact in binary, so hold sums land exactly on HOLD_TIME


def run(progress, sign, seconds, clock):
    completed = 0
    for _ in range(round(seconds / DT)):
        clock.advance(DT)
        completed += progress.update(sign, DT, clock())
    return completed


def test_hold_completes_at_hold_time(clock):
    p = SignProgress(["Rat", "Ox"], clock())
    assert run(p, "Rat", HOLD_TIME - DT, clock) == 0
    assert p.idx == 0
    assert run(p, "Rat", DT, clock) == 1
    assert p.idx == 1 and p.hold == 0.0 and p.target_sign == "Ox"


def test_wrong_sign_decays_twice_as_fast(clock):
    p = SignProgress(["Rat"], clock())
    run(p, "Rat", 0.375, clock)
    run(p, "Ox", 0.125, clock)
    assert p.hold == 0.125


def test_wrong_sign_at_zero_hold_counts_misses(clock):
    p = SignProgress(["Rat"], clock())
    run(p, "Ox", 3 * DT, clock)
    assert p.misses == 3


def test_short_dropout_keeps_hold(clock):
    p = SignProgress(["Rat"], clock())
    run(p, "Rat", 0.3, clock)
    run(p, None, GRACE - 0.1, clock)
    assert p.hold > 0
    assert run(p, "Rat", 0.25, clock) == 1


def test_long_dropout_resets_hold(clock):
    p = SignProgress(["Rat"], clock())
    run(p, "Rat", 0.3, clock)
    run(p, None, GRACE + 0.1, clock)
    assert p.hold == 0.0


def test_complete_sequence_stops_advancing(clock):
    p = SignProgress(["Rat"], clock())
    assert run(p, "Rat", 2.0, clock) == 1
    assert p.complete and p.target_sign is None
