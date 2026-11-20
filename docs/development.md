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

| Command                                               | What it runs                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                          | typecheck, lint and the fast tests: what a pull request must pass                                                                                                                                                                                                                                                                            |
| `pnpm typecheck`                                      | `tsc` in every package                                                                                                                                                                                                                                                                                                                       |
| `pnpm lint`                                           | the dependency-rule checker, then ESLint everywhere (the determinism bans apply to `packages/simulation/src`)                                                                                                                                                                                                                                |
| `pnpm test`                                           | the tool tests, then every package's fast suite                                                                                                                                                                                                                                                                                              |
| `pnpm test:determinism`                               | the simulation's golden hashes and bit-exact math goldens                                                                                                                                                                                                                                                                                    |
| `pnpm format` / `pnpm format:check`                   | Prettier                                                                                                                                                                                                                                                                                                                                     |
| `pnpm build`                                          | build everything (the web app is bundled; the others typecheck or compile)                                                                                                                                                                                                                                                                   |
| `pnpm --filter @sovereign/web e2e`                    | the browser end-to-end test on the desktop: the StrictMode double mount, then the mouse (hover, wheel, drag, click a nation); needs Chromium (`pnpm --filter @sovereign/web exec playwright install chromium`)                                                                                                                               |
| `pnpm --filter @sovereign/web e2e:mobile`             | the same on a phone, in Chromium's touch emulation at 390 x 844 and 844 x 390: the layout fits, one finger pans, two fingers pinch, a tap opens a nation's panel and fills the tile inspector. Set `E2E_SHOTS=<dir>` to save screenshots. Real iOS and Android devices are not covered                                                       |
| `pnpm probe`                                          | the probes in `tests/probe/`. Alone it times world generation, hash, save and load. `pnpm probe -- tests/probe/biome-coverage.probe.ts` generates 10 full-size worlds and reports each biome's share of land, the ocean amounts, elevation percentiles, river and resource coverage, strategic point counts and whether all 26 biomes appear |
| `pnpm probe -- tests/probe/resource-quality.probe.ts` | generates 10 full-size worlds and reports every resource's share of land, its clustering (patches or speckle), how many landmasses lack it, and its geology (height, ridge, basin, river and coast, top biomes)                                                                                                                              |
| `pnpm probe -- tests/probe/fit-climate.probe.ts`      | refits the climate (temperature profile and every humidity threshold) to the target shares; run it after any change to the terrain generators and paste its output into `defaultWorldConfig`                                                                                                                                                 |

### Test layout

Each package keeps its tests in `tests/`, mirroring `src/`, with shared helpers in `tests/support/`.

- **Fast suite** (`vitest.config.ts`): everything except `tests/determinism/`. Seconds.
- **Determinism suite** (`vitest.determinism.config.ts`): a biome-coverage guard (three 1000 x 1000 worlds must contain all 26 biomes, the pinned ocean and every biome within a wide band of its target), golden world hashes (`tests/determinism/golden/world-hashes.json`), a resource-coverage guard (all 22 resources present, exact shares, metals on ridges, coal and oil in basins, patches not speckle), terrain goldens, a depletion golden and bit-exact `ln`/`exp`/`pow` goldens. CI runs it on Linux and Windows. Regenerating a golden is a deliberate act, in its own commit, with the reason in the pull request ([simulation/determinism.md](simulation/determinism.md), section 8).
- **Probe** (`vitest.probe.config.ts`, `tests/probe/*.probe.ts`): measurements, not tests; never part of a suite.
- **Tool tests** (`tools/*.test.mjs`, `node:test`): the dependency-rule checker, the CI-scope decision, the Pages artifact check and the determinism shard list.
- **Browser e2e** (`apps/web/e2e`): drives the dev server in Chromium, once as a desktop with a mouse and once as a phone with touch. They read the camera from `data-camera-*` attributes on the map shell rather than comparing screenshots, which are not stable on software GL.

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
| 1024 x 1024 | 1.9 s  | 198 ms | 60 ms (23.1 MB)  | 46 ms  |
| 2000 x 2000 | 6.5 s  | 730 ms | 121 ms (88.1 MB) | 148 ms |

A world is built once, in a worker. Nothing here justifies native or WASM compute; that stays deferred until a probe shows a real bottleneck ([ADR 0001](decisions/0001-separate-simulation-engine.md)). When the tick loop exists, add a tick probe next to this one and budget each phase with it.

## Conventions

- TypeScript strict. Prettier formats; ESLint is the style guide.
- Everything in `packages/simulation/src` obeys the determinism rules: no `Math.random`, clocks, platform transcendentals (`Math.sin`, `Math.pow`, `**`...), `for...in` or `Object.keys` iteration. The lint rules say what to use instead.
- A new system adds its random stream to `STREAM_NAMES`, ships a golden, and lands behind the dependency and lint rules.
- A new package goes into the graph in `tools/check-dependency-rules.mjs` (and its test) in the same change.
- Commit messages: `type(scope): summary` (`feat`, `fix`, `refactor`, `test`, `docs`, `ci`, `chore`); explain the why in the body.
