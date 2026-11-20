import { ResourceType, type TileInfo } from '@sovereign/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TileInspector } from '../src'

function tile(resources: TileInfo['resources']): TileInfo {
  return {
    x: 3,
    y: 4,
    index: 7,
    elevation: 0.5,
    temperature: 0.5,
    humidity: 0.5,
    biomeId: 12,
    biome: 'grassland',
    isRiver: false,
    isWater: false,
    nearShore: false,
    resources,
    ownerId: -1
  }
}

const render = (resources: TileInfo['resources']): string =>
  renderToStaticMarkup(
    <TileInspector data={{ tile: tile(resources), strategic: null, nation: null }} />
  )

describe('TileInspector resources', () => {
  const timber = {
    type: ResourceType.Timber,
    key: 'timber',
    label: 'Timber',
    layer: 'surface' as const,
    richness: 200,
    stock: 50
  }
  const iron = {
    type: ResourceType.Iron,
    key: 'iron',
    label: 'Iron',
    layer: 'ground' as const,
    richness: 100,
    stock: 0
  }

  it('lists a tile with no resources without any resource rows', () => {
    expect(render([])).not.toContain('inspector__resource')
  })

  it('lists every resource the tile holds, with its slot and whether it grows back', () => {
    const html = render([timber, iron])
    expect(html).toContain('Timber')
    expect(html).toContain('Iron')
    expect(html).toContain('Surface')
    expect(html).toContain('Ground')
    expect(html).toContain('renewable')
    expect(html).toContain('finite')
    expect((html.match(/inspector__resource"/g) ?? []).length).toBe(2)
  })

  it('draws a stock bar as wide as what is left of the deposit', () => {
    const html = render([timber, iron])
    expect(html).toContain('width:25%') // 50 of 200
    expect(html).toContain('width:0%') // an exhausted deposit
    expect(html).toContain('25% left')
    expect(html).toContain('0% left')
  })

  it('shows a full deposit as a full bar', () => {
    expect(render([{ ...timber, stock: 200 }])).toContain('width:100%')
  })
})
