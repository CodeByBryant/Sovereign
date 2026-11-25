/**
 * @module palettes
 * @description Turn terrain fields into RGBA pixel buffers for each map overlay. Pure functions
 * over typed arrays: no DOM types and no drawing, so they run anywhere (main thread, a worker, or a
 * test). The host wraps a result in `ImageData` / an `ImageBitmap` to show it.
 */
import {
  STRATEGIC_META,
  getBiomeById,
  getBiomeColor,
  resourceDef,
  type ResourceSlots,
  type StrategicPoint,
  type StrategicRoute
} from '@sovereign/contracts'

type Rgb = readonly [number, number, number]

function lerpRgb(start: Rgb, end: Rgb, t: number): [number, number, number] {
  return [
    Math.round(start[0] + (end[0] - start[0]) * t),
    Math.round(start[1] + (end[1] - start[1]) * t),
    Math.round(start[2] + (end[2] - start[2]) * t)
  ]
}

function rampRgba(values: Float32Array, start: Rgb, end: Rgb): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(values.length * 4)
  for (let i = 0; i < values.length; i += 1) {
    const color = lerpRgb(start, end, values[i] as number)
    const p = i * 4
    rgba[p] = color[0]
    rgba[p + 1] = color[1]
    rgba[p + 2] = color[2]
    rgba[p + 3] = 255
  }
  return rgba
}

/** Greyscale elevation: sea (at or below `seaLevel`) is black, land is a linear 0-255 ramp. */
export function elevationRgba(elevation: Float32Array, seaLevel: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(elevation.length * 4)
  for (let i = 0; i < elevation.length; i += 1) {
    const value = elevation[i] as number
    const normalized = value <= seaLevel ? 0 : (value - seaLevel) / (1 - seaLevel)
    const shade = Math.round(normalized * 255)
    const p = i * 4
    rgba[p] = shade
    rgba[p + 1] = shade
    rgba[p + 2] = shade
    rgba[p + 3] = 255
  }
  return rgba
}

/** Temperature as a blue to red gradient. */
export function temperatureRgba(temperature: Float32Array): Uint8ClampedArray {
  return rampRgba(temperature, [35, 78, 150], [210, 62, 52])
}

/** Humidity as a brown to blue gradient. */
export function humidityRgba(humidity: Float32Array): Uint8ClampedArray {
  return rampRgba(humidity, [120, 89, 52], [44, 118, 182])
}

/** Draw rivers (a sandy bank ring, then deep-to-shallow water) onto an RGBA buffer, in place. */
export function applyRivers(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  riverWidth: Uint8Array
): void {
  const deepColor: Rgb = [28, 80, 180]
  const shallowColor: Rgb = [52, 118, 210]
  const bankColor: Rgb = [164, 148, 110]

  // 0 = untouched, 1 = bank, 2 = water; so a pixel is never blended twice.
  const painted = new Uint8Array(width * height)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const w = riverWidth[index] as number
      if (w === 0) continue

      const coreR = Math.max(1, Math.floor(w / 2))
      const bankR = coreR + 1

      for (let oy = -bankR; oy <= bankR; oy += 1) {
        for (let ox = -bankR; ox <= bankR; ox += 1) {
          const dist = Math.abs(ox) + Math.abs(oy) // manhattan for a blocky feel
          if (dist > bankR || dist <= coreR) continue
          const nx = x + ox
          const ny = y + oy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const ni = ny * width + nx
          if (painted[ni] !== 0) continue // already banked, or already water
          painted[ni] = 1
          const p = ni * 4
          const blend = 0.3
          rgba[p] = Math.round((rgba[p] as number) * (1 - blend) + bankColor[0] * blend)
          rgba[p + 1] = Math.round((rgba[p + 1] as number) * (1 - blend) + bankColor[1] * blend)
          rgba[p + 2] = Math.round((rgba[p + 2] as number) * (1 - blend) + bankColor[2] * blend)
        }
      }

      for (let oy = -coreR; oy <= coreR; oy += 1) {
        for (let ox = -coreR; ox <= coreR; ox += 1) {
          const dist = Math.abs(ox) + Math.abs(oy)
          if (dist > coreR) continue
          const nx = x + ox
          const ny = y + oy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const ni = ny * width + nx
          if (painted[ni] === 2) continue // already water
          painted[ni] = 2
          const p = ni * 4
          // centre pixels deep, edge pixels shallow
          const edgeT = dist / Math.max(1, coreR)
          rgba[p] = Math.round(deepColor[0] * (1 - edgeT) + shallowColor[0] * edgeT)
          rgba[p + 1] = Math.round(deepColor[1] * (1 - edgeT) + shallowColor[1] * edgeT)
          rgba[p + 2] = Math.round(deepColor[2] * (1 - edgeT) + shallowColor[2] * edgeT)
        }
      }
    }
  }
}

