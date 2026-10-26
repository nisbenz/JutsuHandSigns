HOLD_TIME = 0.5          # seconds a sign must be held to count
GRACE = 0.6              # seconds the sign can drop out before hold resets


class SignProgress:
    """Hold/grace/advance rules for working through one hand-sign sequence.
    Shared by training (JutsuSession) and duels (PvpMatch) so a sign that
    counts in one counts in the other."""

    def __init__(self, sequence, now):
        self.sequence = list(sequence)
        self.idx = 0
        self.hold = 0.0
        self.misses = 0
        self.last_seen = now

    @property
    def total(self):
        return len(self.sequence)

    @property
    def complete(self):
        return self.idx >= len(self.sequence)

    @property
    def target_sign(self):
        return None if self.complete else self.sequence[self.idx]

    @property
    def hold_progress(self):
        return round(min(1.0, self.hold / HOLD_TIME), 2)

    def update(self, detected_sign, dt, now):
        """Advance hold state for one frame; returns True on the frame a
        sign completes."""
        if self.complete:
            return False
        if detected_sign is not None:
            self.last_seen = now
            if detected_sign == self.target_sign:
                self.hold += dt
            else:
                self.hold = max(0.0, self.hold - dt * 2)
                if self.hold == 0.0:
                    self.misses += 1
            if self.hold >= HOLD_TIME:
                self.idx += 1
                self.hold = 0.0
                return True
        elif now - self.last_seen > GRACE:
            self.hold = 0.0
        return False
