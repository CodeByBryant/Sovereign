/**
 * @module TitleScreen
 * @description Title / main-menu screen for Sovereign.
 *
 * Shown when `GamePhase === 'title'`. Lets the player start a new
 * world (with optional seed), or continue from a saved game.
 */
import React, { useState, useCallback } from 'react'
import { useGameStore } from '../core/state/GameStore'
import { defaultConfig } from '../config/Config'

const TitleScreen: React.FC = () => {
  const setSeed = useGameStore((s) => s.setSeed)
  const setPhase = useGameStore((s) => s.setPhase)

  const [seedInput, setSeedInput] = useState('')

  const handleNewWorld = useCallback(() => {
    const seed = seedInput.trim() || defaultConfig.terrain.seed
    setSeed(typeof seed === 'string' && /^\d+$/.test(seed) ? Number(seed) : seed)
    setPhase('generating')
  }, [seedInput, setSeed, setPhase])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleNewWorld()
    },
    [handleNewWorld]
  )

  return (
    <div className="title-screen">
      {/* Decorative background layer */}
      <div className="title-screen__backdrop" />

      <div className="title-screen__content">
        <h1 className="title-screen__logo">Sovereign</h1>
        <p className="title-screen__tagline">Shape empires. Forge history.</p>

        <div className="title-screen__card">
          <label className="title-screen__label" htmlFor="seed-input">
            World Seed
            <span className="title-screen__hint">(leave empty for random)</span>
          </label>
          <input
            id="seed-input"
            className="title-screen__input"
            type="text"
            placeholder={String(defaultConfig.terrain.seed)}
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
          />

          <button className="btn btn--gold title-screen__btn" onClick={handleNewWorld}>
            New World
          </button>
        </div>

        <p className="title-screen__version">v0.1.0 · Terrain & Resources</p>
      </div>
    </div>
  )
}

export default TitleScreen
