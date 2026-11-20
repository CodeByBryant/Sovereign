# 0001: Separate the simulation engine from the application

Status: **Accepted** (approved by the project owner)

## Problem

Sovereign started as a single Electron + React app. World generation, rendering, state and the (planned) simulation shared modules; terrain generation also produced `ImageData` for the canvas; the "simulation" was a render-loop throttle that read `performance.now()`; the default seed came from the wall clock; there were no tests. A geopolitical simulation has to be reproducible from a seed, testable without a browser, runnable headless for balancing, and savable faithfully. None of that was possible while the engine lived inside the UI.

## Decision

The engine is its own package, `@sovereign/simulation`, with a fixed, small set of dependencies (`contracts`, `config`) and none on any UI, renderer, bundler or runtime shell. Clients consume immutable snapshots and typed layers; they never mutate engine state.

```text
contracts  (nothing)
config     -> contracts
simulation -> contracts, config
renderer   -> contracts
ui         -> contracts
web        -> everything above
desktop    -> web
cli        -> simulation, config
```

- Pixels are not the engine's business. Terrain code produces typed fields; the renderer's palettes turn them into colour.
- The engine runs in a Web Worker in the browser (a tick workload will outgrow a frame budget once pops and notables exist) and directly in Node for the CLI and tests. Same code, same hash.
- The engine never reads the clock or `Math.random`; seeds and, later, commands are inputs.
- The rules are enforced by tooling (`tools/check-dependency-rules.mjs`, ESLint bans), not by convention.

## Alternatives considered

- **Refactor in place, keeping one app package.** Rejected: the coupling touched every file and there was no test harness to protect behaviour, so a boundary that tooling can enforce was worth more than a smaller diff.
- **Keep the engine in the web worker file.** Rejected: it makes the CLI, the tests and the determinism proof depend on a browser.
- **An ECS framework now.** Rejected: extra abstraction before the data model is proven. Struct-of-arrays plus an explicit system list in `World.step()` is enough.
- **Native or WASM compute.** Deferred indefinitely. A measured probe (`pnpm probe`: a 2000 x 2000 world builds in about 6 s once, hash and save take well under a second) shows no problem. It is revisited only if a probe shows a real bottleneck TypeScript optimisation cannot fix; golden hashes already define "correct output" for any rewrite.

## Consequences

- Every existing world changed when generation moved onto the engine's own noise and PRNG (see ADR 0003). Pre-1.0, with no users to protect, that was accepted and recorded.
- Saves from the old app are not migrated.
- Some indirection: the UI cannot call into the engine, so it goes through the host's snapshots. That cost is the point.

## Rollback

Each step of the restructure was its own pull request on a stacked branch; the old app is the history before the first one.
