"""Split a generated three-panel tile atlas into centered game textures.

The image-generation prompt uses a solid magenta background and orders the
panels as corridor, room, and wall. This script removes the atlas gutters,
normalizes every panel to the same square canvas, and writes 512px RGB PNGs.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


PANEL_NAMES = ("corridor", "room", "wall")


def is_magenta(pixel: tuple[int, int, int]) -> bool:
    red, green, blue = pixel
    # Image generation can anti-alias the #ff00ff gutter into fuchsia. The
    # theme art is never this red/blue saturated at the panel edge.
    return red > 200 and green < 125 and blue > 125


def panel_bounds(panel: Image.Image) -> tuple[int, int, int, int]:
    rgb = panel.convert("RGB")
    points: list[tuple[int, int]] = []
    for y in range(rgb.height):
        for x in range(rgb.width):
            if not is_magenta(rgb.getpixel((x, y))):
                points.append((x, y))
    if not points:
        raise ValueError("No non-magenta tile art found in atlas panel")
    xs, ys = zip(*points)
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def extract_panel(atlas: Image.Image, index: int) -> Image.Image:
    left = round(atlas.width * index / 3)
    right = round(atlas.width * (index + 1) / 3)
    panel = atlas.crop((left, 0, right, atlas.height))
    # The model sometimes puts a few non-magenta pixels in the outermost
    # atlas corner. A fixed, proportional gutter is more reliable than a
    # global bounding box and keeps every output tile edge clean on mobile.
    gutter = round(min(panel.size) * 0.062)
    art = panel.crop((gutter, gutter, panel.width - gutter, panel.height - gutter))
    side = min(art.size)
    x = (art.width - side) // 2
    y = (art.height - side) // 2
    art = art.crop((x, y, x + side, y + side))
    return art.convert("RGB").resize((512, 512), Image.Resampling.LANCZOS)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("atlas", type=Path)
    parser.add_argument("theme")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "public" / "assets" / "environment",
    )
    args = parser.parse_args()

    atlas = Image.open(args.atlas)
    args.output.mkdir(parents=True, exist_ok=True)
    for index, name in enumerate(PANEL_NAMES):
        output = args.output / f"{args.theme}-{name}-tile-v2.png"
        extract_panel(atlas, index).save(output, optimize=True)
        print(output)


if __name__ == "__main__":
    main()
