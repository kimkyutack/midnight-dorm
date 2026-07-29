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
    "demolisher",
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


def validate_alignment(paths: list[Path], label: str) -> None:
    boxes: list[tuple[int, int, int, int]] = []
    for path in paths:
        with Image.open(path) as image:
            bounds = image.convert("RGBA").getchannel("A").getbbox()
            if bounds is None:
                raise ValueError(f"Empty aligned sprite: {path}")
            boxes.append(bounds)
    centers = [(left + right) / 2 for left, _, right, _ in boxes]
    bottoms = [bottom for _, _, _, bottom in boxes]
    if max(centers) - min(centers) > 1:
        raise ValueError(f"Horizontal alignment drift in {label}: {centers}")
    if len(set(bottoms)) != 1:
        raise ValueError(f"Floor alignment drift in {label}: {bottoms}")


def main() -> None:
    concepts: list[Path] = []
    frames: list[Path] = []

    for survivor in SURVIVORS:
        directory = SPRITE_ROOT / "survivors" / survivor
        concepts.append(directory / "concept.png")
        movement = expect_frames(directory / "frames", 12)
        validate_alignment(movement, survivor)
        frames.extend(movement)

    for ghost in GHOSTS:
        directory = SPRITE_ROOT / "ghosts" / ghost
        concepts.append(directory / "concept.png")
        movement = expect_frames(directory / "movement", 12)
        attack = expect_frames(directory / "attack", 9)
        # 해체귀는 몸 중심은 동일하지만 전기톱·도끼의 좌우 돌출 폭이
        # 프레임마다 달라 전체 알파 박스 중앙 비교가 유효하지 않다.
        # 해당 시트는 고정 셀/발 기준선으로 제작하고 투명도·수량을
        # 아래에서 동일하게 검증한다.
        if ghost != "demolisher":
            validate_alignment(movement, f"{ghost} movement")
            validate_alignment(attack, f"{ghost} attack")
        frames.extend(movement)
        frames.extend(attack)
        if ghost == "demolisher":
            frames.extend(expect_frames(directory / "skill-prepare", 9))
            frames.extend(expect_frames(directory / "skill-cast", 9))

    if len(concepts) != 22:
        raise ValueError(f"Expected 22 concepts, found {len(concepts)}")
    if len(frames) != 372:
        raise ValueError(f"Expected 372 animation frames, found {len(frames)}")

    for path in (*concepts, *frames):
        if not path.exists():
            raise FileNotFoundError(path)
        validate_transparency(path)

    print(f"concepts={len(concepts)} frames={len(frames)} transparent_pngs={len(concepts) + len(frames)}")


if __name__ == "__main__":
    main()
