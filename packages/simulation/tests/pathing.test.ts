import { describe, expect, it } from 'vitest'
import type { CostGrid } from '../src/terrain/cost'
import { Pathfinder, RouteCache, routePosition } from '../src/terrain/pathing'

/**
 * A cost grid drawn as text, one character per cell (the cell is 4 tiles):
 *   .  open land (cost 1)    #  rough ground (cost 10)    ~  a sea lane (cost 5, water)    x  closed (Infinity)
 */
function draw(rows: string[]): { grid: CostGrid; at: (x: number, y: number) => number } {
  const height = rows.length
  const cols = rows[0].length
  const cost = new Float32Array(cols * height)
  const land = new Uint8Array(cols * height)
  rows.forEach((row, y) => {
    expect(row).toHaveLength(cols)
    ;[...row].forEach((ch, x) => {
      const c = y * cols + x
      if (ch === '.') [cost[c], land[c]] = [1, 1]
      else if (ch === '#') [cost[c], land[c]] = [10, 1]
      else if (ch === '~') [cost[c], land[c]] = [5, 0]
      else [cost[c], land[c]] = [Infinity, 0]
    })
  })
  return { grid: { cell: 4, cols, rows: height, cost, land }, at: (x, y) => y * cols + x }
}

const xy = (grid: CostGrid, c: number): [number, number] => [
  c % grid.cols,
  Math.floor(c / grid.cols)
]

