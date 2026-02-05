// Configuration for the game
export class Config {
  // World settings
  static readonly WORLD_WIDTH = 512;
  static readonly WORLD_HEIGHT = 512;
  static readonly TILE_SIZE = 4;

  // Camera settings
  static readonly MIN_ZOOM = 0.5;
  static readonly MAX_ZOOM = 4.0;
  static readonly ZOOM_SPEED = 0.1;
  static readonly PAN_SPEED = 1.0;

  // Terrain generation settings
  static readonly NOISE_SCALE = 0.01;
  static readonly OCTAVES = 6;
  static readonly PERSISTENCE = 0.5;

  // Rendering
  static readonly TARGET_FPS = 60;
}
