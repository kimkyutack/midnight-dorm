#!/usr/bin/env python3
"""Build reusable 4x3 wearable atlases for the paper-doll renderer."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "assets" / "cosmetics" / "items"
OUTPUT = ROOT / "public" / "assets" / "paperdoll" / "layers"
CANVAS = 362
SURVIVORS = (
    "character-bunny", "character-cat", "character-puppy", "character-bear",
    "character-fox", "character-hamster", "character-crocodile", "character-duck",
    "character-tiger", "character-dinosaur", "character-monkey", "character-gorilla",
)
PROFILES = {
    "character-cat": "slim",
    "character-puppy": "broad",
    "character-hamster": "broad",
    "character-gorilla": "broad",
}
# Crown/cap art is intentionally sized for a readable portrait.  The anchor
# therefore follows each character's upper skull rather than its alpha bounds:
# floppy ears, muzzles and long hair must not push a brim over the eyes.
HEAD_Y = {
    "character-bunny": 116, "character-cat": 92, "character-puppy": 99,
    "character-bear": 112, "character-fox": 112, "character-hamster": 96,
    "character-crocodile": 97, "character-duck": 83, "character-tiger": 93,
    "character-dinosaur": 92, "character-monkey": 116, "character-gorilla": 108,
}
FITS = {
    "slim": {
        "outfit": (156, 172, 181, 252), "shoes": (120, 62, 181, 320),
        "scarf": (144, 74, 181, 208), "backpack": (134, 160, 181, 244),
        "star": (46, 46, 211, 226), "lantern": (68, 112, 252, 244),
    },
    "standard": {
        "outfit": (176, 176, 181, 250), "shoes": (136, 66, 181, 320),
        "scarf": (166, 78, 181, 208), "backpack": (154, 170, 181, 243),
        "star": (52, 52, 216, 224), "lantern": (76, 122, 260, 244),
    },
    "broad": {
        "outfit": (196, 182, 181, 250), "shoes": (152, 70, 181, 320),
        "scarf": (184, 82, 181, 208), "backpack": (174, 176, 181, 242),
        "star": (56, 56, 224, 224), "lantern": (82, 128, 270, 244),
    },
}
HAT_BOX = {
    # Keep brows and eyes clear in the large home/store portrait.  The first
    # prototype used the product-card dimensions here and placed every cap low
    # enough to cover the face on rounded heads.
    "hat-rank": (132, 96, -40), "hat-beanie": (138, 94, -35),
    "hat-moon-cap": (136, 96, -36), "hat-headlamp": (154, 64, -30),
    "hat-silver-crown": (142, 76, -52), "hat-gold-crown": (148, 80, -52),
    "hat-halo": (166, 80, -62),
}


def contain(image: Image.Image, width: int, height: int) -> Image.Image:
    scale = min(width / image.width, height / image.height)
    return image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)


def item_cutout(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    bounds = image.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError(f"Empty cosmetic item: {path}")
    return image.crop(bounds)


def draw_layer(canvas: Image.Image, source: Image.Image, box: tuple[int, int, int, int], direction: str, item_id: str) -> None:
    max_width, max_height, center_x, center_y = box
    image = source
    if direction == "side":
        side_ratio = 0.64 if item_id.startswith("outfit-") else 0.72
        max_width = round(max_width * side_ratio)
        center_x += round(max_width * 0.12)
    elif direction == "back":
        # The supplied product art is front-facing.  A restrained darkening
        # keeps the rear readable without pretending it is a bespoke back view.
        image = ImageEnhance.Brightness(image).enhance(0.8)
        if item_id.startswith("accessory-star"):
            return
    image = contain(image, max_width, max_height)
    canvas.alpha_composite(image, (round(center_x - image.width / 2), round(center_y - image.height / 2)))


def build_atlas(item_id: str, character_id: str | None, profile: str) -> Image.Image:
    source = item_cutout(SOURCE / f"{item_id}.png")
    slot = item_id.split("-", 1)[0]
    atlas = Image.new("RGBA", (CANVAS * 4, CANVAS * 3))
    for row, direction in enumerate(("front", "back", "side")):
        for column in range(4):
            frame = Image.new("RGBA", (CANVAS, CANVAS))
            if slot == "hat":
                if character_id is None:
                    raise ValueError("Hat layers need a character id")
                width, height, y_offset = HAT_BOX[item_id]
                center_y = HEAD_Y[character_id] + y_offset
                if direction == "side":
                    width = round(width * 0.74)
                elif direction == "back":
                    center_y += 3
                draw_layer(frame, source, (width, height, CANVAS // 2, center_y), direction, item_id)
            elif slot == "outfit":
                draw_layer(frame, source, FITS[profile]["outfit"], direction, item_id)
            elif slot == "shoes":
                draw_layer(frame, source, FITS[profile]["shoes"], direction, item_id)
            elif item_id == "accessory-backpack":
                draw_layer(frame, source, FITS[profile]["backpack"], direction, item_id)
            elif item_id == "accessory-scarf":
                draw_layer(frame, source, FITS[profile]["scarf"], direction, item_id)
            elif item_id == "accessory-star":
                draw_layer(frame, source, FITS[profile]["star"], direction, item_id)
            elif item_id == "accessory-lantern":
                draw_layer(frame, source, FITS[profile]["lantern"], direction, item_id)
            atlas.alpha_composite(frame, (column * CANVAS, row * CANVAS))
    return atlas


def main() -> None:
    items = [path.stem for path in sorted(SOURCE.glob("*.png"))]
    non_hat_items = [item for item in items if not item.startswith("hat-")]
    hats = [item for item in items if item.startswith("hat-")]
    built = 0
    for profile in ("slim", "standard", "broad"):
        directory = OUTPUT / "profiles" / profile
        directory.mkdir(parents=True, exist_ok=True)
        for item_id in non_hat_items:
            build_atlas(item_id, None, profile).save(directory / f"{item_id}.png", optimize=True)
            built += 1
    for character_id in SURVIVORS:
        directory = OUTPUT / "hats" / character_id
        directory.mkdir(parents=True, exist_ok=True)
        profile = PROFILES.get(character_id, "standard")
        for item_id in hats:
            build_atlas(item_id, character_id, profile).save(directory / f"{item_id}.png", optimize=True)
            built += 1
    print(f"paper-doll wearable atlases={built}")


if __name__ == "__main__":
    main()
