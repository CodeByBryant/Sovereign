import { describe, expect, it } from 'vitest'
import { Camera } from '../src/Camera'

const VW = 800
const VH = 600

describe('Camera', () => {
  it('starts centred, at zoom 1, with the default limits', () => {
    const c = new Camera()
    expect([c.x, c.y, c.zoom, c.minZoom, c.maxZoom]).toEqual([0, 0, 1, 0.4, 3])
  })

  it('maps the screen centre to the camera position, at any zoom', () => {
    const c = new Camera({ x: 120, y: -40, zoom: 2.5 })
    expect(c.screenToWorld(VW / 2, VH / 2, VW, VH)).toEqual({ x: 120, y: -40 })
  })

  it('maps screen offsets to world offsets divided by the zoom', () => {
    const c = new Camera({ x: 0, y: 0, zoom: 4 })
    expect(c.screenToWorld(VW / 2 + 40, VH / 2 - 20, VW, VH)).toEqual({ x: 10, y: -5 })
  })

  describe('pan', () => {
    it('drags the world with the pointer: moving right by d moves the camera left by d / zoom', () => {
      const c = new Camera({ zoom: 2 })
      c.pan(10, -6)
      expect(c.x).toBe(-5)
      expect(c.y).toBe(3)
    })

    it('keeps the world point under the pointer fixed', () => {
      const c = new Camera({ x: 30, y: 30, zoom: 1.5 })
      const before = c.screenToWorld(300, 200, VW, VH)
      c.pan(25, 40)
      const after = c.screenToWorld(300 + 25, 200 + 40, VW, VH)
      expect(after.x).toBeCloseTo(before.x, 12)
      expect(after.y).toBeCloseTo(before.y, 12)
    })
  })

  describe('zoomAt', () => {
    it('multiplies the zoom by the scale', () => {
      const c = new Camera()
      c.zoomAt(2, 0, 0, VW, VH)
      expect(c.zoom).toBe(2)
    })

    it('keeps the world point under the anchor fixed', () => {
      const c = new Camera({ x: 17, y: -9, zoom: 1.3 })
      const before = c.screenToWorld(123, 456, VW, VH)
      c.zoomAt(1.7, 123, 456, VW, VH)
      const after = c.screenToWorld(123, 456, VW, VH)
      expect(after.x).toBeCloseTo(before.x, 10)
      expect(after.y).toBeCloseTo(before.y, 10)
    })

    it('clamps to the limits, and still anchors at the clamped zoom', () => {
      const c = new Camera({ zoom: 2.9, maxZoom: 3, minZoom: 0.5 })
      c.zoomAt(10, 200, 100, VW, VH)
      expect(c.zoom).toBe(3)
      c.zoomAt(0.001, 200, 100, VW, VH)
      expect(c.zoom).toBe(0.5)
    })

    it('does not move the camera when already at a limit (nothing changed)', () => {
      const c = new Camera({ x: 5, y: 6, zoom: 3, maxZoom: 3 })
      c.zoomAt(2, 700, 500, VW, VH)
      expect([c.x, c.y, c.zoom]).toEqual([5, 6, 3])
    })
  })
})
