// Expected checksums were captured from the OLD implementations (the ImageData-based functions
// that lived in the simulation package) on these same synthetic fields, before they were moved.
import { describe, expect, it } from 'vitest'
import {
  BIOME_KEYS,
  RESOURCE_CATALOG,
  ResourceType,
  getBiomeColor,
  type ResourceSlots,
  type StrategicPoint,
  type StrategicRoute
} from '@sovereign/contracts'
import {
  GROUND_DETAIL,
  biomeRgba,
  dominantResource,
  groundShade,
  elevationRgba,
  humidityRgba,
  politicalRgba,
  resourceRgba,
  strategicRgba,
  temperatureRgba
} from '../src/palettes'
import { checksum, syntheticFields, syntheticOwnership } from './support/syntheticFields'

const f = syntheticFields()
const pixels = f.width * f.height
const noRivers = new Uint8Array(pixels)

function expectOpaque(rgba: Uint8ClampedArray): void {
  expect(rgba.length).toBe(pixels * 4)
  for (let i = 3; i < rgba.length; i += 4) expect(rgba[i]).toBe(255)
}

describe('field colour ramps', () => {
  it('elevation: black at or below sea level, then a linear grey ramp', () => {
    const rgba = elevationRgba(f.elevation, f.seaLevel)
    expectOpaque(rgba)
    expect(checksum(rgba)).toBe('ee1c7661')
  })

  it('temperature: blue to red', () => {
    const rgba = temperatureRgba(f.temperature)
    expectOpaque(rgba)
    expect(checksum(rgba)).toBe('da8d5f58')
  })

  it('humidity: brown to blue', () => {
    const rgba = humidityRgba(f.humidity)
    expectOpaque(rgba)
    expect(checksum(rgba)).toBe('2dca9a8b')
  })

  it('elevation endpoints: sea level maps to black and 1.0 to white', () => {
    const rgba = elevationRgba(Float32Array.from([0, 0.37, 1]), 0.37)
    expect([...rgba.slice(0, 3)]).toEqual([0, 0, 0])
    expect([...rgba.slice(4, 7)]).toEqual([0, 0, 0])
    expect([...rgba.slice(8, 11)]).toEqual([255, 255, 255])
  })
})

describe('biomeRgba', () => {
  it('paints each tile with its biome colour when there are no rivers', () => {
    const rgba = biomeRgba(f.biomeIds, noRivers, f.width, f.height)
    expectOpaque(rgba)
    expect(checksum(rgba)).toBe('ea1ef61a')
    for (let i = 0; i < pixels; i += 1) {
      const c = getBiomeColor(BIOME_KEYS[f.biomeIds[i] as number] as (typeof BIOME_KEYS)[number])
      expect([...rgba.slice(i * 4, i * 4 + 3)]).toEqual(c)
    }
  })

  it('draws rivers (banks and water) over the biome colours', () => {
    const rgba = biomeRgba(f.biomeIds, f.riverWidth, f.width, f.height)
    expectOpaque(rgba)
    expect(checksum(rgba)).toBe('7da87274')
  })
})

