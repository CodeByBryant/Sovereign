import { describe, expect, it } from 'vitest'
import { RESOURCE_CATALOG } from '@sovereign/contracts'
import {
  RESOURCE_SPRITE_STATES,
  ROAD_E,
  ROAD_N,
  ROAD_S,
  ROAD_W,
  SPRITE_SIZE,
  buildSpriteAtlas,
  resourceFrameName,
  resourceSpriteState,
  roadFrameName,
  type SpriteAtlas,
  type SpriteFrame
} from '../src/sprites'

const atlas = buildSpriteAtlas()

function pixels(a: SpriteAtlas, frame: SpriteFrame): number[][] {
  const out: number[][] = []
  for (let y = 0; y < frame.h; y += 1) {
    for (let x = 0; x < frame.w; x += 1) {
      const p = ((frame.y + y) * a.width + frame.x + x) * 4
      out.push([
        a.rgba[p] as number,
        a.rgba[p + 1] as number,
        a.rgba[p + 2] as number,
        a.rgba[p + 3] as number
      ])
    }
  }
  return out
}
const frameOf = (name: string): SpriteFrame => {
  const f = atlas.frames[name]
  if (f === undefined) throw new Error(`no frame ${name}`)
  return f
}
const opaque = (name: string): number =>
  pixels(atlas, frameOf(name)).filter((p) => p[3] === 255).length
const key = (name: string): string => JSON.stringify(pixels(atlas, frameOf(name)))

describe('resourceSpriteState: how much is left decides what is drawn', () => {
  it('is full at half the deposit or more, low while any is left, empty at zero', () => {
    expect(resourceSpriteState(200, 200)).toBe(0)
    expect(resourceSpriteState(100, 200)).toBe(0)
    expect(resourceSpriteState(99, 200)).toBe(1)
    expect(resourceSpriteState(1, 200)).toBe(1)
    expect(resourceSpriteState(0, 200)).toBe(2)
  })
  it('treats a slot with no richness as empty rather than dividing by zero', () => {
    expect(resourceSpriteState(0, 0)).toBe(2)
    expect(resourceSpriteState(5, 0)).toBe(2)
  })
  it('names a frame by resource key and state', () => {
    expect(resourceFrameName(1, 0)).toBe('resource.timber.full')
    expect(resourceFrameName(22, 2)).toBe('resource.whales.empty')
    expect(RESOURCE_SPRITE_STATES).toEqual(['full', 'low', 'empty'])
  })
  it('refuses a resource that is not in the catalogue', () => {
    expect(() => resourceFrameName(0, 0)).toThrow(RangeError)
    expect(() => resourceFrameName(23, 0)).toThrow(RangeError)
  })
})

describe('the atlas', () => {
  it('has a frame for every resource in every state, the villager, buildings and roads', () => {
    for (const def of RESOURCE_CATALOG) {
      for (let s = 0; s < 3; s += 1)
        expect(atlas.frames[resourceFrameName(def.id, s as 0)]).toBeDefined()
    }
    for (const name of ['villager.0', 'villager.1', 'house', 'hall', 'banner']) {
      expect(atlas.frames[name], name).toBeDefined()
    }
    for (let mask = 0; mask < 16; mask += 1) expect(atlas.frames[roadFrameName(mask)]).toBeDefined()
  })
  it('keeps every frame square, inside the sheet, and clear of every other frame', () => {
    const frames = Object.values(atlas.frames)
    expect(frames.length).toBe(22 * 3 + 2 + 3 + 16 + 4 + 1) // + 4 tree variants + the shadow
    const seen = new Set<string>()
    for (const f of frames) {
      expect(f.w).toBe(SPRITE_SIZE)
      expect(f.h).toBe(SPRITE_SIZE)
      expect(f.x + f.w).toBeLessThanOrEqual(atlas.width)
      expect(f.y + f.h).toBeLessThanOrEqual(atlas.height)
      const cell = `${f.x},${f.y}`
      expect(seen.has(cell)).toBe(false)
      seen.add(cell)
    }
    expect(atlas.rgba.length).toBe(atlas.width * atlas.height * 4)
  })
  it('is crisp pixel art: every pixel is fully opaque or fully clear', () => {
    for (let p = 3; p < atlas.rgba.length; p += 4) expect([0, 255]).toContain(atlas.rgba[p])
  })
  it('is the same every time it is built (a pinned checksum, so art cannot drift unseen)', () => {
    const again = buildSpriteAtlas()
    expect(again.rgba).toEqual(atlas.rgba)
    let h = 0x811c9dc5
    for (const b of atlas.rgba) h = Math.imul(h ^ b, 0x01000193) >>> 0
    expect(h.toString(16)).toBe('bf33aa2f')
  })
})

