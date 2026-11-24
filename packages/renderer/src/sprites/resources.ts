/**
 * @module sprites/resources
 * @description One picture per resource and state, drawn in code. A resource has three states (see
 * `resourceSpriteState`): full, low and empty, and each one is drawn so that a deposit visibly runs
 * down: a tree becomes a sapling and then a stump, a field is cut to stubble, a herd thins out.
 */
import { ResourceType } from '@sovereign/contracts'
import { PixelCanvas, shade, tint, type Rgb } from './canvas'
import type { ResourceSpriteState } from './atlas'

const OUTLINE: Rgb = [28, 22, 18]
const WOOD: Rgb = [112, 78, 46]
const SOIL: Rgb = [96, 68, 42]
const LEAF: Rgb = [58, 124, 54]
const WATER: Rgb = [150, 198, 238]
const WHITE: Rgb = [244, 244, 236]
const ROCK: Rgb = [128, 124, 118]

type Draw = (c: PixelCanvas, color: Rgb, state: ResourceSpriteState) => void

const pick = <T>(state: ResourceSpriteState, full: T, low: T, empty: T): T =>
  state === 0 ? full : state === 1 ? low : empty

function ripples(c: PixelCanvas, fewer = false): void {
  c.line(2, 6, 5, 6, WATER)
  c.line(10, 3, 13, 3, WATER)
  c.line(3, 13, 7, 13, WATER)
  if (!fewer) c.line(9, 10, 13, 10, WATER)
}

const timber: Draw = (c, color, state) => {
  if (state === 2) {
    c.fillRect(6, 9, 4, 4, WOOD)
    c.fillRect(6, 9, 4, 1, tint(WOOD, 0.45)) // the cut top
    c.fillRect(9, 10, 1, 3, shade(WOOD, 0.75))
    c.set(5, 13, LEAF) // a shoot already
    return
  }
  const full = state === 0
  c.fillRect(7, full ? 9 : 10, 2, full ? 5 : 4, WOOD)
  if (full) {
    c.ellipse(8, 6, 5.5, 5, color)
    c.ellipse(6, 4.5, 2, 1.5, shade(color, 1.35))
  } else {
    c.ellipse(8, 8, 3, 2.5, color)
  }
}

const stone: Draw = (c, color, state) => {
  if (state === 0) {
    c.ellipse(5, 10, 4, 3, color)
    c.ellipse(11, 9, 4, 4, color)
    c.ellipse(8, 5, 3, 3, shade(color, 1.08))
  } else if (state === 1) {
    c.ellipse(8, 10, 4, 3, color)
  } else {
    c.set(6, 11, color)
    c.set(7, 11, shade(color, 0.8))
    c.set(10, 12, color)
  }
}

/** Metals and gems: a rocky outcrop with flecks of the resource's colour in it. */
const ore =
  (base: Rgb): Draw =>
  (c, color, state) => {
    if (state === 0) {
      c.ellipse(8, 9, 6, 5, base)
      const specks: Array<[number, number]> = [
        [5, 8],
        [8, 6],
        [11, 9],
        [7, 11],
        [10, 12],
        [6, 10]
      ]
      specks.forEach(([x, y], i) => c.set(x, y, i === 1 ? tint(color, 0.45) : color))
    } else if (state === 1) {
      c.ellipse(8, 10, 4, 3, base)
      c.set(7, 9, color)
      c.set(10, 10, color)
      c.set(8, 12, tint(color, 0.45))
    } else {
      c.ellipse(8, 11, 3, 2, shade(base, 0.9))
    }
  }

const grain: Draw = (c, color, state) => {
  c.fillRect(2, 13, 12, 2, SOIL)
  if (state === 2) {
    c.line(3, 13, 12, 13, shade(SOIL, 1.3))
    return
  }
  const top = pick(state, 4, 9, 13)
  for (const x of [3, 6, 9, 12]) {
    c.fillRect(x, top, 1, 13 - top, [150, 156, 56])
    if (state === 0) {
      c.fillRect(x, top - 1, 1, 3, color)
      c.set(x + 1, top, shade(color, 0.8))
    } else {
      c.set(x, top, color)
    }
  }
}

function fish(c: PixelCanvas, cx: number, cy: number, color: Rgb): void {
  c.ellipse(cx, cy, 3, 1.5, color)
  c.set(cx - 4, cy - 1, shade(color, 0.8))
  c.set(cx - 4, cy + 1, shade(color, 0.8))
  c.set(cx + 2, cy, [20, 20, 24])
}

const fishery: Draw = (c, color, state) => {
  ripples(c, state !== 2)
  if (state === 0) {
    fish(c, 6, 4, color)
    fish(c, 10, 8, color)
    fish(c, 6, 12, color)
  } else if (state === 1) {
    fish(c, 8, 8, color)
  }
}

function animal(c: PixelCanvas, cx: number, cy: number, color: Rgb): void {
  c.ellipse(cx, cy, 3, 2, color)
  c.ellipse(cx + 3, cy - 1, 1.5, 1.5, shade(color, 1.1))
  c.set(cx + 3, cy - 3, shade(color, 0.7)) // an ear
  c.line(cx - 3, cy, cx - 5, cy - 2, shade(color, 0.8)) // tail
}

