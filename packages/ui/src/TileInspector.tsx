/**
 * @module TileInspector
 * @description Right-side panel showing detailed info for the tile
 * under the cursor. Replaces the old cursor-following tooltip.
 */
import React from 'react'
import {
  getBiomeById,
  resourceDef,
  STRATEGIC_META,
  type NationSnapshot,
  type StrategicPoint,
  type TileInfo
} from '@sovereign/contracts'

export interface InspectorData {
  tile: TileInfo
  /** Nearby strategic point, if any. */
  strategic: StrategicPoint | null
  /** Owning nation, if any. */
  nation: NationSnapshot | null
}

interface Props {
  data: InspectorData | null
}

const TileInspector: React.FC<Props> = ({ data }) => {
  if (!data) {
    return (
      <aside className="inspector">
        <div className="inspector__empty">Tap or hover over a tile</div>
      </aside>
    )
  }

  const { tile, strategic, nation } = data
  const biome = getBiomeById(tile.biomeId)

  return (
    <aside className="inspector">
      <h3 className="inspector__title">{biome.name}</h3>

      <div className="inspector__grid">
        <Row label="Position" value={`${tile.x}, ${tile.y}`} />
        <Row label="Elevation" value={`${(tile.elevation * 100).toFixed(1)}%`} />
        <Row label="Temperature" value={`${(tile.temperature * 100).toFixed(1)}%`} />
        <Row label="Humidity" value={`${(tile.humidity * 100).toFixed(1)}%`} />

        {tile.isWater && <Row label="Terrain" value="Water" />}
        {tile.isRiver && <Row label="River" value="Yes" accent />}
        {tile.nearShore && !tile.isWater && <Row label="Coastal" value="Yes" />}
      </div>

      {tile.resources.map((resource) => {
        const left = Math.round((resource.stock / resource.richness) * 100)
        return (
          <div key={resource.layer} className="inspector__resource">
            <div className="inspector__resource-head">
              <span className="inspector__label">
                {resource.layer === 'surface' ? 'Surface' : 'Ground'}
              </span>
              <span className="inspector__value inspector__value--accent">{resource.label}</span>
            </div>
            <div className="inspector__bar">
              <div className="inspector__bar-fill" style={{ width: `${left}%` }} />
            </div>
            <div className="inspector__resource-foot">
              {left}% left · {resourceDef(resource.type)?.renewable ? 'renewable' : 'finite'}
            </div>
          </div>
        )
      })}

      <div className="inspector__grid">
        {strategic && (
          <Row
            label="Strategic"
            value={`${STRATEGIC_META[strategic.type].label} (${strategic.value}/10)`}
            accent
          />
        )}
      </div>

      {nation && (
        <div className="inspector__nation">
          <div
            className="inspector__nation-swatch"
            style={{
              background: `rgb(${nation.color[0]}, ${nation.color[1]}, ${nation.color[2]})`
            }}
          />
          <div className="inspector__nation-info">
            <span className="inspector__nation-name">{nation.name}</span>
            <span className="inspector__nation-gov">{nation.government}</span>
          </div>
        </div>
      )}
    </aside>
  )
}

/* ------------------------------------------------------------------ */
/*  Row helper                                                         */
/* ------------------------------------------------------------------ */

const Row: React.FC<{ label: string; value: string; accent?: boolean }> = ({
  label,
  value,
  accent
}) => (
  <>
    <span className="inspector__label">{label}</span>
    <span className={`inspector__value${accent ? ' inspector__value--accent' : ''}`}>{value}</span>
  </>
)

export default TileInspector
