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
