import { EntityKind, UnitState } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { EntityStore } from '../src/entities/EntityStore'
import { WanderSystem } from '../src/systems/WanderSystem'
import { Pathfinder, RouteCache, routePosition } from '../src/terrain/pathing'
import { drawGrid } from './support/costGrid'

const OPEN = Array.from({ length: 12 }, () => '.'.repeat(16))

interface Options {
  rows?: string[]
  units?: Array<{ x: number; y: number }>
  radius?: number
  walkSpeed?: number
  restMin?: number
  restMax?: number
  wheelSize?: number
  seed?: number
  /** The map's size in tiles when it is not a whole number of cells. */
  tiles?: { width: number; height: number }
  /** Which tiles are land (default: all of them). */
  land?: (x: number, y: number) => boolean
}

function setup(o: Options = {}) {
  const { grid, at } = drawGrid(o.rows ?? OPEN)
  const entities = new EntityStore(4)
  const routes = new RouteCache(new Pathfinder(grid, { maxExpand: 100000 }))
  const config = {
    perNation: 0,
    walkSpeed: o.walkSpeed ?? 5,
    wanderRadius: o.radius ?? 4,
    restMin: o.restMin ?? 1,
    restMax: o.restMax ?? 4
  }
  const system = new WanderSystem({
    entities,
    grid,
    routes,
    config,
    seed: o.seed ?? 1337,
    width: o.tiles?.width ?? grid.cols * grid.cell,
    height: o.tiles?.height ?? grid.rows * grid.cell,
    wheelSize: o.wheelSize,
    land: o.land ?? (() => true)
  })
  const ids = (o.units ?? [{ x: 34, y: 22 }]).map((u) => system.spawnVillager(u.x, u.y, 0, 0))
  return { grid, at, entities, routes, config, system, ids }
}

const cellOf = (grid: { cols: number; cell: number }, x: number, y: number): number =>
  Math.floor(y / grid.cell) * grid.cols + Math.floor(x / grid.cell)

/** Run until the unit walks (or `limit` ticks), returning the tick it set off on. */
function runUntil(
  s: ReturnType<typeof setup>,
  id: number,
  from: number,
  state: number,
  limit = 500
): number {
  for (let tick = from; tick < from + limit; tick += 1) {
    s.system.step(tick)
    if (s.entities.state[id] === state) return tick
  }
  throw new Error('the unit never reached that state')
}

describe('spawnVillager', () => {
  it('puts a villager on its tile, resting, at home, with a first wake-up within the rest it would take', () => {
    const s = setup({ restMin: 2, restMax: 9 })
    const id = s.ids[0]!
    expect(s.entities.kind[id]).toBe(EntityKind.Villager)
    expect([s.entities.x[id], s.entities.y[id]]).toEqual([34, 22])
    expect(s.entities.state[id]).toBe(UnitState.Rest)
    expect(s.entities.wake[id]).toBeGreaterThanOrEqual(0 + 2)
    expect(s.entities.wake[id]).toBeLessThanOrEqual(0 + 9)
  })

  it('records the owner and the home cell it is given', () => {
    const s = setup()
    const id = s.system.spawnVillager(10, 10, 3, 7)
    expect(s.entities.owner[id]).toBe(3)
    expect(s.entities.home[id]).toBe(7)
  })

  it('staggers the first wake-ups, so a crowd does not set off on one tick', () => {
    const s = setup({
      units: Array.from({ length: 40 }, () => ({ x: 34, y: 22 })),
      restMin: 1,
      restMax: 20
    })
    expect(new Set(s.ids.map((id) => s.entities.wake[id])).size).toBeGreaterThan(8)
  })
})

