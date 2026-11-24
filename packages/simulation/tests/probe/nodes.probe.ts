// A measurement, not a test: what would resource nodes as entities cost? Turns the two resource slots of a
// 2000 x 2000 world into passive struct-of-arrays rows and measures what the design needs (ADR 0008, M0):
// how many rows there are, how long they take to build, the memory they use, a spatial index for "the nearest
// tree" (a grid of cells holding the nodes of each kind), the time of that query for common and rare kinds,
// and what hashing and saving the rows costs against the six tile layers they would replace.
//
//   pnpm --filter @sovereign/simulation probe -- tests/probe/nodes.probe.ts
//
// PROBE_SEEDS=1337,1 picks the worlds.
import { it } from 'vitest'
import { performance } from 'node:perf_hooks'
import { RESOURCE_CATALOG } from '@sovereign/contracts'
import { ByteHasher } from '../../src/serialization/hash'
import { World } from '../../src/world/World'

const seeds = (process.env.PROBE_SEEDS ?? '1337')
  .split(',')
  .map((s) => Number.parseInt(s, 10))
  .filter((n) => Number.isInteger(n))

const CELL = 8 // tiles per index cell

it('measures resource nodes as rows', () => {
  const lines: string[] = []
  for (const seed of seeds) {
    const world = World.create({ seed, config: { nations: { count: 0 } } })
    const t = world.terrain
    const { width, height } = t
    const size = width * height
    const lap = <T>(name: string, f: () => T): T => {
      const s = performance.now()
      const r = f()
      lines.push(`  ${name.padEnd(46)} ${(performance.now() - s).toFixed(0).padStart(6)} ms`)
      return r
    }
    lines.push(`seed ${seed}: ${width}x${height}, ${RESOURCE_CATALOG.length} resource kinds`)

    // 1. rows from the two slots (surface first, then ground), in tile order
    let rows = 0
    for (const layer of ['surface', 'ground'] as const) {
      const slot = t.resources[layer]
      for (let i = 0; i < size; i += 1) if (slot.type[i] !== 0) rows += 1
    }
    const kind = new Uint8Array(rows)
    const tile = new Uint32Array(rows)
    const amount = new Uint8Array(rows)
    const richness = new Uint8Array(rows)
    const stage = new Uint8Array(rows) // growth stage: room for lifecycles
    const age = new Uint16Array(rows)
    lap(`build ${rows} rows from the slots`, () => {
      let r = 0
      for (const layer of ['surface', 'ground'] as const) {
        const slot = t.resources[layer]
        for (let i = 0; i < size; i += 1) {
          const type = slot.type[i] as number
          if (type === 0) continue
          kind[r] = type
          tile[r] = i
          amount[r] = slot.stock[i] as number
          richness[r] = slot.richness[i] as number
          r += 1
        }
      }
    })
    const rowBytes =
      kind.byteLength +
      tile.byteLength +
      amount.byteLength +
      richness.byteLength +
      stage.byteLength +
      age.byteLength
    lines.push(
      `  rows ${rows} (${((100 * rows) / size).toFixed(1)}% of tiles); ${(rowBytes / 1e6).toFixed(1)} MB of columns (${(rowBytes / rows).toFixed(1)} bytes a row)`
    )

    // 2. tile -> node id for each slot (so a tile finds its node in O(1))
    const surfaceNode = new Int32Array(size).fill(-1)
    const groundNode = new Int32Array(size).fill(-1)
    lap('tile -> node id maps (2 x 4M x int32)', () => {
      for (let r = 0; r < rows; r += 1) {
        const layer = (RESOURCE_CATALOG[(kind[r] as number) - 1] as { layer: string }).layer
        ;(layer === 'surface' ? surfaceNode : groundNode)[tile[r] as number] = r
      }
    })
    lines.push(
      `  id maps ${((surfaceNode.byteLength + groundNode.byteLength) / 1e6).toFixed(0)} MB`
    )

    // 3. a spatial index: for each cell and kind, the nodes in it (CSR by kind, then cell)
    const cols = Math.ceil(width / CELL)
    const cellRows = Math.ceil(height / CELL)
    const cells = cols * cellRows
    const kinds = RESOURCE_CATALOG.length + 1
    let start: Uint32Array = new Uint32Array(0)
    let list: Uint32Array = new Uint32Array(0)
    lap('spatial index (counting sort by kind and cell)', () => {
      start = new Uint32Array(kinds * cells + 1)
      for (let r = 0; r < rows; r += 1) {
        const x = (tile[r] as number) % width
        const y = ((tile[r] as number) - x) / width
        start[
          (kind[r] as number) * cells + Math.floor(y / CELL) * cols + Math.floor(x / CELL) + 1
        ] += 1
      }
      for (let k = 1; k < start.length; k += 1) start[k] += start[k - 1] as number
      list = new Uint32Array(rows)
      const fill = start.slice(0, start.length - 1)
      for (let r = 0; r < rows; r += 1) {
        const x = (tile[r] as number) % width
        const y = ((tile[r] as number) - x) / width
        const slotIndex =
          (kind[r] as number) * cells + Math.floor(y / CELL) * cols + Math.floor(x / CELL)
        list[fill[slotIndex] as number] = r
        fill[slotIndex] += 1
      }
    })
    lines.push(`  index ${((start.byteLength + list.byteLength) / 1e6).toFixed(1)} MB`)

    // 4. nearest node of a kind to a tile: ring search over cells, outward until found
    const nearest = (type: number, x: number, y: number, maxRing: number): number => {
      const cx = Math.floor(x / CELL)
      const cy = Math.floor(y / CELL)
      let best = -1
      let bestD = Infinity
      for (let ring = 0; ring <= maxRing; ring += 1) {
        if (best >= 0 && (ring - 1) * CELL > Math.sqrt(bestD)) break
        for (let dy = -ring; dy <= ring; dy += 1) {
          for (let dx = -ring; dx <= ring; dx += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
            const gx = cx + dx
            const gy = cy + dy
            if (gx < 0 || gy < 0 || gx >= cols || gy >= cellRows) continue
            const slotIndex = type * cells + gy * cols + gx
            for (let k = start[slotIndex] as number; k < (start[slotIndex + 1] as number); k += 1) {
              const r = list[k] as number
              const nx = (tile[r] as number) % width
              const ny = ((tile[r] as number) - nx) / width
              const d = (nx - x) * (nx - x) + (ny - y) * (ny - y)
              if (d < bestD || (d === bestD && r < best)) {
                bestD = d
                best = r
              }
            }
          }
        }
      }
      return best
    }
    // sample query points on land (from the first nodes), per kind
    const share = new Uint32Array(kinds)
    for (let r = 0; r < rows; r += 1) share[kind[r] as number] += 1
    const order = Array.from({ length: kinds - 1 }, (_, i) => i + 1).sort(
      (a, b) => (share[b] as number) - (share[a] as number)
    )
    const common = order[0] as number
    const rare = order[order.length - 1] as number
    const mid = order[Math.floor(order.length / 2)] as number
    for (const [label, type] of [
      ['commonest', common],
      ['median', mid],
      ['rarest', rare]
    ] as const) {
      let found = 0
      const s = performance.now()
      const N = 2000
      for (let q = 0; q < N; q += 1) {
        const p = tile[(q * 7919) % rows] as number
        const px = p % width
        const py = (p - px) / width
        if (nearest(type, px, py, 200) >= 0) found += 1
      }
      const us = ((performance.now() - s) / N) * 1000
      const def = RESOURCE_CATALOG[type - 1] as { key: string }
      lines.push(
        `  nearest ${def.key.padEnd(10)} (${label}, ${share[type]} nodes): ${us.toFixed(1)} us per query, found ${found}/${N}`
      )
    }

    // 5. hashing and saving the rows, against the six tile layers they would replace
    lap('hash the rows (6 columns)', () => {
      const h = new ByteHasher()
      h.writeUint8Array(kind)
      h.writeUint8Array(amount)
      h.writeUint8Array(richness)
      h.writeUint8Array(stage)
      for (let r = 0; r < rows; r += 1) h.writeUint32(tile[r] as number)
      for (let r = 0; r < rows; r += 1) h.writeUint32(age[r] as number)
      h.digest()
    })
    lap('hash the six tile layers (as it is now)', () => {
      const h = new ByteHasher()
      for (const layer of ['surface', 'ground'] as const) {
        h.writeUint8Array(t.resources[layer].type)
        h.writeUint8Array(t.resources[layer].richness)
        h.writeUint8Array(t.resources[layer].stock)
      }
      h.digest()
    })
    lines.push(
      `  save size: rows ${(rowBytes / 1e6).toFixed(1)} MB against the six layers ${(6 * size) / 1e6} MB`
    )
    const mem = process.memoryUsage()
    lines.push(
      `  process rss ${(mem.rss / 1e6).toFixed(0)} MB, heap used ${(mem.heapUsed / 1e6).toFixed(0)} MB, array buffers ${(mem.arrayBuffers / 1e6).toFixed(0)} MB`
    )
  }
  console.log('\n' + lines.join('\n') + '\n')
}, 900000)