/**
 * How much the ground colour of a tile may differ from its biome's: a fine part per tile (the three art
 * variants each biome has in WorldBox) and a patch part per 8 x 8 block (its high and low shades), so a
 * meadow has texture and drifts a little from block to block without an overlay. A fraction of the colour.
 */
export const GROUND_DETAIL = { fine: 0.035, patch: 0.025 } as const

/** A cheap integer hash of two numbers and a salt. */
function hash2(x: number, y: number, salt: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt, 0x9e3779b1)
  h ^= h >>> 15
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** The factor a tile's biome colour is scaled by: 1 plus a fine and a patch variation, from its position alone. */
export function groundShade(x: number, y: number): number {
  const fine = (hash2(x, y, 1) % 3) - 1
  const patch = (hash2(x >> 3, y >> 3, 2) % 3) - 1
  return 1 + GROUND_DETAIL.fine * fine + GROUND_DETAIL.patch * patch
}

const clampColor = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v))

/**
 * The biome map: each tile in its biome colour, with rivers drawn over it. With `detail`, land tiles are
 * shaded by {@link groundShade} (the sea keeps its colour); it is off by default so the plain colours stay
 * available to anything that compares them.
 */
export function biomeRgba(
  biomeIds: Uint8Array,
  riverWidth: Uint8Array,
  width: number,
  height: number,
  detail = false
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(biomeIds.length * 4)
  for (let i = 0; i < biomeIds.length; i += 1) {
    const key = getBiomeById(biomeIds[i] as number).key
    const color = getBiomeColor(key)
    const k =
      detail && key !== 'ocean' && key !== 'deep_ocean'
        ? groundShade(i % width, (i / width) | 0)
        : 1
    const p = i * 4
    rgba[p] = clampColor(color[0] * k)
    rgba[p + 1] = clampColor(color[1] * k)
    rgba[p + 2] = clampColor(color[2] * k)
    rgba[p + 3] = 255
  }
  applyRivers(rgba, width, height, riverWidth)
  return rgba
}

/** The colour of a route, and how strongly it shows: faint for a quiet route, strong for the busiest. */
const ROUTE_COLOR: Rgb = [255, 210, 120]
const ROUTE_ALPHA_MIN = 0.3
const ROUTE_ALPHA_MAX = 0.85

/** Add the 2 x 2 tiles at (x, y), clipped to the map, to the tiles a route covers. */
function coverRoute(
  covered: Set<number>,
  width: number,
  height: number,
  x: number,
  y: number
): void {
  for (let dy = 0; dy <= 1; dy += 1) {
    for (let dx = 0; dx <= 1; dx += 1) {
      const px = x + dx
      const py = y + dy
      if (px >= 0 && py >= 0 && px < width && py < height) covered.add(py * width + px)
    }
  }
}

/**
 * The strategic overlay: the base map dimmed, the routes between settlements drawn as lines (brighter the
 * more traffic they carry), and a diamond marker per strategic point on top.
 */
