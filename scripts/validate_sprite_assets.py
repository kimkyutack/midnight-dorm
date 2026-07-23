#!/usr/bin/env python3
"""Validate generated sprite counts and transparency contracts."""

from __future__ import annotations

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SPRITE_ROOT = ROOT / "public" / "assets" / "sprites"
SURVIVORS = (
    "character-bunny",
    "character-cat",
    "character-puppy",
    "character-bear",
    "character-fox",
    "character-hamster",
    "character-crocodile",
    "character-duck",
    "character-tiger",
    "character-dinosaur",
    "character-monkey",
    "character-gorilla",
)
GHOSTS = (
    "wanderer",
    "swift",
    "brute",
    "caster",
    "twin-a",
    "twin-b",
    "teleporter",
    "undead",
    "giant",
)


def validate_transparency(path: Path) -> None:
    with Image.open(path) as image:
        rgba = image.convert("RGBA")
        alpha = rgba.getchannel("A")
        minimum, maximum = alpha.getextrema()
        if minimum != 0 or maximum == 0:
            raise ValueError(f"Invalid alpha range {minimum}..{maximum}: {path}")
        corners = (
            alpha.getpixel((0, 0)),
            alpha.getpixel((alpha.width - 1, 0)),
            alpha.getpixel((0, alpha.height - 1)),
            alpha.getpixel((alpha.width - 1, alpha.height - 1)),
        )
        if any(corner != 0 for corner in corners):
            raise ValueError(f"Opaque frame corner {corners}: {path}")


def expect_frames(directory: Path, count: int) -> list[Path]:
    frames = sorted(directory.glob("*.png"))
    if len(frames) != count:
        raise ValueError(f"Expected {count} frames, found {len(frames)}: {directory}")
    return frames


def main() -> None:
    concepts: list[Path] = []
    frames: list[Path] = []

    for survivor in SURVIVORS:
        directory = SPRITE_ROOT / "survivors" / survivor
        concepts.append(directory / "concept.png")
        frames.extend(expect_frames(directory / "frames", 12))

    for ghost in GHOSTS:
        directory = SPRITE_ROOT / "ghosts" / ghost
        concepts.append(directory / "concept.png")
        frames.extend(expect_frames(directory / "movement", 12))
        frames.extend(expect_frames(directory / "attack", 9))

    if len(concepts) != 21:
        raise ValueError(f"Expected 21 concepts, found {len(concepts)}")
    if len(frames) != 333:
        raise ValueError(f"Expected 333 animation frames, found {len(frames)}")

    for path in (*concepts, *frames):
        if not path.exists():
            raise FileNotFoundError(path)
        validate_transparency(path)

    print(f"concepts={len(concepts)} frames={len(frames)} transparent_pngs={len(concepts) + len(frames)}")


if __name__ == "__main__":
    main()
