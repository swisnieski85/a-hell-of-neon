#!/usr/bin/env python3
"""Playthrough simulator for the Day 2-5 slot system.

Run from the repo root:  python tools/simulate-paths.py

Drives the four canonical paths (Redemption / Quietism / Tragedy / Nihilism)
through the REAL data files — maps.yaml pin gating, day/slot semantics,
the Rose chain in rose-thread.yaml, and the endgame redirect — and asserts
each lands on the right ending. A gating tweak that breaks reachability
fails here before anyone plays it.
"""
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("PyYAML required: pip install pyyaml")

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"


def load(p):
    with open(p, encoding="utf-8") as f:
        return yaml.safe_load(f)


MAPS = load(CONTENT / "maps.yaml")
MANIFEST = load(CONTENT / "manifest.yaml")["vignettes"]
VIGNS = {f: load(CONTENT / "vignettes" / f) for f in MANIFEST}
ROSE = next(n for n in VIGNS["rose-thread.yaml"]["nodes"] if n["id"] == "rose_next")
ROSE_NODES = {n["id"]: n for n in VIGNS["rose-thread.yaml"]["nodes"]}


class Sim:
    def __init__(self, name):
        self.name = name
        self.day = 0
        self.slots_used = 0
        self.slot_budget = 0
        self.flags = {}
        self.flag_days = {}

    # mirror js/conditions.js
    def cond(self, c):
        if c is None:
            return True
        if isinstance(c, str):
            if c == "lenses_on":
                return True  # irrelevant to path logic
            if c == "slots_exhausted":
                return self.slots_used >= self.slot_budget
            return bool(self.flags.get(c))
        if isinstance(c, list):
            return all(self.cond(x) for x in c)
        if "all" in c:
            return all(self.cond(x) for x in c["all"])
        if "any" in c:
            return any(self.cond(x) for x in c["any"])
        if "not" in c:
            return not self.cond(c["not"])
        if "day_is" in c:
            return self.day == c["day_is"]
        if "day_at_least" in c:
            return self.day >= c["day_at_least"]
        if "day_after" in c:
            d = self.flag_days.get(c["day_after"])
            return d is not None and self.day > d
        raise ValueError(f"bad cond {c}")

    def set_flag(self, k, v=True):
        self.flags[k] = v
        if v and not k.startswith("_") and k not in self.flag_days:
            self.flag_days[k] = self.day

    def enter(self, file):
        v = VIGNS[file]
        if isinstance(v.get("day"), int) and v["day"] != self.day:
            self.day = v["day"]
            self.slots_used = 0
            # entering a vignette wipes underscore-local flags
        for k in [k for k in self.flags if k.startswith("_")]:
            del self.flags[k]
        if isinstance(v.get("slot_budget"), int):
            self.slot_budget = v["slot_budget"]
        if v.get("slot"):
            self.slots_used += 1
        # "Complete" the vignette: apply the sets of every non-death choice.
        # (Approximation: assumes the player touches everything — correct for
        # the current content, where every persistent flag in a vignette is
        # either exit-borne or on a mandatory-to-progress node like the
        # bookend handhelds. Rose beats are NOT here — they live in the
        # fragment and fire only via rose_window().)
        for n in v.get("nodes") or []:
            for c in n.get("choices") or []:
                if "set" in c and not c.get("death"):
                    for k, val in c["set"].items():
                        self.set_flag(k, val)

    def pins(self):
        return [p["id"] for p in MAPS["day_map"]["pins"]
                if self.cond(p.get("requires"))]

    def pick(self, pin_id):
        pin = next(p for p in MAPS["day_map"]["pins"] if p["id"] == pin_id)
        assert self.cond(pin.get("requires")), \
            f"[{self.name}] pin '{pin_id}' not available on day {self.day}; " \
            f"visible: {self.pins()}"
        self.enter(pin["goto_vignette"])

    def rose_window(self, choice=None):
        """Open the Rose window once: route rose_next, apply the beat's sets."""
        assert self.flags.get("rose_living_with_brand"), "Rose isn't home"
        assert not self.flags.get("_rose_window_spent"), "window already spent"
        entry = next((e for e in ROSE["branch"] if self.cond(e.get("requires"))), None)
        assert entry, f"[{self.name}] rose_next: no branch entry matched"
        # Walk the beat. A node whose choices goto other Rose nodes is a fork
        # (Beat 4: Tell her / Say nothing): take the choice labelled `choice`,
        # or the first one if none is given. Otherwise apply every choice's sets.
        node = ROSE_NODES[entry["goto"]]
        while node:
            cs = node.get("choices") or []
            forks = [c for c in cs if c.get("goto") in ROSE_NODES]
            if forks:
                c = next((c for c in forks if c["label"] == choice), None) \
                    if choice else forks[0]
                assert c, f"[{self.name}] {node['id']}: no choice '{choice}'"
                taken, node = [c], ROSE_NODES[c["goto"]]
            else:
                taken, node = cs, None
            for c in taken:
                for k, val in (c.get("set") or {}).items():
                    self.set_flag(k, val)
        return entry["goto"]

    def redirect(self):
        for r in MAPS["day_map"].get("redirect") or []:
            if self.cond(r.get("requires")):
                return r["goto_vignette"]
        return None


