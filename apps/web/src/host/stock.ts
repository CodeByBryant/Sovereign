/**
 * @module stock
 * @description Keeps the app's copy of the resource slot arrays up to date. The world sends the whole of them
 * once, when it is made; after that it only sends the deposits that changed (gathered or grown back). Applying a
 * change writes the stock into the same arrays the sprite layers, the inspector and the overlays read, so all of
 * them see it at once.
 */
import type { ResourceSlots, StockChanges } from '@sovereign/contracts'

export function applyStockChanges(slots: ResourceSlots, changes: StockChanges): void {
  const n = changes.tile.length
  if (changes.layer.length !== n || changes.value.length !== n) {
    throw new RangeError('stock changes must list a tile, a layer and a value each')
  }
  const size = slots.surface.stock.length
  for (let i = 0; i < n; i += 1) {
    const tile = changes.tile[i] as number
    if (tile >= size) throw new RangeError(`a stock change is for tile ${tile}, off the map`)
    const slot = changes.layer[i] === 1 ? slots.ground : slots.surface
    slot.stock[tile] = changes.value[i] as number
  }
}
