import { describe, expect, it } from 'vitest'
import type { WorldConfigOverrides } from '@sovereign/config'
import { biomeRgba, politicalRgba } from '@sovereign/renderer'
import { World } from '@sovereign/simulation'
import { TickRunner } from '../src/host/tickRunner'

const STYLE = { alpha: 0.45, darken: 0.35, provinceDarken: 0.18 }

/** A small world with enough variety to be interesting (default noise is tuned for 2000x2000). */
const SMALL: WorldConfigOverrides = {
  map: { width: 96, height: 64, seaLevel: 0.2 },
  elevation: { scale: 0.0096, continentScale: 0.0024, oceanScale: 0.00144 },
  temperature: { scale: 0.03 },
  humidity: { scale: 0.048 },
  biomeNoise: { scale: 0.072 },
  rivers: { primaryScale: 0.0108, secondaryScale: 0.048, warpStrength: 3 },
  provinces: { spacing: 8, minArea: 10 },
  nations: { count: 5, minSpacing: 12, startArea: 100 }
}

function setup(minOverlayMs = 250): {
  world: World
  runner: TickRunner
  clock: { now: number }
} {
  const world = World.create({ seed: 21, config: SMALL })
  const clock = { now: 1000 }
  return { world, runner: new TickRunner(world, STYLE, () => clock.now, minOverlayMs), clock }
}

describe('TickRunner: running the world', () => {
  it('runs the ticks asked for and reports where the clock is', () => {
    const { world, runner } = setup()
    const { message } = runner.run(25)
    expect(message.type).toBe('ticked')
    expect(world.clock.tick).toBe(25)
    expect(message.tick).toBe(25)
    expect(message.time).toBe(world.clock.time)
  })

  it('runs nothing for 0 ticks (to ask for what is pending)', () => {
    const { world, runner } = setup()
    runner.run(0)
    expect(world.clock.tick).toBe(0)
  })

  it('rejects a number of ticks that is negative or not whole', () => {
    const { runner } = setup()
    expect(() => runner.run(-1)).toThrow(RangeError)
    expect(() => runner.run(1.5)).toThrow(RangeError)
    expect(() => runner.run(Number.NaN)).toThrow(RangeError)
  })

  it('sends the nations as they are now: their land and stats grow with them', () => {
    const { world, runner } = setup()
    const before = world.snapshot().nations.map((n) => n.area)
    const { message } = runner.run(400)
    expect(message.nations).toEqual(world.snapshot().nations)
    expect(message.nations.some((n, i) => n.area > before[i]!)).toBe(true)
  })

  it('counts the provinces claimed in this run, not in all of them', () => {
    const { world, runner } = setup()
    const first = runner.run(200).message.claims
    expect(first).toBe(world.expansionClaims)
    const second = runner.run(200).message.claims
    expect(second).toBe(world.expansionClaims - first)
  })

  it('says when the borders have stopped moving for good', () => {
    const { world, runner } = setup()
    expect(runner.run(1).message.saturated).toBe(false)
    let guard = 0
    while (!world.saturated && guard < 100) {
      runner.run(500)
      guard += 1
    }
    expect(runner.run(1).message.saturated).toBe(true)
  })

  it('runs the same world as running it directly', () => {
    const { world, runner } = setup()
    const direct = World.create({ seed: 21, config: SMALL })
    runner.run(120)
    direct.run(120)
    expect(world.stateHash()).toBe(direct.stateHash())
  })
})

