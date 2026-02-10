/**
 * @module strategic
 * @description Identifies strategically significant map locations.
 *
 * Four detector passes scan the generated terrain for:
 * - **River crossings** – river tiles at low elevation with land on opposing sides.
 * - **Mountain passes** – saddle-point minima surrounded by highlands.
 * - **Straits** – narrow water channels between two landmasses.
 * - **Peninsulas** – land jutting into water (high surrounding-water ratio).
 *
 * Each point receives a `strategicValue` from 0–10 and is rendered as a
 * colour-coded diamond marker on the strategic overlay map.
 *
 * @example
 * ```ts
 * const data = detectStrategicPoints(elev, riverMask, terrain, biomes, cfg)
 * const overlay = buildStrategicOverlay(biomeImg, data.points, w, h)
 * ```
 */
import type { TerrainConfig } from './TerrainGenerator'
import type { BiomeConfig } from './biomes'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type StrategicType = 'river_crossing' | 'mountain_pass' | 'strait' | 'peninsula'

export interface StrategicPoint {
  x: number
  y: number
  type: StrategicType
  value: number // 0-10
}

export interface StrategicConfig {
  /** Radius to check neighbours for river crossing detection. */
  riverCrossingRadius: number
  /** Radius to search for mountain pass saddle points. */
  mountainPassRadius: number
  /** Max water width to qualify as a strait. */
  straitMaxWidth: number
  /** Min land-to-water ratio in scan area to count as peninsula. */
  peninsulaMinRatio: number
  /** Radius for peninsula scan. */
  peninsulaRadius: number
}

export interface StrategicData {
  points: StrategicPoint[]
  /** Per-tile strategic value (0-10). 0 = not strategic. */
  valueMap: Uint8Array
}

/* ------------------------------------------------------------------ */
/*  Colours / labels for each type                                     */
/* ------------------------------------------------------------------ */

export const STRATEGIC_META: Record<
  StrategicType,
  { label: string; color: [number, number, number] }
> = {
  river_crossing: { label: 'River Crossing', color: [60, 180, 255] },
  mountain_pass: { label: 'Mountain Pass', color: [220, 160, 60] },
  strait: { label: 'Strait', color: [100, 220, 200] },
  peninsula: { label: 'Peninsula', color: [200, 100, 255] }
}

/* ------------------------------------------------------------------ */
/*  Detector                                                           */
/* ------------------------------------------------------------------ */

export function detectStrategicPoints(
  elevation: Float32Array,
  riverMask: Uint8Array,
  terrain: TerrainConfig,
  biomeConfig: BiomeConfig,
  config: StrategicConfig
): StrategicData {
  const { width, height, seaLevel } = terrain
  const size = width * height
  const valueMap = new Uint8Array(size)
  const points: StrategicPoint[] = []

  // Pre-compute land mask for reuse
  const isLand = new Uint8Array(size)
  for (let i = 0; i < size; i += 1) {
    isLand[i] = elevation[i] > seaLevel ? 1 : 0
  }

  // ---- River Crossings ----
  findRiverCrossings(
    elevation,
    riverMask,
    isLand,
    width,
    height,
    seaLevel,
    config,
    points,
    valueMap
  )

  // ---- Mountain Passes ----
  findMountainPasses(elevation, isLand, width, height, biomeConfig, config, points, valueMap)

  // ---- Straits ----
  findStraits(elevation, isLand, width, height, seaLevel, config, points, valueMap)

  // ---- Peninsulas ----
  findPeninsulas(isLand, width, height, config, points, valueMap)

  return { points, valueMap }
}

/* ------------------------------------------------------------------ */
/*  River Crossings                                                    */
/*  River tile at low elevation with land on opposing sides.           */
/* ------------------------------------------------------------------ */

