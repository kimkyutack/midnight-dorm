#!/usr/bin/env python3
"""Normalize generated paper-doll base sheets into the runtime atlas contract.

Image generation returns a 4x3 sheet with small differences in its outer
dimensions.  The renderer, however, needs every character to use exactly the
same 362px cell, a stable horizontal torso anchor, and a shared floor line.
This script keeps only the main connected silhouette inside each generated
cell (discarding occasional edge fragments), then rebuilds a clean 4x3 atlas.
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
BASE_ROOT = ROOT / "public" / "assets" / "paperdoll" / "bases"
SOURCE_ROOT = ROOT / "scripts" / "paperdoll-source"
SURVIVORS = (
    "character-bunny", "character-cat", "character-puppy", "character-bear",
    "character-fox", "character-hamster", "character-crocodile", "character-duck",
    "character-tiger", "character-dinosaur", "character-monkey", "character-gorilla",
)
CANVAS = 362
FLOOR = 348
MAX_WIDTH = 332
MAX_HEIGHT = 320

# A tail should not pull the character's torso away from the common centre.
# The source fox faces slightly left to leave room for its tail, so move its
# torso back to the shared anchor.  Other silhouettes already use the cell
# centre and must not drift when this script is re-run.
TORSO_X_SHIFTS = {"character-fox": 18}
FACE_OVALS = {
    "character-bunny": (181, 160, 72, 48), "character-cat": (181, 156, 72, 50),
    "character-puppy": (181, 158, 86, 50), "character-bear": (181, 154, 74, 48),
    "character-fox": (181, 152, 74, 46), "character-hamster": (181, 154, 80, 48),
    "character-crocodile": (181, 154, 90, 48), "character-duck": (181, 148, 80, 46),
    "character-tiger": (181, 152, 76, 48), "character-dinosaur": (181, 152, 80, 48),
    "character-monkey": (181, 158, 72, 48), "character-gorilla": (181, 156, 82, 48),
}


def largest_component(image: Image.Image) -> Image.Image:
    """Drop detached leftovers generated near a neighbouring atlas cell."""
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    width, height = rgba.size
    pixels = alpha.load()
    visited: set[tuple[int, int]] = set()
    largest: list[tuple[int, int]] = []
    for y in range(height):
        for x in range(width):
            if pixels[x, y] <= 20 or (x, y) in visited:
                continue
            component: list[tuple[int, int]] = []
            queue: deque[tuple[int, int]] = deque([(x, y)])
            visited.add((x, y))
            while queue:
                current_x, current_y = queue.popleft()
                component.append((current_x, current_y))
                for next_y in range(max(0, current_y - 1), min(height, current_y + 2)):
                    for next_x in range(max(0, current_x - 1), min(width, current_x + 2)):
                        if pixels[next_x, next_y] <= 20 or (next_x, next_y) in visited:
                            continue
                        visited.add((next_x, next_y))
                        queue.append((next_x, next_y))
            if len(component) > len(largest):
                largest = component
    if not largest:
        raise ValueError("Paper-doll cell has no visible pixels")
    keep = Image.new("L", rgba.size)
    keep_pixels = keep.load()
    for x, y in largest:
        keep_pixels[x, y] = pixels[x, y]
    rgba.putalpha(keep)
    return rgba


def remove_chroma_background(image: Image.Image) -> Image.Image:
    """Convert the generated magenta sheet background into transparent pixels."""
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            red, green, blue, alpha = pixels[x, y]
            # Generated sheets retain a dark-purple antialiasing fringe around
            # the #ff00ff background.  Remove that fringe as well, while
            # keeping warm pink ears and natural skin tones intact.
            is_magenta = (
                red > 140 and blue > 140 and green < 105
            ) or (
                red + blue > 120 and red > green * 1.4 and blue > green * 1.6
            )
            if is_magenta:
                pixels[x, y] = (red, green, blue, 0)
            elif alpha != 255:
                pixels[x, y] = (red, green, blue, alpha)
    return rgba


def cell_box(sheet: Image.Image, row: int, column: int) -> tuple[int, int, int, int]:
    width, height = sheet.size
    return (
        round(column * width / 4),
        round(row * height / 3),
        round((column + 1) * width / 4),
        round((row + 1) * height / 3),
    )


def rebuild_character(character_id: str) -> None:
    directory = BASE_ROOT / character_id
    source_path = SOURCE_ROOT / f"{character_id}-sheet-chroma.png"
    if not source_path.exists():
        raise FileNotFoundError(f"Missing paper-doll source sheet: {source_path}")
    source = remove_chroma_background(Image.open(source_path))
    cells: dict[tuple[int, int], tuple[Image.Image, tuple[int, int, int, int], tuple[int, int]]] = {}
    crops: list[Image.Image] = []
    for row in range(3):
        for column in range(4):
            box = cell_box(source, row, column)
            cell = largest_component(source.crop(box))
            bounds = cell.getchannel("A").getbbox()
            if bounds is None:
                raise ValueError(f"Empty paper-doll cell: {character_id} {row}:{column}")
            crop = cell.crop(bounds)
            cells[(row, column)] = (crop, bounds, cell.size)
            crops.append(crop)
    scale = min(1, MAX_WIDTH / max(crop.width for crop in crops), MAX_HEIGHT / max(crop.height for crop in crops))
    normalized: dict[tuple[int, int], Image.Image] = {}
    for key, (crop, bounds, cell_size) in cells.items():
        if scale != 1:
            crop = crop.resize((round(crop.width * scale), round(crop.height * scale)), Image.Resampling.LANCZOS)
        left, _top, right, bottom = bounds
        cell_width, cell_height = cell_size
        # Preserve the generated cell centre rather than recentering the alpha
        # bounds.  A lifted foot or a tail must not move the torso sideways.
        body_center = cell_width / 2 - TORSO_X_SHIFTS.get(character_id, 0)
        x = round(CANVAS / 2 + (left - body_center) * scale)
        y = round(FLOOR - (cell_height - bottom) * scale - crop.height)
        canvas = Image.new("RGBA", (CANVAS, CANVAS))
        canvas.alpha_composite(crop, (x, y))
        normalized[key] = canvas

    frames_dir = directory / "frames"
    frames_dir.mkdir(exist_ok=True)
    directions = ("front", "back", "side")
    actions = ("idle", "walk-1", "walk-2", "walk-3")
    atlas = Image.new("RGBA", (CANVAS * 4, CANVAS * 3))
    face_atlas = Image.new("RGBA", (CANVAS * 4, CANVAS * 3))
    center_x, center_y, radius_x, radius_y = FACE_OVALS[character_id]
    for row, direction in enumerate(directions):
        for column, action in enumerate(actions):
            frame = normalized[(row, column)]
            frame.save(frames_dir / f"{direction}-{action}.png", optimize=True)
            atlas.alpha_composite(frame, (column * CANVAS, row * CANVAS))
            # A high collar must not cover the face.  Preserve the lower head
            # as a small foreground cutout, while leaving ears/hair available
            # for the hat layer that is rendered afterwards.
            mask = Image.new("L", (CANVAS, CANVAS))
            ImageDraw.Draw(mask).ellipse(
                (center_x - radius_x, center_y - radius_y, center_x + radius_x, center_y + radius_y),
                fill=255,
            )
            face = frame.copy()
            face.putalpha(ImageChops.multiply(frame.getchannel("A"), mask))
            face_atlas.alpha_composite(face, (column * CANVAS, row * CANVAS))
    atlas.save(directory / "movement-sheet.png", optimize=True)
    face_atlas.save(directory / "face-overlay-sheet.png", optimize=True)
    normalized[(0, 0)].save(directory / "concept.png", optimize=True)


def main() -> None:
    for survivor in SURVIVORS:
        rebuild_character(survivor)
    print(f"normalized paper-doll bases={len(SURVIVORS)} cells={len(SURVIVORS) * 12}")


if __name__ == "__main__":
    main()
