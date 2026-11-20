/**
 * @module World
 * @description A simulated world: the seed, the resolved configuration, the generated terrain, the
 * nations, the tile map and the clock. `World` is the only thing that orders the simulation: when
 * systems exist they run from `step()`, in an explicit list, and mutate only what they own.
 */
import {
  assertValidWorldConfig,
  resolveWorldConfig,
  type TerrainConfig,
  type WorldConfig,
  type WorldConfigOverrides
} from '@sovereign/config'
import {
  BIOME_KEYS,
  RESOURCE_CATALOG,
  resourceDef,
  type NationSnapshot,
  type TerrainFields,
  type WorldSnapshot
} from '@sovereign/contracts'
import { SimulationClock } from '../clock/SimulationClock'
import { Nation } from '../nations/Nation'
import { spawnNations } from '../nations/NationSpawner'
import { normalizeSeed } from '../random/seed'
import { stateHasher } from '../serialization/hash'
import { generateTerrain } from '../terrain/pipeline'
import { buildRegrowthTable, ResourceStocks, type ResourceLayerName } from './ResourceStocks'
import { WorldMap } from './WorldMap'

/** Ownership byte for a tile that belongs to no nation. */
export const UNCLAIMED = 255

export interface WorldOptions {
  /** A number, or any text; see `normalizeSeed`. */
  seed: number | string
  /** Per-section overrides of the default configuration. */
  config?: WorldConfigOverrides
}

/** Everything that defines a world; used to rebuild one from a save. */
export interface WorldState {
  /** The engine seed, already normalized. */
  seed: number
  config: WorldConfig
  tick: number
  terrain: TerrainFields
  nations: Nation[]
  /** One byte per tile: the index of the owning nation, or {@link UNCLAIMED}. */
  ownership: Uint8Array
}

export class World {
  /** The engine seed (a uint32). */
  readonly seed: number
  readonly config: WorldConfig
  readonly clock: SimulationClock
  readonly terrain: TerrainFields
  readonly map: WorldMap
  readonly nations: readonly Nation[]
  /** Drawing resources down and letting the renewable ones grow back (it works on `terrain.resources`). */
  private readonly stocks: ResourceStocks

  private constructor(state: WorldState) {
    this.seed = state.seed
    this.config = state.config
    this.clock = new SimulationClock(state.config.timestep, state.tick)
    this.terrain = state.terrain
    this.nations = state.nations
    this.map = new WorldMap({
      width: state.terrain.width,
      height: state.terrain.height,
      seaLevel: state.terrain.seaLevel,
      elevation: state.terrain.elevation,
      temperature: state.terrain.temperature,
      humidity: state.terrain.humidity,
      biomeIds: state.terrain.biomeIds,
      riverMask: state.terrain.riverMask,
      resources: state.terrain.resources,
      ownership: state.ownership
    })
    this.stocks = new ResourceStocks(
      state.terrain.resources,
      buildRegrowthTable(state.config.resources.regrowth)
    )
  }

  /** Generate a new world: terrain first, then nations placed on it. */
  static create(options: WorldOptions): World {
    const seed = normalizeSeed(options.seed)
    const config = resolveWorldConfig(options.config)
    assertValidWorldConfig(config)

    const terrainConfig: TerrainConfig = {
      width: config.map.width,
      height: config.map.height,
      seaLevel: config.map.seaLevel,
      islandMode: config.map.islandMode,
      ...config.elevation
    }
    const terrain = generateTerrain({
      seed,
      terrain: terrainConfig,
      temperature: config.temperature,
      humidity: config.humidity,
      biomeNoise: config.biomeNoise,
      rivers: config.rivers,
      biomes: config.biomes,
      strategic: config.strategic,
      resources: config.resources,
      minLandRatio: config.map.minLandRatio
    })

    // The nations are placed on the world as generated, so use its effective sea level.
    const { nations, ownerMap } = spawnNations(
      terrain.elevation,
      terrain.biomeIds,
      terrain.riverMask,
      terrain.resources,
      { ...terrainConfig, seaLevel: terrain.seaLevel },
      config.nations.count,
      seed,
      config.nations.minSpacing
    )

    const indexOf = new Map<string, number>()
    nations.forEach((nation, index) => indexOf.set(nation.id, index))
    const ownership = new Uint8Array(terrain.width * terrain.height).fill(UNCLAIMED)
    for (let i = 0; i < ownerMap.length; i += 1) {
      const owner = ownerMap[i] as string
      if (owner !== '') ownership[i] = indexOf.get(owner) as number
    }

    return new World({ seed, config, tick: 0, terrain, nations, ownership })
  }

