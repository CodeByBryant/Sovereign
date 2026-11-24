import { describe, expect, it, vi } from 'vitest'
import { World, decodeWorld, encodeWorld } from '@sovereign/simulation'
import type { WorldConfigOverrides } from '@sovereign/config'
import { run, type Io } from '../src/cli'

/** An in-memory I/O: captures output and serves/stores files from a map. */
function memoryIo(files: Record<string, Uint8Array | string> = {}): {
  io: Io
  out: string[]
  err: string[]
  files: Map<string, Uint8Array>
} {
  const store = new Map<string, Uint8Array>(
    Object.entries(files).map(([path, data]) => [
      path,
      typeof data === 'string' ? new TextEncoder().encode(data) : data
    ])
  )
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    files: store,
    io: {
      out: (text) => out.push(text),
      err: (text) => err.push(text),
      readFile: (path) => {
        const data = store.get(path)
        if (data === undefined) throw new Error(`ENOENT: no such file, open '${path}'`)
        return data
      },
      writeFile: (path, bytes) => void store.set(path, bytes)
    }
  }
}

const SMALL = ['--width', '64', '--height', '48', '--nations', '3', '--spacing', '10']
const smallOverrides = (extra: WorldConfigOverrides = {}): WorldConfigOverrides => ({
  map: { width: 64, height: 48 },
  nations: { count: 3, minSpacing: 10 },
  ...extra
})
const engineHash = (seed: number | string, ticks = 0, config = smallOverrides()): string => {
  const world = World.create({ seed, config })
  world.run(ticks)
  return world.stateHash()
}

describe('usage', () => {
  it('--help prints the options and succeeds', () => {
    const { io, out } = memoryIo()
    expect(run(['--help'], io)).toBe(0)
    const text = out.join('')
    for (const option of ['--seed', '--ticks', '--config', '--save', '--load', '--json']) {
      expect(text).toContain(option)
    }
  })

  it('rejects an unknown option with exit code 2 and a message', () => {
    const { io, err, out } = memoryIo()
    expect(run(['--bogus'], io)).toBe(2)
    expect(err.join('')).toContain('unknown option --bogus')
    expect(out).toEqual([])
  })

  it('does not take the next option as the value of the one before it', () => {
    const { io, err } = memoryIo()
    expect(run(['--seed', '--ticks', '5'], io)).toBe(2)
    expect(err.join('')).toContain('--seed needs a value')
  })

  it('ignores a bare "--" (package managers pass it through: `pnpm start -- --seed 1`)', () => {
    const { io, out } = memoryIo()
    expect(run(['--', '--seed', '12345', ...SMALL], io)).toBe(0)
    expect(out.join('').trim()).toBe(engineHash(12345))
    const again = memoryIo()
    expect(run(['--seed', '12345', '--', ...SMALL], again.io)).toBe(0)
    expect(again.out).toEqual(out)
  })

  it('rejects a stray positional argument', () => {
    const { io, err } = memoryIo()
    expect(run(['hello'], io)).toBe(2)
    expect(err.join('')).toMatch(/unexpected argument "hello"/)
  })

  it.each(['--seed', '--ticks', '--width', '--config', '--save'])(
    'rejects %s with no value',
    (option) => {
      const { io, err } = memoryIo()
      expect(run([option], io)).toBe(2)
      expect(err.join('')).toContain(`${option} needs a value`)
    }
  )

  it.each([
    ['--ticks', 'x'],
    ['--ticks', '-1'],
    ['--ticks', '1.5'],
    ['--width', 'wide'],
    ['--width', '0'],
    ['--height', '0'],
    ['--nations', '2.5'],
    ['--spacing', '0']
  ])('rejects %s %s as not a valid number', (option, value) => {
    const { io, err } = memoryIo()
    expect(run([option, value, '--seed', '1'], io)).toBe(2)
    expect(err.join('')).toContain(option)
  })
})

