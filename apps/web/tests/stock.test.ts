import { describe, expect, it } from 'vitest'
import type { ResourceSlots } from '@sovereign/contracts'
import { applyStockChanges } from '../src/host/stock'

const slots = (): ResourceSlots => {
  const make = (): ResourceSlots['surface'] => ({
    type: new Uint8Array(10),
    richness: new Uint8Array(10),
    stock: new Uint8Array(10).fill(9)
  })
  return { surface: make(), ground: make() }
}

describe('applyStockChanges', () => {
  it('writes each change into the slot it names, and nothing else', () => {
    const s = slots()
    applyStockChanges(s, {
      tile: Uint32Array.of(2, 5, 2),
      layer: Uint8Array.of(0, 1, 1),
      value: Uint8Array.of(7, 3, 4)
    })
    expect(Array.from(s.surface.stock)).toEqual([9, 9, 7, 9, 9, 9, 9, 9, 9, 9])
    expect(Array.from(s.ground.stock)).toEqual([9, 9, 4, 9, 9, 3, 9, 9, 9, 9])
  })
  it('changes the stock only, never the type or the richness', () => {
    const s = slots()
    applyStockChanges(s, {
      tile: Uint32Array.of(1),
      layer: Uint8Array.of(0),
      value: Uint8Array.of(0)
    })
    expect(Array.from(s.surface.type)).toEqual(new Array(10).fill(0))
    expect(Array.from(s.surface.richness)).toEqual(new Array(10).fill(0))
  })
  it('does nothing for no changes', () => {
    const s = slots()
    applyStockChanges(s, {
      tile: new Uint32Array(0),
      layer: new Uint8Array(0),
      value: new Uint8Array(0)
    })
    expect(Array.from(s.surface.stock)).toEqual(new Array(10).fill(9))
  })
  it('refuses a change that is off the map, or lists of different lengths', () => {
    const s = slots()
    expect(() =>
      applyStockChanges(s, {
        tile: Uint32Array.of(10),
        layer: Uint8Array.of(0),
        value: Uint8Array.of(1)
      })
    ).toThrow(RangeError)
    expect(() =>
      applyStockChanges(s, {
        tile: Uint32Array.of(1, 2),
        layer: Uint8Array.of(0),
        value: Uint8Array.of(1)
      })
    ).toThrow(RangeError)
  })
})