function findRiverCrossings(
  elevation: Float32Array,
  riverMask: Uint8Array,
  isLand: Uint8Array,
  width: number,
  height: number,
  seaLevel: number,
  config: StrategicConfig,
  out: StrategicPoint[],
  valueMap: Uint8Array
): void {
  const spacing = config.riverCrossingRadius * 3
  // Grid-based spacing to avoid clustering
  const gridW = Math.ceil(width / spacing)
  const gridH = Math.ceil(height / spacing)
  const bestPerCell = new Float32Array(gridW * gridH)
  const bestIndex = new Int32Array(gridW * gridH)
  bestIndex.fill(-1)

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x
      if (!riverMask[i]) continue
      if (!isLand[i]) continue

      // Must have land on opposing sides perpendicular to river
      const hasLandNS = isLand[i - width] && isLand[i + width]
      const hasLandEW = isLand[i - 1] && isLand[i + 1]

      // Want land on opposite sides but NOT land everywhere (that's not a crossing)
      const opposingSides =
        (hasLandNS && (!isLand[i - 1] || !isLand[i + 1] || riverMask[i - 1] || riverMask[i + 1])) ||
        (hasLandEW &&
          (!isLand[i - width] ||
            !isLand[i + width] ||
            riverMask[i - width] ||
            riverMask[i + width]))

      if (!opposingSides) continue

      // Prefer lower elevation crossings (more accessible)
      const landRatio = (elevation[i] - seaLevel) / (1 - seaLevel)
      const score = 1 - landRatio // lower = more valuable

      const cx = Math.floor(x / spacing)
      const cy = Math.floor(y / spacing)
      const ci = cy * gridW + cx

      if (bestIndex[ci] === -1 || score > bestPerCell[ci]) {
        bestPerCell[ci] = score
        bestIndex[ci] = i
      }
    }
  }

  for (let ci = 0; ci < bestIndex.length; ci += 1) {
    const idx = bestIndex[ci]
    if (idx === -1) continue
    const x = idx % width
    const y = Math.floor(idx / width)
    const value = Math.min(10, Math.max(1, Math.round(bestPerCell[ci] * 8 + 2)))
    out.push({ x, y, type: 'river_crossing', value })
    valueMap[idx] = Math.max(valueMap[idx], value)
  }
}

/* ------------------------------------------------------------------ */
/*  Mountain Passes                                                    */
/*  Local minima in elevation surrounded by mountains/highlands.       */
/* ------------------------------------------------------------------ */

function findMountainPasses(
  elevation: Float32Array,
  isLand: Uint8Array,
  width: number,
  height: number,
  biomeConfig: BiomeConfig,
  config: StrategicConfig,
  out: StrategicPoint[],
  valueMap: Uint8Array
): void {
  const r = config.mountainPassRadius
  const spacing = r * 4
  const gridW = Math.ceil(width / spacing)
  const gridH = Math.ceil(height / spacing)
  const bestPerCell = new Float32Array(gridW * gridH)
  const bestIndex = new Int32Array(gridW * gridH)
  bestIndex.fill(-1)

  const highThreshold = biomeConfig.highlandElevation

  for (let y = r; y < height - r; y += 2) {
    for (let x = r; x < width - r; x += 2) {
      const i = y * width + x
      if (!isLand[i]) continue
      const elev = elevation[i]

      // The pass must be below mountain level
      if (elev >= biomeConfig.mountainElevation) continue
      // But reasonably high
      if (elev < highThreshold * 0.85) continue

      // Check that surrounding tiles have higher elevation (saddle point)
      let higherCount = 0
      let totalSampled = 0

      for (let dy = -r; dy <= r; dy += 3) {
        for (let dx = -r; dx <= r; dx += 3) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          totalSampled += 1
          if (elevation[ny * width + nx] > elev + 0.03) {
            higherCount += 1
          }
        }
      }

      if (totalSampled === 0) continue
      const ratio = higherCount / totalSampled
      // Need most of surrounding area to be higher
      if (ratio < 0.55) continue

      const score = ratio * (elev / biomeConfig.mountainElevation)

      const cx = Math.floor(x / spacing)
      const cy = Math.floor(y / spacing)
      const ci = cy * gridW + cx

      if (bestIndex[ci] === -1 || score > bestPerCell[ci]) {
        bestPerCell[ci] = score
        bestIndex[ci] = i
      }
    }
  }

  for (let ci = 0; ci < bestIndex.length; ci += 1) {
    const idx = bestIndex[ci]
    if (idx === -1) continue
    const x = idx % width
    const y = Math.floor(idx / width)
    const value = Math.min(10, Math.max(1, Math.round(bestPerCell[ci] * 10)))
    out.push({ x, y, type: 'mountain_pass', value })
    valueMap[idx] = Math.max(valueMap[idx], value)
  }
}

