#!/usr/bin/env python3
"""Split generated chroma-key sprite sheets into consistently named PNG frames."""

from __future__ import annotations

import argparse
from pathlib import Path
from PIL import Image


DIRECTIONS = ("front", "back", "side")
MOVEMENT_COLUMNS = ("idle", "walk-1", "walk-2", "walk-3")
ATTACK_COLUMNS = ("attack-1", "attack-2", "attack-3")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--kind", required=True, choices=("movement", "attack"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    columns = MOVEMENT_COLUMNS if args.kind == "movement" else ATTACK_COLUMNS
    image = Image.open(args.input).convert("RGBA")
    args.output_dir.mkdir(parents=True, exist_ok=True)

    for row, direction in enumerate(DIRECTIONS):
        top = round(row * image.height / len(DIRECTIONS))
        bottom = round((row + 1) * image.height / len(DIRECTIONS))
        for column, action in enumerate(columns):
            left = round(column * image.width / len(columns))
            right = round((column + 1) * image.width / len(columns))
            frame = image.crop((left, top, right, bottom))
            frame.save(args.output_dir / f"{direction}-{action}.png", optimize=True)

    if args.kind == "movement":
        concept = Image.open(args.output_dir / "front-idle.png").convert("RGBA")
        concept.save(args.output_dir.parent / "concept.png", optimize=True)


if __name__ == "__main__":
    main()
