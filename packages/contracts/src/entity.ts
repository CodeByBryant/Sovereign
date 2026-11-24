/**
 * @module entity
 * @description The kinds of thing that live in the entity store (units, later animals, buildings...). A kind
 * is one byte; 0 means the row is empty.
 */
export const EntityKind = {
  /** An empty row. */
  None: 0,
  /** A person: walks, works, carries. */
  Villager: 1
} as const

export type EntityKindId = (typeof EntityKind)[keyof typeof EntityKind]

/** The owner byte of an entity that belongs to no nation (the same value the ownership layer uses). */
export const NO_OWNER = 255