describe('ground detail: tiles of one biome differ a little, as WorldBox tiles come in variants', () => {
  it('shades a tile the same way every time, from its position alone', () => {
    for (const [x, y] of [
      [0, 0],
      [17, 3],
      [999, 999]
    ] as const) {
      expect(groundShade(x, y)).toBe(groundShade(x, y))
    }
  })

  it('stays within the stated spread and does not brighten or darken the map on average', () => {
    let sum = 0
    let lo = Infinity
    let hi = -Infinity
    const n = 200
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const k = groundShade(x, y)
        sum += k
        lo = Math.min(lo, k)
        hi = Math.max(hi, k)
      }
    }
    expect(hi).toBeLessThanOrEqual(1 + GROUND_DETAIL.fine + GROUND_DETAIL.patch + 1e-9)
    expect(lo).toBeGreaterThanOrEqual(1 - GROUND_DETAIL.fine - GROUND_DETAIL.patch - 1e-9)
    expect(Math.abs(sum / (n * n) - 1)).toBeLessThan(0.002)
  })

  it('has several distinct shades, so a meadow is not one flat colour', () => {
    const seen = new Set<number>()
    for (let y = 0; y < 40; y += 1) for (let x = 0; x < 40; x += 1) seen.add(groundShade(x, y))
    expect(seen.size).toBeGreaterThanOrEqual(5)
  })

  it('moves in patches: most neighbours in the same 8 x 8 block share the coarse part', () => {
    // inside one block the shade differs only by the fine part, so it varies by at most 2 x fine
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 7; x += 1) {
        expect(Math.abs(groundShade(x, y) - groundShade(x + 1, y))).toBeLessThanOrEqual(
          2 * GROUND_DETAIL.fine + 1e-9
        )
      }
    }
  })

  it('is off by default: biomeRgba paints the plain biome colours', () => {
    const plain = biomeRgba(f.biomeIds, noRivers, f.width, f.height)
    expect(plain).toEqual(biomeRgba(f.biomeIds, noRivers, f.width, f.height, false))
    for (let i = 0; i < pixels; i += 1) {
      const c = getBiomeColor(BIOME_KEYS[f.biomeIds[i] as number] as (typeof BIOME_KEYS)[number])
      expect([...plain.slice(i * 4, i * 4 + 3)]).toEqual(c)
    }
  })

  it('shades land a little and leaves the sea its colour when on', () => {
    const rgba = biomeRgba(f.biomeIds, noRivers, f.width, f.height, true)
    expectOpaque(rgba)
    let landDiffers = 0
    let lands = 0
    for (let i = 0; i < pixels; i += 1) {
      const key = BIOME_KEYS[f.biomeIds[i] as number] as (typeof BIOME_KEYS)[number]
      const c = getBiomeColor(key)
      const got = [...rgba.slice(i * 4, i * 4 + 3)]
      if (key === 'ocean' || key === 'deep_ocean') {
        expect(got).toEqual(c)
        continue
      }
      lands += 1
      const k = groundShade(i % f.width, Math.floor(i / f.width))
      expect(got).toEqual(c.map((v) => Math.min(255, Math.max(0, Math.round(v * k)))))
      if (got.some((v, j) => v !== c[j])) landDiffers += 1
    }
    expect(lands).toBeGreaterThan(50)
    expect(landDiffers).toBeGreaterThan(lands * 0.4)
  })
})

