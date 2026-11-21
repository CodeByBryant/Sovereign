import { defaultWorldConfig, type StrategicConfig } from '@sovereign/config'
import { describe, expect, it } from 'vitest'
import { routeFeatures, type RouteCell, type RouteFeature } from '../src/terrain/strategic'

const config: StrategicConfig = defaultWorldConfig.strategic

/** A cell of open, low, dry land far from the sea. */
const open = (over: Partial<RouteCell> = {}): RouteCell => ({
  elevation: 0.45,
  river: 0,
  sea: false,
  seaDistance: 20,
  ...over
})
const many = (n: number, over: Partial<RouteCell> = {}): RouteCell[] =>
  Array.from({ length: n }, () => open(over))
const kinds = (features: RouteFeature[], type: string): RouteFeature[] =>
  features.filter((f) => f.type === type)
const idx = (features: RouteFeature[], type: string): number[] =>
  kinds(features, type).map((f) => f.index)

describe('routeFeatures: fords (river_crossing)', () => {
  it('finds a ford where the route crosses a river', () => {
    const cells = [...many(4), open({ river: 1 }), ...many(4)]
    expect(idx(routeFeatures(cells, config), 'river_crossing')).toEqual([4])
  })

  it('puts the ford at the narrowest part of a river it crosses over several cells', () => {
    const cells = [
      ...many(3),
      open({ river: 3 }),
      open({ river: 1 }),
      open({ river: 2 }),
      ...many(3)
    ]
    expect(idx(routeFeatures(cells, config), 'river_crossing')).toEqual([4])
  })

  it('takes the first of equally narrow cells', () => {
    const cells = [...many(3), open({ river: 2 }), open({ river: 2 }), ...many(3)]
    expect(idx(routeFeatures(cells, config), 'river_crossing')).toEqual([3])
  })

  it('does not count a route that runs along a river for longer than fordMaxRun', () => {
    const along = (n: number): RouteCell[] => [...many(3), ...many(n, { river: 1 }), ...many(3)]
    expect(idx(routeFeatures(along(config.fordMaxRun), config), 'river_crossing')).toHaveLength(1)
    expect(idx(routeFeatures(along(config.fordMaxRun + 1), config), 'river_crossing')).toEqual([])
  })

  it('does not count a river at either end of the route (the route does not cross it)', () => {
    expect(idx(routeFeatures([open({ river: 1 }), ...many(5)], config), 'river_crossing')).toEqual(
      []
    )
    expect(idx(routeFeatures([...many(5), open({ river: 1 })], config), 'river_crossing')).toEqual(
      []
    )
  })

  it('finds every river a route crosses', () => {
    const cells = [...many(3), open({ river: 1 }), ...many(5), open({ river: 2 }), ...many(3)]
    expect(idx(routeFeatures(cells, config), 'river_crossing')).toEqual([3, 9])
  })

  it('rates a narrow ford above a wide one', () => {
    const narrow = routeFeatures([...many(3), open({ river: 1 }), ...many(3)], config)
    const wide = routeFeatures([...many(3), open({ river: 4 }), ...many(3)], config)
    expect(kinds(narrow, 'river_crossing')[0].quality).toBeGreaterThan(
      kinds(wide, 'river_crossing')[0].quality
    )
  })
})

describe('routeFeatures: straits', () => {
  const sea = (n: number): RouteCell[] =>
    Array.from({ length: n }, () => open({ sea: true, elevation: 0.1, seaDistance: 0 }))

  it('finds a strait where a route crosses water between land, in the middle of the crossing', () => {
    expect(idx(routeFeatures([...many(4), ...sea(3), ...many(4)], config), 'strait')).toEqual([5])
    expect(idx(routeFeatures([...many(4), ...sea(4), ...many(4)], config), 'strait')).toEqual([5])
  })

  it('does not count water wider than straitMaxCells', () => {
    const wide = (n: number): RouteCell[] => [...many(4), ...sea(n), ...many(4)]
    expect(idx(routeFeatures(wide(config.straitMaxCells), config), 'strait')).toHaveLength(1)
    expect(idx(routeFeatures(wide(config.straitMaxCells + 1), config), 'strait')).toEqual([])
  })

  it('needs land on both sides', () => {
    expect(idx(routeFeatures([...many(4), ...sea(3)], config), 'strait')).toEqual([])
    expect(idx(routeFeatures([...sea(3), ...many(4)], config), 'strait')).toEqual([])
  })

  it('finds each crossing of a route that goes over water twice', () => {
    const cells = [...many(3), ...sea(2), ...many(3), ...sea(1), ...many(3)]
    expect(idx(routeFeatures(cells, config), 'strait')).toEqual([3, 8])
  })

  it('rates a narrow crossing above a wide one', () => {
    const narrow = kinds(routeFeatures([...many(3), ...sea(1), ...many(3)], config), 'strait')[0]
    const wide = kinds(routeFeatures([...many(3), ...sea(6), ...many(3)], config), 'strait')[0]
    expect(narrow.quality).toBeGreaterThan(wide.quality)
    expect(wide.quality).toBeGreaterThan(0)
  })
})