describe('TickRunner: ownership and the political overlay', () => {
  it('sends nothing about ownership when nothing was claimed', () => {
    const { runner } = setup()
    expect(runner.run(0).message.ownership).toBeUndefined()
  })

  it('sends the ownership layer when provinces changed hands, as a copy', () => {
    const { world, runner } = setup()
    const { message } = runner.run(300)
    expect(message.claims).toBeGreaterThan(0)
    expect(message.ownership).toBeDefined()
    expect(message.ownership).toEqual(world.map.ownership)
    expect(message.ownership).not.toBe(world.map.ownership)
  })

  it('sends the political overlay only when it is asked for', () => {
    const { runner } = setup()
    const without = runner.run(300)
    expect(without.message.ownership).toBeDefined()
    expect(without.message.political).toBeUndefined()
    // asking now brings the overlay for the claims it has not had yet
    const asked = runner.run(0, { political: true, flush: true })
    expect(asked.message.political).toBeDefined()
  })

  it('draws the overlay with the provinces and the nations as they are', () => {
    const { world, runner } = setup()
    const { message } = runner.run(300, { political: true })
    const t = world.terrain
    const expected = politicalRgba(
      biomeRgba(t.biomeIds, t.riverWidth, t.width, t.height),
      world.map.ownership,
      world.nations.map((n) => n.color),
      t.width,
      t.height,
      STYLE,
      world.provinces.provinceOf
    )
    expect(message.political).toEqual(expected)
  })

  it('does not send the same overlay twice', () => {
    const { runner } = setup()
    runner.run(300, { political: true })
    const again = runner.run(0, { political: true, flush: true })
    expect(again.message.ownership).toBeUndefined()
    expect(again.message.political).toBeUndefined()
  })

  it('lists every buffer it sends for transfer', () => {
    const { runner } = setup()
    const { message, transfer } = runner.run(300, { political: true })
    const buffers = [message.ownership, message.political].map((a) => a?.buffer)
    expect(transfer).toEqual(buffers)
  })

  it('has nothing to transfer when nothing is sent', () => {
    const { runner } = setup()
    expect(runner.run(0).transfer).toEqual([])
  })
})

describe('TickRunner: the throttle', () => {
  it('holds back an update sent too soon after the last one, and sends it when due', () => {
    const { runner, clock } = setup(250)
    const first = runner.run(300)
    expect(first.message.ownership).toBeDefined() // the first update is always due
    clock.now += 100
    const soon = runner.run(300)
    expect(soon.message.claims).toBeGreaterThan(0)
    expect(soon.message.ownership).toBeUndefined() // 100 ms is too soon
    clock.now += 200
    const due = runner.run(0)
    expect(due.message.ownership).toBeDefined() // 300 ms since the last one: the held-back claims go out
  })

  it('does not let an idle moment delay the next update', () => {
    const { runner, clock } = setup(250)
    runner.run(300) // sent at t = 1000
    clock.now += 300
    runner.run(0) // due, but nothing to send: this must not restart the throttle
    clock.now += 10
    const next = runner.run(300)
    expect(next.message.claims).toBeGreaterThan(0)
    expect(next.message.ownership).toBeDefined() // 310 ms since the last update that was sent
  })

  it('sends a held-back update at once when asked to flush (the player paused)', () => {
    const { runner, clock } = setup(250)
    runner.run(300)
    clock.now += 10
    runner.run(300)
    const flushed = runner.run(0, { flush: true })
    expect(flushed.message.ownership).toBeDefined()
  })

  it('sends the last update at once when the borders have stopped moving, so nothing is left pending', () => {
    // a throttle so long that nothing but saturation could release an update after the first
    const { world, runner } = setup(1e12)
    let latest: Uint8Array | undefined
    let guard = 0
    while (!world.saturated && guard < 400) {
      const { message } = runner.run(500)
      if (message.ownership !== undefined) latest = message.ownership
      guard += 1
    }
    expect(world.saturated).toBe(true)
    expect(runner.pending).toBe(false)
    expect(latest).toEqual(world.map.ownership) // the final borders were delivered, not held back
  })

  it('knows whether an update is pending', () => {
    const { runner, clock } = setup(250)
    expect(runner.pending).toBe(false)
    runner.run(300)
    clock.now += 10
    runner.run(300)
    expect(runner.pending).toBe(true)
    runner.run(0, { flush: true })
    expect(runner.pending).toBe(false)
  })
})
