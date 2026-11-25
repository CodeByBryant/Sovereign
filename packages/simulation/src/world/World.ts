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
  EntityKind,
  NO_OWNER,
  UnitState,
  RESOURCE_CATALOG,
  resourceDef,
  type NationProfile,
  type NationSnapshot,
  type TerrainFields,
  type UnitSnapshot,
  type WorldSnapshot
} from '@sovereign/contracts'
import { SimulationClock } from '../clock/SimulationClock'
import { COLUMN_NAMES, EntityStore } from '../entities/EntityStore'
import { claimableProvinces } from '../nations/claimable'
import { deriveStats } from '../nations/derive'
import { Nation } from '../nations/Nation'
import {
  combineProfile,
  refreshProvinceFacts,
  type ProvinceFacts
} from '../nations/provinceProfile'
import { spawnNations } from '../nations/NationSpawner'
import { normalizeSeed } from '../random/seed'
import { ExpansionSystem } from '../systems/ExpansionSystem'
import { WanderSystem } from '../systems/WanderSystem'
import type { CostGrid } from '../terrain/cost'
import { Pathfinder, RouteCache } from '../terrain/pathing'
import { stateHasher } from '../serialization/hash'
import { generateTerrain } from '../terrain/pipeline'
import { NO_PROVINCE, type ProvinceMap } from '../terrain/provinces'
import { costGridOf } from './costGrid'
import { buildProvinceLayer, type ProvinceLayer } from './provinceLayer'
import { NodeStore } from '../resources/NodeStore'
import { Stockpiles } from './Stockpiles'
import { buildRegrowthTable, ResourceStocks, type ResourceLayerName } from './ResourceStocks'
import { WorldMap } from './WorldMap'

/** The fields of a nation's profile, in the order they are hashed, saved and validated. */
export const PROFILE_FIELDS = [
  'area',
  'food',
  'timber',
  'stone',
  'horses',
  'metals',
  'luxuries',
  'diversity',
  'coast',
  'river',
  'highGround',
  'defence',
  'traffic',
  'contacts'
] as const satisfies ReadonlyArray<keyof NationProfile>

/** Ownership byte for a tile that belongs to no nation. */
export const UNCLAIMED = 255

/** The index of the nation that holds each province, from the nations' own lists (the first holder wins). */
function ownersOf(nations: readonly Nation[], provinceCount: number): Uint8Array {
  const owners = new Uint8Array(provinceCount).fill(UNCLAIMED)
  nations.forEach((nation, index) => {
    for (const province of nation.provinces) {
      if (Number.isInteger(province) && province >= 0 && province < provinceCount) {
        if (owners[province] === UNCLAIMED) owners[province] = index
      }
    }
  })
  return owners
}

/** Mark every tile of a province as owned by the nation with this index. */
function writeOwner(
  ownership: Uint8Array,
  map: ProvinceMap,
  province: number,
  owner: number
): void {
  for (let k = map.start[province]; k < map.start[province + 1]; k += 1) {
    ownership[map.tiles[k]] = owner
  }
}

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
  /** The units, when restoring a world that has them (a new world is given its own). */
  entities?: EntityStore
  /**
   * The resource nodes, when restoring a world that has them: their slot arrays must be the terrain's
   * `resources`. A new world makes its own from the terrain.
   */
  nodes?: NodeStore
  /** What each hall holds, when restoring a world that has halls (a new world opens its own). */
  stockpiles?: Stockpiles
}

