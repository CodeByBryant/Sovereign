import { defineConfig } from 'vitest/config'

// The fast suite (`pnpm test`). The determinism suite (golden hashes, large grids) is deliberately
// excluded: it has its own config and its own CI job, run on Linux and Windows
// (see vitest.determinism.config.ts and .github/workflows/quality.yml).
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/determinism/**'],
    testTimeout: 30_000
  }
})
