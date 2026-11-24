// Golden state hashes of whole worlds (docs/simulation/determinism.md, sections 7.3 and 8).
// Each entry pins a seed, a config, a number of ticks and the expected `stateHash()`.
// They are regression pins: the correctness of what is underneath them (RNG, noise, math,
// hashing) is established by the independent-reference tests. Regenerating them is a deliberate
// act, in its own commit, with the reason in the PR.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { WorldConfigOverrides } from '@sovereign/config'
import { HASH_SCHEMA_VERSION } from '../../src/serialization/hash'
import { World } from '../../src/world/World'
import { smallWorldOverrides } from '../support/worldOptions'

interface GoldenEntry {
  readonly name: string
  readonly seed: number | string
  readonly config: WorldConfigOverrides
  readonly steps: number
  readonly expectedHash: string
}

interface GoldenFile {
  readonly hashSchemaVersion: number
  readonly entries: readonly GoldenEntry[]
}

const goldenPath = fileURLToPath(new URL('./golden/world-hashes.json', import.meta.url))
const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as GoldenFile

describe('golden world state hashes', () => {
  it("the golden file matches the engine's current hash schema version", () => {
    // A mismatch means the canonical hash layout changed: bump HASH_SCHEMA_VERSION, regenerate every
    // entry, record the new layout in the spec (section 7.3), and say why in the PR.
    expect(golden.hashSchemaVersion).toBe(HASH_SCHEMA_VERSION)
  })

  it('has entries, so this suite cannot silently pass empty', () => {
    expect(golden.entries.length).toBeGreaterThan(5)
  })

  it('has no duplicate names or hashes, so no entry can shadow another', () => {
    expect(new Set(golden.entries.map((e) => e.name)).size).toBe(golden.entries.length)
    expect(new Set(golden.entries.map((e) => e.expectedHash)).size).toBe(golden.entries.length)
  })

  it.each(golden.entries.map((entry) => [entry.name, entry] as const))(
    '%s reproduces its pinned hash',
    (_name, entry) => {
      const world = World.create({ seed: entry.seed, config: entry.config })
      world.run(entry.steps)
      expect(world.stateHash()).toBe(entry.expectedHash)
      expect(world.validate()).toEqual([])
    }
  )
})

describe('golden depletion', () => {
  // Drawing resources down and letting them regrow is state, so it is pinned like the rest: 60 tiles
  // of each slot lose 90 units, then 700 ticks pass (renewable surface stocks regrow, minerals do not).
  it('drawn-down stocks regrow to a pinned hash', () => {
    const world = World.create({ seed: 5, config: smallWorldOverrides() })
    let taken = 0
    for (const layer of ['surface', 'ground'] as const) {
      let drawn = 0
      for (let i = 0; i < world.map.size && drawn < 60; i += 1) {
        if (world.terrain.resources[layer].type[i] !== 0) {
          taken += world.extractResource(layer, i, 90)
          drawn += 1
        }
      }
    }
    expect(taken).toBe(7358)
    world.run(700)
    expect(world.validate()).toEqual([])
    expect(world.stateHash()).toBe('c1e637cf883551260f002e64a2344582')
  })
})

describe('golden growth', () => {
  // The pins are only worth anything if they pin the right moments: one with the nations still growing,
  // one after the borders stopped moving (where a change that kept growing would be caught).
  const named = (prefix: string): GoldenEntry => {
    const entry = golden.entries.find((e) => e.name.startsWith(prefix))
    if (entry === undefined) throw new Error(`no golden entry starting "${prefix}"`)
    return entry
  }

  it('pins a world whose nations are still expanding', () => {
    const entry = named('growing:')
    const world = World.create({ seed: entry.seed, config: entry.config })
    world.run(entry.steps)
    expect(world.saturated).toBe(false)
    expect(world.expansionClaims).toBeGreaterThan(20)
  })

  it('pins a world whose borders have settled, and it stays that way', () => {
    const entry = named('settled:')
    const world = World.create({ seed: entry.seed, config: entry.config })
    world.run(entry.steps)
    expect(world.saturated).toBe(true)
    const claims = world.expansionClaims
    world.run(500)
    expect(world.expansionClaims).toBe(claims)
  })
})
