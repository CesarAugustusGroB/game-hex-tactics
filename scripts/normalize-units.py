#!/usr/bin/env python3
"""Normalize tactical unit sprites onto a consistent square canvas.

Default usage:
  python scripts/normalize-units.py

Single-file usage:
  python scripts/normalize-units.py input.png output.png --rotate 180
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

try:
    from PIL import Image
except ModuleNotFoundError as exc:
    raise SystemExit(
        "Pillow is required. Install it with: python -m pip install Pillow"
    ) from exc


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CANVAS_SIZE = 160
DEFAULT_TARGET_SIZE = 128
ALPHA_THRESHOLD = 8
TYPE_TARGET_SIZES = {
    "cavalry": 144,
    "infantry": 132,
    "skirmisher": 124,
}


@dataclass(frozen=True)
class UnitJob:
    src: Path
    out: Path
    rotate: float = 0
    target_size: int = DEFAULT_TARGET_SIZE
    canvas_size: int = DEFAULT_CANVAS_SIZE


DEFAULT_UNIT_DIR = Path("public/units")
DEFAULT_OUTPUT_DIR = DEFAULT_UNIT_DIR / "normalized"
SKIP_DEFAULT_NAMES = {"javelin.png"}
ROTATE_BY_NAME = {
    "red-infantry.png": 180,
    "red-cavalry.png": 180,
    "roman_skirmisher.png": 180,
}


def unit_type_for_name(filename: str) -> str:
    stem = Path(filename).stem.lower()
    if "cavalry" in stem or "knight" in stem:
        return "cavalry"
    if "skirmisher" in stem:
        return "skirmisher"
    return "infantry"


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A")
    mask = alpha.point(lambda value: 255 if value > ALPHA_THRESHOLD else 0)
    bbox = mask.getbbox()
    if bbox is None:
        raise ValueError("input has no non-transparent pixels")
    return bbox


def normalize_unit(job: UnitJob) -> tuple[Path, tuple[int, int], tuple[int, int]]:
    src = (ROOT / job.src).resolve() if not job.src.is_absolute() else job.src
    out = (ROOT / job.out).resolve() if not job.out.is_absolute() else job.out

    image = Image.open(src).convert("RGBA")
    if job.rotate:
        image = image.rotate(job.rotate, expand=True, resample=Image.Resampling.BICUBIC)

    image = image.crop(alpha_bbox(image))
    width, height = image.size
    long_side = max(width, height)
    if long_side == 0:
        raise ValueError(f"{src} has empty dimensions")

    scale = job.target_size / long_side
    resized_size = (max(1, round(width * scale)), max(1, round(height * scale)))
    image = image.resize(resized_size, Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (job.canvas_size, job.canvas_size), (0, 0, 0, 0))
    x = (job.canvas_size - resized_size[0]) // 2
    y = (job.canvas_size - resized_size[1]) // 2
    canvas.alpha_composite(image, (x, y))

    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out)
    return out, (width, height), resized_size


def default_jobs() -> Iterable[UnitJob]:
    unit_dir = ROOT / DEFAULT_UNIT_DIR
    for src in sorted(unit_dir.glob("*.png")):
        if src.name in SKIP_DEFAULT_NAMES:
            continue
        yield UnitJob(
            DEFAULT_UNIT_DIR / src.name,
            DEFAULT_OUTPUT_DIR / src.name,
            rotate=ROTATE_BY_NAME.get(src.name, 0),
            target_size=TYPE_TARGET_SIZES[unit_type_for_name(src.name)],
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", type=Path, help="Optional source PNG for one-off normalization.")
    parser.add_argument("output", nargs="?", type=Path, help="Optional output PNG for one-off normalization.")
    parser.add_argument("--rotate", type=float, default=0, help="Degrees to rotate clockwise before trimming.")
    parser.add_argument("--target-size", type=int, default=DEFAULT_TARGET_SIZE, help="Visible long-side size in pixels.")
    parser.add_argument("--canvas-size", type=int, default=DEFAULT_CANVAS_SIZE, help="Square output canvas size in pixels.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if bool(args.input) != bool(args.output):
        raise SystemExit("Provide both input and output, or neither to run the default unit batch.")

    jobs = [
        UnitJob(args.input, args.output, rotate=args.rotate, target_size=args.target_size, canvas_size=args.canvas_size)
    ] if args.input and args.output else list(default_jobs())

    for job in jobs:
        out, cropped_size, resized_size = normalize_unit(job)
        print(f"{out.relative_to(ROOT)}  crop={cropped_size[0]}x{cropped_size[1]}  sprite={resized_size[0]}x{resized_size[1]}")


if __name__ == "__main__":
    main()