def day2(s, rose_first=False):
    s.enter("bookend-d2-dawn.yaml")
    assert set(s.pins()) == {"autopsy1", "rose1"}, \
        f"[{s.name}] day 2 should offer Wash AND Rose; visible: {s.pins()}"
    order = ["rose1", "autopsy1"] if rose_first else ["autopsy1", "rose1"]
    s.pick(order[0])
    assert s.pins() == [order[1]], \
        f"[{s.name}] day 2 second slot should offer only {order[1]}; " \
        f"visible: {s.pins()}"
    s.pick(order[1])
    assert s.pins() == ["home_d2"], \
        f"[{s.name}] day 2 spent: only the home pin should remain; " \
        f"visible: {s.pins()}"
    s.enter("bookend-d2-night.yaml")
    assert s.rose_window() == "rose_beat2a"         # mandatory, gates sleep


def pick(s, pin):
    """A plan entry is a pin id, or (pin id, [flags]) for a vignette where the
    player misses the clue that sets those flags (Sim.enter assumes every
    choice is taken, so they're unset again)."""
    if isinstance(pin, tuple):
        pin, missed = pin
        s.pick(pin)
        for f in missed:
            s.flags.pop(f, None)
            s.flag_days.pop(f, None)
    else:
        s.pick(pin)


def run(name, plan, want_ending, rose_beats, rose_first=False, want_confessed=None):
    """plan: {3: [pins], 4: [pins], 5: [pin]}; rose_beats: window -> beat id,
    or window -> (beat id, choice label) to take a fork inside the beat."""
    s = Sim(name)
    day2(s, rose_first)

    def window(w):
        if w not in rose_beats:
            return
        spec = rose_beats[w]
        want, choice = (spec, None) if isinstance(spec, str) else spec
        got = s.rose_window(choice)
        assert got == want, f"[{name}] {w}: got {got}, wanted {want}"

    window("d2-night")                              # 2b shares the window

    for day, bookend, night in ((3, "bookend-d3-dawn.yaml", "bookend-d3-night.yaml"),
                                (4, "bookend-d4-dawn.yaml", "bookend-d4-night.yaml")):
        s.enter(bookend)
        window(f"d{day}-dawn")
        for pin in plan[day]:
            pick(s, pin)
        assert s.redirect() is None, f"[{name}] premature endgame on day {day}"
        s.enter(night)
        window(f"d{day}-night")

    s.enter("bookend-d5-dawn.yaml")
    window("d5-dawn")
    for pin in plan[5]:
        pick(s, pin)
    got = s.redirect()
    assert got == want_ending, f"[{name}] ended at {got}, wanted {want_ending}"
    confessed = bool(s.flags.get("confessed"))
    if want_confessed is not None:
        assert confessed == want_confessed, \
            f"[{name}] confessed={confessed}, wanted {want_confessed}"
    print(f"  OK  {name:<28} -> {want_ending}  (confessed={confessed})")
    return s


# --- The four canonical paths -------------------------------------------
# Redemption: full spine + Car; full Rose chain, confession on Day 4 night,
# aftermath Day 5 dawn. Free picks: Car + both Shred beats.
run("Redemption (Car+Shred)",
    {3: ["autopsy2", "shred1"], 4: ["autopsy3", "shred2"], 5: ["corporate_car"]},
    "90-finale-server-room.yaml",
    {"d2-night": "rose_beat2b", "d3-dawn": "rose_beat3",
     "d4-dawn": "rose_filler", "d4-night": "rose_beat4",
     "d5-dawn": "rose_aftermath"})

