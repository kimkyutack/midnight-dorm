#!/usr/bin/env python3
"""Normalize transparent cosmetic cutouts for catalog cards and avatar previews."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


CANVAS = 362
PRODUCT_BOX = (312, 312)
DEFAULT_PREVIEW = {
    "hat": (128, 82, 181, 78),
    "outfit": (150, 145, 181, 250),
    "accessory": (92, 92, 181, 188),
    "shoes": (124, 66, 181, 316),
}
PREVIEW_OVERRIDES = {
    "accessory-scarf": (82, 46, 181, 202),
    "accessory-backpack": (102, 132, 244, 224),
    "accessory-star": (42, 42, 181, 190),
    "accessory-lantern": (62, 94, 270, 216),
    "hat-beanie": (140, 105, 181, 94),
    "hat-rank": (140, 92, 181, 88),
    "hat-moon-cap": (130, 80, 181, 78),
    "hat-headlamp": (120, 60, 181, 82),
    "hat-silver-crown": (105, 65, 181, 62),
    "hat-gold-crown": (105, 65, 181, 62),
    "hat-halo": (150, 72, 181, 55),
}


def alpha_crop(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    bbox = rgba.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("asset has no visible pixels")
    return rgba.crop(bbox)


def contain(image: Image.Image, width: int, height: int) -> Image.Image:
    scale = min(width / image.width, height / image.height)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(size, Image.Resampling.LANCZOS)


def centered_product(cutout: Image.Image) -> Image.Image:
    item = contain(cutout, *PRODUCT_BOX)
    canvas = Image.new("RGBA", (CANVAS, CANVAS))
    canvas.alpha_composite(item, ((CANVAS - item.width) // 2, (CANVAS - item.height) // 2))
    return canvas


def preview_layer(asset_id: str, cutout: Image.Image) -> Image.Image:
    slot = asset_id.split("-", 1)[0]
    width, height, center_x, center_y = PREVIEW_OVERRIDES.get(asset_id, DEFAULT_PREVIEW[slot])
    item = contain(cutout, width, height)
    canvas = Image.new("RGBA", (CANVAS, CANVAS))
    left = round(center_x - item.width / 2)
    top = round(center_y - item.height / 2)
    canvas.alpha_composite(item, (left, top))
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("product_dir", type=Path)
    parser.add_argument("preview_dir", type=Path)
    args = parser.parse_args()
    args.product_dir.mkdir(parents=True, exist_ok=True)
    args.preview_dir.mkdir(parents=True, exist_ok=True)

    count = 0
    for source in sorted(args.input_dir.glob("*.png")):
        cutout = alpha_crop(Image.open(source))
        centered_product(cutout).save(args.product_dir / source.name, optimize=True)
        preview_layer(source.stem, cutout).save(args.preview_dir / source.name, optimize=True)
        count += 1
    print(f"built {count} cosmetic product and preview assets")


if __name__ == "__main__":
    main()