export function strategicRgba(
  base: Uint8ClampedArray,
  width: number,
  height: number,
  points: readonly StrategicPoint[],
  routes: readonly StrategicRoute[] = []
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(base)

  // Dim the base map slightly so markers pop.
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.round((data[i] as number) * 0.75)
    data[i + 1] = Math.round((data[i + 1] as number) * 0.75)
    data[i + 2] = Math.round((data[i + 2] as number) * 0.75)
  }

  let busiest = 0
  for (const route of routes) busiest = Math.max(busiest, route.traffic)
  if (busiest > 0) {
    for (const route of routes) {
      if (!(route.traffic > 0)) continue
      const alpha =
        ROUTE_ALPHA_MIN + (ROUTE_ALPHA_MAX - ROUTE_ALPHA_MIN) * Math.sqrt(route.traffic / busiest)
      const path = route.path
      // the tiles the route covers, each blended once however many steps of the line reach it
      const covered = new Set<number>()
      if (path.length === 2)
        coverRoute(covered, width, height, path[0] as number, path[1] as number)
      for (let k = 0; k + 3 < path.length; k += 2) {
        // a line from one point to the next (Bresenham), every tile of it stamped
        let x = path[k] as number
        let y = path[k + 1] as number
        const x1 = path[k + 2] as number
        const y1 = path[k + 3] as number
        const dx = Math.abs(x1 - x)
        const dy = -Math.abs(y1 - y)
        const sx = x < x1 ? 1 : -1
        const sy = y < y1 ? 1 : -1
        let err = dx + dy
        for (;;) {
          coverRoute(covered, width, height, x, y)
          if (x === x1 && y === y1) break
          const e2 = 2 * err
          if (e2 >= dy) {
            err += dy
            x += sx
          }
          if (e2 <= dx) {
            err += dx
            y += sy
          }
        }
      }
      for (const tile of covered) {
        const idx = tile * 4
        data[idx] = Math.round((data[idx] as number) * (1 - alpha) + ROUTE_COLOR[0] * alpha)
        data[idx + 1] = Math.round((data[idx + 1] as number) * (1 - alpha) + ROUTE_COLOR[1] * alpha)
        data[idx + 2] = Math.round((data[idx + 2] as number) * (1 - alpha) + ROUTE_COLOR[2] * alpha)
      }
    }
  }

  for (const pt of points) {
    const color = STRATEGIC_META[pt.type].color
    // Diamond marker whose size scales with strategic value.
    const markerR = Math.max(2, Math.round(pt.value / 2.5))

    for (let dy = -markerR; dy <= markerR; dy += 1) {
      for (let dx = -markerR; dx <= markerR; dx += 1) {
        if (Math.abs(dx) + Math.abs(dy) > markerR) continue
        const px = pt.x + dx
        const py = pt.y + dy
        if (px < 0 || py < 0 || px >= width || py >= height) continue

        const idx = (py * width + px) * 4
        const edgeDist = Math.abs(dx) + Math.abs(dy)
        const innerT = 1 - edgeDist / (markerR + 1)

        // Bright core, faded edges.
        const alpha = innerT * 0.9 + 0.1
        data[idx] = Math.round((data[idx] as number) * (1 - alpha) + color[0] * alpha)
        data[idx + 1] = Math.round((data[idx + 1] as number) * (1 - alpha) + color[1] * alpha)
        data[idx + 2] = Math.round((data[idx + 2] as number) * (1 - alpha) + color[2] * alpha)
      }
    }

    // White outline ring.
    const outlineR = markerR + 1
    for (let dy = -outlineR; dy <= outlineR; dy += 1) {
      for (let dx = -outlineR; dx <= outlineR; dx += 1) {
        if (Math.abs(dx) + Math.abs(dy) !== outlineR) continue
        const px = pt.x + dx
        const py = pt.y + dy
        if (px < 0 || py < 0 || px >= width || py >= height) continue
        const idx = (py * width + px) * 4
        const blend = 0.6
        data[idx] = Math.round((data[idx] as number) * (1 - blend) + 255 * blend)
        data[idx + 1] = Math.round((data[idx + 1] as number) * (1 - blend) + 255 * blend)
        data[idx + 2] = Math.round((data[idx + 2] as number) * (1 - blend) + 255 * blend)
      }
    }
  }

  return data
}

const TIER_RANK = { basic: 1, industrial: 2, luxury: 3 } as const

/**
 * The resource a tile shows on the map when it holds two: a luxury beats an industrial resource,
 * which beats a basic one; at equal tiers the ground resource wins (it is the rarer one). 0 if the
 * tile holds nothing.
 */
export function dominantResource(surfaceType: number, groundType: number): number {
  const surface = resourceDef(surfaceType)
  const ground = resourceDef(groundType)
  if (surface === undefined) return ground === undefined ? 0 : ground.id
  if (ground === undefined) return surface.id
  return TIER_RANK[surface.tier] > TIER_RANK[ground.tier] ? surface.id : ground.id
}

/** How much a focus dims the tiles that do not hold the focused resource. */
const FOCUS_DIM = 0.55

/**
 * The resource overlay. Without a focus every tile that holds a resource is tinted with the colour of
 * its dominant one, more strongly the more of it is left (a drawn-down deposit stays faintly visible).
 * With a focus (a resource id) only tiles holding that resource, in either slot, are tinted, in its
 * colour, and the rest of the map is dimmed: a heat map of one resource.
 */
