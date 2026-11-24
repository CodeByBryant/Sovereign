/**
 * @module time
 * @description The speeds the player can run the world at, in in-game days per real second.
 */
export const SPEEDS = [1, 10, 100, 1000] as const

/** A speed from {@link SPEEDS}. */
export type Speed = (typeof SPEEDS)[number]

export const DEFAULT_SPEED: Speed = 10

export function isSpeed(value: number): value is Speed {
  return (SPEEDS as readonly number[]).includes(value)
}

/** The next speed up, or the same one at the top. */
export function fasterThan(speed: Speed): Speed {
  const next = SPEEDS[SPEEDS.indexOf(speed) + 1]
  return next ?? speed
}

/** The next speed down, or the same one at the bottom. */
export function slowerThan(speed: Speed): Speed {
  const previous = SPEEDS[SPEEDS.indexOf(speed) - 1]
  return previous ?? speed
}
