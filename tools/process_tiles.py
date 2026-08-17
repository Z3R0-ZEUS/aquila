"""Convert generated Imagine tiles/props into engine-ready PNGs."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

SRC = Path(r"C:\Users\Zac\.grok\sessions\C%3A%5CUsers%5CZac\01a00d87-4cd4-78c3-9216-4d699a135b4b\images")
DST = Path(r"C:\Users\Zac\Documents\aquila\assets\tiles")
CHECK = Path(r"C:\Users\Zac\Documents\aquila\tools\_tile_checks")

GROUND = {
    "6.jpg": "clear.png",
    "4.jpg": "clear-b.png",
    "2.jpg": "clear-c.png",
    "1.jpg": "forest-floor.png",
    "5.jpg": "dense-floor.png",
    "10.jpg": "water.png",
    "7.jpg": "hill.png",
    "16.jpg": "marsh.png",
    "20.jpg": "ford.png",
    "12.jpg": "village-dirt.png",
    "13.jpg": "castra-earth.png",
    "11.jpg": "earth-side.png",
}

PROPS = {
    "14.jpg": "oak-a.png",
    "19.jpg": "oak-b.png",
    "18.jpg": "oak-c.png",
    "17.jpg": "fir-a.png",
    "23.jpg": "fir-b.png",
    "24.jpg": "fir-c.png",
    "22.jpg": "reeds-a.png",
    "21.jpg": "rock.png",
    "26.jpg": "longhouse-a.png",
    "28.jpg": "longhouse-b.png",
    "30.jpg": "oppidum.png",
    "31.jpg": "castra.png",
    "25.jpg": "planks.png",
    "27.jpg": "planks-broken.png",
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


def key_magenta(im: Image.Image, thresh: int = 48) -> Image.Image:
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
    ]
    br = sum(s[0] for s in samples) / len(samples)
    bg = sum(s[1] for s in samples) / len(samples)
    bb = sum(s[2] for s in samples) / len(samples)
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            dist = ((r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2) ** 0.5
            hue, sat = _hue_sat(r, g, b)
            magenta = sat > 0.22 and g + 18 < r and (hue >= 280 or hue <= 20)
            if dist < 36 or (magenta and dist < 95):
                px[x, y] = (r, g, b, 0)
            elif dist < 58 or (magenta and dist < 130):
                fade = (dist - 36) / 40
                px[x, y] = (r, g, b, int(255 * max(0, min(1, fade))))
            elif magenta and a < 220:
                px[x, y] = (r, g, b, 0)
    return im


def crop_alpha(im: Image.Image, pad: int = 8) -> Image.Image:
    bbox = im.getbbox()
    if not bbox:
        return im
    l, t, r, b = bbox
    l = max(0, l - pad)
    t = max(0, t - pad)
    r = min(im.width, r + pad)
    b = min(im.height, b + pad)
    return im.crop((l, t, r, b))


def save_ground(src: Path, dest: Path) -> None:
    im = Image.open(src).convert("RGB")
    im = im.resize((1024, 1024), Image.Resampling.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "PNG")
    # 2x2 seam check
    tile = im.resize((256, 256), Image.Resampling.LANCZOS)
    sheet = Image.new("RGB", (512, 512))
    for y in (0, 256):
        for x in (0, 256):
            sheet.paste(tile, (x, y))
    CHECK.mkdir(parents=True, exist_ok=True)
    sheet.save(CHECK / dest.name)


def save_prop(src: Path, dest: Path) -> None:
    im = Image.open(src)
    keyed = key_magenta(im)
    keyed = crop_alpha(keyed)
    dest.parent.mkdir(parents=True, exist_ok=True)
    keyed.save(dest, "PNG")


def main() -> None:
    for src_name, dest_name in GROUND.items():
        src = SRC / src_name
        if not src.exists():
            print("MISSING ground", src_name)
            continue
        save_ground(src, DST / dest_name)
        print("ground", dest_name)

    props = DST / "props"
    for src_name, dest_name in PROPS.items():
        src = SRC / src_name
        if not src.exists():
            print("MISSING prop", src_name)
            continue
        save_prop(src, props / dest_name)
        print("prop", dest_name)

    # reeds-b fallback
    a = props / "reeds-a.png"
    b = props / "reeds-b.png"
    if a.exists() and not b.exists():
        Image.open(a).transpose(Image.Transpose.FLIP_LEFT_RIGHT).save(b, "PNG")
        print("prop reeds-b (mirror)")


if __name__ == "__main__":
    main()
