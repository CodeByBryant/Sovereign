/**
 * @module Pacer
 * @description Turns real time into whole simulation ticks: given how long a frame took and the speed
 * (in-game days per real second), how many ticks to run now. It keeps the fraction it could not run yet,
 * so frames of any length add up to the right pace.
 *
 * Two guards keep a slow moment from becoming a spiral: a stall (a hidden tab) catches up by at most
 * `MAX_FRAME_MS`, and a request is capped at `maxTicks`, the rest of the backlog dropped rather than
 * carried (it would only be asked for again next frame, forever).
 */

/** The longest stretch of real time one frame is allowed to account for. */
export const MAX_FRAME_MS = 250

export class Pacer {
  private carry = 0

  constructor(private readonly maxTicks = 5000) {}

  /** The whole ticks to run for `dtMs` of real time at `daysPerSecond`, a tick being `timestep` days. */
  advance(dtMs: number, daysPerSecond: number, timestep: number): number {
    if (!(daysPerSecond > 0) || !(timestep > 0)) return 0
    const elapsed = Math.min(Math.max(dtMs, 0), MAX_FRAME_MS)
    const due = this.carry + (elapsed / 1000) * (daysPerSecond / timestep)
    const ticks = Math.floor(due)
    if (ticks > this.maxTicks) return this.maxTicks // the rest of the backlog is dropped, not carried
    this.carry = due - ticks
    return ticks
  }

  /** Forget the fraction kept (after a pause, or for a new world). */
  reset(): void {
    this.carry = 0
  }
}
