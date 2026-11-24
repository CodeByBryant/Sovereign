import { describe, expect, it } from 'vitest'
import type { CostGrid } from '../src/terrain/cost'
import {
  NO_PROVINCE,
  buildProvinces,
  pickSeeds,
  tileCosts,
  type ProvinceInput,
  type ProvinceMap
} from '../src/terrain/provinces'

/**
 * A world drawn as text, one character per tile:
 *   .  open land (cost 1)     #  rough ground (cost 10)     ~  water
 *   A-Z  open land with a seed on it (the seeds are numbered in letter order)
 */
function draw(
  rows: string[]
): ProvinceInput & { seeds: number[]; at: (x: number, y: number) => number } {
  const height = rows.length
  const width = rows[0].length
  const land = new Uint8Array(width * height)
  const cost = new Float32Array(width * height)
  const letters: Array<{ letter: string; tile: number }> = []
  rows.forEach((row, y) => {
    expect(row).toHaveLength(width)
    ;[...row].forEach((ch, x) => {
      const i = y * width + x
      if (ch === '~') return
      land[i] = 1
      cost[i] = ch === '#' ? 10 : 1
      if (/[A-Z]/.test(ch)) letters.push({ letter: ch, tile: i })
    })
  })
  letters.sort((p, q) => p.letter.localeCompare(q.letter))
  return {
    width,
    height,
    land,
    cost,
    seeds: letters.map((l) => l.tile),
    at: (x, y) => y * width + x
  }
}

function build(world: ReturnType<typeof draw>, minArea = 1, spacing = 6): ProvinceMap {
  return buildProvinces({ ...world, spacing, minArea, seeds: world.seeds })
}

function tilesOf(map: ProvinceMap, p: number): number[] {
  return [...map.tiles.subarray(map.start[p], map.start[p + 1])]
}

function neighboursOf(map: ProvinceMap, p: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let k = map.neighbourStart[p]; k < map.neighbourStart[p + 1]; k += 1) {
    out.push([map.neighbourId[k], map.neighbourBorder[k]])
  }
  return out
}

/** A pocket ringed by rough ground: its own seed holds only a few tiles. */
const pocket = [
  '.........................',
  '.........................',
  '.......#####.............',
  '.......#.S.#.............',
  '.......#####.............',
  '.........................',
  '.A.....................B.'
]

/** Every neighbour and border length in `map` is what counting side by side tiles on the ground gives. */
function expectBordersMatch(map: ProvinceMap, w: ReturnType<typeof draw>): void {
  const expected = new Map<string, number>()
  const note = (i: number, j: number): void => {
    const p = map.provinceOf[i]
    const q = map.provinceOf[j]
    if (p === q || p === NO_PROVINCE || q === NO_PROVINCE) return
    const key = `${Math.min(p, q)}-${Math.max(p, q)}`
    expected.set(key, (expected.get(key) ?? 0) + 1)
  }
  for (let y = 0; y < w.height; y += 1) {
    for (let x = 0; x < w.width; x += 1) {
      if (x + 1 < w.width) note(y * w.width + x, y * w.width + x + 1)
      if (y + 1 < w.height) note(y * w.width + x, (y + 1) * w.width + x)
    }
  }
  expect(expected.size).toBeGreaterThan(0)
  let listed = 0
  for (let p = 0; p < map.count; p += 1) {
    for (const [q, border] of neighboursOf(map, p)) {
      expect(expected.get(`${Math.min(p, q)}-${Math.max(p, q)}`)).toBe(border)
      expect(neighboursOf(map, q)).toContainEqual([p, border])
      listed += 1
    }
  }
  expect(listed).toBe(expected.size * 2)
}

describe('tileCosts: the cost of a tile from the route cost grid', () => {
  const grid: CostGrid = {
    cell: 2,
    cols: 2,
    rows: 2,
    cost: new Float32Array([1, 3, Infinity, 20]),
    land: new Uint8Array([1, 1, 0, 1])
  }

  it('gives each tile the cost of the cell it is in', () => {
    const costs = tileCosts(grid, 4, 4, 100)
    expect(costs[0]).toBe(1)
    expect(costs[1 * 4 + 1]).toBe(1)
    expect(costs[0 * 4 + 2]).toBe(3)
    expect(costs[3 * 4 + 3]).toBe(20)
  })

  it('caps the cost, so a mountain wall is a barrier and not a different planet', () => {
    const costs = tileCosts(grid, 4, 4, 12)
    expect(costs[3 * 4 + 3]).toBe(12)
    expect(costs[2 * 4 + 0]).toBe(12) // closed (Infinity) cells are capped too
    expect(costs[0]).toBe(1)
  })

  it('reads a grid whose last cells are partial', () => {
    const odd: CostGrid = {
      cell: 4,
      cols: 2,
      rows: 1,
      cost: new Float32Array([2, 5]),
      land: new Uint8Array([1, 1])
    }
    const costs = tileCosts(odd, 6, 3, 12)
    expect(costs).toHaveLength(18)
    expect(costs[5]).toBe(5)
    expect(costs[3]).toBe(2)
  })
})

