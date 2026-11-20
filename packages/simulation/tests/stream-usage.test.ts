import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { STREAM_NAMES } from '../src/random/streams'
import { HASH_SCHEMA_VERSION } from '../src/serialization/hash'

const spec = readFileSync(
  new URL('../../../docs/simulation/determinism.md', import.meta.url),
  'utf8'
)

describe('the fixed list of random streams', () => {
  // Adding a stream cannot change any existing stream (each is derived from its own name), but it
  // is still a deliberate act: edit this list, docs/simulation/determinism.md, and say why.
  it('is exactly the documented list, in order', () => {
    expect([...STREAM_NAMES]).toEqual([
      'elevation',
      'continent',
      'ocean',
      'temperature',
      'humidity',
      'biome',
      'riverPrimary',
      'riverSecondary',
      'riverWarpX',
      'riverWarpY',
      'riverWidth',
      'ore',
      'resourceDensity',
      'spawn',
      'names',
      'colors',
      'flags'
    ])
  })

  it('has no duplicate names, which would silently share one sequence', () => {
    expect(new Set(STREAM_NAMES).size).toBe(STREAM_NAMES.length)
  })

  it('uses plain lowerCamelCase ASCII names, so the derivation bytes are unambiguous', () => {
    for (const name of STREAM_NAMES) expect(name).toMatch(/^[a-z][A-Za-z0-9]*$/)
  })

  it('matches the list in docs/simulation/determinism.md, section 3', () => {
    const section = spec.slice(spec.indexOf('## 3. Random streams'), spec.indexOf('## 4.'))
    const block = /```text\n([\s\S]*?)\n```/.exec(section)
    expect(block, 'section 3 must contain a ```text block with the stream list').not.toBeNull()
    expect(block?.[1]?.replace(/\s+/g, ' ').trim()).toBe(STREAM_NAMES.join(', '))
  })
})

describe('the spec and the code agree on versions', () => {
  it('documents the current HASH_SCHEMA_VERSION in section 7.3', () => {
    expect(spec).toContain(`#### Version ${HASH_SCHEMA_VERSION}`)
  })

  it('documents the stream-derivation domain prefix that the code uses', () => {
    expect(spec).toContain('sovereign-rng-v1')
  })
})