/* ------------------------------------------------------------------ */
/*  Straits                                                            */
/*  Narrow water channels between two landmasses.                      */
/* ------------------------------------------------------------------ */

function findStraits(
  _elevation: Float32Array,
  isLand: Uint8Array,
  width: number,
  height: number,
  _seaLevel: number,
  config: StrategicConfig,
  out: StrategicPoint[],
  valueMap: Uint8Array
): void {
  const maxW = config.straitMaxWidth
  const spacing = maxW * 4
  const gridW = Math.ceil(width / spacing)
  const gridH = Math.ceil(height / spacing)
  const bestPerCell = new Float32Array(gridW * gridH)
  const bestIndex = new Int32Array(gridW * gridH)
  bestIndex.fill(-1)

  // Scan horizontal straits (water with land above and below)
  for (let y = maxW; y < height - maxW; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const i = y * width + x
      if (isLand[i]) continue // Must be water

      // Find land distance going north and south
      let northDist = 0
      let southDist = 0

      for (let d = 1; d <= maxW; d += 1) {
        if (y - d >= 0 && isLand[(y - d) * width + x]) {
          northDist = d
          break
        }
      }
      for (let d = 1; d <= maxW; d += 1) {
        if (y + d < height && isLand[(y + d) * width + x]) {
          southDist = d
          break
        }
      }

      if (northDist === 0 || southDist === 0) continue
      const totalWidth = northDist + southDist

      // Narrower is more strategic
      const score = 1 - totalWidth / (maxW * 2)
      if (score <= 0) continue

      const cx = Math.floor(x / spacing)
      const cy = Math.floor(y / spacing)
      const ci = cy * gridW + cx

      if (bestIndex[ci] === -1 || score > bestPerCell[ci]) {
        bestPerCell[ci] = score
        bestIndex[ci] = i
      }
    }
  }

  // Scan vertical straits (water with land left and right)
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = maxW; x < width - maxW; x += 2) {
      const i = y * width + x
      if (isLand[i]) continue

      let westDist = 0
      let eastDist = 0

      for (let d = 1; d <= maxW; d += 1) {
        if (x - d >= 0 && isLand[y * width + (x - d)]) {
          westDist = d
          break
        }
      }
      for (let d = 1; d <= maxW; d += 1) {
        if (x + d < width && isLand[y * width + (x + d)]) {
          eastDist = d
          break
        }
      }

      if (westDist === 0 || eastDist === 0) continue
      const totalWidth = westDist + eastDist
      const score = 1 - totalWidth / (maxW * 2)
      if (score <= 0) continue

      const cx = Math.floor(x / spacing)
      const cy = Math.floor(y / spacing)
      const ci = cy * gridW + cx

      if (bestIndex[ci] === -1 || score > bestPerCell[ci]) {
        bestPerCell[ci] = score
        bestIndex[ci] = i
      }
    }
  }

  for (let ci = 0; ci < bestIndex.length; ci += 1) {
    const idx = bestIndex[ci]
    if (idx === -1) continue
    const x = idx % width
    const y = Math.floor(idx / width)
    const value = Math.min(10, Math.max(1, Math.round(bestPerCell[ci] * 8 + 2)))
    out.push({ x, y, type: 'strait', value })
    valueMap[idx] = Math.max(valueMap[idx], value)
  }
}

/* ------------------------------------------------------------------ */
/*  Peninsulas                                                         */
/*  Land jutting into water: mostly water neighbours in a radius.      */
/* ------------------------------------------------------------------ */

