/**
 * @module territory
 * @description A nation's starting territory: grown outward from its capital province over the graph of
 * provinces, all nations at once. Each step claims the cheapest province any nation can reach next, where
 * the cost of stepping from one province to the next is the distance between their centres times the mean
 * cost of crossing them. Territories spread over easy ground and stop at mountains, rivers and coasts, and
 * where two nations meet on open ground the border is halfway between them. A nation that holds its area
 * stops; the others go on.
 *
 * Deterministic: a total order on every choice (cost, then province id), `+ - * /` and `sqrt` only.
 */
import { MinHeap } from '../terrain/heap'
import type { ProvinceMap } from '../terrain/provinces'

export interface TerritoryInput {
  provinces: ProvinceMap
  /** One capital province per nation; each must be claimable and on its own. */
  capitals: readonly number[]
  /** 1 for a province that can be owned (not ice), 0 for the rest; one entry per province. */
  claimable: Uint8Array
  /**
   * The number of tiles each nation tries to claim: one number for all, or one per nation. A nation stops
   * at the first province that takes it to this many, so it may hold a little more.
   */
  area: number | readonly number[]
}

/** The cost of stepping from province `a` to its neighbour `b`: how far apart they are, over how hard the ground. */
function stepCost(map: ProvinceMap, a: number, b: number): number {
  const dx = map.centroidX[a] - map.centroidX[b]
  const dy = map.centroidY[a] - map.centroidY[b]
  return Math.sqrt(dx * dx + dy * dy) * ((map.meanCost[a] + map.meanCost[b]) / 2)
}

/** The provinces each nation claimed, in the order it claimed them (the capital first). */
export function growTerritories(input: TerritoryInput): number[][] {
  const { provinces, capitals, claimable, area } = input
  const count = provinces.count
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
    if (!Number.isInteger(capital) || capital < 0 || capital >= count) {
      throw new RangeError('a capital must be a province of the map')
    }
    if (claimable[capital] !== 1) {
      throw new RangeError('a capital must be in a province that can be claimed')
    }
    if (seen.has(capital)) throw new RangeError('two capitals cannot share a province')
    seen.add(capital)
  }
  const claimed: number[][] = capitals.map(() => [])
  if (capitals.length === 0) return claimed

  const held = new Float64Array(capitals.length) // tiles each nation holds
  const full = (nation: number): boolean => held[nation] >= wanted(nation)
  const owner = new Int32Array(count).fill(-1)
  const claimKey = new Float64Array(count) // the cost at which each province was claimed
  // the cheapest way found so far to each unclaimed province, and who found it
  const bestCost = new Float64Array(count).fill(Infinity)
  const bestNation = new Int32Array(count).fill(-1)
  const heap = new MinHeap(1024)
  capitals.forEach((province, nation) => {
    bestCost[province] = 0
    bestNation[province] = nation
    heap.push(0, province)
  })

  while (heap.size > 0) {
    const key = heap.peekKey()
    const province = heap.pop()
    if (owner[province] >= 0 || bestNation[province] < 0 || key > bestCost[province]) continue
    const nation = bestNation[province]
    if (full(nation)) {
      // this nation is full: the province is free again, and goes to the nation with room that can reach
      // it most cheaply from a province it holds (an offer of its own may have been replaced by this one)
      bestNation[province] = -1
      bestCost[province] = Infinity
      for (
        let k = provinces.neighbourStart[province];
        k < provinces.neighbourStart[province + 1];
        k += 1
      ) {
        const held = provinces.neighbourId[k]
        const holder = owner[held]
        if (holder < 0 || full(holder)) continue
        const total = claimKey[held] + stepCost(provinces, held, province)
        if (total < bestCost[province]) {
          bestNation[province] = holder
          bestCost[province] = total
        }
      }
      if (bestNation[province] >= 0) heap.push(bestCost[province], province)
      continue
    }
    owner[province] = nation
    claimKey[province] = key
    claimed[nation].push(province)
    held[nation] += provinces.area[province]
    bestNation[province] = -1
    bestCost[province] = Infinity
    if (full(nation)) continue

    for (
      let k = provinces.neighbourStart[province];
      k < provinces.neighbourStart[province + 1];
      k += 1
    ) {
      const next = provinces.neighbourId[k]
      if (claimable[next] !== 1 || owner[next] >= 0) continue
      const total = key + stepCost(provinces, province, next)
      const holder = bestNation[next]
      if (holder < 0 || total < bestCost[next]) {
        bestNation[next] = nation
        bestCost[next] = total
        heap.push(total, next)
      }
    }
  }
  return claimed
}
