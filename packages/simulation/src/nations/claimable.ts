/**
 * @module claimable
 * @description Which provinces can belong to a nation. A province is claimable unless more than half of it
 * is ice (glacier or polar desert): nobody settles the ice, but a few icy tiles do not spoil a province.
 * Shared by the spawner (where capitals and starting territories go) and the expansion system (what a
 * nation can grow into).
 */
import { BIOME_INDEX } from '@sovereign/contracts'
import type { ProvinceMap } from '../terrain/provinces'

/** Biomes nobody settles: the ice. (Shore, mountains and the rest can be owned.) */
const UNCLAIMABLE = [BIOME_INDEX.glacier, BIOME_INDEX.polar_desert]

/** 1 for a province that can be owned, 0 for one that is mostly ice; one entry per province. */
export function claimableProvinces(map: ProvinceMap, biomeIds: Uint8Array): Uint8Array {
  const blocked = new Uint8Array(256)
  for (const biome of UNCLAIMABLE) blocked[biome] = 1
  const claimable = new Uint8Array(map.count)
  for (let p = 0; p < map.count; p += 1) {
    let ice = 0
    for (let k = map.start[p]; k < map.start[p + 1]; k += 1) ice += blocked[biomeIds[map.tiles[k]]]
    claimable[p] = ice * 2 <= map.area[p] ? 1 : 0
  }
  return claimable
}