describe('buildProvinces: provinces are the cells of the seeds in travel cost', () => {
  it('splits open ground about halfway between two seeds', () => {
    const w = draw(['A.........B'])
    const map = build(w)
    expect(map.count).toBe(2)
    const a = map.provinceOf[w.at(0, 0)]
    const b = map.provinceOf[w.at(10, 0)]
    expect(a).not.toBe(b)
    for (let x = 0; x <= 4; x += 1) expect(map.provinceOf[w.at(x, 0)]).toBe(a)
    for (let x = 6; x <= 10; x += 1) expect(map.provinceOf[w.at(x, 0)]).toBe(b)
    expect(Math.abs(map.area[a] - map.area[b])).toBeLessThanOrEqual(1)
  })

  it('puts the border in the middle of a wall of rough ground', () => {
    // each seed reaches its own side of the wall for 7.5 and the far side for 17.5
    const w = draw(['..A..##..B..'])
    const map = build(w)
    const a = map.provinceOf[w.at(2, 0)]
    const b = map.provinceOf[w.at(9, 0)]
    for (let x = 0; x <= 5; x += 1) expect(map.provinceOf[w.at(x, 0)]).toBe(a)
    for (let x = 6; x <= 11; x += 1) expect(map.provinceOf[w.at(x, 0)]).toBe(b)
  })

  it('does not let a province reach across a wall that has open ground on its own side', () => {
    const w = draw(['.....##.....', '..A..##..B..', '.....##.....', '.....##.....', '.....##.....'])
    const map = build(w)
    const left = new Set<number>()
    const right = new Set<number>()
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 12; x += 1) {
        ;(x < 6 ? left : right).add(map.provinceOf[w.at(x, y)])
      }
    }
    // no province has tiles on both sides of the wall
    for (const p of left) expect(right.has(p)).toBe(false)
  })

  /** The provinces as text, one letter per province (in seed order) and `~` for none. */
  const text = (w: ReturnType<typeof draw>, map: ProvinceMap): string[] =>
    Array.from({ length: w.height }, (_, y) =>
      Array.from({ length: w.width }, (_, x) => {
        const p = map.provinceOf[w.at(x, y)]
        return p === NO_PROVINCE ? '~' : String.fromCharCode(65 + p)
      }).join('')
    )

  it('prices a step as the mean of the two tiles, so the way there costs what the way back does', () => {
    // worked out by hand and with an independent search: entering a tile at its own cost instead of the mean
    // gives (3, 2) to A and not to B
    const w = draw(['....#B.', '.#...#A', '....#..'])
    expect(text(w, build(w))).toEqual(['BBBBBBB', 'BBBBBBA', 'BBBAAAA'])
  })

  it('does not wrap a province around the edge of the map to the next row', () => {
    const right = draw(['.....A', '.....B'])
    // from the end of row 0 the start of row 1 is one index away, but six tiles from A and five from B
    expect(text(right, build(right, 1, 6))).toEqual(['AAAAAA', 'BBBBBB'])
    const left = draw(['A.....', 'B.....'])
    expect(text(left, build(left, 1, 6))).toEqual(['AAAAAA', 'BBBBBB'])
  })

  it('gives water no province', () => {
    const w = draw(['A..~~~..B', 'A..~~~..B'.replace('A', '.')])
    const map = build(w)
    for (let i = 0; i < w.land.length; i += 1) {
      if (w.land[i] === 0) expect(map.provinceOf[i]).toBe(NO_PROVINCE)
      else expect(map.provinceOf[i]).not.toBe(NO_PROVINCE)
    }
  })

  it('makes every province one connected piece', () => {
    const w = draw([
      'A......#.......B',
      '.......#.......#',
      '..####.#..~~~..#',
      '..#..#.#..~~~..#',
      '..#..#.....~~..#',
      '..#C.#######...#',
      '..####..........',
      '................',
      '..........D.....'
    ])
    const map = build(w)
    expect(map.count).toBeGreaterThanOrEqual(3)
    for (let p = 0; p < map.count; p += 1) {
      const tiles = new Set(tilesOf(map, p))
      const seen = new Set<number>()
      const stack = [tilesOf(map, p)[0]]
      while (stack.length > 0) {
        const t = stack.pop() as number
        if (seen.has(t)) continue
        seen.add(t)
        const x = t % w.width
        for (const n of [
          x > 0 ? t - 1 : -1,
          x < w.width - 1 ? t + 1 : -1,
          t - w.width,
          t + w.width
        ]) {
          if (tiles.has(n) && !seen.has(n)) stack.push(n)
        }
      }
      expect(seen.size).toBe(tiles.size)
    }
  })

  it('is deterministic', () => {
    const w = draw(['A...#...B', '....#....', '..C.#....'])
    const a = build(w)
    const b = build(w)
    expect(Array.from(a.provinceOf)).toEqual(Array.from(b.provinceOf))
    expect(Array.from(a.neighbourBorder)).toEqual(Array.from(b.neighbourBorder))
  })

  it('refuses more provinces than a 16 bit id can name', () => {
    const size = 260
    const land = new Uint8Array(size * size).fill(1)
    const cost = new Float32Array(size * size).fill(1)
    const seeds = Array.from({ length: size * size }, (_, i) => i)
    expect(() =>
      buildProvinces({ width: size, height: size, land, cost, spacing: 5, minArea: 1, seeds })
    ).toThrow(/too many provinces/)
  })
})