describe('Pathfinder: the cheapest way over the ground', () => {
  it('goes straight along open ground, from the start to the goal', () => {
    const { grid, at } = draw(['.......'])
    const route = new Pathfinder(grid).find(at(0, 0), at(6, 0))
    expect(route).not.toBeNull()
    expect(Array.from(route!.cells)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(route!.cost).toBeCloseTo(6, 5)
  })

  it('prices a diagonal step at the square root of two times the mean cost of the two cells', () => {
    const { grid, at } = draw(['...', '...', '...'])
    const route = new Pathfinder(grid).find(at(0, 0), at(2, 2))!
    expect(route.cost).toBeCloseTo(2 * Math.SQRT2, 5)
    expect(route.cells).toHaveLength(3)
  })

  it('goes round a wall through the gap rather than over it', () => {
    const { grid, at } = draw(['..#..', '..#..', '.....', '..#..'])
    const route = new Pathfinder(grid).find(at(0, 0), at(4, 0))!
    const crossing = Array.from(route.cells)
      .map((c) => xy(grid, c))
      .filter(([x]) => x === 2)
    expect(crossing).toEqual([[2, 2]])
  })

  it('goes over rough ground when there is no way round, and pays for it', () => {
    const { grid, at } = draw(['..#..'])
    const route = new Pathfinder(grid).find(at(0, 0), at(4, 0))!
    expect(route.cost).toBeCloseTo(1 + 5.5 + 5.5 + 1, 5) // each step is the mean of the two cells it joins
  })

  it('has a route of one cell and no cost from a cell to itself', () => {
    const { grid, at } = draw(['...'])
    const route = new Pathfinder(grid).find(at(1, 0), at(1, 0))!
    expect(Array.from(route.cells)).toEqual([at(1, 0)])
    expect(route.cost).toBe(0)
  })

  it('costs the same there and back', () => {
    const { grid, at } = draw(['..#...', '.#..#.', '...#..', '#.....'])
    const finder = new Pathfinder(grid)
    const there = finder.find(at(0, 0), at(5, 3))!
    const back = finder.find(at(5, 3), at(0, 0))!
    expect(back.cost).toBeCloseTo(there.cost, 4)
  })
})

describe('Pathfinder: where a walker may go', () => {
  it('never steps onto water or closed ground, though a sea lane has a cost', () => {
    const { grid, at } = draw(['.~~~.', '.~~~.', '.....'])
    const route = new Pathfinder(grid).find(at(0, 0), at(4, 0))!
    for (const c of route.cells) expect(grid.land[c]).toBe(1)
    expect(route.cost).toBeGreaterThan(4)
  })

  it('has no route to an island, or from or to a cell that is not land', () => {
    const { grid, at } = draw(['..~..', '..~..', '..x..'])
    const finder = new Pathfinder(grid)
    expect(finder.find(at(0, 0), at(4, 0))).toBeNull()
    expect(finder.find(at(2, 0), at(0, 0))).toBeNull()
    expect(finder.find(at(0, 0), at(2, 2))).toBeNull()
  })

  it('may cross a sea lane when told it is a boat', () => {
    const { grid, at } = draw(['..~..'])
    const boat = new Pathfinder(grid, { landOnly: false }).find(at(0, 0), at(4, 0))!
    expect(boat.cells).toHaveLength(5)
    expect(boat.cost).toBeCloseTo(1 + 3 + 3 + 1, 5)
  })

  it('lets a boat cross water but never closed ground', () => {
    const { grid, at } = draw(['.x.', '.x.'])
    expect(new Pathfinder(grid, { landOnly: false }).find(at(0, 0), at(2, 0))).toBeNull()
    expect(new Pathfinder(grid, { landOnly: false }).find(at(1, 0), at(0, 0))).toBeNull() // starting on closed ground
  })

  it('has no route to a cell the search cannot reach within its limit, and says so rather than guessing', () => {
    const { grid, at } = draw(['..................................'])
    const finder = new Pathfinder(grid, { maxExpand: 10 })
    expect(finder.find(at(0, 0), at(33, 0))).toBeNull()
    expect(new Pathfinder(grid).find(at(0, 0), at(33, 0))).not.toBeNull()
  })

  it('rejects a cell that is not on the grid', () => {
    const { grid } = draw(['...'])
    const finder = new Pathfinder(grid)
    expect(() => finder.find(-1, 0)).toThrow(RangeError)
    expect(() => finder.find(0, 3)).toThrow(RangeError)
    expect(() => finder.find(0.5, 1)).toThrow(RangeError)
    expect(() => finder.find(1, 0.5)).toThrow(RangeError)
    expect(() => finder.find(0, -1)).toThrow(RangeError)
    expect(() => finder.find(3, 0)).toThrow(RangeError) // the first cell past the end
  })
})

describe('Pathfinder: the same answer every time', () => {
  const world = draw([
    '..#....#..',
    '.#..##..#.',
    '...#..#...',
    '#.....#.#.',
    '..#.##....',
    '.#......#.'
  ])

  it('is not affected by the searches made before it', () => {
    const used = new Pathfinder(world.grid)
    const pairs: Array<[number, number]> = []
    for (let a = 0; a < 60; a += 7) for (let b = 59; b >= 0; b -= 11) pairs.push([a, b])
    for (const [a, b] of pairs) used.find(a, b)
    for (const [a, b] of pairs) {
      const fresh = new Pathfinder(world.grid).find(a, b)
      const again = used.find(a, b)
      expect(again === null ? null : Array.from(again.cells)).toEqual(
        fresh === null ? null : Array.from(fresh.cells)
      )
    }
  })

  it('chooses the same one of equal routes each time', () => {
    const { grid, at } = draw(['....', '....', '....', '....'])
    const a = new Pathfinder(grid).find(at(0, 0), at(3, 3))!
    const b = new Pathfinder(grid).find(at(0, 0), at(3, 3))!
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells))
  })
})

describe('RouteCache: a route walked by many is found once', () => {
  const { grid, at } = draw(['..#....', '.#..#..', '...#...', '#......'])

  it('gives the route a fresh search would, and the same object again', () => {
    const cache = new RouteCache(new Pathfinder(grid))
    const first = cache.route(at(0, 0), at(6, 3))!
    const fresh = new Pathfinder(grid).find(at(0, 0), at(6, 3))!
    expect(Array.from(first.cells)).toEqual(Array.from(fresh.cells))
    expect(first.cost).toBeCloseTo(fresh.cost, 4)
    expect(cache.route(at(0, 0), at(6, 3))).toBe(first)
  })

  it('knows the way back too, which is the same route reversed, without searching again', () => {
    const finder = new Pathfinder(grid)
    const cache = new RouteCache(finder)
    const there = cache.route(at(0, 0), at(6, 3))!
    const searches = finder.searches
    const back = cache.route(at(6, 3), at(0, 0))!
    expect(finder.searches).toBe(searches)
    expect(Array.from(back.cells)).toEqual(Array.from(there.cells).reverse())
    expect(back.cost).toBeCloseTo(there.cost, 4)
  })

  it('remembers that there is no route', () => {
    const island = draw(['..x..'])
    const finder = new Pathfinder(island.grid)
    const cache = new RouteCache(finder)
    expect(cache.route(0, 4)).toBeNull()
    const searches = finder.searches
    expect(cache.route(0, 4)).toBeNull()
    expect(finder.searches).toBe(searches)
  })

  it('forgets everything when it is full or cleared, and still gives the right answers', () => {
    const finder = new Pathfinder(grid)
    const cache = new RouteCache(finder, 4)
    const keep = cache.route(at(0, 0), at(6, 3))!
    cache.route(at(0, 3), at(6, 0))
    cache.route(at(1, 0), at(5, 3)) // the cache is now over its limit and starts again
    expect(cache.size).toBeLessThanOrEqual(4)
    const again = cache.route(at(0, 0), at(6, 3))!
    expect(Array.from(again.cells)).toEqual(Array.from(keep.cells))
    cache.clear()
    expect(cache.size).toBe(0)
  })
})

