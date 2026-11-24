/**
 * @module sprites/roads
 * @description Roads for the sprite layer, from the route network: one byte per tile, 0 for no road, else
 * `16 | mask` where the mask says which of the four sides join a neighbouring road tile (ROAD_N, E, S, W), so
 * that each tile can be drawn with the piece that connects to its neighbours.
 */
import type { StrategicRoute } from '@sovereign/contracts'
import { ROAD_E, ROAD_N, ROAD_S, ROAD_W } from './atlas'

/** Set in a road byte when the tile has a road at all (a lone tile has mask 0 but is still a road). */
export const ROAD_PRESENT = 16

/**
 * Walk the tiles from (x0, y0) to (x1, y1), calling `visit` for each. Steps are always along a side, never
 * across a corner (a diagonal becomes two steps), so consecutive tiles are neighbours and a road stays joined.
 */
function walk(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (x: number, y: number) => void
): void {
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  let x = x0
  let y = y0
  visit(x, y)
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x += sx
      visit(x, y)
    }
    if (e2 <= dx) {
      err += dx
      y += sy
      visit(x, y)
    }
  }
}

/** Mark the routes that carry traffic on a `width x height` grid of road bytes. */
export function roadMaskFromRoutes(
  routes: readonly StrategicRoute[],
  width: number,
  height: number
): Uint8Array {
  const mask = new Uint8Array(width * height)
  const on = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height
  for (const route of routes) {
    if (!(route.traffic > 0)) continue
    const path = route.path
    let px = Number.NaN
    let py = Number.NaN
    const visit = (x: number, y: number): void => {
      if (x === px && y === py) return
      if (on(x, y)) mask[y * width + x] = (mask[y * width + x] as number) | ROAD_PRESENT
      if (on(px, py) && on(x, y)) {
        // the step from the previous tile joins the side of each facing the other
        const a = py * width + px
        const b = y * width + x
        if (x > px) {
          mask[a] = (mask[a] as number) | ROAD_E
          mask[b] = (mask[b] as number) | ROAD_W
        } else if (x < px) {
          mask[a] = (mask[a] as number) | ROAD_W
          mask[b] = (mask[b] as number) | ROAD_E
        } else if (y > py) {
          mask[a] = (mask[a] as number) | ROAD_S
          mask[b] = (mask[b] as number) | ROAD_N
        } else {
          mask[a] = (mask[a] as number) | ROAD_N
          mask[b] = (mask[b] as number) | ROAD_S
        }
      }
      px = x
      py = y
    }
    if (path.length === 2) visit(path[0] as number, path[1] as number)
    for (let k = 0; k + 3 < path.length; k += 2) {
      walk(
        path[k] as number,
        path[k + 1] as number,
        path[k + 2] as number,
        path[k + 3] as number,
        visit
      )
    }
  }
  return mask
}
