/**
 * @module view
 * @description Pure view math shared by every renderer: how a camera maps the world onto a
 * viewport, and which map tile a screen position falls on. No drawing and no DOM, so it is testable
 * without a GPU.
 *
 * World space is measured in map pixels (a tile is `tileSize` of them) with the origin at the centre
 * of the map.
 */
import type { Camera } from './Camera'

/** How a camera places the world on screen: `screen = world * scale + (x, y)`. */
export interface ViewTransform {
  scale: number
  x: number
  y: number
}

/** The transform to apply to the world container so it appears as the camera sees it. */
export function viewTransform(
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number
): ViewTransform {
  return {
    scale: camera.zoom,
    x: viewportWidth / 2 - camera.x * camera.zoom,
    y: viewportHeight / 2 - camera.y * camera.zoom
  }
}

/** The size of the tile map being drawn. */
export interface MapSize {
  /** Width in tiles. */
  width: number
  /** Height in tiles. */
  height: number
  /** World pixels per tile. */
  tileSize: number
}

/** The tile under a screen position, or `null` if the position is outside the map. */
export function tileAtScreen(
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  screenX: number,
  screenY: number,
  map: MapSize
): { x: number; y: number } | null {
  const world = camera.screenToWorld(screenX, screenY, viewportWidth, viewportHeight)
  const x = Math.floor((world.x + (map.width * map.tileSize) / 2) / map.tileSize)
  const y = Math.floor((world.y + (map.height * map.tileSize) / 2) / map.tileSize)
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null
  return { x, y }
}

/** A viewport size that is a whole number of pixels and never below 1 x 1. */
export function clampedViewport(width: number, height: number): { width: number; height: number } {
  return { width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) }
}

/** A screen position's tile is at least this many pixels wide before sprites are drawn instead of overlays. */
export const SPRITE_MIN_TILE_PIXELS = 10

/** Whether the camera is close enough to draw sprites: a tile (`tileSize` world pixels) is big enough on screen. */
export function spritesShown(zoom: number, tileSize: number): boolean {
  return zoom * tileSize >= SPRITE_MIN_TILE_PIXELS
}

/** A block of tiles: `x0..x1` and `y0..y1`, from the first to one past the last. */
export interface TileRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * The tiles the camera can see, plus one tile of margin so a sprite on the edge is not cut off, clamped to
 * the map. Sprites are made only for these, so the cost of a frame follows the screen, not the map.
 */
export function visibleTileRect(
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  map: MapSize
): TileRect {
  const topLeft = camera.screenToWorld(0, 0, viewportWidth, viewportHeight)
  const bottomRight = camera.screenToWorld(
    viewportWidth,
    viewportHeight,
    viewportWidth,
    viewportHeight
  )
  const toTileX = (wx: number): number => (wx + (map.width * map.tileSize) / 2) / map.tileSize
  const toTileY = (wy: number): number => (wy + (map.height * map.tileSize) / 2) / map.tileSize
  const clamp = (v: number, hi: number): number => Math.min(hi, Math.max(0, v))
  return {
    x0: clamp(Math.floor(toTileX(topLeft.x)) - 1, map.width),
    y0: clamp(Math.floor(toTileY(topLeft.y)) - 1, map.height),
    x1: clamp(Math.ceil(toTileX(bottomRight.x)) + 1, map.width),
    y1: clamp(Math.ceil(toTileY(bottomRight.y)) + 1, map.height)
  }
}
