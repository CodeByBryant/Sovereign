/**
 * @module territory
 * @description A nation's starting territory: grown outward from its capital, over the cost of crossing the
 * ground, all nations at once. Each step claims the cheapest tile any nation can reach next, so territories
 * spread over easy ground and stop at mountains, rivers and coasts: borders land on natural barriers, and
 * where two nations meet on open ground the border is halfway between them. A nation that has its area
 * stops; the others go on.
 *
 * Deterministic: a total order on every choice (cost, then tile index), `+ - * /` only.
 */
import { MinHeap } from '../terrain/heap'

export interface TerritoryInput {
  width: number
  height: number
  /** One capital per nation, as a tile index; each must be claimable and on its own tile. */
  capitals: readonly number[]
  /** 1 for a tile that can be owned (land that is not ice), 0 for the rest. */
  claimable: Uint8Array
  /** What it costs to step onto a tile (above 0; `Infinity` for a tile nothing can cross). */
  tileCost: (tile: number) => number
  /** The number of tiles each nation tries to claim: one number for all, or one per nation. */
  area: number | readonly number[]
}

/** The tiles each nation claimed, in the order it claimed them (the capital first). */
export function growTerritories(input: TerritoryInput): number[][] {
  const { width, height, capitals, claimable, area } = input
  const size = width * height
  const wanted = (nation: number): number =>
    typeof area === 'number' ? area : (area[nation] as number)
  if (typeof area !== 'number' && area.length !== capitals.length) {
    throw new RangeError('there must be one area per capital')
  }
  for (let n = 0; n < capitals.length; n += 1) {
    if (!Number.isInteger(wanted(n)) || wanted(n) < 0) {
      throw new RangeError('area must be a non-negative integer')
    }
  }
  const seen = new Set<number>()
  for (const capital of capitals) {
    if (!Number.isInteger(capital) || capital < 0 || capital >= size) {
      throw new RangeError('a capital must be a tile of the map')
    }
    if (claimable[capital] !== 1)
      throw new RangeError('a capital must be on a tile that can be claimed')
    if (seen.has(capital)) throw new RangeError('two capitals cannot share a tile')
    seen.add(capital)
  }
  const claimed: number[][] = capitals.map(() => [])
  if (capitals.length === 0) return claimed

  const cost = (tile: number): number => {
    const c = input.tileCost(tile)
    if (!(c > 0)) throw new RangeError('a tile cost must be above 0')
    return c
  }

  const owner = new Map<number, number>()
  // the cheapest way found so far to each unclaimed tile, and who found it
  const best = new Map<number, { cost: number; nation: number }>()
  const heap = new MinHeap(4096)
  capitals.forEach((tile, nation) => {
    best.set(tile, { cost: 0, nation })
    heap.push(0, tile)
  })

  while (heap.size > 0) {
    const key = heap.peekKey()
    const tile = heap.pop()
    const entry = best.get(tile)
    if (owner.has(tile) || entry === undefined || key > entry.cost) continue // claimed, or a stale entry
    const nation = entry.nation
    if (claimed[nation].length >= wanted(nation)) {
      // this nation is full: the tile is free again for whoever can reach it next
      best.delete(tile)
      continue
    }
    owner.set(tile, nation)
    claimed[nation].push(tile)
    best.delete(tile)
    if (claimed[nation].length >= wanted(nation)) continue

    const x = tile % width
    const y = (tile - x) / width
    const here = cost(tile)
    const next = [
      x > 0 ? tile - 1 : -1,
      x < width - 1 ? tile + 1 : -1,
      y > 0 ? tile - width : -1,
      y < height - 1 ? tile + width : -1
    ]
    for (const n of next) {
      if (n < 0 || claimable[n] !== 1 || owner.has(n)) continue
      const there = cost(n)
      if (!(there < Infinity)) continue
      const total = key + (here + there) / 2
      const held = best.get(n)
      const holderFull = held !== undefined && claimed[held.nation].length >= wanted(held.nation)
      if (held === undefined || holderFull || total < held.cost) {
        best.set(n, { cost: total, nation })
        heap.push(total, n)
      }
    }
  }
  return claimed
}