describe('routeFeatures: passes (mountain_pass)', () => {
  const ridge = (heights: number[]): RouteCell[] => heights.map((e) => open({ elevation: e }))

  it('finds the highest point of a route that climbs over a ridge', () => {
    const cells = ridge([0.4, 0.45, 0.5, 0.6, 0.7, 0.6, 0.5, 0.45, 0.4])
    expect(idx(routeFeatures(cells, config), 'mountain_pass')).toEqual([4])
  })

  it('needs the ground on each side to be lower by passRise', () => {
    const base = 0.6
    const over = (rise: number): RouteCell[] =>
      ridge([base, base + rise / 2, base + rise, base + rise / 2, base])
    expect(idx(routeFeatures(over(config.passRise * 1.01), config), 'mountain_pass')).toEqual([2])
    expect(idx(routeFeatures(over(config.passRise * 0.99), config), 'mountain_pass')).toEqual([])
  })

  it('is not fooled by one side: a route that climbs and stays up has no pass', () => {
    expect(
      idx(routeFeatures(ridge([0.4, 0.5, 0.6, 0.7, 0.7, 0.7]), config), 'mountain_pass')
    ).toEqual([])
    expect(
      idx(routeFeatures(ridge([0.7, 0.7, 0.7, 0.6, 0.5, 0.4]), config), 'mountain_pass')
    ).toEqual([])
  })

  it('does not count a rise in the lowlands, below passMinElevation', () => {
    const peak = config.passMinElevation - 0.02
    expect(idx(routeFeatures(ridge([0.2, 0.3, peak, 0.3, 0.2]), config), 'mountain_pass')).toEqual(
      []
    )
    const high = config.passMinElevation + 0.01
    expect(idx(routeFeatures(ridge([0.2, 0.3, high, 0.3, 0.2]), config), 'mountain_pass')).toEqual([
      2
    ])
  })

  it('counts a pass exactly at passMinElevation', () => {
    expect(
      idx(
        routeFeatures(ridge([0.2, 0.3, config.passMinElevation, 0.3, 0.2]), config),
        'mountain_pass'
      )
    ).toEqual([2])
  })

  it('takes the first cell of a flat summit', () => {
    expect(
      idx(routeFeatures(ridge([0.4, 0.5, 0.7, 0.7, 0.7, 0.5, 0.4]), config), 'mountain_pass')
    ).toEqual([2])
  })

  it('keeps only the higher of two summits within the window, and both when they are farther apart', () => {
    const gap = (n: number): number[] => [
      0.4,
      0.8,
      ...Array.from({ length: n }, () => 0.62),
      0.7,
      0.4
    ]
    expect(idx(routeFeatures(ridge(gap(config.passWindow - 2)), config), 'mountain_pass')).toEqual([
      1
    ])
    expect(
      idx(routeFeatures(ridge(gap(config.passWindow + 2)), config), 'mountain_pass')
    ).toHaveLength(2)
  })

  it('rates a higher rise above a lower one', () => {
    const low = kinds(routeFeatures(ridge([0.4, 0.58, 0.4]), config), 'mountain_pass')[0]
    const high = kinds(routeFeatures(ridge([0.3, 0.8, 0.3]), config), 'mountain_pass')[0]
    expect(high.quality).toBeGreaterThan(low.quality)
  })
})

