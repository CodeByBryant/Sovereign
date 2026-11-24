/**
 * @module sprites/buildings
 * @description The villager, a banner, the house and hall, and road pieces. The villager and the banner
 * are drawn in greys so the renderer can tint them with a nation's colour; everything else has its own colours.
 */
import { PixelCanvas, shade, type Rgb } from './canvas'
import { ROAD_E, ROAD_N, ROAD_S, ROAD_W } from './atlas'

const grey = (v: number): Rgb => [v, v, v]
const OUTLINE: Rgb = [30, 24, 20]

/** A walking villager, side on: frame 0 and 1 swing legs and arms opposite ways. */
export function drawVillager(c: PixelCanvas, frame: 0 | 1): void {
  c.ellipse(8, 4.5, 2, 2, grey(244)) // head
  for (let y = 2; y <= 3; y += 1)
    for (let x = 5; x <= 10; x += 1) if (c.solid(x, y)) c.set(x, y, grey(84)) // hair
  c.fillRect(6, 7, 4, 4, grey(176)) // body
  c.fillRect(6, 7, 1, 4, grey(206)) // lit edge
  c.fillRect(9, 7, 1, 4, grey(138)) // shaded edge
  c.fillRect(6, 9, 4, 1, grey(104)) // belt
  if (frame === 0) {
    c.fillRect(5, 8, 1, 3, grey(214)) // arms
    c.fillRect(10, 8, 1, 2, grey(214))
    c.fillRect(6, 11, 1, 3, grey(120)) // legs apart
    c.fillRect(9, 11, 1, 3, grey(92))
  } else {
    c.fillRect(5, 8, 1, 2, grey(214))
    c.fillRect(10, 8, 1, 3, grey(214))
    c.fillRect(7, 11, 1, 3, grey(120)) // legs together
    c.fillRect(8, 11, 1, 3, grey(92))
  }
  c.outline(grey(30))
}

/** A flag on a pole, grey so it can take a nation's colour. */
export function drawBanner(c: PixelCanvas): void {
  c.fillRect(4, 2, 1, 12, grey(120))
  c.fillRect(5, 2, 7, 5, grey(250))
  c.fillRect(5, 5, 7, 2, grey(205))
  c.outline(grey(30))
}

export function drawHouse(c: PixelCanvas): void {
  const wall: Rgb = [200, 165, 112]
  const roof: Rgb = [172, 64, 52]
  c.fillRect(3, 8, 10, 6, wall)
  c.fillRect(3, 8, 10, 1, shade(wall, 1.15))
  c.fillRect(11, 9, 2, 5, shade(wall, 0.82))
  for (let j = 0; j < 4; j += 1)
    c.fillRect(2 + j, 4 + j, 12 - 2 * j, 1, j < 2 ? shade(roof, 1.12) : roof)
  c.fillRect(7, 11, 2, 3, [92, 62, 36]) // door
  c.fillRect(4, 10, 2, 2, [150, 196, 226]) // window
  c.outline(OUTLINE)
}

export function drawHall(c: PixelCanvas): void {
  const wall: Rgb = [176, 170, 158]
  const roof: Rgb = [60, 84, 150]
  c.fillRect(1, 8, 14, 6, wall)
  c.fillRect(1, 8, 14, 1, shade(wall, 1.15))
  c.fillRect(12, 9, 3, 5, shade(wall, 0.8))
  for (let j = 0; j < 5; j += 1)
    c.fillRect(1 + j, 3 + j, 14 - 2 * j, 1, j < 2 ? shade(roof, 1.18) : roof)
  c.fillRect(7, 10, 3, 4, [84, 58, 34]) // great door
  c.fillRect(3, 10, 2, 2, [150, 196, 226])
  c.fillRect(11, 10, 2, 2, [150, 196, 226])
  c.set(8, 1, [236, 200, 60]) // a finial on the ridge
  c.set(8, 2, [236, 200, 60])
  c.outline(OUTLINE)
}

/**
 * A piece of road as an overlay on the ground: a worn patch in the middle and a two-pixel-wide arm to
 * each side named in `mask` (the bits ROAD_N, ROAD_E, ROAD_S, ROAD_W), reaching the edge of the tile so
 * that neighbouring pieces join.
 */
export function drawRoad(c: PixelCanvas, mask: number): void {
  const dirt: Rgb = [152, 118, 78]
  const worn: Rgb = [128, 96, 62]
  c.fillRect(6, 6, 4, 4, dirt)
  if ((mask & ROAD_N) !== 0) c.fillRect(7, 0, 2, 6, dirt)
  if ((mask & ROAD_E) !== 0) c.fillRect(10, 7, 6, 2, dirt)
  if ((mask & ROAD_S) !== 0) c.fillRect(7, 10, 2, 6, dirt)
  if ((mask & ROAD_W) !== 0) c.fillRect(0, 7, 6, 2, dirt)
  // wheel ruts and pebbles, only on ground the road already covers
  for (let y = 0; y < c.height; y += 1) {
    for (let x = 0; x < c.width; x += 1) {
      if (c.solid(x, y) && ((x * 7 + y * 13 + mask * 5) & 7) === 0) c.set(x, y, worn)
    }
  }
}
