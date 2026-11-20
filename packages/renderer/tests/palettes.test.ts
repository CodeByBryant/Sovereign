// Expected checksums were captured from the OLD implementations (the ImageData-based functions
// that lived in the simulation package) on these same synthetic fields, before they were moved.
import { describe, expect, it } from 'vitest'
import { BIOME_KEYS, getBiomeColor } from '@sovereign/contracts'
import {
  biomeRgba,
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

describe('overlays', () => {
  const base = biomeRgba(f.biomeIds, f.riverWidth, f.width, f.height)

  it('strategic: dims the map and stamps a diamond marker per point, clipped at the edges', () => {
    expect(checksum(strategicRgba(base, f.width, f.height, f.strategicPoints))).toBe('66c4f7b2')
  })

  it('resource: tints tiles that have a resource, scaled by density', () => {
    expect(checksum(resourceRgba(base, f.resourceType, f.resourceDensity))).toBe('31e89b1d')
  })

  it('never modifies the base image it is given', () => {
    const copy = new Uint8ClampedArray(base)
    strategicRgba(base, f.width, f.height, f.strategicPoints)
    resourceRgba(base, f.resourceType, f.resourceDensity)
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
