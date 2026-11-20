import { describe, expect, it } from 'vitest'
import type { CostGrid } from '../src/terrain/cost'
import { findRoutes, pickHubs, type HubSite } from '../src/terrain/routes'

/**
 * A cost grid drawn as text, one character per cell:
 *   .  open land (cost 1)       #  a wall of rough ground (cost 10)      w  a ford, narrow water (cost 3)
 *   ~  a sea lane (cost 5)      x  impassable (Infinity)                  A-Z  open land with a hub on it
 */
function draw(rows: string[]): {
  grid: CostGrid
  hubs: HubSite[]
  at: (x: number, y: number) => number
} {
  const rowsN = rows.length
  const cols = rows[0].length
  const cost = new Float32Array(cols * rowsN)
  const land = new Uint8Array(cols * rowsN)
  const letters: Array<{ letter: string; cell: number }> = []
  rows.forEach((row, y) => {
    expect(row).toHaveLength(cols)
    ;[...row].forEach((ch, x) => {
      const c = y * cols + x
      if (ch === '.') [cost[c], land[c]] = [1, 1]
      else if (ch === '#') [cost[c], land[c]] = [10, 1]
      else if (ch === 'w') [cost[c], land[c]] = [3, 1]
      else if (ch === '~') [cost[c], land[c]] = [5, 0]
      else if (ch === 'x') [cost[c], land[c]] = [Infinity, 0]
      else {
        ;[cost[c], land[c]] = [1, 1]
        letters.push({ letter: ch, cell: c })
      }
    })
  })
  letters.sort((p, q) => p.letter.localeCompare(q.letter))
  return {
    grid: { cell: 4, cols, rows: rowsN, cost, land },
    hubs: letters.map((l) => ({ cell: l.cell, weight: 1 })),
    at: (x, y) => y * cols + x
  }
}

const xy = (grid: CostGrid, c: number): [number, number] => [
  c % grid.cols,
  Math.floor(c / grid.cols)
]

describe('findRoutes: a route between two hubs', () => {
  it('runs from one hub to the other along open ground, cell to cell', () => {
    const { grid, hubs } = draw(['A.......B'])
    const { routes } = findRoutes(grid, hubs)
    expect(routes).toHaveLength(1)
    const route = routes[0]
    expect([route.a, route.b]).toEqual([0, 1])
    expect(route.cells[0]).toBe(hubs[0].cell)
    expect(route.cells[route.cells.length - 1]).toBe(hubs[1].cell)
    expect(route.cells).toHaveLength(9)
    expect(route.cost).toBeCloseTo(8, 5) // eight steps of cost 1
    for (let i = 1; i < route.cells.length; i += 1) {
      const [x0, y0] = xy(grid, route.cells[i - 1])
      const [x1, y1] = xy(grid, route.cells[i])
      expect(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))).toBe(1)
    }
  })

  it('prices a diagonal step at the square root of two', () => {
    const { grid, hubs } = draw(['A....', '.....', '....B'])
    const { routes } = findRoutes(grid, hubs)
    // two diagonal steps and two straight ones: 2 * sqrt(2) + 2
    expect(routes[0].cost).toBeCloseTo(2 * Math.SQRT2 + 2, 4)
  })

  it('goes through the gap in a wall rather than over it (a pass)', () => {
    // the wall (cost 10) has one open cell at (4, 4); crossing it costs 17, going round by the gap about 11
    const { grid, hubs } = draw([
      'A...#...B',
      '....#....',
      '....#....',
      '....#....',
      '.........',
      '....#....'
    ])
    const { routes } = findRoutes(grid, hubs)
    const crossing = routes[0].cells.filter((c) => xy(grid, c)[0] === 4)
    expect(crossing.map((c) => xy(grid, c))).toEqual([[4, 4]])
  })

  it('crosses a river at its narrowest point (a ford)', () => {
    // a river of rough water (cost 10) with one ford (cost 3) at (4, 3)
    const { grid, hubs } = draw([
      'A...#...B',
      '....#....',
      '....#....',
      '....w....',
      '....#....',
      '....#....'
    ])
    const { routes } = findRoutes(grid, hubs)
    const across = routes[0].cells.filter((c) => xy(grid, c)[0] === 4).map((c) => xy(grid, c))
    expect(across).toEqual([[4, 3]])
  })

  it('goes over a wall when there is no way round it', () => {
    const { grid, hubs } = draw(['A...#...B'])
    const { routes } = findRoutes(grid, hubs)
    expect(routes).toHaveLength(1)
    // six steps over open ground, and two steps of (1 + 10) / 2 onto and off the wall
    expect(routes[0].cost).toBeCloseTo(6 + 2 * 5.5, 4)
  })

  it('has no route across impassable ground', () => {
    const { grid, hubs } = draw(['A..x..B', '...x...', '...x...'])
    expect(findRoutes(grid, hubs).routes).toEqual([])
  })

  it('never puts an impassable cell on a route', () => {
    const { grid, hubs } = draw(['A.x.....', '..x.....', '....B...'])
    const { routes } = findRoutes(grid, hubs)
    expect(routes).toHaveLength(1)
    for (const c of routes[0].cells) expect(grid.cost[c]).toBeLessThan(Infinity)
  })
})

