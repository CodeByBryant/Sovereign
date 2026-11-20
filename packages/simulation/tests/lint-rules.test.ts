import { describe, expect, it } from 'vitest'
import { ESLint } from 'eslint'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const eslint = new ESLint({ cwd: repoRoot })

/** Lint `code` as if it lived at `file` (relative to the repo root); returns rule ids + messages. */
async function lint(
  code: string,
  file = 'packages/simulation/src/random/example.ts'
): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(repoRoot, file) })
  return (result?.messages ?? []).map((m) => `${m.ruleId}: ${m.message}`)
}

describe('determinism lint rules (packages/simulation/src)', () => {
  it.each([
    ['Math.random()', 'const x = Math.random()'],
    ['Date.now()', 'const x = Date.now()'],
    ['new Date()', 'const x = new Date()'],
    ['performance.now()', 'const x = performance.now()'],
    ['Math.sin', 'const x = Math.sin(1)'],
    ['Math.cos', 'const x = Math.cos(1)'],
    ['Math.atan2', 'const x = Math.atan2(1, 2)'],
    ['Math.pow', 'const x = Math.pow(2, 1.4)'],
    ['Math.log', 'const x = Math.log(2)'],
    ['Math.exp', 'const x = Math.exp(2)'],
    ['Math.hypot', 'const x = Math.hypot(3, 4)'],
    ['Math.cbrt', 'const x = Math.cbrt(8)'],
    ['the ** operator', 'const x = 2 ** 1.4'],
    ['the **= operator', 'let x = 2\nx **= 1.4'],
    ['for...in', 'const o = { a: 1 }\nfor (const k in o) void k'],
    ['Object.keys', 'const x = Object.keys({ a: 1 })'],
    ['Object.values', 'const x = Object.values({ a: 1 })'],
    ['Object.entries', 'const x = Object.entries({ a: 1 })'],
    ['sort without a comparator', 'const x = [3, 1, 2].sort()'],
    ['console', 'console.log(1)'],
    ['importing react', "import 'react'"],
    ['importing pixi.js', "import 'pixi.js'"],
    ['importing electron', "import 'electron'"],
    ['the window global', 'const x = window.innerWidth'],
    ['the document global', 'const x = document.title'],
    ['requestAnimationFrame', 'requestAnimationFrame(() => {})']
  ])('forbids %s', async (_label, code) => {
    const messages = await lint(code)
    expect(
      messages.filter((m) => !m.startsWith('@typescript-eslint/no-unused-vars')).length
    ).toBeGreaterThan(0)
  })

  it('points the author at the alternative, not just at the ban', async () => {
    expect((await lint('const x = Math.pow(2, 3)')).join('\n')).toContain('transcendental')
    expect((await lint('const x = Math.random()')).join('\n')).toContain('RandomSource')
    expect((await lint('const x = Object.keys({})')).join('\n')).toContain('id order')
  })

  it('allows the exact operations the spec permits', async () => {
    const code = `
      export function ok(a: number, b: number): number {
        const items = [3, 1, 2].sort((x, y) => x - y)
        return Math.sqrt(a) + Math.floor(b) + Math.abs(a) + Math.min(a, b) + Math.max(a, b) +
          Math.imul(3, 4) + Math.trunc(a) + Math.ceil(b) + Math.sign(a) + (items[0] ?? 0)
      }
    `
    expect(await lint(code)).toEqual([])
  })

  it('does not apply to tests or apps (only the engine is bound)', async () => {
    expect(
      await lint('export const x = Math.random()', 'packages/simulation/tests/some.test.ts')
    ).toEqual([])
    expect(await lint('export const x = Math.random()', 'apps/web/src/seed.ts')).toEqual([])
  })

  // TEMPORARY (R1 only): code moved in from the old app is exempt until R2 ports it onto the
  // deterministic RNG and math. R2 deletes this test together with the exemption in eslint.config.js.
  it('exempts the not-yet-ported legacy directories (terrain, nations, world)', async () => {
    for (const dir of ['terrain', 'nations', 'world']) {
      expect(
        await lint('export const x = Math.random()', `packages/simulation/src/${dir}/legacy.ts`)
      ).toEqual([])
    }
  })

  it('binds every new engine directory', async () => {
    for (const dir of ['random', 'math', 'serialization']) {
      expect(
        (await lint('export const x = Math.random()', `packages/simulation/src/${dir}/x.ts`)).length
      ).toBeGreaterThan(0)
    }
  })
})
