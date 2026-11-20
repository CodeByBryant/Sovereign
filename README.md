<div align="center">

# SOVEREIGN

**A deterministic geopolitical simulation**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Quality](https://github.com/CodeByBryant/Sovereign/actions/workflows/quality.yml/badge.svg)](https://github.com/CodeByBryant/Sovereign/actions/workflows/quality.yml)
[![Deploy](https://github.com/CodeByBryant/Sovereign/actions/workflows/deploy-web.yml/badge.svg)](https://github.com/CodeByBryant/Sovereign/actions/workflows/deploy-web.yml)

Procedurally generated worlds that are the same on every machine, and (soon) nations that rise and fall on them.

[What it is](#what-it-is) · [Getting started](#getting-started) · [Controls](#controls) · [How it is built](#how-it-is-built) · [Roadmap](#roadmap) · [Contributing](#contributing)

</div>

---

## What it is

Sovereign is heading toward a deep grand-strategy simulation: individual rulers, generals and governors, populations with cultures and religions, economies, diplomacy and war, all running on a world whose entire history can be reproduced from a seed. You will start as an observer with god tools; playing a nation comes later.

**Today** it generates and shows the world, and spawns the nations. **Nothing simulates yet**: that is the next phase, and it is built on the foundation below on purpose.

### The world

- **2 000 x 2 000 tile maps** with elevation, temperature, humidity, biome, river, resource and ownership for every tile
- **26 biomes**, from deep ocean and glaciers to rainforest and volcanic peaks, with organic boundaries
- **Rivers** that follow noise zero-crossings: primary and secondary waterways, tapered at the shore
- **22 resources in two slots per tile** (surface and ground), placed by geology and ecology rather than noise: timber, grain, pasture, horses, fur, cotton, spices, wine, tea, ivory, stone, iron, copper, coal, oil, gold, silver, salt, gems, fish, pearls and whales. Metals follow ridges, oil and coal sit in basins, whole landmasses can lack some, and stocks can be drawn down (minerals for good, the renewable ones grow back)
- **Strategic locations**: river crossings, mountain passes, straits and peninsulas, scored 0 to 10
- **Nations**: 12 placed on habitable land, each with a name, colour, flag, government, personality and starting territory

### Seven map overlays

| Key | Overlay     | Shows                              |
| --- | ----------- | ---------------------------------- |
| `E` | Elevation   | Height (blue, green, brown, white) |
| `T` | Temperature | Heat (blue to red)                 |
| `H` | Humidity    | Moisture (tan to teal)             |
| `B` | Biome       | The 26-biome palette (default)     |
| `G` | Strategic   | Biome plus strategic points        |
| `R` | Resource    | Biome plus resource deposits       |
| `P` | Political   | Territory colours and borders      |

Click a nation's territory for its panel; the tile inspector (`I`) describes whatever is under the cursor.

### Determinism is the point

The same seed and config give the same world **byte for byte**, in the browser, in Node and on the command line, on Linux and Windows. That is what makes seeds shareable, runs replayable and balance work possible. The engine therefore uses its own PRNG, its own noise and its own `ln`/`exp`/`pow` instead of the platform's, has no third-party runtime dependencies, and is checked by golden hashes in CI. See [docs/simulation/determinism.md](docs/simulation/determinism.md).

```bash
pnpm sim -- --seed 1337        # prints a 128-bit hash of the world
```

### Runs everywhere

- **Web**: a static build on GitHub Pages
- **Desktop**: an Electron app (Windows, macOS, Linux) that loads the same web build
- **Headless**: `pnpm sim`, the simulator CLI, which needs no browser at all

---

## Getting started

You need **Node 22+** and **pnpm 10** (`corepack enable`).

```bash
git clone https://github.com/CodeByBryant/Sovereign.git
cd Sovereign
pnpm install
```

```bash
pnpm dev        # the web app on the Vite dev server
pnpm desktop    # builds the web app, then opens the Electron app
pnpm sim -- --seed 1337 --summary
```

```bash
pnpm check              # typecheck, lint, fast tests
pnpm test:determinism   # golden hashes and bit-exact math
pnpm build
```

Everything else (test layout, CI, measured performance) is in [docs/development.md](docs/development.md).

---

## Controls

| Mouse and keyboard          | Action                    |
| --------------------------- | ------------------------- |
| Click and drag              | Pan the camera            |
| Scroll wheel                | Zoom in and out           |
| `E` `T` `H` `B` `G` `R` `P` | Switch overlay            |
| Click a nation              | Open its panel            |
| `Esc`                       | Close the nation panel    |
| `I`                         | Toggle the tile inspector |
| `S`                         | Toggle the toolbar        |

| Touch               | Action                                                                      |
| ------------------- | --------------------------------------------------------------------------- |
| One finger drag     | Pan the camera                                                              |
| Two finger pinch    | Zoom in and out (a two finger drag pans too)                                |
| Tap a nation        | Open its panel (a bottom sheet on a phone); tap the close button to dismiss |
| Tap anywhere        | Show that tile in the tile inspector (a phone has no hover)                 |
| Toolbar `+` and `-` | Zoom in and out; they also work with a mouse                                |

On a phone the toolbar wraps and the panels become bottom sheets. Every button is at least 44 px, and the map respects notches and rounded corners (safe areas).

--------------------------- | ------------------------- |
| Click and drag | Pan the camera |
| Scroll wheel | Zoom in and out |
| `E` `T` `H` `B` `G` `R` `P` | Switch overlay |
| Click a nation | Open its panel |
| `Esc` | Close the nation panel |
| `I` | Toggle the tile inspector |
| `S` | Toggle the toolbar |

---

## How it is built

A pnpm workspace in which the simulation engine is a headless library and everything else is a client of it. The dependency rules are enforced by a lint check, not by convention.

```text
packages/
  contracts/        shared types; depends on nothing
  config/           the typed world configuration
  simulation/       the deterministic engine: RNG, math, noise, terrain, nations, hash, saves, World
  renderer/         camera and palettes (pure) and the PixiJS map renderer
  ui/               React components and styles
apps/
  web/              the browser app: engine in a Web Worker, IndexedDB saves
  desktop/          the Electron shell
  simulator-cli/    the headless runner
tools/              dependency-rule check, CI scoping, Pages artifact check
docs/               architecture, ADRs, the determinism spec, roadmap
```

Start with [docs/architecture.md](docs/architecture.md); [docs/README.md](docs/README.md) indexes the rest.

---

## Roadmap

The restructure is done: workspace, deterministic engine, PixiJS renderer, apps and CI. Next:

1. **Provinces and borders**: a province graph, expansion, natural borders, time controls
2. **People and economy**: pops, production, trade, notables
3. **AI and diplomacy**, then **warfare**, then **culture and events**
4. **God mode and observability**: every intervention a logged, deterministic command; replays
5. **Scale and 1.0**; later, **play a nation**

Details, exit criteria and the decisions behind them: [docs/roadmap.md](docs/roadmap.md).

---

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md): it is short, and the one rule that matters is that the same seed must give the same world everywhere.

## License

[MIT](LICENSE). Copyright (c) 2026 Bryant Ejorh.

---

<div align="center">

**Inspired by** Ages of Conflict, WorldBox and grand-strategy games

Built with [TypeScript](https://www.typescriptlang.org/) · [PixiJS](https://pixijs.com/) · [React](https://react.dev/) · [Electron](https://www.electronjs.org/) · [Vite](https://vite.dev/) · [pnpm](https://pnpm.io/)

</div>