describe('WanderSystem: a villager rests, walks, arrives, rests', () => {
  it('sets off from rest toward a land cell near home, never the one it is on', () => {
    const s = setup({ units: [{ x: 34, y: 22 }] })
    const id = s.ids[0]!
    s.entities.home[id] = cellOf(s.grid, 34, 22)
    const tick = runUntil(s, id, 0, UnitState.Walk)
    const home = s.entities.home[id] as number
    const target = s.entities.target[id] as number
    expect(target).not.toBe(home)
    expect(s.grid.land[target]).toBe(1)
    const dx = Math.abs((target % s.grid.cols) - (home % s.grid.cols))
    const dy = Math.abs(Math.floor(target / s.grid.cols) - Math.floor(home / s.grid.cols))
    expect(Math.max(dx, dy)).toBeLessThanOrEqual(s.config.wanderRadius)
    expect(s.entities.legStart[id]).toBe(tick)
    expect(s.entities.wake[id]).toBe(s.entities.legEnd[id])
    expect(s.entities.legEnd[id]).toBeGreaterThan(tick)
  })

  it('takes as long as the route costs over its walking speed, rounded up, and at least a tick', () => {
    const s = setup({ walkSpeed: 3 })
    const id = s.ids[0]!
    s.entities.home[id] = cellOf(s.grid, 34, 22)
    runUntil(s, id, 0, UnitState.Walk)
    const route = s.routes.route(
      cellOf(s.grid, s.entities.x[id]!, s.entities.y[id]!),
      s.entities.target[id]!
    )!
    expect(s.entities.legEnd[id]! - s.entities.legStart[id]!).toBe(
      Math.max(1, Math.ceil(route.cost / 3))
    )
  })

  it('arrives on the tick the leg ends, at the middle of the target cell, and rests for a while', () => {
    const s = setup({ restMin: 3, restMax: 8 })
    const id = s.ids[0]!
    s.entities.home[id] = cellOf(s.grid, 34, 22)
    runUntil(s, id, 0, UnitState.Walk)
    const target = s.entities.target[id]!
    const end = s.entities.legEnd[id]!
    for (let tick = s.entities.legStart[id]! + 1; tick < end; tick += 1) {
      s.system.step(tick)
      expect(s.entities.state[id]).toBe(UnitState.Walk) // still on the way
    }
    s.system.step(end)
    expect(s.entities.state[id]).toBe(UnitState.Rest)
    expect(s.entities.x[id]).toBe((target % s.grid.cols) * 4 + 2)
    expect(s.entities.y[id]).toBe(Math.floor(target / s.grid.cols) * 4 + 2)
    const rest = s.entities.wake[id]! - end
    expect(rest).toBeGreaterThanOrEqual(3)
    expect(rest).toBeLessThanOrEqual(8)
  })

  it('keeps walking, resting and walking for as long as time runs', () => {
    const s = setup({ units: Array.from({ length: 10 }, () => ({ x: 34, y: 22 })) })
    for (const id of s.ids) s.entities.home[id] = cellOf(s.grid, 34, 22)
    const walks = new Array<number>(10).fill(0)
    const before = s.ids.map(() => UnitState.Rest as number)
    for (let tick = 0; tick < 600; tick += 1) {
      s.system.step(tick)
      s.ids.forEach((id, k) => {
        const now = s.entities.state[id] as number
        if (now === UnitState.Walk && before[k] === UnitState.Rest) walks[k]! += 1
        before[k] = now
      })
    }
    for (const w of walks) expect(w).toBeGreaterThan(5)
  })

  it('stays on land and on the map, whatever the ground, over a long run', () => {
    const rows = [
      '..#...~~..',
      '.#..#.~~.#',
      '....#..~..',
      '.##...#...',
      '..~...#.#.',
      '....##....'
    ]
    const s = setup({
      rows,
      units: Array.from({ length: 12 }, (_, k) => ({ x: 4 + (k % 3) * 4, y: 6 + (k % 2) * 4 })),
      radius: 3
    })
    s.ids.forEach(
      (id) => (s.entities.home[id] = cellOf(s.grid, s.entities.x[id]!, s.entities.y[id]!))
    )
    for (let tick = 0; tick < 800; tick += 1) {
      s.system.step(tick)
      for (const id of s.ids) {
        const x = s.entities.x[id]!
        const y = s.entities.y[id]!
        expect(x).toBeLessThan(s.grid.cols * 4)
        expect(y).toBeLessThan(s.grid.rows * 4)
        expect(s.grid.land[cellOf(s.grid, x, y)]).toBe(1)
      }
    }
  })
})

