"""Turn generated Roman UI plates into engine-ready 9-slice assets."""

from pathlib import Path

from PIL import Image, ImageDraw

SRC = Path(r"C:\Users\Zac\.grok\sessions\C%3A%5CUsers%5CZac\01a0468b-e922-7811-89e9-c1189ff8ab79\images")
OUT = Path(__file__).resolve().parents[1] / "assets" / "ui"
CHECK = Path(__file__).resolve().parent / "_ui_checks"
OUT.mkdir(parents=True, exist_ok=True)
CHECK.mkdir(parents=True, exist_ok=True)

FRAME_SLICE = 270
BTN_SLICE = 88


def save_png(im: Image.Image, name: str) -> None:
    dest = OUT / name
    im.convert("RGB").save(dest, "PNG", optimize=True)
    print(f"wrote {dest.name} {im.size}")


def crop_frac(im: Image.Image, frac: float) -> Image.Image:
    w, h = im.size
    x = int(w * frac)
    y = int(h * frac)
    return im.crop((x, y, w - x, h - y))


def nine_slice_preview(src: Image.Image, slice_px: int, out_w: int, out_h: int, border: int | None = None) -> Image.Image:
    """Stretch a 9-slice the way CSS border-image stretch does."""
    w, h = src.size
    s = slice_px
    b = border if border is not None else min(slice_px, out_w // 3, out_h // 3)
    tiles = {
        "tl": src.crop((0, 0, s, s)),
        "t": src.crop((s, 0, w - s, s)),
        "tr": src.crop((w - s, 0, w, s)),
        "l": src.crop((0, s, s, h - s)),
        "c": src.crop((s, s, w - s, h - s)),
        "r": src.crop((w - s, s, w, h - s)),
        "bl": src.crop((0, h - s, s, h)),
        "b": src.crop((s, h - s, w - s, h)),
        "br": src.crop((w - s, h - s, w, h)),
    }
    out = Image.new("RGB", (out_w, out_h))
    out.paste(tiles["tl"].resize((b, b), Image.Resampling.LANCZOS), (0, 0))
    out.paste(tiles["tr"].resize((b, b), Image.Resampling.LANCZOS), (out_w - b, 0))
    out.paste(tiles["bl"].resize((b, b), Image.Resampling.LANCZOS), (0, out_h - b))
    out.paste(tiles["br"].resize((b, b), Image.Resampling.LANCZOS), (out_w - b, out_h - b))
    mid_w = out_w - 2 * b
    mid_h = out_h - 2 * b
    out.paste(tiles["t"].resize((mid_w, b), Image.Resampling.LANCZOS), (b, 0))
    out.paste(tiles["b"].resize((mid_w, b), Image.Resampling.LANCZOS), (b, out_h - b))
    out.paste(tiles["l"].resize((b, mid_h), Image.Resampling.LANCZOS), (0, b))
    out.paste(tiles["r"].resize((b, mid_h), Image.Resampling.LANCZOS), (out_w - b, b))
    out.paste(tiles["c"].resize((mid_w, mid_h), Image.Resampling.LANCZOS), (b, b))
    return out


def overlay_guides(im: Image.Image, slice_px: int) -> Image.Image:
    vis = im.convert("RGB").copy()
    d = ImageDraw.Draw(vis)
    w, h = vis.size
    d.line([(slice_px, 0), (slice_px, h)], fill=(0, 255, 80), width=2)
    d.line([(w - slice_px, 0), (w - slice_px, h)], fill=(0, 255, 80), width=2)
    d.line([(0, slice_px), (w, slice_px)], fill=(0, 255, 80), width=2)
    d.line([(0, h - slice_px), (w, h - slice_px)], fill=(0, 255, 80), width=2)
    return vis


def main() -> None:
    frame = Image.open(SRC / "2.jpg").convert("RGB")
    save_png(frame, "frame.png")
    overlay_guides(frame, FRAME_SLICE).save(CHECK / "frame-slice.png")
    nine_slice_preview(frame, FRAME_SLICE, 720, 420, 48).save(CHECK / "frame-wide.png")
    nine_slice_preview(frame, FRAME_SLICE, 280, 640, 36).save(CHECK / "frame-tall.png")
    nine_slice_preview(frame, FRAME_SLICE, 900, 140, 28).save(CHECK / "frame-bar.png")

    btn_src = {
        "btn.png": "1.jpg",
        "btn-hover.png": "4.jpg",
        "btn-pressed.png": "7.jpg",
        "btn-ghost.png": "5.jpg",
    }
    target = (960, 640)
    for name, src_name in btn_src.items():
        im = crop_frac(Image.open(SRC / src_name).convert("RGB"), 0.03)
        im = im.resize(target, Image.Resampling.LANCZOS)
        save_png(im, name)

    btn = Image.open(OUT / "btn.png")
    overlay_guides(btn, BTN_SLICE).save(CHECK / "btn-slice.png")
    nine_slice_preview(btn, BTN_SLICE, 420, 96, 22).save(CHECK / "btn-wide.png")
    nine_slice_preview(btn, BTN_SLICE, 180, 56, 14).save(CHECK / "btn-compact.png")

    banner = Image.open(SRC / "6.jpg").convert("RGB")
    save_png(banner, "banner.png")
    print("slice frame", FRAME_SLICE, "btn", BTN_SLICE)


if __name__ == "__main__":
    main()
