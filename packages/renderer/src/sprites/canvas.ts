/**
 * @module sprites/canvas
 * @description A tiny RGBA pixel canvas for drawing sprites in code. Everything is whole pixels and
 * fully opaque or fully clear (crisp pixel art), and every operation is deterministic: integer
 * coordinates and `+ - * /` only, so the same drawing gives the same bytes on every engine.
 */
export type Rgb = readonly [number, number, number]

const clampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v))

/** A colour scaled by `k` (above 1 lighter, below 1 darker), per channel and clamped. */
export function shade(c: Rgb, k: number): Rgb {
  return [clampByte(c[0] * k), clampByte(c[1] * k), clampByte(c[2] * k)]
}

/** A colour moved a fraction `t` of the way to white. */
export function tint(c: Rgb, t: number): Rgb {
  return [
    clampByte(c[0] + (255 - c[0]) * t),
    clampByte(c[1] + (255 - c[1]) * t),
    clampByte(c[2] + (255 - c[2]) * t)
  ]
}

export class PixelCanvas {
  readonly rgba: Uint8ClampedArray

  constructor(
    readonly width: number,
    readonly height: number
  ) {
    this.rgba = new Uint8ClampedArray(width * height * 4)
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  /** Paint one pixel; anything off the canvas is ignored. */
  set(x: number, y: number, c: Rgb): void {
    if (!this.inside(x, y)) return
    const p = (y * this.width + x) * 4
    this.rgba[p] = c[0]
    this.rgba[p + 1] = c[1]
    this.rgba[p + 2] = c[2]
    this.rgba[p + 3] = 255
  }

  solid(x: number, y: number): boolean {
    return this.inside(x, y) && this.rgba[(y * this.width + x) * 4 + 3] === 255
  }

  fillRect(x: number, y: number, w: number, h: number, c: Rgb): void {
    for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) this.set(x + i, y + j, c)
  }

  /** A filled ellipse with a light side (up and left) and a shadow side (down and right). */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: Rgb): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
        const dx = (x - cx) / rx
        const dy = (y - cy) / ry
        if (dx * dx + dy * dy > 1) continue
        const side = (dx + dy) / 2
        this.set(x, y, side < -0.3 ? shade(c, 1.22) : side > 0.3 ? shade(c, 0.74) : c)
      }
    }
  }

  /** A one-pixel line (Bresenham). */
  line(x0: number, y0: number, x1: number, y1: number, c: Rgb): void {
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    let x = x0
    let y = y0
    for (;;) {
      this.set(x, y, c)
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

  /** How many pixels are painted. */
  count(): number {
    let n = 0
    for (let p = 3; p < this.rgba.length; p += 4) if (this.rgba[p] === 255) n += 1
    return n
  }

  /** Paint a one-pixel outline around everything drawn (on the clear pixels that touch it, 4-way). */
  outline(c: Rgb): void {
    const marks: number[] = []
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        if (this.solid(x, y)) continue
        if (
          this.solid(x - 1, y) ||
          this.solid(x + 1, y) ||
          this.solid(x, y - 1) ||
          this.solid(x, y + 1)
        ) {
          marks.push(x, y)
        }
      }
    }
    for (let i = 0; i < marks.length; i += 2)
      this.set(marks[i] as number, marks[i + 1] as number, c)
  }

  /** Copy this canvas into a larger RGBA buffer at (x, y). */
  blitTo(target: Uint8ClampedArray, targetWidth: number, x: number, y: number): void {
    for (let j = 0; j < this.height; j += 1) {
      const from = j * this.width * 4
      target.set(this.rgba.subarray(from, from + this.width * 4), ((y + j) * targetWidth + x) * 4)
    }
  }
}
