import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STREAM_NAMES } from '../src/random/streams'
import { HASH_SCHEMA_VERSION } from '../src/serialization/hash'

const srcDir = fileURLToPath(new URL('../src', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = join(dir, name)
      return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : []
    })
}

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

describe('every declared stream is used, and only declared streams are', () => {
  const files = sourceFiles(srcDir).filter((f) => !f.endsWith(join('random', 'streams.ts')))
  const text = files.map((f) => readFileSync(f, 'utf8')).join('\n')

  it.each([...STREAM_NAMES])("a stream named '%s' is created somewhere in the engine", (name) => {
    expect(text).toMatch(new RegExp(`createStream\\([^,]+,\\s*'${name}'\\)`))
  })

  it('has no createStream call with a name that is not in the fixed list', () => {
    const used = [...text.matchAll(/createStream\([^,]+,\s*'([^']+)'\)/g)].map((m) => m[1])
    expect(used.length).toBeGreaterThan(10)
    for (const name of used) expect(STREAM_NAMES as readonly string[]).toContain(name)
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
