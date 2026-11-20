import { describe, expect, it } from 'vitest'
import { chooseCapitals, contactCounts } from '../src/nations/capitals'

const hub = (x: number, y: number, weight: number) => ({ x, y, weight })

describe('chooseCapitals', () => {
  it('takes the best site first', () => {
    const hubs = [hub(0, 0, 0.5), hub(100, 0, 0.9), hub(200, 0, 0.7)]
    expect(chooseCapitals(hubs, 1, 50)[0]).toBe(1)
  })

  it('keeps every capital at least minSpacing from the others, and allows exactly minSpacing', () => {
    const hubs = [hub(0, 0, 1), hub(49, 0, 0.99), hub(50, 0, 0.98), hub(100, 0, 0.97)]
    expect(chooseCapitals(hubs, 4, 50)).toEqual([0, 3, 2]) // the far site first, then the one exactly 50 from both
  })

  it('prefers a site far from the others to a slightly better one close by', () => {
    // after the first pick at x = 0, the site at 50 is better (1) but half the spacing from nowhere better than 150
    const hubs = [hub(0, 0, 1), hub(50, 0, 1), hub(100, 0, 0.8)]
    expect(chooseCapitals(hubs, 2, 50)).toEqual([0, 2])
  })

  it('measures distance in a straight line, not along the axes', () => {
    const hubs = [hub(0, 0, 1), hub(30, 40, 0.9), hub(29, 40, 0.8)]
    // (30, 40) is exactly 50 away: allowed; (29, 40) is closer than 50 to the first pick, and to nothing else
    expect(chooseCapitals(hubs, 3, 50)).toEqual([0, 1])
  })

  it('returns fewer than asked when there are not enough sites, and none for none', () => {
    const hubs = [hub(0, 0, 1), hub(10, 0, 0.9)]
    expect(chooseCapitals(hubs, 5, 50)).toEqual([0])
    expect(chooseCapitals([], 3, 50)).toEqual([])
    expect(chooseCapitals(hubs, 0, 50)).toEqual([])
  })

  it('breaks ties by the lower hub index', () => {
    const hubs = [hub(0, 0, 0.5), hub(100, 0, 0.5), hub(200, 0, 0.5)]
    expect(chooseCapitals(hubs, 3, 50)).toEqual([0, 1, 2])
    expect(chooseCapitals(hubs, 1, 50)).toEqual([0])
  })

  it('only considers the sites it is allowed to', () => {
    const hubs = [hub(0, 0, 1), hub(100, 0, 0.9), hub(200, 0, 0.8)]
    expect(chooseCapitals(hubs, 2, 50, (i) => i !== 0)).toEqual([1, 2])
  })

  it('spreads capitals over the map instead of crowding the best corner', () => {
    // a grid of equally good sites 60 apart: the picks end up far apart, not in a clump
    const hubs = []
    for (let y = 0; y < 5; y += 1) for (let x = 0; x < 5; x += 1) hubs.push(hub(x * 60, y * 60, 1))
    const picked = chooseCapitals(hubs, 4, 60)
    let nearest = Infinity
    for (let i = 0; i < picked.length; i += 1) {
      for (let j = i + 1; j < picked.length; j += 1) {
        const a = hubs[picked[i] as number]!
        const b = hubs[picked[j] as number]!
        nearest = Math.min(nearest, Math.hypot(a.x - b.x, a.y - b.y))
      }
    }
    expect(nearest).toBeGreaterThanOrEqual(120)
  })

  it('is the same twice, and never names a hub twice', () => {
    const hubs = Array.from({ length: 20 }, (_, i) =>
      hub((i * 37) % 200, (i * 53) % 200, 0.5 + (i % 5) / 10)
    )
    const a = chooseCapitals(hubs, 8, 30)
    expect(chooseCapitals(hubs, 8, 30)).toEqual(a)
    expect(new Set(a).size).toBe(a.length)
  })
})

describe('contactCounts', () => {
  const line = (n: number) => Array.from({ length: n - 1 }, (_, i) => ({ from: i, to: i + 1 }))

  it('counts the other capitals within the given number of routes', () => {
    expect(contactCounts([0, 2, 4], line(5), 5, 1)).toEqual([0, 0, 0])
    expect(contactCounts([0, 2, 4], line(5), 5, 2)).toEqual([1, 2, 1])
    expect(contactCounts([0, 2, 4], line(5), 5, 4)).toEqual([2, 2, 2])
  })

  it('counts nobody at 0 hops, and never itself', () => {
    expect(contactCounts([0, 2], line(5), 5, 0)).toEqual([0, 0])
    expect(contactCounts([0], line(5), 5, 9)).toEqual([0])
  })

  it('does not reach across hubs that no route joins', () => {
    const routes = [
      { from: 0, to: 1 },
      { from: 2, to: 3 }
    ]
    expect(contactCounts([0, 3], routes, 4, 9)).toEqual([0, 0])
    expect(contactCounts([0, 1], routes, 4, 1)).toEqual([1, 1])
  })

  it('follows routes in either direction, and goes through hubs that are not capitals', () => {
    const routes = [
      { from: 0, to: 2 },
      { from: 1, to: 2 }
    ]
    expect(contactCounts([0, 1], routes, 3, 2)).toEqual([1, 1])
    expect(contactCounts([0, 1], routes, 3, 1)).toEqual([0, 0])
  })

  it('has no capitals, no contacts', () => {
    expect(contactCounts([], line(3), 3, 3)).toEqual([])
  })
})