const fur: Draw = (c, color, state) => {
  if (state === 0) {
    animal(c, 6, 5, color)
    animal(c, 9, 11, color)
  } else if (state === 1) {
    animal(c, 8, 9, color)
  } else {
    for (const [x, y] of [
      [5, 9],
      [7, 10],
      [9, 9],
      [11, 10]
    ] as const)
      c.set(x, y, shade(color, 0.6))
  }
}

function tuft(c: PixelCanvas, x: number, y: number, color: Rgb): void {
  c.set(x, y, color)
  c.set(x - 1, y - 1, color)
  c.set(x + 1, y - 1, color)
}

function sheep(c: PixelCanvas, cx: number, cy: number): void {
  c.ellipse(cx, cy, 3, 2, WHITE)
  c.fillRect(cx + 3, cy - 1, 2, 2, [60, 52, 48])
  c.set(cx - 2, cy + 3, [60, 52, 48])
  c.set(cx + 1, cy + 3, [60, 52, 48])
}

const pasture: Draw = (c, color, state) => {
  for (const [x, y] of [
    [3, 13],
    [13, 4],
    [12, 13],
    [3, 3]
  ] as const)
    tuft(c, x, y, color)
  if (state === 0) {
    sheep(c, 5, 6)
    sheep(c, 10, 11)
  } else if (state === 1) {
    sheep(c, 8, 8)
  }
}

function horse(c: PixelCanvas, cx: number, cy: number, color: Rgb): void {
  c.ellipse(cx, cy, 3.5, 1.8, color)
  c.fillRect(cx + 2, cy - 3, 2, 3, shade(color, 1.1)) // neck
  c.fillRect(cx + 3, cy - 4, 3, 2, shade(color, 1.1)) // head
  for (const dx of [-3, -1, 1, 3]) c.fillRect(cx + dx, cy + 2, 1, 2, shade(color, 0.65)) // legs
  c.line(cx - 4, cy - 1, cx - 5, cy + 2, shade(color, 0.55)) // tail
}

const horses: Draw = (c, color, state) => {
  if (state === 0) {
    horse(c, 6, 5, color)
    horse(c, 7, 12, color)
  } else if (state === 1) {
    horse(c, 7, 9, color)
  } else {
    for (const [x, y] of [
      [4, 10],
      [7, 11],
      [10, 10],
      [12, 12]
    ] as const) {
      c.set(x, y, shade(SOIL, 0.8))
      c.set(x + 1, y, shade(SOIL, 0.8))
    }
  }
}

const cotton: Draw = (c, color, state) => {
  if (state === 2) {
    c.line(5, 13, 6, 8, WOOD)
    c.line(8, 13, 8, 7, WOOD)
    c.line(11, 13, 10, 8, WOOD)
    return
  }
  c.ellipse(8, 10, state === 0 ? 5.5 : 4, state === 0 ? 3.5 : 2.5, LEAF)
  const puffs: Array<[number, number]> = [
    [5, 8],
    [8, 6],
    [11, 8],
    [7, 10],
    [10, 11]
  ]
  for (const [x, y] of puffs.slice(0, state === 0 ? 5 : 2)) c.fillRect(x, y, 2, 2, color)
}

const spices: Draw = (c, color, state) => {
  const plants: Array<[number, number]> =
    state === 0
      ? [
          [4, 8],
          [8, 9],
          [12, 8]
        ]
      : state === 1
        ? [[8, 5]]
        : [
            [5, 2],
            [11, 2]
          ]
  for (const [x, h] of plants) {
    c.line(x, 13, x, 13 - h, state === 2 ? WOOD : LEAF)
    if (state !== 2) {
      c.set(x - 1, 13 - h + 3, LEAF)
      c.set(x + 1, 13 - h + 4, LEAF)
      c.fillRect(x, 13 - h - 1, 2, 2, color)
    }
  }
  c.fillRect(2, 14, 12, 1, SOIL)
}

const wine: Draw = (c, color, state) => {
  c.fillRect(3, 4, 1, 10, WOOD)
  c.fillRect(12, 4, 1, 10, WOOD)
  c.line(3, 5, 12, 5, shade(WOOD, 0.8))
  if (state === 2) {
    c.line(4, 6, 11, 8, shade(WOOD, 0.7))
    return
  }
  c.ellipse(6, 7, 2.5, 2.5, LEAF)
  c.ellipse(10, 7, 2.5, 2.5, LEAF)
  const grapes: Array<[number, number]> = [
    [5, 10],
    [6, 11],
    [9, 10],
    [10, 11],
    [8, 12]
  ]
  for (const [x, y] of grapes.slice(0, state === 0 ? 5 : 2)) c.set(x, y, color)
}

