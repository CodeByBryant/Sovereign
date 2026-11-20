import { defineConfig } from 'vitest/config'

// Measurement probes (tests/probe/*.probe.ts) are not tests: they time the engine and print a
// report. Run them with `pnpm --filter @sovereign/simulation probe`; they are never part of
// `pnpm test` or the determinism suite.
export default defineConfig({
  test: {
    include: ['tests/probe/**/*.probe.ts'],
    testTimeout: 30 * 60 * 1000
  }
})
