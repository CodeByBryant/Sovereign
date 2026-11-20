/**
 * The simulation's notion of time: a whole number of ticks, each lasting a fixed `deltaTime`.
 * `time` is `tick * deltaTime`, computed by multiplication and never accumulated, so it carries no
 * rounding drift. No wall-clock source is read anywhere in the engine.
 */
export class SimulationClock {
  /** In-game time per tick (days, for the default config). */
  readonly deltaTime: number
  private currentTick: number

  constructor(deltaTime: number, tick = 0) {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) {
      throw new RangeError('deltaTime must be a finite number greater than 0')
    }
    if (!Number.isSafeInteger(tick) || tick < 0) {
      throw new RangeError('tick must be a non-negative safe integer')
    }
    this.deltaTime = deltaTime
    this.currentTick = tick
  }

  get tick(): number {
    return this.currentTick
  }

  get time(): number {
    return this.currentTick * this.deltaTime
  }

  /** Move to the next tick. */
  advance(): void {
    if (this.currentTick >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError('tick would exceed the largest safe integer')
    }
    this.currentTick += 1
  }
}
