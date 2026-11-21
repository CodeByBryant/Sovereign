/**
 * @module persistence
 * @description Saving and loading worlds in IndexedDB. The bytes themselves are produced and read
 * by the engine (`encodeWorld` / `decodeWorld`, a pure format); this module only stores them.
 */
import { SaveFormatError, decodeWorld, encodeWorld, type World } from '@sovereign/simulation'

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DB_NAME = 'sovereign'
// 2: saves are now the engine's own format; version-1 records (a different layout) are dropped.
// 3: engine save format 2 (the saved world config gained terrain profiles and a climate table);
//    records written before it can no longer be loaded and are dropped.
// 4: engine save format 3 (every tile has two resource slots with richness and stock); older records are dropped.
// 5: engine save format 4 (a route network, and the profile of each nation's land); older records are dropped.
const DB_VERSION = 5
const STORE_NAME = 'saves'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SaveMetadata {
  id: string
  name: string
  /** The engine seed (a uint32). */
  seed: number
  /** The simulation tick the world was saved at. */
  tick: number
  createdAt: number
  /** Engine save-format version the bytes were written with. */
  formatVersion: number
}

/* ------------------------------------------------------------------ */
/*  IndexedDB helpers                                                  */
/* ------------------------------------------------------------------ */

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (event) => {
      const db = request.result
      // Versions before 5 stored formats the engine can no longer read. Drop those records rather
      // than leave entries that cannot be loaded.
      if (
        event.oldVersion > 0 &&
        event.oldVersion < 5 &&
        db.objectStoreNames.contains(STORE_NAME)
      ) {
        db.deleteObjectStore(STORE_NAME)
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function idbPut(
  db: IDBDatabase,
  data: { id: string; blob: ArrayBuffer; meta: SaveMetadata }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(data)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function idbGet(
  db: IDBDatabase,
  id: string
): Promise<{ id: string; blob: ArrayBuffer; meta: SaveMetadata } | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(id)
    req.onsuccess = () =>
      resolve(req.result as { id: string; blob: ArrayBuffer; meta: SaveMetadata } | undefined)
    req.onerror = () => reject(req.error)
  })
}

function idbGetAllKeys(db: IDBDatabase): Promise<SaveMetadata[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results = (req.result as any[]).map((r) => r.meta as SaveMetadata)
      resolve(results)
    }
    req.onerror = () => reject(req.error)
  })
}

function idbDelete(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Save a world to IndexedDB.
 *
 * @param world  The world to persist.
 * @param name   Human-readable save name.
 * @returns  The save metadata (id, timestamp, etc.).
 */
export async function saveGame(world: World, name = 'Autosave'): Promise<SaveMetadata> {
  const bytes = encodeWorld(world)
  const now = Date.now()
  const meta: SaveMetadata = {
    id: `save-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    seed: world.seed,
    tick: world.clock.tick,
    createdAt: now,
    formatVersion: new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, false)
  }
  // Store exactly these bytes (not a view onto a larger buffer).
  const blob = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
  const db = await openDB()
  try {
    await idbPut(db, { id: meta.id, blob, meta })
  } finally {
    db.close()
  }
  return meta
}

/**
 * Load a saved game from IndexedDB.
 *
 * @param id  The save ID to load.
 * @throws  `Error` if there is no such save, `SaveFormatError` if the stored bytes are not a
 *          readable save.
 */
export async function loadGame(id: string): Promise<{ world: World; meta: SaveMetadata }> {
  const db = await openDB()
  let record
  try {
    record = await idbGet(db, id)
  } finally {
    db.close()
  }
  if (!record) throw new Error(`Save not found: ${id}`)
  return { world: decodeWorld(new Uint8Array(record.blob)), meta: record.meta }
}

/** List all save metadata (sorted newest first). */
export async function listSaves(): Promise<SaveMetadata[]> {
  const db = await openDB()
  let metas: SaveMetadata[]
  try {
    metas = await idbGetAllKeys(db)
  } finally {
    db.close()
  }
  return metas.sort((a, b) => b.createdAt - a.createdAt)
}

/** Delete a saved game. */
export async function deleteSave(id: string): Promise<void> {
  const db = await openDB()
  try {
    await idbDelete(db, id)
  } finally {
    db.close()
  }
}

export { SaveFormatError }
