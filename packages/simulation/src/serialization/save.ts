/**
 * @module save
 * @description Pure, host-independent encoding of a world to bytes and back. Storage (IndexedDB, a
 * file) is the host's business; this module only turns a `World` into a `Uint8Array` and a
 * `Uint8Array` into a validated `World`.
 *
 * Layout (docs/simulation/determinism.md does not cover saves; this is the format's definition):
 *
 * ```text
 * bytes 0..3    magic "SOVW"
 * bytes 4..7    format version, uint32 big-endian
 * bytes 8..11   header length N, uint32 big-endian
 * bytes 12..    header: N bytes of UTF-8 JSON (seed, tick, size, sea level, config, strategic
 *               points, route hubs, routes, nations with their province ids and expansion points,
 *               the units as columns (entities);
 *               the provinces themselves are derived from the terrain and rebuilt on load)
 * then          seven tile layers, each width*height long, in this order:
 *               elevation, temperature, humidity (float32, little-endian),
 *               biome ids, river mask, river width, ownership (one byte each)
 * then          the resource nodes to the end of the file: a count (uint32 LE), the kinds, stocks and
 *               richnesses (one byte each per node), then the tiles (uint32 LE); the tile slot arrays
 *               are rebuilt from them
 * ```
 *
 * A save is untrusted input. Every failure to read one is a `SaveFormatError`.
 */
import {
  assertValidWorldConfig,
  resolveWorldConfig,
  type WorldConfig,
  type WorldConfigOverrides
} from '@sovereign/config'
import type {
  ResourceSlots,
  RouteHub,
  StrategicPoint,
  StrategicRoute,
  StrategicType,
  TerrainFields
} from '@sovereign/contracts'
import { EntityStore, type EntityColumns } from '../entities/EntityStore'
import { NodeStore } from '../resources/NodeStore'
import { Stockpiles } from '../world/Stockpiles'
import { Nation } from '../nations/Nation'
import { PROFILE_FIELDS, World } from '../world/World'
import { utf8Bytes, utf8Decode } from './utf8'

export const SAVE_FORMAT_VERSION = 7

const MAGIC = [0x53, 0x4f, 0x56, 0x57] // "SOVW"
const PREAMBLE = 12
const FLOAT_LAYERS = 3
const BYTE_LAYERS = 4

const GOVERNMENTS = [
  'monarchy',
  'republic',
  'democracy',
  'theocracy',
  'empire',
  'tribal',
  'oligarchy',
  'dictatorship'
] as const
const FLAG_TYPES = [
  'solid',
  'horizontal_stripes',
  'vertical_stripes',
  'cross',
  'diagonal',
  'quartered'
] as const
const STRATEGIC_TYPES: readonly StrategicType[] = [
  'river_crossing',
  'mountain_pass',
  'strait',
  'isthmus'
]

/** Thrown for any save that cannot be read; the message says what is wrong. */
export class SaveFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SaveFormatError'
  }
}

// Float layers are copied as raw bytes in little-endian order, which is the host order everywhere
// this runs; refuse loudly rather than write a file other machines would misread.
const HOST_IS_LITTLE_ENDIAN = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1

/** The size in bytes of the tile layers of a `width x height` world. */
function layerBytes(width: number, height: number): number {
  return width * height * (FLOAT_LAYERS * 4 + BYTE_LAYERS)
}

