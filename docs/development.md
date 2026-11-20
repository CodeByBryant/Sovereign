# Development

## Setup

You need **Node 22 or newer** and **pnpm 10** (`corepack enable` picks up the version pinned in `package.json`).

```bash
git clone https://github.com/CodeByBryant/Sovereign.git
cd Sovereign
pnpm install
```

Installing downloads the Electron binary. To skip it when you only work on the engine or the web app: `ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install`.

## Running

| Command                                                 | What it does                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm dev`                                              | The web app on the Vite dev server (React runs in StrictMode here, so effects mount twice) |
| `pnpm desktop`                                          | Builds the web app and the Electron main process, then opens the desktop app               |
| `pnpm sim -- --seed 1337`                               | Creates a world headless and prints its 128-bit state hash                                 |
| `pnpm sim -- --seed 1337 --ticks 100 --summary`         | Runs ticks and prints a readable overview with the hash                                    |
| `pnpm sim -- --seed 1337 --save a.sov` / `--load a.sov` | Writes or reads a save; `--validate` checks a world is consistent                          |

`pnpm sim -- --help` lists every option; exit codes are 0 (ok), 1 (the request failed) and 2 (usage error). Equal seed and config always print the same hash, in the CLI, in Node tests and in the browser's worker.

## Checking your work

| Command                             | What it runs                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                        | typecheck, lint and the fast tests: what a pull request must pass                                             |
| `pnpm typecheck`                    | `tsc` in every package                                                                                        |
| `pnpm lint`                         | the dependency-rule checker, then ESLint everywhere (the determinism bans apply to `packages/simulation/src`) |
| `pnpm test`                         | the tool tests, then every package's fast suite                                                               |
| `pnpm test:determinism`             | the simulation's golden hashes and bit-exact math goldens                                                     |
| `pnpm format` / `pnpm format:check` | Prettier                                                                                                      |
| `pnpm build`                        | build everything (the web app is bundled; the others typecheck or compile)                                    |
| `pnpm --filter @sovereign/web e2e`  | the browser end-to-end test; needs Chromium (`pnpm --filter @sovereign/web exec playwright install chromium`) |
| `pnpm probe`                        | times world generation, hash, save and load at several sizes                                                  |

### Test layout

Each package keeps its tests in `tests/`, mirroring `src/`, with shared helpers in `tests/support/`.

- **Fast suite** (`vitest.config.ts`): everything except `tests/determinism/`. Seconds.
- **Determinism suite** (`vitest.determinism.config.ts`): golden world hashes (`tests/determinism/golden/world-hashes.json`), terrain goldens and bit-exact `ln`/`exp`/`pow` goldens. CI runs it on Linux and Windows. Regenerating a golden is a deliberate act, in its own commit, with the reason in the pull request ([simulation/determinism.md](simulation/determinism.md), section 8).
- **Probe** (`vitest.probe.config.ts`, `tests/probe/*.probe.ts`): measurements, not tests; never part of a suite.
- **Tool tests** (`tools/*.test.mjs`, `node:test`): the dependency-rule checker, the CI-scope decision, the Pages artifact check and the determinism shard list.
- **Browser e2e** (`apps/web/e2e`): drives the dev server in Chromium.

### Writing tests

Write the test first and watch it fail for the reason you expect. For engine primitives the project goes further: expected values come from an independent reference implementation (not from the code under test), and the tests are mutation-checked by breaking a constant, a boundary or a byte order on purpose and confirming a test fails. A test that cannot fail is not a test.

## Continuous integration

`.github/workflows/quality.yml` runs on every pull request and on `main`:

| Job                                      | Notes                                                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Changed paths                            | `tools/ci-scope.mjs`: documentation-only changes skip the engine and app jobs; anything it cannot read runs everything |
| Format, Lint, Typecheck                  | Lint includes the dependency rules                                                                                     |
| Simulation tests, Package and tool tests | Folded into one required check, `Unit and integration tests`                                                           |
| Build                                    | After format, lint, typecheck and tests                                                                                |
| Determinism                              | Ubuntu and Windows, in shards named by file; **required**                                                              |
| Pages artifact                           | Builds the web app and checks it is deployable from a sub-path and from `file://`                                      |
| Browser end-to-end                       | Chromium against the dev server                                                                                        |

`deploy-web.yml` publishes `apps/web/dist` to GitHub Pages from `main`, after the same artifact check. `release.yml` builds desktop installers.

## Performance

A measured answer, not a guess (`pnpm probe`, Node 22, one machine, no GPU):

| Map         | create | hash   | save             | load   |
| ----------- | ------ | ------ | ---------------- | ------ |
| 1024 x 1024 | 1.4 s  | 180 ms | 37 ms (18.9 MB)  | 33 ms  |
| 2000 x 2000 | 5.9 s  | 680 ms | 133 ms (72.1 MB) | 162 ms |

A world is built once, in a worker. Nothing here justifies native or WASM compute; that stays deferred until a probe shows a real bottleneck ([ADR 0001](decisions/0001-separate-simulation-engine.md)). When the tick loop exists, add a tick probe next to this one and budget each phase with it.

## Conventions

- TypeScript strict. Prettier formats; ESLint is the style guide.
- Everything in `packages/simulation/src` obeys the determinism rules: no `Math.random`, clocks, platform transcendentals (`Math.sin`, `Math.pow`, `**`...), `for...in` or `Object.keys` iteration. The lint rules say what to use instead.
- A new system adds its random stream to `STREAM_NAMES`, ships a golden, and lands behind the dependency and lint rules.
- A new package goes into the graph in `tools/check-dependency-rules.mjs` (and its test) in the same change.
- Commit messages: `type(scope): summary` (`feat`, `fix`, `refactor`, `test`, `docs`, `ci`, `chore`); explain the why in the body.