describe('routePosition: where a walker is part of the way along', () => {
  const { grid, at } = draw(['.....'])
  const route = new Pathfinder(grid).find(at(0, 0), at(4, 0))!
  const centre = (cell: number): [number, number] => [
    (cell % grid.cols) * grid.cell + 2,
    Math.floor(cell / grid.cols) * grid.cell + 2
  ]

  it('is the first cell centre at the start and the last at the end', () => {
    expect(routePosition(route, grid, 0)).toEqual(centre(at(0, 0)))
    expect(routePosition(route, grid, 1)).toEqual(centre(at(4, 0)))
  })

  it('is halfway between when half the cost is paid', () => {
    const [x, y] = routePosition(route, grid, 0.5)
    expect(x).toBeCloseTo(centre(at(2, 0))[0], 4)
    expect(y).toBeCloseTo(centre(at(2, 0))[1], 4)
  })

  it('moves slowly through rough ground and quickly over open ground', () => {
    const rough = draw(['..#..'])
    const r = new Pathfinder(rough.grid).find(0, 4)!
    // the steps cost 1, 5.5, 5.5 and 1 (13 in all): a thirteenth of the way is one open step, half the cost is
    // the middle of the rough cell, which took 11 of the 13
    expect(routePosition(r, rough.grid, 1 / 13)[0]).toBeCloseTo(2 + 4 * 1, 4)
    expect(routePosition(r, rough.grid, 0.5)[0]).toBeCloseTo(2 + 4 * 2, 4)
    expect(routePosition(r, rough.grid, 12 / 13)[0]).toBeCloseTo(2 + 4 * 3, 4)
  })

  it('walks between the tiles a function names for each cell when it is given one', () => {
    const anchor = (cell: number): [number, number] => [cell * 4 + 1, 7]
    expect(routePosition(route, grid, 0, anchor)).toEqual([at(0, 0) * 4 + 1, 7])
    expect(routePosition(route, grid, 1, anchor)).toEqual([at(4, 0) * 4 + 1, 7])
    const [x, y] = routePosition(route, grid, 0.5, anchor)
    expect(x).toBeCloseTo(at(2, 0) * 4 + 1, 4)
    expect(y).toBe(7)
    const one = new Pathfinder(grid).find(at(2, 0), at(2, 0))!
    expect(routePosition(one, grid, 0.5, anchor)).toEqual([at(2, 0) * 4 + 1, 7])
  })

  it('clamps progress outside 0 to 1, and handles a route of one cell', () => {
    expect(routePosition(route, grid, -3)).toEqual(centre(at(0, 0)))
    expect(routePosition(route, grid, 7)).toEqual(centre(at(4, 0)))
    const one = new Pathfinder(grid).find(at(2, 0), at(2, 0))!
    expect(routePosition(one, grid, 0.5)).toEqual(centre(at(2, 0)))
  })
})

/** The cheapest cost between two cells by plain Dijkstra over every cell (slow, simple, obviously right). */
function dijkstra(grid: CostGrid, start: number, goal: number): number {
  const n = grid.cols * grid.rows
  const best = new Float64Array(n).fill(Infinity)
  const done = new Uint8Array(n)
  best[start] = 0
  for (;;) {
    let cell = -1
    for (let c = 0; c < n; c += 1) {
      if (done[c] === 0 && best[c]! < Infinity && (cell < 0 || best[c]! < best[cell]!)) cell = c
    }
    if (cell < 0) return Infinity
    if (cell === goal) return best[cell]!
    done[cell] = 1
    const x = cell % grid.cols
    const y = (cell - x) / grid.cols
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx
        const ny = y + dy
        if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows)
          continue
        const next = ny * grid.cols + nx
        if (grid.land[next] !== 1 || !(grid.cost[next]! < Infinity)) continue
        const cost =
          best[cell]! +
          (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1) * ((grid.cost[cell]! + grid.cost[next]!) / 2)
        if (cost < best[next]!) best[next] = cost
      }
    }
  }
}

