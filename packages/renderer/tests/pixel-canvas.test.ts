import { describe, expect, it } from 'vitest'
import { PixelCanvas, shade, tint } from '../src/sprites'

describe('PixelCanvas', () => {
  it('ignores a pixel off the canvas rather than wrapping it onto another row', () => {
    const c = new PixelCanvas(4, 4)
    c.set(-1, 1, [9, 9, 9])
    c.set(4, 1, [9, 9, 9])
    c.set(1, -1, [9, 9, 9])
    c.set(1, 4, [9, 9, 9])
    expect(c.count()).toBe(0)
    expect(c.solid(-1, 0)).toBe(false)
    expect(c.solid(4, 0)).toBe(false)
  })
  it('paints an opaque pixel and reports it solid', () => {
    const c = new PixelCanvas(4, 4)
    c.set(2, 1, [10, 20, 30])
    expect(c.solid(2, 1)).toBe(true)
    expect(Array.from(c.rgba.subarray((1 * 4 + 2) * 4, (1 * 4 + 2) * 4 + 4))).toEqual([
      10, 20, 30, 255
    ])
    expect(c.count()).toBe(1)
  })
  it('fills a rectangle, clipping at the edge', () => {
    const c = new PixelCanvas(4, 4)
    c.fillRect(2, 2, 5, 5, [1, 1, 1])
    expect(c.count()).toBe(4)
  })
  it('draws a line including both ends, in every direction', () => {
    const c = new PixelCanvas(8, 8)
    c.line(1, 1, 6, 4, [1, 1, 1])
    expect(c.solid(1, 1) && c.solid(6, 4)).toBe(true)
    const d = new PixelCanvas(8, 8)
    d.line(6, 4, 1, 1, [1, 1, 1])
    expect(d.rgba).toEqual(c.rgba)
    const v = new PixelCanvas(8, 8)
    v.line(3, 6, 3, 1, [1, 1, 1])
    expect(v.count()).toBe(6)
  })
  it('draws an ellipse with its light side up and left and its shadow down and right', () => {
    const c = new PixelCanvas(16, 16)
    c.ellipse(8, 8, 5, 5, [100, 100, 100])
    const at = (x: number, y: number): number => c.rgba[(y * 16 + x) * 4] as number
    expect(at(8, 8)).toBe(100)
    expect(at(6, 5)).toBeGreaterThan(100)
    expect(at(10, 11)).toBeLessThan(100)
    expect(c.solid(8, 2)).toBe(false) // outside the radius
  })
  it('outlines the outside of a shape and leaves the shape alone', () => {
    const c = new PixelCanvas(6, 6)
    c.set(2, 2, [200, 200, 200])
    c.outline([0, 0, 0])
    expect(c.count()).toBe(5) // the pixel and its four neighbours, not the diagonals
    expect(c.rgba[(2 * 6 + 2) * 4]).toBe(200)
    expect(c.solid(3, 3)).toBe(false)
  })
  it('copies itself into a larger buffer at an offset', () => {
    const c = new PixelCanvas(2, 2)
    c.fillRect(0, 0, 2, 2, [7, 8, 9])
    const target = new Uint8ClampedArray(6 * 4 * 4)
    c.blitTo(target, 6, 3, 1)
    expect(Array.from(target.subarray((1 * 6 + 3) * 4, (1 * 6 + 3) * 4 + 4))).toEqual([
      7, 8, 9, 255
    ])
    expect(target[(1 * 6 + 2) * 4 + 3]).toBe(0)
    expect(target[(2 * 6 + 4) * 4 + 3]).toBe(255)
  })
})

describe('shade and tint', () => {
  it('scale a colour and clamp it to a byte', () => {
    expect(shade([100, 200, 50], 0.5)).toEqual([50, 100, 25])
    expect(shade([200, 200, 200], 2)).toEqual([255, 255, 255])
  })
  it('move a colour towards white', () => {
    expect(tint([0, 100, 200], 0.5)).toEqual([128, 178, 228])
    expect(tint([10, 10, 10], 0)).toEqual([10, 10, 10])
  })
})
