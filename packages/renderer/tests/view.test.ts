import { describe, expect, it } from 'vitest'
import { Camera } from '../src/Camera'
import { clampedViewport, tileAtScreen, viewTransform } from '../src/view'

const VW = 800
const VH = 600

describe('viewTransform', () => {
  it('centres the world origin on screen at zoom 1', () => {
    expect(viewTransform(new Camera(), VW, VH)).toEqual({ scale: 1, x: 400, y: 300 })
  })

  it('applies screen = (world - camera) * zoom + viewport / 2', () => {
    const camera = new Camera({ x: 100, y: -50, zoom: 2 })
    const t = viewTransform(camera, VW, VH)
    expect(t).toEqual({ scale: 2, x: 400 - 200, y: 300 + 100 })
    // a world point (130, -20) lands at (130 - 100) * 2 + 400 = 460, (-20 + 50) * 2 + 300 = 360
    expect(130 * t.scale + t.x).toBe(460)
    expect(-20 * t.scale + t.y).toBe(360)
  })

  it('agrees with Camera.screenToWorld (they are inverses)', () => {
    const camera = new Camera({ x: 12, y: 34, zoom: 1.7 })
    const t = viewTransform(camera, VW, VH)
    const world = camera.screenToWorld(250, 410, VW, VH)
    expect(world.x * t.scale + t.x).toBeCloseTo(250, 9)
    expect(world.y * t.scale + t.y).toBeCloseTo(410, 9)
  })
})

describe('tileAtScreen', () => {
  // A 100 x 50 tile map drawn 4 pixels per tile: 400 x 200 world units centred on the origin.
  const map = { width: 100, height: 50, tileSize: 4 }

  it('finds the tile under the screen centre when the camera is centred', () => {
    expect(tileAtScreen(new Camera(), VW, VH, VW / 2, VH / 2, map)).toEqual({ x: 50, y: 25 })
  })

  it('finds the top-left tile at the top-left corner of the map', () => {
    // world (-200, -100) is the map's top-left corner; with zoom 1 that is screen (200, 200).
    expect(tileAtScreen(new Camera(), VW, VH, 200, 200, map)).toEqual({ x: 0, y: 0 })
  })

  it('finds the last tile just inside the bottom-right corner', () => {
    expect(tileAtScreen(new Camera(), VW, VH, 599, 399, map)).toEqual({ x: 99, y: 49 })
  })

  it('is exactly on tile boundaries: a tile is [4k, 4k + 4) world pixels wide', () => {
    expect(tileAtScreen(new Camera(), VW, VH, 203.999, 200, map)).toEqual({ x: 0, y: 0 })
    expect(tileAtScreen(new Camera(), VW, VH, 204, 200, map)).toEqual({ x: 1, y: 0 })
  })

  it('returns null outside the map, on every side', () => {
    expect(tileAtScreen(new Camera(), VW, VH, 199.99, 300, map)).toBeNull()
    expect(tileAtScreen(new Camera(), VW, VH, 600, 300, map)).toBeNull()
    expect(tileAtScreen(new Camera(), VW, VH, 400, 199.99, map)).toBeNull()
    expect(tileAtScreen(new Camera(), VW, VH, 400, 400, map)).toBeNull()
    expect(tileAtScreen(new Camera(), VW, VH, -50, -50, map)).toBeNull()
  })

  it('accounts for zoom and for panning', () => {
    const camera = new Camera({ x: -100, y: 0, zoom: 2 })
    // screen centre is world (-100, 0): tile ((-100 + 200) / 4, (0 + 100) / 4) = (25, 25)
    expect(tileAtScreen(camera, VW, VH, VW / 2, VH / 2, map)).toEqual({ x: 25, y: 25 })
    // 8 screen pixels right is 4 world pixels right: the next tile
    expect(tileAtScreen(camera, VW, VH, VW / 2 + 8, VH / 2, map)).toEqual({ x: 26, y: 25 })
  })

  it('works for a non-square map and a different tile size', () => {
    const wide = { width: 10, height: 2, tileSize: 10 }
    expect(tileAtScreen(new Camera(), VW, VH, 400 - 49, 300, wide)).toEqual({ x: 0, y: 1 })
    expect(tileAtScreen(new Camera(), VW, VH, 400 + 49, 300 - 9, wide)).toEqual({ x: 9, y: 0 })
  })
})

describe('clampedViewport', () => {
  it('never reports less than one pixel, so a hidden canvas cannot make a zero-size surface', () => {
    expect(clampedViewport(0, 0)).toEqual({ width: 1, height: 1 })
    expect(clampedViewport(-5, 300)).toEqual({ width: 1, height: 300 })
  })

  it('floors fractional sizes', () => {
    expect(clampedViewport(800.9, 600.2)).toEqual({ width: 800, height: 600 })
  })
})
