import { generatePerlinNoise } from '../utils/PerlinNoise';
import { Config } from './Config';
import { BiomeType, determineBiome } from './Biome';

export interface Tile {
  elevation: number;
  temperature: number;
  humidity: number;
  biome: BiomeType;
}

export class WorldMap {
  public tiles: Tile[][];
  public width: number;
  public height: number;

  constructor(width: number = Config.WORLD_WIDTH, height: number = Config.WORLD_HEIGHT) {
    this.width = width;
    this.height = height;
    this.tiles = [];
  }

  /**
   * Generate the world map with elevation, temperature, humidity, and biomes
   */
  public generate(onProgress?: (progress: number) => void): void {
    const totalTiles = this.width * this.height;
    
    // Generate noise layers
    if (onProgress) onProgress(0.1);
    const elevationNoise = generatePerlinNoise(this.width, this.height, {
      octaveCount: Config.OCTAVES,
      amplitude: 1.0,
      persistence: Config.PERSISTENCE
    });
    
    if (onProgress) onProgress(0.3);
    const temperatureNoise = generatePerlinNoise(this.width, this.height, {
      octaveCount: 4,
      amplitude: 1.0,
      persistence: 0.4
    });
    
    if (onProgress) onProgress(0.5);
    const humidityNoise = generatePerlinNoise(this.width, this.height, {
      octaveCount: 4,
      amplitude: 1.0,
      persistence: 0.4
    });

    if (onProgress) onProgress(0.7);
    
    // Generate tiles with biomes
    this.tiles = [];
    for (let y = 0; y < this.height; y++) {
      const row: Tile[] = [];
      for (let x = 0; x < this.width; x++) {
        const idx = y * this.width + x;
        
        // Normalize values to 0-1 range
        let elevation = elevationNoise[idx];
        
        // Apply latitude-based temperature gradient (colder at poles)
        const latitude = Math.abs((y / this.height) - 0.5) * 2; // 0 at equator, 1 at poles
        let temperature = temperatureNoise[idx] * (1 - latitude * 0.7);
        
        // Apply temperature-based humidity modification
        let humidity = humidityNoise[idx];
        
        // Normalize to 0-1 range
        elevation = this.normalize(elevation);
        temperature = this.normalize(temperature);
        humidity = this.normalize(humidity);
        
        // Determine biome
        const biome = determineBiome(elevation, temperature, humidity);
        
        row.push({
          elevation,
          temperature,
          humidity,
          biome
        });
      }
      this.tiles.push(row);
      
      // Update progress
      if (onProgress && y % 10 === 0) {
        onProgress(0.7 + (y / this.height) * 0.3);
      }
    }
    
    if (onProgress) onProgress(1.0);
  }

  /**
   * Normalize a value to 0-1 range
   */
  private normalize(value: number): number {
    // Perlin noise typically returns values in a range, normalize to 0-1
    return Math.max(0, Math.min(1, (value + 1) / 2));
  }

  /**
   * Get tile at coordinates
   */
  public getTile(x: number, y: number): Tile | null {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return null;
    }
    return this.tiles[y][x];
  }
}
