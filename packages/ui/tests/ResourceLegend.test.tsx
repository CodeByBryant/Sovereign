import { RESOURCE_CATALOG } from '@sovereign/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ResourceLegend } from '../src'

const render = (focus: number): string =>
  renderToStaticMarkup(<ResourceLegend focus={focus} onFocus={() => undefined} />)

/** The attribute string of the button for a resource (or the "all" button), or null. */
function chip(html: string, id: number | 'all'): string | null {
  const attr = id === 'all' ? 'data-resource-id="all"' : `data-resource-id="${id}"`
  const match = new RegExp(`<button[^>]*${attr}[^>]*>`).exec(html)
  return match === null ? null : match[0]
}

describe('ResourceLegend', () => {
  it('has a button for every resource in the catalogue, with its label', () => {
    const html = render(0)
    for (const def of RESOURCE_CATALOG) {
      expect(chip(html, def.id), def.key).not.toBeNull()
      expect(html).toContain(def.label.replace('&', '&amp;'))
    }
    expect((html.match(/data-resource-id="\d+"/g) ?? []).length).toBe(RESOURCE_CATALOG.length)
  })

  it('has an "all resources" button, pressed only when nothing is focused', () => {
    expect(chip(render(0), 'all')).toContain('aria-pressed="true"')
    expect(chip(render(3), 'all')).toContain('aria-pressed="false"')
  })

  it('marks only the focused resource as pressed', () => {
    const html = render(3)
    for (const def of RESOURCE_CATALOG) {
      expect(chip(html, def.id), def.key).toContain(`aria-pressed="${def.id === 3}"`)
    }
  })

  it('shows each resource with its own colour', () => {
    const html = render(0)
    for (const def of RESOURCE_CATALOG) {
      const [r, g, b] = def.color
      expect(html, def.key).toContain(`background-color:rgb(${r}, ${g}, ${b})`)
    }
  })

  it('groups the resources by tier: basic, then industrial, then luxury', () => {
    const html = render(0)
    const at = (tier: string): number => html.indexOf(`data-tier="${tier}"`)
    expect(at('basic')).toBeGreaterThanOrEqual(0)
    expect(at('basic')).toBeLessThan(at('industrial'))
    expect(at('industrial')).toBeLessThan(at('luxury'))
    for (const def of RESOURCE_CATALOG) {
      const start = at(def.tier)
      const end = html.indexOf('</section>', start)
      expect(html.slice(start, end), def.key).toContain(`data-resource-id="${def.id}"`)
    }
  })
})