describe('findRoutes: which hubs are joined', () => {
  it('joins neighbours, not hubs with another hub between them', () => {
    const { grid, hubs } = draw(['A.....B.....C'])
    const { routes } = findRoutes(grid, hubs)
    expect(routes.map((r) => [r.a, r.b])).toEqual([
      [0, 1],
      [1, 2]
    ])
  })

  it('lists routes in order of their hub pair, each pair once with a < b', () => {
    const { grid, hubs } = draw(['A.....B', '.......', 'C.....D'])
    const { routes } = findRoutes(grid, hubs)
    const pairs = routes.map((r) => [r.a, r.b])
    expect(pairs).toEqual([...pairs].sort((p, q) => p[0] - q[0] || p[1] - q[1]))
    for (const [a, b] of pairs) expect(a).toBeLessThan(b)
    expect(new Set(pairs.map((p) => p.join())).size).toBe(pairs.length)
  })

  it('joins hubs on different landmasses by a sea lane, through the narrowest water', () => {
    // two landmasses with a wide sea between them except for a narrow strait on row 2
    const { grid, hubs } = draw(['A..x..B', '...x...', '...~...', '...x...', '...x...'])
    const { routes } = findRoutes(grid, hubs)
    expect(routes).toHaveLength(1)
    const wet = routes[0].cells.filter((c) => grid.land[c] === 0).map((c) => xy(grid, c))
    expect(wet).toEqual([[3, 2]])
  })

  it('has no sea lane where the water is closed (beyond reach)', () => {
    const { grid, hubs } = draw(['A..xx..B'])
    expect(findRoutes(grid, hubs).routes).toEqual([])
  })

  it('chooses the cheaper of two crossings', () => {
    const { grid, hubs } = draw(['A..#..B', '...#...', '...w...', '...#...'])
    const { routes } = findRoutes(grid, hubs)
    expect(routes[0].cells.map((c) => xy(grid, c)).some(([x, y]) => x === 3 && y === 2)).toBe(true)
  })
})

describe('findRoutes: touching diagonally', () => {
  it('joins hubs whose territories meet only across a diagonal, in either direction', () => {
    const down = draw(['xxA', 'x.x', 'Bxx'])
    expect(findRoutes(down.grid, down.hubs).routes).toHaveLength(1)
    const up = draw(['Axx', 'x.x', 'xxB'])
    expect(findRoutes(up.grid, up.hubs).routes).toHaveLength(1)
  })
})

describe('findRoutes: traffic', () => {
  it('counts the hub pairs whose shortest path uses a route (betweenness)', () => {
    // a line of four hubs: the middle link carries the most pairs
    const { grid, hubs } = draw(['A.....B.....C.....D'])
    const { routes } = findRoutes(grid, hubs)
    expect(routes.map((r) => r.traffic)).toEqual([3, 4, 3])
  })

  it("weights each pair by the product of the hubs' weights", () => {
    const { grid, hubs } = draw(['A.....B.....C'])
    const weighted = hubs.map((h, i) => ({ ...h, weight: [1, 2, 3][i] as number }))
    const { routes } = findRoutes(grid, weighted)
    // A-B carries pairs (A,B) = 1*2 and (A,C) = 1*3; B-C carries (B,C) = 2*3 and (A,C) = 1*3
    expect(routes.map((r) => r.traffic)).toEqual([5, 9])
  })

  it('adds the traffic of every route that crosses a cell to that cell', () => {
    const { grid, hubs } = draw(['A.....B.....C'])
    const net = findRoutes(grid, hubs)
    const hubB = hubs[1].cell
    // hub B is the end of both routes: it carries both
    expect(net.traffic[hubB]).toBeCloseTo(net.routes[0].traffic + net.routes[1].traffic, 5)
    const middle = hubs[0].cell + 3
    expect(net.traffic[middle]).toBeCloseTo(net.routes[0].traffic, 5)
    expect(net.traffic[hubs[0].cell]).toBeCloseTo(net.routes[0].traffic, 5)
  })

  it('leaves cells with no route at 0', () => {
    const { grid, hubs } = draw(['A...B', '.....', '.....', '.....'])
    const net = findRoutes(grid, hubs)
    expect(net.traffic[3 * grid.cols + 2]).toBe(0)
  })
})

