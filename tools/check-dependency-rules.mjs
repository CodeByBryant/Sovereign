#!/usr/bin/env node
/**
 * Enforces the workspace's dependency rules:
 *
 * - Every `@sovereign/*` dependency, in any package.json field, and every `@sovereign/*` import in
 *   source or tests must be an edge of the graph below.
 * - Some libraries have one home: PixiJS in the renderer, React in ui and web, Electron in the
 *   desktop shell.
 * - The simulation engine has NO third-party dependencies at all, runtime or import: it may use
 *   `@sovereign/contracts` and `@sovereign/config` and nothing else. (Its development tooling,
 *   such as `@types/node`, is fine as a devDependency.)
 * - A package may not reach into another package with a relative import.
 *
 * Usage: node tools/check-dependency-rules.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** package name (without scope) -> the internal packages it may depend on. */
export const ALLOWED = {
  contracts: [],
  config: ['contracts'],
  simulation: ['contracts', 'config'],
  renderer: ['contracts'],
  ui: ['contracts'],
  web: ['simulation', 'renderer', 'ui', 'config', 'contracts'],
  desktop: ['web'],
  'simulator-cli': ['simulation', 'config']
}

/** Packages the engine must never use, even as development tooling. */
const ENGINE_FORBIDDEN = [
  /^react($|\/)/,
  /^react-dom($|\/)/,
  /^vite($|\/)/,
  /^@vitejs\//,
  /^electron($|\/)/,
  /^pixi\.js($|\/)/,
  /^zustand($|\/)/,
  /^@types\/(react|react-dom)$/
]

/** Libraries that only some packages may use. */
export const EXTERNAL_OWNERS = [
  {
    pattern: /^pixi\.js($|\/)/,
    owners: ['renderer'],
    what: 'PixiJS belongs in @sovereign/renderer'
  },
  {
    pattern: /^(react|react-dom)($|\/)|^@types\/(react|react-dom)$/,
    owners: ['ui', 'web'],
    what: 'React belongs in @sovereign/ui and @sovereign/web'
  },
  {
    pattern: /^(electron|electron-builder)($|\/)/,
    owners: ['desktop'],
    what: 'Electron belongs in @sovereign/desktop'
  }
]

const SCOPE = '@sovereign/'
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
const RUNTIME_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies']
const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g

const ownerError = (short, spec) => {
  const rule = EXTERNAL_OWNERS.find((r) => r.pattern.test(spec))
  return rule && !rule.owners.includes(short) ? rule.what : null
}

/** Validate declared dependencies. `packages` is `[{ name, dir, dependencies, ... }]`. */
export function checkManifests(packages) {
  const errors = []
  for (const pkg of packages) {
    if (!pkg.name?.startsWith(SCOPE)) {
      errors.push(`${pkg.dir}: package name must start with "${SCOPE}" (got "${pkg.name}")`)
      continue
    }
    const short = pkg.name.slice(SCOPE.length)
    const allowed = ALLOWED[short]
    if (!allowed) {
      errors.push(
        `${pkg.name}: not listed in the ALLOWED graph of tools/check-dependency-rules.mjs`
      )
      continue
    }
    for (const field of DEP_FIELDS) {
      for (const dep of Object.keys(pkg[field] ?? {})) {
        if (dep.startsWith(SCOPE)) {
          if (!allowed.includes(dep.slice(SCOPE.length))) {
            errors.push(`${pkg.name}: forbidden dependency on ${dep} (${field})`)
          }
        } else if (short === 'simulation' && RUNTIME_FIELDS.includes(field)) {
          errors.push(
            `${pkg.name}: the engine must not have a third-party runtime dependency "${dep}" (${field})`
          )
        } else if (short === 'simulation' && ENGINE_FORBIDDEN.some((re) => re.test(dep))) {
          errors.push(`${pkg.name}: the engine must not use "${dep}", not even as a devDependency`)
        } else {
          const why = ownerError(short, dep)
          if (why) errors.push(`${pkg.name}: must not depend on "${dep}" (${field}): ${why}`)
        }
      }
    }
  }
  return errors
}

const isTestFile = (path) => /(^|\/)tests?\//.test(path)

/**
 * Validate the import specifiers in a package's files. `files` are `{ path, text }` with
 * repo-relative POSIX paths; `packageDir` (also repo-relative) enables the relative-import check.
 */
export function checkImports(shortName, files, packageDir) {
  const errors = []
  const allowed = ALLOWED[shortName] ?? []
  for (const { path, text } of files) {
    for (const match of text.matchAll(IMPORT_RE)) {
      const spec = match[1]
      if (spec.startsWith('.')) {
        if (packageDir !== undefined) {
          const target = posix.normalize(posix.join(posix.dirname(path), spec))
          if (target !== packageDir && !target.startsWith(`${packageDir}/`)) {
            errors.push(`${path}: "${spec}" reaches outside its package (${packageDir})`)
          }
        }
      } else if (spec.startsWith(SCOPE)) {
        const target = spec.slice(SCOPE.length).split('/')[0]
        if (target !== shortName && !allowed.includes(target)) {
          errors.push(`${path}: @sovereign/${shortName} must not import ${spec}`)
        }
      } else if (isTestFile(path)) {
        // Tests may use any test tooling, and hold fixtures such as lint cases that mention packages.
        continue
      } else if (shortName === 'simulation') {
        errors.push(
          `${path}: the simulation engine must not import "${spec}" (it may import only @sovereign/contracts and @sovereign/config)`
        )
      } else {
        const why = ownerError(shortName, spec)
        if (why) errors.push(`${path}: @sovereign/${shortName} must not import "${spec}": ${why}`)
      }
    }
  }
  return errors
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'release', '.git'])

function sourceFiles(dir, root) {
  const out = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full, root))
    else if (SOURCE_EXT.test(name)) {
      out.push({
        path: relative(root, full).split(sep).join('/'),
        text: readFileSync(full, 'utf8')
      })
    }
  }
  return out
}

/** Check every workspace package under `root` (its `apps/*` and `packages/*`). */
export function checkWorkspace(root) {
  const manifests = []
  const sources = []
  for (const group of ['apps', 'packages']) {
    const groupDir = join(root, group)
    if (!existsSync(groupDir)) continue
    for (const name of readdirSync(groupDir).sort()) {
      const dir = join(groupDir, name)
      const manifestPath = join(dir, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const relDir = `${group}/${name}`
      manifests.push({ ...manifest, dir: relDir })
      const files = ['src', 'tests'].flatMap((sub) => sourceFiles(join(dir, sub), root))
      sources.push({
        short: manifest.name?.startsWith(SCOPE) ? manifest.name.slice(SCOPE.length) : name,
        relDir,
        files
      })
    }
  }
  return [
    ...checkManifests(manifests),
    ...sources.flatMap(({ short, relDir, files }) => checkImports(short, files, relDir))
  ]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const errors = checkWorkspace(root)
  if (errors.length > 0) {
    console.error(`Dependency rules broken (${errors.length}):\n  ${errors.join('\n  ')}`)
    process.exit(1)
  }
  console.log('Dependency rules: OK')
}
