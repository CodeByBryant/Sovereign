// A measurement, not a test: what a full 2000 x 2000 world looks like once nations own provinces and grow.
//
//   pnpm --filter @sovereign/simulation probe -- tests/probe/phase3-world.probe.ts
//
// PROBE_SEEDS=1,2 picks the seeds (default 1337); PROBE_TICKS caps the run (default 60000).
import { it } from 'vitest'
import { performance } from 'node:perf_hooks'
import { World } from '../../src/world/World'

const seeds = (process.env.PROBE_SEEDS ?? '1337')
  .split(',')
  .map((s) => Number.parseInt(s, 10))
  .filter((n) => Number.isInteger(n))
const cap = Number.parseInt(process.env.PROBE_TICKS ?? '60000', 10)

it('measures a world with provinces, growing', () => {
  const lines: string[] = []
  for (const seed of seeds) {
    const t0 = performance.now()
    const world = World.create({ seed })
    const t1 = performance.now()
    const p = world.provinces
    const claimableCount = Array.from(world.claimable).filter((c) => c === 1).length
    lines.push(
      `seed ${seed}: created in ${(t1 - t0).toFixed(0)} ms; ${p.count} provinces (${claimableCount} claimable), ${world.nations.length} nations`
    )
    const held = (): number => world.nations.reduce((n, nation) => n + nation.provinces.size, 0)
    const marks = [0, 100, 365, 1000, 3650, 10000, 20000, 40000, 60000]
    let tick = 0
    const stepStart = performance.now()
    for (const mark of marks) {
      if (mark > cap) break
      while (tick < mark && !world.saturated) {
        world.step()
        tick += 1
      }
      const sizes = world.nations.map((n) => n.provinces.size).sort((a, b) => b - a)
      lines.push(
        `  tick ${tick} (year ${(tick / 365).toFixed(1)}): ${held()} provinces held (${((100 * held()) / claimableCount).toFixed(0)}% of claimable); largest ${sizes[0]}, smallest ${sizes[sizes.length - 1]}; saturated ${world.saturated}`
      )
      if (world.saturated) break
    }
    const stepMs = performance.now() - stepStart
    lines.push(
      `  ${tick} ticks in ${stepMs.toFixed(0)} ms (${(stepMs / Math.max(1, tick)).toFixed(3)} ms per tick); validate ${world.validate().length} problems; hash ${world.stateHash()}`
    )
  }
  console.log('\n' + lines.join('\n') + '\n')
}, 1800000)
