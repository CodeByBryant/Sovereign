/**
 * @module ResourceStocks
 * @description Drawing resources down and letting renewable ones grow back. A tile's stock is mutable
 * simulation state (hashed and saved); its richness, the potential it started with, is not.
 *
 * - `extract` takes up to an amount from a tile's slot and returns what it actually took. The economy
 *   and god tools will call it; nothing does yet.
 * - `regrow(tick)` runs from `World.step()`. A renewable stock that has been drawn down regrows by its
 *   catalogue rate every `period` ticks, on the tick where `(tick + tile) % period === 0` so tiles do
 *   not all grow on the same tick, up to its richness. Ground resources (and any resource without a
 *   rate) never regrow.
 *
 * To stay cheap over hundreds of thousands of ticks only **drawn-down tiles** are tracked and visited:
 * a world nobody has extracted from costs nothing per tick. The tracked set is not state; it is
 * derived from the stocks, so `new ResourceStocks(slots, table)` after a load finds it again.
 * Integer arithmetic only, no randomness, and each tile's update is independent of the others, so the
 * result does not depend on the order tiles are visited.
 */
import { RESOURCE_CATALOG, type ResourceSlot, type ResourceSlots } from '@sovereign/contracts'

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

/** The drawn-down tiles of one slot: a growable list plus a flag per tile saying it is in the list. */
interface Pending {
  tiles: Int32Array
  count: number
  flag: Uint8Array
}

export class ResourceStocks {
  private readonly pendingBy: { surface: Pending; ground: Pending }

  /**
   * `onChange(tile)` is told of every tile whose stock changed (taken or regrown), so what depends on
   * stocks (the profile of the nation that holds the tile) can be measured again.
   */
  constructor(
    private readonly slots: ResourceSlots,
    private readonly table: RegrowthTable,
    private readonly onChange?: (tile: number) => void
  ) {
    const size = slots.surface.type.length
    this.pendingBy = {
      surface: { tiles: new Int32Array(1024), count: 0, flag: new Uint8Array(size) },
      ground: { tiles: new Int32Array(1024), count: 0, flag: new Uint8Array(size) }
    }
    for (const layer of ['surface', 'ground'] as const) {
      const slot = slots[layer]
      for (let i = 0; i < size; i += 1) {
        if (
          slot.type[i] !== 0 &&
          this.table.period[slot.type[i]] > 0 &&
          slot.stock[i] < slot.richness[i]
        ) {
          this.track(layer, i)
        }
      }
    }
  }

  /** How many drawn-down tiles are waiting to regrow. */
  get pending(): number {
    return this.pendingBy.surface.count + this.pendingBy.ground.count
  }

  /**
   * Take up to `amount` units from a tile's slot; returns how much was taken (less than asked if the
   * stock ran out, 0 if the tile holds nothing there).
   */
  extract(layer: ResourceLayerName, tile: number, amount: number): number {
    if (layer !== 'surface' && layer !== 'ground')
      throw new RangeError(`unknown layer "${String(layer)}"`)
    const slot: ResourceSlot = this.slots[layer]
    if (!Number.isInteger(tile) || tile < 0 || tile >= slot.type.length) {
      throw new RangeError('tile must be an integer index inside the map')
    }
    if (!Number.isInteger(amount) || amount < 0) {
      throw new RangeError('amount must be a non-negative integer')
    }
    if (slot.type[tile] === 0) return 0
    const taken = Math.min(amount, slot.stock[tile])
    if (taken === 0) return 0
    slot.stock[tile] -= taken
    this.onChange?.(tile)
    if (this.table.period[slot.type[tile]] > 0) this.track(layer, tile)
    return taken
  }

  /** Let every drawn-down renewable tile whose turn it is regrow, up to its richness. */
  regrow(tick: number): void {
    if (!Number.isInteger(tick) || tick < 0)
      throw new RangeError('tick must be a non-negative integer')
    for (const layer of ['surface', 'ground'] as const) {
      const slot = this.slots[layer]
      const pending = this.pendingBy[layer]
      let write = 0
      for (let read = 0; read < pending.count; read += 1) {
        const tile = pending.tiles[read]
        const type = slot.type[tile]
        const period = this.table.period[type]
        if ((tick + tile) % period === 0) {
          slot.stock[tile] = Math.min(
            slot.richness[tile],
            slot.stock[tile] + this.table.units[type]
          )
          this.onChange?.(tile)
        }
        if (slot.stock[tile] >= slot.richness[tile]) {
          pending.flag[tile] = 0
        } else {
          pending.tiles[write] = tile
          write += 1
        }
      }
      pending.count = write
    }
  }

  private track(layer: ResourceLayerName, tile: number): void {
    const pending = this.pendingBy[layer]
    if (pending.flag[tile] !== 0) return
    if (pending.count === pending.tiles.length) {
      const bigger = new Int32Array(pending.tiles.length * 2)
      bigger.set(pending.tiles)
      pending.tiles = bigger
    }
    pending.tiles[pending.count] = tile
    pending.count += 1
    pending.flag[tile] = 1
  }
}