/** Encode a world. Refuses a world that does not pass `validate()`. */
export function encodeWorld(world: World): Uint8Array {
  if (!HOST_IS_LITTLE_ENDIAN) throw new Error('saving needs a little-endian host')
  const problems = world.validate()
  if (problems.length > 0) {
    throw new RangeError(`cannot save a world that is not valid:\n  ${problems.join('\n  ')}`)
  }

  const t = world.terrain
  const header = {
    seed: world.seed,
    tick: world.clock.tick,
    width: t.width,
    height: t.height,
    seaLevel: t.seaLevel,
    config: world.config,
    strategicPoints: t.strategicPoints.map((p) => ({
      x: p.x,
      y: p.y,
      type: p.type,
      value: p.value
    })),
    hubs: t.hubs.map((hub) => ({ x: hub.x, y: hub.y, weight: hub.weight })),
    routes: t.routes.map((route) => ({
      from: route.from,
      to: route.to,
      cost: route.cost,
      traffic: route.traffic,
      path: [...route.path]
    })),
    entities: world.entities.toColumns(),
    stockpiles: world.stockpiles.toJson(),
    nations: world.nations.map((n) => ({
      id: n.id,
      name: n.name,
      color: [...n.color],
      flag: {
        type: n.flag.type,
        background: [...n.flag.background],
        accent: [...n.flag.accent],
        ...(n.flag.detail === undefined ? {} : { detail: [...n.flag.detail] })
      },
      government: n.government,
      personality: { ...n.personality },
      capital: n.capital,
      founded: n.founded,
      stats: { ...n.stats },
      profile: { ...n.profile },
      expansionPoints: n.expansionPoints,
      provinces: [...n.provinces]
    }))
  }
  const json = utf8Bytes(JSON.stringify(header))

  const nodeBytes = world.nodes.toBytes()
  const out = new Uint8Array(
    PREAMBLE + json.length + layerBytes(t.width, t.height) + nodeBytes.length
  )
  out.set(MAGIC, 0)
  const view = new DataView(out.buffer)
  view.setUint32(4, SAVE_FORMAT_VERSION, false)
  view.setUint32(8, json.length, false)
  out.set(json, PREAMBLE)

  let at = PREAMBLE + json.length
  for (const layer of [t.elevation, t.temperature, t.humidity]) {
    out.set(new Uint8Array(layer.buffer, layer.byteOffset, layer.byteLength), at)
    at += layer.byteLength
  }
  for (const layer of [t.biomeIds, t.riverMask, t.riverWidth, world.map.ownership]) {
    out.set(layer, at)
    at += layer.length
  }
  out.set(nodeBytes, at)
  return out
}

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberArray(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((v) => typeof v === 'number' && Number.isFinite(v))
  )
}

function number(source: Json, key: string, where: string): number {
  const v = source[key]
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new SaveFormatError(`${where} has a malformed ${key}`)
  }
  return v
}

function nationFromJson(value: unknown, index: number): Nation {
  const where = `nation ${index}`
  if (!isRecord(value)) throw new SaveFormatError(`${where} is malformed`)
  const { id, name, color, flag, government, personality, provinces } = value
  if (typeof id !== 'string') throw new SaveFormatError(`${where} has a malformed id`)
  if (typeof name !== 'string') throw new SaveFormatError(`${where} has a malformed name`)
  if (!numberArray(color, 3) || !color.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)) {
    throw new SaveFormatError(`${where} has a malformed color`)
  }
  if (!isRecord(flag) || !FLAG_TYPES.includes(flag.type as (typeof FLAG_TYPES)[number])) {
    throw new SaveFormatError(`${where} has a malformed flag`)
  }
  if (!numberArray(flag.background, 3) || !numberArray(flag.accent, 3)) {
    throw new SaveFormatError(`${where} has a malformed flag`)
  }
  if (flag.detail !== undefined && !numberArray(flag.detail, 3)) {
    throw new SaveFormatError(`${where} has a malformed flag`)
  }
  if (!GOVERNMENTS.includes(government as (typeof GOVERNMENTS)[number])) {
    throw new SaveFormatError(`${where} has a malformed government`)
  }
  if (!isRecord(value.profile)) throw new SaveFormatError(`${where} has no profile`)
  if (!isRecord(personality) || !isRecord(value.stats)) {
    throw new SaveFormatError(`${where} has a malformed personality or stats`)
  }
  if (!Array.isArray(provinces) || !provinces.every((p) => Number.isInteger(p) && p >= 0)) {
    throw new SaveFormatError(`${where} has a malformed province list`)
  }
  const stats = value.stats
  const rawProfile = value.profile as Json
  const profile = {} as Record<(typeof PROFILE_FIELDS)[number], number>
  for (const key of PROFILE_FIELDS) profile[key] = number(rawProfile, key, `${where} profile`)
  if (!Number.isInteger(profile.area) || profile.area < 0) {
    throw new SaveFormatError(`${where} has a profile with a malformed area`)
  }
  return new Nation({
    profile,
    id,
    name,
    color: [color[0] as number, color[1] as number, color[2] as number],
    flag: {
      type: flag.type as (typeof FLAG_TYPES)[number],
      background: [flag.background[0], flag.background[1], flag.background[2]] as [
        number,
        number,
        number
      ],
      accent: [flag.accent[0], flag.accent[1], flag.accent[2]] as [number, number, number],
      ...(flag.detail === undefined
        ? {}
        : { detail: [flag.detail[0], flag.detail[1], flag.detail[2]] as [number, number, number] })
    },
    government: government as (typeof GOVERNMENTS)[number],
    personality: {
      aggression: number(personality, 'aggression', where),
      expansionism: number(personality, 'expansionism', where),
      diplomacy: number(personality, 'diplomacy', where),
      mercantilism: number(personality, 'mercantilism', where),
      militarism: number(personality, 'militarism', where)
    },
    capital: number(value, 'capital', where),
    founded: number(value, 'founded', where),
    provinces: new Set<number>(provinces as number[]),
    expansionPoints: number(value, 'expansionPoints', where),
    stats: {
      population: number(stats, 'population', where),
      military: number(stats, 'military', where),
      economy: number(stats, 'economy', where),
      diplomacy: number(stats, 'diplomacy', where)
    }
  })
}

