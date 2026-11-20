import { defineConfig } from 'vitest/config'

// The determinism suite: golden world hashes and bit-exact math goldens. Run explicitly with
// `pnpm test:determinism`; CI runs it on Linux and Windows, in shards named by file.
export default defineConfig({
  test: {
    include: ['tests/determinism/**/*.test.ts'],
    testTimeout: 120_000
  }
})
