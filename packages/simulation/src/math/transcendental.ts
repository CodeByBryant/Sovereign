/**
 * Deterministic `ln`, `exp` and `pow`.
 *
 * Platform `Math.log/exp/pow` are implementation-defined: two engines may differ in the last bit,
 * and a simulation compounds that into a different world. These are built only from `+ - * /`,
 * comparisons, `Math.trunc` and IEEE-754 bit moves, all of which are exact and identical on every
 * engine. The kernels follow fdlibm's `__ieee754_log` / `__ieee754_exp` (range reduction plus a
 * minimax polynomial), accurate to about one unit in the last place.
 *
 * Domains (anything else throws `RangeError`, because a NaN/Infinity is an invalid simulation
 * value and is never repaired):
 * - `ln(x)`: positive normal numbers.
 * - `exp(x)`: finite `x <= 709.782712893384`; results below the smallest normal number
 *   (`x < -708.3964185322641`) flush to exactly 0.
 * - `pow(x, y)`: finite `x >= 0` and `y`; `pow(0, 0) = 1`; `pow(0, y < 0)` and overflow throw;
 *   underflow flushes to 0. Computed as `exp(y * ln x)`, so it is not exact for integer powers.
 */

const view = new DataView(new ArrayBuffer(8))

/** The high 32 bits (sign, exponent, top mantissa) of a double. */
function highWord(x: number): number {
  view.setFloat64(0, x, false)
  return view.getUint32(0, false)
}

/** `x` with its high 32 bits replaced; the low word is kept. */
function withHighWord(x: number, high: number): number {
  view.setFloat64(0, x, false)
  view.setUint32(0, high >>> 0, false)
  return view.getFloat64(0, false)
}

const LN2_HI = 6.9314718036912381649e-1
const LN2_LO = 1.9082149292705877e-10
const MIN_NORMAL = 2.2250738585072014e-308

// ln polynomial (fdlibm Lg1..Lg7).
const LG1 = 6.66666666666673513e-1
const LG2 = 3.999999999940941908e-1
const LG3 = 2.857142874366239149e-1
const LG4 = 2.222219843214978396e-1
const LG5 = 1.818357216161805012e-1
const LG6 = 1.53138376992093733e-1
const LG7 = 1.479819860511658591e-1

/** Natural logarithm of a positive normal number. */
export function ln(x: number): number {
  if (!(x >= MIN_NORMAL) || x === Number.POSITIVE_INFINITY) {
    throw new RangeError('ln is defined for positive normal numbers')
  }
  let hx = highWord(x)
  let k = (hx >>> 20) - 1023
  hx &= 0x000fffff
  let i = (hx + 0x95f64) & 0x100000
  const m = withHighWord(x, hx | (i ^ 0x3ff00000)) // x scaled into [sqrt(2)/2, sqrt(2))
  k += i >> 20
  const f = m - 1
  const dk = k

  if ((0x000fffff & (2 + hx)) < 3) {
    // |f| < 2^-20
    if (f === 0) {
      return k === 0 ? 0 : dk * LN2_HI + dk * LN2_LO
    }
    const r = f * f * (0.5 - 0.3333333333333333 * f)
    return k === 0 ? f - r : dk * LN2_HI - (r - dk * LN2_LO - f)
  }

  const s = f / (2 + f)
  const z = s * s
  i = hx - 0x6147a
  const w = z * z
  const j = 0x6b851 - hx
  const t1 = w * (LG2 + w * (LG4 + w * LG6))
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)))
  i |= j
  const r = t2 + t1
  if (i > 0) {
    const hfsq = 0.5 * f * f
    return k === 0
      ? f - (hfsq - s * (hfsq + r))
      : dk * LN2_HI - (hfsq - (s * (hfsq + r) + dk * LN2_LO) - f)
  }
  return k === 0 ? f - s * (f - r) : dk * LN2_HI - (s * (f - r) - dk * LN2_LO - f)
}

const INV_LN2 = 1.4426950408889634
// exp polynomial (fdlibm P1..P5).
const P1 = 1.66666666666666019037e-1
const P2 = -2.77777777770155933842e-3
const P3 = 6.61375632143793436117e-5
const P4 = -1.6533902205465251539e-6
const P5 = 4.1381367970572384604e-8
const EXP_OVERFLOW = 709.782712893384
const EXP_FLUSH = -708.3964185322641

/** `e^x`; see the module comment for the domain. */
export function exp(x: number): number {
  if (!Number.isFinite(x) || x > EXP_OVERFLOW) {
    throw new RangeError('exp overflows or its input is not finite')
  }
  if (x < EXP_FLUSH) return 0

  const negative = x < 0
  const hx = highWord(x) & 0x7fffffff
  let hi = 0
  let lo = 0
  let k = 0
  let r = x
  if (hx > 0x3fd62e42) {
    // |x| > 0.5 ln2: reduce to x = k ln2 + r with |r| <= 0.5 ln2.
    if (hx < 0x3ff0a2b2) {
      // |x| < 1.5 ln2
      if (negative) {
        hi = x + LN2_HI
        lo = -LN2_LO
        k = -1
      } else {
        hi = x - LN2_HI
        lo = LN2_LO
        k = 1
      }
    } else {
      k = Math.trunc(INV_LN2 * x + (negative ? -0.5 : 0.5))
      hi = x - k * LN2_HI
      lo = k * LN2_LO
    }
    r = hi - lo
  } else if (hx < 0x3e300000) {
    return 1 + x // |x| < 2^-28
  }

  const t = r * r
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))))
  if (k === 0) return 1 - ((r * c) / (c - 2) - r)

  const y = 1 - (lo - (r * c) / (2 - c) - hi)
  if (k >= -1021) return withHighWord(y, highWord(y) + (k << 20))
  // Result near the bottom of the normal range: scale in two exact steps.
  const TWO_POW_MINUS_1000 = withHighWord(0, 23 << 20)
  return withHighWord(y, highWord(y) + ((k + 1000) << 20)) * TWO_POW_MINUS_1000
}

/** `x^y` as `exp(y * ln x)`; see the module comment for the domain and accuracy. */
export function pow(x: number, y: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0) {
    throw new RangeError('pow needs finite arguments and a non-negative base')
  }
  if (y === 0) return 1
  if (x === 0) {
    if (y > 0) return 0
    throw new RangeError('pow(0, y) with y < 0 is infinite')
  }
  return exp(y * ln(x))
}
