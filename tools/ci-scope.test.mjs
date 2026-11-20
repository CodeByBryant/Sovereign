import assert from 'node:assert/strict'
import { test } from 'node:test'
import { changedFiles, scopeOf } from './ci-scope.mjs'

const all = { engine: true, app: true }

test('a change nobody can read runs everything', () => {
  assert.deepEqual(scopeOf(null), all)
  assert.deepEqual(scopeOf([]), all)
})

test('documentation alone skips the engine and the app build', () => {
  const scope = scopeOf(['docs/decisions/0003-determinism-policy.md', 'README.md'])
  assert.deepEqual(scope, { engine: false, app: false })
})

test('anything under docs/ and the licence are documentation, whatever their extension', () => {
  for (const file of ['docs/architecture/dependency-diagram.svg', 'LICENSE']) {
    assert.deepEqual(scopeOf([file]), { engine: false, app: false }, file)
  }
})

test('an interface change skips the engine suites but builds the app', () => {
  for (const file of [
    'packages/ui/src/TileInspector.tsx',
    'packages/renderer/src/pixi/MapRenderer.ts',
    'apps/web/src/App.tsx'
  ]) {
    assert.deepEqual(scopeOf([file]), { engine: false, app: true }, file)
  }
})

test('anything that can change the engine runs it', () => {
  for (const file of [
    'packages/simulation/src/world/World.ts',
    'packages/simulation/tests/determinism/golden.test.ts',
    'packages/config/src/world.ts',
    'packages/contracts/src/tile.ts',
    'pnpm-lock.yaml',
    'package.json',
    'tsconfig.base.json',
    'tools/ci-scope.mjs'
  ]) {
    assert.equal(scopeOf([file]).engine, true, file)
  }
})

test('a workflow change runs everything that depends on workflows', () => {
  const scope = scopeOf(['.github/workflows/ci.yml'])
  assert.deepEqual(scope, all)
})

test('one engine file among documentation still runs the engine', () => {
  const scope = scopeOf(['docs/a.md', 'packages/simulation/src/world/World.ts'])
  assert.equal(scope.engine, true)
})

test('a pull request is diffed against its base; a push is not', () => {
  const calls = []
  const run = (cmd, args) => {
    calls.push([cmd, ...args])
    return 'docs/a.md\n\npackages/ui/src/x.ts\n'
  }
  const pr = changedFiles({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' }, run)
  assert.deepEqual(pr, ['docs/a.md', 'packages/ui/src/x.ts'])
  assert.deepEqual(calls[0], ['git', 'diff', '--name-only', 'origin/main...HEAD'])
  assert.equal(changedFiles({ GITHUB_EVENT_NAME: 'push' }, run), null)
  assert.equal(changedFiles({ GITHUB_EVENT_NAME: 'pull_request' }, run), null)
})

test('a failed diff is unknown, never "nothing changed"', () => {
  const run = () => {
    throw new Error('bad revision')
  }
  assert.equal(
    changedFiles({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' }, run),
    null
  )
})
