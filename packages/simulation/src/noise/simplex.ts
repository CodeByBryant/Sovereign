/**
 * @module simplex
 * @description 2D simplex noise built from exact operations only, seeded from a `RandomSource`.
 *
 * The permutation table is shuffled with the stream's `integer()` (Fisher-Yates, `i` from 0 to
 * 254 swapping with `i + integer(0, 255 - i)`), so the noise is fully determined by the stream.
 * Everything else is `+ - * /`, `Math.sqrt` and `Math.floor`, which are exact and identical on every
 * engine. Output is in about `[-1, 1]`. Specified in docs/simulation/determinism.md, section 6.
 */
import type { RandomSource } from '../random/RandomSource'

/** The 12 gradient directions (x, y pairs), indexed by `permutation % 12`. */
const GRAD_X = [1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0] as const
const GRAD_Y = [1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1] as const

const F2 = 0.5 * (Math.sqrt(3) - 1)
const G2 = (3 - Math.sqrt(3)) / 6
/** Scales the sum of the three corner contributions into about [-1, 1]. */
const SCALE = 70.14805770653952

/** Build a noise function `(x, y) => value` whose permutation comes from `random`. */
export function createSimplexNoise2D(random: RandomSource): (x: number, y: number) => number {
  const perm = new Uint8Array(512)
  for (let i = 0; i < 256; i += 1) perm[i] = i
  for (let i = 0; i < 255; i += 1) {
    const r = i + random.integer(0, 255 - i)
    const swap = perm[i] as number
    perm[i] = perm[r] as number
    perm[r] = swap
  }
  for (let i = 0; i < 256; i += 1) perm[256 + i] = perm[i] as number

  /** Contribution of one simplex corner at offset (dx, dy) with gradient index `g`. */
  const corner = (dx: number, dy: number, g: number): number => {
    let t = 0.5 - dx * dx - dy * dy
    if (t < 0) return 0
    t *= t
    return t * t * ((GRAD_X[g] as number) * dx + (GRAD_Y[g] as number) * dy)
  }

  return (x: number, y: number): number => {
    // Skew the input space to find which simplex cell we are in.
    const s = (x + y) * F2
    const i = Math.floor(x + s)
    const j = Math.floor(y + s)
    const t = (i + j) * G2
    const x0 = x - (i - t)
    const y0 = y - (j - t)

    // Which of the two triangles of the cell we are in.
    const i1 = x0 > y0 ? 1 : 0
    const j1 = x0 > y0 ? 0 : 1

    const x1 = x0 - i1 + G2
    const y1 = y0 - j1 + G2
    const x2 = x0 - 1 + 2 * G2
    const y2 = y0 - 1 + 2 * G2

    const ii = i & 255
    const jj = j & 255
    const g0 = (perm[ii + (perm[jj] as number)] as number) % 12
    const g1 = (perm[ii + i1 + (perm[jj + j1] as number)] as number) % 12
    const g2 = (perm[ii + 1 + (perm[jj + 1] as number)] as number) % 12

    return SCALE * (corner(x0, y0, g0) + corner(x1, y1, g1) + corner(x2, y2, g2))
  }
}
