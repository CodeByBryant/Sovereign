import { describe, expect, it } from 'vitest'
import { buildProvinces, type ProvinceMap } from '../src/terrain/provinces'
import { growTerritories, type TerritoryInput } from '../src/nations/territory'

/**
 * A map of provinces of 10 x 10 tiles, `cols` by `rows`, one seed in the middle of each (province id =
 * `row * cols + col`). `rough(col, row)` makes a province cost 8 to cross instead of 1.
 */
function lattice(
  cols: number,
  rows: number,
  rough: (col: number, row: number) => boolean = () => false
): ProvinceMap {
  const width = cols * 10
  const height = rows * 10
  const land = new Uint8Array(width * height).fill(1)
  const cost = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      cost[y * width + x] = rough(Math.floor(x / 10), Math.floor(y / 10)) ? 8 : 1
    }
  }
  const seeds: number[] = []
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) seeds.push((r * 10 + 5) * width + c * 10 + 5)
  }
  return buildProvinces({ width, height, land, cost, spacing: 10, minArea: 1, seeds })
}

interface Options {
  provinces: ProvinceMap
  capitals: number[]
  area: number | number[]
  claimable?: (p: number) => boolean
}

function run(o: Options): { claimed: number[][]; input: TerritoryInput } {
  const claimable = new Uint8Array(o.provinces.count)
  for (let p = 0; p < claimable.length; p += 1) claimable[p] = (o.claimable?.(p) ?? true) ? 1 : 0
  const input: TerritoryInput = {
    provinces: o.provinces,
    capitals: o.capitals,
    claimable,
    area: o.area
  }
  return { claimed: growTerritories(input), input }
}

const neighbours = (map: ProvinceMap, p: number): number[] =>
  Array.from(map.neighbourId.subarray(map.neighbourStart[p], map.neighbourStart[p + 1]))

const area = (map: ProvinceMap, ids: readonly number[]): number =>
  ids.reduce((n, p) => n + map.area[p], 0)

/** The nation holds at least `wanted` tiles, and held fewer before its last province. */
function expectJustEnough(map: ProvinceMap, ids: readonly number[], wanted: number): void {
  expect(area(map, ids)).toBeGreaterThanOrEqual(wanted)
  expect(area(map, ids.slice(0, -1))).toBeLessThan(wanted)
}

describe('growTerritories: one nation', () => {
  const map = lattice(6, 4)

  it('claims the capital first, then provinces until it holds the area asked for', () => {
    const { claimed } = run({ provinces: map, capitals: [14], area: 350 })
    expect(claimed).toHaveLength(1)
    expect(claimed[0][0]).toBe(14)
    expect(new Set(claimed[0]).size).toBe(claimed[0].length)
    expect(claimed[0].length).toBeGreaterThanOrEqual(4) // about 100 tiles each
    expectJustEnough(map, claimed[0], 350)
  })

  it('stops as soon as it holds the area, so it never holds a whole province more', () => {
    for (const wanted of [150, 300, 301, 700]) {
      const { claimed } = run({ provinces: map, capitals: [14], area: wanted })
      expectJustEnough(map, claimed[0], wanted)
    }
  })

  it('claims each province next to one it already holds, in the order it grew', () => {
    const { claimed } = run({ provinces: map, capitals: [14], area: 1000 })
    const held = new Set<number>([claimed[0][0]])
    for (const p of claimed[0].slice(1)) {
      expect(neighbours(map, p).some((n) => held.has(n))).toBe(true)
      held.add(p)
    }
  })

  it('grows a compact patch on open ground, not a line', () => {
    const { claimed } = run({ provinces: map, capitals: [14], area: 900 })
    // nine provinces around (2, 2) on a 6 x 4 lattice: none farther than 2 provinces from it
    for (const p of claimed[0]) {
      const dc = Math.abs((p % 6) - 2)
      const dr = Math.abs(Math.floor(p / 6) - 2)
      expect(dc + dr).toBeLessThanOrEqual(3)
    }
  })

  it('never claims a province that cannot be claimed', () => {
    const { claimed } = run({
      provinces: map,
      capitals: [0],
      area: 100000,
      claimable: (p) => p % 6 !== 2
    })
    for (const p of claimed[0]) expect(p % 6).not.toBe(2)
  })

  it('does not jump a gap of provinces that cannot be claimed', () => {
    const { claimed } = run({
      provinces: map,
      capitals: [0],
      area: 100000,
      claimable: (p) => p % 6 !== 2
    })
    // the column 2 cuts the lattice in two; only the west part (columns 0 and 1) is reachable
    expect(claimed[0].sort((a, b) => a - b)).toEqual([0, 1, 6, 7, 12, 13, 18, 19])
  })

  it('takes everything it can reach when the land is smaller than the area', () => {
    const { claimed } = run({ provinces: map, capitals: [0], area: 1000000 })
    expect(claimed[0]).toHaveLength(map.count)
  })

  it('grows toward cheap ground and away from costly ground', () => {
    const rough = lattice(6, 4, (c) => c === 3)
    const { claimed } = run({ provinces: rough, capitals: [2], area: 500 })
    const west = claimed[0].filter((p) => p % 6 < 3).length
    const east = claimed[0].filter((p) => p % 6 > 3).length
    expect(west).toBeGreaterThan(east)
  })

  it('holds the capital alone for an area of 1, and nothing for an area of 0', () => {
    expect(run({ provinces: map, capitals: [9], area: 1 }).claimed).toEqual([[9]])
    expect(run({ provinces: map, capitals: [9], area: 0 }).claimed).toEqual([[]])
  })
})