describe('creating and running a world', () => {
  it('prints the state hash, which is exactly what the engine gives for the same world', () => {
    const { io, out } = memoryIo()
    expect(run(['--seed', '12345', ...SMALL], io)).toBe(0)
    expect(out.join('').trim()).toBe(engineHash(12345))
    expect(out.join('')).toMatch(/^[0-9a-f]{32}\n$/)
  })

  it('runs the requested number of ticks', () => {
    const { io, out } = memoryIo()
    expect(run(['--seed', '12345', '--ticks', '25', ...SMALL], io)).toBe(0)
    expect(out.join('').trim()).toBe(engineHash(12345, 25))
    expect(engineHash(12345, 25)).not.toBe(engineHash(12345, 0))
  })

  it('reads a text seed the way the engine does', () => {
    const { io, out } = memoryIo()
    expect(run(['--seed', 'sovereign', ...SMALL], io)).toBe(0)
    expect(out.join('').trim()).toBe(engineHash('sovereign'))
  })

  it('--island selects island mode', () => {
    const { io, out } = memoryIo()
    expect(run(['--seed', '7', '--island', ...SMALL], io)).toBe(0)
    expect(out.join('').trim()).toBe(
      engineHash(7, 0, smallOverrides({ map: { width: 64, height: 48, islandMode: true } }))
    )
  })

  it('is deterministic: two runs print the same thing', () => {
    const a = memoryIo()
    const b = memoryIo()
    run(['--seed', '3', '--ticks', '4', ...SMALL], a.io)
    run(['--seed', '3', '--ticks', '4', ...SMALL], b.io)
    expect(a.out).toEqual(b.out)
  })
})

describe('--config', () => {
  it('applies overrides from a JSON file, so a pinned scenario can be reproduced', () => {
    const config = smallOverrides({
      elevation: { scale: 0.05 },
      map: { width: 64, height: 48, seaLevel: 0.25 }
    })
    const { io, out } = memoryIo({ 'scenario.json': JSON.stringify(config) })
    expect(run(['--seed', '9', '--config', 'scenario.json'], io)).toBe(0)
    expect(out.join('').trim()).toBe(engineHash(9, 0, config))
  })

  it('lets the other options override the file', () => {
    const { io, out } = memoryIo({ 'scenario.json': JSON.stringify(smallOverrides()) })
    expect(run(['--seed', '9', '--config', 'scenario.json', '--nations', '1'], io)).toBe(0)
    expect(out.join('').trim()).toBe(
      engineHash(9, 0, smallOverrides({ nations: { count: 1, minSpacing: 10 } }))
    )
  })

  it('fails clearly on a file that is missing, not JSON, or not an object', () => {
    for (const [files, message] of [
      [{}, /scenario\.json/],
      [{ 'scenario.json': '{not json' }, /not valid JSON/],
      [{ 'scenario.json': '[1,2]' }, /must be a JSON object/]
    ] as const) {
      const { io, err } = memoryIo({ ...files })
      expect(run(['--seed', '1', '--config', 'scenario.json'], io)).toBe(1)
      expect(err.join('')).toMatch(message)
    }
  })

  it('fails with the config problem named when the resulting config is invalid', () => {
    const { io, err } = memoryIo()
    expect(run(['--seed', '1', '--width', '3', '--height', '48'], io)).toBe(1)
    expect(err.join('')).toContain('map.width')
  })
})

describe('--json and --summary', () => {
  it('--json prints the world snapshot as JSON', () => {
    const { io, out } = memoryIo()
    expect(run(['--seed', '5', '--ticks', '3', '--json', ...SMALL], io)).toBe(0)
    const snapshot = JSON.parse(out.join('')) as {
      seed: number
      tick: number
      width: number
      nations: unknown[]
    }
    expect(snapshot.seed).toBe(5)
    expect(snapshot.tick).toBe(3)
    expect(snapshot.width).toBe(64)
    expect(snapshot.nations.length).toBeGreaterThan(0)
  })

  it('--summary prints a readable overview that includes the hash', () => {
    const { io, out } = memoryIo()
    expect(run(['--seed', '5', '--summary', ...SMALL], io)).toBe(0)
    const text = out.join('')
    expect(text).toContain(engineHash(5))
    expect(text).toMatch(/seed\s+5/)
    expect(text).toMatch(/size\s+64 x 48/)
    expect(text).toMatch(/nations\s+\d+/)
  })
})

