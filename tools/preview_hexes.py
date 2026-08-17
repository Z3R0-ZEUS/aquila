"""Composite a 2.5D hex preview from the processed tiles."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(r"C:\Users\Zac\Documents\aquila\assets\tiles")
OUT = Path(r"C:\Users\Zac\Documents\aquila\tools\_tile_checks\hex_preview.png")
SIZE = 52
FLOOR = 0.28

ART = {
    "clear": {"albedo": "clear.png", "h": 0.0, "side": (74, 61, 40)},
    "woods": {"albedo": "forest-floor.png", "h": 0.0, "side": (58, 46, 28), "prop": "props/oak-a.png", "ps": 1.5},
    "dense": {"albedo": "dense-floor.png", "h": 0.0, "side": (42, 34, 20), "prop": "props/fir-a.png", "ps": 1.8},
    "marsh": {"albedo": "marsh.png", "h": -0.04, "side": (44, 50, 36), "prop": "props/reeds-a.png", "ps": 0.7},
    "hill": {"albedo": "hill.png", "h": 0.24, "side": (90, 74, 50), "prop": "props/rock.png", "ps": 0.5},
    "village": {"albedo": "village-dirt.png", "h": 0.04, "side": (74, 56, 40), "prop": "props/longhouse-a.png", "ps": 0.85},
    "castra": {"albedo": "castra-earth.png", "h": 0.08, "side": (90, 78, 58), "prop": "props/castra.png", "ps": 1.22},
    "oppidum": {"albedo": "hill.png", "h": 0.30, "side": (74, 58, 40), "prop": "props/oppidum.png", "ps": 1.38},
    "water": {"albedo": "water.png", "h": -0.16, "side": (28, 40, 48)},
    "ford": {"albedo": "ford.png", "h": -0.10, "side": (42, 56, 56)},
}

ORDER = ["clear", "woods", "dense", "marsh", "hill", "village", "castra", "oppidum", "water", "ford"]


def hex_to_pixel(col, row, size):
    x = size * math.sqrt(3) * (col + 0.5 * (row & 1))
    y = size * 1.5 * row
    return x, y


def hex_corners(cx, cy, size):
    pts = []
    for i in range(6):
        a = math.radians(60 * i - 30)
        pts.append((cx + size * math.cos(a), cy + size * math.sin(a)))
    return pts


def paste_clip(base, tex, mask_img, xy):
    base.paste(tex, xy, mask_img)


def draw_hex(canvas, col, row, kind, ox, oy):
    art = ART[kind]
    size = SIZE
    px, py = hex_to_pixel(col, row, size)
    px += ox
    py += oy
    top = (px, py - art["h"] * size)
    bot = (px, py + FLOOR * size)
    tpts = hex_corners(*top, size - 0.4)
    bpts = hex_corners(*bot, size - 0.4)
    draw = ImageDraw.Draw(canvas, "RGBA")

    faces = []
    for i in range(6):
        a = tpts[i]
        b = tpts[(i + 1) % 6]
        c = bpts[(i + 1) % 6]
        d = bpts[i]
        midy = (a[1] + b[1] + c[1] + d[1]) / 4
        faces.append((midy, i, [a, b, c, d]))
    faces.sort()
    sr, sg, sb = art["side"]
    for midy, i, poly in faces:
        out = math.radians(60 * i)
        nx, ny = math.cos(out), math.sin(out)
        lit = nx * -0.62 + ny * -0.78
        k = 0.30 + 0.52 * max(0, (lit + 1) * 0.5)
        colr = (int(sr * k), int(sg * k), int(sb * k), 255)
        draw.polygon(poly, fill=colr)

    mask = Image.new("L", canvas.size, 0)
    md = ImageDraw.Draw(mask)
    md.polygon(tpts, fill=255)
    tex = Image.open(ROOT / art["albedo"]).convert("RGB")
    tex = tex.resize((int(size * 2.2), int(size * 2.2)), Image.Resampling.LANCZOS)
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer.paste(tex, (int(top[0] - tex.size[0] / 2), int(top[1] - tex.size[1] / 2)))
    canvas.paste(layer, (0, 0), mask)

    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.polygon(tpts, outline=(8, 10, 6, 180))

    if "prop" in art:
        prop = Image.open(ROOT / art["prop"]).convert("RGBA")
        ph = int(size * art["ps"])
        pw = int(ph * prop.size[0] / prop.size[1])
        prop = prop.resize((pw, ph), Image.Resampling.LANCZOS)
        canvas.alpha_composite(prop, (int(top[0] - pw / 2), int(top[1] - ph * 0.88)))


def main():
    w, h = 1400, 420
    canvas = Image.new("RGBA", (w, h), (18, 26, 20, 255))
    for i, kind in enumerate(ORDER):
        draw_hex(canvas, i, 0, kind, 90, 180)
        if i < 8:
            draw_hex(canvas, i, 1, kind if i % 2 else "clear", 90, 180)
    canvas = canvas.filter(ImageFilter.SMOOTH)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(OUT)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
