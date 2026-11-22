import {
  BIOME_INDEX,
  BIOME_KEYS,
  RESOURCE_CATALOG,
  type NationProfile,
  type ResourceSlots,
  type StrategicPoint,
  type StrategicRoute
} from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { buildProvinceFacts, combineProfile } from '../src/nations/provinceProfile'
import { measureProfile } from '../src/nations/profile'
import { buildProvinces, NO_PROVINCE } from '../src/terrain/provinces'

const W = 48
const H = 36
const SEA = 0.37
const SIZE = W * H

/** A small deterministic generator, so the test world is the same on every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function makeWorld() {
  const rand = lcg(7)
  const elevation = new Float32Array(SIZE)
  const biomeIds = new Uint8Array(SIZE)
  const riverMask = new Uint8Array(SIZE)
  const land = new Uint8Array(SIZE)
  const cost = new Float32Array(SIZE)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x
      const sea = x > 38 || (y > 28 && x < 8) || (x === 20 && y === 10) // a coast, a bay and a lake
      elevation[i] = sea ? 0.1 : 0.5
      land[i] = sea ? 0 : 1
      cost[i] = 1 + Math.floor(rand() * 3)
      biomeIds[i] = BIOME_INDEX[BIOME_KEYS[Math.floor(rand() * BIOME_KEYS.length)] as 'grassland']
      riverMask[i] = rand() < 0.1 ? 1 : 0
    }
  }
  const slot = (): ResourceSlots['surface'] => ({
    type: new Uint8Array(SIZE),
    richness: new Uint8Array(SIZE),
    stock: new Uint8Array(SIZE)
  })
  const resources: ResourceSlots = { surface: slot(), ground: slot() }
  for (const def of RESOURCE_CATALOG) {
    for (let k = 0; k < 30; k += 1) {
      const tile = Math.floor(rand() * SIZE)
      resources[def.layer].type[tile] = def.id
      resources[def.layer].richness[tile] = 255
      resources[def.layer].stock[tile] = 1 + Math.floor(rand() * 255)
    }
  }
  const points: StrategicPoint[] = []
  for (let k = 0; k < 25; k += 1) {
    points.push({
      x: Math.floor(rand() * W),
      y: Math.floor(rand() * H),
      type: 'mountain_pass',
      value: 1 + Math.floor(rand() * 10)
    })
  }
  const routes: StrategicRoute[] = []
  for (let r = 0; r < 6; r += 1) {
    const path: number[] = []
    let x = Math.floor(rand() * W)
    let y = Math.floor(rand() * H)
    for (let k = 0; k < 30; k += 1) {
      path.push(x, y)
      x = Math.min(W - 1, Math.max(0, x + Math.floor(rand() * 3) - 1))
      y = Math.min(H - 1, Math.max(0, y + Math.floor(rand() * 3) - 1))
    }
    routes.push({ from: 0, to: 1, cost: 10, traffic: 1 + rand() * 20, path })
  }
  const provinces = buildProvinces({
    width: W,
    height: H,
    land,
    cost,
    spacing: 10,
    minArea: 20,
    seeds: [
      5 * W + 5,
      5 * W + 20,
      5 * W + 33,
      18 * W + 8,
      18 * W + 24,
      18 * W + 36,
      30 * W + 14,
      30 * W + 30
    ]
  })
  const terrain = {
    width: W,
    height: H,
    seaLevel: SEA,
    elevation,
    biomeIds,
    riverMask,
    resources
  }
  return { terrain, provinces, points, routes }
}

const world = makeWorld()
const facts = buildProvinceFacts({
  ...world.terrain,
  provinces: world.provinces,
  strategicPoints: world.points,
  routes: world.routes
})

/** What `measureProfile` says about the union of the tiles of some provinces. */
function measured(ids: readonly number[], contacts: number): NationProfile {
  const tiles: number[] = []
  for (const p of ids) {
    tiles.push(
      ...world.provinces.tiles.subarray(world.provinces.start[p], world.provinces.start[p + 1])
    )
  }
  return measureProfile({
    ...world.terrain,
    strategicPoints: world.points,
    routes: world.routes,
    tiles,
    contacts
  })
}

function expectSame(a: NationProfile, b: NationProfile): void {
  for (const key of Object.keys(b) as Array<keyof NationProfile>) {
    expect(a[key], key).toBeCloseTo(b[key], 8)
  }
}

describe('combineProfile: provinces add up to the land they cover', () => {
  it('has provinces to test', () => {
    expect(world.provinces.count).toBeGreaterThanOrEqual(6)
    expect(world.provinces.provinceOf.some((p) => p === NO_PROVINCE)).toBe(true) // the sea
  })

  it('gives the profile of the whole land when every province is taken', () => {
    const all = Array.from({ length: world.provinces.count }, (_, p) => p)
    expectSame(combineProfile(facts, all, 3), measured(all, 3))
  })

  it('gives the profile of any set of provinces, in any order', () => {
    for (const ids of [[0], [2, 0], [5, 1, 4], [7, 6, 3, 2]]) {
      expectSame(combineProfile(facts, ids, 1), measured(ids, 1))
    }
  })

  it('is an empty profile for no provinces, with the contacts it was given', () => {
    const empty = combineProfile(facts, [], 4)
    expect(empty.area).toBe(0)
    expect(empty.food).toBe(0)
    expect(empty.diversity).toBe(0)
    expect(empty.contacts).toBe(4)
  })

  it('counts a resource held in two provinces once for diversity, not twice', () => {
    const both = combineProfile(facts, [0, 1, 2, 3, 4, 5, 6, 7], 0)
    const sum = [0, 1, 2, 3, 4, 5, 6, 7].reduce(
      (n, p) => n + combineProfile(facts, [p], 0).diversity,
      0
    )
    expect(both.diversity).toBeLessThan(sum)
    expect(both.diversity).toBeLessThanOrEqual(RESOURCE_CATALOG.length)
  })

  it('has the area of the tiles the provinces hold', () => {
    const profile = combineProfile(facts, [1, 2], 0)
    expect(profile.area).toBe(world.provinces.area[1] + world.provinces.area[2])
  })

  it('keeps the strategic points and the route traffic where they are on the ground', () => {
    // the points and the routes are spread over the whole map, so a province far from them has less of both
    const per = Array.from({ length: world.provinces.count }, (_, p) =>
      combineProfile(facts, [p], 0)
    )
    expect(per.some((p) => p.defence > 0)).toBe(true)
    expect(per.some((p) => p.defence === 0)).toBe(true)
    expect(per.some((p) => p.traffic > 0)).toBe(true)
  })
})
