/**
 * @module Renderer
 * @description Chunked bitmap renderer with viewport culling.
 *
 * The map is split into tile-sized {@link ImageBitmap} chunks.  Each
 * frame only the chunks overlapping the visible viewport are drawn,
 * keeping the number of `drawImage` calls bounded regardless of map
 * size.  `imageSmoothingEnabled = false` preserves the pixel-art look.
 */
import { Camera } from '../camera/Camera'
import { defaultConfig } from '../../config/Config'

/** A single pre-rasterised map chunk ready for compositing. */
export interface MapChunk {
  /** GPU-backed bitmap data. */
  bitmap: ImageBitmap
  /** X offset in world-pixel space. */
  x: number
  /** Y offset in world-pixel space. */
  y: number
  /** Width in world pixels. */
  width: number
  /** Height in world pixels. */
  height: number
}

/**
 * Canvas 2-D renderer that composites an array of {@link MapChunk}s
 * every frame, culling any chunks outside the camera viewport.
 */
export class Renderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private camera: Camera
  private dpr = window.devicePixelRatio || 1
  private background = defaultConfig.canvas.background
  private chunks: MapChunk[] = []
  private mapWidth = 0
  private mapHeight = 0

  /** Cached half-dimensions to avoid recomputing every frame. */
  private halfWidth = 0
  private halfHeight = 0

  constructor(canvas: HTMLCanvasElement, camera: Camera) {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable')
    }

    this.canvas = canvas
    this.ctx = ctx
    this.camera = camera
    this.resize()
  }

  /** Re-sync the canvas backing store with its CSS layout size. */
  resize(): void {
    const { width, height } = this.getViewportSize()
    this.dpr = window.devicePixelRatio || 1

    this.canvas.width = Math.max(1, Math.floor(width * this.dpr))
    this.canvas.height = Math.max(1, Math.floor(height * this.dpr))
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
  }

  /**
   * Draw one frame.
   *
   * Clears the background, applies the camera transform, then iterates
   * the chunk list drawing only those that overlap the current viewport.
   */
  render(): void {
    const { width, height } = this.getViewportSize()
    const ctx = this.ctx

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.fillStyle = this.background
    ctx.fillRect(0, 0, width, height)

    if (this.chunks.length === 0) return

    ctx.save()
    this.camera.applyTransform(ctx, width, height)
    ctx.imageSmoothingEnabled = false

    // Compute visible bounds in world space
    const invZoom = 1 / this.camera.zoom
    const halfViewW = width * invZoom * 0.5
    const halfViewH = height * invZoom * 0.5
    const viewLeft = this.camera.x - halfViewW
    const viewRight = this.camera.x + halfViewW
    const viewTop = this.camera.y - halfViewH
    const viewBottom = this.camera.y + halfViewH

    const hw = this.halfWidth
    const hh = this.halfHeight

    for (let i = 0, len = this.chunks.length; i < len; i += 1) {
      const chunk = this.chunks[i]
      const drawX = -hw + chunk.x
      const drawY = -hh + chunk.y

      // Frustum cull
      if (
        drawX + chunk.width < viewLeft ||
        drawX > viewRight ||
        drawY + chunk.height < viewTop ||
        drawY > viewBottom
      ) {
        continue
      }

      ctx.drawImage(chunk.bitmap, drawX, drawY, chunk.width, chunk.height)
    }

    ctx.restore()
  }

  /** Return CSS-pixel dimensions of the canvas element. */
  getViewportSize(): { width: number; height: number } {
    return {
      width: this.canvas.clientWidth,
      height: this.canvas.clientHeight
    }
  }

  /**
   * Replace the current chunk set.
   *
   * @param chunks  Pre-built bitmap chunks.
   * @param width   Total map width in world pixels.
   * @param height  Total map height in world pixels.
   */
  setMapChunks(chunks: MapChunk[], width: number, height: number): void {
    this.chunks = chunks
    this.mapWidth = width
    this.mapHeight = height
    this.halfWidth = width / 2
    this.halfHeight = height / 2
  }
}
