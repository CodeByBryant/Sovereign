/**
 * @module SpriteLayers
 * @description The sprite layers drawn over the map when the camera is close: roads, resource objects, halls
 * and the units. All of it is pooled sprites cut from one procedural atlas, made only for what is on screen
 * (see `visibleTileRect`), and none of it is kept between frames except the pool, so the cost of a frame
 * follows the screen and not the size of the map.
 *
 * Resource sprites are drawn from the tile slot arrays (what and how much is left), roads from a road byte
 * per tile, halls from the nations' capitals and units from an interpolated snapshot. Nothing here is
 * simulation state: it only draws what the world last said.
 */
import { BufferImageSource, Container, Rectangle, Sprite, Texture } from 'pixi.js'
import { NO_OWNER, UnitState, type ResourceSlots, type UnitSnapshot } from '@sovereign/contracts'
import type { Camera } from '../Camera'
import {
  ROAD_PRESENT,
  SPRITE_SIZE,
  UnitInterpolator,
  buildSpriteAtlas,
  resourceFrameName,
  resourceSpriteState,
  roadFrameName
} from '../sprites'
import { spritesShown, visibleTileRect } from '../view'

/** What the layers draw the map's fixed things from. Held by reference: the caller keeps it up to date. */
export interface SpriteWorld {
  width: number
  height: number
  resources: ResourceSlots
  /** One byte per tile: 0 for no road, else `16 | sides` (see `roadMaskFromRoutes`). */
  roads: Uint8Array
  /** The tile and colour of each hall. */
  halls: ReadonlyArray<{ tile: number; color: readonly [number, number, number] }>
}

const GREY = 0xc8c8c8

/** Resource objects fill this much of a tile, so neighbours do not touch. */
const RESOURCE_SCALE = 0.8
/** Villagers are drawn this many times a tile's sprite size, so they read among the objects. */
const UNIT_SCALE = 1.9

const hex = (c: readonly [number, number, number]): number => (c[0] << 16) | (c[1] << 8) | c[2]

/** Sprites that are reused from frame to frame: take what is needed, and the rest are hidden. */
class SpritePool {
  private readonly sprites: Sprite[] = []
  private used = 0

  constructor(private readonly parent: Container) {}

  begin(): void {
    this.used = 0
  }

  take(texture: Texture): Sprite {
    let sprite = this.sprites[this.used]
    if (sprite === undefined) {
      sprite = new Sprite(texture)
      this.parent.addChild(sprite)
      this.sprites.push(sprite)
    } else if (sprite.texture !== texture) {
      sprite.texture = texture
    }
    sprite.visible = true
    sprite.tint = 0xffffff
    this.used += 1
    return sprite
  }

  /** How many sprites are showing. */
  get shown(): number {
    return this.used
  }

  end(): void {
    for (let i = this.used; i < this.sprites.length; i += 1)
      (this.sprites[i] as Sprite).visible = false
  }
}

/** What the layers drew in the last frame (for the host's status and for tests). */
export interface SpriteStats {
  /** False when the camera is too far out for sprites (the overlays show instead). */
  active: boolean
  roads: number
  resources: number
  halls: number
  units: number
  /** Villagers at work, and villagers carrying something home. */
  working: number
  carrying: number
  /** Visible deposits that have had something taken from them. */
  drawn: number
}

export class SpriteLayers {
  readonly stats: SpriteStats = {
    active: false,
    roads: 0,
    resources: 0,
    halls: 0,
    units: 0,
    working: 0,
    carrying: 0,
    drawn: 0
  }
  readonly container = new Container()
  private readonly roadPool: SpritePool
  private readonly resourcePool: SpritePool
  private readonly buildingPool: SpritePool
  private readonly unitPool: SpritePool
  private readonly carryPool: SpritePool
  private readonly textures = new Map<string, Texture>()
  private readonly source: BufferImageSource
  private readonly interpolator = new UnitInterpolator()
  private world: SpriteWorld | null = null
  private nationColors: number[] = []
  private readonly scale: number

  constructor(private readonly tileSize: number) {
    const atlas = buildSpriteAtlas()
    this.source = new BufferImageSource({
      resource: new Uint8Array(atlas.rgba.buffer, atlas.rgba.byteOffset, atlas.rgba.byteLength),
      width: atlas.width,
      height: atlas.height,
      format: 'rgba8unorm',
      scaleMode: 'nearest'
    })
    for (const [name, f] of Object.entries(atlas.frames)) {
      this.textures.set(
        name,
        new Texture({ source: this.source, frame: new Rectangle(f.x, f.y, f.w, f.h) })
      )
    }
    this.scale = tileSize / SPRITE_SIZE
    this.container.visible = false
    const layer = (): Container => this.container.addChild(new Container())
    this.roadPool = new SpritePool(layer())
    this.resourcePool = new SpritePool(layer())
    this.buildingPool = new SpritePool(layer())
    this.unitPool = new SpritePool(layer())
    this.carryPool = new SpritePool(layer())
  }

  /** Set what the fixed layers draw from (the same object may be passed again after it changes). */
  setWorld(world: SpriteWorld): void {
    this.world = world
  }

  /** The nations' colours by index, for tinting units. */
  setNationColors(colors: ReadonlyArray<readonly [number, number, number]>): void {
    this.nationColors = colors.map(hex)
  }

  /** The newest unit snapshot, received at `nowMs`. */
  setUnits(snapshot: UnitSnapshot, nowMs: number): void {
    this.interpolator.push(snapshot, nowMs)
  }

  private texture(name: string): Texture {
    const t = this.textures.get(name)
    if (t === undefined) throw new Error(`the sprite atlas has no frame ${name}`)
    return t
  }

