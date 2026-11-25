import { ResourceType } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { TREE_VARIANTS, buildSpriteAtlas, resourceLook } from '../src/sprites'

const atlas = buildSpriteAtlas()

const pixelsOf = (name: string): string => {
  const f = atlas.frames[name]
  if (f === undefined) throw new Error(`no frame ${name}`)
  const out: number[] = []
  for (let y = 0; y < f.h; y += 1) {
    for (let x = 0; x < f.w; x += 1) {
      const p = ((f.y + y) * atlas.width + f.x + x) * 4
      out.push(
        atlas.rgba[p] as number,
        atlas.rgba[p + 1] as number,
        atlas.rgba[p + 2] as number,
        atlas.rgba[p + 3] as number
      )
    }
  }
  return out.join(',')
}

describe('resourceLook: how big a deposit is drawn and where it stands', () => {
  it('draws a tree taller than a tile, a young one smaller and a stump about a tile', () => {
    const full = resourceLook(ResourceType.Timber, 0, 10)
    const low = resourceLook(ResourceType.Timber, 1, 10)
    const stump = resourceLook(ResourceType.Timber, 2, 10)
    expect(full.size).toBeGreaterThan(1.5)
    expect(low.size).toBeGreaterThan(stump.size)
    expect(full.size).toBeGreaterThan(low.size)
    expect(stump.size).toBeLessThanOrEqual(1.1)
  })

  it('draws rocks and ore a little bigger than a tile and crops, herds and fish at a tile', () => {
    expect(resourceLook(ResourceType.Stone, 0, 3).size).toBeGreaterThan(1)
    expect(resourceLook(ResourceType.Iron, 0, 3).size).toBeGreaterThan(1)
    for (const type of [ResourceType.Grain, ResourceType.Fish, ResourceType.Fur]) {
      expect(resourceLook(type, 0, 3).size, ResourceType[type]).toBe(1)
    }
  })

  it('gives solid things a shadow and flat ones (fields, water) none', () => {
    expect(resourceLook(ResourceType.Timber, 0, 1).shadow).toBeGreaterThan(0)
    expect(resourceLook(ResourceType.Stone, 0, 1).shadow).toBeGreaterThan(0)
    expect(resourceLook(ResourceType.Grain, 0, 1).shadow).toBe(0)
    expect(resourceLook(ResourceType.Fish, 0, 1).shadow).toBe(0)
  })

  it('shrinks the shadow as the tree comes down', () => {
    const w = (state: 0 | 1 | 2): number => resourceLook(ResourceType.Timber, state, 5).shadow
    expect(w(0)).toBeGreaterThan(w(1))
    expect(w(1)).toBeGreaterThan(w(2))
    expect(w(2)).toBeGreaterThan(0)
  })

  it('picks one of the tree variants from the tile, the same every time', () => {
    const seen = new Set<string>()
    for (let tile = 0; tile < 300; tile += 1) {
      const a = resourceLook(ResourceType.Timber, 0, tile)
      expect(resourceLook(ResourceType.Timber, 0, tile).frame).toBe(a.frame)
      seen.add(a.frame)
    }
    expect(seen.size).toBe(TREE_VARIANTS)
    expect(seen.has('resource.timber.full')).toBe(true)
  })

  it('mixes the variants roughly evenly, so a forest is not stripes', () => {
    const counts = new Map<string, number>()
    for (let tile = 0; tile < 3000; tile += 1) {
      const f = resourceLook(ResourceType.Timber, 0, tile).frame
      counts.set(f, (counts.get(f) ?? 0) + 1)
    }
    for (const n of counts.values()) expect(n).toBeGreaterThan(800)
    // neighbours in a row are not all the same variant
    const row = Array.from(
      { length: 30 },
      (_, x) => resourceLook(ResourceType.Timber, 0, 40 + x).frame
    )
    expect(new Set(row).size).toBeGreaterThan(1)
  })

  it('does not stripe a forest down the map whatever the width, because a column is mixed too', () => {
    for (const width of [999, 1000, 1001]) {
      const column = Array.from(
        { length: 40 },
        (_, y) => resourceLook(ResourceType.Timber, 0, y * width + 17).frame
      )
      expect(new Set(column).size, `width ${width}`).toBeGreaterThan(1)
    }
  })

  it('has one picture for a stump and for things that are not trees', () => {
    for (let tile = 0; tile < 50; tile += 1) {
      expect(resourceLook(ResourceType.Timber, 2, tile).frame).toBe('resource.timber.empty')
      expect(resourceLook(ResourceType.Iron, 0, tile).frame).toBe('resource.iron.full')
    }
  })

  it('names only frames the atlas has', () => {
    for (let type = 1; type <= 22; type += 1) {
      for (const state of [0, 1, 2] as const) {
        for (let tile = 0; tile < 20; tile += 1) {
          const look = resourceLook(type, state, tile)
          expect(atlas.frames[look.frame], look.frame).toBeDefined()
        }
      }
    }
  })

  it('stands the object on the ground: the contact point is inside the picture, low down', () => {
    for (let type = 1; type <= 22; type += 1) {
      const look = resourceLook(type, 0, 1)
      expect(look.anchorY).toBeGreaterThan(0.5)
      expect(look.anchorY).toBeLessThanOrEqual(1)
    }
  })

  it('rejects a resource that does not exist', () => {
    expect(() => resourceLook(0, 0, 1)).toThrow(RangeError)
    expect(() => resourceLook(99, 0, 1)).toThrow(RangeError)
  })
})

describe('the atlas: tree variants and the shadow', () => {
  it('draws each living tree state in every variant, and each looks different', () => {
    for (const state of ['full', 'low']) {
      const pics = [
        pixelsOf(`resource.timber.${state}`),
        pixelsOf(`resource.timber.${state}.v1`),
        pixelsOf(`resource.timber.${state}.v2`)
      ]
      expect(new Set(pics).size, state).toBe(3)
    }
  })

  it('has a shadow: a flat ellipse of solid pixels', () => {
    const f = atlas.frames['shadow']
    expect(f).toBeDefined()
    let solid = 0
    for (let y = 0; y < (f?.h ?? 0); y += 1) {
      for (let x = 0; x < (f?.w ?? 0); x += 1) {
        const p = (((f?.y ?? 0) + y) * atlas.width + (f?.x ?? 0) + x) * 4
        if (atlas.rgba[p + 3] === 255) solid += 1
      }
    }
    expect(solid).toBeGreaterThan(20)
    expect(solid).toBeLessThan(16 * 16 * 0.6) // flatter than a square
  })
})
