#!/usr/bin/env python3
"""Normalize every transparent sprite to a shared visual anchor.

Generated sheets contain each pose at a slightly different X/Y offset.  This
tool recenters the visible pixels, keeps every animation on one floor line,
and rebuilds the atlas sheets used by the Three.js renderer.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / "public" / "assets" / "sprites"
DIRECTIONS = ("front", "back", "side")
MOVEMENT = ("idle", "walk-1", "walk-2", "walk-3")
ATTACK = ("attack-1", "attack-2", "attack-3")
SURVIVORS = (
    "character-bunny", "character-cat", "character-puppy", "character-bear",
    "character-fox", "character-hamster", "character-crocodile", "character-duck",
    "character-tiger", "character-dinosaur", "character-monkey", "character-gorilla",
)
GHOSTS = ("wanderer", "swift", "brute", "caster", "twin-a", "twin-b", "teleporter", "undead", "giant")
# Some silhouettes contain an intentionally off-body effect (for example the
# fox tail).  These offsets keep the actual torso, not the total alpha box,
# centered in catalog art.
CONCEPT_BODY_OFFSETS = {"character-fox": (18, 0)}


def visible_crop(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    bounds = image.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError(f"Empty sprite: {path}")
    return image.crop(bounds)


def floor_centered(crop: Image.Image, size: tuple[int, int], scale: float) -> Image.Image:
    """Return a same-size canvas whose visible pixels share the floor center."""
    width, height = size
    if scale != 1:
        crop = crop.resize(
            (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
            Image.Resampling.LANCZOS,
        )
    floor = round(height * 0.96)
    x = (width - crop.width) // 2
    y = floor - crop.height
    if x < 0 or y < 0 or x + crop.width > width or y + crop.height > height:
        raise ValueError(f"Pose does not fit its normalized canvas: {crop.size} in {size}")
    canvas = Image.new("RGBA", size)
    canvas.alpha_composite(crop, (x, y))
    return canvas


def centered_concept(path: Path, group: str, sprite_id: str) -> None:
    crop = visible_crop(path)
    canvas_size = 362
    max_width = 320 if group == "survivors" else 338
    max_height = 312 if group == "survivors" else 336
    scale = min(max_width / crop.width, max_height / crop.height)
    resized = crop.resize(
        (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (canvas_size, canvas_size))
    body_x_offset, body_y_offset = CONCEPT_BODY_OFFSETS.get(sprite_id, (0, 0))
    x = (canvas_size - resized.width) // 2 + body_x_offset
    y = round(canvas_size * 0.93) - resized.height + body_y_offset
    if x < 0 or y < 0 or x + resized.width > canvas_size or y + resized.height > canvas_size:
        raise ValueError(f"Concept does not fit its normalized canvas: {path}")
    canvas.alpha_composite(resized, (x, y))
    canvas.save(path, optimize=True)


def normalize_animation(directory: Path, actions: tuple[str, ...], sheet_name: str) -> None:
    source_paths = [directory / f"{direction}-{action}.png" for direction in DIRECTIONS for action in actions]
    source_size = Image.open(source_paths[0]).size
    crops = {path: visible_crop(path) for path in source_paths}
    max_width = max(crop.width for crop in crops.values())
    max_height = max(crop.height for crop in crops.values())
    floor = round(source_size[1] * 0.96)
    scale = min(1, (source_size[0] * 0.94) / max_width, floor / max_height)
    frames: dict[tuple[int, int], Image.Image] = {}
    for row, direction in enumerate(DIRECTIONS):
        for column, action in enumerate(actions):
            path = directory / f"{direction}-{action}.png"
            normalized = floor_centered(crops[path], source_size, scale)
            normalized.save(path, optimize=True)
            frames[(row, column)] = normalized

    first = frames[(0, 0)]
    sheet = Image.new("RGBA", (first.width * len(actions), first.height * len(DIRECTIONS)))
    for (row, column), frame in frames.items():
        sheet.alpha_composite(frame, (column * first.width, row * first.height))
    sheet.save(directory.parent / sheet_name, optimize=True)


def main() -> None:
    for survivor in SURVIVORS:
        root = SPRITES / "survivors" / survivor
        normalize_animation(root / "frames", MOVEMENT, "movement-sheet.png")
        centered_concept(root / "concept.png", "survivors", survivor)

    for ghost in GHOSTS:
        root = SPRITES / "ghosts" / ghost
        normalize_animation(root / "movement", MOVEMENT, "movement-sheet.png")
        normalize_animation(root / "attack", ATTACK, "attack-sheet.png")
        centered_concept(root / "concept.png", "ghosts", ghost)


if __name__ == "__main__":
    main()