describe('overlays', () => {
  const base = biomeRgba(f.biomeIds, f.riverWidth, f.width, f.height)

  it('strategic: dims the map and stamps a diamond marker per point, clipped at the edges', () => {
    expect(checksum(strategicRgba(base, f.width, f.height, f.strategicPoints))).toBe('66c4f7b2')
  })

  describe('strategic routes', () => {
    const W = 24
    const H = 16
    const grey = new Uint8ClampedArray(W * H * 4)
    for (let i = 0; i < W * H; i += 1) grey.set([100, 100, 100, 255], i * 4)
    const px = (rgba: Uint8ClampedArray, x: number, y: number): number[] =>
      Array.from(rgba.slice((y * W + x) * 4, (y * W + x) * 4 + 4))
    const route = (path: number[], traffic: number): StrategicRoute => ({
      from: 0,
      to: 1,
      cost: 1,
      traffic,
      path
    })
    const ROUTE = [255, 210, 120]
    const blend = (alpha: number): number[] =>
      ROUTE.map((c) => Math.round(75 * (1 - alpha) + c * alpha))

    it('draws no routes when there are none: the dimmed map and its markers, as before', () => {
      expect(checksum(strategicRgba(base, f.width, f.height, f.strategicPoints, []))).toBe(
        '66c4f7b2'
      )
    })

    it('paints a route as a line two tiles wide along its path, and leaves the rest of the map dimmed', () => {
      const out = strategicRgba(grey, W, H, [], [route([2, 5, 10, 5], 4)])
      for (let x = 2; x <= 10; x += 1) {
        expect(px(out, x, 5).slice(0, 3), `x ${x}`).toEqual(blend(0.85))
        expect(px(out, x, 6).slice(0, 3), `x ${x} below`).toEqual(blend(0.85))
      }
      expect(px(out, 6, 9)).toEqual([75, 75, 75, 255])
      expect(px(out, 12, 5)).toEqual([75, 75, 75, 255])
      expect(px(out, 6, 4)).toEqual([75, 75, 75, 255])
    })

    it('paints a diagonal route without gaps: every column between its ends has a painted tile', () => {
      const out = strategicRgba(grey, W, H, [], [route([2, 2, 14, 8], 1)])
      for (let x = 2; x <= 14; x += 1) {
        const painted = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].some((y) => px(out, x, y)[0] !== 75)
        expect(painted, `column ${x}`).toBe(true)
      }
    })

    it('joins the points of a path: every segment is drawn', () => {
      const out = strategicRgba(grey, W, H, [], [route([2, 3, 8, 3, 8, 10], 1)])
      expect(px(out, 5, 3)[0]).not.toBe(75)
      expect(px(out, 8, 7)[0]).not.toBe(75)
      expect(px(out, 5, 7)[0]).toBe(75)
    })

    it('draws a busier route brighter than a quiet one, by the square root of its share of the busiest', () => {
      const out = strategicRgba(
        grey,
        W,
        H,
        [],
        [route([2, 3, 10, 3], 4), route([2, 10, 10, 10], 1)]
      )
      expect(px(out, 6, 3).slice(0, 3)).toEqual(blend(0.85))
      expect(px(out, 6, 10).slice(0, 3)).toEqual(blend(0.3 + (0.85 - 0.3) * 0.5))
    })

    it('puts a strategic point marker over a route', () => {
      const point: StrategicPoint = { x: 6, y: 5, type: 'mountain_pass', value: 10 }
      const without = strategicRgba(grey, W, H, [], [route([2, 5, 10, 5], 1)])
      const withPoint = strategicRgba(grey, W, H, [point], [route([2, 5, 10, 5], 1)])
      expect(px(withPoint, 6, 5)).not.toEqual(px(without, 6, 5))
    })

    it('clips a route that runs off the map, and draws a one-point path as a single stamp', () => {
      expect(() => strategicRgba(grey, W, H, [], [route([-5, 4, 40, 4], 1)])).not.toThrow()
      const out = strategicRgba(grey, W, H, [], [route([-5, 4, 40, 4], 1)])
      expect(px(out, 0, 4)[0]).not.toBe(75)
      expect(px(out, W - 1, 4)[0]).not.toBe(75)
      const single = strategicRgba(grey, W, H, [], [route([7, 7], 1)])
      expect(px(single, 7, 7)[0]).not.toBe(75)
      expect(px(single, 9, 7)[0]).toBe(75)
    })

    it('stamps a tile and the ones to its right and below it, and nothing beyond', () => {
      const out = strategicRgba(grey, W, H, [], [route([5, 5, 6, 5], 1)])
      for (const [x, y] of [
        [5, 5],
        [6, 5],
        [7, 5],
        [5, 6],
        [6, 6],
        [7, 6]
      ] as const) {
        expect(px(out, x, y)[0], `${x},${y}`).not.toBe(75)
      }
      expect(px(out, 4, 5)[0]).toBe(75)
      expect(px(out, 8, 5)[0]).toBe(75)
      expect(px(out, 5, 4)[0]).toBe(75)
      expect(px(out, 5, 7)[0]).toBe(75)
    })

    it('draws a shallow diagonal along the straight line between its ends', () => {
      // (0, 0) to (5, 2): the line is at y = 0, 0, 1, 1, 2, 2 for x = 0 to 5
      const out = strategicRgba(grey, W, H, [], [route([0, 0, 5, 2], 1)])
      const line = [
        [0, 0],
        [1, 0],
        [2, 1],
        [3, 1],
        [4, 2],
        [5, 2]
      ]
      const covered = new Set<string>()
      for (const [x, y] of line)
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1]
        ])
          covered.add(`${x! + dx!},${y! + dy!}`)
      for (let y = 0; y < 6; y += 1) {
        for (let x = 0; x < 9; x += 1) {
          expect(px(out, x, y)[0] !== 75, `${x},${y}`).toBe(covered.has(`${x},${y}`))
        }
      }
    })

    it('does not wrap a route that leaves the right edge onto the next row', () => {
      const out = strategicRgba(grey, W, H, [], [route([20, 4, 30, 4], 1)])
      expect(px(out, 3, 5)[0]).toBe(75) // where column 27 of row 4 would land if it wrapped
      expect(px(out, 23, 4)[0]).not.toBe(75)
    })

    it('draws nothing for a route with no traffic beside a busy one', () => {
      const out = strategicRgba(
        grey,
        W,
        H,
        [],
        [route([2, 3, 10, 3], 4), route([2, 10, 10, 10], 0)]
      )
      expect(px(out, 6, 3)[0]).not.toBe(75)
      expect(px(out, 6, 10)).toEqual([75, 75, 75, 255])
    })

    it('never modifies the base image, and ignores routes with no traffic', () => {
      const copy = new Uint8ClampedArray(grey)
      strategicRgba(grey, W, H, [], [route([2, 5, 10, 5], 1)])
      expect(grey).toEqual(copy)
      const quiet = strategicRgba(grey, W, H, [], [route([2, 5, 10, 5], 0)])
      expect(px(quiet, 6, 5)).toEqual([75, 75, 75, 255])
    })
  })

  it('resource: tints tiles that have a resource and leaves the others alone', () => {
    const out = resourceRgba(base, f.resources)
    expectOpaque(out)
    let tinted = 0
    for (let i = 0; i < pixels; i += 1) {
      const has = f.resources.surface.type[i] !== 0 || f.resources.ground.type[i] !== 0
      const same = [0, 1, 2].every((c) => out[i * 4 + c] === base[i * 4 + c])
      if (!has) expect(same).toBe(true)
      else if (!same) tinted += 1
    }
    expect(tinted).toBeGreaterThan(pixels / 4)
    expect(checksum(out)).toBe('79ab4ecc')
  })

  describe('one tile', () => {
    const one = (
      surface: [number, number, number],
      ground: [number, number, number]
    ): ResourceSlots => ({
      surface: {
        type: Uint8Array.of(surface[0]),
        richness: Uint8Array.of(surface[1]),
        stock: Uint8Array.of(surface[2])
      },
      ground: {
        type: Uint8Array.of(ground[0]),
        richness: Uint8Array.of(ground[1]),
        stock: Uint8Array.of(ground[2])
      }
    })
    const grey = new Uint8ClampedArray([100, 100, 100, 255])
    const colorOf = (id: number): readonly number[] => RESOURCE_CATALOG[id - 1]!.color
    const distance = (a: ArrayLike<number>, b: readonly number[]): number =>
      Math.abs((a[0] as number) - (b[0] as number)) +
      Math.abs((a[1] as number) - (b[1] as number)) +
      Math.abs((a[2] as number) - (b[2] as number))

    it('moves toward the resource colour, further when more is left', () => {
      const poor = resourceRgba(grey, one([ResourceType.Timber, 200, 10], [0, 0, 0]))
      const rich = resourceRgba(grey, one([ResourceType.Timber, 200, 200], [0, 0, 0]))
      expect(distance(poor, colorOf(ResourceType.Timber))).toBeLessThan(
        distance(grey, colorOf(ResourceType.Timber))
      )
      expect(distance(rich, colorOf(ResourceType.Timber))).toBeLessThan(
        distance(poor, colorOf(ResourceType.Timber))
      )
    })

    it('a drawn-down deposit still shows faintly, so you can see where it was', () => {
      const out = resourceRgba(grey, one([0, 0, 0], [ResourceType.Iron, 200, 0]))
      expect(Array.from(out.slice(0, 3))).not.toEqual([100, 100, 100])
    })

    it('keeps alpha opaque', () => {
      expect(resourceRgba(grey, one([ResourceType.Fish, 9, 9], [0, 0, 0]))[3]).toBe(255)
    })
  })

  describe('dominantResource', () => {
    it('is the only resource when there is one, and 0 when there is none', () => {
      expect(dominantResource(0, 0)).toBe(0)
      expect(dominantResource(ResourceType.Timber, 0)).toBe(ResourceType.Timber)
      expect(dominantResource(0, ResourceType.Coal)).toBe(ResourceType.Coal)
    })
    it('prefers a luxury to an industrial resource to a basic one', () => {
      expect(dominantResource(ResourceType.Spices, ResourceType.Iron)).toBe(ResourceType.Spices)
      expect(dominantResource(ResourceType.Timber, ResourceType.Iron)).toBe(ResourceType.Iron)
      expect(dominantResource(ResourceType.Timber, ResourceType.Gold)).toBe(ResourceType.Gold)
      expect(dominantResource(ResourceType.Grain, ResourceType.Stone)).toBe(ResourceType.Stone)
    })
    it('takes the ground resource when the tiers are equal', () => {
      expect(dominantResource(ResourceType.Tea, ResourceType.Gems)).toBe(ResourceType.Gems)
    })
  })

  describe('with a focus', () => {
    it('tints only tiles that hold the focused resource, in either slot, and dims the rest', () => {
      const out = resourceRgba(base, f.resources, ResourceType.Iron)
      let held = 0
      for (let i = 0; i < pixels; i += 1) {
        const has =
          f.resources.surface.type[i] === ResourceType.Iron ||
          f.resources.ground.type[i] === ResourceType.Iron
        const dimmed = out[i * 4] === Math.round((base[i * 4] as number) * 0.55)
        if (has) held += 1
        else expect(dimmed).toBe(true)
        if (has) expect(dimmed).toBe(false)
      }
      expect(held).toBeGreaterThan(0)
    })
    it('a focus on a resource that is nowhere just dims the map', () => {
      const none = {
        type: new Uint8Array(pixels),
        richness: new Uint8Array(pixels),
        stock: new Uint8Array(pixels)
      }
      const out = resourceRgba(base, { surface: none, ground: none }, ResourceType.Whales)
      for (let i = 0; i < base.length; i += 4)
        expect(out[i]).toBe(Math.round((base[i] as number) * 0.55))
    })
  })

  it('never modifies the base image it is given', () => {
    const copy = new Uint8ClampedArray(base)
    strategicRgba(base, f.width, f.height, f.strategicPoints)
    resourceRgba(base, f.resources)
    expect(base).toEqual(copy)
  })

  it('with no strategic points the overlay is just the dimmed base', () => {
    const dim = strategicRgba(base, f.width, f.height, [])
    for (let i = 0; i < base.length; i += 4) {
      expect(dim[i]).toBe(Math.round((base[i] as number) * 0.75))
    }
  })
})

