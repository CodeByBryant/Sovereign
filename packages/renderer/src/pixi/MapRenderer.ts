/**
 * @module MapRenderer
 * @description Draws the tile map with PixiJS (WebGL). Each overlay is one texture on one sprite, so
 * there is no chunking and no manual culling: the GPU clips what is off screen. All the decisions
 * (what the camera shows, which tile is under the cursor) are made by the pure helpers in
 * `../view`; this class only wires them to Pixi.
 *
 * Use it through the `@sovereign/renderer/pixi` entry point so that code which only needs the pure
 * parts (palettes, camera) never loads PixiJS.
 */
import { Application, BufferImageSource, Container, Sprite, Texture } from 'pixi.js'
import type { Camera } from '../Camera'
import type { LayerName } from '../layers'
import { clampedViewport, tileAtScreen, viewTransform } from '../view'
import type { UnitSnapshot } from '@sovereign/contracts'
import { SpriteLayers, type SpriteWorld } from './SpriteLayers'

export interface MapRendererOptions {
  /** CSS class given to the canvas the renderer creates. */
  className?: string
  /** CSS colour drawn behind the map. @default '#050607' */
  background?: string
  /** World pixels per tile. @default 4 */
  tileSize?: number
}

export class MapRenderer {
  /** The canvas this renderer draws into. It creates and owns it (see {@link MapRenderer.create}). */
  readonly canvas: HTMLCanvasElement
  private readonly app: Application
  private readonly camera: Camera
  private readonly tileSize: number
  private readonly world = new Container()
  private readonly sprites = new Map<LayerName, Sprite>()
  private readonly spriteLayers: SpriteLayers
  private mapWidth = 0
  private mapHeight = 0
  private destroyed = false

  private constructor(
    app: Application,
    camera: Camera,
    canvas: HTMLCanvasElement,
    tileSize: number
  ) {
    this.app = app
    this.camera = camera
    this.canvas = canvas
    this.tileSize = tileSize
    this.app.stage.addChild(this.world)
    this.spriteLayers = new SpriteLayers(tileSize)
    this.world.addChild(this.spriteLayers.container)
  }

  /**
   * Create a renderer and put its canvas inside `host`, sized to fill it. Pixi's initialisation is
   * asynchronous.
   *
   * The renderer creates its own canvas rather than taking one. Two renderers must never share a
   * canvas (and so a WebGL context): destroying one would take the other's context with it, which is
   * exactly what happens when a framework tears a component down and sets it up again.
   */
  static async create(
    host: HTMLElement,
    camera: Camera,
    options: MapRendererOptions = {}
  ): Promise<MapRenderer> {
    const { width, height } = clampedViewport(host.clientWidth, host.clientHeight)
    const app = new Application()
    await app.init({
      width,
      height,
      background: options.background ?? '#050607',
      antialias: false,
      // Leave the canvas' CSS size to the page layout; only the backing store follows the pixel ratio.
      autoDensity: false,
      resolution: window.devicePixelRatio || 1,
      preference: 'webgl',
      // The host drives rendering from its own frame loop.
      autoStart: false
    })
    app.ticker.stop()

    const canvas = app.canvas
    if (options.className !== undefined) canvas.className = options.className
    host.appendChild(canvas)
    return new MapRenderer(app, camera, canvas, options.tileSize ?? 4)
  }

