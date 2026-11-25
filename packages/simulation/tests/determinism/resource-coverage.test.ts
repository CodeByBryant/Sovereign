// A guard against the resources quietly turning back into noise. A resource overhaul replaced one
// thresholded noise layer with placement rules (docs/terrain.md, "Resources"); this generates three
// mid-size worlds and holds them to the design: every one of the 22 resources present, each at the
// share its rule asks for, in the places its geology says, in patches rather than speckle.
// The full 10-world, 2000 x 2000 measurement is `pnpm probe -- tests/probe/resource-quality.probe.ts`.
import { defaultWorldConfig } from '@sovereign/config'
import { BIOME_KEYS, RESOURCE_CATALOG, type ResourceDef } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { topographicPosition } from '../../src/terrain/features'
import { World } from '../../src/world/World'

const SEEDS = [101, 202, 303]
const SIDE = 1000
const rules = defaultWorldConfig.resources.rules
const features = defaultWorldConfig.resources.features

interface Measured {
  land: number
  water: number
  /** tiles holding the resource on land / on water, by catalogue id */
  onLand: number[]
  onWater: number[]
  /** of the land tiles: how many on a ridge, in a basin, and the highest elevation seen */
  onRidge: number[]
  inBasin: number[]
  highest: number[]
  /** objects with another of the same kind within 6 tiles, by id (grouping), and the objects counted */
  grouped: number[]
  counted: number[]
  mountainous: number[]
}

function measure(world: World): Measured {
  const t = world.terrain
  const size = t.width * t.height
  const kinds = RESOURCE_CATALOG.length + 1
  const make = (): number[] => new Array<number>(kinds).fill(0)
  const m: Measured = {
    land: 0,
    water: 0,
    onLand: make(),
    onWater: make(),
    onRidge: make(),
    inBasin: make(),
    highest: make(),
    grouped: make(),
    counted: make(),
    mountainous: make()
  }
  const landMask = new Uint8Array(size)
  for (let i = 0; i < size; i += 1) landMask[i] = t.elevation[i] > t.seaLevel ? 1 : 0
  const position = topographicPosition(
    t.elevation,
    t.width,
    t.height,
    features.ridgeRadius,
    landMask
  )
  const mountain = new Set([
    BIOME_KEYS.indexOf('mountain'),
    BIOME_KEYS.indexOf('alpine'),
    BIOME_KEYS.indexOf('highland')
  ])
  for (const layer of ['surface', 'ground'] as const) {
    const types = t.resources[layer].type
    for (let y = 0; y < t.height; y += 1) {
      for (let x = 0; x < t.width; x += 1) {
        const i = y * t.width + x
        const type = types[i] as number
        if (type === 0) continue
        if (landMask[i] === 1) {
          m.onLand[type] += 1
          if (position[i] >= 0.25 * features.ridgeScale) m.onRidge[type] += 1
          if (position[i] <= -0.25 * features.ridgeScale) m.inBasin[type] += 1
          if (mountain.has(t.biomeIds[i] as number)) m.mountainous[type] += 1
          m.highest[type] = Math.max(m.highest[type] as number, t.elevation[i] as number)
        } else {
          m.onWater[type] += 1
        }
        // is there another of the same kind within 6 tiles? (a patch, rather than a lone speckle)
        let near = false
        for (let dy = -6; !near && dy <= 6; dy += 1) {
          const yy = y + dy
          if (yy < 0 || yy >= t.height) continue
          for (let dx = -6; dx <= 6; dx += 1) {
            const xx = x + dx
            if ((dx === 0 && dy === 0) || xx < 0 || xx >= t.width) continue
            if (types[yy * t.width + xx] === type) {
              near = true
              break
            }
          }
        }
        m.counted[type] += 1
        if (near) m.grouped[type] += 1
      }
    }
  }
  for (let i = 0; i < size; i += 1) {
    if (landMask[i] === 1) m.land += 1
    else m.water += 1
  }
  return m
}

