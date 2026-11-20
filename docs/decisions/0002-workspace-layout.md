# 0002: A pnpm workspace of five packages and three apps

Status: **Accepted** (approved by the project owner)

## Problem

One `package.json` and one `src/` made it impossible to say what may depend on what. The structure that proved itself in the sister project Evo is a pnpm workspace whose package boundaries are checked by a tool, with fast and slow test suites kept apart.

## Decision

```text
apps/      web, desktop, simulator-cli
packages/  contracts, config, simulation, renderer, ui
tools/     check-dependency-rules, ci-scope, check-pages-artifact (plain Node, tested with node:test)
docs/      architecture, decisions (ADRs), simulation/ (normative specs), roadmap
```

- **pnpm 10, Node 22.** `packageManager` and `engines` are pinned and `engine-strict` is on.
- **Just-in-time packages.** Each package's `exports` point at `src`, so there is no build step between packages and a type error shows up where it is made. The apps bundle them (Vite for web, `tsc` for the desktop main process).
- **Shared `tsconfig.base.json`, one root ESLint 9+ flat config, one Prettier config.** Determinism bans in ESLint apply only to `packages/simulation/src`.
- **Tests live next to the package they test**, in `tests/` mirroring `src/`, with `tests/support/` for helpers. The simulation's golden and cross-platform tests are in `tests/determinism/` with their own vitest config; the fast suite excludes them. A measurement probe lives in `tests/probe/` and is never part of either suite.
- **CI** (`.github/workflows/quality.yml`): format, lint (including the dependency rules), typecheck, tests behind one aggregate `test` check, build, determinism on Linux and Windows, the Pages artifact check and a browser end-to-end test. `tools/ci-scope.mjs` lets documentation-only changes skip the engine suites and runs everything whenever it cannot read the diff.
- **No `legacy/` folder.** The project is small and git history is the archive.

## Alternatives considered

- **npm workspaces, or a single package with path aliases.** Rejected: neither makes a forbidden import a hard error, and pnpm's strictness catches undeclared dependencies.
- **Published, built packages.** Rejected for now: a build step between engine and apps buys nothing while everything is private.
- **Turborepo/Nx.** Rejected: `pnpm -r` is enough at this size.

## Consequences

- A new package must be added to the graph in `tools/check-dependency-rules.mjs` (and its test) in the same change, or lint fails.
- The Electron app depends on the web build existing; `pnpm --filter @sovereign/desktop start` builds it first.
