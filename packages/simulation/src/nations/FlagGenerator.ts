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
import type { RandomSource } from '../random/RandomSource'
import { createStream } from '../random/streams'
import type { FlagPattern } from '@sovereign/contracts'

const PATTERN_TYPES: FlagPattern['type'][] = [
  'solid',
  'horizontal_stripes',
  'vertical_stripes',
  'cross',
  'diagonal',
  'quartered'
]

export class FlagGenerator {
  private rng: RandomSource

  /** @param seed - The engine seed (a uint32, see `normalizeSeed`). */
  constructor(seed: number) {
    this.rng = createStream(seed, 'flags')
  }

  /** Random hue 0–360. */
  private randomHue(): number {
    return this.rng.float() * 360
  }

  /** Generate a random HSL tuple with decent saturation/lightness. */
  private randomHSL(): [number, number, number] {
    return [
      this.randomHue(),
      0.45 + this.rng.float() * 0.4, // 0.45–0.85
      0.3 + this.rng.float() * 0.35 // 0.3–0.65
    ]
  }

  /** Generate a flag pattern for a nation. */
  generate(): FlagPattern {
    const type = this.rng.choose(PATTERN_TYPES)
    const background = this.randomHSL()
    const accent = this.randomHSL()

    // Ensure accent hue is at least 60° away from background
    if (Math.abs(accent[0] - background[0]) < 60) {
      accent[0] = (background[0] + 120 + this.rng.float() * 120) % 360
    }

    const flag: FlagPattern = { type, background, accent }

    // Some patterns get a detail colour
    if (type === 'quartered' || (type === 'cross' && this.rng.float() > 0.5)) {
      const detail = this.randomHSL()
      detail[0] = (accent[0] + 90 + this.rng.float() * 90) % 360
      flag.detail = detail
    }

    return flag
  }
}