export function resourceRgba(
  base: Uint8ClampedArray,
  resources: ResourceSlots,
  focus = 0
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(base)
  const { surface, ground } = resources
  const size = surface.type.length
  for (let i = 0; i < size; i += 1) {
    const p = i * 4
    let id: number
    let left: number
    if (focus !== 0) {
      if (surface.type[i] === focus) {
        id = focus
        left = surface.stock[i] as number
      } else if (ground.type[i] === focus) {
        id = focus
        left = ground.stock[i] as number
      } else {
        data[p] = Math.round((data[p] as number) * FOCUS_DIM)
        data[p + 1] = Math.round((data[p + 1] as number) * FOCUS_DIM)
        data[p + 2] = Math.round((data[p + 2] as number) * FOCUS_DIM)
        continue
      }
    } else {
      id = dominantResource(surface.type[i] as number, ground.type[i] as number)
      if (id === 0) continue
      left = (surface.type[i] === id ? surface.stock[i] : ground.stock[i]) as number
    }
    const tint = resourceDef(id)?.color
    if (tint === undefined) continue
    const blend = 0.18 + 0.42 * (left / 255)
    data[p] = Math.round((data[p] as number) * (1 - blend) + tint[0] * blend)
    data[p + 1] = Math.round((data[p + 1] as number) * (1 - blend) + tint[1] * blend)
    data[p + 2] = Math.round((data[p + 2] as number) * (1 - blend) + tint[2] * blend)
  }
  return data
}

/** How strongly nations are drawn on the political overlay. */
export interface PoliticalStyle {
  /** Alpha blend of the nation colour over the map (0 to 1). */
  alpha: number
  /** Extra blend on border tiles (0 to 1); borders are also dimmed by 30%. */
  darken: number
  /**
   * How much to dim a tile that lies on the line between two provinces of one nation (0 to 1), so the
   * provinces show faintly inside a territory. 0 or missing draws none.
   */
  provinceDarken?: number
}

/**
 * The political overlay: the base map with each owned tile blended toward its nation's colour. A
 * tile is a border if any of its four in-map neighbours has a different owner (the edge of the map
 * does not count). `ownership` holds one byte per tile: the owning nation's index, or 255.
 *
 * With `provinces` (one 16-bit province id per tile, 0xFFFF for none) a tile that is not on a nation
 * border but has a neighbour in another province is dimmed by `style.provinceDarken`, so the provinces
 * a nation is made of show faintly inside it, and its own border still shows strongly.
 */
export function politicalRgba(
  base: Uint8ClampedArray,
  ownership: Uint8Array,
  nationColors: ReadonlyArray<readonly [number, number, number]>,
  width: number,
  height: number,
  style: PoliticalStyle,
  provinces?: Uint16Array
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(base)
  const { alpha, darken } = style
  const lineKeep = 1 - (style.provinceDarken ?? 0)
  const drawLines = provinces !== undefined && lineKeep < 1

  for (let i = 0; i < ownership.length; i += 1) {
    const owner = ownership[i] as number
    if (owner === 255) continue
    const color = nationColors[owner]
    if (color === undefined) continue

    const x = i % width
    const y = (i - x) / width
    const isBorder =
      (x > 0 && ownership[i - 1] !== owner) ||
      (x < width - 1 && ownership[i + 1] !== owner) ||
      (y > 0 && ownership[i - width] !== owner) ||
      (y < height - 1 && ownership[i + width] !== owner)

    const p = i * 4
    const blend = isBorder ? alpha + darken : alpha
    data[p] = Math.round((data[p] as number) * (1 - blend) + color[0] * blend)
    data[p + 1] = Math.round((data[p + 1] as number) * (1 - blend) + color[1] * blend)
    data[p + 2] = Math.round((data[p + 2] as number) * (1 - blend) + color[2] * blend)
    if (isBorder) {
      data[p] = Math.round((data[p] as number) * 0.7)
      data[p + 1] = Math.round((data[p + 1] as number) * 0.7)
      data[p + 2] = Math.round((data[p + 2] as number) * 0.7)
    } else if (drawLines) {
      const province = (provinces as Uint16Array)[i] as number
      const onLine =
        (x > 0 && (provinces as Uint16Array)[i - 1] !== province) ||
        (x < width - 1 && (provinces as Uint16Array)[i + 1] !== province) ||
        (y > 0 && (provinces as Uint16Array)[i - width] !== province) ||
        (y < height - 1 && (provinces as Uint16Array)[i + width] !== province)
      if (onLine) {
        data[p] = Math.round((data[p] as number) * lineKeep)
        data[p + 1] = Math.round((data[p + 1] as number) * lineKeep)
        data[p + 2] = Math.round((data[p + 2] as number) * lineKeep)
      }
    }
  }
  return data
}
