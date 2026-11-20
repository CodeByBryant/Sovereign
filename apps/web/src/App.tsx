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
import { TitleScreen } from '@sovereign/ui'
import { useGameStore } from './state/GameStore'
import { randomSeed } from './seed'
import MapView from './MapView'

const App = (): JSX.Element => {
  const phase = useGameStore((s) => s.phase)
  const setSeed = useGameStore((s) => s.setSeed)
  const setPhase = useGameStore((s) => s.setPhase)

  const handleNewWorld = (typed: string | null): void => {
    setSeed(typed === null ? randomSeed() : typed)
    setPhase('generating')
  }

  return (
    <div className="app">
      {phase === 'title' && <TitleScreen onNewWorld={handleNewWorld} />}
      {(phase === 'generating' || phase === 'playing') && <MapView />}
    </div>
  )
}

export default App