/** The units in a header: every column, checked as it is rebuilt into a store. */
function entitiesFromJson(value: unknown): EntityStore {
  if (!isRecord(value)) throw new SaveFormatError('the header has no entities')
  try {
    return EntityStore.fromColumns(value as unknown as EntityColumns)
  } catch (error) {
    if (error instanceof RangeError)
      throw new SaveFormatError(`the header entities are malformed: ${error.message}`)
    throw error
  }
}

function hubFromJson(value: unknown): RouteHub {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.x) ||
    !Number.isInteger(value.y) ||
    typeof value.weight !== 'number' ||
    !Number.isFinite(value.weight)
  ) {
    throw new SaveFormatError('the header has a malformed hub')
  }
  return { x: value.x as number, y: value.y as number, weight: value.weight }
}

function routeFromJson(value: unknown): StrategicRoute {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.from) ||
    !Number.isInteger(value.to) ||
    typeof value.cost !== 'number' ||
    !Number.isFinite(value.cost) ||
    typeof value.traffic !== 'number' ||
    !Number.isFinite(value.traffic) ||
    !Array.isArray(value.path) ||
    !value.path.every((v) => typeof v === 'number' && Number.isInteger(v))
  ) {
    throw new SaveFormatError('the header has a malformed route')
  }
  return {
    from: value.from as number,
    to: value.to as number,
    cost: value.cost,
    traffic: value.traffic,
    path: [...(value.path as number[])]
  }
}

function strategicPointFromJson(value: unknown): StrategicPoint {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.x) ||
    !Number.isInteger(value.y) ||
    !STRATEGIC_TYPES.includes(value.type as StrategicType) ||
    typeof value.value !== 'number' ||
    !Number.isFinite(value.value)
  ) {
    throw new SaveFormatError('the header has a malformed strategic point')
  }
  return {
    x: value.x as number,
    y: value.y as number,
    type: value.type as StrategicType,
    value: value.value
  }
}

/** Decode a save into a validated world. Throws `SaveFormatError` for anything that is not one. */
export function decodeWorld(bytes: Uint8Array): World {
  if (!HOST_IS_LITTLE_ENDIAN) throw new Error('loading needs a little-endian host')
  try {
    return decode(bytes)
  } catch (error) {
    if (error instanceof SaveFormatError) throw error
    // Anything else (a RangeError from validation, a malformed value) is also "not a good save".
    throw new SaveFormatError(error instanceof Error ? error.message : String(error))
  }
}

