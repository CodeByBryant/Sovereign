// Bit-exact goldens for ln, exp and pow over large grids. Each hash covers the exact IEEE-754 bits
// of every result, so a one-ulp change anywhere moves it.
//
// These values were checked to be IDENTICAL on three different JS engines: Node 22 (V8 12.4),
// Chromium 157 (V8 14) and QuickJS (compiled to WASM). The platform `Math.pow(x, 1.4)` over the same
// 400,000 inputs gives three DIFFERENT hashes on those engines (40258951, 54d3a72d, 70e4d925),
// which is exactly why the engine has its own pow.
import { describe, expect, it } from 'vitest'
import { exp, ln, pow } from '../src/math/transcendental'

const view = new DataView(new ArrayBuffer(8))

/** FNV-1a 32 over the big-endian IEEE-754 bytes of every added number. */
class BitHash {
  private h = 0x811c9dc5
  add(x: number): void {
    view.setFloat64(0, x, false)
    for (let k = 0; k < 8; k += 1) {
      this.h ^= view.getUint8(k)
      this.h = Math.imul(this.h, 0x01000193)
    }
  }
  hex(): string {
    return (this.h >>> 0).toString(16).padStart(8, '0')
  }
}

describe('deterministic math, bit-exact across engines', () => {
  it('ln over 461,208 points from 1e-300 to 1e300', () => {
    const h = new BitHash()
    let n = 0
    for (let x = 1e-300; x < 1e300; x *= 1.003) {
      h.add(ln(x))
      n += 1
    }
    expect(n).toBe(461208)
    expect(h.hex()).toBe('d390efa5')
  })

  it('exp over 466,667 points from -700 to 700', () => {
    const h = new BitHash()
    for (let i = -233333; i <= 233333; i += 1) h.add(exp(i * 0.003))
    expect(h.hex()).toBe('793b0ab8')
  })

  it('pow(x, 1.4) over 400,000 points in (0, 1): the terrain elevation curve', () => {
    const h = new BitHash()
    const n = 400000
    for (let i = 0; i < n; i += 1) h.add(pow((i + 0.5) / n, 1.4))
    expect(h.hex()).toBe('5f886638')
  })

  it('pow(x, 0.5) over 400,000 points in (0, 50)', () => {
    const h = new BitHash()
    const n = 400000
    for (let i = 0; i < n; i += 1) h.add(pow(((i + 0.5) / n) * 50, 0.5))
    expect(h.hex()).toBe('78829315')
  })
})
