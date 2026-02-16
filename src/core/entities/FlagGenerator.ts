/**
 * @module FlagGenerator
 * @description Generates simple procedural flag patterns for nations.
 *
 * Flags are stored as data (pattern type + colours) rather than as
 * rasterised images, so they can be rendered at any size later.
 *
 * @example
 * ```ts
 * const gen = new FlagGenerator(42)
 * const flag = gen.generate() // → { type: 'cross', background: ..., accent: ... }
 * ```
 */
import alea from 'alea'
import type { FlagPattern } from './Nation'

const PATTERN_TYPES: FlagPattern['type'][] = [
  'solid',
  'horizontal_stripes',
  'vertical_stripes',
  'cross',
  'diagonal',
  'quartered'
]

export class FlagGenerator {
  private rng: () => number

  constructor(seed: string | number) {
    this.rng = alea(`${seed}-flags`)
  }

  /** Random hue 0–360. */
  private randomHue(): number {
    return this.rng() * 360
  }

  /** Generate a random HSL tuple with decent saturation/lightness. */
  private randomHSL(): [number, number, number] {
    return [
      this.randomHue(),
      0.45 + this.rng() * 0.4, // 0.45–0.85
      0.3 + this.rng() * 0.35 // 0.3–0.65
    ]
  }

  /** Generate a flag pattern for a nation. */
  generate(): FlagPattern {
    const type = PATTERN_TYPES[Math.floor(this.rng() * PATTERN_TYPES.length)]
    const background = this.randomHSL()
    const accent = this.randomHSL()

    // Ensure accent hue is at least 60° away from background
    if (Math.abs(accent[0] - background[0]) < 60) {
      accent[0] = (background[0] + 120 + this.rng() * 120) % 360
    }

    const flag: FlagPattern = { type, background, accent }

    // Some patterns get a detail colour
    if (type === 'quartered' || (type === 'cross' && this.rng() > 0.5)) {
      const detail = this.randomHSL()
      detail[0] = (accent[0] + 90 + this.rng() * 90) % 360
      flag.detail = detail
    }

    return flag
  }
}
