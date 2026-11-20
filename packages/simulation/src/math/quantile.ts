/**
 * @module quantile
 * @description Rank remapping: give a field the distribution a profile describes while keeping its
 * spatial structure. Every tile is ranked among the others and receives the profile's value for
 * that rank, so the map is monotone (a higher tile never ends lower) and coastlines, ridges and
 * latitude bands stay exactly where they were; only the values are redistributed.
 *
 * Deterministic by construction: an integer histogram, a running sum and within-bin linear
 * interpolation, using only `+ - * /` and `Math.floor` (exact). There is no sorting, no
 * transcendental function and nothing that depends on iteration order. The spec and the reference
 * vectors are in docs/simulation/determinism.md.
 */
import type { QuantileProfile } from '@sovereign/contracts'

export type { QuantileProfile } from '@sovereign/contracts'

/** Number of equal-width bins the field's range [0, 1] is counted into. */
export const HISTOGRAM_BINS = 65536

/** Throws a `RangeError` unless the profile is a monotone map from quantile 0 to quantile 1. */
export function assertQuantileProfile(profile: QuantileProfile): void {
  if (profile.length < 2) throw new RangeError('a quantile profile needs at least two knots')
  if (profile[0][0] !== 0) throw new RangeError('a quantile profile must start at quantile 0')
  if (profile[profile.length - 1][0] !== 1) {
    throw new RangeError('a quantile profile must end at quantile 1')
  }
  for (let k = 0; k < profile.length; k += 1) {
    const [q, v] = profile[k]
    if (!Number.isFinite(q) || !Number.isFinite(v)) {
      throw new RangeError('a quantile profile must hold finite numbers')
    }
    if (k > 0 && !(q > profile[k - 1][0])) {
      throw new RangeError('quantiles in a profile must strictly increase')
    }
    if (k > 0 && v < profile[k - 1][1]) {
      throw new RangeError('values in a profile must not decrease')
    }
  }
}

/** The profile's value at rank `q` (0 to 1), by linear interpolation between knots. */
function valueAt(profile: QuantileProfile, q: number): number {
  if (q <= 0) return profile[0][1]
  for (let k = 1; k < profile.length; k += 1) {
    const [q1, v1] = profile[k]
    if (q <= q1) {
      const [q0, v0] = profile[k - 1]
      return v0 + ((q - q0) / (q1 - q0)) * (v1 - v0)
    }
  }
  return profile[profile.length - 1][1]
}

/**
 * Remap `values` (each in [0, 1]; others are clamped to the end bins) so that their ranks follow
 * `profile`. Only tiles where `mask` is non-zero are counted when ranking (all tiles if there is
 * no mask), but every tile is remapped. Equal values share the rank of the first of them. Returns a
 * new array and leaves the input untouched.
 *
 * @throws RangeError on a non-finite value, a mask of the wrong length or an invalid profile.
 */
export function remapByProfile(
  values: Float32Array,
  profile: QuantileProfile,
  mask?: Uint8Array
): Float32Array {
  assertQuantileProfile(profile)
  if (mask !== undefined && mask.length !== values.length) {
    throw new RangeError('the mask must have one entry per value')
  }
  const last = HISTOGRAM_BINS - 1

  const counts = new Float64Array(HISTOGRAM_BINS)
  let total = 0
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]
    if (!Number.isFinite(v)) throw new RangeError('field values must be finite')
    if (mask !== undefined && mask[i] === 0) continue
    const bin = Math.floor(v * HISTOGRAM_BINS)
    counts[bin < 0 ? 0 : bin > last ? last : bin] += 1
    total += 1
  }

  // below[b] = number of counted tiles in bins before b
  const below = new Float64Array(HISTOGRAM_BINS)
  let running = 0
  for (let b = 0; b < HISTOGRAM_BINS; b += 1) {
    below[b] = running
    running += counts[b]
  }

  const out = new Float32Array(values.length)
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]
    const raw = Math.floor(v * HISTOGRAM_BINS)
    const bin = raw < 0 ? 0 : raw > last ? last : raw
    const fraction = v * HISTOGRAM_BINS - bin
    // q can fall outside [0, 1] only for a clamped out-of-range value; `valueAt` holds the end values.
    const q = total === 0 ? 0 : (below[bin] + fraction * counts[bin]) / total
    out[i] = valueAt(profile, q)
  }
  return out
}

/**
 * Linearly rescale a field so its lowest value becomes 0 and its highest exactly 1 (a field of
 * equal values becomes all zeros). It is monotone, so ranks and ties are unchanged: it only moves
 * a field whose values lie outside [0, 1] into the range `remapByProfile` reads. Returns a new
 * array.
 *
 * @throws RangeError on a non-finite value.
 */
export function scaleToUnit(values: Float32Array): Float32Array {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]
    if (!Number.isFinite(v)) throw new RangeError('field values must be finite')
    if (v < min) min = v
    if (v > max) max = v
  }
  const out = new Float32Array(values.length)
  const range = max - min
  if (!(range > 0)) return out
  for (let i = 0; i < values.length; i += 1) out[i] = (values[i] - min) / range
  return out
}