function decode(bytes: Uint8Array): World {
  if (bytes.length < PREAMBLE) throw new SaveFormatError('the file is too short to be a save')
  for (let i = 0; i < MAGIC.length; i += 1) {
    if (bytes[i] !== MAGIC[i]) throw new SaveFormatError('the file is not a Sovereign save')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint32(4, false)
  if (version !== SAVE_FORMAT_VERSION) {
    throw new SaveFormatError(`unsupported save format version ${version}`)
  }
  const headerLength = view.getUint32(8, false)
  if (headerLength > bytes.length - PREAMBLE) {
    throw new SaveFormatError('the header length runs past the end of the file')
  }

  let header: unknown
  try {
    header = JSON.parse(utf8Decode(bytes.subarray(PREAMBLE, PREAMBLE + headerLength)))
  } catch {
    throw new SaveFormatError('the header is not valid JSON')
  }
  if (!isRecord(header)) throw new SaveFormatError('the header is not an object')
  for (const field of [
    'seed',
    'tick',
    'width',
    'height',
    'seaLevel',
    'config',
    'strategicPoints',
    'hubs',
    'routes',
    'nations'
  ]) {
    if (header[field] === undefined) throw new SaveFormatError(`the header is missing "${field}"`)
  }
  if (!isRecord(header.config)) throw new SaveFormatError('the header config is not an object')

  const seed = header.seed
  const tick = header.tick
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new SaveFormatError('the header has a malformed seed')
  }
  if (typeof tick !== 'number' || !Number.isSafeInteger(tick) || tick < 0) {
    throw new SaveFormatError('the header has a malformed tick')
  }
  const seaLevel = header.seaLevel
  if (typeof seaLevel !== 'number' || !Number.isFinite(seaLevel)) {
    throw new SaveFormatError('the header has a malformed seaLevel')
  }

  // The config bounds every allocation below, so check it before sizing anything.
  const config: WorldConfig = resolveWorldConfig(header.config as WorldConfigOverrides)
  assertValidWorldConfig(config)
  const { width, height } = config.map
  if (header.width !== width) {
    throw new SaveFormatError(
      `the header width ${String(header.width)} does not match the config width ${width}`
    )
  }
  if (header.height !== height) {
    throw new SaveFormatError(
      `the header height ${String(header.height)} does not match the config height ${height}`
    )
  }

  const layersAt = PREAMBLE + headerLength
  const expected = layerBytes(width, height)
  if (bytes.length - layersAt < expected + 4) {
    throw new SaveFormatError(
      `the tile layers have the wrong size: expected at least ${expected + 4} bytes, found ${bytes.length - layersAt}`
    )
  }

  if (!Array.isArray(header.nations)) throw new SaveFormatError('the header nations is not a list')
  if (!Array.isArray(header.strategicPoints)) {
    throw new SaveFormatError('the header strategicPoints is not a list')
  }
  if (!Array.isArray(header.hubs)) throw new SaveFormatError('the header hubs is not a list')
  if (!Array.isArray(header.routes)) throw new SaveFormatError('the header routes is not a list')
  const nations = header.nations.map((n, i) => nationFromJson(n, i))
  const entities = entitiesFromJson(header.entities)
  let stockpiles: Stockpiles
  try {
    stockpiles = Stockpiles.fromJson(header.stockpiles)
  } catch (error) {
    throw new SaveFormatError(
      `the header stockpiles are malformed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const strategicPoints = header.strategicPoints.map(strategicPointFromJson)
  const hubs = header.hubs.map(hubFromJson)
  const routes = header.routes.map(routeFromJson)

  const tiles = width * height
  let at = layersAt
  const floatLayer = (): Float32Array => {
    const copy = bytes.slice(at, at + tiles * 4)
    at += tiles * 4
    return new Float32Array(copy.buffer)
  }
  const byteLayer = (): Uint8Array => {
    const copy = bytes.slice(at, at + tiles)
    at += tiles
    return copy
  }
  const elevation = floatLayer()
  const temperature = floatLayer()
  const humidity = floatLayer()
  const biomeIds = byteLayer()
  const riverMask = byteLayer()
  const riverWidth = byteLayer()
  const ownership = byteLayer()
  let nodes: NodeStore
  try {
    nodes = NodeStore.fromBytes(bytes.slice(at), tiles)
  } catch (error) {
    throw new SaveFormatError(
      `the resource nodes are malformed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const resources: ResourceSlots = nodes.slots

  const terrain: TerrainFields = {
    width,
    height,
    seaLevel,
    elevation,
    temperature,
    humidity,
    biomeIds,
    riverMask,
    riverWidth,
    resources,
    strategicPoints,
    hubs,
    routes
  }
  return World.restore({
    seed,
    config,
    tick,
    terrain,
    nations,
    ownership,
    entities,
    nodes,
    stockpiles
  })
}
