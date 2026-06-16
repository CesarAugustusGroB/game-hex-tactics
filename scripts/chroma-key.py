#!/usr/bin/env python3
"""Chroma-key the green/white studio background off raw unit art → transparent PNG.

The raw art (art-source/) has a flat bright-green backing with a soft drop shadow.
A naive green-hue key would also eat green cloaks/shields (Celts). So we remove only
the background-connected green: flood from the image border through "green-dominant"
pixels (which also covers the shadow), leaving interior green islands — the costume —
intact. A light despill kills the green fringe on kept edges.

  python scripts/chroma-key.py in.png out.png [--dr 18] [--white]
"""
from __future__ import annotations
import argparse
from pathlib import Path
import numpy as np
from PIL import Image


def border_connected_bg(greenish: np.ndarray) -> np.ndarray:
    """Pixels in `greenish` reachable (4-neighbour) from the image border."""
    cur = np.zeros_like(greenish)
    cur[0, :] |= greenish[0, :]; cur[-1, :] |= greenish[-1, :]
    cur[:, 0] |= greenish[:, 0]; cur[:, -1] |= greenish[:, -1]
    count = int(cur.sum())
    while True:
        nxt = cur.copy()
        nxt[1:, :]  |= cur[:-1, :]
        nxt[:-1, :] |= cur[1:, :]
        nxt[:, 1:]  |= cur[:, :-1]
        nxt[:, :-1] |= cur[:, 1:]
        nxt &= greenish
        c = int(nxt.sum())
        if c == count:
            return nxt
        cur, count = nxt, c


def chroma_key(src: Path, dst: Path, dr: int = 18, white_bg: bool = False) -> tuple[int, int]:
    rgb = np.asarray(Image.open(src).convert("RGB")).astype(np.int16)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    if white_bg:
        greenish = (r > 235) & (g > 235) & (b > 235)
    else:
        # green-dominant: covers the bright backing AND its darker drop-shadow
        greenish = ((g - r) > dr) & ((g - b) > dr)
    bg = border_connected_bg(greenish)
    alpha = np.where(bg, 0, 255).astype(np.uint8)

    out = np.dstack([rgb.astype(np.uint8), alpha])
    # despill: on kept pixels, clamp the green channel so no green halo survives
    keep = ~bg
    mx = np.maximum(out[..., 0], out[..., 2])
    spill = keep & (out[..., 1].astype(np.int16) > mx.astype(np.int16) + 12)
    out[..., 1] = np.where(spill, np.minimum(out[..., 1], mx + 12), out[..., 1])
    # zero RGB under transparent pixels so no green can bleed via mipmaps/bilinear filtering
    out[bg] = 0

    dst.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out, "RGBA").save(dst)
    kept = int(keep.sum())
    return kept, alpha.size


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("input", type=Path)
    ap.add_argument("output", type=Path)
    ap.add_argument("--dr", type=int, default=18, help="green-dominance threshold")
    ap.add_argument("--white", action="store_true", help="key a white backing instead of green")
    a = ap.parse_args()
    kept, total = chroma_key(a.input, a.output, a.dr, a.white)
    print(f"{a.output.name}  kept={kept/total*100:.1f}%")


if __name__ == "__main__":
    main()
