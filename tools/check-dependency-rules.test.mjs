import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { ALLOWED, checkImports, checkManifests, checkWorkspace } from './check-dependency-rules.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('the dependency graph', () => {
  it('is exactly the architecture: the whole graph, so no edge can be added unnoticed', () => {
    assert.deepEqual(ALLOWED, {
      contracts: [],
      config: ['contracts'],
      simulation: ['contracts', 'config'],
      renderer: ['contracts'],
      ui: ['contracts'],
      web: ['simulation', 'renderer', 'ui', 'config', 'contracts'],
      desktop: ['web'],
      'simulator-cli': ['simulation', 'config']
    })
  })

  it('keeps the desktop shell, the CLI and the engine from reaching into each other', () => {
    const pkg = (name, dep) => [{ name, dir: 'x', dependencies: { [dep]: 'workspace:*' } }]
    assert.equal(checkManifests(pkg('@sovereign/desktop', '@sovereign/simulation')).length, 1)
    assert.equal(checkManifests(pkg('@sovereign/simulator-cli', '@sovereign/renderer')).length, 1)
    assert.equal(checkManifests(pkg('@sovereign/simulation', '@sovereign/web')).length, 1)
  })
})

describe('checkManifests', () => {
  const pkg = (name, extra) => ({ name, dir: `x/${name}`, ...extra })

  it('accepts a package that depends only on what the graph allows', () => {
    assert.deepEqual(
      checkManifests([
        pkg('@sovereign/web', {
          dependencies: { '@sovereign/simulation': 'workspace:*', react: '^19', zustand: '^5' }
        }),
        pkg('@sovereign/renderer', {
          dependencies: { '@sovereign/contracts': 'workspace:*', 'pixi.js': '^8' }
        })
      ]),
      []
    )
  })

  it('rejects an internal dependency the graph does not allow, naming it', () => {
    const errors = checkManifests([
      pkg('@sovereign/contracts', { dependencies: { '@sovereign/config': 'workspace:*' } })
    ])
    assert.equal(errors.length, 1)
    assert.match(errors[0], /@sovereign\/contracts: forbidden dependency on @sovereign\/config/)
  })

  it('applies the rule to devDependencies and peerDependencies too', () => {
    for (const field of ['devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const errors = checkManifests([
        pkg('@sovereign/ui', { [field]: { '@sovereign/web': 'workspace:*' } })
      ])
      assert.equal(errors.length, 1, field)
    }
  })

  it('rejects a package that is not in the graph, or is not scoped', () => {
    assert.match(checkManifests([pkg('@sovereign/mystery', {})])[0], /not listed/)
    assert.match(checkManifests([pkg('lodash', {})])[0], /must start with "@sovereign\/"/)
  })

  it('keeps PixiJS in the renderer, React in ui and web, Electron in the desktop shell', () => {
    assert.match(
      checkManifests([pkg('@sovereign/web', { dependencies: { 'pixi.js': '^8' } })])[0],
      /PixiJS belongs in @sovereign\/renderer/
    )
    assert.match(
      checkManifests([pkg('@sovereign/renderer', { dependencies: { react: '^19' } })])[0],
      /React belongs in/
    )
    assert.match(
      checkManifests([
        pkg('@sovereign/web', { devDependencies: { '@types/react': '^19' } })
      ]).join(),
      /^$/
    )
    assert.match(
      checkManifests([pkg('@sovereign/config', { devDependencies: { '@types/react': '^19' } })])[0],
      /React belongs in/
    )
    assert.match(
      checkManifests([pkg('@sovereign/web', { dependencies: { electron: '^28' } })])[0],
      /Electron belongs in @sovereign\/desktop/
    )
    assert.match(
      checkManifests([
        pkg('@sovereign/simulator-cli', { devDependencies: { 'electron-builder': '^24' } })
      ])[0],
      /Electron/
    )
    assert.deepEqual(
      checkManifests([
        pkg('@sovereign/desktop', {
          devDependencies: {
            electron: '^28',
            'electron-builder': '^24',
            '@sovereign/web': 'workspace:*'
          }
        })
      ]),
      []
    )
  })

  it('gives the engine no third-party runtime dependencies at all', () => {
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      const errors = checkManifests([pkg('@sovereign/simulation', { [field]: { alea: '^1' } })])
      assert.equal(errors.length, 1, field)
      assert.match(errors[0], /engine must not have a third-party runtime dependency "alea"/)
    }
  })

  it('lets the engine have only development tooling as devDependencies', () => {
    assert.deepEqual(
      checkManifests([pkg('@sovereign/simulation', { devDependencies: { '@types/node': '^22' } })]),
      []
    )
    assert.match(
      checkManifests([pkg('@sovereign/simulation', { devDependencies: { react: '^19' } })])[0],
      /React|must not/
    )
  })

  it('still lets the engine depend on contracts and config', () => {
    assert.deepEqual(
      checkManifests([
        pkg('@sovereign/simulation', {
          dependencies: {
            '@sovereign/contracts': 'workspace:*',
            '@sovereign/config': 'workspace:*'
          }
        })
      ]),
      []
    )
  })
})

