/**
 * Deterministic Mulberry32 PRNG + FNV-1a string seed hashing.
 * Guarantees the DETERMINISM gate: identical seed + tap log = byte-identical wall and score.
 */

export function hashSeedString(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) || 0x9e3779b9;
}

export class SeededRng {
  private state: number;

  constructor(seed: string | number) {
    this.state = typeof seed === 'number' ? (seed >>> 0) || 1 : hashSeedString(seed);
  }

  nextFloat(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(minInclusive: number, maxExclusive: number): number {
    if (maxExclusive <= minInclusive) return minInclusive;
    return minInclusive + Math.floor(this.nextFloat() * (maxExclusive - minInclusive));
  }

  clone(): SeededRng {
    const copy = new SeededRng(1);
    copy.state = this.state;
    return copy;
  }
}
