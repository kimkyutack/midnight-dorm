#!/usr/bin/env python3
"""Build a compact roster preview from transparent concept sprites."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SPRITE_ROOT = ROOT / "public" / "assets" / "sprites"
OUTPUT = SPRITE_ROOT / "roster-preview.png"
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


def checkerboard(size: tuple[int, int], block: int = 14) -> Image.Image:
    image = Image.new("RGBA", size, "#101927")
    draw = ImageDraw.Draw(image)
    colors = ("#101927", "#162235")
    for y in range(0, size[1], block):
        for x in range(0, size[0], block):
            draw.rectangle(
                (x, y, min(x + block, size[0]), min(y + block, size[1])),
                fill=colors[(x // block + y // block) % 2],
            )
    return image


def load_trimmed(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    alpha_box = image.getchannel("A").getbbox()
    if alpha_box is None:
        raise ValueError(f"Empty sprite: {path}")
    return image.crop(alpha_box)


def main() -> None:
    columns = 7
    cell_width = 218
    cell_height = 250
    header_height = 64
    entries = [
        *(('survivors', item) for item in SURVIVORS),
        *(('ghosts', item) for item in GHOSTS),
    ]
    rows = (len(entries) + columns - 1) // columns
    output = checkerboard((columns * cell_width, header_height + rows * cell_height))
    draw = ImageDraw.Draw(output)
    font = ImageFont.load_default(size=17)
    small_font = ImageFont.load_default(size=14)
    draw.text((20, 16), "MIDNIGHT WARD - 21 SPRITE CONCEPTS", fill="#f7f9ff", font=font)
    draw.text((20, 39), "12 survivors / 9 ghosts", fill="#78dff1", font=small_font)

    for index, (group, sprite_id) in enumerate(entries):
        column = index % columns
        row = index // columns
        left = column * cell_width
        top = header_height + row * cell_height
        source = SPRITE_ROOT / group / sprite_id / "concept.png"
        sprite = load_trimmed(source)
        sprite.thumbnail((cell_width - 34, cell_height - 54), Image.Resampling.LANCZOS)
        x = left + (cell_width - sprite.width) // 2
        y = top + 10 + (cell_height - 48 - sprite.height) // 2
        output.alpha_composite(sprite, (x, y))
        label = sprite_id.removeprefix("character-")
        label_box = draw.textbbox((0, 0), label, font=small_font)
        label_width = label_box[2] - label_box[0]
        draw.rounded_rectangle(
            (left + 12, top + cell_height - 36, left + cell_width - 12, top + cell_height - 9),
            radius=10,
            fill="#0a101dcc",
            outline="#31445f",
        )
        draw.text(
            (left + (cell_width - label_width) // 2, top + cell_height - 31),
            label,
            fill="#dfeaff",
            font=small_font,
        )

    output.convert("RGB").save(OUTPUT, quality=92, optimize=True)
    print(OUTPUT)


if __name__ == "__main__":
    main()
