/**
 * @module persistence
 * @description Save / load game state via IndexedDB.
 *
 * Serialises the WorldMap typed arrays + game metadata into a single
 * binary blob with a small JSON header.  IndexedDB is used because it
 * handles large binary payloads efficiently (unlike localStorage).
 *
 * Save format:
 *   [4-byte header length (LE)] [JSON header] [binary payload]
 *
 * The JSON header contains seed, width, height, seaLevel, strategicPoints,
 * and the lengths of each typed array in the binary payload.
 */
import { WorldMap, type WorldMapData } from '../world/WorldMap'
import type { StrategicPoint } from '../terrain/strategic'

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DB_NAME = 'sovereign'
const DB_VERSION = 1
const STORE_NAME = 'saves'
const SAVE_FORMAT_VERSION = 1

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SaveMetadata {
  id: string
  name: string
  seed: number | string
  createdAt: number
  formatVersion: number
}

interface SaveHeader extends SaveMetadata {
  width: number
  height: number
  seaLevel: number
  strategicPoints: StrategicPoint[]
  layers: {
    elevation: number
    temperature: number
    humidity: number
    biomeIds: number
    riverMask: number
    resourceType: number
    resourceDensity: number
    ownership: number
  }
}

/* ------------------------------------------------------------------ */
/*  IndexedDB helpers                                                  */
/* ------------------------------------------------------------------ */

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
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
/*  Serialise                                                          */
/* ------------------------------------------------------------------ */

function serialise(
  worldMap: WorldMap,
  seed: number | string,
  strategicPoints: StrategicPoint[],
  name: string
): { blob: ArrayBuffer; meta: SaveMetadata } {
  const id = `save-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = Date.now()

  const header: SaveHeader = {
    id,
    name,
    seed,
    createdAt: now,
    formatVersion: SAVE_FORMAT_VERSION,
    width: worldMap.width,
    height: worldMap.height,
    seaLevel: worldMap.seaLevel,
    strategicPoints,
    layers: {
      elevation: worldMap.elevation.byteLength,
      temperature: worldMap.temperature.byteLength,
      humidity: worldMap.humidity.byteLength,
      biomeIds: worldMap.biomeIds.byteLength,
      riverMask: worldMap.riverMask.byteLength,
      resourceType: worldMap.resourceType.byteLength,
      resourceDensity: worldMap.resourceDensity.byteLength,
      ownership: worldMap.ownership.byteLength
    }
  }

  const headerJson = new TextEncoder().encode(JSON.stringify(header))
  const headerLen = headerJson.byteLength

  // Calculate total binary payload size
  const payloadSize = Object.values(header.layers).reduce((sum, len) => sum + len, 0)
  const totalSize = 4 + headerLen + payloadSize

  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)

  // Write header length (4 bytes LE)
  view.setUint32(0, headerLen, true)

  // Write JSON header
  new Uint8Array(buffer, 4, headerLen).set(headerJson)

  // Write typed array layers sequentially
  let offset = 4 + headerLen
  const layers: ArrayBufferLike[] = [
    worldMap.elevation.buffer,
    worldMap.temperature.buffer,
    worldMap.humidity.buffer,
    worldMap.biomeIds.buffer,
    worldMap.riverMask.buffer,
    worldMap.resourceType.buffer,
    worldMap.resourceDensity.buffer,
    worldMap.ownership.buffer
  ]

  for (const layerBuf of layers) {
    new Uint8Array(buffer, offset, layerBuf.byteLength).set(new Uint8Array(layerBuf))
    offset += layerBuf.byteLength
  }

  const meta: SaveMetadata = { id, name, seed, createdAt: now, formatVersion: SAVE_FORMAT_VERSION }
  return { blob: buffer, meta }
}

/* ------------------------------------------------------------------ */
/*  Deserialise                                                        */
/* ------------------------------------------------------------------ */

function deserialise(buffer: ArrayBuffer): {
  worldMap: WorldMap
  seed: number | string
  strategicPoints: StrategicPoint[]
  meta: SaveMetadata
} {
  const view = new DataView(buffer)
  const headerLen = view.getUint32(0, true)
  const headerJson = new TextDecoder().decode(new Uint8Array(buffer, 4, headerLen))
  const header: SaveHeader = JSON.parse(headerJson)

  if (header.formatVersion !== SAVE_FORMAT_VERSION) {
    throw new Error(`Unsupported save format version: ${header.formatVersion}`)
  }

  let offset = 4 + headerLen
  const readLayer = (byteLength: number): ArrayBuffer => {
    const slice = buffer.slice(offset, offset + byteLength)
    offset += byteLength
    return slice
  }

  const data: WorldMapData = {
    width: header.width,
    height: header.height,
    seaLevel: header.seaLevel,
    elevation: new Float32Array(readLayer(header.layers.elevation)),
    temperature: new Float32Array(readLayer(header.layers.temperature)),
    humidity: new Float32Array(readLayer(header.layers.humidity)),
    biomeIds: new Uint8Array(readLayer(header.layers.biomeIds)),
    riverMask: new Uint8Array(readLayer(header.layers.riverMask)),
    resourceType: new Uint8Array(readLayer(header.layers.resourceType)),
    resourceDensity: new Uint8Array(readLayer(header.layers.resourceDensity)),
    ownership: new Uint8Array(readLayer(header.layers.ownership))
  }

  return {
    worldMap: new WorldMap(data),
    seed: header.seed,
    strategicPoints: header.strategicPoints,
    meta: {
      id: header.id,
      name: header.name,
      seed: header.seed,
      createdAt: header.createdAt,
      formatVersion: header.formatVersion
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Save the current game state to IndexedDB.
 *
 * @param worldMap  The world to persist.
 * @param seed      World generation seed.
 * @param strategicPoints  Strategic points from terrain gen.
 * @param name      Human-readable save name.
 * @returns  The save metadata (id, timestamp, etc.).
 */
export async function saveGame(
  worldMap: WorldMap,
  seed: number | string,
  strategicPoints: StrategicPoint[],
  name = 'Autosave'
): Promise<SaveMetadata> {
  const { blob, meta } = serialise(worldMap, seed, strategicPoints, name)
  const db = await openDB()
  await idbPut(db, { id: meta.id, blob, meta })
  db.close()
  return meta
}

/**
 * Load a saved game from IndexedDB.
 *
 * @param id  The save ID to load.
 * @returns  Reconstructed WorldMap + metadata.
 */
export async function loadGame(id: string): Promise<{
  worldMap: WorldMap
  seed: number | string
  strategicPoints: StrategicPoint[]
  meta: SaveMetadata
}> {
  const db = await openDB()
  const record = await idbGet(db, id)
  db.close()
  if (!record) throw new Error(`Save not found: ${id}`)
  return deserialise(record.blob)
}

/**
 * List all save metadata (sorted newest first).
 */
export async function listSaves(): Promise<SaveMetadata[]> {
  const db = await openDB()
  const metas = await idbGetAllKeys(db)
  db.close()
  return metas.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Delete a saved game.
 */
export async function deleteSave(id: string): Promise<void> {
  const db = await openDB()
  await idbDelete(db, id)
  db.close()
}
