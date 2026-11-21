/**
 * @module NationPanel
 * @description Slide-out detail panel for a selected nation,
 * inspired by WorldBox's nation info screen.
 *
 * Shows name, government, colour swatch, stats (population, military,
 * economy, diplomacy), personality traits, and territory size.
 */
import React from 'react'
import type { NationSnapshot } from '@sovereign/contracts'

interface Props {
  nation: NationSnapshot
  onClose: () => void
}

const NationPanel: React.FC<Props> = ({ nation, onClose }) => {
  const [r, g, b] = nation.color

  return (
    <aside className="nation-panel">
      {/* Header */}
      <div className="nation-panel__header">
        <div className="nation-panel__swatch" style={{ background: `rgb(${r},${g},${b})` }} />
        <div className="nation-panel__header-text">
          <h2 className="nation-panel__name">{nation.name}</h2>
          <span className="nation-panel__gov">{nation.government}</span>
        </div>
        <button className="nation-panel__close" onClick={onClose} title="Close (Esc)">
          ✕
        </button>
      </div>

      {/* Stats */}
      <section className="nation-panel__section">
        <h4 className="nation-panel__heading">Statistics</h4>
        <div className="nation-panel__stats">
          <StatBar label="Population" value={nation.stats.population} max={300} icon="👥" />
          <StatBar label="Military" value={nation.stats.military} max={200} icon="⚔️" />
          <StatBar label="Economy" value={nation.stats.economy} max={200} icon="💰" />
          <StatBar label="Diplomacy" value={nation.stats.diplomacy} max={200} icon="🤝" />
        </div>
      </section>

      {/* Territory */}
      <section className="nation-panel__section">
        <h4 className="nation-panel__heading">Territory</h4>
        <div className="nation-panel__stats">
          <div className="nation-panel__stat-row">
            <span className="nation-panel__stat-icon">🗺️</span>
            <span className="nation-panel__stat-label">Provinces</span>
            <span className="nation-panel__stat-value">{nation.area} tiles</span>
          </div>
        </div>
      </section>

      {/* Land: the facts the statistics above follow from */}
      <section className="nation-panel__section">
        <h4 className="nation-panel__heading">Land</h4>
        <div className="nation-panel__facts">
          <Fact
            label="Food"
            value={(nation.profile.food / Math.max(1, nation.profile.area)).toFixed(2)}
            note="per tile"
          />
          <Fact label="Metals" value={amount(nation.profile.metals)} />
          <Fact label="Luxuries" value={amount(nation.profile.luxuries)} />
          <Fact label="Resources" value={`${nation.profile.diversity} kinds`} />
          <Fact
            label="Coast"
            value={nation.profile.coast === 0 ? 'none' : `${nation.profile.coast} tiles`}
          />
          <Fact label="Strongholds" value={amount(nation.profile.defence)} />
          <Fact
            label="Trade"
            value={`${Math.round(nation.profile.traffic * 100)}%`}
            note="of the busiest route"
          />
          <Fact
            label="Neighbours"
            value={
              nation.profile.contacts === 0
                ? 'none'
                : `${nation.profile.contacts} ${nation.profile.contacts === 1 ? 'neighbour' : 'neighbours'}`
            }
          />
        </div>
      </section>

      {/* Personality */}
      <section className="nation-panel__section">
        <h4 className="nation-panel__heading">Personality</h4>
        <div className="nation-panel__stats">
          <TraitBar label="Aggression" value={nation.personality.aggression} icon="🔥" />
          <TraitBar label="Expansion" value={nation.personality.expansionism} icon="📈" />
          <TraitBar label="Diplomacy" value={nation.personality.diplomacy} icon="🕊️" />
          <TraitBar label="Mercantile" value={nation.personality.mercantilism} icon="⚖️" />
          <TraitBar label="Militarism" value={nation.personality.militarism} icon="🛡️" />
        </div>
      </section>
    </aside>
  )
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

/** A quantity to one decimal, or "none" when the land has nothing of it. */
const amount = (v: number): string => (v <= 0 ? 'none' : v.toFixed(1))

const Fact: React.FC<{ label: string; value: string; note?: string }> = ({
  label,
  value,
  note
}) => (
  <div className="nation-panel__fact">
    <span className="nation-panel__fact-label">{label}</span>
    <span className="nation-panel__fact-value">
      {value}
      {note !== undefined && <span className="nation-panel__fact-note"> {note}</span>}
    </span>
  </div>
)

const StatBar: React.FC<{ label: string; value: number; max: number; icon: string }> = ({
  label,
  value,
  max,
  icon
}) => {
  const pct = Math.min(100, (value / max) * 100)
  return (
    <div className="nation-panel__stat-row">
      <span className="nation-panel__stat-icon">{icon}</span>
      <span className="nation-panel__stat-label">{label}</span>
      <div className="nation-panel__bar">
        <div className="nation-panel__bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="nation-panel__stat-value">{value}</span>
    </div>
  )
}

const TraitBar: React.FC<{ label: string; value: number; icon: string }> = ({
  label,
  value,
  icon
}) => {
  const pct = Math.round(value * 100)
  return (
    <div className="nation-panel__stat-row">
      <span className="nation-panel__stat-icon">{icon}</span>
      <span className="nation-panel__stat-label">{label}</span>
      <div className="nation-panel__bar">
        <div className="nation-panel__bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="nation-panel__stat-value">{pct}%</span>
    </div>
  )
}

export default NationPanel
