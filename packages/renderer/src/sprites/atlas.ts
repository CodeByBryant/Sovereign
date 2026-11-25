/**
 * @module sprites/atlas
 * @description Packs the whole procedural sprite set into one RGBA sheet with a table of frames, so a
 * renderer uploads a single texture and cuts frames out of it. Pure: no DOM and no PixiJS. Any art
 * that replaces this (hand-drawn, imported) only has to give the same frame names on the same kind of sheet.
 */
import { RESOURCE_CATALOG } from '@sovereign/contracts'
import { PixelCanvas } from './canvas'
import { drawBanner, drawHall, drawHouse, drawRoad, drawVillager } from './buildings'
import { drawResource } from './resources'

/** How many tree pictures a forest is drawn from (see `resourceLook`). */
export const TREE_VARIANTS = 3

/** Every sprite is this many pixels square. */
export const SPRITE_SIZE = 16

/** What is drawn for a resource: a full deposit, a drawn-down one, or what is left when it is gone. */
export const RESOURCE_SPRITE_STATES = ['full', 'low', 'empty'] as const
export type ResourceSpriteState = 0 | 1 | 2

/** Road sides, as bits of a road piece's mask: which neighbours the piece connects to. */
export const ROAD_N = 1
export const ROAD_E = 2
export const ROAD_S = 4
export const ROAD_W = 8

export interface SpriteFrame {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface SpriteAtlas {
  readonly width: number
  readonly height: number
  /** The sheet, RGBA, 4 bytes a pixel, row by row. */
  readonly rgba: Uint8ClampedArray
  readonly frames: Readonly<Record<string, SpriteFrame>>
}

/** Which picture a slot shows, from how much of its deposit is left (stock out of richness). */
export function resourceSpriteState(stock: number, richness: number): ResourceSpriteState {
  if (richness <= 0 || stock <= 0) return 2
  return stock * 2 >= richness ? 0 : 1
}

export function resourceFrameName(type: number, state: ResourceSpriteState): string {
  const def = Number.isInteger(type) ? RESOURCE_CATALOG[type - 1] : undefined
  if (def === undefined) throw new RangeError(`no resource has id ${type}`)
  return `resource.${def.key}.${RESOURCE_SPRITE_STATES[state]}`
}

export function roadFrameName(mask: number): string {
  if (!Number.isInteger(mask) || mask < 0 || mask > 15) {
    throw new RangeError(`a road mask is 0 to 15, got ${mask}`)
  }
  return `road.${mask}`
}

const COLUMNS = 16

/** Draw every sprite and pack them in rows, in a fixed order. */
export function buildSpriteAtlas(): SpriteAtlas {
  const sprites: Array<[string, PixelCanvas]> = []
  const add = (name: string, draw: (c: PixelCanvas) => void): void => {
    const c = new PixelCanvas(SPRITE_SIZE, SPRITE_SIZE)
    draw(c)
    sprites.push([name, c])
  }
  add('villager.0', (c) => drawVillager(c, 0))
  add('villager.1', (c) => drawVillager(c, 1))
  add('banner', drawBanner)
  add('house', drawHouse)
  add('hall', drawHall)
  for (const def of RESOURCE_CATALOG) {
    for (let s = 0; s < 3; s += 1) {
      add(`resource.${def.key}.${RESOURCE_SPRITE_STATES[s]}`, (c) =>
        drawResource(c, def.id, def.color, s as ResourceSpriteState)
      )
    }
  }
  for (let mask = 0; mask < 16; mask += 1) add(roadFrameName(mask), (c) => drawRoad(c, mask))
  // the other two trees (variants 1 and 2) of a living state: see `resourceLook`
  const timber = RESOURCE_CATALOG.find((d) => d.key === 'timber')
  if (timber !== undefined) {
    for (const s of [0, 1] as const) {
      for (let v = 1; v < TREE_VARIANTS; v += 1) {
        add(`resource.timber.${RESOURCE_SPRITE_STATES[s]}.v${v}`, (c) =>
          drawResource(c, timber.id, timber.color, s, v)
        )
      }
    }
  }
  // a flat ellipse, drawn dark and translucent under objects
  add('shadow', (c) => {
    for (let y = 0; y < SPRITE_SIZE; y += 1) {
      for (let x = 0; x < SPRITE_SIZE; x += 1) {
        const dx = (x - 7.5) / 7.5
        const dy = (y - 7.5) / 3.2
        if (dx * dx + dy * dy <= 1) c.set(x, y, [0, 0, 0])
      }
    }
  })

  const rows = Math.ceil(sprites.length / COLUMNS)
  const width = COLUMNS * SPRITE_SIZE
  const height = rows * SPRITE_SIZE
  const rgba = new Uint8ClampedArray(width * height * 4)
  const frames: Record<string, SpriteFrame> = {}
  sprites.forEach(([name, canvas], i) => {
    const x = (i % COLUMNS) * SPRITE_SIZE
    const y = Math.floor(i / COLUMNS) * SPRITE_SIZE
    canvas.blitTo(rgba, width, x, y)
    frames[name] = { x, y, w: SPRITE_SIZE, h: SPRITE_SIZE }
  })
  return { width, height, rgba, frames }
}