export class World {
  /** The engine seed (a uint32). */
  readonly seed: number
  readonly config: WorldConfig
  readonly clock: SimulationClock
  readonly terrain: TerrainFields
  readonly map: WorldMap
  readonly nations: readonly Nation[]
  /** The land cut into provinces, the units nations own (derived from the terrain; never saved). */
  readonly provinces: ProvinceMap
  /** What each province is like; a nation's profile is the sum over its provinces. */
  readonly provinceFacts: ProvinceFacts
  /** The index of the nation that owns each province, or {@link UNCLAIMED}. */
  readonly provinceOwner: Uint8Array
  /** 1 for a province that can be owned, 0 for one that is mostly ice. */
  readonly claimable: Uint8Array
  /** Provinces whose land changed (a stock was drawn down or regrew) and must be measured again. */
  private readonly dirtyProvinces = new Set<number>()
  /** Nations growing into free provinces (derived state: its borders are rebuilt from the land held). */
  private readonly expansion: ExpansionSystem
  /** Every resource deposit as a row; the tile slot arrays in `terrain.resources` are its write-through views. */
  readonly nodes: NodeStore
  /** Drawing resources down and letting the renewable ones grow back (it works through the node store). */
  private readonly stocks: ResourceStocks
  /** Everything that lives and acts: villagers and the halls they belong to (saved and hashed). */
  readonly entities: EntityStore
  /** What each hall holds (saved and hashed): villagers drop what they gather here. */
  readonly stockpiles: Stockpiles
  /** The villagers' behaviour: they rest, walk and rest (derived timers: rebuilt from the rows). */
  private readonly wander: WanderSystem
  /** The cost of crossing the ground, on cells (derived; never saved). */
  private readonly grid: CostGrid