describe('Pathfinder against a plain Dijkstra, on grids drawn at random', () => {
  function randomGrid(seed: number, cols: number, rows: number): CostGrid {
    let s = seed >>> 0
    const next = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      return s / 4294967296
    }
    const text: string[] = []
    for (let y = 0; y < rows; y += 1) {
      let row = ''
      for (let x = 0; x < cols; x += 1) {
        const v = next()
        row += v < 0.55 ? '.' : v < 0.8 ? '#' : v < 0.9 ? '~' : 'x'
      }
      text.push(row)
    }
    return draw(text).grid
  }

  it('finds a route exactly as cheap as the best one, or none when there is none, and the route is walkable', () => {
    let compared = 0
    for (let trial = 0; trial < 25; trial += 1) {
      const grid = randomGrid(trial + 1, 7, 6)
      const finder = new Pathfinder(grid, { maxExpand: 100000 })
      for (let a = 0; a < 42; a += 5) {
        for (let b = 41; b >= 0; b -= 4) {
          if (grid.land[a] !== 1 || grid.land[b] !== 1) continue
          const expected = dijkstra(grid, a, b)
          const route = finder.find(a, b)
          if (expected === Infinity) {
            expect(route).toBeNull()
            continue
          }
          expect(route, `trial ${trial}, ${a} to ${b}`).not.toBeNull()
          expect(route!.cost).toBeCloseTo(expected, 3)
          expect(route!.cells[0]).toBe(a)
          expect(route!.cells[route!.cells.length - 1]).toBe(b)
          for (let i = 1; i < route!.cells.length; i += 1) {
            const [x0, y0] = xy(grid, route!.cells[i - 1]!)
            const [x1, y1] = xy(grid, route!.cells[i]!)
            expect(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))).toBe(1) // one step, never across an edge
            expect(grid.land[route!.cells[i]!]).toBe(1)
          }
          compared += 1
        }
      }
    }
    expect(compared).toBeGreaterThan(200)
  })
})

describe('Pathfinder: bookkeeping', () => {
  it('counts the searches it runs', () => {
    const { grid, at } = draw(['.....'])
    const finder = new Pathfinder(grid)
    expect(finder.searches).toBe(0)
    finder.find(at(0, 0), at(4, 0))
    finder.find(at(4, 0), at(0, 0))
    expect(finder.searches).toBe(2)
  })

  it('is not led astray by what a search that gave up left behind', () => {
    const { grid, at } = draw(['..#.....#.....', '.#..##..#.##..', '......#.......'])
    const limited = new Pathfinder(grid, { maxExpand: 6 })
    expect(limited.find(at(0, 0), at(13, 2))).toBeNull() // gives up with cells still queued
    const after = limited.find(at(0, 0), at(3, 0))
    const fresh = new Pathfinder(grid, { maxExpand: 6 }).find(at(0, 0), at(3, 0))
    expect(after).not.toBeNull()
    expect(Array.from(after!.cells)).toEqual(Array.from(fresh!.cells))
  })

  it('gives a route its cost paid at each cell, rising from 0 to the total, the same backwards', () => {
    const { grid, at } = draw(['..#..', '.....'])
    const cache = new RouteCache(new Pathfinder(grid))
    const there = cache.route(at(0, 0), at(4, 1))!
    const back = cache.route(at(4, 1), at(0, 0))!
    for (const r of [there, back]) {
      expect(r.cumulative[0]).toBe(0)
      expect(r.cumulative[r.cumulative.length - 1]).toBeCloseTo(r.cost, 4)
      for (let i = 1; i < r.cumulative.length; i += 1) {
        expect(r.cumulative[i]).toBeGreaterThan(r.cumulative[i - 1]!)
      }
    }
    // a route costs the same either way, so the way back is the way there from the other end
    expect(back.cumulative[1]).toBeCloseTo(
      there.cost - there.cumulative[there.cumulative.length - 2]!,
      4
    )
  })
})
