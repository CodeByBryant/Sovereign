import { defineConfig } from 'vitest/config'

// Measurement probes (tests/probe/*.probe.ts) are not tests: they time the engine and print a
// report. Run them with `pnpm --filter @sovereign/simulation probe`; they are never part of
// `pnpm test` or the determinism suite.
export default defineConfig({
  test: {
    // A probe's whole output is what it logs, and the default reporter hides the console output of
    // passing tests; the verbose reporter prints it.
    reporters: ['verbose'],
    include: ['tests/probe/**/*.probe.ts'],
    testTimeout: 30 * 60 * 1000
  }
})
