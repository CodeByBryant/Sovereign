import type { NationSnapshot } from '@sovereign/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NationPanel } from '../src'

const nation: NationSnapshot = {
  id: 'nation-0',
  name: 'Aldoria',
  color: [10, 20, 30],
  flag: { type: 'solid', background: [0, 0, 0], accent: [0, 0, 0] },
  government: 'republic',
  personality: {
    aggression: 0.3,
    expansionism: 0.4,
    diplomacy: 0.5,
    mercantilism: 0.6,
    militarism: 0.2
  },
  capital: 5,
  stats: { population: 120, military: 60, economy: 90, diplomacy: 70 },
  profile: {
    area: 1200,
    food: 960,
    timber: 41.6,
    stone: 12.2,
    horses: 3.4,
    metals: 18.5,
    luxuries: 6.25,
    diversity: 9,
    coast: 33,
    river: 80,
    highGround: 140,
    defence: 17,
    traffic: 0.42,
    contacts: 3
  },
  area: 1200
}

const render = (n: NationSnapshot = nation): string =>
  renderToStaticMarkup(<NationPanel nation={n} onClose={() => undefined} />)

describe('NationPanel: the land', () => {
  it('has a section about the land the nation holds', () => {
    const html = render()
    expect(html).toContain('Land')
  })

  it('shows what the land gives: food per tile, metals, luxuries, ports, strongholds, trade and neighbours', () => {
    const html = render()
    expect(html).toContain('Food')
    expect(html).toContain('0.80') // 960 food over 1200 tiles
    expect(html).toContain('Metals')
    expect(html).toContain('18.5')
    expect(html).toContain('Luxuries')
    expect(html).toContain('6.3') // 6.25 shown to one decimal
    expect(html).toContain('Resources')
    expect(html).toContain('9 kinds')
    expect(html).toContain('Coast')
    expect(html).toContain('33 tiles')
    expect(html).toContain('Strongholds')
    expect(html).toContain('17')
    expect(html).toContain('Trade')
    expect(html).toContain('42%')
    expect(html).toContain('Neighbours')
  })

  it('says "none" rather than 0 for a land with nothing of a kind, and writes one neighbour in the singular', () => {
    const html = render({
      ...nation,
      profile: { ...nation.profile, metals: 0, luxuries: 0, coast: 0, contacts: 1 }
    })
    expect(html).toContain('none')
    expect(html).toContain('1 neighbour')
    expect(html).not.toContain('1 neighbours')
  })

  it('keeps the statistics and personality it always had', () => {
    const html = render()
    expect(html).toContain('Population')
    expect(html).toContain('Aggression')
  })
})
