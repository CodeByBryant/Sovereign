/**
 * @module App
 * @description Root component that switches between game phases.
 *
 * | Phase        | Component     |
 * |-------------|---------------|
 * | `title`     | TitleScreen   |
 * | `generating`| MapView       |
 * | `playing`   | MapView       |
 */
import React from 'react'
import { useGameStore } from '../core/state/GameStore'
import TitleScreen from './TitleScreen'
import MapView from './MapView'

const App = (): JSX.Element => {
  const phase = useGameStore((s) => s.phase)

  return (
    <div className="app">
      {phase === 'title' && <TitleScreen />}
      {(phase === 'generating' || phase === 'playing') && <MapView />}
    </div>
  )
}

export default App