# Quietism: same case, Rose ignored after the mandatory 2a. Also exercises
# the Rose-first Day 2 order (collect her before seeing Wash).
run("Quietism (Heavy split)",
    {3: ["autopsy2", "heavy1"], 4: ["autopsy3", "heavy2"], 5: ["shred1"]},
    "90-finale-server-room.yaml",
    {}, rose_first=True)

# Tragedy: full spine + confession, but only HALF of Heavy — never qualifies.
run("Tragedy (Shred2+Heavy1)",
    {3: ["autopsy2", "shred1"], 4: ["autopsy3", "heavy1"], 5: ["shred2"]},
    "91-ending-tragedy.yaml",
    {"d2-night": "rose_beat2b", "d3-dawn": "rose_beat3",
     "d4-dawn": "rose_filler", "d4-night": "rose_beat4"})

# Nihilism: never touches the Autopsy spine past the forced beat; no Rose.
run("Nihilism (no spine)",
    {3: ["corporate_car", "heavy1"], 4: ["heavy2", "shred1"], 5: ["shred2"]},
    "92-ending-nihilism.yaml",
    {})

# Late-chain stress: 2b declined on Day 2 night, the Day 4 night window
# declined too — beats still chain in order and the confession lands in the
# last window (Day 5 dawn, no aftermath: the airless version).
run("Redemption (late Rose)",
    {3: ["autopsy2", "corporate_car"], 4: ["autopsy3", "shred1"], 5: ["shred2"]},
    "90-finale-server-room.yaml",
    {"d3-dawn": "rose_beat2b", "d4-dawn": "rose_beat3",
     "d5-dawn": "rose_beat4"})

# Confession declined (addendum §9): the full Rose chain, then "Say nothing"
# at Beat 4 on Day 4 night. The column closes for good: Day 5 dawn routes to
# rose_closed, not Beat 4, and the finale plays as Quietism.
run("Quietism (said nothing)",
    {3: ["autopsy2", "shred1"], 4: ["autopsy3", "shred2"], 5: ["corporate_car"]},
    "90-finale-server-room.yaml",
    {"d2-night": "rose_beat2b", "d3-dawn": "rose_beat3",
     "d4-dawn": "rose_filler", "d4-night": ("rose_beat4", "Say nothing"),
     "d5-dawn": "rose_closed"},
    want_confessed=False)

# Heavy first: both Heavy beats on Day 3, then Autopsy 2 and 3 back to back
# on Day 4. Before A2/A3 could share a day, this pushed A3 to Day 5 and the
# confession was never offered.
run("Redemption (Heavy first)",
    {3: ["heavy1", "heavy2"], 4: ["autopsy2", "autopsy3"], 5: ["shred1"]},
    "90-finale-server-room.yaml",
    {"d2-night": "rose_beat2b", "d3-dawn": "rose_beat3",
     "d4-dawn": "rose_filler", "d4-night": "rose_beat4",
     "d5-dawn": "rose_aftermath"},
    want_confessed=True)

# Autopsy 3 left for Day 5. The confession waits on meeting Droz, so every
# Rose window after Beat 3 plays the filler, and the finale is Quietism.
run("Quietism (A3 on Day 5)",
    {3: ["autopsy2", "corporate_car"], 4: ["heavy1", "heavy2"], 5: ["autopsy3"]},
    "90-finale-server-room.yaml",
    {"d2-night": "rose_beat2b", "d3-dawn": "rose_beat3",
     "d4-dawn": "rose_filler", "d4-night": "rose_filler",
     "d5-dawn": "rose_filler"},
    want_confessed=False)

# Heavy 1 without the seasickness pills: Frenk's sweep is city-wide and lands
# overnight, so Heavy 2 opens the next day instead of the same one.
run("Quietism (Heavy, missed pills)",
    {3: ["autopsy2", ("heavy1", ["heavy_located"])], 4: ["autopsy3", "heavy2"],
     5: ["shred1"]},
    "90-finale-server-room.yaml",
    {})

s = Sim("Heavy 2 waits a day")
day2(s)
s.enter("bookend-d3-dawn.yaml")
pick(s, ("heavy1", ["heavy_located"]))
assert "heavy2" not in s.pins(), \
    f"[{s.name}] Heavy 2 should wait for the wide sweep; visible: {s.pins()}"
print(f"  OK  {s.name}")

print("\nAll paths land where the design says they should.")
