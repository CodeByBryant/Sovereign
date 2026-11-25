/**
 * @module ResourceStocks
 * @description Drawing resources down and letting renewable ones grow back. A node's stock is mutable
 * simulation state (hashed and saved); its richness, the potential it started with, is not.
 *
 * - `extract` / `extractNode` take up to an amount from a node and return what was actually taken.
 *   Villagers gather through them; so will god tools.
 * - `regrow(tick)` runs from `World.step()`. A renewable stock that has been drawn down regrows by its
 *   catalogue rate every `period` ticks, on the tick where `(tick + tile) % period === 0` so tiles do
 *   not all grow on the same tick, up to its richness. Ground resources (and any resource without a
 *   rate) never regrow.
 *
 * To stay cheap over hundreds of thousands of ticks only **drawn-down nodes** are tracked and visited:
 * a world nobody has extracted from costs nothing per tick. The tracked set is not state; it is
 * derived from the stocks, so `new ResourceStocks(nodes, table)` after a load finds it again.
 * Integer arithmetic only, no randomness, and each node's update is independent of the others, so the
 * result does not depend on the order nodes are visited. Stock only ever changes through
 * `NodeStore.setStock`, which keeps the tile slot arrays in step.
 */
import { RESOURCE_CATALOG } from '@sovereign/contracts'
import type { NodeStore } from '../resources/NodeStore'

/** Regrowth by resource id (index 0 is "none"): units per period, and the period in ticks (0 = no regrowth). */
export interface RegrowthTable {
  units: Uint8Array
  period: Uint16Array
}

export type ResourceLayerName = 'surface' | 'ground'

/** Build the lookup from catalogue keys to regrowth rates; only renewable resources may regrow. */
export function buildRegrowthTable(
  rates: Record<string, { units: number; period: number }>
): RegrowthTable {
  const table: RegrowthTable = {
    units: new Uint8Array(RESOURCE_CATALOG.length + 1),
    period: new Uint16Array(RESOURCE_CATALOG.length + 1)
  }
  const known = new Map(RESOURCE_CATALOG.map((def) => [def.key, def]))
  // Enumerating the rates only validates them: whether this throws does not depend on the order.
  // eslint-disable-next-line no-restricted-properties
  for (const [key, rate] of Object.entries(rates)) {
    const def = known.get(key)
    if (def === undefined) throw new RangeError(`unknown resource "${key}"`)
    if (!def.renewable) throw new RangeError(`${key} is finite and cannot regrow`)
    if (!Number.isInteger(rate.units) || rate.units < 1 || rate.units > 255) {
      throw new RangeError(`${key}.units must be an integer from 1 to 255`)
    }
    if (!Number.isInteger(rate.period) || rate.period < 1 || rate.period > 65535) {
      throw new RangeError(`${key}.period must be an integer from 1 to 65535`)
    }
    table.units[def.id] = rate.units
    table.period[def.id] = rate.period
  }
  return table
}

export class ResourceStocks {
  /** The drawn-down renewable nodes: a growable list plus a flag per node saying it is in the list. */
  private pendingIds = new Int32Array(1024)
  private pendingCount = 0
  private readonly flag: Uint8Array

  /**
   * `onChange(tile)` is told of every tile whose stock changed (taken or regrown), so what depends on
   * stocks (the profile of the nation that holds the tile) can be measured again.
   */
  constructor(
    private readonly nodes: NodeStore,
    private readonly table: RegrowthTable,
    private readonly onChange?: (tile: number) => void
  ) {
    this.flag = new Uint8Array(nodes.count)
    for (let id = 0; id < nodes.count; id += 1) {
      if (
        this.table.period[nodes.kind[id] as number] !== 0 &&
        nodes.stock[id] < nodes.richness[id]
      ) {
        this.track(id)
      }
    }
  }

  /** How many drawn-down nodes are waiting to regrow. */
  get pending(): number {
    return this.pendingCount
  }

  /**
   * Take up to `amount` units from a tile's slot; returns how much was taken (less than asked if the
   * stock ran out, 0 if the tile holds nothing there).
   */
  extract(layer: ResourceLayerName, tile: number, amount: number): number {
    if (layer !== 'surface' && layer !== 'ground')
      throw new RangeError(`unknown layer "${String(layer)}"`)
    const size = this.nodes.slots[layer].type.length
    if (!Number.isInteger(tile) || tile < 0 || tile >= size) {
      throw new RangeError('tile must be an integer index inside the map')
    }
    if (!Number.isInteger(amount) || amount < 0) {
      throw new RangeError('amount must be a non-negative integer')
    }
    const id = this.nodes.nodeAt(tile, layer)
    return id < 0 ? 0 : this.take(id, amount)
  }

  /** Take up to `amount` units from node `id`; returns how much was taken. */
  extractNode(id: number, amount: number): number {
    if (!Number.isInteger(id) || id < 0 || id >= this.nodes.count) {
      throw new RangeError(`no node ${id}`)
    }
    if (!Number.isInteger(amount) || amount < 0) {
      throw new RangeError('amount must be a non-negative integer')
    }
    return this.take(id, amount)
  }

  private take(id: number, amount: number): number {
    const nodes = this.nodes
    const taken = Math.min(amount, nodes.stock[id] as number)
    if (taken === 0) return 0
    nodes.setStock(id, (nodes.stock[id] as number) - taken)
    this.onChange?.(nodes.tile[id] as number)
    if (this.table.period[nodes.kind[id] as number] !== 0) this.track(id)
    return taken
  }

  /** Let every drawn-down renewable node whose turn it is regrow, up to its richness. */
  regrow(tick: number): void {
    if (!Number.isInteger(tick) || tick < 0)
      throw new RangeError('tick must be a non-negative integer')
    const nodes = this.nodes
    let write = 0
    for (let read = 0; read < this.pendingCount; read += 1) {
      const id = this.pendingIds[read] as number
      const tile = nodes.tile[id] as number
      const kind = nodes.kind[id] as number
      if ((tick + tile) % (this.table.period[kind] as number) === 0) {
        nodes.setStock(
          id,
          Math.min(
            nodes.richness[id] as number,
            (nodes.stock[id] as number) + (this.table.units[kind] as number)
          )
        )
        this.onChange?.(tile)
      }
      if ((nodes.stock[id] as number) >= (nodes.richness[id] as number)) {
        this.flag[id] = 0
      } else {
        this.pendingIds[write] = id
        write += 1
      }
    }
    this.pendingCount = write
  }

  private track(id: number): void {
    if (this.flag[id] !== 0) return
    if (this.pendingCount === this.pendingIds.length) {
      const bigger = new Int32Array(this.pendingIds.length * 2)
      bigger.set(this.pendingIds)
      this.pendingIds = bigger
    }
    this.pendingIds[this.pendingCount] = id
    this.pendingCount += 1
    this.flag[id] = 1
  }
}