describe('resource sprites', () => {
  it('draw something for every resource in every state', () => {
    for (const def of RESOURCE_CATALOG) {
      for (const s of RESOURCE_SPRITE_STATES)
        expect(opaque(`resource.${def.key}.${s}`)).toBeGreaterThan(0)
    }
  })
  it('look different in every state, so a drawn-down deposit visibly changes', () => {
    for (const def of RESOURCE_CATALOG) {
      const keys = RESOURCE_SPRITE_STATES.map((s) => key(`resource.${def.key}.${s}`))
      expect(new Set(keys).size, def.key).toBe(3)
    }
  })
  it('lose substance as they empty: full has more to see than empty', () => {
    for (const def of RESOURCE_CATALOG) {
      expect(opaque(`resource.${def.key}.full`), def.key).toBeGreaterThan(
        opaque(`resource.${def.key}.empty`)
      )
    }
  })
  it('are all different from one another, so no two resources can be mistaken', () => {
    const keys = new Set<string>()
    for (const def of RESOURCE_CATALOG) keys.add(key(`resource.${def.key}.full`))
    expect(keys.size).toBe(22)
  })
})

describe('the villager', () => {
  it('is grey, so the renderer can tint it with its nation colour', () => {
    for (const name of ['villager.0', 'villager.1', 'banner']) {
      const px = pixels(atlas, frameOf(name)).filter((p) => p[3] === 255)
      expect(px.length).toBeGreaterThan(0)
      for (const p of px) {
        expect(p[0]).toBe(p[1])
        expect(p[1]).toBe(p[2])
      }
    }
  })
  it('has two walking frames that differ', () => {
    expect(key('villager.0')).not.toBe(key('villager.1'))
  })
  it('stands inside its frame with room for an outline', () => {
    const px = pixels(atlas, frameOf('villager.0'))
    for (let i = 0; i < px.length; i += 1) {
      const x = i % SPRITE_SIZE
      const y = Math.floor(i / SPRITE_SIZE)
      if (x === 0 || y === 0 || x === SPRITE_SIZE - 1 || y === SPRITE_SIZE - 1) {
        expect((px[i] as number[])[3]).toBe(0)
      }
    }
  })
})

describe('roads', () => {
  const mid = SPRITE_SIZE / 2
  const edge: Array<[number, number, number]> = [
    [ROAD_N, mid, 0],
    [ROAD_E, SPRITE_SIZE - 1, mid],
    [ROAD_S, mid, SPRITE_SIZE - 1],
    [ROAD_W, 0, mid]
  ]
  it('reach exactly the sides named in their mask, so neighbours join up', () => {
    for (let mask = 0; mask < 16; mask += 1) {
      const px = pixels(atlas, frameOf(roadFrameName(mask)))
      for (const [bit, x, y] of edge) {
        // the road is two pixels wide, so check both pixels at the middle of that side
        const cells =
          bit === ROAD_N || bit === ROAD_S
            ? [px[y * SPRITE_SIZE + x - 1], px[y * SPRITE_SIZE + x]]
            : [px[(y - 1) * SPRITE_SIZE + x], px[y * SPRITE_SIZE + x]]
        const reaches = cells.every((c) => (c as number[])[3] === 255)
        expect(reaches, `mask ${mask} side ${bit}`).toBe((mask & bit) !== 0)
      }
    }
  })
  it('all differ, and an isolated tile still shows a patch of trodden ground', () => {
    const keys = new Set<string>()
    for (let mask = 0; mask < 16; mask += 1) keys.add(key(roadFrameName(mask)))
    expect(keys.size).toBe(16)
    expect(opaque(roadFrameName(0))).toBeGreaterThan(0)
  })
  it('refuse a mask outside 0 to 15', () => {
    expect(() => roadFrameName(16)).toThrow(RangeError)
    expect(() => roadFrameName(-1)).toThrow(RangeError)
    expect(() => roadFrameName(1.5)).toThrow(RangeError)
  })
})

describe('buildings', () => {
  it('draw a house and a larger hall', () => {
    expect(opaque('house')).toBeGreaterThan(0)
    expect(opaque('hall')).toBeGreaterThan(opaque('house'))
  })
})
