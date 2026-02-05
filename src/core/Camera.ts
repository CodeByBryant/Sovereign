import { Config } from './Config';

export class Camera {
  public x: number = 0;
  public y: number = 0;
  public zoom: number = 1.0;
  
  private canvas: HTMLCanvasElement;
  private isDragging: boolean = false;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.setupControls();
  }

  private setupControls(): void {
    // Mouse drag for panning
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;
        
        this.x -= dx / this.zoom;
        this.y -= dy / this.zoom;
        
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      }
    });

    this.canvas.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.isDragging = false;
    });

    // Mouse wheel for zooming
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      
      const delta = -Math.sign(e.deltaY) * Config.ZOOM_SPEED;
      const oldZoom = this.zoom;
      this.zoom = Math.max(Config.MIN_ZOOM, Math.min(Config.MAX_ZOOM, this.zoom + delta));
      
      // Zoom towards mouse position
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      const zoomRatio = this.zoom / oldZoom;
      this.x = mouseX / oldZoom + (this.x - mouseX / oldZoom) * zoomRatio;
      this.y = mouseY / oldZoom + (this.y - mouseY / oldZoom) * zoomRatio;
    });
  }

  /**
   * Convert screen coordinates to world coordinates
   */
  public screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: this.x + screenX / this.zoom,
      y: this.y + screenY / this.zoom
    };
  }

  /**
   * Convert world coordinates to screen coordinates
   */
  public worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: (worldX - this.x) * this.zoom,
      y: (worldY - this.y) * this.zoom
    };
  }
}