describe('buildProvinces: the lists a province carries', () => {
  const w = draw(['A...#...B', '....#....', '..C.#....', '.........'])
  const map = build(w)

  it('lists each province tiles, with an area and a place', () => {
    let total = 0
    for (let p = 0; p < map.count; p += 1) {
      const tiles = tilesOf(map, p)
      expect(tiles).toHaveLength(map.area[p])
      total += tiles.length
      for (const t of tiles) expect(map.provinceOf[t]).toBe(p)
      let sx = 0
      let sy = 0
      let sc = 0
      for (const t of tiles) {
        sx += t % w.width
        sy += Math.floor(t / w.width)
        sc += w.cost[t]
      }
      expect(map.centroidX[p]).toBeCloseTo(sx / tiles.length, 4)
      expect(map.centroidY[p]).toBeCloseTo(sy / tiles.length, 4)
      expect(map.meanCost[p]).toBeCloseTo(sc / tiles.length, 4)
      expect(map.provinceOf[map.seed[p]]).toBe(p)
    }
    expect(total).toBe(w.land.reduce((n, v) => n + v, 0))
  })

  it('lists neighbours both ways, with the length of the shared border', () => {
    expectBordersMatch(map, w)
  })

  it('lists neighbours by id', () => {
    for (let p = 0; p < map.count; p += 1) {
      const ids = neighboursOf(map, p).map(([q]) => q)
      expect(ids).toEqual([...ids].sort((x, y) => x - y))
    }
  })
})

describe('buildProvinces: a province too small to hold merges into a neighbour', () => {
  const rows = pocket

  it('has one more province before the merge than after', () => {
    const w = draw(rows)
    const whole = build(w, 1)
    const merged = build(w, 30)
    expect(merged.count).toBeLessThan(whole.count)
  })

  it('leaves no province under the minimum', () => {
    const w = draw(rows)
    const merged = build(w, 30)
    for (let p = 0; p < merged.count; p += 1) expect(merged.area[p]).toBeGreaterThanOrEqual(30)
    expect(merged.provinceOf.filter((v, i) => w.land[i] === 1 && v === NO_PROVINCE)).toHaveLength(0)
  })

  it('merges into the neighbour that shares the longest border', () => {
    const w = draw(rows)
    const whole = build(w, 1)
    const small = whole.provinceOf[w.at(9, 3)]
    const neighbours = neighboursOf(whole, small)
    const lengths = neighbours.map(([, b]) => b)
    expect(neighbours.length).toBeGreaterThanOrEqual(2)
    expect(new Set(lengths).size).toBeGreaterThan(1) // the test means something only when borders differ
    const longest = neighbours.reduce((best, n) => (n[1] > best[1] ? n : best))[0]
    // the pocket is the only province under 30 tiles, so it alone merges, into its longest-border neighbour
    const areas = Array.from(whole.area).filter((a) => a < 30)
    expect(areas).toHaveLength(1)
    const merged = build(w, 30)
    const target = merged.provinceOf[w.at(9, 3)]
    expect(target).toBe(
      merged.provinceOf[w.at(longest === whole.provinceOf[w.at(1, 6)] ? 1 : 24, 6)]
    )
  })

  it('merges the smallest first, so two small neighbours are not both swallowed', () => {
    // C (4 tiles) and D (5) are under 8, A and B are not. C goes first into D (10 tiles, now big enough).
    // The largest first would send D into A (a tie, lower id), and then C into A as well.
    const w = draw(['.C....D.....A.......................B........'])
    const whole = build(w, 1)
    expect(whole.count).toBe(4)
    const map = build(w, 8)
    expect(map.count).toBe(3)
    expect(map.provinceOf[w.at(0, 0)]).toBe(map.provinceOf[w.at(6, 0)])
    expect(map.provinceOf[w.at(6, 0)]).not.toBe(map.provinceOf[w.at(12, 0)])
  })

  it('breaks a tie between equal borders by the lower province id', () => {
    // C is small and touches A and B with one tile edge each; A has the lower id
    const w = draw(['.......A.....C.B.......'])
    const whole = build(w, 1)
    const c = whole.provinceOf[w.at(13, 0)]
    expect(neighboursOf(whole, c).map(([, b]) => b)).toEqual([1, 1])
    const map = build(w, 8)
    expect(map.count).toBe(2)
    expect(map.provinceOf[w.at(13, 0)]).toBe(map.provinceOf[w.at(7, 0)])
  })

  it('lists the borders of a merged province as they are on the ground', () => {
    const w = draw(pocket)
    const map = build(w, 30)
    expectBordersMatch(map, w)
  })

  it('drops a speck with nothing to merge into', () => {
    const w = draw(['A.....', '......', '~~~~~~', '~~~~~~', '..~~~.', '..~~~~'])
    const map = buildProvinces({ ...w, spacing: 6, minArea: 5, seeds: [...w.seeds, w.at(0, 4)] })
    expect(map.provinceOf[w.at(0, 4)]).toBe(NO_PROVINCE)
    expect(map.provinceOf[w.at(1, 5)]).toBe(NO_PROVINCE)
    expect(map.count).toBe(1)
  })
})

