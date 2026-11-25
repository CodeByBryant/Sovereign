import { describe, expect, it } from 'vitest'
import type { StrategicRoute, UnitSnapshot } from '@sovereign/contracts'
import { Camera } from '../src/Camera'
import {
  ROAD_E,
  ROAD_N,
  ROAD_S,
  ROAD_W,
  SPRITE_MIN_TILE_PIXELS,
  UnitInterpolator,
  roadMaskFromRoutes,
  spritesShown,
  visibleTileRect
} from '../src'

const map = { width: 100, height: 80, tileSize: 4 }

describe('spritesShown: sprites are for when a tile is big enough on screen to draw one', () => {
  it('turns on at the threshold and not below it', () => {
    const at = (zoom: number): boolean => spritesShown(zoom, map.tileSize)
    expect(at(SPRITE_MIN_TILE_PIXELS / 4)).toBe(true)
    expect(at(SPRITE_MIN_TILE_PIXELS / 4 - 0.01)).toBe(false)
    expect(at(10)).toBe(true)
    expect(at(0.2)).toBe(false)
  })
})

describe('visibleTileRect: which tiles the camera can see', () => {
  it('is the tiles under the viewport, with one tile of margin', () => {
    // zoom 2: one tile is 8 screen pixels; an 80 x 40 viewport shows 10 x 5 tiles, centred on the map middle
    const camera = new Camera({ x: 0, y: 0, zoom: 2 })
    const r = visibleTileRect(camera, 80, 40, map)
    // the map centre is tile (50, 40); the view covers x 45..55 and y 37.5..42.5
    expect(r).toEqual({ x0: 44, y0: 36, x1: 56, y1: 44 })
  })
  it('follows the camera', () => {
    const camera = new Camera({ x: 40, y: -20, zoom: 2 }) // 10 tiles right, 5 tiles up
    const r = visibleTileRect(camera, 80, 40, map)
    expect(r.x0).toBe(54)
    expect(r.y0).toBe(31)
  })
  it('is clamped to the map', () => {
    const camera = new Camera({ x: -10000, y: 10000, zoom: 2 })
    const r = visibleTileRect(camera, 80, 40, map)
    expect(r.x1).toBeLessThanOrEqual(0)
    expect(r.y0).toBeGreaterThanOrEqual(map.height)
    const all = visibleTileRect(new Camera({ zoom: 0.2 }), 8000, 8000, map)
    expect(all).toEqual({ x0: 0, y0: 0, x1: map.width, y1: map.height })
  })
  it('is never negative in size', () => {
    const r = visibleTileRect(new Camera({ x: 5000, y: 0, zoom: 2 }), 80, 40, map)
    expect(r.x1).toBeGreaterThanOrEqual(r.x0)
    expect(r.y1).toBeGreaterThanOrEqual(r.y0)
  })
})

