import { describe, expect, it } from 'vitest'
import { growTerritories, type TerritoryInput } from '../src/nations/territory'

const W = 60
const H = 40

interface Options {
  capitals: Array<[number, number]>
  area: number | number[]
  width?: number
  height?: number
  claimable?: (x: number, y: number) => boolean
  cost?: (x: number, y: number) => number
}

function run(o: Options): { claimed: number[][]; input: TerritoryInput } {
  const width = o.width ?? W
  const height = o.height ?? H
  const claimable = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1)
      claimable[y * width + x] = (o.claimable?.(x, y) ?? true) ? 1 : 0
  }
  const input: TerritoryInput = {
    width,
    height,
    capitals: o.capitals.map(([x, y]) => y * width + x),
    claimable,
    tileCost: (tile) => o.cost?.(tile % width, Math.floor(tile / width)) ?? 1,
    area: o.area
  }
  return { claimed: growTerritories(input), input }
}

const xy = (tile: number, width = W): [number, number] => [tile % width, Math.floor(tile / width)]

describe('growTerritories: one nation', () => {
  it('claims exactly the area asked for, capital first', () => {
    const { claimed, input } = run({ capitals: [[30, 20]], area: 200 })
    expect(claimed).toHaveLength(1)
    expect(claimed[0]).toHaveLength(200)
    expect(claimed[0][0]).toBe(input.capitals[0])
    expect(new Set(claimed[0]).size).toBe(200)
  })

  it('grows a compact blob on open ground, not a line', () => {
    const { claimed } = run({ capitals: [[30, 20]], area: 200 })
    const far = Math.max(...claimed[0].map((t) => Math.hypot(xy(t)[0] - 30, xy(t)[1] - 20)))
    // a disc of 200 tiles has radius 8; a diamond (4-neighbour growth) reaches 10
    expect(far).toBeLessThan(11.5)
  })

  it('claims each tile next to one it already holds, in the order it grew', () => {
    const { claimed } = run({ capitals: [[30, 20]], area: 150 })
    const held = new Set<number>([claimed[0][0]])
    for (const t of claimed[0].slice(1)) {
      const [x, y] = xy(t)
      const next = [t - 1, t + 1, t - W, t + W].filter((n, k) =>
        k === 0 ? x > 0 : k === 1 ? x < W - 1 : k === 2 ? y > 0 : y < H - 1
      )
      expect(next.some((n) => held.has(n))).toBe(true)
      held.add(t)
    }
  })

  it('never claims a tile that cannot be claimed (water, ice)', () => {
    const { claimed } = run({
      capitals: [[30, 20]],
      area: 300,
      claimable: (x) => x >= 25 && x < 40
    })
    for (const t of claimed[0]) {
      expect(xy(t)[0]).toBeGreaterThanOrEqual(25)
      expect(xy(t)[0]).toBeLessThan(40)
    }
  })

  it('takes all it can reach when the land is smaller than the area', () => {
    const { claimed } = run({
      capitals: [[30, 20]],
      area: 1000,
      claimable: (x, y) => x >= 28 && x < 33 && y >= 18 && y < 23
    })
    expect(claimed[0]).toHaveLength(25)
  })

  it('does not jump a gap of unclaimable tiles', () => {
    const { claimed } = run({ capitals: [[10, 20]], area: 500, claimable: (x) => x < 20 || x > 22 })
    for (const t of claimed[0]) expect(xy(t)[0]).toBeLessThan(20)
  })

  it('grows toward cheap ground and away from costly ground', () => {
    // ground west of x = 30 costs 4 per step, east of it 1: the nation spreads east
    const { claimed } = run({ capitals: [[30, 20]], area: 300, cost: (x) => (x < 30 ? 4 : 1) })
    const east = claimed[0].filter((t) => xy(t)[0] >= 30).length
    const west = claimed[0].length - east
    expect(east).toBeGreaterThan(west * 2)
  })

  it('area 1 is the capital alone, and area 0 is nothing', () => {
    expect(run({ capitals: [[30, 20]], area: 1 }).claimed[0]).toEqual([20 * W + 30])
    expect(run({ capitals: [[30, 20]], area: 0 }).claimed[0]).toEqual([])
  })
})

describe('growTerritories: edges and walls', () => {
  it('fills a whole small map from a corner and from the middle, edges included', () => {
    for (const capital of [
      [0, 0],
      [3, 3],
      [6, 6],
      [6, 0],
      [0, 6]
    ] as Array<[number, number]>) {
      const { claimed } = run({ capitals: [capital], area: 49, width: 7, height: 7 })
      expect(new Set(claimed[0]).size).toBe(49)
    }
  })

  it('never crosses a tile nothing can cross, even if it could be claimed', () => {
    const { claimed } = run({
      capitals: [[10, 20]],
      area: 900,
      cost: (x) => (x === 20 ? Infinity : 1)
    })
    for (const t of claimed[0]) expect(xy(t)[0]).toBeLessThan(20)
  })
})

