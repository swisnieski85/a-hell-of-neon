#!/usr/bin/env python3
"""Static validator for A Hell of Neon content.

Run from the repo root:  python tools/validate-content.py

Checks that the whole content graph is wired: every node/scene/vignette/map
reference resolves, branch nodes are well-formed, and every flag read in a
condition is set somewhere (typo catcher). Exits non-zero on errors so it can
gate a commit. Warnings don't fail the run.
"""
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("PyYAML required: pip install pyyaml")

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

RESERVED_TOKENS = {"lenses_on", "slots_exhausted"}
COND_KEYS = {"all", "any", "not", "day_is", "day_at_least", "day_after"}

errors = []
warnings = []


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


def load(path):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


# ---------- collect flags from a condition tree ----------

def cond_flags(cond, out):
    if cond is None:
        return
    if isinstance(cond, str):
        if cond not in RESERVED_TOKENS:
            out.add(cond)
        return
    if isinstance(cond, list):
        for c in cond:
            cond_flags(c, out)
        return
    if isinstance(cond, dict):
        for k, v in cond.items():
            if k in ("all", "any"):
                cond_flags(v, out)
            elif k == "not":
                cond_flags(v, out)
            elif k == "day_after":
                out.add(v)  # day_after reads the flag's set-day
            elif k in ("day_is", "day_at_least"):
                pass
            else:
                err(f"unknown condition key '{k}' in {cond}")


