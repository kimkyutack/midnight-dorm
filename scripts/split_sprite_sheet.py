#!/usr/bin/env python3
"""Split generated chroma-key sprite sheets into consistently named PNG frames."""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path
from PIL import Image


DIRECTIONS = ("front", "back", "side")
MOVEMENT_COLUMNS = ("idle", "walk-1", "walk-2", "walk-3")
ATTACK_COLUMNS = ("attack-1", "attack-2", "attack-3")
SKILL_PREPARE_COLUMNS = ("prepare-1", "prepare-2", "prepare-3")
SKILL_CAST_COLUMNS = ("cast-1", "cast-2", "cast-3")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument(
        "--kind",
        required=True,
        choices=("movement", "attack", "skill-prepare", "skill-cast"),
    )
    parser.add_argument(
        "--square-cells",
        action="store_true",
        help="Center rectangular source cells on a transparent square canvas.",
    )
    parser.add_argument(
        "--atlas-output",
        type=Path,
        help="Optionally rebuild a transparent atlas from the split frames.",
    )
    parser.add_argument(
        "--remove-edge-components",
        action="store_true",
        help="Remove disconnected artwork leaking in from adjacent generated cells.",
    )
    return parser.parse_args()


def remove_edge_components(image: Image.Image, threshold: int = 8) -> Image.Image:
    """Keep the centered subject while clearing neighbouring-cell fragments."""
    output = image.copy()
    alpha = output.getchannel("A")
    pixels = alpha.load()
    width, height = alpha.size
    visited: set[tuple[int, int]] = set()
    components: list[list[tuple[int, int]]] = []
    for start_y in range(height):
        for start_x in range(width):
            if (start_x, start_y) in visited or pixels[start_x, start_y] <= threshold:
                continue
            queue: deque[tuple[int, int]] = deque([(start_x, start_y)])
            component: list[tuple[int, int]] = []
            visited.add((start_x, start_y))
            while queue:
                x, y = queue.popleft()
                component.append((x, y))
                for offset_x, offset_y in (
                    (-1, -1), (0, -1), (1, -1),
                    (-1, 0),             (1, 0),
                    (-1, 1),  (0, 1),   (1, 1),
                ):
                    next_x = x + offset_x
                    next_y = y + offset_y
                    if (
                        0 <= next_x < width
                        and 0 <= next_y < height
                        and (next_x, next_y) not in visited
                        and pixels[next_x, next_y] > threshold
                    ):
                        visited.add((next_x, next_y))
                        queue.append((next_x, next_y))
            components.append(component)

    largest_area = max((len(component) for component in components), default=0)
    minimum_detail_area = max(8, round(largest_area * 0.002))
    for component in components:
        center_x = sum(x for x, _ in component) / len(component)
        center_y = sum(y for _, y in component) / len(component)
        is_subject = len(component) == largest_area
        is_centered_detail = (
            len(component) >= minimum_detail_area
            and width * 0.10 <= center_x <= width * 0.90
            and height * 0.04 <= center_y <= height * 0.98
        )
        if is_subject or is_centered_detail:
            continue
        for x, y in component:
            pixels[x, y] = 0
    output.putalpha(alpha)
    return output


def main() -> None:
    args = parse_args()
    columns = {
        "movement": MOVEMENT_COLUMNS,
        "attack": ATTACK_COLUMNS,
        "skill-prepare": SKILL_PREPARE_COLUMNS,
        "skill-cast": SKILL_CAST_COLUMNS,
    }[args.kind]
    image = Image.open(args.input).convert("RGBA")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    frames: dict[tuple[int, int], Image.Image] = {}

    for row, direction in enumerate(DIRECTIONS):
        top = round(row * image.height / len(DIRECTIONS))
        bottom = round((row + 1) * image.height / len(DIRECTIONS))
        for column, action in enumerate(columns):
            left = round(column * image.width / len(columns))
            right = round((column + 1) * image.width / len(columns))
            frame = image.crop((left, top, right, bottom))
            if args.remove_edge_components:
                frame = remove_edge_components(frame)
            if args.square_cells and frame.width != frame.height:
                cell_size = max(frame.width, frame.height)
                square = Image.new("RGBA", (cell_size, cell_size))
                square.alpha_composite(
                    frame,
                    ((cell_size - frame.width) // 2, (cell_size - frame.height) // 2),
                )
                frame = square
            frame.save(args.output_dir / f"{direction}-{action}.png", optimize=True)
            frames[(row, column)] = frame

    if args.atlas_output:
        first = frames[(0, 0)]
        atlas = Image.new(
            "RGBA",
            (first.width * len(columns), first.height * len(DIRECTIONS)),
        )
        for (row, column), frame in frames.items():
            atlas.alpha_composite(frame, (column * first.width, row * first.height))
        args.atlas_output.parent.mkdir(parents=True, exist_ok=True)
        atlas.save(args.atlas_output, optimize=True)

    if args.kind == "movement":
        concept = Image.open(args.output_dir / "front-idle.png").convert("RGBA")
        concept.save(args.output_dir.parent / "concept.png", optimize=True)


if __name__ == "__main__":
    main()
