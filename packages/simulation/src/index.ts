/**
 * @module @sovereign/simulation
 * @description The headless world engine: terrain generation, world map, nations.
 * Depends only on `@sovereign/contracts` and `@sovereign/config`.
 */
export * from './nations/ColorGenerator'
export * from './nations/FlagGenerator'
export * from './nations/NameGenerator'
export * from './nations/Nation'
export * from './nations/NationSpawner'
export * from './terrain/TerrainGenerator'
export * from './terrain/biomes'
export * from './terrain/resources'
export * from './terrain/rivers'
export * from './terrain/strategic'
export * from './world/WorldMap'