def main():
    manifest = load(CONTENT / "manifest.yaml")
    maps = load(CONTENT / "maps.yaml") or {}
    characters = load(CONTENT / "characters.yaml") or {}
    endings = (load(CONTENT / "endings.yaml") or {}).get("endings") or []
    ending_ids = {e.get("id") for e in endings}

    files = manifest.get("vignettes", [])
    vigns = {}
    for f in files:
        p = CONTENT / "vignettes" / f
        if not p.exists():
            err(f"manifest lists missing file: {f}")
            continue
        vigns[f] = load(p) or {}

    # Fragment node pool (engine mirrors this)
    frag_nodes = {}
    for f, v in vigns.items():
        if v.get("kind") == "fragment":
            for n in v.get("nodes") or []:
                if n["id"] in frag_nodes:
                    err(f"duplicate fragment node id '{n['id']}' ({f})")
                frag_nodes[n["id"]] = n

    flags_set = set()      # every flag any `set:` writes
    flags_read = set()     # every flag any `requires:` reads
    speakers_used = set()

    def check_target(d, f, v, ctx, node_ids, scene_ids):
        """d: a choice / node / branch entry / redirect carrying goto fields."""
        if not isinstance(d, dict):
            return
        if "goto" in d and d["goto"] not in node_ids and d["goto"] not in frag_nodes:
            err(f"{f}: {ctx}: goto '{d['goto']}' — no such node")
        if "goto_vignette" in d:
            tgt = d["goto_vignette"]
            if tgt not in vigns:
                err(f"{f}: {ctx}: goto_vignette '{tgt}' not in manifest")
            elif vigns[tgt].get("kind") == "fragment":
                err(f"{f}: {ctx}: goto_vignette '{tgt}' is a fragment (not enterable)")
        if "goto_map" in d and d["goto_map"] not in maps:
            err(f"{f}: {ctx}: goto_map '{d['goto_map']}' not in maps.yaml")
        if "goto_scene" in d and d["goto_scene"] not in scene_ids:
            err(f"{f}: {ctx}: goto_scene '{d['goto_scene']}' — no such scene")
        # The end card records which ending was reached (title-screen row).
        if d.get("goto_screen") == "end" and d.get("ending") not in ending_ids:
            err(f"{f}: {ctx}: goto_screen: end needs an `ending:` from endings.yaml "
                f"(got {d.get('ending')!r})")
        if "requires" in d:
            cond_flags(d["requires"], flags_read)
        if "set" in d:
            for k in d["set"]:
                flags_set.add(k)

    for f, v in vigns.items():
        scenes = v.get("scenes") or {}
        nodes = v.get("nodes") or []
        node_ids = {n["id"] for n in nodes}
        dupes = [n["id"] for n in nodes if [m["id"] for m in nodes].count(n["id"]) > 1]
        if dupes:
            err(f"{f}: duplicate node ids: {sorted(set(dupes))}")
        scene_ids = set(scenes)
        is_frag = v.get("kind") == "fragment"

        if not is_frag:
            op = v.get("opening_node")
            if op and op not in node_ids and op not in frag_nodes:
                err(f"{f}: opening_node '{op}' — no such node")
            es = v.get("entry_scene")
            if es and es not in scene_ids:
                err(f"{f}: entry_scene '{es}' — no such scene")
            if v.get("kind") == "location" and not es and scenes:
                warn(f"{f}: location vignette with scenes but no entry_scene")

        for sid, scene in scenes.items():
            for h in scene.get("hotspots") or []:
                ctx = f"scene '{sid}' hotspot '{h.get('id')}'"
                for key in ("node", "node_on", "node_off"):
                    if key in h and h[key] not in node_ids and h[key] not in frag_nodes:
                        err(f"{f}: {ctx}: {key} '{h[key]}' — no such node")
                # Hotspot boxes are fractions of the 16:9 art, top-left origin.
                # The scene box doesn't clip, so a box past the edge spills
                # over whatever sits below the art (the dialogue box, stacked).
                c = h.get("coords") or {}
                x, y, w, hh = (c.get(k, 0) for k in ("x", "y", "w", "h"))
                if min(x, y, w, hh) < 0 or x + w > 1.0001 or y + hh > 1.0001:
                    err(f"{f}: {ctx}: coords {c} run outside the image (0..1)")
                check_target(h, f, v, ctx, node_ids, scene_ids)
            if isinstance(scene.get("image"), list):
                for e in scene["image"]:
                    if "requires" in e:
                        cond_flags(e["requires"], flags_read)

        for n in nodes:
            ctx = f"node '{n['id']}'"
            if "branch" in n:
                if n.get("blocks") or n.get("choices"):
                    err(f"{f}: {ctx}: branch node must not carry blocks/choices")
                for i, e in enumerate(n["branch"]):
                    if "goto" not in e:
                        err(f"{f}: {ctx}: branch entry {i} has no goto "
                            "(branch entries are goto-only)")
                    check_target(e, f, v, f"{ctx} branch[{i}]", node_ids, scene_ids)
                continue
            check_target(n, f, v, ctx, node_ids, scene_ids)
            for b in n.get("blocks") or []:
                if isinstance(b, dict) and "dialogue" in b:
                    speakers_used.add(b["dialogue"].get("speaker"))
                if isinstance(b, dict) and "requires" in b:   # conditional block
                    cond_flags(b["requires"], flags_read)
            for c in n.get("choices") or []:
                check_target(c, f, v, f"{ctx} choice '{c.get('label')}'",
                             node_ids, scene_ids)

        # clock events
        clock = v.get("clock")
        if clock:
            for ev in clock.get("events") or []:
                if ev.get("node") not in node_ids:
                    err(f"{f}: clock event node '{ev.get('node')}' — no such node")
                if "requires" in ev:
                    cond_flags(ev["requires"], flags_read)

    # maps: pins + redirects
    for mid, m in maps.items():
        for r in m.get("redirect") or []:
            if "requires" in r:
                cond_flags(r["requires"], flags_read)
            tgt = r.get("goto_vignette")
            if tgt not in vigns:
                err(f"maps.yaml: {mid} redirect -> '{tgt}' not in manifest")
        for pin in m.get("pins") or []:
            if "requires" in pin:
                cond_flags(pin["requires"], flags_read)
            tgt = pin.get("goto_vignette")
            if tgt and tgt not in vigns:
                err(f"maps.yaml: {mid} pin '{pin.get('id')}' -> '{tgt}' not in manifest")

    # flags read but never set (has_lenses is set by V01; underscore flags are
    # vignette-local so a cross-file read of one is almost certainly a bug)
    for flag in sorted(flags_read - flags_set):
        err(f"flag '{flag}' is read in a requires but never set anywhere")
    for flag in sorted(flags_set - flags_read):
        warn(f"flag '{flag}' is set but never read (fine if narrative-only)")

    # speakers
    for s in sorted(x for x in speakers_used if x):
        if s not in characters:
            err(f"speaker '{s}' not in characters.yaml")

    for w in warnings:
        print(f"  warn: {w}")
    if errors:
        print(f"\n{len(errors)} error(s):")
        for e in errors:
            print(f"  ERROR: {e}")
        sys.exit(1)
    print(f"\nOK — {len(vigns)} vignettes, {len(maps)} maps, "
          f"{len(flags_set)} flags set, {len(flags_read)} read. All wired.")


if __name__ == "__main__":
    main()
