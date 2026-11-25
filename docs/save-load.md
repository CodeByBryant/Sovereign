# Saving and loading in the browser app

The **bytes** of a save are the engine's business and are specified in [simulation/save-format.md](simulation/save-format.md): `encodeWorld(world)` produces them, `decodeWorld(bytes)` rebuilds a world (and refuses anything malformed), and the CLI can write and read the same files (`--save`, `--load`). This page covers only where the browser app keeps them.

## IndexedDB

`apps/web/src/state/persistence.ts` stores each save as a record in IndexedDB. A 1000 x 1000 world is about 17 MB (a 2000 x 2000 one is about 72 MB), far beyond what `localStorage` can hold.

- **Database** `sovereign`, **version 3**, object store `saves` (key `id`).
- **Record** `{ id, blob, meta }`: `blob` is the engine's bytes, `meta` is `{ id, name, seed, tick, createdAt, formatVersion }`.
- `seed`, `tick` and `formatVersion` are read from the saved bytes; `id` and `createdAt` are metadata made by the host (a clock and a random id are fine here, outside the engine), and never enter the world or its hash.
- Upgrading from a database older than version 3 drops its records: they were written in layouts the engine can no longer read (version 1 a different format; version 2 engine save format 1, before the terrain profiles), and an entry that cannot be loaded is worse than no entry.

```ts
import { saveGame, loadGame, listSaves, deleteSave } from './state/persistence'
```

## Versioning

`SAVE_FORMAT_VERSION` (engine) changes whenever the layout does. Older versions are not migrated yet (pre-1.0): the engine refuses them with a `SaveFormatError`, and the app drops incompatible records when the IndexedDB schema version moves. A compatibility policy is a roadmap item for the 1.0 phase ([roadmap.md](roadmap.md)).

## Not done yet

- Compression of the payload.
- Exporting a save to a file from the desktop app.
- Autosave.
