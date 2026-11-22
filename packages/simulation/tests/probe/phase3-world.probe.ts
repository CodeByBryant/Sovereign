// A measurement, not a test: what a full 2000 x 2000 world looks like once nations own provinces.
//
//   pnpm --filter @sovereign/simulation probe -- tests/probe/phase3-world.probe.ts
//
// PROBE_SEEDS=1,2 picks the seeds (default 1337,1,2).
import { it } from 'vitest'
import { performance } from 'node:perf_hooks'
import { World } from '../../src/world/World'

const seeds = (process.env.PROBE_SEEDS ?? '1337,1,2')
  .split(',')
  .map((s) => Number.parseInt(s, 10))
  .filter((n) => Number.isInteger(n))

it('measures a world with provinces', () => {
  const lines: string[] = []
  for (const seed of seeds) {
    const t0 = performance.now()
    const world = World.create({ seed })
    const t1 = performance.now()
    const p = world.provinces
    const areas = Array.from(p.area).sort((a, b) => a - b)
    const q = (f: number): number => areas[Math.floor(f * (areas.length - 1))] ?? 0
    const sizes = world.nations.map((n) => `${n.provinces.size}p/${n.profile.area}t`)
    lines.push(
      `seed ${seed}: created in ${(t1 - t0).toFixed(0)} ms; ${p.count} provinces (area p10 ${q(0.1)}, median ${q(0.5)}, p90 ${q(0.9)}); ${world.nations.length} nations: ${sizes.join(' ')}; validate ${world.validate().length} problems`
    )
  }
  console.log('\n' + lines.join('\n') + '\n')
}, 900000)
