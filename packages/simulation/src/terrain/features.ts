/**
 * @module features
 * @description Derived terrain features that resource placement is conditioned on: how far a tile is
 * from something (a river, the coast), how steep it is, and whether it stands above or below its
 * surroundings (a ridge or a basin). Pure functions over typed arrays with no randomness; they use
 * only `+ - * /`, `Math.sqrt`, `Math.min`, `Math.max` and `Math.abs`.
 */

/** The largest distance a `Uint16Array` can hold; the default `limit` of `distanceToMask`. */
export const MAX_DISTANCE = 65535

/**
 * The number of 4-neighbour steps from each tile to the nearest tile where `mask` is non-zero (0 on
 * the mask itself), counted across the grid with no obstacles. Distances stop at `limit`: a tile
 * `limit` or more steps away (or with nothing masked at all) reads `limit`.
 */
export function distanceToMask(
  mask: Uint8Array,
  width: number,
  height: number,
  limit: number = MAX_DISTANCE
): Uint16Array {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DISTANCE) {
    throw new RangeError(`limit must be an integer from 1 to ${MAX_DISTANCE}`)
  }
  const size = width * height
  const distance = new Uint16Array(size).fill(limit)
  const queue = new Int32Array(size)
  let head = 0
  let tail = 0
  for (let i = 0; i < size; i += 1) {
    if (mask[i] !== 0) {
      distance[i] = 0
      queue[tail] = i
      tail += 1
    }
  }
  while (head < tail) {
    const index = queue[head]
    head += 1
    const next = distance[index] + 1
    if (next >= limit) continue
    const x = index % width
    const neighbours = [
      x > 0 ? index - 1 : -1,
      x < width - 1 ? index + 1 : -1,
      index >= width ? index - width : -1,
      index + width < size ? index + width : -1
    ]
    for (const n of neighbours) {
      if (n >= 0 && distance[n] > next) {
        distance[n] = next
        queue[tail] = n
        tail += 1
      }
    }
  }
  return distance
}

/**
 * The steepness of the ground: the magnitude of the elevation gradient per tile, by central
 * differences (one-sided at the map edge).
 */
export function slopeField(elevation: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const left = x > 0 ? elevation[i - 1] : elevation[i]
      const right = x < width - 1 ? elevation[i + 1] : elevation[i]
      const up = y > 0 ? elevation[i - width] : elevation[i]
      const down = y < height - 1 ? elevation[i + width] : elevation[i]
      const dx = (right - left) / (x > 0 && x < width - 1 ? 2 : 1)
      const dy = (down - up) / (y > 0 && y < height - 1 ? 2 : 1)
      out[i] = Math.sqrt(dx * dx + dy * dy)
    }
  }
  return out
}

/**
 * How far each tile stands above (positive) or below (negative) the mean of the tiles within
 * `radius` of it (a square window, clipped at the map edge, averaged over the tiles that exist).
 * Ridges and peaks are positive, valleys and basins negative. With a `include` mask only those tiles
 * are averaged (the sea is left out, so a coast is not mistaken for a ridge) and a tile outside it
 * reads 0.
 */
export function topographicPosition(
  elevation: Float32Array,
  width: number,
  height: number,
  radius: number,
  include?: Uint8Array
): Float32Array {
  if (!Number.isInteger(radius) || radius < 0) {
    throw new RangeError('radius must be a non-negative integer')
  }
  const size = width * height
  const out = new Float32Array(size)
  if (radius === 0) return out

  // box sums of the elevation and of the count of included tiles, in two passes: along each row,
  // then down each column
  const rowSum = new Float32Array(size)
  const rowCount = include === undefined ? undefined : new Float32Array(size)
  const prefixRow = new Float64Array(width + 1)
  const prefixRowCount = new Float64Array(width + 1)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const used = include === undefined || include[i] !== 0
      prefixRow[x + 1] = prefixRow[x] + (used ? elevation[i] : 0)
      prefixRowCount[x + 1] = prefixRowCount[x] + (used ? 1 : 0)
    }
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width - 1, x + radius)
      rowSum[y * width + x] = prefixRow[x1 + 1] - prefixRow[x0]
      if (rowCount !== undefined)
        rowCount[y * width + x] = prefixRowCount[x1 + 1] - prefixRowCount[x0]
    }
  }
  const prefixCol = new Float64Array(height + 1)
  const prefixColCount = new Float64Array(height + 1)
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      prefixCol[y + 1] = prefixCol[y] + rowSum[y * width + x]
      prefixColCount[y + 1] =
        prefixColCount[y] + (rowCount === undefined ? 0 : rowCount[y * width + x])
    }
    const x0 = Math.max(0, x - radius)
    const x1 = Math.min(width - 1, x + radius)
    for (let y = 0; y < height; y += 1) {
      const i = y * width + x
      if (include !== undefined && include[i] === 0) continue
      const y0 = Math.max(0, y - radius)
      const y1 = Math.min(height - 1, y + radius)
      const count =
        include === undefined
          ? (x1 - x0 + 1) * (y1 - y0 + 1)
          : prefixColCount[y1 + 1] - prefixColCount[y0]
      out[i] = elevation[i] - (prefixCol[y1 + 1] - prefixCol[y0]) / count
    }
  }
  return out
}
