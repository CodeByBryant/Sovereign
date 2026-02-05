import { WorldMap } from './WorldMap';
import { Camera } from './Camera';
import { Renderer } from './Renderer';
import { Config } from './Config';
import { BIOME_NAMES } from './Biome';

export class Simulation {
  private canvas: HTMLCanvasElement;
  private worldMap: WorldMap;
  private camera: Camera;
  private renderer: Renderer;
  private running: boolean = false;
  private lastFrameTime: number = 0;

  // UI Elements
  private infoPanel: HTMLElement | null = null;
  private loadingScreen: HTMLElement | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.worldMap = new WorldMap();
    this.camera = new Camera(canvas);
    this.renderer = new Renderer(canvas, this.worldMap, this.camera);
    
    this.setupUI();
    this.setupKeyboardControls();
    this.setupMouseHover();
  }

  private setupUI(): void {
    // Create info panel
    this.infoPanel = document.createElement('div');
    this.infoPanel.className = 'info-panel';
    this.infoPanel.innerHTML = `
      <h3>World Info</h3>
      <div class="info-item">
        <span class="label">Biome:</span>
        <span class="value" id="biome-name">-</span>
      </div>
      <div class="info-item">
        <span class="label">Elevation:</span>
        <span class="value" id="elevation">-</span>
      </div>
      <div class="info-item">
        <span class="label">Temperature:</span>
        <span class="value" id="temperature">-</span>
      </div>
      <div class="info-item">
        <span class="label">Humidity:</span>
        <span class="value" id="humidity">-</span>
      </div>
      <div class="info-item" style="margin-top: 16px;">
        <span class="label">Press 'B':</span>
        <span class="value">Toggle Biomes</span>
      </div>
    `;
    document.body.appendChild(this.infoPanel);

    // Create loading screen
    this.loadingScreen = document.createElement('div');
    this.loadingScreen.className = 'loading-screen';
    this.loadingScreen.innerHTML = `
      <h1>SOVEREIGN</h1>
      <div class="loading-bar">
        <div class="progress" id="loading-progress"></div>
      </div>
      <div class="loading-text" id="loading-text">Generating world...</div>
    `;
    document.body.appendChild(this.loadingScreen);
  }

  private setupKeyboardControls(): void {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'b' || e.key === 'B') {
        this.renderer.toggleBiomes();
      }
    });
  }

  private setupMouseHover(): void {
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      const tilePos = this.renderer.getTileAtScreen(screenX, screenY);
      if (tilePos) {
        const tile = this.worldMap.getTile(tilePos.x, tilePos.y);
        if (tile) {
          // Update info panel
          const biomeName = document.getElementById('biome-name');
          const elevation = document.getElementById('elevation');
          const temperature = document.getElementById('temperature');
          const humidity = document.getElementById('humidity');

          if (biomeName) biomeName.textContent = BIOME_NAMES[tile.biome];
          if (elevation) elevation.textContent = tile.elevation.toFixed(2);
          if (temperature) temperature.textContent = tile.temperature.toFixed(2);
          if (humidity) humidity.textContent = tile.humidity.toFixed(2);
        }
      }
    });
  }

  /**
   * Initialize and generate the world
   */
  public async init(): Promise<void> {
    // Show loading screen
    const progressBar = document.getElementById('loading-progress') as HTMLElement;
    const loadingText = document.getElementById('loading-text') as HTMLElement;

    return new Promise((resolve) => {
      // Simulate async world generation
      setTimeout(() => {
        this.worldMap.generate((progress) => {
          if (progressBar) {
            progressBar.style.width = `${progress * 100}%`;
          }
          
          if (loadingText) {
            if (progress < 0.3) {
              loadingText.textContent = 'Generating elevation...';
            } else if (progress < 0.5) {
              loadingText.textContent = 'Creating temperature map...';
            } else if (progress < 0.7) {
              loadingText.textContent = 'Adding humidity...';
            } else {
              loadingText.textContent = 'Determining biomes...';
            }
          }
        });

        // Hide loading screen after generation
        setTimeout(() => {
          if (this.loadingScreen) {
            this.loadingScreen.style.display = 'none';
          }
          
          // Center camera on world
          this.camera.x = (this.worldMap.width * Config.TILE_SIZE - window.innerWidth / this.camera.zoom) / 2;
          this.camera.y = (this.worldMap.height * Config.TILE_SIZE - window.innerHeight / this.camera.zoom) / 2;
          
          resolve();
        }, 500);
      }, 100);
    });
  }

  /**
   * Start the game loop
   */
  public start(): void {
    if (this.running) return;
    
    this.running = true;
    this.lastFrameTime = performance.now();
    this.gameLoop();
  }

  /**
   * Stop the game loop
   */
  public stop(): void {
    this.running = false;
  }

  /**
   * Main game loop
   */
  private gameLoop = (): void => {
    if (!this.running) return;

    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastFrameTime;
    this.lastFrameTime = currentTime;

    // Update (nothing to update for now)
    
    // Render
    this.renderer.render();

    // Request next frame
    requestAnimationFrame(this.gameLoop);
  }
}
