// Golden state hashes of whole worlds (docs/simulation/determinism.md, sections 7.3 and 8).
// Each entry pins a seed, a config, a number of ticks and the expected `stateHash()`.
// They are regression pins: the correctness of what is underneath them (RNG, noise, math,
// hashing) is established by the independent-reference tests. Regenerating them is a deliberate
// act, in its own commit, with the reason in the PR.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { WorldConfigOverrides } from '@sovereign/config'
import { HASH_SCHEMA_VERSION } from '../src/serialization/hash'
import { World } from '../src/world/World'

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
