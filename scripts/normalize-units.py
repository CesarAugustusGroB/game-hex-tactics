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
    import numpy as np
except ModuleNotFoundError as exc:
    raise SystemExit(
        "Pillow + numpy are required. Install with: python -m pip install Pillow numpy"
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
    # Scale by the dense body, not the full bbox, so thin protrusions (spears/sarissas)
    # don't shrink the figure. The body is also what gets centred — the weapon may clip.
    body_scale: bool = False


# A row/column counts toward the "body" if its opaque-pixel mass is at least this
# fraction of the densest row/column. A lone sarissa lights up few pixels per row, so
# its rows fall below the cut and don't define the size — the torso+shield mass does.
CORE_MASS_FRAC = 0.22


# Raw originals live outside the shipped bundle (art-source/), so the ~13 MB of
# pre-normalization art is not deployed in public/. Output still lands in public/units/normalized/.
DEFAULT_SOURCE_DIR = Path("art-source/originals")
DEFAULT_OUTPUT_DIR = Path("public/units/normalized")
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


def core_box(image: Image.Image) -> tuple[float, float, int]:
    """Centre (cx, cy) and size of the dense body, ignoring thin protrusions.

    Returns the longer side of the core box so the caller can scale to it.
    """
    op = np.asarray(image.getchannel("A")) > ALPHA_THRESHOLD
    rows = op.sum(axis=1)
    cols = op.sum(axis=0)
    if rows.max() == 0:
        h, w = op.shape
        return w / 2, h / 2, max(w, h)
    rmask = rows >= rows.max() * CORE_MASS_FRAC
    cmask = cols >= cols.max() * CORE_MASS_FRAC
    r = np.flatnonzero(rmask)
    c = np.flatnonzero(cmask)
    r0, r1, c0, c1 = r[0], r[-1], c[0], c[-1]
    core_h, core_w = r1 - r0 + 1, c1 - c0 + 1
    return (c0 + c1) / 2, (r0 + r1) / 2, int(max(core_h, core_w))


def normalize_unit(job: UnitJob) -> tuple[Path, tuple[int, int], tuple[int, int]]:
    src = (ROOT / job.src).resolve() if not job.src.is_absolute() else job.src
    out = (ROOT / job.out).resolve() if not job.out.is_absolute() else job.out

    image = Image.open(src).convert("RGBA")
    if job.rotate:
        image = image.rotate(job.rotate, expand=True, resample=Image.Resampling.BICUBIC)

    image = image.crop(alpha_bbox(image))
    width, height = image.size
    if max(width, height) == 0:
        raise ValueError(f"{src} has empty dimensions")

    # `measure` is the dimension we scale to target: the body in body_scale mode (so a
    # sarissa doesn't shrink the torso), else the full bbox. `anchor` is what gets centred.
    if job.body_scale:
        core_cx, core_cy, measure = core_box(image)
    else:
        measure = max(width, height)
        core_cx, core_cy = width / 2, height / 2

    scale = job.target_size / measure
    resized_size = (max(1, round(width * scale)), max(1, round(height * scale)))
    image = image.resize(resized_size, Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (job.canvas_size, job.canvas_size), (0, 0, 0, 0))
    # Centre the body anchor on the canvas; thin protrusions may overflow and clip.
    x = round(job.canvas_size / 2 - core_cx * scale)
    y = round(job.canvas_size / 2 - core_cy * scale)
    canvas.paste(image, (x, y), image)  # paste clips negative/overflow; mask = own alpha

    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out)
    return out, (width, height), resized_size


def default_jobs() -> Iterable[UnitJob]:
    unit_dir = ROOT / DEFAULT_SOURCE_DIR
    for src in sorted(unit_dir.glob("*.png")):
        if src.name in SKIP_DEFAULT_NAMES:
            continue
        yield UnitJob(
            DEFAULT_SOURCE_DIR / src.name,
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
    parser.add_argument("--body-scale", action="store_true", help="Scale/centre on the dense body, ignoring thin spears/sarissas (they may clip).")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if bool(args.input) != bool(args.output):
        raise SystemExit("Provide both input and output, or neither to run the default unit batch.")

    jobs = [
        UnitJob(args.input, args.output, rotate=args.rotate, target_size=args.target_size,
                canvas_size=args.canvas_size, body_scale=args.body_scale)
    ] if args.input and args.output else list(default_jobs())

    for job in jobs:
        out, cropped_size, resized_size = normalize_unit(job)
        print(f"{out.relative_to(ROOT)}  crop={cropped_size[0]}x{cropped_size[1]}  sprite={resized_size[0]}x{resized_size[1]}")


if __name__ == "__main__":
    main()
