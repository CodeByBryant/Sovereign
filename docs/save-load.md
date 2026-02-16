# Save / Load System

> Technical reference for the persistence layer.

---

## Overview

Game state is serialised into a compact binary format and stored in **IndexedDB**. This avoids the 5–10 MB limit of `localStorage` and handles the ~60 MB typed array payloads efficiently.

---

## Save Format

```
┌────────────────┬──────────────┬──────────────────┐
│ Header Length   │ JSON Header  │ Binary Payload    │
│ (4 bytes, LE)  │ (variable)   │ (typed arrays)    │
└────────────────┴──────────────┴──────────────────┘
```

### JSON Header

```json
{
  "id": "save-1708123456789-a1b2c3",
  "name": "Autosave",
  "seed": 42,
  "createdAt": 1708123456789,
  "formatVersion": 1,
  "width": 2000,
  "height": 2000,
  "seaLevel": 0.37,
  "strategicPoints": [...],
  "layers": {
    "elevation": 16000000,
    "temperature": 16000000,
    "humidity": 16000000,
    "biomeIds": 4000000,
    "riverMask": 4000000,
    "resourceType": 4000000,
    "resourceDensity": 4000000,
    "ownership": 4000000
  }
}
```

### Binary Payload

Typed array buffers concatenated in order:

1. `elevation` (Float32Array → 16 MB)
2. `temperature` (Float32Array → 16 MB)
3. `humidity` (Float32Array → 16 MB)
4. `biomeIds` (Uint8Array → 4 MB)
5. `riverMask` (Uint8Array → 4 MB)
6. `resourceType` (Uint8Array → 4 MB)
7. `resourceDensity` (Uint8Array → 4 MB)
8. `ownership` (Uint8Array → 4 MB)

**Total: ~68 MB** per save for a 2000×2000 map.

---

## API

```ts
import { saveGame, loadGame, listSaves, deleteSave } from './core/state/persistence'

// Save current game
const meta = await saveGame(worldMap, seed, strategicPoints, 'My Save')

// List all saves (newest first)
const saves = await listSaves()

// Load a save
const { worldMap, seed, strategicPoints, meta } = await loadGame(saveId)

// Delete a save
await deleteSave(saveId)
```

---

## IndexedDB Schema

- **Database:** `sovereign`
- **Version:** 1
- **Object Store:** `saves` (keyPath: `id`)
- **Record Shape:** `{ id: string, blob: ArrayBuffer, meta: SaveMetadata }`

---

## Versioning

The `formatVersion` field in the header enables forward-compatible migrations. The current version is `1`. Loading a save with an unsupported version throws an error.

---

## Future Enhancements

- **Compression:** fflate/gzip the binary payload (~3–5× reduction)
- **Nation state:** Include nation array in the save header
- **Electron file export:** Write `.sov` files to disk via IPC
- **Autosave:** Periodic saves during gameplay