  /** Bring the sprites up to date for this frame. Call before rendering, inside the world container. */
  update(camera: Camera, viewportWidth: number, viewportHeight: number, nowMs: number): void {
    const world = this.world
    if (world === null || !spritesShown(camera.zoom, this.tileSize)) {
      this.container.visible = false
      this.stats.active = false
      return
    }
    this.container.visible = true
    const ts = this.tileSize
    const originX = (-world.width * ts) / 2
    const originY = (-world.height * ts) / 2
    const rect = visibleTileRect(camera, viewportWidth, viewportHeight, {
      width: world.width,
      height: world.height,
      tileSize: ts
    })

    this.roadPool.begin()
    this.resourcePool.begin()
    let drawn = 0
    for (let y = rect.y0; y < rect.y1; y += 1) {
      for (let x = rect.x0; x < rect.x1; x += 1) {
        const tile = y * world.width + x
        const px = originX + x * ts
        const py = originY + y * ts
        const road = world.roads[tile] as number
        if ((road & ROAD_PRESENT) !== 0) {
          const s = this.roadPool.take(this.texture(roadFrameName(road & 15)))
          s.scale.set(this.scale)
          s.position.set(px, py)
        }
        const ground = world.resources.ground
        const surface = world.resources.surface
        const g = ground.type[tile] as number
        const f = surface.type[tile] as number
        if (g !== 0 && (ground.stock[tile] as number) < (ground.richness[tile] as number))
          drawn += 1
        if (f !== 0 && (surface.stock[tile] as number) < (surface.richness[tile] as number))
          drawn += 1
        if (g !== 0) {
          const state = resourceSpriteState(
            ground.stock[tile] as number,
            ground.richness[tile] as number
          )
          const s = this.resourcePool.take(this.texture(resourceFrameName(g, state)))
          // under a surface resource, a mineral is drawn smaller in the corner so both can be seen
          const shrink = f !== 0 ? 0.5 : RESOURCE_SCALE
          s.scale.set(this.scale * shrink)
          const inset = f !== 0 ? ts * 0.45 : (ts * (1 - RESOURCE_SCALE)) / 2
          s.position.set(px + inset, py + inset)
        }
        if (f !== 0) {
          const state = resourceSpriteState(
            surface.stock[tile] as number,
            surface.richness[tile] as number
          )
          const s = this.resourcePool.take(this.texture(resourceFrameName(f, state)))
          s.scale.set(this.scale * RESOURCE_SCALE)
          s.position.set(px + (ts * (1 - RESOURCE_SCALE)) / 2, py + (ts * (1 - RESOURCE_SCALE)) / 2)
        }
      }
    }
    this.roadPool.end()
    this.resourcePool.end()

    this.buildingPool.begin()
    for (const hall of world.halls) {
      const x = hall.tile % world.width
      const y = (hall.tile - x) / world.width
      if (x < rect.x0 - 1 || x >= rect.x1 + 1 || y < rect.y0 - 1 || y >= rect.y1 + 1) continue
      const px = originX + x * ts
      const py = originY + y * ts
      const h = this.buildingPool.take(this.texture('hall'))
      h.scale.set(this.scale * 2.2)
      h.position.set(px - ts * 0.6, py - ts * 1.1)
      const b = this.buildingPool.take(this.texture('banner'))
      b.scale.set(this.scale * 1.6)
      b.position.set(px + ts * 0.7, py - ts * 1.6)
      b.tint = hex(hall.color)
    }
    this.buildingPool.end()

    this.unitPool.begin()
    this.carryPool.begin()
    let working = 0
    let carrying = 0
    const frame = this.interpolator.sample(nowMs)
    const left = rect.x0 - 1
    const right = rect.x1 + 1
    const top = rect.y0 - 1
    const bottom = rect.y1 + 1
    const step = Math.floor(nowMs / 180)
    const swing = Math.floor(nowMs / 90)
    for (let i = 0; i < frame.count; i += 1) {
      const x = frame.x[i] as number
      const y = frame.y[i] as number
      if (x < left || x >= right || y < top || y >= bottom) continue
      const id = frame.id[i] as number
      const unitState = frame.state[i] as number
      // walkers and haulers step, workers swing faster, and a rester stands
      const pose =
        unitState === UnitState.Walk || unitState === UnitState.Haul
          ? (step + id) & 1
          : unitState === UnitState.Work
            ? (swing + id) & 1
            : 0
      if (unitState === UnitState.Work) working += 1
      const s = this.unitPool.take(this.texture(`villager.${pose}`))
      s.anchor.set(0.5, 0.85)
      s.scale.set(this.scale * UNIT_SCALE)
      s.position.set(originX + (x + 0.5) * ts, originY + (y + 0.5) * ts)
      const owner = frame.owner[i] as number
      s.tint = owner === NO_OWNER ? GREY : (this.nationColors[owner] ?? GREY)
      const carry = frame.carry[i] as number
      if (carry !== 0) {
        // what it carries, small, over its head
        carrying += 1
        const c = this.carryPool.take(this.texture(resourceFrameName(carry, 0)))
        c.anchor.set(0.5, 1)
        c.scale.set(this.scale * 0.55)
        c.position.set(originX + (x + 0.5) * ts, originY + (y + 0.5) * ts - ts * 0.55)
      }
    }
    this.unitPool.end()
    this.carryPool.end()
    this.stats.active = true
    this.stats.roads = this.roadPool.shown
    this.stats.resources = this.resourcePool.shown
    this.stats.halls = this.buildingPool.shown / 2
    this.stats.units = this.unitPool.shown
    this.stats.working = working
    this.stats.drawn = drawn
    this.stats.carrying = carrying
  }

  destroy(): void {
    this.container.destroy({ children: true })
    for (const t of this.textures.values()) t.destroy(false)
    this.source.destroy()
  }
}
