#!/usr/bin/env python3
"""Build centered sleeping-pose PNGs, preferring approved dedicated character art."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


CANVAS = 362


def crop_alpha(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    bbox = rgba.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("sleep source has no visible pixels")
    return rgba.crop(bbox)


def fit(image: Image.Image, max_width: int, max_height: int) -> Image.Image:
    scale = min(max_width / image.width, max_height / image.height)
    return image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)


def centered(image: Image.Image, max_width: int, max_height: int) -> Image.Image:
    item = fit(crop_alpha(image), max_width, max_height)
    canvas = Image.new("RGBA", (CANVAS, CANVAS))
    canvas.alpha_composite(item, ((CANVAS - item.width) // 2, (CANVAS - item.height) // 2))
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dedicated_source_dir", type=Path)
    parser.add_argument("survivor_root", type=Path)
    args = parser.parse_args()
    for character_dir in sorted(path for path in args.survivor_root.iterdir() if path.is_dir()):
        output = character_dir / "sleep.png"
        dedicated = args.dedicated_source_dir / f"{character_dir.name}.png"
        if dedicated.exists():
            result = centered(Image.open(dedicated), 340, 210)
        else:
            side = Image.open(character_dir / "frames" / "side-idle.png").convert("RGBA")
            # A 90-degree side view is a stable fallback sleeping silhouette;
            # it keeps every custom character full-sized while dedicated poses
            # can later replace the same file without code changes.
            result = centered(side.rotate(90, expand=True), 320, 180)
        result.save(output, optimize=True)
        print(output)


if __name__ == "__main__":
    main()