describe('growTerritories: several nations', () => {
  it('lets a nation take the ground a neighbour that has stopped growing left behind', () => {
    // one row of land to x = 25: nation 0 (at 10) wants 4 tiles, nation 1 (at 20) wants as many as it can get
    const { claimed } = run({
      capitals: [
        [10, 0],
        [20, 0]
      ],
      area: [4, 100],
      width: 60,
      height: 1,
      claimable: (x) => x <= 25
    })
    expect(claimed[0]).toHaveLength(4)
    // nation 0 holds 8 to 11; nation 1 takes every free tile it can reach, from 12 to 25
    expect(claimed[1]).toHaveLength(14)
    expect(Math.min(...claimed[1])).toBe(12)
  })

  it('takes one area per nation when given a list, and rejects a list of the wrong length', () => {
    const { claimed, input } = run({
      capitals: [
        [15, 20],
        [45, 20]
      ],
      area: [30, 90]
    })
    expect(claimed.map((c) => c.length)).toEqual([30, 90])
    expect(() => growTerritories({ ...input, area: [30] })).toThrow(RangeError)
    expect(() => growTerritories({ ...input, area: [30, -1] })).toThrow(RangeError)
  })

  it('shares the land: nobody holds a tile twice, and each gets its area', () => {
    const { claimed } = run({
      capitals: [
        [15, 20],
        [45, 20]
      ],
      area: 250
    })
    const all = claimed.flat()
    expect(new Set(all).size).toBe(all.length)
    expect(claimed[0]).toHaveLength(250)
    expect(claimed[1]).toHaveLength(250)
  })

  it('draws the border halfway between equal neighbours that crowd each other', () => {
    // 30 wide strip: two capitals 20 apart, each wants more than half
    const { claimed } = run({
      capitals: [
        [10, 20],
        [30, 20]
      ],
      area: 700,
      width: 41,
      height: 41
    })
    const left = claimed[0].filter((t) => xy(t, 41)[0] < 20).length
    expect(left).toBeGreaterThan(claimed[0].length * 0.85)
    const right = claimed[1].filter((t) => xy(t, 41)[0] > 20).length
    expect(right).toBeGreaterThan(claimed[1].length * 0.85)
  })

  it('puts the border on a costly barrier instead of halfway', () => {
    // a wall at x = 24 (cost 12) closer to the right capital than the left
    const { claimed } = run({
      capitals: [
        [10, 20],
        [30, 20]
      ],
      area: 600,
      width: 41,
      height: 41,
      cost: (x) => (x === 24 ? 12 : 1)
    })
    const leftReach = Math.max(...claimed[0].map((t) => xy(t, 41)[0]))
    expect(leftReach).toBeGreaterThanOrEqual(23) // the left nation climbs up to the wall
    const rightReach = Math.min(...claimed[1].map((t) => xy(t, 41)[0]))
    expect(rightReach).toBeGreaterThanOrEqual(24) // the right one stops at it
  })

  it('lets a nation keep growing when its neighbour has stopped', () => {
    // nation 0 wants 50, nation 1 wants 400, side by side: nation 1 takes what nation 0 left
    const small = run({ capitals: [[15, 20]], area: 50 }).claimed[0]
    const { claimed } = run({
      capitals: [
        [15, 20],
        [24, 20]
      ],
      area: 400
    })
    expect(claimed[0]).toHaveLength(400)
    expect(small).toHaveLength(50)
    expect(claimed[1]).toHaveLength(400)
  })

  it('is the same twice, in claim order', () => {
    const a = run({
      capitals: [
        [15, 20],
        [45, 20],
        [30, 5]
      ],
      area: 200
    }).claimed
    const b = run({
      capitals: [
        [15, 20],
        [45, 20],
        [30, 5]
      ],
      area: 200
    }).claimed
    expect(a).toEqual(b)
  })

  it('does not depend on how the capitals are listed, apart from their numbering', () => {
    const forward = run({
      capitals: [
        [15, 20],
        [45, 20]
      ],
      area: 200
    }).claimed
    const reversed = run({
      capitals: [
        [45, 20],
        [15, 20]
      ],
      area: 200
    }).claimed
    expect(new Set(forward[0])).toEqual(new Set(reversed[1]))
    expect(new Set(forward[1])).toEqual(new Set(reversed[0]))
  })
})

describe('growTerritories: bad input', () => {
  it('rejects a capital on an unclaimable tile, off the map, or shared', () => {
    expect(() => run({ capitals: [[5, 5]], area: 10, claimable: () => false })).toThrow(RangeError)
    const base = run({ capitals: [[5, 5]], area: 10 }).input
    expect(() => growTerritories({ ...base, capitals: [W * H] })).toThrow(RangeError)
    expect(() => growTerritories({ ...base, capitals: [-1] })).toThrow(RangeError)
    expect(() => growTerritories({ ...base, capitals: [1.5] })).toThrow(RangeError)
    expect(() =>
      run({
        capitals: [
          [5, 5],
          [5, 5]
        ],
        area: 10
      })
    ).toThrow(RangeError)
  })

  it('rejects a negative or fractional area, and a tile cost that is not above 0', () => {
    expect(() => run({ capitals: [[5, 5]], area: -1 })).toThrow(RangeError)
    expect(() => run({ capitals: [[5, 5]], area: 2.5 })).toThrow(RangeError)
    expect(() => run({ capitals: [[5, 5]], area: 10, cost: () => 0 })).toThrow(RangeError)
  })

  it('has no territories for no capitals', () => {
    expect(run({ capitals: [], area: 10 }).claimed).toEqual([])
  })
})
