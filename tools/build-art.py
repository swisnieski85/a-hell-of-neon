#!/usr/bin/env python3
"""Build the game's WebP art from the PNG masters in assets/master/.

Run from the repo root:  python tools/build-art.py [--force]

  assets/master/scenes/*.png     -> assets/scenes/*.webp     (full size)
  assets/master/portraits/*.png  -> assets/portraits/*.webp  (max 384 px tall)
  assets/master/map/*.png        -> assets/map/*.webp        (full size)

Scenes keep their native resolution: they display at up to ~60% of the
window, and on high-DPI screens that is already more pixels than the art has.
Portraits display at most 76x114 CSS px, so 384 px tall covers 3x screens.

Only rebuilds files whose master is newer than the WebP, unless --force.
Always rewrites assets/asset-index.json: every art file plus every audio
file under assets/audio/. The engine reads it at startup so it never has to
probe for a file (no 404s). Run this after adding audio, too.
Needs ImageMagick 7 (`magick`) on PATH.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
QUALITY = "90"  # ~40 dB PSNR on the painted scene art; visually lossless
AUDIO_EXTS = {".mp3", ".ogg", ".wav"}  # listed in the index as-is, not converted

JOBS = [
    (ASSETS / "master" / "scenes", ASSETS / "scenes", None),
    (ASSETS / "master" / "portraits", ASSETS / "portraits", "x384>"),  # shrink only
    (ASSETS / "master" / "map", ASSETS / "map", None),
]


def main():
    force = "--force" in sys.argv
    if not shutil.which("magick"):
        sys.exit("ImageMagick 7 (`magick`) not found on PATH.")
    built = skipped = 0
    for src_dir, out_dir, resize in JOBS:
        out_dir.mkdir(parents=True, exist_ok=True)
        for src in sorted(src_dir.glob("*.png")):
            out = out_dir / (src.stem + ".webp")
            if not force and out.exists() and out.stat().st_mtime >= src.stat().st_mtime:
                skipped += 1
                continue
            cmd = ["magick", str(src)]
            if resize:
                cmd += ["-resize", resize]
            cmd += ["-quality", QUALITY, "-define", "webp:method=6", str(out)]
            subprocess.run(cmd, check=True)
            print(f"  {src.relative_to(ROOT)} -> {out.relative_to(ROOT)}"
                  f"  ({src.stat().st_size / 1e6:.1f} MB -> {out.stat().st_size / 1e6:.2f} MB)")
            built += 1
    art = [p for _, out_dir, _ in JOBS for p in out_dir.glob("*.webp")]
    audio = [p for p in (ASSETS / "audio").rglob("*") if p.suffix in AUDIO_EXTS]
    index = sorted(p.relative_to(ASSETS).as_posix() for p in art + audio)
    (ASSETS / "asset-index.json").write_text(json.dumps(index, indent=1) + "\n", encoding="utf-8")
    old = ASSETS / "art-index.json"  # the index's earlier name
    if old.exists():
        old.unlink()
    print(f"\nBuilt {built}, up to date {skipped}. "
          f"Indexed {len(index)} files in assets/asset-index.json.")


if __name__ == "__main__":
    main()