describe('--summary: provinces and borders', () => {
  it('counts the provinces of the world and how many the nations hold', () => {
    const { io, out } = memoryIo()
    expect(run(['--seed', '5', '--summary', ...SMALL], io)).toBe(0)
    const text = out.join('')
    expect(text).toMatch(/provinces\s+\d+ \(\d+ held\)/)
    const [, total, held] = /provinces\s+(\d+) \((\d+) held\)/.exec(text) ?? []
    expect(Number(total)).toBeGreaterThan(0)
    expect(Number(held)).toBeLessThanOrEqual(Number(total))
    expect(Number(held)).toBeGreaterThan(0)
  })

  it('holds more provinces after more ticks, and says whether the borders are still moving', () => {
    // provinces a fifth of the default size and a small start, so a world this small has room to grow into
    const files = {
      'grow.json': JSON.stringify({
        provinces: { spacing: 6, minArea: 8 },
        nations: { startArea: 40 }
      })
    }
    const args = ['--seed', '5', '--config', 'grow.json', '--summary', ...SMALL]
    const early = memoryIo(files)
    run(args, early.io)
    expect(early.out.join('')).toMatch(/borders\s+moving/)
    const late = memoryIo(files)
    run(['--ticks', '60000', ...args], late.io)
    const text = late.out.join('')
    expect(text).toMatch(/borders\s+settled/)
    const heldOf = (t: string): number => Number(/\((\d+) held\)/.exec(t)?.[1])
    expect(heldOf(text)).toBeGreaterThan(heldOf(early.out.join('')))
  })
})

describe('--save and --load', () => {
  it('--save writes a save the engine can decode, and still prints the hash', () => {
    const { io, out, files } = memoryIo()
    expect(run(['--seed', '4', '--ticks', '6', '--save', 'world.sov', ...SMALL], io)).toBe(0)
    expect(out.join('').trim()).toBe(engineHash(4, 6))
    const bytes = files.get('world.sov')
    expect(bytes).toBeDefined()
    expect(decodeWorld(bytes as Uint8Array).stateHash()).toBe(engineHash(4, 6))
  })

  it('--load restores a saved world and prints its hash', () => {
    const world = World.create({ seed: 4, config: smallOverrides() })
    world.run(6)
    const { io, out } = memoryIo({ 'world.sov': encodeWorld(world) })
    expect(run(['--load', 'world.sov'], io)).toBe(0)
    expect(out.join('').trim()).toBe(world.stateHash())
  })

  it('--load then --ticks continues the world from where it was saved', () => {
    const world = World.create({ seed: 4, config: smallOverrides() })
    world.run(6)
    const { io, out } = memoryIo({ 'world.sov': encodeWorld(world) })
    expect(run(['--load', 'world.sov', '--ticks', '10'], io)).toBe(0)
    expect(out.join('').trim()).toBe(engineHash(4, 16))
  })

  it('refuses to combine --load with options that describe a new world', () => {
    const { io, err } = memoryIo({ 'world.sov': new Uint8Array(1) })
    expect(run(['--load', 'world.sov', '--seed', '2'], io)).toBe(2)
    expect(err.join('')).toContain('--load cannot be combined with --seed')
  })

  it('refuses to combine --load with --config', () => {
    const { io, err } = memoryIo({ 'world.sov': new Uint8Array(1), 'c.json': '{}' })
    expect(run(['--load', 'world.sov', '--config', 'c.json'], io)).toBe(2)
    expect(err.join('')).toContain('--load cannot be combined with --config')
  })

  it('reports a corrupt or missing save as a plain error (exit 1, no stack trace)', () => {
    const corrupt = memoryIo({
      'bad.sov': new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    })
    expect(run(['--load', 'bad.sov'], corrupt.io)).toBe(1)
    expect(corrupt.err.join('')).toMatch(/not a Sovereign save/)
    expect(corrupt.err.join('')).not.toMatch(/\n\s+at /)

    const missing = memoryIo()
    expect(run(['--load', 'nope.sov'], missing.io)).toBe(1)
    expect(missing.err.join('')).toContain('nope.sov')
  })
})

describe('--validate', () => {
  it('fails with exit code 1 and lists the problems when the world is not consistent', () => {
    // A fresh or decoded world is valid by construction, so force the failure path.
    const spy = vi
      .spyOn(World.prototype, 'validate')
      .mockReturnValue(['elevation has 3 non-finite values'])
    try {
      const { io, err, out } = memoryIo()
      expect(run(['--seed', '2', '--validate', ...SMALL], io)).toBe(1)
      expect(err.join('')).toMatch(/not valid[\s\S]*elevation/)
      expect(out).toEqual([])
    } finally {
      spy.mockRestore()
    }
  })

  it('succeeds quietly on a sound world', () => {
    const { io, err } = memoryIo()
    expect(run(['--seed', '2', '--validate', ...SMALL], io)).toBe(0)
    expect(err).toEqual([])
  })
})
