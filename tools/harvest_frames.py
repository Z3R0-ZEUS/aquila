"""Pick looping/attack frames from extracted video PNGs and key them."""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

ROOT = Path(r"C:\Users\Zac\Documents\aquila")
FRAMES = ROOT / "tools" / "_frames"
DST = ROOT / "assets" / "sprites"

# import keying from process_sprites
import sys
sys.path.insert(0, str(ROOT / "tools"))
from process_sprites import key_magenta, union_bbox, save_clip, pick_idle, pick_attack, write_manifest  # noqa: E402

CLIPS = [
    ("rh", "rome-heavy", "idle", True, 8),
    ("rh-atk", "rome-heavy", "attack", False, 10),
    ("gw", "ger-warband", "idle", True, 8),
    ("gw-atk", "ger-warband", "attack", False, 10),
]


def load_dir(name: str) -> list[Image.Image]:
    files = sorted((FRAMES / name).glob("f*.png"))
    out = []
    for p in files:
        out.append(key_magenta(Image.open(p)))
    return out


def merge_manifest(extra: dict) -> None:
    path = DST / "manifest.json"
    man = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    for (arch, clip), n in extra.items():
        man.setdefault(arch, {})
        man[arch][clip] = {
            "count": n,
            "fps": 10 if clip == "idle" else 12,
            "loop": clip == "idle",
        }
    path.write_text(json.dumps(man, indent=2), encoding="utf-8")
    print("manifest updated")


def main() -> None:
    extra = {}
    for folder, arch, clip, loop, count in CLIPS:
        frames = load_dir(folder)
        if not frames:
            print("empty", folder)
            continue
        picked = pick_idle(frames, count) if loop else pick_attack(frames, count)
        n = save_clip(arch, clip, picked)
        extra[(arch, clip)] = n
        print(arch, clip, n)
    merge_manifest(extra)


if __name__ == "__main__":
    main()