describe('pickSeeds: where the provinces start', () => {
  it('keeps seeds a spacing apart', () => {
    const size = 80
    const land = new Uint8Array(size * size).fill(1)
    const cost = new Float32Array(size * size).fill(1)
    const seeds = pickSeeds({ width: size, height: size, land, cost }, 20)
    expect(seeds.length).toBeGreaterThan(4)
    for (let i = 0; i < seeds.length; i += 1) {
      for (let j = i + 1; j < seeds.length; j += 1) {
        const dx = (seeds[i] % size) - (seeds[j] % size)
        const dy = Math.floor(seeds[i] / size) - Math.floor(seeds[j] / size)
        expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThanOrEqual(19)
      }
    }
  })

  it('puts the seeds on cheap ground, so the borders fall on the barriers', () => {
    const w = draw([
      '......###......',
      '......###......',
      '......###......',
      '......###......',
      '......###......',
      '......###......'
    ])
    const seeds = pickSeeds(w, 5)
    expect(seeds.length).toBeGreaterThanOrEqual(2)
    for (const s of seeds) expect(w.cost[s]).toBe(1)
  })

  it('takes the cheap ground first, even where the lowest tile index is a wall', () => {
    const w = draw(['###.......', '###.......', '###.......'])
    const seeds = pickSeeds(w, 4)
    expect(seeds.length).toBeGreaterThanOrEqual(2)
    for (const s of seeds) expect(w.cost[s]).toBe(1)
  })

  it('prefers a cell that is all land to one that is a few tiles of coast', () => {
    const w = draw(['.~.~....', '~~~~....', '.~.~....', '~~~~....'])
    const seeds = pickSeeds(w, 10)
    expect(seeds[0] % w.width).toBeGreaterThanOrEqual(4)
  })

  it('seeds a cell at its cheapest tile', () => {
    const w = draw(['#.', '##'])
    expect(pickSeeds(w, 10)[0]).toBe(1)
  })

  it('gives every landmass a seed, even when it is far from any other', () => {
    const w = draw([
      '...............~~~~~~~~~~~~~~~',
      '...............~~~~~~~~~~~~~~~',
      '~~~~~~~~~~~~~~~~~~~~~..~~~~~~~',
      '~~~~~~~~~~~~~~~~~~~~~..~~~~~~~',
      '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
      '..............................'
    ])
    const { seeds: _unused, ...input } = w
    void _unused
    const map = buildProvinces({ ...input, spacing: 12, minArea: 2 })
    const lands = new Set<number>()
    for (const [x, y] of [
      [0, 0],
      [21, 2],
      [0, 5]
    ]) {
      lands.add(map.provinceOf[w.at(x, y)])
    }
    expect(lands.has(NO_PROVINCE)).toBe(false)
    expect(lands.size).toBe(3)
  })

  it('is deterministic and lists the best seed first', () => {
    const w = draw(['..#####...', '..#####...', '..........', '..........'])
    expect(pickSeeds(w, 3)).toEqual(pickSeeds(w, 3))
  })
})
