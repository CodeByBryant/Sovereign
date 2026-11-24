import type { CostGrid } from '../../src/terrain/cost'

/**
 * A cost grid drawn as text, one character per cell (the cell is 4 tiles):
 *   .  open land (cost 1)    #  rough ground (cost 10)    ~  a sea lane (cost 5, water)    x  closed (Infinity)
 */
export function drawGrid(rows: string[]): { grid: CostGrid; at: (x: number, y: number) => number } {
  const height = rows.length
  const cols = rows[0]!.length
  const cost = new Float32Array(cols * height)
  const land = new Uint8Array(cols * height)
  rows.forEach((row, y) => {
    if (row.length !== cols) throw new Error('every row must be as long as the first')
    ;[...row].forEach((ch, x) => {
      const c = y * cols + x
      if (ch === '.') [cost[c], land[c]] = [1, 1]
      else if (ch === '#') [cost[c], land[c]] = [10, 1]
      else if (ch === '~') [cost[c], land[c]] = [5, 0]
      else [cost[c], land[c]] = [Infinity, 0]
    })
  })
  return { grid: { cell: 4, cols, rows: height, cost, land }, at: (x, y) => y * cols + x }
}