describe('findRoutes: input and determinism', () => {
  it('gives the same network twice', () => {
    const { grid, hubs } = draw(['A...#...B', '....#....', '....w....', '..C..#...', '....#.D..'])
    expect(findRoutes(grid, hubs)).toEqual(findRoutes(grid, hubs))
  })

  it('does not depend on the order cells happen to be listed (symmetric ties resolve the same way each time)', () => {
    const { grid, hubs } = draw(['A.......', '........', '........', '.......B'])
    const first = findRoutes(grid, hubs).routes[0].cells
    for (let i = 0; i < 3; i += 1) expect(findRoutes(grid, hubs).routes[0].cells).toEqual(first)
  })

  it('has no routes for fewer than two hubs', () => {
    const { grid, hubs } = draw(['A.....'])
    expect(findRoutes(grid, hubs).routes).toEqual([])
    expect(findRoutes(grid, []).routes).toEqual([])
  })

  it('rejects a hub on an impassable or missing cell, and two hubs on one cell', () => {
    const { grid } = draw(['..x..'])
    expect(() =>
      findRoutes(grid, [
        { cell: 2, weight: 1 },
        { cell: 0, weight: 1 }
      ])
    ).toThrow(RangeError)
    expect(() =>
      findRoutes(grid, [
        { cell: 99, weight: 1 },
        { cell: 0, weight: 1 }
      ])
    ).toThrow(RangeError)
    expect(() =>
      findRoutes(grid, [
        { cell: 0, weight: 1 },
        { cell: 0, weight: 1 }
      ])
    ).toThrow(RangeError)
  })
})

describe('pickHubs', () => {
  const field = (cols: number, rows: number, f: (x: number, y: number) => number): Float32Array => {
    const out = new Float32Array(cols * rows)
    for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) out[y * cols + x] = f(x, y)
    return out
  }

  it('picks the best site first, and nothing within the spacing of it', () => {
    const score = field(20, 20, (x, y) => (x === 5 && y === 5 ? 1 : 0.5))
    const hubs = pickHubs(score, 20, 20, 6, 0.1)
    expect(hubs[0]).toBe(5 * 20 + 5)
    for (const h of hubs.slice(1)) {
      expect(Math.hypot((h % 20) - 5, Math.floor(h / 20) - 5)).toBeGreaterThanOrEqual(6)
    }
  })

  it('works with a spacing that is not a whole number of cells', () => {
    const score = field(30, 30, (x, y) =>
      x === 5 && y === 5 ? 1 : x === 10 && y === 7 ? 0.9 : x === 11 && y === 5 ? 0.8 : 0
    )
    // (10, 7) is 5.39 away, inside 5.5; (11, 5) is 6 away, outside it
    expect(pickHubs(score, 30, 30, 5.5, 0.1)).toEqual([5 * 30 + 5, 5 * 30 + 11])
  })

  it('keeps every pair at least the spacing apart', () => {
    const score = field(40, 40, (x, y) => 0.4 + ((x * 7 + y * 13) % 11) / 100)
    const hubs = pickHubs(score, 40, 40, 7, 0.1)
    expect(hubs.length).toBeGreaterThan(5)
    for (let i = 0; i < hubs.length; i += 1) {
      for (let j = i + 1; j < hubs.length; j += 1) {
        const d = Math.hypot(
          (hubs[i] % 40) - (hubs[j] % 40),
          Math.floor(hubs[i] / 40) - Math.floor(hubs[j] / 40)
        )
        expect(d).toBeGreaterThanOrEqual(7)
      }
    }
  })

  it('takes no site below the minimum score, but one exactly at it', () => {
    const score = field(20, 20, (x) => (x < 10 ? 0 : 0.25))
    expect(pickHubs(score, 20, 20, 3, 0.3)).toEqual([])
    const some = pickHubs(score, 20, 20, 3, 0.25)
    expect(some.length).toBeGreaterThan(0)
    for (const h of some) expect(h % 20).toBeGreaterThanOrEqual(10)
  })

  it('takes no site with a score of 0, even when the minimum is 0', () => {
    const score = field(10, 10, (x) => (x < 5 ? 0 : 0.5))
    const hubs = pickHubs(score, 10, 10, 2, 0)
    expect(hubs.length).toBeGreaterThan(0)
    for (const h of hubs) expect(h % 10).toBeGreaterThanOrEqual(5)
  })

  it('allows a hub at exactly the spacing, and blocks everything nearer, at any angle', () => {
    // the best site is (5, 5); the next best is exactly 6 away, then one 5.39 away (5 across, 2 down)
    const score = field(30, 30, (x, y) =>
      x === 5 && y === 5 ? 1 : x === 11 && y === 5 ? 0.9 : x === 10 && y === 7 ? 0.8 : 0
    )
    expect(pickHubs(score, 30, 30, 6, 0.1)).toEqual([5 * 30 + 5, 5 * 30 + 11])
  })

  it('breaks ties by the lower cell index, so the result never depends on iteration order', () => {
    const score = field(10, 10, () => 0.5)
    const hubs = pickHubs(score, 10, 10, 4, 0.1)
    expect(hubs[0]).toBe(0)
    expect(pickHubs(score, 10, 10, 4, 0.1)).toEqual(hubs)
  })

  it('orders the hubs by score, best first', () => {
    const score = field(30, 30, (x, y) => ((x + y) % 9) / 9 + 0.05)
    const hubs = pickHubs(score, 30, 30, 5, 0.1)
    for (let i = 1; i < hubs.length; i += 1)
      expect(score[hubs[i]]).toBeLessThanOrEqual(score[hubs[i - 1]])
  })
})