describe('politicalRgba', () => {
  const base = biomeRgba(f.biomeIds, f.riverWidth, f.width, f.height)
  const { ownership, colors } = syntheticOwnership(f.width, f.height)
  const style = { alpha: 0.45, darken: 0.35 }
  const paint = (own = ownership, s = style): Uint8ClampedArray =>
    politicalRgba(base, own, colors, f.width, f.height, s)

  // Checksums captured from the OLD inline implementation in MapView, before it moved here.
  it('reproduces the old overlay exactly', () => {
    expect(checksum(paint())).toBe('8012d26c')
    expect(checksum(paint(ownership, { alpha: 0.2, darken: 0.5 }))).toBe('bb51a0ea')
  })

  it('is just the base map when nobody owns anything', () => {
    const none = new Uint8Array(ownership.length).fill(255)
    expect(checksum(paint(none))).toBe('7da87274')
    expect(paint(none)).toEqual(base)
  })

  it('leaves unclaimed tiles exactly as they were, and recolours claimed ones', () => {
    const out = paint()
    for (let i = 0; i < ownership.length; i += 1) {
      const same = [0, 1, 2, 3].every((k) => out[i * 4 + k] === base[i * 4 + k])
      expect(same).toBe(ownership[i] === 255)
    }
  })

  it('never modifies the base image it is given', () => {
    const copy = new Uint8ClampedArray(base)
    paint()
    expect(base).toEqual(copy)
  })

  it('blends an interior tile by alpha, and a border tile by alpha + darken then dims it by 30%', () => {
    const out = paint()
    const blend = (b: number, c: number, a: number): number => Math.round(b * (1 - a) + c * a)
    // tile (30, 20) is deep inside nation 1's rectangle (18..40 x 10..30): not a border.
    const inside = (20 * f.width + 30) * 4
    expect(out[inside]).toBe(blend(base[inside] as number, 40, 0.45))
    expect(out[inside + 1]).toBe(blend(base[inside + 1] as number, 200, 0.45))
    // tile (40, 20) is on its right edge: a border.
    const edge = (20 * f.width + 40) * 4
    expect(out[edge + 1]).toBe(Math.round(blend(base[edge + 1] as number, 200, 0.8) * 0.7))
  })

  it('treats a lone tile as a border, since every neighbour differs', () => {
    const out = paint()
    const lone = (2 * f.width + 50) * 4
    const expected = Math.round(Math.round((base[lone + 2] as number) * 0.55 + 200 * 0.45) * 0.7)
    expect(out[lone + 2]).toBe(
      Math.round(Math.round((base[lone + 2] as number) * 0.2 + 200 * 0.8) * 0.7)
    )
    expect(expected).not.toBe(out[lone + 2])
  })

  it('does not count the edge of the map as a border: one nation owning everything has none', () => {
    const all = new Uint8Array(ownership.length).fill(0)
    const out = paint(all)
    for (let i = 0; i < all.length; i += 1) {
      expect(out[i * 4]).toBe(Math.round((base[i * 4] as number) * 0.55 + 200 * 0.45))
    }
  })

  it('leaves a tile alone if its owner has no colour, instead of failing', () => {
    const odd = new Uint8Array(ownership)
    odd[0] = 200
    const out = paint(odd)
    expect([out[0], out[1], out[2]]).toEqual([base[0], base[1], base[2]])
  })
})

