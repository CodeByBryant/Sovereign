/**
 * @module ColorGenerator
 * @description Generates visually distinct nation colours.
 *
 * Uses golden-angle hue spacing in HSL space to maximise perceptual
 * distance between successive colours.  A minimum-distance check against
 * already-used colours prevents near-duplicates.
 *
 * @example
 * ```ts
 * const gen = new ColorGenerator(42)
 * const [r, g, b] = gen.generate() // → [180, 60, 90]
 * ```
 */
import alea from 'alea'

/**
 * Convert HSL (hue 0–360, saturation/lightness 0–1) to RGB 0–255.
 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0

  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }

  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

/** Squared Euclidean distance between two RGB colours. */
function colorDistSq(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return dr * dr + dg * dg + db * db
}

export class ColorGenerator {
  private rng: () => number
  private usedColors: Array<[number, number, number]> = []
  /** Golden angle in degrees for hue spacing. */
  private hueOffset: number
  private index = 0

  /** Minimum squared RGB distance required between any two nation colours. */
  private static MIN_DIST_SQ = 2500 // ~50 units in RGB space

  constructor(seed: string | number) {
    this.rng = alea(`${seed}-colors`)
    // Randomise starting hue so different seeds feel different
    this.hueOffset = this.rng() * 360
  }

  /**
   * Generate a distinct RGB colour.
   *
   * Tries golden-angle-based hue first, then random perturbations if
   * the candidate is too close to an existing colour.
   */
  generate(): [number, number, number] {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const hue = (this.hueOffset + this.index * 137.508 + attempt * 47) % 360
      const saturation = 0.55 + this.rng() * 0.3 // 0.55–0.85
      const lightness = 0.38 + this.rng() * 0.22 // 0.38–0.60

      const rgb = hslToRgb(hue, saturation, lightness)

      // Check distance against all existing colours
      let tooClose = false
      for (const existing of this.usedColors) {
        if (colorDistSq(rgb, existing) < ColorGenerator.MIN_DIST_SQ) {
          tooClose = true
          break
        }
      }

      if (!tooClose) {
        this.usedColors.push(rgb)
        this.index += 1
        return rgb
      }
    }

    // Fallback: accept anyway
    const hue = (this.hueOffset + this.index * 137.508) % 360
    const rgb = hslToRgb(hue, 0.6, 0.45)
    this.usedColors.push(rgb)
    this.index += 1
    return rgb
  }

  /**
   * Generate an HSL colour for flag use — returns [H, S, L] directly.
   */
  generateHSL(): [number, number, number] {
    const hue = (this.hueOffset + this.index * 97 + this.rng() * 60) % 360
    const sat = 0.5 + this.rng() * 0.35
    const lit = 0.35 + this.rng() * 0.3
    this.index += 1
    return [hue, sat, lit]
  }
}
