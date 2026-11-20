/**
 * @module capitals
 * @description Where nations start, and who their neighbours are. Capitals go on hubs (the best places to
 * live, the ones routes join), best first, never closer than `minSpacing`, with a preference for sites far
 * from the capitals already chosen so nations spread over the map instead of crowding the best corner.
 * A nation's neighbours are the other capitals within a few routes of its own.
 *
 * Deterministic: no randomness, ties to the lower index.
 */
import type { RouteHub } from '@sovereign/contracts'

/**
 * The hubs (by index) chosen as capitals, in the order chosen. Each pick maximises the site's weight times
 * a spread factor: 1 for a site at least `2 * minSpacing` from every capital so far, falling to 0.5 at
 * exactly `minSpacing`. Fewer than `count` come back if the sites run out.
 */
export function chooseCapitals(
  hubs: readonly RouteHub[],
  count: number,
  minSpacing: number,
  eligible: (hub: number) => boolean = () => true
): number[] {
  const chosen: number[] = []
  const taken = new Uint8Array(hubs.length)
  while (chosen.length < count) {
    let best = -1
    let bestScore = -Infinity
    for (let h = 0; h < hubs.length; h += 1) {
      if (taken[h] === 1 || !eligible(h)) continue
      let nearest = Infinity
      for (const c of chosen) {
        const dx = hubs[h].x - hubs[c].x
        const dy = hubs[h].y - hubs[c].y
        nearest = Math.min(nearest, Math.sqrt(dx * dx + dy * dy))
      }
      if (nearest < minSpacing) continue
      const spread = chosen.length === 0 ? 1 : Math.min(1, nearest / (2 * minSpacing))
      const score = hubs[h].weight * spread
      if (score > bestScore) {
        bestScore = score
        best = h
      }
    }
    if (best === -1) break
    chosen.push(best)
    taken[best] = 1
  }
  return chosen
}

/**
 * For each capital (a hub index), how many other capitals lie within `hops` routes of it, over the network
 * of routes between hubs (in either direction, through hubs that are not capitals).
 */
export function contactCounts(
  capitals: readonly number[],
  routes: ReadonlyArray<{ from: number; to: number }>,
  hubCount: number,
  hops: number
): number[] {
  const next: number[][] = Array.from({ length: hubCount }, () => [])
  for (const route of routes) {
    next[route.from].push(route.to)
    next[route.to].push(route.from)
  }
  const isCapital = new Uint8Array(hubCount)
  for (const c of capitals) isCapital[c] = 1
  return capitals.map((start) => {
    const depth = new Int32Array(hubCount).fill(-1)
    depth[start] = 0
    const queue = [start]
    let found = 0
    for (let head = 0; head < queue.length; head += 1) {
      const h = queue[head] as number
      if (depth[h] >= hops) continue
      for (const n of next[h] as number[]) {
        if (depth[n] !== -1) continue
        depth[n] = depth[h] + 1
        if (isCapital[n] === 1) found += 1
        queue.push(n)
      }
    }
    return found
  })
}
