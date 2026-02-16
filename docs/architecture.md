# Architecture Overview

> Last updated: February 2026 · v0.2.0

Sovereign is a procedural geopolitical simulation built with **React 18 + TypeScript + Canvas 2D**, shipped as both an **Electron** desktop app and a **static web build** via Vite.

---

## High-Level Data Flow

```
┌──────────────────────────────────────────────────────────┐
│  TitleScreen                                              │
│  User picks seed → GameStore.setPhase('generating')       │
└──────────────┬───────────────────────────────────────────┘
               ▼
┌──────────────────────────────────────────────────────────┐
│  MapView (mounts)                                         │
│  Spawns terrain Web Worker                                │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  terrain.worker.ts (off main thread)                 │ │
│  │  elevation → waterDist → temp → humidity → rivers    │ │
│  │  → biomes → resources → strategic → ImageData maps   │ │
│  │  Posts back transferable ArrayBuffers (zero-copy)     │ │
│  └──────────────────────────────────────────────────────┘ │
│  Main thread receives → builds WorldMap + chunks          │
│  → spawnNations() → builds political overlay              │
│  GameStore.setPhase('playing')                            │
│                                                           │
│  Render loop: Camera → frustum cull → draw chunks         │
│  Tooltip: WorldMap.at(x,y) → TileInfo                     │
└──────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
src/
├── config/
│   └── Config.ts              # Central config (every tunable param)
├── core/
│   ├── ai/                    # (Phase 4+) AI decision systems
│   ├── camera/
│   │   └── Camera.ts          # Pan / zoom / screen↔world transforms
│   ├── entities/
│   │   ├── Nation.ts           # Nation class: provinces, stats, personality
│   │   ├── NameGenerator.ts   # Procedural fantasy nation names
│   │   ├── ColorGenerator.ts  # Golden-angle hue spacing for distinct colours
│   │   └── FlagGenerator.ts   # 6-pattern procedural flag data
│   ├── rendering/
│   │   └── Renderer.ts        # Chunked ImageBitmap compositing + culling
│   ├── simulation/
│   │   └── Simulation.ts      # requestAnimationFrame throttle + FPS counter
│   ├── state/
│   │   ├── GameStore.ts       # Zustand store (single source of truth)
│   │   └── persistence.ts     # Save/load via IndexedDB (binary format)
│   ├── systems/
│   │   └── NationSpawner.ts   # Spawn N nations on habitable land
│   ├── terrain/
│   │   ├── TerrainGenerator.ts# Elevation, temp, humidity field gen
│   │   ├── biomes.ts          # 26-biome classifier + colour palette
│   │   ├── rivers.ts          # Noise zero-crossing river system
│   │   ├── resources.ts       # Resource layer (Timber→Fur) from biome/noise
│   │   ├── strategic.ts       # Strategic point detection
│   │   └── terrain.worker.ts  # Web Worker orchestrating the full pipeline
│   └── world/
│       └── WorldMap.ts        # Struct-of-arrays tile data store
├── styles/                    # SCSS (tokens, mixins, components)
├── types/
│   ├── tile.ts                # TileInfo interface
│   └── resources.ts           # ResourceType enum + RESOURCE_META
└── ui/
    ├── App.tsx                # Phase router (title → generating → playing)
    ├── TitleScreen.tsx        # Seed input + New World button
    ├── MapView.tsx            # Canvas + toolbar + tooltip inspector
    └── main.tsx               # React entry point
```

---

## Key Design Decisions

### Struct-of-Arrays for Tile Data

With 4 million tiles (2000 × 2000), storing each tile as a JS object would create massive GC pressure. Instead, each property is a flat typed array:

```ts
elevation: Float32Array // 4M × 4 bytes = 16 MB
temperature: Float32Array // 16 MB
humidity: Float32Array // 16 MB
biomeIds: Uint8Array // 4 MB
riverMask: Uint8Array // 4 MB
resourceType: Uint8Array // 4 MB
resourceDensity: Uint8Array // 4 MB
ownership: Uint8Array // 4 MB
// Total: ~68 MB
```

The `WorldMap.at(x, y)` method composes a `TileInfo` object on demand, so the ergonomic API exists without the memory overhead.

### Web Worker for Generation

All terrain generation (elevation, temperature, humidity, rivers, biomes, resources, strategic detection, and ImageData rendering) runs in a dedicated Web Worker. Results are posted back as **transferable** `ArrayBuffer`s — true zero-copy transfer, not structured clone.

### Chunked Rendering

The map is split into 64 × 64 tile chunks, each rasterised into an `ImageBitmap`. The renderer only draws chunks overlapping the camera viewport (frustum culling). View switching swaps cached bitmap sets into the same chunk layout without re-rasterising.

### Zustand State Store

A single zustand store (`GameStore`) holds all application state:

- `phase`: drives routing (`'title'` → `'generating'` → `'playing'`)
- `view`: which map overlay is active
- `worldMap`: the WorldMap instance (tile data)
- `nations`: spawned Nation instances
- `seed`, `fps`, `inspectorEnabled`, etc.

### Save/Load Format

Binary blob stored in IndexedDB:

```
[4-byte header length (LE)] [JSON header] [binary payload]
```

The JSON header holds metadata (seed, dimensions, strategic points). The binary payload is the concatenated typed array buffers. This avoids Base64 overhead and handles 60+ MB save files efficiently.

---

## Module Dependency Graph

```
Config.ts ◄──────────── everything reads config
    │
    ▼
TerrainGenerator.ts
    │
    ├──► biomes.ts
    ├──► rivers.ts
    ├──► resources.ts
    ├──► strategic.ts
    │
    ▼
terrain.worker.ts ──(postMessage)──► MapView.tsx
                                        │
                                        ├──► WorldMap.ts ◄── TileInfo / ResourceType
                                        ├──► NationSpawner.ts ◄── Nation / NameGen / ColorGen / FlagGen
                                        ├──► Renderer.ts ◄── Camera.ts
                                        ├──► Simulation.ts
                                        └──► GameStore.ts ◄── persistence.ts
```