describe('roadMaskFromRoutes', () => {
  const route = (path: number[], traffic = 1): StrategicRoute => ({
    from: 0,
    to: 1,
    cost: 1,
    traffic,
    path
  })
  const at = (m: Uint8Array, x: number, y: number): number => m[y * 10 + x] as number

  it('marks every tile of a route and the sides it joins to its neighbours', () => {
    const m = roadMaskFromRoutes([route([2, 3, 5, 3])], 10, 10)
    expect(at(m, 2, 3)).toBe(ROAD_E | 16)
    expect(at(m, 3, 3)).toBe(ROAD_E | ROAD_W | 16)
    expect(at(m, 4, 3)).toBe(ROAD_E | ROAD_W | 16)
    expect(at(m, 5, 3)).toBe(ROAD_W | 16)
    expect(at(m, 6, 3)).toBe(0)
    expect(at(m, 2, 2)).toBe(0)
  })
  it('joins vertical runs, and the road is one tile where routes cross', () => {
    const m = roadMaskFromRoutes([route([4, 1, 4, 5]), route([2, 3, 6, 3])], 10, 10)
    expect(at(m, 4, 1)).toBe(ROAD_S | 16)
    expect(at(m, 4, 3)).toBe(ROAD_N | ROAD_S | ROAD_E | ROAD_W | 16)
    expect(at(m, 4, 5)).toBe(ROAD_N | 16)
  })
  it('follows a polyline through each of its points', () => {
    const m = roadMaskFromRoutes([route([1, 1, 3, 1, 3, 4])], 10, 10)
    expect(at(m, 3, 1)).toBe(ROAD_W | ROAD_S | 16)
    expect(at(m, 3, 4)).toBe(ROAD_N | 16)
  })
  it('joins a diagonal step through a corner tile so the road stays connected', () => {
    const m = roadMaskFromRoutes([route([1, 1, 3, 3])], 10, 10)
    // every marked tile touches the next one on a side
    let marked = 0
    for (let i = 0; i < 100; i += 1) if ((m[i] as number) !== 0) marked += 1
    expect(marked).toBeGreaterThanOrEqual(5)
    expect(at(m, 1, 1) & (ROAD_E | ROAD_S)).not.toBe(0)
  })
  it('skips a route nobody uses and ignores tiles off the map', () => {
    expect(roadMaskFromRoutes([route([2, 3, 5, 3], 0)], 10, 10).every((v) => v === 0)).toBe(true)
    const m = roadMaskFromRoutes([route([8, 5, 14, 5])], 10, 10)
    expect(at(m, 9, 5)).toBe(ROAD_W | 16)
  })
  it('handles a route that is a single point', () => {
    const m = roadMaskFromRoutes([route([4, 4])], 10, 10)
    expect(at(m, 4, 4)).toBe(16)
  })
})

const snap = (
  tick: number,
  rows: Array<[number, number, number]>,
  state: number[] = [],
  carry: number[] = []
): UnitSnapshot => ({
  tick,
  count: rows.length,
  id: Uint32Array.from(rows.map((r) => r[0])),
  kind: Uint8Array.from(rows.map(() => 1)),
  owner: Uint8Array.from(rows.map((r) => r[0] % 3)),
  state: Uint8Array.from(rows.map((_, i) => state[i] ?? 0)),
  carry: Uint8Array.from(rows.map((_, i) => carry[i] ?? 0)),
  x: Float32Array.from(rows.map((r) => r[1])),
  y: Float32Array.from(rows.map((r) => r[2]))
})

