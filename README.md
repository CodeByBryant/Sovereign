# Sovereign

A WorldBox-inspired game simulation with procedural terrain and biome generation using Perlin noise.

## Features

### Sub-Phase 1.3: Biome System ✅

- **Loading Screen**: Beautiful loading screen with progress bar showing world generation stages
- **Biome Determination Logic**: Implemented `determineBiome(elevation, temp, humidity)` function with decision tree:
  - `elevation < 0.4`: OCEAN biomes (Deep Ocean, Ocean, Shallow Ocean, Beach, Coral Reef)
  - `temp < 0.2`: FROZEN biomes (Ice, Tundra)
  - `temp < 0.4`: COLD biomes (Taiga, Tundra)
  - `temp < 0.7`: TEMPERATE biomes (Desert, Grassland, Forest, Wetlands)
  - `temp > 0.7`: HOT biomes (Desert, Savanna, Grassland, Rainforest, Swamp, Lava)
  - Subdivided by humidity levels
- **Biome Color Palette**: 20 unique biomes with Earth-like colors
- **Biome Rendering**: Beautiful colored biome map
- **Mouse Hover**: Displays biome information (name, elevation, temperature, humidity) on hover
- **Toggle Views**: Press 'B' key to toggle between biome view and elevation view

## Biomes

The game features 20 distinct biomes:

1. Deep Ocean - `#001a33`
2. Ocean - `#003366`
3. Shallow Ocean - `#0066cc`
4. Beach - `#f5deb3`
5. Grassland - `#7cba3d`
6. Forest - `#2d5016`
7. Rainforest - `#0d3d0a`
8. Desert - `#e0c097`
9. Savanna - `#c4a565`
10. Tundra - `#ccddee`
11. Taiga - `#4a6f5a`
12. Snow - `#ffffff`
13. Ice - `#c8e6ff`
14. Mountains - `#7a7a7a`
15. High Mountains - `#a9a9a9`
16. Swamp - `#4a5f3a`
17. Wetlands - `#6b8e5f`
18. Volcanic - `#5c2626`
19. Lava - `#ff4500`
20. Coral Reef - `#ff7f50`

## Controls

- **Mouse Drag**: Pan around the world
- **Mouse Wheel**: Zoom in/out
- **B Key**: Toggle between biome view and elevation view
- **Hover**: See detailed information about any tile

## Development

### Install Dependencies

```bash
npm install
```

### Run Development Server

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

### Build for Production

```bash
npm run build
```

## Technical Details

- **TypeScript**: Type-safe game logic
- **Perlin Noise**: Realistic terrain generation with multiple octaves
- **SCSS**: WorldBox-inspired medieval/fantasy styling
- **Canvas**: Hardware-accelerated 2D rendering
- **Webpack**: Module bundling and development server

## Project Structure

```
src/
├── core/
│   ├── Biome.ts         # Biome types, colors, and determination logic
│   ├── Camera.ts        # Viewport and zoom controls
│   ├── Config.ts        # Game configuration
│   ├── Renderer.ts      # Canvas rendering engine
│   ├── Simulation.ts    # Main game loop
│   └── WorldMap.ts      # Terrain and biome generation
├── styles/
│   ├── _variables.scss  # Color palette and constants
│   ├── _mixins.scss     # Reusable style mixins
│   ├── _canvas.scss     # Canvas styling
│   ├── _panels.scss     # UI panel styles
│   ├── _buttons.scss    # Button styles
│   └── main.scss        # Main stylesheet
├── index.html           # HTML entry point
└── main.ts             # Application entry point
```

## License

MIT
