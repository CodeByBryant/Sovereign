# Architecture

Sovereign is a deterministic geopolitical simulation. The **engine** (`@sovereign/simulation`) is a headless library: give it a seed and a config and it produces the same world, byte for byte, on any machine. Everything else (the map renderer, the React UI, the browser app, the Electron shell, the command-line runner) is a client of the engine. The engine knows nothing about any of them.

```text
              packages/                                      apps/
  contracts ◄── config ◄── simulation ◄───────────┬───────── simulator-cli
      ▲                                           ├───────── web ◄──── desktop
      ├──────── renderer ◄────────────────────────┤
      └──────── ui ◄──────────────────────────────┘
```

The exact rules, and the tool that enforces them, are in [architecture/dependency-diagram.md](architecture/dependency-diagram.md). The reasons are in [ADR 0001](decisions/0001-separate-simulation-engine.md) and [ADR 0002](decisions/0002-workspace-layout.md).

## The packages

| Package                    | What it is                                                                                                                                                                                               | Depends on         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `@sovereign/contracts`     | Plain types shared by everyone: tiles, biomes, resources, `TerrainFields`, nations, `WorldSnapshot`. No code with behaviour.                                                                             | nothing            |
| `@sovereign/config`        | The typed world configuration, its defaults, `resolveWorldConfig` (per-section overrides) and `validateWorldConfig`. No seed and no view settings: those are inputs and presentation, not configuration. | contracts          |
| `@sovereign/simulation`    | The engine. Random streams, deterministic math, noise, terrain, nations, the clock, the state hash, the save format, and `World`. No DOM, no React, no clock, no `Math.random`.                          | contracts, config  |
| `@sovereign/renderer`      | The pure part (camera, view math, palettes that turn fields into RGBA) and, under `@sovereign/renderer/pixi`, the PixiJS `MapRenderer`.                                                                  | contracts          |
| `@sovereign/ui`            | React components (title screen, tile inspector, nation panel) and the SCSS. They render snapshots; they never touch the engine.                                                                          | contracts          |
| `@sovereign/web`           | The browser app: runs the engine in a Web Worker, owns the game store and IndexedDB saves, mounts the renderer and the UI. Deployed to GitHub Pages.                                                     | all packages above |
| `@sovereign/desktop`       | The Electron shell. It loads the `web` build and adds nothing else.                                                                                                                                      | web                |
| `@sovereign/simulator-cli` | `pnpm sim`: create or load a world, run ticks, print a hash, a summary or JSON, save it. The headless proof that the engine needs no browser.                                                            | simulation, config |

## How a world gets on screen

1. The title screen picks a seed (typed, or a random one). The game store moves to the `generating` phase.
2. `MapView` asks `SimulationHost` for a world. The host runs `World.create({ seed, config })` inside a Web Worker (`world.worker.ts`), so a 2000 x 2000 generation (about 6 seconds, see [development.md](development.md#performance)) never blocks the page.
3. The worker answers with a snapshot (seed, size, sea level, nations, state hash) and the tile layers. The layers move by **transfer**, not copy.
4. Palette functions in `@sovereign/renderer` turn each layer into RGBA for the seven overlays (elevation, temperature, humidity, biome, strategic, resource, political). The PixiJS `MapRenderer` owns its own canvas, uploads the layers as textures and draws the visible part.
5. Hover and click are answered on the main thread from the same arrays: `WorldMap.at(x, y)` returns a `TileInfo`, and the UI components render it.

The worker and the CLI run the same engine code, so the same seed gives the same state hash in both. That is checked, not assumed: see [simulation/determinism.md](simulation/determinism.md).

## Data model

Per-tile data is struct-of-arrays: one typed array per field (three `Float32Array`s for elevation, temperature and humidity; one byte per tile for biome, river mask, river width and ownership, plus six more for the two resource slots: type, richness and stock each). A 2000 x 2000 world is about 88 MB. Creating 4 million tile objects would cost more in garbage collection than the whole generation, so none exist: `WorldMap.at(x, y)` builds a `TileInfo` on demand.

Nations are plain serialisable data (`Nation`): identity (name, colour, flag), personality, stats and the tiles they own, as indices in claim order. Ownership is one byte per tile (`255` means unclaimed), so a world has at most 255 nations.

`World` is the only thing that orders the simulation. `World.step()` will be a flat list of system calls, each mutating only what it owns. The list is empty today: nothing simulates yet, which is deliberate. The contract (seed, streams, hash, save, goldens, lint rules) exists before the first gameplay system so that no system is ever written without it.

## Determinism, saves and hashes

Three separate things, easy to confuse:

- **Determinism** is a property of the engine, specified in [simulation/determinism.md](simulation/determinism.md) and enforced by lint rules, tests and golden hashes (policy: [ADR 0003](decisions/0003-determinism-policy.md)).
- A **state hash** is a 128-bit fingerprint of a world, versioned by `HASH_SCHEMA_VERSION`. It is how two machines, or two versions of the code, prove they agree.
- A **save** is the world's data as bytes ([simulation/save-format.md](simulation/save-format.md)). The engine encodes and decodes it; the browser app only stores it in IndexedDB ([save-load.md](save-load.md)).

## The desktop shell

Electron runs with `contextIsolation` and `sandbox` on and no Node integration in the page. The window may navigate only to the app itself (`apps/desktop/src/paths.ts` decides what that is) and the packaged build ships `apps/web/dist` as `resources/web`. All game logic stays in the web build, so the desktop app and the website cannot drift apart.

## Where things are documented

| Topic                                        | Document                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Why the engine is separate / why this layout | [ADR 0001](decisions/0001-separate-simulation-engine.md), [ADR 0002](decisions/0002-workspace-layout.md) |
| Determinism rules, RNG, math, hashing        | [simulation/determinism.md](simulation/determinism.md), [ADR 0003](decisions/0003-determinism-policy.md) |
| Terrain generation                           | [terrain.md](terrain.md)                                                                                 |
| Nations and the political map                | [nations.md](nations.md)                                                                                 |
| Save format and storage                      | [simulation/save-format.md](simulation/save-format.md), [save-load.md](save-load.md)                     |
| Running, testing, CI                         | [development.md](development.md)                                                                         |
| Where this is going                          | [roadmap.md](roadmap.md)                                                                                 |
