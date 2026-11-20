/**
 * @module Camera
 * @description Viewport camera with pan, zoom and coordinate transforms.
 *
 * The camera is the single source of truth for the view-space transform
 * applied to the canvas every frame. All world-space coordinates are
 * relative to `(0, 0)` at the map centre.
 */

/** Options accepted by the {@link Camera} constructor. */
export interface CameraOptions {
  /** Initial X offset in world units. @default 0 */
  x?: number
  /** Initial Y offset in world units. @default 0 */
  y?: number
  /** Initial zoom level. @default 1 */
  zoom?: number
  /** Minimum zoom (fully zoomed out). @default 0.4 */
  minZoom?: number
  /** Maximum zoom (fully zoomed in). @default 3 */
  maxZoom?: number
}

/**
 * A 2-D pan/zoom camera that transforms canvas draw calls so the
 * visible portion of the world map tracks user input.
 */
export class Camera {
  /** Current X offset in world units. */
  x: number
  /** Current Y offset in world units. */
  y: number
  /** Current zoom multiplier. */
  zoom: number
  /** Floor for {@link zoom}. */
  minZoom: number
  /** Ceiling for {@link zoom}. */
  maxZoom: number

  constructor(options: CameraOptions = {}) {
    this.x = options.x ?? 0
    this.y = options.y ?? 0
    this.zoom = options.zoom ?? 1
    this.minZoom = options.minZoom ?? 0.4
    this.maxZoom = options.maxZoom ?? 3
  }

  /** Translate the camera by screen-space pixel deltas. */
  pan(deltaX: number, deltaY: number): void {
    this.x -= deltaX / this.zoom
    this.y -= deltaY / this.zoom
  }

  /**
   * Zoom towards a screen-space anchor point so the world position
   * under the cursor stays fixed.
   */
  zoomAt(
    scale: number,
    anchorX: number,
    anchorY: number,
    viewportWidth: number,
    viewportHeight: number
  ): void {
    const worldBefore = this.screenToWorld(anchorX, anchorY, viewportWidth, viewportHeight)
    this.zoom = this.clampZoom(this.zoom * scale)
    const worldAfter = this.screenToWorld(anchorX, anchorY, viewportWidth, viewportHeight)

    this.x += worldBefore.x - worldAfter.x
    this.y += worldBefore.y - worldAfter.y
  }

  /** Push the full view transform onto a `CanvasRenderingContext2D`. */
  applyTransform(
    ctx: CanvasRenderingContext2D,
    viewportWidth: number,
    viewportHeight: number
  ): void {
    ctx.translate(viewportWidth / 2, viewportHeight / 2)
    ctx.scale(this.zoom, this.zoom)
    ctx.translate(-this.x, -this.y)
  }

  /** Convert a screen-space pixel position to world coordinates. */
  screenToWorld(
    screenX: number,
    screenY: number,
    viewportWidth: number,
    viewportHeight: number
  ): { x: number; y: number } {
    return {
      x: (screenX - viewportWidth / 2) / this.zoom + this.x,
      y: (screenY - viewportHeight / 2) / this.zoom + this.y
    }
  }

  /** Clamp a zoom value to the configured min/max range. */
  private clampZoom(value: number): number {
    return Math.min(this.maxZoom, Math.max(this.minZoom, value))
  }
}
