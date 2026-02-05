/**
 * Simple Perlin Noise implementation
 * Based on Ken Perlin's improved noise algorithm
 */

export class PerlinNoise {
  private permutation: number[];
  private p: number[];

  constructor(seed?: number) {
    // Initialize permutation table
    this.permutation = [];
    for (let i = 0; i < 256; i++) {
      this.permutation[i] = i;
    }

    // Shuffle if seed provided
    if (seed !== undefined) {
      this.shuffle(seed);
    } else {
      this.shuffle(Math.random() * 0xffffffff);
    }

    // Duplicate permutation to avoid overflow
    this.p = new Array(512);
    for (let i = 0; i < 512; i++) {
      this.p[i] = this.permutation[i & 255];
    }
  }

  private shuffle(seed: number): void {
    // Simple seeded shuffle
    let random = this.seededRandom(seed);
    for (let i = this.permutation.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [this.permutation[i], this.permutation[j]] = [this.permutation[j], this.permutation[i]];
    }
  }

  private seededRandom(seed: number): () => number {
    return function() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(t: number, a: number, b: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number): number {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : 0;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  /**
   * Get 2D Perlin noise value at coordinates
   */
  public noise2D(x: number, y: number): number {
    // Find unit square containing point
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;

    // Find relative x,y in square
    x -= Math.floor(x);
    y -= Math.floor(y);

    // Compute fade curves
    const u = this.fade(x);
    const v = this.fade(y);

    // Hash coordinates of square corners
    const a = this.p[X] + Y;
    const aa = this.p[a];
    const ab = this.p[a + 1];
    const b = this.p[X + 1] + Y;
    const ba = this.p[b];
    const bb = this.p[b + 1];

    // Blend results from corners
    return this.lerp(
      v,
      this.lerp(u, this.grad(this.p[aa], x, y), this.grad(this.p[ba], x - 1, y)),
      this.lerp(u, this.grad(this.p[ab], x, y - 1), this.grad(this.p[bb], x - 1, y - 1))
    );
  }
}

/**
 * Generate a 2D array of Perlin noise values
 */
export function generatePerlinNoise(
  width: number,
  height: number,
  options: {
    octaveCount?: number;
    amplitude?: number;
    persistence?: number;
    scale?: number;
  } = {}
): number[] {
  const {
    octaveCount = 6,
    amplitude = 1.0,
    persistence = 0.5,
    scale = 0.01
  } = options;

  const perlin = new PerlinNoise();
  const result: number[] = new Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      let amp = amplitude;
      let freq = scale;

      // Add multiple octaves
      for (let octave = 0; octave < octaveCount; octave++) {
        const sampleX = x * freq;
        const sampleY = y * freq;
        
        value += perlin.noise2D(sampleX, sampleY) * amp;
        
        amp *= persistence;
        freq *= 2;
      }

      result[y * width + x] = value;
    }
  }

  return result;
}