describe(`resource coverage over ${SEEDS.length} worlds of ${SIDE} x ${SIDE}`, () => {
  const worlds = SEEDS.map((seed) =>
    measure(World.create({ seed, config: { map: { width: SIDE, height: SIDE } } }))
  )
  const def = (key: string): ResourceDef =>
    RESOURCE_CATALOG.find((d) => d.key === key) as ResourceDef
  const total = (pick: (m: Measured) => number[], id: number): number =>
    worlds.reduce((n, m) => n + (pick(m)[id] as number), 0)
  const fraction = (pick: (m: Measured) => number[], key: string): number => {
    const id = def(key).id
    const landTiles = total((m) => m.onLand, id)
    return total(pick, id) / landTiles
  }

  it('generates all 22 resources in every world', () => {
    const missing: string[] = []
    for (const d of RESOURCE_CATALOG) {
      worlds.forEach((m, w) => {
        if ((m.onLand[d.id] as number) + (m.onWater[d.id] as number) === 0)
          missing.push(`${d.key} in world ${w}`)
      })
    }
    expect(missing).toEqual([])
  })

  it('gives each resource the share of land (or water) its rule asks for', () => {
    const off: string[] = []
    for (const d of RESOURCE_CATALOG) {
      const rule = rules[d.key]
      if (rule === undefined) continue
      worlds.forEach((m, w) => {
        const landTarget = d.domain === 'water' ? 0 : rule.share * m.land
        const waterTarget =
          d.domain === 'water'
            ? rule.share * m.water
            : d.domain === 'both'
              ? (rule.offshore?.share ?? 0) * m.water
              : 0
        const gotLand = m.onLand[d.id] as number
        const gotWater = m.onWater[d.id] as number
        // exact by construction (an upper bound only if too few tiles qualify, or the room a rule asks for
        // between its objects leaves too few), so a wide band suffices
        for (const [what, got, target] of [
          ['land', gotLand, landTarget],
          ['water', gotWater, waterTarget]
        ] as const) {
          if (target === 0) continue
          const floor = rule.spacing !== undefined && rule.spacing > 1 ? 0.6 : 0.9
          if (got < floor * target || got > 1.01 * target) {
            off.push(`${d.key} ${what} in world ${w}: ${got} tiles, target ${Math.round(target)}`)
          }
        }
      })
    }
    expect(off).toEqual([])
  })

  it('keeps every resource in its domain: land resources on land, fisheries at sea, oil and salt either', () => {
    const wrong: string[] = []
    for (const d of RESOURCE_CATALOG) {
      const onWater = total((m) => m.onWater, d.id)
      const onLand = total((m) => m.onLand, d.id)
      if (d.domain === 'land' && onWater > 0) wrong.push(`${d.key} found at sea`)
      if (d.domain === 'water' && onLand > 0) wrong.push(`${d.key} found on land`)
    }
    expect(wrong).toEqual([])
  })

  it('puts metals and gems on ridges (or in river gravel) and coal and oil in basins', () => {
    for (const key of ['iron', 'copper', 'silver', 'gems', 'gold']) {
      expect(
        fraction((m) => m.onRidge, key),
        `${key} on ridges`
      ).toBeGreaterThanOrEqual(0.9)
    }
    for (const key of ['coal', 'oil']) {
      expect(
        fraction((m) => m.inBasin, key),
        `${key} in basins`
      ).toBeGreaterThanOrEqual(0.9)
    }
  })

  it('keeps oil off the heights and stone, iron and silver in the hills and mountains', () => {
    // oil lies in lowland basins and hills, never in the highland, alpine or mountain biomes
    expect(Math.max(...worlds.map((m) => m.highest[def('oil').id] as number))).toBeLessThan(
      defaultWorldConfig.biomes.highlandElevation
    )
    expect(fraction((m) => m.mountainous, 'stone')).toBeGreaterThanOrEqual(0.9)
    expect(fraction((m) => m.mountainous, 'silver')).toBeGreaterThanOrEqual(0.3)
  })

  it('forms patches and veins, not speckle: almost every object has another of its kind close by', () => {
    const loose: string[] = []
    for (const d of RESOURCE_CATALOG) {
      const counted = total((m) => m.counted, d.id)
      const grouped = total((m) => m.grouped, d.id) / counted
      const share = rules[d.key]?.share ?? 0
      const floor = share >= 0.02 ? 0.95 : 0.8
      if (grouped < floor) loose.push(`${d.key}: ${grouped.toFixed(3)} (floor ${floor})`)
    }
    expect(loose).toEqual([])
  })

  it('leaves room: no resource with a spacing has two objects closer than that', () => {
    // checked on the 1000 x 1000 worlds through the objects' neighbours one tile away
    for (const d of RESOURCE_CATALOG) {
      const spacing = rules[d.key]?.spacing ?? 1
      if (spacing < 2) continue
      for (const seed of SEEDS.slice(0, 1)) {
        const w = World.create({ seed, config: { map: { width: SIDE, height: SIDE } } })
        const types = w.terrain.resources[d.layer].type
        let touching = 0
        for (let y = 0; y < SIDE; y += 1) {
          for (let x = 0; x < SIDE - 1; x += 1) {
            const i = y * SIDE + x
            if (types[i] === d.id && types[i + 1] === d.id) touching += 1
            if (y < SIDE - 1 && types[i] === d.id && types[i + SIDE] === d.id) touching += 1
          }
        }
        expect(touching, `${d.key} objects side by side`).toBe(0)
      }
    }
  })
})
