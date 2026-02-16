/**
 * @module NationPanel
 * @description Slide-out detail panel for a selected nation,
 * inspired by WorldBox's nation info screen.
 *
 * Shows name, government, colour swatch, stats (population, military,
 * economy, diplomacy), personality traits, and territory size.
 */
import React from 'react'
import type { Nation } from '../core/entities/Nation'

interface Props {
  nation: Nation
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
            <span className="nation-panel__stat-value">{nation.totalArea} tiles</span>
          </div>
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