describe('UnitInterpolator', () => {
  it('shows a unit where its first snapshot says', () => {
    const u = new UnitInterpolator()
    u.push(snap(1, [[0, 10, 20]]), 1000)
    const f = u.sample(1000)
    expect(f.count).toBe(1)
    expect([f.x[0], f.y[0]]).toEqual([10, 20])
  })
  it('glides from where a unit was shown to where the new snapshot puts it', () => {
    const u = new UnitInterpolator({ minMs: 100, maxMs: 100 })
    u.push(snap(1, [[0, 10, 20]]), 1000)
    u.push(snap(2, [[0, 14, 22]]), 1100)
    expect(u.sample(1100).x[0]).toBe(10)
    expect(u.sample(1150).x[0]).toBe(12)
    expect(u.sample(1150).y[0]).toBe(21)
    expect(u.sample(1200).x[0]).toBe(14)
    expect(u.sample(5000).x[0]).toBe(14) // it waits there for the next snapshot
    expect(u.sample(900).x[0]).toBe(10) // never before the start
  })
  it('starts from the picture on screen, not from the last snapshot, when one arrives mid-glide', () => {
    const u = new UnitInterpolator({ minMs: 100, maxMs: 100 })
    u.push(snap(1, [[0, 0, 0]]), 1000)
    u.push(snap(2, [[0, 10, 0]]), 1100)
    u.push(snap(3, [[0, 10, 8]]), 1150) // arrives halfway: it is on screen at x = 5
    expect(u.sample(1150).x[0]).toBe(5)
    expect(u.sample(1150).y[0]).toBe(0)
    expect(u.sample(1250).x[0]).toBe(10)
    expect(u.sample(1250).y[0]).toBe(8)
  })
  it('times a glide by the gap between snapshots, within its limits', () => {
    const u = new UnitInterpolator({ minMs: 50, maxMs: 400 })
    u.push(snap(1, [[0, 0, 0]]), 1000)
    u.push(snap(2, [[0, 10, 0]]), 1200) // 200 ms since the last
    expect(u.sample(1300).x[0]).toBe(5)
    u.push(snap(3, [[0, 20, 0]]), 1210) // 10 ms: clamped up to 50
    const here = u.sample(1210).x[0] as number
    expect(u.sample(1235).x[0]).toBeCloseTo(here + (20 - here) / 2, 4)
    u.push(snap(4, [[0, 30, 0]]), 9210) // a long pause: clamped down to 400
    expect(u.sample(9410).x[0]).toBe(25)
  })
  it('puts a new unit straight at its place and drops a unit that is gone', () => {
    const u = new UnitInterpolator({ minMs: 100, maxMs: 100 })
    u.push(
      snap(1, [
        [0, 0, 0],
        [2, 5, 5]
      ]),
      1000
    )
    u.push(
      snap(2, [
        [0, 10, 0],
        [1, 7, 7],
        [3, 9, 9]
      ]),
      1100
    )
    const f = u.sample(1150)
    expect(f.count).toBe(3)
    expect(Array.from(f.id)).toEqual([0, 1, 3])
    expect(f.x[0]).toBe(5)
    expect(f.x[1]).toBe(7) // new: no glide
    expect(f.x[2]).toBe(9)
  })
  it('jumps rather than glides when a unit is further than the jump limit (a long run of ticks)', () => {
    const u = new UnitInterpolator({ minMs: 100, maxMs: 100, jumpTiles: 6 })
    u.push(
      snap(1, [
        [0, 0, 0],
        [1, 0, 0]
      ]),
      1000
    )
    u.push(
      snap(2, [
        [0, 50, 0],
        [1, 5, 0]
      ]),
      1100
    )
    const f = u.sample(1100)
    expect(f.x[0]).toBe(50)
    expect(f.x[1]).toBe(0) // within the limit: still glides
  })
  it('glides a unit that moved exactly the jump limit, and jumps one that moved just over it', () => {
    const u = new UnitInterpolator({ minMs: 100, maxMs: 100, jumpTiles: 6 })
    u.push(
      snap(1, [
        [0, 0, 0],
        [1, 0, 0]
      ]),
      1000
    )
    u.push(
      snap(2, [
        [0, 6, 0],
        [1, 6.5, 0]
      ]),
      1100
    )
    const f = u.sample(1100)
    expect(f.x[0]).toBe(0)
    expect(f.x[1]).toBe(6.5)
  })
  it('keeps ids, kinds and owners of the latest snapshot', () => {
    const u = new UnitInterpolator()
    u.push(
      snap(1, [
        [4, 1, 1],
        [5, 2, 2]
      ]),
      0
    )
    const f = u.sample(0)
    expect(Array.from(f.id)).toEqual([4, 5])
    expect(Array.from(f.owner)).toEqual([1, 2])
    expect(Array.from(f.kind)).toEqual([1, 1])
  })
  it('keeps what each unit is doing and what it carries, from the latest snapshot', () => {
    const u = new UnitInterpolator()
    u.push(
      snap(
        1,
        [
          [4, 1, 1],
          [5, 2, 2]
        ],
        [0, 1],
        [0, 0]
      ),
      0
    )
    u.push(
      snap(
        2,
        [
          [4, 1, 1],
          [5, 2, 2],
          [9, 3, 3]
        ],
        [2, 3, 0],
        [0, 7, 0]
      ),
      100
    )
    const f = u.sample(150)
    expect(Array.from(f.state)).toEqual([2, 3, 0])
    expect(Array.from(f.carry)).toEqual([0, 7, 0])
  })
  it('is empty before the first snapshot, and after an empty one', () => {
    const u = new UnitInterpolator()
    expect(u.sample(0).count).toBe(0)
    u.push(snap(1, []), 0)
    expect(u.sample(10).count).toBe(0)
  })
})
