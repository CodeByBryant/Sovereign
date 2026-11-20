// Expected checksums were captured from the OLD implementations (the ImageData-based functions
// that lived in the simulation package) on these same synthetic fields, before they were moved.
import { describe, expect, it } from 'vitest'
import { BIOME_KEYS, getBiomeColor } from '@sovereign/contracts'
import {
  biomeRgba,
  elevationRgba,
  humidityRgba,
  resourceRgba,
  strategicRgba,
  temperatureRgba
} from '../src/palettes'
import { checksum, syntheticFields } from './support/syntheticFields'

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
