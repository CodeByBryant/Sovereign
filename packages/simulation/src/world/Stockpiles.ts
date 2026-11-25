/**
 * @module Stockpiles
 * @description What each hall holds: one counter per resource (22), per hall. Villagers drop what they carry
 * home into their hall's counters. A hall is an entity row, so a stockpile is named by the hall's row id.
 * Saved in the save header (as JSON) and hashed, hall by hall in ascending id order, so the order halls were
 * opened in never matters.
 */
import { RESOURCE_CATALOG } from '@sovereign/contracts'

const KINDS = RESOURCE_CATALOG.length
const MAX = 4294967295

/** One hall's counters as a save holds them. */
export interface StockpileJson {
  hall: number
  /** Resource id 1 is `counts[0]`. */
  counts: number[]
}

export class Stockpiles {
  private readonly piles = new Map<number, Uint32Array>()

  /** Start a counter set for the hall with row id `hall`, everything at zero. */
  open(hall: number): void {
    if (!Number.isInteger(hall) || hall < 0) throw new RangeError('a hall is a row id, 0 or more')
    if (this.piles.has(hall)) throw new RangeError(`hall ${hall} already has a stockpile`)
    this.piles.set(hall, new Uint32Array(KINDS))
  }

  has(hall: number): boolean {
    return this.piles.has(hall)
  }

  /** The hall ids that have a stockpile, lowest first. */
  halls(): number[] {
    return [...this.piles.keys()].sort((a, b) => a - b)
  }

  private pile(hall: number): Uint32Array {
    const p = this.piles.get(hall)
    if (p === undefined) throw new RangeError(`hall ${hall} has no stockpile`)
    return p
  }

  private static slot(resource: number): number {
    if (!Number.isInteger(resource) || resource < 1 || resource > KINDS) {
      throw new RangeError(`resource ${resource} is not in the catalogue`)
    }
    return resource - 1
  }

  get(hall: number, resource: number): number {
    return this.pile(hall)[Stockpiles.slot(resource)] as number
  }

  /** A copy of a hall's counters: index 0 is resource 1. */
  counts(hall: number): Uint32Array {
    return this.pile(hall).slice()
  }

  add(hall: number, resource: number, amount: number): void {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new RangeError('an amount is a whole number of 0 or more')
    }
    const pile = this.pile(hall)
    const i = Stockpiles.slot(resource)
    const next = (pile[i] as number) + amount
    if (next > MAX) throw new RangeError(`the stockpile of hall ${hall} cannot hold ${next}`)
    pile[i] = next
  }

  /** How much of a resource every hall holds together. */
  total(resource: number): number {
    const i = Stockpiles.slot(resource)
    let sum = 0
    for (const pile of this.piles.values()) sum += pile[i] as number
    return sum
  }

  toJson(): StockpileJson[] {
    return this.halls().map((hall) => ({ hall, counts: Array.from(this.pile(hall)) }))
  }

  /** Rebuild from {@link toJson}; refuses anything that is not a list of halls, lowest first, with 22 counters each. */
  static fromJson(value: unknown): Stockpiles {
    if (!Array.isArray(value)) throw new RangeError('the stockpiles are not a list')
    const out = new Stockpiles()
    let previous = -1
    for (const entry of value as unknown[]) {
      if (typeof entry !== 'object' || entry === null)
        throw new RangeError('a stockpile is not an object')
      const { hall, counts } = entry as { hall?: unknown; counts?: unknown }
      if (typeof hall !== 'number' || !Number.isInteger(hall) || hall < 0) {
        throw new RangeError('a stockpile has a malformed hall')
      }
      if (hall <= previous) throw new RangeError('the stockpiles are out of order or repeated')
      previous = hall
      if (!Array.isArray(counts) || counts.length !== KINDS) {
        throw new RangeError(`a stockpile needs ${KINDS} counters`)
      }
      out.open(hall)
      const pile = out.pile(hall)
      counts.forEach((c: unknown, i) => {
        if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > MAX) {
          throw new RangeError('a stockpile counter is not a whole number from 0 to 4294967295')
        }
        pile[i] = c
      })
    }
    return out
  }
}