describe('routeFeatures: land necks (isthmus)', () => {
  const profile = (distances: number[]): RouteCell[] =>
    distances.map((d) => open({ seaDistance: d, sea: d === 0 }))

  it('finds the narrowest point of land between two wider parts', () => {
    const cells = profile([6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6])
    expect(idx(routeFeatures(cells, config), 'isthmus')).toEqual([5])
  })

  it('needs the neck to be near the sea, at most isthmusMaxSeaDistance', () => {
    const neck = (d: number): number[] => [9, 8, 7, 6, 5, d, 5, 6, 7, 8, 9]
    expect(
      idx(routeFeatures(profile(neck(config.isthmusMaxSeaDistance)), config), 'isthmus')
    ).toEqual([5])
    expect(
      idx(routeFeatures(profile(neck(config.isthmusMaxSeaDistance + 1)), config), 'isthmus')
    ).toEqual([])
  })

  it('needs wider land on both sides, by isthmusRise', () => {
    expect(idx(routeFeatures(profile([5, 4, 3, 2, 1, 1, 1]), config), 'isthmus')).toEqual([])
    expect(idx(routeFeatures(profile([1, 1, 1, 2, 3, 4, 5]), config), 'isthmus')).toEqual([])
    const rise = config.isthmusRise
    expect(idx(routeFeatures(profile([1 + rise, 1, 1 + rise]), config), 'isthmus')).toEqual([1])
    expect(idx(routeFeatures(profile([rise, 1, rise]), config), 'isthmus')).toEqual([])
  })

  it('is not a neck when the route just follows a coast', () => {
    expect(idx(routeFeatures(profile([1, 1, 1, 1, 1, 1, 1, 1]), config), 'isthmus')).toEqual([])
  })

  it('does not look across the sea for the other side of a neck', () => {
    const cells = [...profile([6, 5, 4, 1]), ...profile([0, 0]), ...profile([1, 4, 5, 6])]
    expect(idx(routeFeatures(cells, config), 'isthmus')).toEqual([])
  })

  it('looks only isthmusWindow cells beyond the neck for the wider land', () => {
    // the neck is one cell at sea distance 2, with 3s around it (not wide enough) and a 9 beyond them
    const around = (k: number): number[] => [
      9,
      ...Array.from({ length: k }, () => 3),
      2,
      ...Array.from({ length: k }, () => 3),
      9
    ]
    expect(
      idx(routeFeatures(profile(around(config.isthmusWindow - 1)), config), 'isthmus')
    ).toHaveLength(1)
    expect(idx(routeFeatures(profile(around(config.isthmusWindow)), config), 'isthmus')).toEqual([])
  })

  it('puts the point in the middle of a long neck', () => {
    expect(idx(routeFeatures(profile([9, 8, 1, 1, 1, 1, 1, 8, 9]), config), 'isthmus')).toEqual([4])
    expect(idx(routeFeatures(profile([9, 8, 1, 1, 1, 1, 8, 9]), config), 'isthmus')).toEqual([3])
  })

  it('rates a narrower neck above a wider one', () => {
    const narrow = kinds(routeFeatures(profile([9, 8, 7, 1, 7, 8, 9]), config), 'isthmus')[0]
    const wide = kinds(routeFeatures(profile([9, 8, 7, 2, 7, 8, 9]), config), 'isthmus')[0]
    expect(narrow.quality).toBeGreaterThan(wide.quality)
  })
})

describe('routeFeatures: the whole route', () => {
  it('lists features in route order, each with a quality above 0 and at most 1', () => {
    const cells: RouteCell[] = [
      ...many(3),
      open({ river: 1 }),
      ...many(2),
      ...Array.from({ length: 2 }, () => open({ sea: true, elevation: 0.1, seaDistance: 0 })),
      ...many(2, { elevation: 0.6 }),
      open({ elevation: 0.8 }),
      ...many(2, { elevation: 0.6 })
    ]
    const features = routeFeatures(cells, config)
    expect(features.map((f) => f.type)).toEqual(['river_crossing', 'strait', 'mountain_pass'])
    expect(features.map((f) => f.index)).toEqual(
      [...features.map((f) => f.index)].sort((a, b) => a - b)
    )
    for (const f of features) {
      expect(f.quality).toBeGreaterThan(0)
      expect(f.quality).toBeLessThanOrEqual(1)
    }
  })

  it('finds nothing on a route too short to cross anything', () => {
    expect(routeFeatures([], config)).toEqual([])
    expect(routeFeatures([open()], config)).toEqual([])
    expect(routeFeatures(many(2), config)).toEqual([])
  })

  it('finds nothing on a flat dry route far from the sea', () => {
    expect(routeFeatures(many(30), config)).toEqual([])
  })
})
