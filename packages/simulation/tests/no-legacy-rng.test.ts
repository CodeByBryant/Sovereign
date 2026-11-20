import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcDir = fileURLToPath(new URL('../src', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = join(dir, name)
      return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : []
    })
}

describe('the engine does not depend on third-party randomness or noise', () => {
  const files = sourceFiles(srcDir)

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it.each(['alea', 'simplex-noise'])('imports nothing from "%s"', (pkg) => {
    const offenders = files.filter((f) =>
      new RegExp(`from ['"]${pkg}['"]`).test(readFileSync(f, 'utf8'))
    )
    expect(offenders).toEqual([])
  })
})
