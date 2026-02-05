// Biome types enum
export enum BiomeType {
  DEEP_OCEAN = 'DEEP_OCEAN',
  OCEAN = 'OCEAN',
  SHALLOW_OCEAN = 'SHALLOW_OCEAN',
  BEACH = 'BEACH',
  GRASSLAND = 'GRASSLAND',
  FOREST = 'FOREST',
  RAINFOREST = 'RAINFOREST',
  DESERT = 'DESERT',
  SAVANNA = 'SAVANNA',
  TUNDRA = 'TUNDRA',
  TAIGA = 'TAIGA',
  SNOW = 'SNOW',
  ICE = 'ICE',
  MOUNTAINS = 'MOUNTAINS',
  HIGH_MOUNTAINS = 'HIGH_MOUNTAINS',
  SWAMP = 'SWAMP',
  WETLANDS = 'WETLANDS',
  VOLCANIC = 'VOLCANIC',
  LAVA = 'LAVA',
  CORAL_REEF = 'CORAL_REEF'
}

// Biome color palette - ~20 biomes as specified
export const BIOME_COLORS: Record<BiomeType, string> = {
  [BiomeType.DEEP_OCEAN]: '#001a33',
  [BiomeType.OCEAN]: '#003366',
  [BiomeType.SHALLOW_OCEAN]: '#0066cc',
  [BiomeType.BEACH]: '#f5deb3',
  [BiomeType.GRASSLAND]: '#7cba3d',
  [BiomeType.FOREST]: '#2d5016',
  [BiomeType.RAINFOREST]: '#0d3d0a',
  [BiomeType.DESERT]: '#e0c097',
  [BiomeType.SAVANNA]: '#c4a565',
  [BiomeType.TUNDRA]: '#ccddee',
  [BiomeType.TAIGA]: '#4a6f5a',
  [BiomeType.SNOW]: '#ffffff',
  [BiomeType.ICE]: '#c8e6ff',
  [BiomeType.MOUNTAINS]: '#7a7a7a',
  [BiomeType.HIGH_MOUNTAINS]: '#a9a9a9',
  [BiomeType.SWAMP]: '#4a5f3a',
  [BiomeType.WETLANDS]: '#6b8e5f',
  [BiomeType.VOLCANIC]: '#5c2626',
  [BiomeType.LAVA]: '#ff4500',
  [BiomeType.CORAL_REEF]: '#ff7f50'
};

// Biome names for display
export const BIOME_NAMES: Record<BiomeType, string> = {
  [BiomeType.DEEP_OCEAN]: 'Deep Ocean',
  [BiomeType.OCEAN]: 'Ocean',
  [BiomeType.SHALLOW_OCEAN]: 'Shallow Ocean',
  [BiomeType.BEACH]: 'Beach',
  [BiomeType.GRASSLAND]: 'Grassland',
  [BiomeType.FOREST]: 'Forest',
  [BiomeType.RAINFOREST]: 'Rainforest',
  [BiomeType.DESERT]: 'Desert',
  [BiomeType.SAVANNA]: 'Savanna',
  [BiomeType.TUNDRA]: 'Tundra',
  [BiomeType.TAIGA]: 'Taiga',
  [BiomeType.SNOW]: 'Snow',
  [BiomeType.ICE]: 'Ice',
  [BiomeType.MOUNTAINS]: 'Mountains',
  [BiomeType.HIGH_MOUNTAINS]: 'High Mountains',
  [BiomeType.SWAMP]: 'Swamp',
  [BiomeType.WETLANDS]: 'Wetlands',
  [BiomeType.VOLCANIC]: 'Volcanic',
  [BiomeType.LAVA]: 'Lava',
  [BiomeType.CORAL_REEF]: 'Coral Reef'
};

/**
 * Determine biome based on elevation, temperature, and humidity
 * Decision tree as specified in requirements:
 * - if elevation < 0.4: OCEAN biomes
 * - if temp < 0.2: FROZEN biomes
 * - if temp < 0.4: COLD biomes
 * - if temp < 0.7: TEMPERATE biomes
 * - if temp > 0.7: HOT biomes
 * (then subdivide by humidity)
 */
export function determineBiome(
  elevation: number,
  temp: number,
  humidity: number
): BiomeType {
  // Ocean biomes (elevation < 0.4)
  if (elevation < 0.4) {
    if (elevation < 0.25) {
      return BiomeType.DEEP_OCEAN;
    } else if (elevation < 0.35) {
      return BiomeType.OCEAN;
    } else if (elevation < 0.38) {
      return temp > 0.6 ? BiomeType.CORAL_REEF : BiomeType.SHALLOW_OCEAN;
    } else {
      return BiomeType.BEACH;
    }
  }

  // High elevation (mountains)
  if (elevation > 0.75) {
    if (elevation > 0.85) {
      return temp > 0.7 ? BiomeType.VOLCANIC : BiomeType.HIGH_MOUNTAINS;
    }
    return temp < 0.3 ? BiomeType.SNOW : BiomeType.MOUNTAINS;
  }

  // FROZEN biomes (temp < 0.2)
  if (temp < 0.2) {
    if (elevation > 0.6) {
      return BiomeType.ICE;
    }
    return humidity > 0.5 ? BiomeType.ICE : BiomeType.TUNDRA;
  }

  // COLD biomes (temp < 0.4)
  if (temp < 0.4) {
    if (humidity < 0.3) {
      return BiomeType.TUNDRA;
    }
    return BiomeType.TAIGA;
  }

  // TEMPERATE biomes (temp < 0.7)
  if (temp < 0.7) {
    if (humidity < 0.2) {
      return BiomeType.DESERT;
    } else if (humidity < 0.4) {
      return BiomeType.GRASSLAND;
    } else if (humidity < 0.7) {
      return BiomeType.FOREST;
    } else {
      return elevation > 0.5 ? BiomeType.FOREST : BiomeType.WETLANDS;
    }
  }

  // HOT biomes (temp > 0.7)
  if (humidity < 0.2) {
    return elevation > 0.65 ? BiomeType.LAVA : BiomeType.DESERT;
  } else if (humidity < 0.4) {
    return BiomeType.SAVANNA;
  } else if (humidity < 0.7) {
    return BiomeType.GRASSLAND;
  } else {
    if (elevation < 0.45) {
      return BiomeType.SWAMP;
    }
    return BiomeType.RAINFOREST;
  }
}