  /**
   * Rebuild a world from its parts (a decoded save). The parts are checked with `validate()`; a
   * world that is not internally consistent is rejected.
   */
  static restore(state: WorldState): World {
    assertValidWorldConfig(state.config)
    const world = new World(state)
    const problems = world.validate()
    if (problems.length > 0) {
      throw new RangeError(`restored world is not valid:\n  ${problems.join('\n  ')}`)
    }
    return world
  }

  /** Advance the simulation by one tick. */
  step(): void {
    // Systems run here, as a flat, ordered list of calls.
    this.stocks.regrow(this.clock.tick)
    this.clock.advance()
  }

  /**
   * Take up to `amount` units from the resource in a tile's slot (`surface` or `ground`). Returns
   * what was actually taken: less than asked if the stock ran out, 0 if the slot is empty. The
   * economy and the god tools draw resources down through this.
   */
  extractResource(layer: ResourceLayerName, tile: number, amount: number): number {
    return this.stocks.extract(layer, tile, amount)
  }

  /** Advance the simulation by `ticks` ticks. */
  run(ticks: number): void {
    if (!Number.isSafeInteger(ticks) || ticks < 0) {
      throw new RangeError('ticks must be a non-negative integer')
    }
    for (let i = 0; i < ticks; i += 1) this.step()
  }

  /**
   * A 128-bit fingerprint of the simulation state (see docs/simulation/determinism.md, section 7.3,
   * "Version 2"). Equal hashes mean equal worlds on any engine.
   */
  stateHash(): string {
    const h = stateHasher()
    const t = this.terrain

    h.writeUint32(this.seed)
    h.writeFloat64(this.clock.tick)
    h.writeFloat64(this.clock.deltaTime)
    h.writeUint32(t.width)
    h.writeUint32(t.height)
    h.writeFloat64(t.seaLevel)

    h.writeFloat32Array(t.elevation)
    h.writeFloat32Array(t.temperature)
    h.writeFloat32Array(t.humidity)
    h.writeUint8Array(t.biomeIds)
    h.writeUint8Array(t.riverMask)
    h.writeUint8Array(t.riverWidth)
    for (const layer of ['surface', 'ground'] as const) {
      h.writeUint8Array(t.resources[layer].type)
      h.writeUint8Array(t.resources[layer].richness)
      h.writeUint8Array(t.resources[layer].stock)
    }
    h.writeUint8Array(this.map.ownership)

    h.writeUint32(t.strategicPoints.length)
    for (const p of t.strategicPoints) {
      h.writeUint32(p.x)
      h.writeUint32(p.y)
      h.writeString(p.type)
      h.writeFloat64(p.value)
    }

    h.writeUint32(this.nations.length)
    for (const n of this.nations) {
      h.writeString(n.id)
      h.writeString(n.name)
      h.writeUint8(n.color[0])
      h.writeUint8(n.color[1])
      h.writeUint8(n.color[2])
      h.writeString(n.flag.type)
      for (const v of n.flag.background) h.writeFloat64(v)
      for (const v of n.flag.accent) h.writeFloat64(v)
      if (n.flag.detail === undefined) {
        h.writeUint8(0)
      } else {
        h.writeUint8(1)
        for (const v of n.flag.detail) h.writeFloat64(v)
      }
      h.writeString(n.government)
      h.writeFloat64(n.personality.aggression)
      h.writeFloat64(n.personality.expansionism)
      h.writeFloat64(n.personality.diplomacy)
      h.writeFloat64(n.personality.mercantilism)
      h.writeFloat64(n.personality.militarism)
      h.writeUint32(n.capital)
      h.writeFloat64(n.founded)
      h.writeFloat64(n.stats.population)
      h.writeFloat64(n.stats.military)
      h.writeFloat64(n.stats.economy)
      h.writeFloat64(n.stats.diplomacy)
      h.writeUint32(n.provinces.size)
      for (const tile of n.provinces) h.writeUint32(tile)
    }

    return h.digest()
  }

  /** Plain, JSON-safe data about the world for a host to display. Shares nothing with the engine. */
  snapshot(): WorldSnapshot {
    const nations: NationSnapshot[] = this.nations.map((n) => ({
      id: n.id,
      name: n.name,
      color: [n.color[0], n.color[1], n.color[2]],
      flag: {
        type: n.flag.type,
        background: [...n.flag.background],
        accent: [...n.flag.accent],
        ...(n.flag.detail === undefined ? {} : { detail: [...n.flag.detail] })
      } as NationSnapshot['flag'],
      government: n.government,
      personality: { ...n.personality },
      capital: n.capital,
      stats: { ...n.stats },
      area: n.provinces.size
    }))
    return {
      seed: this.seed,
      tick: this.clock.tick,
      time: this.clock.time,
      width: this.terrain.width,
      height: this.terrain.height,
      seaLevel: this.terrain.seaLevel,
      nations
    }
  }