const tea: Draw = (c, color, state) => {
  c.fillRect(2, 13, 12, 2, SOIL)
  if (state === 2) {
    c.line(4, 12, 5, 10, WOOD)
    c.line(11, 12, 10, 10, WOOD)
    return
  }
  const mounds: Array<[number, number]> =
    state === 0
      ? [
          [5, 10],
          [11, 10],
          [8, 6]
        ]
      : [[8, 10]]
  for (const [x, y] of mounds) {
    c.ellipse(x, y, 3, 3, color)
    c.set(x - 1, y - 2, tint(color, 0.5))
    c.set(x + 1, y - 1, tint(color, 0.5))
  }
}

const ivory: Draw = (c, color, state) => {
  const tusk = (x: number, dir: 1 | -1): void => {
    c.line(x, 13, x + dir, 7, color)
    c.line(x + dir, 7, x + dir * 3, 3, color)
    c.line(x + 1, 13, x + 1 + dir, 7, shade(color, 0.8))
  }
  if (state === 0) {
    tusk(5, 1)
    tusk(10, -1)
  } else if (state === 1) {
    tusk(6, 1)
  } else {
    c.set(6, 12, color)
    c.set(7, 12, shade(color, 0.8))
    c.set(10, 13, color)
  }
}

const oil: Draw = (c, color, state) => {
  const pool: Rgb = shade(color, 0.7)
  c.ellipse(8, 12, pick(state, 6, 4, 3), pick(state, 3, 2, 1.5), pool)
  if (state === 2) return
  const top = pick(state, 2, 5, 0)
  c.line(8, top, 5, 10, [96, 96, 104])
  c.line(8, top, 11, 10, [96, 96, 104])
  c.line(6, 8, 10, 8, [96, 96, 104])
  c.set(8, top, [200, 60, 50])
}

const salt: Draw = (c, color, state) => {
  const pile = (cx: number, base: number, h: number): void => {
    for (let j = 0; j < h; j += 1) {
      const half = h - 1 - j
      for (let x = cx - half; x <= cx + half; x += 1)
        c.set(x, base - j, x > cx ? shade(color, 0.78) : color)
    }
  }
  if (state === 0) {
    pile(4, 13, 4)
    pile(11, 13, 5)
    pile(8, 8, 3)
  } else if (state === 1) {
    pile(8, 12, 4)
  } else {
    for (const [x, y] of [
      [5, 12],
      [9, 13],
      [11, 11]
    ] as const)
      c.set(x, y, color)
  }
}

function shell(c: PixelCanvas, cx: number, cy: number, color: Rgb): void {
  c.ellipse(cx, cy, 3, 2.5, color)
  c.set(cx - 1, cy, shade(color, 0.7))
  c.set(cx + 1, cy, shade(color, 0.7))
  c.set(cx, cy - 1, WHITE)
}

const pearls: Draw = (c, color, state) => {
  ripples(c, state !== 2)
  if (state === 0) {
    shell(c, 5, 6, color)
    shell(c, 10, 11, color)
  } else if (state === 1) {
    shell(c, 8, 9, color)
  }
}

const whales: Draw = (c, color, state) => {
  ripples(c, state !== 2)
  if (state === 2) return
  const small = state === 1
  c.ellipse(9, 10, small ? 4 : 5.5, small ? 2 : 3, color)
  if (!small) {
    c.line(3, 9, 1, 6, shade(color, 0.8)) // tail flukes
    c.line(3, 9, 1, 12, shade(color, 0.8))
    c.line(11, 7, 11, 3, WATER) // spout
    c.set(10, 2, WATER)
    c.set(12, 2, WATER)
  }
}

const DRAWERS: Readonly<Record<number, Draw>> = {
  [ResourceType.Timber]: timber,
  [ResourceType.Stone]: stone,
  [ResourceType.Iron]: ore(ROCK),
  [ResourceType.Gold]: ore(ROCK),
  [ResourceType.Grain]: grain,
  [ResourceType.Fish]: fishery,
  [ResourceType.Fur]: fur,
  [ResourceType.Pasture]: pasture,
  [ResourceType.Horses]: horses,
  [ResourceType.Cotton]: cotton,
  [ResourceType.Spices]: spices,
  [ResourceType.Wine]: wine,
  [ResourceType.Tea]: tea,
  [ResourceType.Ivory]: ivory,
  [ResourceType.Copper]: ore(shade(ROCK, 0.95)),
  [ResourceType.Coal]: ore([62, 62, 68]),
  [ResourceType.Oil]: oil,
  [ResourceType.Silver]: ore(shade(ROCK, 1.1)),
  [ResourceType.Salt]: salt,
  [ResourceType.Gems]: ore(shade(ROCK, 0.85)),
  [ResourceType.Pearls]: pearls,
  [ResourceType.Whales]: whales
}

/** Draw resource `type` in `state` on a clear canvas, with its outline. */
export function drawResource(
  c: PixelCanvas,
  type: number,
  color: Rgb,
  state: ResourceSpriteState
): void {
  const draw = DRAWERS[type]
  if (draw === undefined) throw new RangeError(`no art for resource ${type}`)
  draw(c, color, state)
  c.outline(OUTLINE)
}