describe('politicalRgba: province borders', () => {
  // an 8 x 4 map, all of it one nation's, cut into two provinces by a vertical line between x = 3 and x = 4
  const W = 8
  const H = 4
  const grey = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < W * H; i += 1) grey.set([100, 100, 100, 255], i * 4)
  const owned = new Uint8Array(W * H).fill(0)
  const colors: Array<[number, number, number]> = [[200, 40, 40]]
  const provinces = new Uint16Array(W * H)
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) provinces[y * W + x] = x < 4 ? 0 : 1
  const style = { alpha: 0.5, darken: 0.2, provinceDarken: 0.25 }
  const at = (rgba: Uint8ClampedArray, x: number, y: number): number[] =>
    Array.from(rgba.subarray((y * W + x) * 4, (y * W + x) * 4 + 3))

  it('is the same as before when no provinces are given', () => {
    const without = politicalRgba(grey, owned, colors, W, H, style)
    const plain = politicalRgba(grey, owned, colors, W, H, { alpha: 0.5, darken: 0.2 })
    expect(without).toEqual(plain)
  })

  it('darkens the tiles on both sides of a border between two provinces of one nation, and only those', () => {
    const out = politicalRgba(grey, owned, colors, W, H, style, provinces)
    const plain = politicalRgba(grey, owned, colors, W, H, style)
    for (const y of [1, 2]) {
      for (let x = 0; x < W; x += 1) {
        const onBorder = x === 3 || x === 4
        const expected = at(plain, x, y).map((v) => (onBorder ? Math.round(v * 0.75) : v))
        expect(at(out, x, y), `(${x}, ${y})`).toEqual(expected)
      }
    }
  })

  it('leaves a nation border alone: it is drawn as ever, province or not', () => {
    const out = politicalRgba(grey, owned, colors, W, H, style, provinces)
    const plain = politicalRgba(grey, owned, colors, W, H, style)
    // the top row is the edge of the map and not a nation border; the west end x = 0 is not a border either
    // (the edge of the map does not count), so make a real one: a second nation to the south
    const two = new Uint8Array(owned)
    for (let x = 0; x < W; x += 1) two[3 * W + x] = 1
    const colors2: Array<[number, number, number]> = [
      [200, 40, 40],
      [40, 40, 200]
    ]
    const withProvinces = politicalRgba(grey, two, colors2, W, H, style, provinces)
    const withoutProvinces = politicalRgba(grey, two, colors2, W, H, style)
    for (let x = 0; x < W; x += 1) {
      // rows 2 and 3 are the nation border: identical with and without province lines
      expect(at(withProvinces, x, 2)).toEqual(at(withoutProvinces, x, 2))
      expect(at(withProvinces, x, 3)).toEqual(at(withoutProvinces, x, 3))
    }
    expect(out.length).toBe(plain.length)
  })

  it('draws a line between provinces above and below each other as well', () => {
    const rows = new Uint16Array(W * H)
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) rows[y * W + x] = y < 2 ? 0 : 1
    const out = politicalRgba(grey, owned, colors, W, H, style, rows)
    const plain = politicalRgba(grey, owned, colors, W, H, style)
    for (let y = 0; y < H; y += 1) {
      const onBorder = y === 1 || y === 2
      expect(at(out, 3, y), `y ${y}`).toEqual(
        at(plain, 3, y).map((v) => (onBorder ? Math.round(v * 0.75) : v))
      )
    }
  })

  it('does not draw a province line where there is none: the sea and unowned land stay as they were', () => {
    const none = new Uint8Array(W * H).fill(255)
    expect(politicalRgba(grey, none, colors, W, H, style, provinces)).toEqual(grey)
  })

  it('draws no province lines with a province darkening of 0 or none', () => {
    const noLines = politicalRgba(grey, owned, colors, W, H, { alpha: 0.5, darken: 0.2 }, provinces)
    expect(noLines).toEqual(politicalRgba(grey, owned, colors, W, H, style, new Uint16Array(W * H)))
    expect(noLines).toEqual(
      politicalRgba(grey, owned, colors, W, H, { ...style, provinceDarken: 0 }, provinces)
    )
  })

  it('sees a province line with 0xFFFF (no province) on its other side too', () => {
    // a notch of unclaimed-province tiles inside the nation: the owned tile beside it is on a province line
    const notch = new Uint16Array(provinces)
    notch[1 * W + 6] = 0xffff
    const out = politicalRgba(grey, owned, colors, W, H, style, notch)
    const plain = politicalRgba(grey, owned, colors, W, H, style)
    expect(at(out, 6, 2)).toEqual(at(plain, 6, 2).map((v) => Math.round(v * 0.75)))
  })
})