describe('growTerritories: several nations', () => {
  it('shares the land: nobody holds a province twice, and each gets about its area', () => {
    const map = lattice(6, 4)
    const { claimed } = run({ provinces: map, capitals: [0, 5, 18, 23], area: 400 })
    const all = claimed.flat()
    expect(new Set(all).size).toBe(all.length)
    for (const c of claimed) expectJustEnough(map, c, 400)
  })

  it('draws the border halfway between equal neighbours that crowd each other', () => {
    const map = lattice(7, 1)
    const { claimed } = run({ provinces: map, capitals: [0, 6], area: 100000 })
    expect(claimed[0].length + claimed[1].length).toBe(7)
    expect(Math.abs(claimed[0].length - claimed[1].length)).toBeLessThanOrEqual(1)
    expect(Math.max(...claimed[0])).toBeLessThan(Math.min(...claimed[1]))
  })

  it('puts the border on a costly barrier instead of halfway', () => {
    // the rough province is in column 4: it is costly to enter, so the west nation, that reaches it
    // first over cheap ground, does not push the border east of it; the border sits at the rough ground
    const map = lattice(9, 1, (c) => c === 2)
    const { claimed } = run({ provinces: map, capitals: [0, 8], area: 100000 })
    // halfway would be 4 | 5; the barrier at 2 pulls the west nation's reach in
    expect(claimed[0].length).toBeLessThanOrEqual(3)
    expect(claimed[1].length).toBeGreaterThanOrEqual(6)
  })

  it('draws the border halfway on a vertical line of provinces too', () => {
    const map = lattice(1, 7)
    const { claimed } = run({ provinces: map, capitals: [0, 6], area: 100000 })
    expect(claimed[0].length + claimed[1].length).toBe(7)
    expect(Math.abs(claimed[0].length - claimed[1].length)).toBeLessThanOrEqual(1)
  })

  it('leaves no province free beside a nation that still has room to grow', () => {
    // nations that fill up mid-growth leave offers behind; whatever they hold in the queue must not be lost
    let state = 12345
    const rand = (n: number): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return Math.floor((state / 4294967296) * n)
    }
    for (let trial = 0; trial < 80; trial += 1) {
      const cols = 3 + rand(4)
      const rows = 2 + rand(3)
      const map = lattice(cols, rows, (c, r) => (c * 7 + r * 3 + trial) % 5 === 0)
      const count = 2 + rand(3)
      const capitals: number[] = []
      while (capitals.length < count) {
        const p = rand(map.count)
        if (!capitals.includes(p)) capitals.push(p)
      }
      const wanted = capitals.map((_, k) => (k === 0 ? 1000000 : 1 + rand(450)))
      const { claimed } = run({ provinces: map, capitals, area: wanted })
      const owner = new Array<number>(map.count).fill(-1)
      claimed.forEach((ids, nation) => ids.forEach((p) => (owner[p] = nation)))
      const full = claimed.map((ids, nation) => area(map, ids) >= wanted[nation])
      // a province can stay free only when every neighbour it has is free or held by a nation that is full
      for (let p = 0; p < map.count; p += 1) {
        if (owner[p] >= 0) continue
        for (const n of neighbours(map, p)) {
          expect(owner[n] < 0 || full[owner[n]], `trial ${trial}: province ${p} next to ${n}`).toBe(
            true
          )
        }
      }
    }
  })

  it('hands a province to the nation that can reach it most cheaply when the first to reach for it is full', () => {
    // Found by comparing against variants that hand it to the wrong nation, or at the wrong price: in each
    // of these a nation fills up with offers still queued, and its provinces go to the cheapest taker.
    const a = lattice(6, 2, (c, r) => (c * 7 + r * 5 + 1) % 5 === 0)
    expect(
      run({ provinces: a, capitals: [4, 6, 5, 7], area: [1000000, 1000000, 329, 143] }).claimed
    ).toEqual([
      [4, 10, 3, 9, 2, 8],
      [6, 0],
      [5, 11],
      [7, 1]
    ])
    const b = lattice(3, 4, (c, r) => (c * 3 + r * 2 + 1) % 5 === 0)
    expect(
      run({ provinces: b, capitals: [2, 6, 7, 9, 5], area: [1000000, 1000000, 263, 70, 200] })
        .claimed
    ).toEqual([[2, 1, 0], [6], [7, 11, 3], [9], [5, 4, 8]])
  })

  it('weighs how far apart provinces are, not only how many steps lie between them', () => {
    // a wide province in the middle, with a near neighbour on its left and a far one on its right
    const width = 60
    const land = new Uint8Array(width).fill(1)
    const cost = new Float32Array(width).fill(1)
    const map = buildProvinces({
      width,
      height: 1,
      land,
      cost,
      spacing: 5,
      minArea: 1,
      seeds: [50, 20, 5]
    })
    expect(map.count).toBe(3)
    // province 0 (right, nation 0) and province 2 (left, nation 1) both neighbour province 1 (the middle).
    // The middle is 17 tiles from the left one and 24 from the right one.
    const { claimed } = run({ provinces: map, capitals: [0, 2], area: 100000 })
    expect(claimed[1]).toContain(1)
    expect(claimed[0]).not.toContain(1)
  })

  it('lets a nation take the ground a neighbour that has stopped growing left behind', () => {
    const map = lattice(8, 1)
    const { claimed } = run({ provinces: map, capitals: [0, 7], area: [100, 100000] })
    expect(claimed[0]).toEqual([0])
    expect(claimed[1]).toHaveLength(7)
  })

  it('takes one area per nation when given a list, and rejects a list of the wrong length', () => {
    const map = lattice(6, 4)
    const { claimed } = run({ provinces: map, capitals: [0, 23], area: [200, 500] })
    expectJustEnough(map, claimed[0], 200)
    expectJustEnough(map, claimed[1], 500)
    expect(() => run({ provinces: map, capitals: [0, 23], area: [200] })).toThrow(RangeError)
  })

  it('is the same twice, in claim order', () => {
    const map = lattice(6, 4, (c, r) => (c + r) % 3 === 0)
    const a = run({ provinces: map, capitals: [0, 9, 17, 23], area: 450 }).claimed
    const b = run({ provinces: map, capitals: [0, 9, 17, 23], area: 450 }).claimed
    expect(a).toEqual(b)
  })

  it('does not depend on how the capitals are listed, apart from their numbering', () => {
    const map = lattice(6, 4, (c, r) => (c + r) % 3 === 0)
    const a = run({ provinces: map, capitals: [0, 9, 17, 23], area: 450 }).claimed
    const b = run({ provinces: map, capitals: [23, 17, 9, 0], area: 450 }).claimed
    expect(
      b
        .slice()
        .reverse()
        .map((c) => new Set(c))
    ).toEqual(a.map((c) => new Set(c)))
  })
})

describe('growTerritories: bad input', () => {
  const map = lattice(4, 2)

  it('rejects a capital on a province that cannot be claimed, off the map, or shared', () => {
    expect(() =>
      run({ provinces: map, capitals: [3], area: 100, claimable: (p) => p !== 3 })
    ).toThrow(/claimed/)
    expect(() => run({ provinces: map, capitals: [8], area: 100 })).toThrow(/province of the map/)
    expect(() => run({ provinces: map, capitals: [-1], area: 100 })).toThrow(/province of the map/)
    expect(() => run({ provinces: map, capitals: [2, 2], area: 100 })).toThrow(/share/)
  })

  it('rejects a negative or fractional area', () => {
    expect(() => run({ provinces: map, capitals: [0], area: -1 })).toThrow(/area/)
    expect(() => run({ provinces: map, capitals: [0], area: 1.5 })).toThrow(/area/)
  })

  it('has no territories for no capitals', () => {
    expect(run({ provinces: map, capitals: [], area: 100 }).claimed).toEqual([])
  })
})
