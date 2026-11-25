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

| Command                                               | What it runs                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                          | typecheck, lint and the fast tests: what a pull request must pass                                                                                                                                                                                                                                                                                                          |
| `pnpm typecheck`                                      | `tsc` in every package                                                                                                                                                                                                                                                                                                                                                     |
| `pnpm lint`                                           | the dependency-rule checker, then ESLint everywhere (the determinism bans apply to `packages/simulation/src`)                                                                                                                                                                                                                                                              |
| `pnpm test`                                           | the tool tests, then every package's fast suite                                                                                                                                                                                                                                                                                                                            |
| `pnpm test:determinism`                               | the simulation's golden hashes and bit-exact math goldens                                                                                                                                                                                                                                                                                                                  |
| `pnpm format` / `pnpm format:check`                   | Prettier                                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm build`                                          | build everything (the web app is bundled; the others typecheck or compile)                                                                                                                                                                                                                                                                                                 |
| `pnpm --filter @sovereign/web e2e`                    | the browser end-to-end test on the desktop: the StrictMode double mount, then the mouse (hover, wheel, drag, click a nation); needs Chromium (`pnpm --filter @sovereign/web exec playwright install chromium`)                                                                                                                                                             |
| `pnpm --filter @sovereign/web e2e:mobile`             | the same on a phone, in Chromium's touch emulation at 390 x 844 and 844 x 390: the layout fits, one finger pans, two fingers pinch, a tap opens a nation's panel and fills the tile inspector. Set `E2E_SHOTS=<dir>` to save screenshots. Real iOS and Android devices are not covered                                                                                     |
| `pnpm --filter @sovereign/web e2e:time`               | time: on the desktop, play, pause, the speeds and the keys (Space, + and -), a nation growing in its panel until the borders settle; on a phone (portrait and landscape), the transport bar fits, its buttons are big enough to tap and it does not cover the HUD, the toolbar or the legend. A few minutes in software GL (a 1000 x 1000 world, then a run to settlement) |
| `pnpm --filter @sovereign/web e2e:units`              | the sprite layers: zoomed out there are no sprites, zoomed in on a capital there are resource objects, roads, a hall and villagers, the villagers move while time runs, and zooming out removes them again. A few minutes in software GL (a 1000 x 1000 world). Set `E2E_SHOTS=<dir>` to save screenshots                                                                  |
| `pnpm --filter @sovereign/web e2e:gather`             | the gather loop: zoomed in on a capital, time runs and villagers are seen working deposits and carrying goods home while the deposits are drawn down (the stock changes reach the page). A few minutes in software GL. Set `E2E_SHOTS=<dir>` to save screenshots                                                                                                           |
| `pnpm probe`                                          | the probes in `tests/probe/`. Alone it times world generation, hash, save and load. `pnpm probe -- tests/probe/biome-coverage.probe.ts` generates 10 full-size worlds and reports each biome's share of land, the ocean amounts, elevation percentiles, river and resource coverage, strategic point counts and whether all 26 biomes appear                               |
| `pnpm probe -- tests/probe/resource-quality.probe.ts` | generates 10 full-size worlds and reports every resource's share of land, its clustering (patches or speckle), how many landmasses lack it, and its geology (height, ridge, basin, river and coast, top biomes)                                                                                                                                                            |
| `pnpm probe -- tests/probe/units.probe.ts`            | what a simulated unit costs: a gatherer loop for 2,000, 10,000 and 30,000 units over the real cost grid, with every walker stepped each tick, with units that sleep until they arrive, and with routes shared between units                                                                                                                                                |
| `pnpm probe -- tests/probe/nodes.probe.ts`            | resource nodes as rows: how many, memory, build time, the spatial index, nearest-node query time, hash and save size against the tile layers                                                                                                                                                                                                                               |
| `pnpm probe -- tests/probe/phase3-world.probe.ts`     | generates a full-size world and grows it: province count and sizes, creation time, how many provinces the nations hold over the years, when the borders settle, the cost of a tick (`PROBE_SEEDS`, `PROBE_TICKS`)                                                                                                                                                          |
| `pnpm probe -- tests/probe/fit-climate.probe.ts`      | refits the climate (temperature profile and every humidity threshold) to the target shares; run it after any change to the terrain generators and paste its output into `defaultWorldConfig`                                                                                                                                                                               |

### Test layout

Each package keeps its tests in `tests/`, mirroring `src/`, with shared helpers in `tests/support/`.

- **Fast suite** (`vitest.config.ts`): everything except `tests/determinism/`. Seconds.
- **Determinism suite** (`vitest.determinism.config.ts`): a biome-coverage guard (three 1000 x 1000 worlds must contain all 26 biomes, the pinned ocean and every biome within a wide band of its target), golden world hashes (`tests/determinism/golden/world-hashes.json`), a resource-coverage guard (all 22 resources present, exact shares, metals on ridges, coal and oil in basins, patches not speckle), a routes-and-nations guard (points on routes, no type swamping the rest, stats that follow the land), terrain goldens, a depletion golden and bit-exact `ln`/`exp`/`pow` goldens. CI runs it on Linux and Windows. Regenerating a golden is a deliberate act, in its own commit, with the reason in the pull request ([simulation/determinism.md](simulation/determinism.md), section 8).
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

| Map                                                       | create | hash   | save             | load   |
| --------------------------------------------------------- | ------ | ------ | ---------------- | ------ |
| 1024 x 1024                                               | 2.1 s  | 190 ms | 78 ms (23.1 MB)  | 300 ms |
| 2000 x 2000                                               | 8.2 s  | 720 ms | 190 ms (88.2 MB) | 1.3 s  |
| 1000 x 1000 (default, with deposits and halls, seed 1337) | 3.1 s  | 124 ms | 65 ms (16.7 MB)  | 420 ms |

The province layer (the cut of the land, and what each province is like) is derived, not saved, so it is rebuilt on every create and every load: about 1.6 s at 2000 x 2000 (the cut 1.1 s, what each province is like 0.3 s, the cost grid 0.1 s), which is why a load takes 1.3 s and not 0.16 s. The first two rows were measured before deposits became rows (ADR 0009); the third is the current default. A tick with 300 villagers gathering costs about 1.9 ms at 1000 x 1000. Before units, a tick cost 0.006 to 0.008 ms at 2000 x 2000 with 12 nations (`pnpm probe -- tests/probe/phase3-world.probe.ts` also grows a world to the point its borders settle).

A world is built once, in a worker. Nothing here justifies native or WASM compute; that stays deferred until a probe shows a real bottleneck ([ADR 0001](decisions/0001-separate-simulation-engine.md)).

## Conventions

- TypeScript strict. Prettier formats; ESLint is the style guide.
- Everything in `packages/simulation/src` obeys the determinism rules: no `Math.random`, clocks, platform transcendentals (`Math.sin`, `Math.pow`, `**`...), `for...in` or `Object.keys` iteration. The lint rules say what to use instead.
- A new system adds its random stream to `STREAM_NAMES`, ships a golden, and lands behind the dependency and lint rules.
- A new package goes into the graph in `tools/check-dependency-rules.mjs` (and its test) in the same change.
- Commit messages: `type(scope): summary` (`feat`, `fix`, `refactor`, `test`, `docs`, `ci`, `chore`); explain the why in the body.
