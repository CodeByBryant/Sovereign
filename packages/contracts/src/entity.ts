/**
 * @module entity
 * @description The kinds of thing that live in the entity store (units, later animals, buildings...). A kind
 * is one byte; 0 means the row is empty.
 */
export const EntityKind = {
  /** An empty row. */
  None: 0,
  /** A person: walks, works, carries. */
  Villager: 1,
  /** A hall: where a village's villagers live and drop what they gather. It never moves. */
  Hall: 2
} as const

export type EntityKindId = (typeof EntityKind)[keyof typeof EntityKind]

/** The owner byte of an entity that belongs to no nation (the same value the ownership layer uses). */
export const NO_OWNER = 255

/** What a villager is doing. */
export const UnitState = {
  /** Standing about; `wake` is the tick it next sets off. */
  Rest: 0,
  /** On a route toward `target`; it arrives at tick `wake` (= `legEnd`). */
  Walk: 1,
  /** Working a resource node (`goal`); it finishes at tick `wake`. */
  Work: 2,
  /** Walking home with what it gathered (`carriedType`, `carriedCount`); it arrives at tick `wake`. */
  Haul: 3
} as const

export type UnitStateId = (typeof UnitState)[keyof typeof UnitState]

/** Where every unit is right now, for a host to draw: one entry per living unit, by id. */
export interface UnitSnapshot {
  /** The tick the positions are for. */
  tick: number
  count: number
  id: Uint32Array
  kind: Uint8Array
  /** The index of the nation it belongs to, or {@link NO_OWNER}. */
  owner: Uint8Array
  /** Position in tiles (fractional while walking). */
  x: Float32Array
  y: Float32Array
}