describe('checkImports', () => {
  const file = (path, text) => ({ path, text })

  it('accepts imports the graph allows, including subpath exports', () => {
    assert.deepEqual(
      checkImports('web', [
        file(
          'a.ts',
          "import { x } from '@sovereign/renderer/pixi'\nexport { y } from '@sovereign/ui'"
        )
      ]),
      []
    )
  })

  it('rejects an import of a package the graph does not allow', () => {
    const errors = checkImports('ui', [
      file('src/a.tsx', "import { World } from '@sovereign/simulation'")
    ])
    assert.equal(errors.length, 1)
    assert.match(errors[0], /src\/a\.tsx: @sovereign\/ui must not import @sovereign\/simulation/)
  })

  it('catches every import form: import, export from, dynamic import, require', () => {
    for (const text of [
      "import x from '@sovereign/web'",
      "import '@sovereign/web'",
      "export * from '@sovereign/web'",
      "const m = await import('@sovereign/web')",
      "const m = require('@sovereign/web')"
    ]) {
      assert.equal(checkImports('contracts', [file('a.ts', text)]).length, 1, text)
    }
  })

  it('keeps PixiJS, React and Electron imports in their owners', () => {
    assert.equal(
      checkImports('web', [file('a.ts', "import { Application } from 'pixi.js'")]).length,
      1
    )
    assert.equal(
      checkImports('renderer', [file('a.ts', "import { Application } from 'pixi.js'")]).length,
      0
    )
    assert.equal(checkImports('simulation', [file('a.ts', "import React from 'react'")]).length, 1)
    assert.equal(checkImports('ui', [file('a.tsx', "import React from 'react'")]).length, 0)
    assert.equal(checkImports('web', [file('a.ts', "import { app } from 'electron'")]).length, 1)
    assert.equal(
      checkImports('desktop', [file('a.ts', "import { app } from 'electron'")]).length,
      0
    )
  })

  it('stops the engine importing any browser, bundler or UI package', () => {
    for (const spec of [
      'react',
      'react-dom/client',
      'vite',
      '@vitejs/plugin-react',
      'electron',
      'pixi.js',
      'zustand'
    ]) {
      assert.equal(
        checkImports('simulation', [file('a.ts', `import x from '${spec}'`)]).length,
        1,
        spec
      )
    }
  })

  it('exempts test files from the external-library rules (they hold fixtures and use test tooling)...', () => {
    const fixture = file(
      'packages/simulation/tests/lint.test.ts',
      "const bad = \"import 'react'\"; import { it } from 'vitest'"
    )
    assert.deepEqual(checkImports('simulation', [fixture]), [])
  })

  it('...but still holds them to the @sovereign graph', () => {
    const test = file(
      'packages/contracts/tests/a.test.ts',
      "import { World } from '@sovereign/simulation'"
    )
    assert.equal(checkImports('contracts', [test]).length, 1)
  })

  it('rejects a relative import that climbs out of its package', () => {
    const errors = checkImports(
      'web',
      [file('apps/web/src/a.ts', "import x from '../../../packages/ui/src/y'")],
      'apps/web'
    )
    assert.equal(errors.length, 1)
    assert.match(errors[0], /outside its package/)
    assert.deepEqual(
      checkImports(
        'web',
        [file('apps/web/src/host/a.ts', "import x from '../state/GameStore'")],
        'apps/web'
      ),
      []
    )
  })

  it('does not mistake text in a comment-free string for an import', () => {
    assert.deepEqual(
      checkImports('contracts', [file('a.ts', "const doc = 'see @sovereign/web for details'")]),
      []
    )
  })
})

describe('checkWorkspace on a real directory tree', () => {
  let root
  beforeEach(() => {
    // a fresh clean tree for every test, so no test can see another's leftovers
    root = mkdtempSync(join(tmpdir(), 'sov-deps-'))
    write('packages/contracts/package.json', { name: '@sovereign/contracts' })
    write('packages/contracts/src/index.ts', 'export const x = 1')
    write('packages/config/package.json', {
      name: '@sovereign/config',
      dependencies: { '@sovereign/contracts': 'workspace:*' }
    })
    write(
      'packages/config/src/index.ts',
      "import { x } from '@sovereign/contracts'\nexport const y = x"
    )
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const write = (rel, content) => {
    const full = join(root, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content))
  }

  it('passes a clean tree', () => {
    assert.deepEqual(checkWorkspace(root), [])
  })

  it('finds a violation in a manifest and one in a source file, in the right packages', () => {
    write('packages/contracts/package.json', {
      name: '@sovereign/contracts',
      dependencies: { '@sovereign/config': 'workspace:*' }
    })
    write('packages/config/src/bad.ts', "import { World } from '@sovereign/simulation'")
    const errors = checkWorkspace(root)
    assert.equal(errors.length, 2, errors.join('\n'))
    assert.ok(
      errors.some((e) =>
        /@sovereign\/contracts: forbidden dependency on @sovereign\/config/.test(e)
      )
    )
    assert.ok(
      errors.some((e) =>
        /bad\.ts: @sovereign\/config must not import @sovereign\/simulation/.test(e)
      )
    )
  })

  it('scans the apps as well as the packages', () => {
    write('apps/web/package.json', {
      name: '@sovereign/web',
      dependencies: { '@sovereign/simulator-cli': 'workspace:*' }
    })
    write('apps/web/src/a.ts', "import { x } from '@sovereign/desktop'")
    const errors = checkWorkspace(root)
    assert.equal(errors.length, 2, errors.join('\n'))
    assert.ok(errors.every((e) => /apps\/web|@sovereign\/web/.test(e)))
  })

  it('scans test files as well as source files', () => {
    write('packages/config/tests/bad.test.ts', "import { World } from '@sovereign/simulation'")
    assert.equal(checkWorkspace(root).length, 1)
  })
})

describe('this repository', () => {
  it('obeys its own dependency rules', () => {
    assert.deepEqual(checkWorkspace(REPO), [])
  })
})
