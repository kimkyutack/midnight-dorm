"""Split upgrade sprite sheets into centered, transparent building PNGs.

The generated sheets use magenta (and occasionally white) gutters. Each cell
is isolated, edge-connected gutter pixels are made transparent, and the real
art bounds are centred on a fixed 512px canvas. This gives all levels an
identical visual anchor in gameplay while preserving their distinct designs.
"""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image


CANVAS = 512
FIT = 438


def is_background(pixel: tuple[int, int, int]) -> bool:
    red, green, blue = pixel
    # Include the fuchsia anti-alias fringe around the generated cells. The
    # flood-fill is edge-only, so internal purple crystals remain intact.
    magenta = red > 120 and green < 165 and blue > 100 and red + blue > 270
    white = red > 242 and green > 242 and blue > 242
    return magenta or white


def remove_edge_background(cell: Image.Image) -> Image.Image:
    rgb = cell.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def enqueue(x: int, y: int) -> None:
        index = y * width + x
        if not visited[index] and is_background(pixels[x, y]):
            visited[index] = 1
            queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height:
                enqueue(nx, ny)

    rgba = rgb.convert("RGBA")
    alpha = rgba.getchannel("A")
    alpha_data = alpha.load()
    for y in range(height):
        for x in range(width):
            if visited[y * width + x]:
                alpha_data[x, y] = 0
    rgba.putalpha(alpha)
    return strip_chroma_fringe(remove_small_islands(rgba))


def strip_chroma_fringe(image: Image.Image) -> Image.Image:
    """Remove fuchsia pixels that are attached to the art as a thin matte."""
    rgb = image.convert("RGB")
    alpha = image.getchannel("A")
    width, height = image.size
    for _ in range(2):
        alpha_data = alpha.load()
        clear: list[tuple[int, int]] = []
        for y in range(1, height - 1):
            for x in range(1, width - 1):
                if alpha_data[x, y] == 0 or not is_background(rgb.getpixel((x, y))):
                    continue
                if any(
                    alpha_data[nx, ny] == 0
                    for nx, ny in (
                        (x - 1, y - 1), (x, y - 1), (x + 1, y - 1),
                        (x - 1, y), (x + 1, y),
                        (x - 1, y + 1), (x, y + 1), (x + 1, y + 1),
                    )
                ):
                    clear.append((x, y))
        for x, y in clear:
            alpha_data[x, y] = 0
    image.putalpha(alpha)
    # Pillow's RGBA resize filters blend RGB even when alpha is zero. Clear
    # the keyed colour first so no magenta fringe is introduced on resize.
    pixels = image.load()
    for y in range(height):
        for x in range(width):
            if pixels[x, y][3] == 0:
                pixels[x, y] = (0, 0, 0, 0)
    return image


def remove_small_islands(image: Image.Image) -> Image.Image:
    """Drop isolated grid-rule fragments while retaining the main building."""
    alpha = image.getchannel("A")
    width, height = image.size
    alpha_data = alpha.load()
    visited = bytearray(width * height)
    components: list[list[int]] = []

    for y in range(height):
        for x in range(width):
            start = y * width + x
            if visited[start] or alpha_data[x, y] == 0:
                continue
            visited[start] = 1
            queue: deque[tuple[int, int]] = deque([(x, y)])
            component: list[int] = []
            while queue:
                px, py = queue.popleft()
                component.append(py * width + px)
                for nx, ny in ((px - 1, py), (px + 1, py), (px, py - 1), (px, py + 1)):
                    if 0 <= nx < width and 0 <= ny < height:
                        index = ny * width + nx
                        if not visited[index] and alpha_data[nx, ny] > 0:
                            visited[index] = 1
                            queue.append((nx, ny))
            components.append(component)

    if not components:
        return image
    largest = max(len(component) for component in components)
    minimum = max(96, round(largest * 0.02))
    for component in components:
        if len(component) < minimum:
            for index in component:
                alpha_data[index % width, index // width] = 0
    image.putalpha(alpha)
    return image


def centred_art(cell: Image.Image) -> Image.Image:
    transparent = remove_edge_background(cell)
    bounds = transparent.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("No building art found after removing the sprite-sheet gutter")
    art = transparent.crop(bounds)
    scale = min(FIT / art.width, FIT / art.height)
    resized = art.resize(
        (max(1, round(art.width * scale)), max(1, round(art.height * scale))),
        Image.Resampling.LANCZOS,
    )
    output = Image.new("RGBA", (CANVAS, CANVAS))
    output.alpha_composite(
        resized,
        ((CANVAS - resized.width) // 2, (CANVAS - resized.height) // 2),
    )
    return strip_resample_fringe(output)


def strip_resample_fringe(image: Image.Image) -> Image.Image:
    """Remove the final one-pixel fuchsia matte introduced by Lanczos resize."""
    pixels = image.load()
    width, height = image.size
    for _ in range(2):
        clear: list[tuple[int, int]] = []
        for y in range(1, height - 1):
            for x in range(1, width - 1):
                red, green, blue, alpha = pixels[x, y]
                if alpha == 0 or not (red > 90 and green < 80 and blue > 100):
                    continue
                if any(
                    pixels[nx, ny][3] == 0
                    for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
                ):
                    clear.append((x, y))
        for x, y in clear:
            pixels[x, y] = (0, 0, 0, 0)
    return image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("atlas", type=Path)
    parser.add_argument("--kind", required=True)
    parser.add_argument("--columns", type=int, required=True)
    parser.add_argument("--rows", type=int, required=True)
    parser.add_argument("--levels", type=int, required=True)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "public" / "assets" / "buildings",
    )
    args = parser.parse_args()
    if args.levels > args.columns * args.rows:
        raise ValueError("levels cannot exceed the atlas grid capacity")

    atlas = Image.open(args.atlas).convert("RGB")
    args.output.mkdir(parents=True, exist_ok=True)
    for level in range(args.levels):
        row, column = divmod(level, args.columns)
        left = round(atlas.width * column / args.columns)
        right = round(atlas.width * (column + 1) / args.columns)
        top = round(atlas.height * row / args.rows)
        bottom = round(atlas.height * (row + 1) / args.rows)
        cell = atlas.crop((left, top, right, bottom))
        # Keep the artwork safe but exclude the deliberate sheet separators.
        inset = max(3, round(min(cell.size) * 0.012))
        cell = cell.crop((inset, inset, cell.width - inset, cell.height - inset))
        output = args.output / f"cute-{args.kind}-{level + 1}.png"
        centred_art(cell).save(output, optimize=True)
        print(output)


if __name__ == "__main__":
    main()
