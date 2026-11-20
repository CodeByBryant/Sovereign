/**
 * @module strategic
 * @description Strategic point types and display metadata.
 */

export type StrategicType = 'river_crossing' | 'mountain_pass' | 'strait' | 'peninsula'

export interface StrategicPoint {
  x: number
  y: number
  type: StrategicType
  value: number // 0-10
}

export const STRATEGIC_META: Record<
  StrategicType,
  { label: string; color: [number, number, number] }
> = {
  river_crossing: { label: 'River Crossing', color: [60, 180, 255] },
  mountain_pass: { label: 'Mountain Pass', color: [220, 160, 60] },
  strait: { label: 'Strait', color: [100, 220, 200] },
  peninsula: { label: 'Peninsula', color: [200, 100, 255] }
}
