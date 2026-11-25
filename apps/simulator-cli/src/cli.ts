/**
 * @module cli
 * @description The command-line front end of the engine: create or load a world, run it, and
 * print its hash, a summary or a JSON snapshot. `run` is a pure function of its arguments and an
 * injected {@link Io}, so it is tested without a real filesystem or process.
 *
 * Exit codes: 0 success, 1 the request was understood but failed (invalid config, bad save, an
 * invalid world), 2 a usage error (unknown or malformed option).
 */
import type { WorldConfigOverrides } from '@sovereign/config'
import { SaveFormatError, World, decodeWorld, encodeWorld } from '@sovereign/simulation'

/** What the CLI needs from the outside world. */
export interface Io {
  out(text: string): void
  err(text: string): void
  readFile(path: string): Uint8Array
  writeFile(path: string, bytes: Uint8Array): void
}

/** A mistake in how the command was written. */
class UsageError extends Error {}

const USAGE = `sovereign-sim: run a Sovereign world without a UI

usage: sovereign-sim [options]

World to create:
  --seed <number|text>   world seed (default 1); text is hashed, digits are read as a number
  --width <n>            map width in tiles (default 1000)
  --height <n>           map height in tiles (default 1000)
  --nations <n>          number of nations to spawn (default 12)
  --spacing <n>          minimum tile distance between nations (default 70)
  --island               island mode: land falls off toward the edges
  --config <file>        JSON of world config overrides; the options above override the file

Or a world to load:
  --load <file>          read a saved world (cannot be combined with the options above)

What to do with it:
  --ticks <n>            run this many ticks first (default 0)
  --validate             check the world is internally consistent; exit 1 if it is not
  --save <file>          write the world to a file

What to print (default: the 32-character state hash):
  --summary              a readable overview, including the hash
  --json                 the world snapshot as JSON

  --help                 this text

Exit codes: 0 success, 1 the request failed, 2 a usage error.
`

type Options = {
  seed?: string
  ticks: number
  width?: number
  height?: number
  nations?: number
  spacing?: number
  island: boolean
  config?: string
  load?: string
  save?: string
  validate: boolean
  summary: boolean
  json: boolean
  help: boolean
}

const STRING_OPTIONS = new Set(['seed', 'config', 'load', 'save'])
const INTEGER_OPTIONS = new Map<string, { min: number }>([
  ['ticks', { min: 0 }],
  ['width', { min: 1 }],
  ['height', { min: 1 }],
  ['nations', { min: 0 }],
  ['spacing', { min: 1 }]
])
const FLAG_OPTIONS = new Set(['island', 'validate', 'summary', 'json', 'help'])

function parse(argv: readonly string[]): Options {
  const opts: Options = {
    ticks: 0,
    island: false,
    validate: false,
    summary: false,
    json: false,
    help: false
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string
    // A bare "--" means "end of options"; package managers pass it through.
    if (arg === '--') continue
    if (!arg.startsWith('--')) throw new UsageError(`unexpected argument "${arg}"`)
    const name = arg.slice(2)

    if (FLAG_OPTIONS.has(name)) {
      ;(opts as Record<string, unknown>)[name] = true
    } else if (STRING_OPTIONS.has(name) || INTEGER_OPTIONS.has(name)) {
      const value = argv[i + 1]
      if (value === undefined || (value.startsWith('--') && value.length > 2)) {
        throw new UsageError(`${arg} needs a value`)
      }
      i += 1
      const range = INTEGER_OPTIONS.get(name)
      if (range === undefined) {
        ;(opts as Record<string, unknown>)[name] = value
      } else {
        if (!/^-?\d+$/.test(value) || Number(value) < range.min) {
          throw new UsageError(
            `${arg} must be a whole number of at least ${range.min}, not "${value}"`
          )
        }
        ;(opts as Record<string, unknown>)[name] = Number(value)
      }
    } else {
      throw new UsageError(`unknown option ${arg}`)
    }
  }
  return opts
}

/** The config the options describe: the file first, then the flags on top of it. */
function buildConfig(opts: Options, io: Io): WorldConfigOverrides {
  let config: WorldConfigOverrides = {}
  if (opts.config !== undefined) {
    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder().decode(io.readFile(opts.config)))
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`${opts.config} is not valid JSON`, { cause: error })
      }
      throw error
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${opts.config} must be a JSON object of config overrides`)
    }
    config = parsed as WorldConfigOverrides
  }
  const map = { ...config.map }
  if (opts.width !== undefined) map.width = opts.width
  if (opts.height !== undefined) map.height = opts.height
  if (opts.island) map.islandMode = true
  const nations = { ...config.nations }
  if (opts.nations !== undefined) nations.count = opts.nations
  if (opts.spacing !== undefined) nations.minSpacing = opts.spacing
  return { ...config, map, nations }
}

function summary(world: World): string {
  const s = world.snapshot()
  const rows: Array<[string, string]> = [
    ['seed', String(s.seed)],
    ['size', `${s.width} x ${s.height}`],
    ['sea level', s.seaLevel.toFixed(4)],
    ['nations', String(s.nations.length)],
    [
      'provinces',
      `${world.provinces.count} (${s.nations.reduce((n, nation) => n + nation.provinceCount, 0)} held)`
    ],
    ['borders', world.saturated ? 'settled' : 'moving'],
    ['tick', String(s.tick)],
    ['time', String(s.time)],
    ['hash', world.stateHash()]
  ]
  return rows.map(([k, v]) => `${k.padEnd(10)}${v}`).join('\n') + '\n'
}

/** Run the CLI. Returns the process exit code; never throws. */
export function run(argv: readonly string[], io: Io): number {
  try {
    const opts = parse(argv)
    if (opts.help) {
      io.out(USAGE)
      return 0
    }
    if (opts.load !== undefined) {
      for (const clash of ['seed', 'width', 'height', 'nations', 'spacing', 'config'] as const) {
        if (opts[clash] !== undefined) {
          throw new UsageError(`--load cannot be combined with --${clash}`)
        }
      }
      if (opts.island) throw new UsageError('--load cannot be combined with --island')
    }

    const world =
      opts.load !== undefined
        ? decodeWorld(io.readFile(opts.load))
        : World.create({ seed: opts.seed ?? '1', config: buildConfig(opts, io) })
    world.run(opts.ticks)

    if (opts.validate) {
      const problems = world.validate()
      if (problems.length > 0) {
        io.err(`sovereign-sim: the world is not valid:\n  ${problems.join('\n  ')}\n`)
        return 1
      }
    }
    if (opts.save !== undefined) io.writeFile(opts.save, encodeWorld(world))

    if (opts.json) io.out(JSON.stringify(world.snapshot(), null, 2) + '\n')
    else if (opts.summary) io.out(summary(world))
    else io.out(world.stateHash() + '\n')
    return 0
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`sovereign-sim: ${error.message}\nTry --help.\n`)
      return 2
    }
    const message =
      error instanceof SaveFormatError || error instanceof Error ? error.message : String(error)
    io.err(`sovereign-sim: ${message}\n`)
    return 1
  }
}
