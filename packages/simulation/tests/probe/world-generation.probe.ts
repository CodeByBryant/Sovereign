// A measurement, not a test: how long the engine takes to build, hash, save and load a world at
// several sizes. It answers "do we have a performance problem?" with numbers (the decision on
// native or WASM compute is deferred until it shows one). Run it with
//   pnpm --filter @sovereign/simulation probe
// and set PROBE_SIZES=512,1024,2000 to choose the map sides. The default 2000 is the real target.
import { performance } from 'node:perf_hooks'
import { it } from 'vitest'
import { decodeWorld, encodeWorld } from '../../src/serialization/save'
import { World } from '../../src/world/World'

const sizes = (process.env.PROBE_SIZES ?? '512,1024,2000')
  .split(',')
  .map((s) => Number.parseInt(s.trim(), 10))
  .filter((n) => Number.isInteger(n) && n > 0)

function time<T>(run: () => T): { value: T; ms: number } {
  const start = performance.now()
  const value = run()
  return { value, ms: performance.now() - start }
}

it(
  'times world generation, hashing, save and load',
  () => {
    const rows: string[] = []
    for (const side of sizes) {
      const create = time(() =>
        World.create({ seed: 1337, config: { map: { width: side, height: side } } })
      )
      const hash = time(() => create.value.stateHash())
      const encode = time(() => encodeWorld(create.value))
      const decode = time(() => decodeWorld(encode.value))
      const step = time(() => create.value.run(1000))
      const f = (ms: number) => `${ms.toFixed(0)} ms`.padStart(9)
      rows.push(
        `${String(side).padStart(5)}² | create ${f(create.ms)} | hash ${f(hash.ms)} | save ${f(encode.ms)} (${(encode.value.byteLength / 1e6).toFixed(1)} MB) | load ${f(decode.ms)} | 1000 empty ticks ${f(step.ms)}`
      )
      void decode
    }
    console.log(`\nWorld generation probe (node ${process.version})\n${rows.join('\n')}\n`)
  },
  30 * 60 * 1000
)
