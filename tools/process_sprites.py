"""Key, crop, and harvest Aquila map sprites into engine-ready PNGs."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from PIL import Image

SESSION = Path(r"C:\Users\Zac\.grok\sessions\C%3A%5CUsers%5CZac\01a0468d-6795-7193-b85b-32ba403da0ce")
IMG = SESSION / "images"
VID = SESSION / "videos"
DST = Path(r"C:\Users\Zac\Documents\aquila\assets\sprites")
FX = Path(r"C:\Users\Zac\Documents\aquila\assets\fx")
CAMP = Path(r"C:\Users\Zac\Documents\aquila\assets\campaign")
FFMPEG = Path(
    r"C:\Users\Zac\AppData\Local\Programs\Python\Python313\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"
)

# idle stills (and single-frame clips)
STILLS = {
    "1.jpg": ("rome-heavy", "idle"),
    "28.jpg": ("rome-heavy-vet", "idle"),
    "4.jpg": ("rome-aux", "idle"),
    "7.jpg": ("rome-bow", "idle"),
    "6.jpg": ("rome-sling", "idle"),
    "8.jpg": ("rome-horse", "idle"),
    "26.jpg": ("rome-batavi", "idle"),
    "10.jpg": ("rome-scout", "idle"),
    "13.jpg": ("rome-scorpio", "idle"),
    "11.jpg": ("rome-engineer", "idle"),
    "25.jpg": ("rome-hero-ger", "idle"),
    "27.jpg": ("rome-hero-cae", "idle"),
    "2.jpg": ("ger-warband", "idle"),
    "9.jpg": ("ger-noble", "idle"),
    "12.jpg": ("ger-skirmish", "idle"),
    "17.jpg": ("ger-hunter", "idle"),
    "18.jpg": ("ger-horse", "idle"),
    "19.jpg": ("ger-raider", "idle"),
    "29.jpg": ("ger-hero", "idle"),
    "22.jpg": ("rome-heavy", "hit"),
    "21.jpg": ("rome-heavy", "die"),
    "24.jpg": ("ger-warband", "hit"),
    "23.jpg": ("ger-warband", "die"),
}

FX_STILLS = {
    "16.jpg": "pilum.png",
    "20.jpg": "arrow.png",
    "14.jpg": "clash.png",
    "15.jpg": "pin-castra.png",
}

VIDEOS = {
    "1.mp4": ("rome-heavy", "idle", 8, True),
    "2.mp4": ("ger-warband", "idle", 8, True),
    "4.mp4": ("rome-heavy", "attack", 10, False),
    "3.mp4": ("ger-warband", "attack", 10, False),
}


def _hue_sat(r: int, g: int, b: int) -> tuple[float, float]:
    mx = max(r, g, b)
    mn = min(r, g, b)
    if mx == 0 or mx == mn:
        return 0.0, 0.0
    if mx == r:
        hue = (g - b) / (mx - mn)
    elif mx == g:
        hue = 2 + (b - r) / (mx - mn)
    else:
        hue = 4 + (r - g) / (mx - mn)
    hue = (hue * 60) % 360
    return hue, (mx - mn) / mx


def key_magenta(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    samples = [
        px[2, 2][:3],
        px[w - 3, 2][:3],
        px[2, h - 3][:3],
        px[w - 3, h - 3][:3],
        px[w // 2, 2][:3],
        px[2, h // 2][:3],
        px[w - 3, h // 2][:3],
    ]
    br = sum(s[0] for s in samples) / len(samples)
    bg = sum(s[1] for s in samples) / len(samples)
    bb = sum(s[2] for s in samples) / len(samples)
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            dist = ((r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2) ** 0.5
            hue, sat = _hue_sat(r, g, b)
            magenta = sat > 0.28 and (hue >= 280 or hue <= 15) and r > 140 and b > 140 and g < 90
            if dist < 38 or (magenta and dist < 110):
                px[x, y] = (r, g, b, 0)
            elif dist < 62 or (magenta and dist < 150):
                fade = (dist - 38) / 40
                px[x, y] = (r, g, b, int(255 * max(0, min(1, fade))))
    return im


def crop_alpha(im: Image.Image, pad: int = 6) -> Image.Image:
    bbox = im.getbbox()
    if not bbox:
        return im
    l, t, r, b = bbox
    return im.crop((max(0, l - pad), max(0, t - pad), min(im.width, r + pad), min(im.height, b + pad)))


def union_bbox(frames: list[Image.Image], pad: int = 6):
    box = None
    for im in frames:
        b = im.getbbox()
        if not b:
            continue
        if box is None:
            box = list(b)
        else:
            box[0] = min(box[0], b[0])
            box[1] = min(box[1], b[1])
            box[2] = max(box[2], b[2])
            box[3] = max(box[3], b[3])
    if not box:
        return None
    box[0] = max(0, box[0] - pad)
    box[1] = max(0, box[1] - pad)
    box[2] = min(frames[0].width, box[2] + pad)
    box[3] = min(frames[0].height, box[3] + pad)
    return tuple(box)


def save_clip(arch: str, clip: str, frames: list[Image.Image]) -> int:
    if not frames:
        return 0
    box = union_bbox(frames)
    out = DST / arch / clip
    out.mkdir(parents=True, exist_ok=True)
    n = 0
    for i, im in enumerate(frames):
        cut = im.crop(box) if box else im
        dest = out / f"f{i:02d}.png"
        cut.save(dest, "PNG")
        n += 1
    return n


def extract_video(path: Path, fps: int = 12) -> list[Image.Image]:
    tmp = path.parent / f"_frames_{path.stem}"
    if tmp.exists():
        for p in tmp.glob("*.png"):
            p.unlink()
    else:
        tmp.mkdir(parents=True, exist_ok=True)
    cmd = [
        str(FFMPEG),
        "-y",
        "-i",
        str(path),
        "-vf",
        f"fps={fps}",
        str(tmp / "f%03d.png"),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    files = sorted(tmp.glob("f*.png"))
    return [key_magenta(Image.open(p)) for p in files]


def pick_idle(frames: list[Image.Image], count: int) -> list[Image.Image]:
    if len(frames) <= count:
        return frames
    start = max(2, len(frames) // 10)
    end = max(start + count, int(len(frames) * 0.85))
    span = frames[start:end]
    if len(span) <= count:
        return span
    step = (len(span) - 1) / (count - 1)
    return [span[round(i * step)] for i in range(count)]


def pick_attack(frames: list[Image.Image], count: int) -> list[Image.Image]:
    if len(frames) <= count:
        return frames
    # peak motion window via mean abs diff of luma
    diffs = [0.0]
    prev = frames[0].convert("L")
    for im in frames[1:]:
        cur = im.convert("L")
        a = list(prev.getdata())
        b = list(cur.getdata())
        n = min(len(a), len(b), 4000)
        step = max(1, len(a) // n)
        d = sum(abs(a[i] - b[i]) for i in range(0, len(a), step)) / (len(a) / step)
        diffs.append(d)
        prev = cur
    best_i = 0
    best = -1.0
    for i in range(0, len(frames) - count):
        s = sum(diffs[i : i + count])
        if s > best:
            best = s
            best_i = i
    return frames[best_i : best_i + count]


def write_manifest(counts: dict) -> None:
    man = {}
    for (arch, clip), n in sorted(counts.items()):
        man.setdefault(arch, {})
        man[arch][clip] = {
            "count": n,
            "fps": 10 if clip == "idle" else 12,
            "loop": clip == "idle",
        }
    DST.mkdir(parents=True, exist_ok=True)
    (DST / "manifest.json").write_text(json.dumps(man, indent=2), encoding="utf-8")
    print("manifest", len(man), "archetypes")


def main() -> None:
    counts: dict[tuple[str, str], int] = {}

    for src_name, (arch, clip) in STILLS.items():
        src = IMG / src_name
        if not src.exists():
            print("MISSING still", src_name)
            continue
        keyed = crop_alpha(key_magenta(Image.open(src)))
        n = save_clip(arch, clip, [keyed])
        counts[(arch, clip)] = n
        print("still", arch, clip, n)

    for src_name, dest_name in FX_STILLS.items():
        src = IMG / src_name
        if not src.exists():
            print("MISSING fx", src_name)
            continue
        FX.mkdir(parents=True, exist_ok=True)
        crop_alpha(key_magenta(Image.open(src))).save(FX / dest_name, "PNG")
        print("fx", dest_name)

    camp_src = IMG / "5.jpg"
    if camp_src.exists():
        CAMP.mkdir(parents=True, exist_ok=True)
        Image.open(camp_src).convert("RGB").save(CAMP / "germania.png", "PNG")
        print("campaign germania.png")

    if FFMPEG.exists():
        for src_name, (arch, clip, count, loop) in VIDEOS.items():
            src = VID / src_name
            if not src.exists():
                print("MISSING video", src_name)
                continue
            try:
                frames = extract_video(src, 12)
            except subprocess.CalledProcessError as e:
                print("ffmpeg fail", src_name, e)
                continue
            picked = pick_idle(frames, count) if loop else pick_attack(frames, count)
            n = save_clip(arch, clip, picked)
            counts[(arch, clip)] = n
            print("video", arch, clip, n, "from", len(frames))
    else:
        print("no ffmpeg, skipping videos")

    write_manifest(counts)


if __name__ == "__main__":
    main()
