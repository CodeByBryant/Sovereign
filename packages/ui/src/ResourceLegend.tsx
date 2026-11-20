/**
 * @module ResourceLegend
 * @description The key to the resource overlay, and its focus selector: every resource with its
 * colour, grouped by tier (basic, industrial, luxury). Choosing one focuses the map on it (a heat
 * map of that resource); "All resources" goes back to each tile's dominant one.
 */
import React from 'react'
import { RESOURCE_CATALOG, type ResourceTier } from '@sovereign/contracts'

interface Props {
  /** The focused resource id, or 0 for all of them. */
  focus: number
  onFocus: (id: number) => void
}

const TIERS: ReadonlyArray<{ tier: ResourceTier; title: string }> = [
  { tier: 'basic', title: 'Basic' },
  { tier: 'industrial', title: 'Industrial' },
  { tier: 'luxury', title: 'Luxury' }
]

const ResourceLegend: React.FC<Props> = ({ focus, onFocus }) => (
  <aside className="resource-legend" aria-label="Resources">
    <button
      type="button"
      className="resource-legend__all"
      data-resource-id="all"
      aria-pressed={focus === 0}
      onClick={() => onFocus(0)}
    >
      All resources
    </button>

    {TIERS.map(({ tier, title }) => (
      <section key={tier} className="resource-legend__tier" data-tier={tier}>
        <h4 className="resource-legend__title">{title}</h4>
        <div className="resource-legend__chips">
          {RESOURCE_CATALOG.filter((def) => def.tier === tier).map((def) => (
            <button
              key={def.id}
              type="button"
              className="resource-legend__chip"
              data-resource-id={def.id}
              aria-pressed={focus === def.id}
              onClick={() => onFocus(def.id)}
              title={`${def.label}: ${def.renewable ? 'renewable' : 'finite'}, per ${def.unit}`}
            >
              <span
                className="resource-legend__swatch"
                style={{
                  backgroundColor: `rgb(${def.color[0]}, ${def.color[1]}, ${def.color[2]})`
                }}
              />
              {def.label}
            </button>
          ))}
        </div>
      </section>
    ))}
  </aside>
)

export default ResourceLegend