  /**
   * Set (or replace) one overlay from an RGBA buffer, `width * height * 4` bytes. The buffer is
   * uploaded to the GPU and the renderer keeps no reference to it.
   */
  setLayer(name: LayerName, rgba: Uint8ClampedArray, width: number, height: number): void {
    if (rgba.length !== width * height * 4) {
      throw new RangeError(
        `the ${name} layer has ${rgba.length} bytes, expected ${width * height * 4}`
      )
    }
    const limit = this.maxTextureSize()
    if (width > limit || height > limit) {
      throw new RangeError(
        `a ${width} x ${height} map is larger than this GPU's maximum texture size of ${limit}`
      )
    }
    if (this.mapWidth !== 0 && (this.mapWidth !== width || this.mapHeight !== height)) {
      throw new RangeError('every layer must have the same size as the first one')
    }
    this.mapWidth = width
    this.mapHeight = height

    const source = new BufferImageSource({
      resource: new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
      width,
      height,
      format: 'rgba8unorm',
      scaleMode: 'nearest'
    })
    const texture = new Texture({ source })

    let sprite = this.sprites.get(name)
    if (sprite === undefined) {
      sprite = new Sprite(texture)
      sprite.visible = false
      this.world.addChild(sprite)
      this.sprites.set(name, sprite)
    } else {
      const old = sprite.texture
      sprite.texture = texture
      old.destroy(true)
    }
    sprite.scale.set(this.tileSize)
    sprite.position.set((-width * this.tileSize) / 2, (-height * this.tileSize) / 2)
  }

  /** Set what the sprite layers (resources, roads, halls) draw from; shown when the camera is close. */
  setSpriteWorld(world: SpriteWorld): void {
    this.spriteLayers.setWorld(world)
  }

  /** The nations' colours by index, used to tint their units and banners. */
  setNationColors(colors: ReadonlyArray<readonly [number, number, number]>): void {
    this.spriteLayers.setNationColors(colors)
  }

  /** The newest unit snapshot; the renderer glides the units to it. */
  setUnits(snapshot: UnitSnapshot): void {
    this.spriteLayers.setUnits(snapshot, performance.now())
  }

  /** The largest texture side the GPU accepts; larger layers would silently draw nothing. */
  private maxTextureSize(): number {
    const gl = (this.app.renderer as { gl?: WebGL2RenderingContext }).gl
    const reported = gl?.getParameter(gl.MAX_TEXTURE_SIZE) as number | undefined
    return typeof reported === 'number' && reported > 0 ? reported : 2048
  }

  /** Show one overlay and hide the others. An overlay that was never set shows nothing. */
  showLayer(name: LayerName): void {
    for (const [layer, sprite] of this.sprites) sprite.visible = layer === name
  }

  /** Re-sync the drawing surface with the canvas' CSS size and the device pixel ratio. */
  resize(): void {
    const { width, height } = this.getViewportSize()
    this.app.renderer.resolution = window.devicePixelRatio || 1
    this.app.renderer.resize(width, height)
  }

  /** Draw one frame with the camera as it is now. */
  render(): void {
    if (this.destroyed) return
    const { width, height } = this.getViewportSize()
    const t = viewTransform(this.camera, width, height)
    this.world.scale.set(t.scale)
    this.world.position.set(t.x, t.y)
    this.spriteLayers.update(this.camera, width, height, performance.now())
    this.publishSpriteStats()
    this.app.renderer.render(this.app.stage)
  }

  /** Put what the sprite layers drew on the canvas as data attributes, so a page or a test can see it. */
  private publishSpriteStats(): void {
    const { stats } = this.spriteLayers
    const data = this.canvas.dataset
    const set = (key: string, value: string): void => {
      if (data[key] !== value) data[key] = value
    }
    set('sprites', stats.active ? 'on' : 'off')
    set('spriteRoads', String(stats.roads))
    set('spriteResources', String(stats.resources))
    set('spriteHalls', String(stats.halls))
    set('spriteUnits', String(stats.units))
  }

  /** The canvas' size in CSS pixels (at least 1 x 1). */
  getViewportSize(): { width: number; height: number } {
    return clampedViewport(this.canvas.clientWidth, this.canvas.clientHeight)
  }

  /** The map tile under a screen position (CSS pixels, relative to the canvas), or null. */
  screenToTile(screenX: number, screenY: number): { x: number; y: number } | null {
    if (this.mapWidth === 0) return null
    const { width, height } = this.getViewportSize()
    return tileAtScreen(this.camera, width, height, screenX, screenY, {
      width: this.mapWidth,
      height: this.mapHeight,
      tileSize: this.tileSize
    })
  }

  /** Release the GPU resources and remove the canvas from the page. */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.canvas.remove()
    this.app.destroy(false, { children: true, texture: true })
  }
}
