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

- **Massive maps** — 2 000 × 1 200 tile worlds rendered with chunked Canvas 2D
- **Three noise layers** — elevation, temperature and humidity via seeded simplex noise + domain warping
- **26 biomes** — from deep ocean and glaciers to tropical rainforests and volcanic peaks, with organic jittered boundaries
- **Rivers** — Minecraft-style noise zero-crossing algorithm producing primary and secondary waterways with shore tapering
- **Strategic locations** — automatic detection of river crossings, mountain passes, straits and peninsulas scored 0–10

### Rendering & Performance

- **Chunked ImageBitmap pipeline** — tiles are rasterised once per view mode and cached as bitmaps
- **Viewport culling** — only visible chunks are drawn each frame
- **Precomputed chunk layout** — view switching swaps cached bitmaps into a fixed layout without recalculation
- **Spatial-hash tooltip grid** — O(1) strategic point lookups on hover
- **`{ alpha: false }` canvas context** — lets the browser skip compositing

### Five Overlay Modes

| Key | Mode | Visualises |
|-----|------|-----------|
| `E` | Elevation | Height map (blue → green → brown → white) |
| `T` | Temperature | Heat map (blue → red) |
| `H` | Humidity | Moisture map (tan → teal) |
| `B` | Biome | Full 26-biome colour palette (default) |
| `S` | Strategic | Biome base + highlighted strategic points |

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

| Input | Action |
|-------|--------|
| Click + drag | Pan the camera |
| Scroll wheel | Zoom in / out |
| `E` | Elevation overlay |
| `T` | Temperature overlay |
| `H` | Humidity overlay |
| `B` | Biome overlay |
| `S` | Strategic overlay |

---

## Architecture

```
sovereign/
├── electron/              # Electron main + preload
│   ├── main/
│   └── preload/
├── src/
│   ├── config/
│   │   └── Config.ts      # Every tunable parameter in one place
│   ├── core/
│   │   ├── ai/            # (Phase 2+) AI decision systems
│   │   ├── camera/
│   │   │   └── Camera.ts  # Pan / zoom state
│   │   ├── entities/      # (Phase 2+) Nations, units
│   │   ├── rendering/
│   │   │   └── Renderer.ts# Chunked Canvas 2D draw loop
│   │   ├── simulation/
│   │   │   └── Simulation.ts
│   │   ├── terrain/
│   │   │   ├── biomes.ts           # 26-biome classifier
│   │   │   ├── rivers.ts           # Noise zero-crossing rivers
│   │   │   ├── strategic.ts        # Strategic point detection
│   │   │   └── TerrainGenerator.ts # Orchestrates all layers
│   │   ├── systems/       # (Phase 2+) ECS-style systems
│   │   └── world/
│   │       └── WorldMap.ts
│   ├── styles/            # SCSS w/ tokens, mixins, components
│   ├── types/             # Shared TypeScript interfaces
│   └── ui/
│       ├── App.tsx         # Main React component + toolbar
│       └── main.tsx        # Entry point
├── public/                # Static assets
├── docs/                  # Documentation
├── electron-builder.yml   # Desktop packaging config
├── electron.vite.config.ts
└── vite.config.ts         # Web-only Vite config
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
- [x] Five overlay modes with bottom toolbar
- [x] JSDoc documentation across all modules

### Phase 2 — Nation Spawning (next)

- [ ] Nation entity system with unique traits
- [ ] 5 × 5 starting territories
- [ ] Political map overlay
- [ ] Province selection & tooltips

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

> See individual phase docs in `docs/` for details.

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