function findPeninsulas(
  isLand: Uint8Array,
  width: number,
  height: number,
  config: StrategicConfig,
  out: StrategicPoint[],
  valueMap: Uint8Array
): void {
  const r = config.peninsulaRadius
  const spacing = r * 5
  const gridW = Math.ceil(width / spacing)
  const gridH = Math.ceil(height / spacing)
  const bestPerCell = new Float32Array(gridW * gridH)
  const bestIndex = new Int32Array(gridW * gridH)
  bestIndex.fill(-1)

  for (let y = r; y < height - r; y += 3) {
    for (let x = r; x < width - r; x += 3) {
      const i = y * width + x
      if (!isLand[i]) continue // Must be on land

      let waterCount = 0
      let total = 0

      for (let dy = -r; dy <= r; dy += 2) {
        for (let dx = -r; dx <= r; dx += 2) {
          const dist = dx * dx + dy * dy
          if (dist > r * r) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          total += 1
          if (!isLand[ny * width + nx]) {
            waterCount += 1
          }
        }
      }

      if (total === 0) continue
      const waterRatio = waterCount / total

      // Peninsula: land tile surrounded by mostly water
      if (waterRatio < config.peninsulaMinRatio) continue

      // Make sure there's a "connection" back to mainland (not an island)
      // Check that at least some nearby land exists
      let nearLand = 0
      for (let dy = -3; dy <= 3; dy += 1) {
        for (let dx = -3; dx <= 3; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          if (isLand[ny * width + nx]) nearLand += 1
        }
      }
      if (nearLand < 4) continue // Too isolated — it's an island, not a peninsula

      const score = waterRatio

      const cx = Math.floor(x / spacing)
      const cy = Math.floor(y / spacing)
      const ci = cy * gridW + cx

      if (bestIndex[ci] === -1 || score > bestPerCell[ci]) {
        bestPerCell[ci] = score
        bestIndex[ci] = i
      }
    }
  }

  for (let ci = 0; ci < bestIndex.length; ci += 1) {
    const idx = bestIndex[ci]
    if (idx === -1) continue
    const x = idx % width
    const y = Math.floor(idx / width)
    const value = Math.min(10, Math.max(1, Math.round(bestPerCell[ci] * 10)))
    out.push({ x, y, type: 'peninsula', value })
    valueMap[idx] = Math.max(valueMap[idx], value)
  }
}

/* ------------------------------------------------------------------ */
/*  Render strategic overlay                                           */
/* ------------------------------------------------------------------ */

export function buildStrategicOverlay(
  baseImageData: ImageData,
  points: StrategicPoint[]
): ImageData {
  // Clone the base biome map
  const overlay = new ImageData(
    new Uint8ClampedArray(baseImageData.data),
    baseImageData.width,
    baseImageData.height
  )
  const data = overlay.data
  const w = overlay.width
  const h = overlay.height

  // Dim the base map slightly so markers pop
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.round(data[i] * 0.75)
    data[i + 1] = Math.round(data[i + 1] * 0.75)
    data[i + 2] = Math.round(data[i + 2] * 0.75)
  }

  for (const pt of points) {
    const color = STRATEGIC_META[pt.type].color
    // Diamond marker whose size scales with strategic value
    const markerR = Math.max(2, Math.round(pt.value / 2.5))

    for (let dy = -markerR; dy <= markerR; dy += 1) {
      for (let dx = -markerR; dx <= markerR; dx += 1) {
        if (Math.abs(dx) + Math.abs(dy) > markerR) continue // diamond shape
        const px = pt.x + dx
        const py = pt.y + dy
        if (px < 0 || py < 0 || px >= w || py >= h) continue

        const idx = (py * w + px) * 4
        const edgeDist = Math.abs(dx) + Math.abs(dy)
        const innerT = 1 - edgeDist / (markerR + 1)

        // Bright core, faded edges
        const alpha = innerT * 0.9 + 0.1
        data[idx] = Math.round(data[idx] * (1 - alpha) + color[0] * alpha)
        data[idx + 1] = Math.round(data[idx + 1] * (1 - alpha) + color[1] * alpha)
        data[idx + 2] = Math.round(data[idx + 2] * (1 - alpha) + color[2] * alpha)
      }
    }

    // White outline ring
    const outlineR = markerR + 1
    for (let dy = -outlineR; dy <= outlineR; dy += 1) {
      for (let dx = -outlineR; dx <= outlineR; dx += 1) {
        const dist = Math.abs(dx) + Math.abs(dy)
        if (dist !== outlineR) continue
        const px = pt.x + dx
        const py = pt.y + dy
        if (px < 0 || py < 0 || px >= w || py >= h) continue
        const idx = (py * w + px) * 4
        const blend = 0.6
        data[idx] = Math.round(data[idx] * (1 - blend) + 255 * blend)
        data[idx + 1] = Math.round(data[idx + 1] * (1 - blend) + 255 * blend)
        data[idx + 2] = Math.round(data[idx + 2] * (1 - blend) + 255 * blend)
      }
    }
  }

  return overlay
}