describe('WanderSystem: the choices it makes', () => {
  it('rests exactly as long as asked when the shortest and longest rest are the same', () => {
    const s = setup({
      restMin: 3,
      restMax: 3,
      units: Array.from({ length: 6 }, () => ({ x: 34, y: 22 }))
    })
    for (const id of s.ids) expect(s.entities.wake[id]! - 0).toBe(3)
    for (const id of s.ids) s.entities.home[id] = cellOf(s.grid, 34, 22)
    for (let t = 0; t < 200; t += 1) {
      s.system.step(t)
      for (const id of s.ids) {
        if (s.entities.state[id] === UnitState.Rest) {
          // a rest is 3 ticks from when it began; its wake is never further off than 3
          expect(s.entities.wake[id]! - t).toBeLessThanOrEqual(3)
        }
      }
    }
  })

  it('wanders the whole of its radius, both ways on both axes, and no farther', () => {
    const s = setup({ radius: 3, units: Array.from({ length: 60 }, () => ({ x: 26, y: 22 })) })
    const home = cellOf(s.grid, 26, 22)
    for (const id of s.ids) s.entities.home[id] = home
    let minDx = 0
    let maxDx = 0
    let minDy = 0
    let maxDy = 0
    const hx = home % s.grid.cols
    const hy = Math.floor(home / s.grid.cols)
    for (let t = 0; t < 400; t += 1) {
      s.system.step(t)
      for (const id of s.ids) {
        if (s.entities.state[id] !== UnitState.Walk) continue
        const target = s.entities.target[id]!
        const dx = (target % s.grid.cols) - hx
        const dy = Math.floor(target / s.grid.cols) - hy
        minDx = Math.min(minDx, dx)
        maxDx = Math.max(maxDx, dx)
        minDy = Math.min(minDy, dy)
        maxDy = Math.max(maxDy, dy)
      }
    }
    expect([minDx, maxDx, minDy, maxDy]).toEqual([-3, 3, -3, 3])
  })

  it('never picks a place off the map when home is in a corner', () => {
    for (const corner of [
      { x: 2, y: 2 },
      { x: 62, y: 2 },
      { x: 2, y: 46 },
      { x: 62, y: 46 }
    ]) {
      const s = setup({ radius: 6, units: Array.from({ length: 20 }, () => corner) })
      const home = cellOf(s.grid, corner.x, corner.y)
      for (const id of s.ids) s.entities.home[id] = home
      const hx = home % s.grid.cols
      const hy = Math.floor(home / s.grid.cols)
      for (let t = 0; t < 300; t += 1) {
        s.system.step(t)
        for (const id of s.ids) {
          if (s.entities.state[id] !== UnitState.Walk) continue
          const target = s.entities.target[id]!
          expect(
            Math.max(
              Math.abs((target % s.grid.cols) - hx),
              Math.abs(Math.floor(target / s.grid.cols) - hy)
            )
          ).toBeLessThanOrEqual(6)
        }
      }
    }
  })

  it('takes every walk the whole number of ticks the route calls for, rounded up', () => {
    const s = setup({ walkSpeed: 7, units: Array.from({ length: 12 }, () => ({ x: 34, y: 22 })) })
    for (const id of s.ids) s.entities.home[id] = cellOf(s.grid, 34, 22)
    let checked = 0
    for (let t = 0; t < 300; t += 1) {
      s.system.step(t)
      for (const id of s.ids) {
        if (s.entities.state[id] !== UnitState.Walk || s.entities.legStart[id] !== t) continue
        const route = s.routes.route(
          cellOf(s.grid, s.entities.x[id]!, s.entities.y[id]!),
          s.entities.target[id]!
        )!
        expect(s.entities.legEnd[id]! - t).toBe(Math.ceil(route.cost / 7))
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('stands on the map even when the last cell of a row is only partly there', () => {
    // 16 x 12 cells of 4 tiles is 64 x 48, but the map is 62 x 45: the middle of the last cell is off it
    const s = setup({
      tiles: { width: 62, height: 45 },
      units: Array.from({ length: 20 }, () => ({ x: 60, y: 40 })),
      radius: 3
    })
    for (const id of s.ids) s.entities.home[id] = cellOf(s.grid, 60, 40)
    for (let t = 0; t < 300; t += 1) {
      s.system.step(t)
      for (const id of s.ids) {
        expect(s.entities.x[id]).toBeLessThan(62)
        expect(s.entities.y[id]).toBeLessThan(45)
      }
    }
  })
})

describe('WanderSystem: standing in a cell whose middle is water', () => {
  // each cell is 4 x 4 tiles; its middle tiles are (2,2) from the corner. Make the middle of every cell sea.
  const middleIsSea = (x: number, y: number): boolean =>
    !(x % 4 >= 1 && x % 4 <= 2 && y % 4 >= 1 && y % 4 <= 2)

  it('arrives on the land tile nearest the middle of the cell, never in the water', () => {
    const s = setup({
      land: middleIsSea,
      units: Array.from({ length: 15 }, () => ({ x: 34, y: 22 }))
    })
    for (const id of s.ids) s.entities.home[id] = cellOf(s.grid, 34, 22)
    let arrivals = 0
    for (let t = 0; t < 300; t += 1) {
      s.system.step(t)
      for (const id of s.ids) {
        if (s.entities.state[id] === UnitState.Walk) continue
        const x = s.entities.x[id]!
        const y = s.entities.y[id]!
        if (x === 34 && y === 22) continue // where it started
        expect(middleIsSea(x, y)).toBe(true)
        arrivals += 1
      }
    }
    expect(arrivals).toBeGreaterThan(20)
  })

  it('chooses the same tile for a cell every time, the nearest to the middle, ties to the lowest row then column', () => {
    const s = setup({ land: middleIsSea })
    // the middle is (14, 10); the land tiles nearest it, one away, are (15, 10) and (14, 11): the lower row wins
    expect(s.system.anchorOf(s.at(3, 2))).toEqual([15, 10])
    expect(s.system.anchorOf(s.at(3, 2))).toEqual([15, 10])
  })

  it('draws a walker between those tiles, not between the middles', () => {
    const s = setup({ land: middleIsSea, walkSpeed: 0.2 })
    const id = s.ids[0]!
    s.entities.home[id] = cellOf(s.grid, 34, 22)
    runUntil(s, id, 0, UnitState.Walk)
    const [x, y] = s.system.positionAt(id, s.entities.legEnd[id]!)
    expect([x, y]).toEqual(s.system.anchorOf(s.entities.target[id]!))
  })

  it('stands in the middle of a cell that is all land', () => {
    const s = setup()
    expect(s.system.anchorOf(s.at(3, 2))).toEqual([14, 10])
  })

  it('falls back to the middle of a cell with no land in it at all (which a cost grid should not call land)', () => {
    const s = setup({ land: () => false })
    expect(s.system.anchorOf(s.at(1, 1))).toEqual([6, 6])
  })
})

describe('WanderSystem: where a walker is', () => {
  it('is where it rests while it rests', () => {
    const s = setup()
    const id = s.ids[0]!
    expect(s.system.positionAt(id, 0)).toEqual([34, 22])
  })

  it('is on its route in proportion to the leg done, from where it set off to where it will arrive', () => {
    const s = setup({ walkSpeed: 0.2 }) // slow, so the leg is long enough to have a middle
    const id = s.ids[0]!
    s.entities.home[id] = cellOf(s.grid, 34, 22)
    runUntil(s, id, 0, UnitState.Walk)
    const start = s.entities.legStart[id]!
    const end = s.entities.legEnd[id]!
    const target = s.entities.target[id]!
    const [sx, sy] = s.system.positionAt(id, start)
    const startCell = s.routes.route(cellOf(s.grid, s.entities.x[id]!, s.entities.y[id]!), target)!
      .cells[0]!
    expect(sx).toBeCloseTo((startCell % s.grid.cols) * 4 + 2, 3)
    expect(sy).toBeCloseTo(Math.floor(startCell / s.grid.cols) * 4 + 2, 3)
    const [ex, ey] = s.system.positionAt(id, end)
    expect(ex).toBeCloseTo((target % s.grid.cols) * 4 + 2, 3)
    expect(ey).toBeCloseTo(Math.floor(target / s.grid.cols) * 4 + 2, 3)
    expect(end - start).toBeGreaterThanOrEqual(4)
    const mid = Math.floor((start + end) / 2)
    const route = s.routes.route(startCell, target)!
    const expected = routePosition(route, s.grid, (mid - start) / (end - start))
    const [mx, my] = s.system.positionAt(id, mid)
    expect(mx).toBeCloseTo(expected[0], 4)
    expect(my).toBeCloseTo(expected[1], 4)
  })

  it('is clamped to the leg: before it set off it is at the start, after it arrives at the end', () => {
    const s = setup()
    const id = s.ids[0]!
    s.entities.home[id] = cellOf(s.grid, 34, 22)
    runUntil(s, id, 0, UnitState.Walk)
    const start = s.entities.legStart[id]!
    const end = s.entities.legEnd[id]!
    expect(s.system.positionAt(id, start - 50)).toEqual(s.system.positionAt(id, start))
    expect(s.system.positionAt(id, end + 50)).toEqual(s.system.positionAt(id, end))
  })
})

describe('WanderSystem: the same world, however it was reached', () => {
  const crowd = Array.from({ length: 30 }, (_, k) => ({ x: 20 + (k % 5) * 4, y: 18 + (k % 3) * 4 }))
  const snapshot = (s: ReturnType<typeof setup>): string =>
    JSON.stringify([
      s.entities.highWater,
      ...[
        s.entities.kind,
        s.entities.x,
        s.entities.y,
        s.entities.state,
        s.entities.home,
        s.entities.target,
        s.entities.wake,
        s.entities.legStart,
        s.entities.legEnd
      ].map((c) => Array.from(c.subarray(0, s.entities.highWater)))
    ])

  it('is the same twice', () => {
    const a = setup({ units: crowd })
    const b = setup({ units: crowd })
    for (let t = 0; t < 400; t += 1) {
      a.system.step(t)
      b.system.step(t)
    }
    expect(snapshot(a)).toBe(snapshot(b))
  })

  it('goes on exactly the same after being rebuilt from its rows in the middle (what a restore does)', () => {
    const a = setup({ units: crowd })
    for (let t = 0; t < 250; t += 1) a.system.step(t)
    // a second world with the same rows, and a new system that finds its timers from them
    const b = setup({ units: [] })
    for (const id of a.entities.ids()) {
      b.entities.spawn({
        kind: a.entities.kind[id]!,
        x: a.entities.x[id]!,
        y: a.entities.y[id]!,
        owner: a.entities.owner[id]!,
        state: a.entities.state[id]!,
        home: a.entities.home[id]!,
        target: a.entities.target[id]!,
        wake: a.entities.wake[id]!,
        legStart: a.entities.legStart[id]!,
        legEnd: a.entities.legEnd[id]!
      })
    }
    b.system.rebuild()
    expect(snapshot(b)).toBe(snapshot(a))
    for (let t = 250; t < 700; t += 1) {
      a.system.step(t)
      b.system.step(t)
    }
    expect(snapshot(b)).toBe(snapshot(a))
  })

  it('does not depend on the order the units were put on the timers', () => {
    const a = setup({ units: crowd })
    const b = setup({ units: crowd })
    b.system.rebuild() // the same timers, put back in a different order (by id, not by when they were set)
    for (let t = 0; t < 300; t += 1) {
      a.system.step(t)
      b.system.step(t)
    }
    expect(snapshot(b)).toBe(snapshot(a))
  })

  it('draws different choices for a different seed', () => {
    const a = setup({ units: crowd, seed: 1 })
    const b = setup({ units: crowd, seed: 2 })
    for (let t = 0; t < 100; t += 1) {
      a.system.step(t)
      b.system.step(t)
    }
    expect(snapshot(a)).not.toBe(snapshot(b))
  })
})

describe('WanderSystem: awkward cases', () => {
  it('lets a villager on an island of one cell rest and try again, never setting off', () => {
    const s = setup({ rows: ['.x.', 'xxx', '.x.'], units: [{ x: 2, y: 2 }], radius: 2 })
    const id = s.ids[0]!
    s.entities.home[id] = cellOf(s.grid, 2, 2)
    for (let t = 0; t < 300; t += 1) s.system.step(t)
    expect(s.entities.state[id]).toBe(UnitState.Rest)
    expect([s.entities.x[id], s.entities.y[id]]).toEqual([2, 2])
    expect(s.entities.wake[id]).toBeGreaterThanOrEqual(300) // still being woken, and still resting
  })

  it('skips a timer whose villager has gone', () => {
    const s = setup({ units: Array.from({ length: 5 }, () => ({ x: 34, y: 22 })) })
    s.entities.despawn(s.ids[2]!)
    expect(() => {
      for (let t = 0; t < 200; t += 1) s.system.step(t)
    }).not.toThrow()
    expect(s.entities.alive(s.ids[2]!)).toBe(false)
  })

  it('handles walks longer than its timer wheel (a timer that must go round again)', () => {
    const rows = ['.'.repeat(40)]
    const s = setup({
      rows,
      units: [{ x: 2, y: 2 }],
      radius: 30,
      walkSpeed: 0.5,
      wheelSize: 8,
      restMin: 1,
      restMax: 2
    })
    const id = s.ids[0]!
    s.entities.home[id] = cellOf(s.grid, 2, 2)
    const set = runUntil(s, id, 0, UnitState.Walk, 50)
    const end = s.entities.legEnd[id]!
    expect(end - set).toBeGreaterThan(8) // longer than the wheel
    for (let t = set + 1; t < end; t += 1) {
      s.system.step(t)
      expect(s.entities.state[id]).toBe(UnitState.Walk)
    }
    s.system.step(end)
    expect(s.entities.state[id]).toBe(UnitState.Rest)
  })

  it('does nothing, cheaply, with no villagers', () => {
    const s = setup({ units: [] })
    expect(() => {
      for (let t = 0; t < 50; t += 1) s.system.step(t)
    }).not.toThrow()
  })
})
