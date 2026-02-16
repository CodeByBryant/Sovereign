<div align="center">

# SOVEREIGN

**A Procedural Geopolitical Simulation**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-28.0-47848F.svg)](https://www.electronjs.org/)
[![CI](https://github.com/CodeByBryant/Sovereign/actions/workflows/ci.yml/badge.svg)](https://github.com/CodeByBryant/Sovereign/actions/workflows/ci.yml)
[![Deploy](https://github.com/CodeByBryant/Sovereign/actions/workflows/deploy-web.yml/badge.svg)](https://github.com/CodeByBryant/Sovereign/actions/workflows/deploy-web.yml)

Watch nations rise and fall in a living, breathing world of emergent geopolitics.

[Features](#features) · [Getting Started](#getting-started) · [Controls](#controls) · [Architecture](#architecture) · [Roadmap](#roadmap) · [Contributing](#contributing)

</div>

---

## Features

### Procedural World Generation

- **Massive maps** — 2 000 × 2 000 tile worlds with per-tile data (elevation, temperature, humidity, biome, river, resource, ownership)
- **Web Worker pipeline** — entire terrain generation runs off the main thread with zero-copy `ArrayBuffer` transfers
- **26 biomes** — from deep ocean and glaciers to tropical rainforests and volcanic peaks, with organic jittered boundaries
- **Rivers** — Minecraft-style noise zero-crossing algorithm producing primary and secondary waterways with shore tapering
- **8 resource types** — Timber, Stone, Iron, Gold, Fertile Soil, Fish, Fur & Game — derived from biome, ore noise, elevation and river proximity
- **Strategic locations** — automatic detection of river crossings, mountain passes, straits and peninsulas scored 0–10
- **Nation spawning** — 12 nations placed on habitable land with procedural names, colours, flags, governments and personality traits

### Tile Data System

- **Struct-of-arrays** — 8 typed-array layers (Float32Array / Uint8Array) instead of 4M JS objects
- **WorldMap.at(x, y)** — ergonomic accessor returns a `TileInfo` snapshot with biome, resource, owner, river, shore adjacency
- **Per-tile ownership** — Uint8Array layer tracking which nation owns each tile (255 = unclaimed)

### Rendering & Performance

- **Chunked ImageBitmap pipeline** — tiles are rasterised once per view mode and cached as bitmaps
- **Viewport culling** — only visible chunks are drawn each frame
- **Precomputed chunk layout** — view switching swaps cached bitmaps into a fixed layout without recalculation
- **Spatial-hash tooltip grid** — O(1) strategic point lookups on hover
- **`{ alpha: false }` canvas context** — lets the browser skip compositing

### Seven Overlay Modes

| Key | Mode        | Visualises                                |
| --- | ----------- | ----------------------------------------- |
| `E` | Elevation   | Height map (blue → green → brown → white) |
| `T` | Temperature | Heat map (blue → red)                     |
| `H` | Humidity    | Moisture map (tan → teal)                 |
| `B` | Biome       | Full 26-biome colour palette (default)    |
| `G` | Strategic   | Biome base + highlighted strategic points |
| `R` | Resource    | Biome base + tinted resource deposits     |
| `P` | Political   | Territory colours + nation borders        |

### State Management & Persistence

- **Zustand store** — single source of truth for phase routing, view mode, world data, nations
- **Title screen** — seed input + "New World" button with phase-based routing
- **Save / Load** — binary format in IndexedDB (~68 MB per 2000×2000 world)
- **Tile inspector** — hover tooltip showing biome · river · resource · strategic · nation (toggle: `I`)

### Desktop & Web

- Runs as a **native Electron app** (Windows, macOS, Linux)
- Also ships as a **static web build** deployed to GitHub Pages via CI

---

## Getting Started

### Prerequisites

- **Node.js** 18+ and **npm**
- **Git**

### Install

```bash
git clone https://github.com/CodeByBryant/Sovereign.git
cd Sovereign
npm install
```

### Run

```bash
# Electron (desktop)
npm run dev

# Web-only (Vite dev server)
npm run dev:web
```

### Build

```bash
# Web build → dist/
npm run build:web

# Desktop build + package
npm run build
npm run package

# Platform-specific installers
npm run build:win
npm run build:mac
npm run build:linux
```

---

## Controls

| Input        | Action                |
| ------------ | --------------------- |
| Click + drag | Pan the camera        |
| Scroll wheel | Zoom in / out         |
| `E`          | Elevation overlay     |
| `T`          | Temperature overlay   |
| `H`          | Humidity overlay      |
| `B`          | Biome overlay         |
| `G`          | Strategic overlay     |
| `R`          | Resource overlay      |
| `P`          | Political overlay     |
| `I`          | Toggle tile inspector |
| `S`          | Toggle toolbar        |

---

## Architecture

```
sovereign/
├── electron/                # Electron main + preload
│   ├── main/
│   └── preload/
├── src/
│   ├── config/
│   │   └── Config.ts        # Every tunable parameter in one place
│   ├── core/
│   │   ├── ai/              # (Phase 4+) AI decision systems
│   │   ├── camera/
│   │   │   └── Camera.ts    # Pan / zoom state
│   │   ├── entities/
│   │   │   ├── Nation.ts          # Nation class (provinces, stats, personality)
│   │   │   ├── NameGenerator.ts   # Procedural nation names
│   │   │   ├── ColorGenerator.ts  # Golden-angle colour spacing
│   │   │   └── FlagGenerator.ts   # Procedural flag patterns
│   │   ├── rendering/
│   │   │   └── Renderer.ts  # Chunked Canvas 2D draw loop
│   │   ├── simulation/
│   │   │   └── Simulation.ts
│   │   ├── state/
│   │   │   ├── GameStore.ts      # Zustand global store
│   │   │   └── persistence.ts    # IndexedDB save / load
│   │   ├── systems/
│   │   │   └── NationSpawner.ts  # Greedy spawn + territory claiming
│   │   ├── terrain/
│   │   │   ├── biomes.ts           # 26-biome classifier
│   │   │   ├── rivers.ts           # Noise zero-crossing rivers
│   │   │   ├── resources.ts        # 8 resource types generator
│   │   │   ├── strategic.ts        # Strategic point detection
│   │   │   ├── terrain.worker.ts   # Web Worker pipeline
│   │   │   └── TerrainGenerator.ts # Orchestrates all layers
│   │   └── world/
│   │       └── WorldMap.ts   # Struct-of-arrays tile storage
│   ├── styles/               # SCSS w/ tokens, mixins, components
│   ├── types/
│   │   ├── resources.ts      # ResourceType enum + metadata
│   │   └── tile.ts           # TileInfo / TileData interfaces
│   └── ui/
│       ├── App.tsx           # Phase router
│       ├── MapView.tsx       # Canvas + toolbar + tooltip + worker
│       ├── TitleScreen.tsx   # Seed input + New World
│       └── main.tsx          # Entry point
├── public/                   # Static assets
├── docs/                     # Documentation
│   ├── architecture.md
│   ├── terrain.md
│   ├── nations.md
│   └── save-load.md
├── electron-builder.yml      # Desktop packaging config
├── electron.vite.config.ts
└── vite.config.ts            # Web-only Vite config
```

---

## Roadmap

### Phase 1 — Terrain Generation ✅

- [x] Seeded simplex noise (elevation, temperature, humidity)
- [x] 26-biome classification with organic jitter
- [x] Chunked ImageBitmap rendering with viewport culling
- [x] Camera pan & zoom
- [x] River generation (primary + secondary waterways)
- [x] Strategic point detection (river crossings, mountain passes, straits, peninsulas)
- [x] Web Worker terrain pipeline with zero-copy transfers
- [x] JSDoc documentation across all modules

### Phase 2 — Foundation & Nation Spawning ✅

- [x] Struct-of-arrays tile data (WorldMap)
- [x] 8 resource types derived from biome, ore noise, elevation & rivers
- [x] Title screen with seed input
- [x] Zustand state management + phase routing
- [x] Save / Load via IndexedDB (binary format)
- [x] Seven overlay modes (Elevation, Temperature, Humidity, Biome, Strategic, Resource, Political)
- [x] Tile inspector tooltip
- [x] Nation entity system with procedural names, colours, flags & personality
- [x] Greedy spawn placement + 5 × 5 starting territories
- [x] Political map overlay with territory colouring

### Phase 3 — Expansion & Borders

- [ ] Organic expansion algorithm with terrain costs
- [ ] Border detection & rendering
- [ ] Natural borders (rivers, mountain ranges)
- [ ] Collision / conflict resolution

### Phase 4+ — Simulation Loop

- [ ] Population, economy & technology growth
- [ ] Diplomacy & alliances
- [ ] Warfare (province-by-province conquest)
- [ ] Religion & culture spread
- [ ] AI decision-making (Top-K / Top-P sampling)
- [ ] God Mode (intervention tools)
- [ ] Historical timeline & statistics

> See individual phase docs in [`docs/`](docs/) for details.

---

## Contributing

Contributions are welcome! The project is in early development.

1. **Fork** the repository
2. **Create** a feature branch — `git checkout -b feature/your-feature`
3. **Commit** your changes — `git commit -m 'Add your feature'`
4. **Push** — `git push origin feature/your-feature`
5. **Open** a Pull Request

### Guidelines

- TypeScript strict mode
- ESLint + Prettier — `npm run lint:fix && npm run format`
- Meaningful commit messages
- Update docs when adding features

---

## License

[MIT](LICENSE) — Copyright (c) 2026 Bryant Ejorh

---

<div align="center">

**Inspired by** Ages of Conflict, WorldBox and grand strategy games

Built with [Electron](https://www.electronjs.org/) · [React](https://react.dev/) · [TypeScript](https://www.typescriptlang.org/) · [simplex-noise](https://github.com/jwagner/simplex-noise.js)

</div>
