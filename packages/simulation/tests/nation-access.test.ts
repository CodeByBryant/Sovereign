import { ResourceType, type ResourceSlots } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { ACCESS_CELL, ACCESS_RADIUS_CELLS, buildAccessGrid } from '../src/nations/access'

const W = 200
const H = 120

function emptySlots(): ResourceSlots {
  const slot = (): ResourceSlots['surface'] => ({
    type: new Uint8Array(W * H),
    richness: new Uint8Array(W * H),
    stock: new Uint8Array(W * H)
  })
  return { surface: slot(), ground: slot() }
}

/** Put `type` into a slot on every tile of a rectangle (richness and stock full). */
function fill(
  slots: ResourceSlots,
  layer: 'surface' | 'ground',
  type: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): void {
  const slot = slots[layer]
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      slot.type[y * W + x] = type
      slot.richness[y * W + x] = 200
      slot.stock[y * W + x] = 200
    }
  }
}

describe('buildAccessGrid', () => {
  it('is 0 where nothing useful is near, and at most 1 everywhere', () => {
    const grid = buildAccessGrid(emptySlots(), W, H)
    for (const [x, y] of [
      [0, 0],
      [100, 60],
      [W - 1, H - 1]
    ] as const) {
      expect(grid.at(x, y)).toBe(0)
    }
    const rich = emptySlots()
    fill(rich, 'surface', ResourceType.Grain, 0, 0, W - 1, H - 1)
    fill(rich, 'ground', ResourceType.Stone, 0, 0, W - 1, H - 1)
    const full = buildAccessGrid(rich, W, H)
    for (const [x, y] of [
      [0, 0],
      [100, 60],
      [W - 1, H - 1]
    ] as const) {
      expect(full.at(x, y)).toBeLessThanOrEqual(1)
    }
  })

  it('counts food (grain, pasture, fish) near the tile and nothing far from it', () => {
    for (const food of [ResourceType.Grain, ResourceType.Pasture, ResourceType.Fish]) {
      const slots = emptySlots()
      fill(slots, 'surface', food, 150, 80, 190, 110)
      const grid = buildAccessGrid(slots, W, H)
      expect(grid.at(170, 95)).toBeGreaterThan(0)
      expect(grid.at(20, 20)).toBe(0)
    }
  })

  it('does not count a resource that is not food, timber or stone (a luxury, a metal)', () => {
    const slots = emptySlots()
    fill(slots, 'surface', ResourceType.Spices, 0, 0, W - 1, H - 1)
    fill(slots, 'ground', ResourceType.Gold, 0, 0, W - 1, H - 1)
    expect(buildAccessGrid(slots, W, H).at(100, 60)).toBe(0)
  })

  it('values food most, then timber and stone equally', () => {
    const only = (layer: 'surface' | 'ground', type: number): number => {
      const slots = emptySlots()
      fill(slots, layer, type, 0, 0, W - 1, H - 1)
      return buildAccessGrid(slots, W, H).at(100, 60)
    }
    const food = only('surface', ResourceType.Grain)
    const timber = only('surface', ResourceType.Timber)
    const stone = only('ground', ResourceType.Stone)
    expect(food).toBeCloseTo(0.5, 10)
    expect(timber).toBeCloseTo(0.25, 10)
    expect(stone).toBeCloseTo(0.25, 10)
  })

  it('reaches 1 with plenty of all three, and saturates (more of it does not score higher)', () => {
    const slots = emptySlots()
    fill(slots, 'surface', ResourceType.Grain, 0, 0, W - 1, 40)
    fill(slots, 'surface', ResourceType.Timber, 0, 41, W - 1, H - 1)
    fill(slots, 'ground', ResourceType.Stone, 0, 0, W - 1, H - 1)
    const grid = buildAccessGrid(slots, W, H)
    expect(grid.at(100, 40)).toBeCloseTo(1, 10)
    expect(grid.at(100, 60)).toBeLessThan(1) // no food within reach of the lower part
  })

  it('sees only as far as the access radius', () => {
    const slots = emptySlots()
    fill(slots, 'surface', ResourceType.Grain, 100, 60, 103, 63)
    const grid = buildAccessGrid(slots, W, H)
    const reach = ACCESS_CELL * ACCESS_RADIUS_CELLS
    expect(grid.at(101 + reach - ACCESS_CELL, 61)).toBeGreaterThan(0)
    expect(grid.at(101 + reach + 3 * ACCESS_CELL, 61)).toBe(0)
    expect(grid.at(101, 61 - reach - 3 * ACCESS_CELL)).toBe(0)
  })

  it('reaches the same distance in all four directions', () => {
    const slots = emptySlots()
    fill(slots, 'surface', ResourceType.Grain, 100, 60, 103, 63)
    const grid = buildAccessGrid(slots, W, H)
    const reach = ACCESS_CELL * ACCESS_RADIUS_CELLS
    expect(reach).toBe(12)
    // the grain is in cell 25 across and 15 down: three cells away is in reach, four is not
    const near = reach
    const far = reach + ACCESS_CELL
    for (const [dx, dy] of [
      [near, 0],
      [-near, 0],
      [0, near],
      [0, -near]
    ] as const) {
      expect(grid.at(101 + dx, 61 + dy)).toBeGreaterThan(0)
    }
    for (const [dx, dy] of [
      [far, 0],
      [-far, 0],
      [0, far],
      [0, -far]
    ] as const) {
      expect(grid.at(101 + dx, 61 + dy)).toBe(0)
    }
  })

  it('counts exactly 20 food, 20 timber and 8 stone tiles as plenty', () => {
    const score = (layer: 'surface' | 'ground', type: number, tiles: number): number => {
      const slots = emptySlots()
      for (let k = 0; k < tiles; k += 1) {
        const x = 100 + (k % 8) // two rows of 8 and a few more: spans two cells, all within reach
        const y = 60 + Math.floor(k / 8)
        slots[layer].type[y * W + x] = type
      }
      return buildAccessGrid(slots, W, H).at(102, 61)
    }
    expect(score('surface', ResourceType.Grain, 20)).toBeCloseTo(0.5, 10)
    expect(score('surface', ResourceType.Grain, 19)).toBeCloseTo((0.5 * 19) / 20, 10)
    expect(score('surface', ResourceType.Timber, 20)).toBeCloseTo(0.25, 10)
    expect(score('surface', ResourceType.Timber, 19)).toBeCloseTo((0.25 * 19) / 20, 10)
    expect(score('ground', ResourceType.Stone, 8)).toBeCloseTo(0.25, 10)
    expect(score('ground', ResourceType.Stone, 7)).toBeCloseTo((0.25 * 7) / 8, 10)
  })

  it('is deterministic and reads the map edges without error', () => {
    const slots = emptySlots()
    fill(slots, 'surface', ResourceType.Grain, 0, 0, W - 1, H - 1)
    const a = buildAccessGrid(slots, W, H)
    const b = buildAccessGrid(slots, W, H)
    for (const [x, y] of [
      [0, 0],
      [W - 1, 0],
      [0, H - 1],
      [W - 1, H - 1],
      [77, 33]
    ] as const) {
      expect(a.at(x, y)).toBe(b.at(x, y))
    }
  })
})
