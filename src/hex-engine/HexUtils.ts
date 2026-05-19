export interface Hex {
  q: number;
  r: number;
}

export interface Point {
  x: number;
  y: number;
}

export class HexUtils {
  static size = 40; // Pixels from center to corner

  // Flat-top hex constants. Hexes are rotated 30° from the "pointy-top" convention:
  // flat edges face north/south, vertices point east/west. Axial neighbour offsets
  // remain the standard 6 (`directions` below); only the q/r→pixel mapping changes.
  private static readonly SQRT3 = Math.sqrt(3);

  /**
   * Converts axial coordinates (q, r) to pixel coordinates (x, y)
   * for a flat-top hexagonal grid.
   */
  static hexToPixel(hex: Hex): Point {
    const x = this.size * (1.5 * hex.q);
    const y = this.size * ((this.SQRT3 / 2) * hex.q + this.SQRT3 * hex.r);
    return { x, y };
  }

  /**
   * Converts pixel coordinates (x, y) to fractional axial coordinates (q, r)
   */
  static pixelToHex(point: Point): Hex {
    const q = ((2 / 3) * point.x) / this.size;
    const r = ((-1 / 3) * point.x + (this.SQRT3 / 3) * point.y) / this.size;
    return this.hexRound({ q, r });
  }

  /**
   * Rounds fractional axial coordinates to the nearest hex coordinate.
   */
  static hexRound(fractional: Hex): Hex {
    let q = Math.round(fractional.q);
    let r = Math.round(fractional.r);
    const s = Math.round(-fractional.q - fractional.r);

    const qDiff = Math.abs(q - fractional.q);
    const rDiff = Math.abs(r - fractional.r);
    const sDiff = Math.abs(s - (-fractional.q - fractional.r));

    if (qDiff > rDiff && qDiff > sDiff) {
      q = -r - s;
    } else if (rDiff > sDiff) {
      r = -q - s;
    }

    return { q, r };
  }

  /**
   * Returns the axial distance between two hexes.
   */
  static distance(a: Hex, b: Hex): number {
    return (Math.abs(a.q - b.q) +
      Math.abs(a.q + a.r - (b.q + b.r)) +
      Math.abs(a.r - b.r)) / 2;
  }

  /**
   * Axial neighbors (q, r)
   */
  static readonly directions: Hex[] = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
  ];

  static getNeighbors(hex: Hex): Hex[] {
    return this.directions.map(dir => ({
      q: hex.q + dir.q,
      r: hex.r + dir.r
    }));
  }

  /**
   * Formats hex coordinates for use as Map/Object keys.
   */
  static key(hex: Hex): string {
    return `${hex.q},${hex.r}`;
  }

  static fromKey(key: string): Hex {
    const [q, r] = key.split(',').map(Number);
    return { q, r };
  }

  /**
   * Hexes along a straight line from `a` to `b`, in order. Linear interpolation in axial
   * coords, each step rounded with `hexRound`. Returns `distance(a, b) + 1` hexes, with
   * `result[0] === a` (rounded) and `result[result.length - 1] === b` (rounded).
   */
  static hexLine(a: Hex, b: Hex): Hex[] {
    const n = this.distance(a, b);
    if (n === 0) return [a];
    const result: Hex[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      result.push(this.hexRound({
        q: a.q * (1 - t) + b.q * t,
        r: a.r * (1 - t) + b.r * t,
      }));
    }
    return result;
  }
}