  private constructor(state: WorldState, layer: ProvinceLayer, grid: CostGrid) {
    this.seed = state.seed
    this.config = state.config
    this.clock = new SimulationClock(state.config.timestep, state.tick)
    this.terrain = state.terrain
    this.nations = state.nations
    this.provinces = layer.map
    this.provinceFacts = layer.facts
    this.provinceOwner = ownersOf(state.nations, layer.map.count)
    this.claimable = claimableProvinces(layer.map, state.terrain.biomeIds)
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
    if (state.nodes !== undefined && state.nodes.slots !== state.terrain.resources) {
      throw new RangeError('the nodes and the terrain must share the resource slot arrays')
    }
    this.nodes = state.nodes ?? NodeStore.fromSlots(state.terrain.resources)
    this.stocks = new ResourceStocks(
      this.nodes,
      buildRegrowthTable(state.config.resources.regrowth),
      (tile) => this.noteStockChange(tile)
    )
    this.expansion = new ExpansionSystem({
      nations: state.nations,
      provinces: layer.map,
      facts: layer.facts,
      claimable: this.claimable,
      provinceOwner: this.provinceOwner,
      ownership: state.ownership,
      config: state.config.expansion,
      timestep: state.config.timestep
    })
    this.grid = grid
    this.entities = state.entities ?? new EntityStore()
    this.stockpiles = state.stockpiles ?? new Stockpiles()
    this.wander = new WanderSystem({
      entities: this.entities,
      grid,
      routes: new RouteCache(new Pathfinder(grid)),
      config: state.config.units,
      seed: state.seed,
      width: state.terrain.width,
      height: state.terrain.height,
      land: (x, y) => state.terrain.elevation[y * state.terrain.width + x]! > state.terrain.seaLevel
    })
    if (state.entities !== undefined) this.wander.rebuild()
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
      routes: config.routes,
      resources: config.resources,
      minLandRatio: config.map.minLandRatio
    })

    const grid = costGridOf(terrain, config)
    const layer = buildProvinceLayer(terrain, config, grid)

    // The nations are placed on the world as generated, so use its effective sea level.
    const { nations } = spawnNations({
      width: terrain.width,
      biomeIds: terrain.biomeIds,
      hubs: terrain.hubs,
      routes: terrain.routes,
      provinces: layer,
      count: config.nations.count,
      seed,
      minSpacing: config.nations.minSpacing,
      startArea: config.nations.startArea
    })

    const ownership = new Uint8Array(terrain.width * terrain.height).fill(UNCLAIMED)
    nations.forEach((nation, index) => {
      for (const province of nation.provinces) writeOwner(ownership, layer.map, province, index)
    })

    const world = new World({ seed, config, tick: 0, terrain, nations, ownership }, layer, grid)
    world.spawnStartingUnits()
    return world
  }

  /**
   * Rebuild a world from its parts (a decoded save). The parts are checked with `validate()`; a
   * world that is not internally consistent is rejected.
   */
  static restore(state: WorldState): World {
    assertValidWorldConfig(state.config)
    const grid = costGridOf(state.terrain, state.config)
    const world = new World(state, buildProvinceLayer(state.terrain, state.config, grid), grid)
    const problems = world.validate()
    if (problems.length > 0) {
      throw new RangeError(`restored world is not valid:\n  ${problems.join('\n  ')}`)
    }
    return world
  }

  /** Advance the simulation by one tick. */
  step(): void {
    // Systems run here, as a flat, ordered list of calls.
    this.expansion.step(this.clock.tick)
    this.wander.step(this.clock.tick)
    this.stocks.regrow(this.clock.tick)
    this.refreshDirtyProvinces()
    this.clock.advance()
  }

  /** How many provinces nations have claimed since this world object was made (not part of its state). */
  get expansionClaims(): number {
    return this.expansion.claims
  }

  /** True when no nation has a free province left to claim: the borders will not change again. */
  get saturated(): boolean {
    return this.expansion.saturated
  }

  /**
   * Take up to `amount` units from the resource in a tile's slot (`surface` or `ground`). Returns
   * what was actually taken: less than asked if the stock ran out, 0 if the slot is empty. The
   * economy and the god tools draw resources down through this.
   */
  extractResource(layer: ResourceLayerName, tile: number, amount: number): number {
    const taken = this.stocks.extract(layer, tile, amount)
    this.refreshDirtyProvinces()
    return taken
  }

  /**
   * A tile's stock changed: the province it is in changes, and so do those beside it when it is water (a
   * coast's food counts the fishery next to it).
   */
  private noteStockChange(tile: number): void {
    const { width, height } = this.terrain
    const provinceOf = this.provinces.provinceOf
    const x = tile % width
    const y = (tile - x) / width
    const own = provinceOf[tile] as number
    if (own !== NO_PROVINCE) this.dirtyProvinces.add(own)
    for (const n of [
      x > 0 ? tile - 1 : -1,
      x < width - 1 ? tile + 1 : -1,
      y > 0 ? tile - width : -1,
      y < height - 1 ? tile + width : -1
    ]) {
      if (n < 0) continue
      const province = provinceOf[n] as number
      if (province !== NO_PROVINCE) this.dirtyProvinces.add(province)
    }
  }

  /** Measure the changed provinces again, and re-sum the profile and re-derive the stats of whoever holds them. */
  private refreshDirtyProvinces(): void {
    if (this.dirtyProvinces.size === 0) return
    const t = this.terrain
    const input = {
      width: t.width,
      height: t.height,
      seaLevel: t.seaLevel,
      elevation: t.elevation,
      biomeIds: t.biomeIds,
      riverMask: t.riverMask,
      resources: t.resources,
      provinces: this.provinces,
      strategicPoints: t.strategicPoints,
      routes: t.routes
    }
    const owners = new Set<number>()
    for (const province of this.dirtyProvinces) {
      refreshProvinceFacts(this.provinceFacts, input, province)
      const owner = this.provinceOwner[province] as number
      if (owner !== UNCLAIMED) owners.add(owner)
    }
    this.dirtyProvinces.clear()
    for (const index of owners) {
      const nation = this.nations[index] as Nation
      nation.profile = combineProfile(this.provinceFacts, nation.provinces, nation.profile.contacts)
      nation.stats = deriveStats(nation.profile)
    }
  }

  /** Each nation starts with a hall at its capital, and its villagers resting there. */
  private spawnStartingUnits(): void {
    const { width } = this.terrain
    const perNation = this.config.units.perNation
    this.nations.forEach((nation, index) => {
      const x = nation.capital % width
      const y = (nation.capital - x) / width
      const home = this.cellOf(x, y)
      const hall = this.entities.spawn({ kind: EntityKind.Hall, x, y, owner: index, home })
      this.stockpiles.open(hall)
      for (let k = 0; k < perNation; k += 1) {
        this.wander.spawnVillager(x, y, index, home, 0, hall + 1)
      }
    })
  }

  private cellOf(x: number, y: number): number {
    return Math.floor(y / this.grid.cell) * this.grid.cols + Math.floor(x / this.grid.cell)
  }

  /** Where every living unit is now (between where it set off and where it is going, if it is walking). */
  unitPositions(): UnitSnapshot {
    let count = 0
    for (const id of this.entities.ids())
      if (this.entities.kind[id] === EntityKind.Villager) count += 1
    const snapshot: UnitSnapshot = {
      tick: this.clock.tick,
      count,
      id: new Uint32Array(count),
      kind: new Uint8Array(count),
      owner: new Uint8Array(count),
      x: new Float32Array(count),
      y: new Float32Array(count)
    }
    let i = 0
    for (const id of this.entities.ids()) {
      if (this.entities.kind[id] !== EntityKind.Villager) continue
      const [x, y] = this.wander.positionAt(id, this.clock.tick)
      snapshot.id[i] = id
      snapshot.kind[i] = this.entities.kind[id] as number
      snapshot.owner[i] = this.entities.owner[id] as number
      snapshot.x[i] = x
      snapshot.y[i] = y
      i += 1
    }
    return snapshot
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
   * "Version 5"). Equal hashes mean equal worlds on any engine.
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
    h.writeUint8Array(this.map.ownership)

    // the resource deposits (hash schema 6), as rows rather than the six tile layers they mirror
    h.writeUint8Array(this.nodes.kind)
    h.writeUint8Array(this.nodes.stock)
    h.writeUint8Array(this.nodes.richness)
    h.writeUint32Array(this.nodes.tile)

    // the province cut is derived, but its fingerprint catches an engine that cuts it differently
    h.writeUint32(this.provinces.count)
    for (let p = 0; p < this.provinces.count; p += 1) {
      h.writeUint32(this.provinces.area[p] as number)
      h.writeUint32(this.provinces.seed[p] as number)
    }

    h.writeUint32(t.strategicPoints.length)
    for (const p of t.strategicPoints) {
      h.writeUint32(p.x)
      h.writeUint32(p.y)
      h.writeString(p.type)
      h.writeFloat64(p.value)
    }

    h.writeUint32(t.hubs.length)
    for (const hub of t.hubs) {
      h.writeUint32(hub.x)
      h.writeUint32(hub.y)
      h.writeFloat64(hub.weight)
    }

    h.writeUint32(t.routes.length)
    for (const route of t.routes) {
      h.writeUint32(route.from)
      h.writeUint32(route.to)
      h.writeFloat64(route.cost)
      h.writeFloat64(route.traffic)
      h.writeUint32(route.path.length)
      for (const v of route.path) h.writeUint32(v)
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
      for (const key of PROFILE_FIELDS) h.writeFloat64(n.profile[key])
      h.writeFloat64(n.expansionPoints)
      h.writeUint32(n.provinces.size)
      for (const province of n.provinces) h.writeUint32(province)
    }

    // the villagers and halls (hash schema 5): every column of every row, empty rows included
    const e = this.entities
    const rows = e.highWater
    h.writeUint32(rows)
    for (const name of COLUMN_NAMES) {
      const column = e[name]
      if (column instanceof Uint8Array) {
        h.writeUint8Array(column.subarray(0, rows))
      } else {
        for (let i = 0; i < rows; i += 1) h.writeUint32((column[i] as number) >>> 0)
      }
    }

    // what each hall holds (hash schema 6): the halls with a stockpile, lowest row first, then their counters
    const halls = this.stockpiles.halls()
    h.writeUint32(halls.length)
    for (const hall of halls) {
      h.writeUint32(hall)
      h.writeUint32Array(this.stockpiles.counts(hall))
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
      profile: { ...n.profile },
      area: n.profile.area,
      provinceCount: n.provinces.size
    }))
    return {
      seed: this.seed,
      tick: this.clock.tick,
      time: this.clock.time,
      timestep: this.clock.deltaTime,
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
    this.validateNodes(problems)

    for (const p of t.strategicPoints) {
      if (p.x < 0 || p.x >= t.width || p.y < 0 || p.y >= t.height) {
        problems.push(`strategic point (${p.x}, ${p.y}) is outside the map`)
      }
      if (!Number.isInteger(p.value) || p.value < 1 || p.value > 10) {
        problems.push(`strategic point (${p.x}, ${p.y}) has the value ${p.value}, not 1 to 10`)
      }
    }
    this.validateRoutes(problems)

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

    // who holds each province, worked out from the nations' own lists
    const count = this.provinces.count
    const holder = new Int32Array(count).fill(-1)
    const ids = new Set<string>()
    this.nations.forEach((nation, index) => {
      if (ids.has(nation.id)) problems.push(`the nation id ${nation.id} is used twice`)
      ids.add(nation.id)

      let sound = true
      for (const province of nation.provinces) {
        if (!Number.isInteger(province) || province < 0 || province >= count) {
          problems.push(`${nation.id} owns the province ${province}, which is not on the map`)
          sound = false
          break
        }
        if (holder[province] >= 0) {
          problems.push(
            `the province ${province} is held by both ${this.nations[holder[province] as number]?.id} and ${nation.id}`
          )
          sound = false
          break
        }
        holder[province] = index
      }

      const capitalProvince = this.provinces.provinceOf[nation.capital]
      if (
        !Number.isInteger(nation.capital) ||
        nation.capital < 0 ||
        nation.capital >= size ||
        capitalProvince === NO_PROVINCE ||
        !nation.provinces.has(capitalProvince as number)
      ) {
        problems.push(`the capital of ${nation.id} is not in one of its provinces`)
      }

      if (!(Number.isFinite(nation.expansionPoints) && nation.expansionPoints >= 0)) {
        problems.push(`${nation.id} has expansion points that are not a finite number of 0 or more`)
      }

      if (!sound) return
      const profile = combineProfile(this.provinceFacts, nation.provinces, nation.profile.contacts)
      if (PROFILE_FIELDS.some((key) => profile[key] !== nation.profile[key])) {
        problems.push(`the profile of ${nation.id} is not the sum of its provinces`)
      }
      const stats = deriveStats(nation.profile)
      if (
        stats.population !== nation.stats.population ||
        stats.military !== nation.stats.military ||
        stats.economy !== nation.stats.economy ||
        stats.diplomacy !== nation.stats.diplomacy
      ) {
        problems.push(`the stats of ${nation.id} are not those of its profile`)
      }
    })

    // the ownership layer says, tile by tile, who holds the province the tile is in
    const provinceOf = this.provinces.provinceOf
    if (provinceOf.length === ownership.length) {
      for (let i = 0; i < ownership.length; i += 1) {
        const province = provinceOf[i] as number
        const expected =
          province === NO_PROVINCE || holder[province] === -1
            ? UNCLAIMED
            : (holder[province] as number)
        if (ownership[i] !== expected) {
          problems.push(
            `ownership at tile ${i} is ${ownership[i]}, but its province ${province === NO_PROVINCE ? '(none)' : province} is held by ${expected === UNCLAIMED ? 'nobody' : expected}`
          )
          break
        }
      }
    }

    this.validateEntities(problems)

    return problems
  }

  /** The units: what they are, where they stand, where they are going, when they next act. */
  private validateEntities(problems: string[]): void {
    const e = this.entities
    const t = this.terrain
    const cells = this.grid.cols * this.grid.rows
    const landCell = (c: number): boolean =>
      Number.isInteger(c) && c >= 0 && c < cells && this.grid.land[c] === 1
    // a reference to a hall is its row id plus one (0 is none)
    const isHallRef = (ref: number): boolean =>
      e.alive(ref - 1) && e.kind[ref - 1] === EntityKind.Hall
    for (let id = 0; id < e.highWater; id += 1) {
      const kind = e.kind[id] as number
      if (kind === EntityKind.None) {
        const zeroed =
          e.x[id] === 0 &&
          e.y[id] === 0 &&
          e.owner[id] === NO_OWNER &&
          e.state[id] === 0 &&
          e.home[id] === 0 &&
          e.target[id] === 0 &&
          e.wake[id] === 0 &&
          e.legStart[id] === 0 &&
          e.legEnd[id] === 0 &&
          e.hall[id] === 0 &&
          e.goal[id] === 0 &&
          e.carriedType[id] === 0 &&
          e.carriedCount[id] === 0
        if (!zeroed) problems.push(`entity row ${id} is empty but not zeroed`)
        continue
      }
      if (kind !== EntityKind.Villager && kind !== EntityKind.Hall) {
        problems.push(`unit ${id} has the kind ${kind}, which is not a kind of unit`)
        continue
      }
      const noun = kind === EntityKind.Hall ? 'hall' : 'unit'
      const x = e.x[id] as number
      const y = e.y[id] as number
      if (x >= t.width || y >= t.height) {
        problems.push(`${noun} ${id} is outside the map at (${x}, ${y})`)
      } else if ((t.elevation[y * t.width + x] as number) <= t.seaLevel) {
        problems.push(`${noun} ${id} is not on land at (${x}, ${y})`)
      }
      const owner = e.owner[id] as number
      if (owner !== NO_OWNER && owner >= this.nations.length) {
        problems.push(`${noun} ${id} has the owner ${owner}, which names no nation`)
      }
      if (!landCell(e.home[id] as number)) {
        problems.push(`${noun} ${id} has the home ${e.home[id]}, which is not a land cell`)
      }
      if (kind === EntityKind.Hall) {
        const still =
          e.state[id] === UnitState.Rest &&
          e.target[id] === 0 &&
          e.wake[id] === 0 &&
          e.legStart[id] === 0 &&
          e.legEnd[id] === 0 &&
          e.hall[id] === 0 &&
          e.goal[id] === 0 &&
          e.carriedType[id] === 0 &&
          e.carriedCount[id] === 0
        if (!still) problems.push(`hall ${id} is not standing still and empty-handed`)
        if (!this.stockpiles.has(id)) problems.push(`hall ${id} has no stockpile`)
        continue
      }
      const hall = e.hall[id] as number
      if (hall !== 0 && !isHallRef(hall)) {
        problems.push(`unit ${id} belongs to the hall row ${hall - 1}, which is not a hall`)
      }
      const goal = e.goal[id] as number
      if (goal > this.nodes.count) {
        problems.push(`unit ${id} is after the node ${goal - 1}, which does not exist`)
      }
      const carriedType = e.carriedType[id] as number
      const carriedCount = e.carriedCount[id] as number
      if (carriedType > RESOURCE_CATALOG.length || (carriedType === 0) !== (carriedCount === 0)) {
        problems.push(
          `unit ${id} carries ${carriedCount} of the resource ${carriedType}, which is not a stack`
        )
      }
      const state = e.state[id] as number
      if (state === UnitState.Walk) {
        const target = e.target[id] as number
        const start = e.legStart[id] as number
        const end = e.legEnd[id] as number
        if (!landCell(target))
          problems.push(`unit ${id} is heading for ${target}, which is not a land cell`)
        if (!(end > start))
          problems.push(
            `unit ${id} has a leg that ends at ${end}, no later than it starts at ${start}`
          )
        if (e.wake[id] !== end)
          problems.push(`unit ${id} wakes at ${e.wake[id]} but its leg ends at ${end}`)
        if (start > this.clock.tick)
          problems.push(`unit ${id} set off at ${start}, which is in the future`)
      } else if (state === UnitState.Rest) {
        if ((e.wake[id] as number) < this.clock.tick) {
          problems.push(`unit ${id} has a wake-up at tick ${e.wake[id]}, which is already past`)
        }
      } else {
        problems.push(`unit ${id} has the state ${state}, which is not resting or walking`)
      }
    }
    for (const hall of this.stockpiles.halls()) {
      if (!isHallRef(hall + 1))
        problems.push(`there is a stockpile for ${hall}, which is not a hall`)
    }
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

  /** The node store and the tile slot arrays that mirror it must say the same thing. */
  private validateNodes(problems: string[]): void {
    const size = this.terrain.width * this.terrain.height
    const nodes = this.nodes
    let filled = 0
    for (const layer of ['surface', 'ground'] as const) {
      const slot = this.terrain.resources[layer]
      if (slot.type.length !== size) return // already reported
      for (let i = 0; i < size; i += 1) if (slot.type[i] !== 0) filled += 1
    }
    if (filled !== nodes.count) {
      problems.push(
        `the slots hold ${filled} resources but the node store has ${nodes.count} nodes`
      )
      return
    }
    for (let id = 0; id < nodes.count; id += 1) {
      const tile = nodes.tile[id] as number
      const slot = this.terrain.resources[nodes.layerOf(id)]
      if (
        slot.type[tile] !== nodes.kind[id] ||
        slot.stock[tile] !== nodes.stock[id] ||
        slot.richness[tile] !== nodes.richness[id]
      ) {
        problems.push(
          `node ${id} on tile ${tile} disagrees with the ${nodes.layerOf(id)} slot there`
        )
        return
      }
    }
  }

  /** The hubs and the routes between them: positions, references, weights and costs. */
  private validateRoutes(problems: string[]): void {
    const t = this.terrain
    t.hubs.forEach((hub, i) => {
      if (
        !Number.isInteger(hub.x) ||
        !Number.isInteger(hub.y) ||
        hub.x < 0 ||
        hub.x >= t.width ||
        hub.y < 0 ||
        hub.y >= t.height
      ) {
        problems.push(`hub ${i} (${hub.x}, ${hub.y}) is outside the map`)
      }
      if (!(hub.weight > 0 && hub.weight <= 1)) {
        problems.push(`hub ${i} has the weight ${hub.weight}, not above 0 and at most 1`)
      }
    })
    t.routes.forEach((route, i) => {
      if (
        !Number.isInteger(route.from) ||
        !Number.isInteger(route.to) ||
        route.from < 0 ||
        route.to >= t.hubs.length ||
        route.from >= route.to
      ) {
        problems.push(
          `route ${i} joins hubs ${route.from} and ${route.to}, which are not two hubs in order`
        )
      }
      if (
        !(Number.isFinite(route.cost) && route.cost >= 0) ||
        !(Number.isFinite(route.traffic) && route.traffic >= 0)
      ) {
        problems.push(`route ${i} has a cost or traffic that is not a finite number of 0 or more`)
      }
      if (route.path.length < 4 || route.path.length % 2 !== 0) {
        problems.push(
          `route ${i} has ${route.path.length} path values, not an even number of at least 4`
        )
        return
      }
      for (let k = 0; k < route.path.length; k += 2) {
        const x = route.path[k] as number
        const y = route.path[k + 1] as number
        if (
          !Number.isInteger(x) ||
          !Number.isInteger(y) ||
          x < 0 ||
          x >= t.width ||
          y < 0 ||
          y >= t.height
        ) {
          problems.push(`route ${i} passes the tile (${x}, ${y}), outside the map`)
          return
        }
      }
    })
  }
}