  /** Every way in which the world is internally inconsistent; empty if it is sound. */
  validate(): string[] {
    const problems: string[] = []
    const t = this.terrain
    const size = t.width * t.height

    const checkFinite = (name: string, layer: Float32Array): void => {
      let bad = 0
      let first = -1
      for (let i = 0; i < layer.length; i += 1) {
        if (!Number.isFinite(layer[i])) {
          bad += 1
          if (first < 0) first = i
        }
      }
      if (bad > 0)
        problems.push(`${name} has ${bad} non-finite value(s), the first at tile ${first}`)
    }
    const checkRange = (name: string, layer: Uint8Array, max: number): void => {
      for (let i = 0; i < layer.length; i += 1) {
        if ((layer[i] as number) > max) {
          problems.push(`${name} has the value ${layer[i]} at tile ${i}, above the maximum ${max}`)
          return
        }
      }
    }

    for (const [name, layer] of [
      ['elevation', t.elevation],
      ['temperature', t.temperature],
      ['humidity', t.humidity]
    ] as const) {
      if (layer.length !== size)
        problems.push(`${name} has ${layer.length} values, expected ${size}`)
      else checkFinite(name, layer)
    }
    for (const [name, layer] of [
      ['biome ids', t.biomeIds],
      ['river mask', t.riverMask],
      ['river width', t.riverWidth],
      ['ownership', this.map.ownership]
    ] as const) {
      if (layer.length !== size)
        problems.push(`${name} has ${layer.length} values, expected ${size}`)
    }
    checkRange('biome ids', t.biomeIds, BIOME_KEYS.length - 1)
    checkRange('river mask', t.riverMask, 1)
    this.validateResources(problems)

    for (const p of t.strategicPoints) {
      if (p.x < 0 || p.x >= t.width || p.y < 0 || p.y >= t.height) {
        problems.push(`strategic point (${p.x}, ${p.y}) is outside the map`)
      }
    }

    if (this.nations.length > UNCLAIMED) {
      problems.push(
        `there are ${this.nations.length} nations, at most ${UNCLAIMED} fit the ownership layer`
      )
    }
    const ownership = this.map.ownership
    for (let i = 0; i < ownership.length; i += 1) {
      const owner = ownership[i] as number
      if (owner !== UNCLAIMED && owner >= this.nations.length) {
        problems.push(`ownership at tile ${i} is ${owner}, which names no nation`)
        break
      }
    }

    const ids = new Set<string>()
    this.nations.forEach((nation, index) => {
      if (ids.has(nation.id)) problems.push(`the nation id ${nation.id} is used twice`)
      ids.add(nation.id)
      if (!nation.provinces.has(nation.capital)) {
        problems.push(`the capital of ${nation.id} is not one of its tiles`)
      }
      for (const tile of nation.provinces) {
        if (!Number.isInteger(tile) || tile < 0 || tile >= size) {
          problems.push(`${nation.id} owns the tile ${tile}, which is outside the map`)
          break
        }
        if (ownership[tile] !== index) {
          problems.push(
            `${nation.id} owns tile ${tile} but the ownership layer says ${ownership[tile]}`
          )
          break
        }
      }
    })

    return problems
  }

  /** The two resource slots: array sizes, catalogue ids, the layer a resource lives in, and stocks. */
  private validateResources(problems: string[]): void {
    const size = this.terrain.width * this.terrain.height
    for (const layer of ['surface', 'ground'] as const) {
      const slot = this.terrain.resources[layer]
      let sized = true
      for (const [name, values] of [
        ['type', slot.type],
        ['richness', slot.richness],
        ['stock', slot.stock]
      ] as const) {
        if (values.length !== size) {
          problems.push(`${layer} ${name} has ${values.length} values, expected ${size}`)
          sized = false
        }
      }
      if (!sized) continue
      for (let i = 0; i < size; i += 1) {
        const type = slot.type[i] as number
        const richness = slot.richness[i] as number
        const stock = slot.stock[i] as number
        if (type === 0) {
          if (richness !== 0 || stock !== 0) {
            problems.push(
              `${layer} slot at tile ${i} holds no resource but has richness ${richness} and stock ${stock}`
            )
            break
          }
          continue
        }
        const def = resourceDef(type)
        if (def === undefined) {
          problems.push(
            `${layer} resource type ${type} at tile ${i} is not in the catalogue (1 to ${RESOURCE_CATALOG.length})`
          )
          break
        }
        if (def.layer !== layer) {
          problems.push(
            `${layer} slot at tile ${i} holds ${def.key}, which belongs to the ${def.layer} layer`
          )
          break
        }
        if (richness === 0) {
          problems.push(`${layer} slot at tile ${i} holds ${def.key} with no richness`)
          break
        }
        if (stock > richness) {
          problems.push(`${layer} stock ${stock} at tile ${i} is above its richness ${richness}`)
          break
        }
      }
    }
  }
}
