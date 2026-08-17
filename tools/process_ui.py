"""Convert generated UI art into engine-ready files and icon sizes."""

from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

SRC = Path(r"C:\Users\Zac\.grok\sessions\C%3A%5CUsers%5CZac\01a00da1-ab20-7eb0-a1ad-d9d2b2cf8391\images")
OUT = Path(__file__).resolve().parents[1] / "assets" / "ui"
OUT.mkdir(parents=True, exist_ok=True)


def save_png(im: Image.Image, name: str) -> None:
    dest = OUT / name
    im.convert("RGB").save(dest, "PNG", optimize=True)
    print(f"wrote {dest.name} {im.size}")


def main() -> None:
    emblem = Image.open(SRC / "2.jpg").convert("RGB")
    # Trim the distressed outer rim so small icons stay clean.
    inset = int(emblem.width * 0.035)
    emblem_trim = emblem.crop((inset, inset, emblem.width - inset, emblem.height - inset))
    emblem_trim = emblem_trim.resize((1024, 1024), Image.Resampling.LANCZOS)
    save_png(emblem_trim, "emblem.png")

    sizes = (512, 256, 48, 32, 16)
    icon_images = []
    for size in sizes:
        icon = emblem_trim.resize((size, size), Image.Resampling.LANCZOS)
        if size <= 48:
            icon = ImageEnhance.Contrast(icon).enhance(1.12)
            icon = ImageEnhance.Color(icon).enhance(1.08)
        if size <= 16:
            icon = icon.filter(ImageFilter.SHARPEN)
        save_png(icon, f"icon-{size}.png")
        icon_images.append(icon)

    ico_path = OUT / "aquila.ico"
    emblem_trim.save(
        ico_path,
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (256, 256)],
    )
    print(f"wrote {ico_path.name}")

    panel = Image.open(SRC / "5.jpg").convert("RGB")
    save_png(panel, "panel.png")

    camp = Image.open(SRC / "4.jpg").convert("RGB")
    save_png(camp, "menu-setup.png")

    corner_src = Image.open(SRC / "1.jpg").convert("RGB")
    # Ornament sits in the top-left of the 1280x720 plate.
    crop = corner_src.crop((8, 8, 708, 708)).resize((512, 512), Image.Resampling.LANCZOS)
    save_png(crop, "corner.png")
    save_png(crop.transpose(Image.Transpose.FLIP_LEFT_RIGHT), "corner-tr.png")
    save_png(crop.transpose(Image.Transpose.FLIP_TOP_BOTTOM), "corner-bl.png")
    save_png(
        crop.transpose(Image.Transpose.FLIP_LEFT_RIGHT).transpose(Image.Transpose.FLIP_TOP_BOTTOM),
        "corner-br.png",
    )


if __name__ == "__main__":
    main()
