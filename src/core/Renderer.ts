import { WorldMap } from './WorldMap';
import { Camera } from './Camera';
import { Config } from './Config';
import { BIOME_COLORS } from './Biome';

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private worldMap: WorldMap;
  private camera: Camera;
  private showBiomes: boolean = true;

  constructor(canvas: HTMLCanvasElement, worldMap: WorldMap, camera: Camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.worldMap = worldMap;
    this.camera = camera;
    
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  public setShowBiomes(show: boolean): void {
    this.showBiomes = show;
  }

  public toggleBiomes(): void {
    this.showBiomes = !this.showBiomes;
  }

  /**
   * Render the world map
   */
  public render(): void {
    // Clear canvas
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Calculate visible tiles
    const startX = Math.floor(this.camera.x / Config.TILE_SIZE);
    const startY = Math.floor(this.camera.y / Config.TILE_SIZE);
    const endX = Math.ceil((this.camera.x + this.canvas.width / this.camera.zoom) / Config.TILE_SIZE);
    const endY = Math.ceil((this.camera.y + this.canvas.height / this.camera.zoom) / Config.TILE_SIZE);

    // Clamp to world bounds
    const minX = Math.max(0, startX);
    const minY = Math.max(0, startY);
    const maxX = Math.min(this.worldMap.width, endX);
    const maxY = Math.min(this.worldMap.height, endY);

    // Render tiles
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const tile = this.worldMap.getTile(x, y);
        if (!tile) continue;

        // Calculate screen position
        const worldX = x * Config.TILE_SIZE;
        const worldY = y * Config.TILE_SIZE;
        const screenPos = this.camera.worldToScreen(worldX, worldY);
        const tileSize = Config.TILE_SIZE * this.camera.zoom;

        // Choose color based on mode
        let color: string;
        if (this.showBiomes) {
          // Biome color
          color = BIOME_COLORS[tile.biome];
        } else {
          // Elevation grayscale
          const gray = Math.floor(tile.elevation * 255);
          color = `rgb(${gray}, ${gray}, ${gray})`;
        }

        // Draw tile
        this.ctx.fillStyle = color;
        this.ctx.fillRect(
          Math.floor(screenPos.x),
          Math.floor(screenPos.y),
          Math.ceil(tileSize),
          Math.ceil(tileSize)
        );
      }
    }
  }

  /**
   * Get tile at screen coordinates
   */
  public getTileAtScreen(screenX: number, screenY: number): { x: number; y: number } | null {
    const worldPos = this.camera.screenToWorld(screenX, screenY);
    const tileX = Math.floor(worldPos.x / Config.TILE_SIZE);
    const tileY = Math.floor(worldPos.y / Config.TILE_SIZE);

    if (tileX < 0 || tileX >= this.worldMap.width || tileY < 0 || tileY >= this.worldMap.height) {
      return null;
    }

    return { x: tileX, y: tileY };
  }
}
