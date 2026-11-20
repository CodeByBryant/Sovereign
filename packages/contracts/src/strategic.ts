/**
 * @module strategic
 * @description Strategic point types and display metadata.
 */

export type StrategicType = 'river_crossing' | 'mountain_pass' | 'strait' | 'isthmus'

export interface StrategicPoint {
  x: number
  y: number
  type: StrategicType
  /** 1 to 10: how much of the route network has to go through it, and how narrow it is. */
  value: number
}

/** A place routes join: one of the best sites to live, found before the routes between them. */
export interface RouteHub {
  x: number
  y: number
  /** The site score (0 to 1): how much the place matters to the routes around it. */
  weight: number
}

/** The cheapest way between two neighbouring hubs. */
export interface StrategicRoute {
  /** Indices into the hub list, `from < to`. */
  from: number
  to: number
  /** The travel cost along it. */
  cost: number
  /** How many hub pairs need it (weighted by how much the hubs matter): its betweenness. */
  traffic: number
  /** The tiles along it as x, y pairs, from the first hub to the second. */
  path: number[]
}

export const STRATEGIC_META: Record<
  StrategicType,
  { label: string; color: [number, number, number] }
> = {
  river_crossing: { label: 'River Crossing', color: [60, 180, 255] },
  mountain_pass: { label: 'Mountain Pass', color: [220, 160, 60] },
  strait: { label: 'Strait', color: [100, 220, 200] },
  isthmus: { label: 'Isthmus', color: [200, 100, 255] }
}
