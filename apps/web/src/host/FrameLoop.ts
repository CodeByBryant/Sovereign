/**
 * @module FrameLoop
 * @description Frame-rate-throttled render loop (display only; it is not the simulation clock).
 *
 * Uses `requestAnimationFrame` with an optional `setTimeout` delay
 * so the render rate stays near the configured target FPS, reducing
 * GPU/CPU load when high frame rates are unnecessary.
 */
import type { Renderer } from '@sovereign/renderer'
import { viewConfig } from '../viewConfig'

/**
 * Drives a {@link Renderer} at a target frame rate and reports the
 * measured FPS back through a callback.
 */
export class FrameLoop {
  private renderer: Renderer
  private running = false
  private lastTime = 0
  private frameCount = 0
  private elapsed = 0
  private onFps?: (fps: number) => void
  private targetFps = viewConfig.canvas.targetFps

  constructor(renderer: Renderer, onFps?: (fps: number) => void) {
    this.renderer = renderer
    this.onFps = onFps
  }

  /** Begin the render loop. Idempotent. */
  start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now()
    requestAnimationFrame(this.tick)
  }

  /** Halt the render loop. The next RAF callback will be a no-op. */
  stop(): void {
    this.running = false
  }

  /**
   * Core loop tick – called once per animation frame.
   * Counts frames, fires the FPS callback every second, then renders.
   */
  private tick = (time: number): void => {
    if (!this.running) return

    const delta = time - this.lastTime
    this.lastTime = time
    this.elapsed += delta
    this.frameCount += 1

    if (this.elapsed >= 1000) {
      const fps = Math.round((this.frameCount * 1000) / this.elapsed)
      this.frameCount = 0
      this.elapsed = 0
      this.onFps?.(fps)
    }

    this.renderer.render()

    const delay = Math.max(0, 1000 / this.targetFps - delta)
    if (delay > 0) {
      setTimeout(() => requestAnimationFrame(this.tick), delay)
    } else {
      requestAnimationFrame(this.tick)
    }
  }
}
