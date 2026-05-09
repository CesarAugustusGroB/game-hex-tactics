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

  // Pointy-top hex constants
  private static readonly SQRT3 = Math.sqrt(3);

  /**
   * Converts axial coordinates (q, r) to pixel coordinates (x, y)
   * for a pointy-top hexagonal grid.
   */
  static hexToPixel(hex: Hex): Point {
    const x = this.size * (this.SQRT3 * hex.q + (this.SQRT3 / 2) * hex.r);
    const y = this.size * (1.5 * hex.r);
    return { x, y };
  }

  /**
   * Converts pixel coordinates (x, y) to fractional axial coordinates (q, r)
   */
  static pixelToHex(point: Point): Hex {
    const q = ((this.SQRT3 / 3) * point.x - (1 / 3) * point.y) / this.size;
    const r = ((2 / 3) * point.y) / this.size;
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
}
