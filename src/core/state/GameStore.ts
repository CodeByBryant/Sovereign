/**
 * @module GameStore
 * @description Global state store using zustand.
 *
 * Single source of truth for the entire application. The store is
 * the serialisation target for save/load.
 */
import { create } from 'zustand'
import { WorldMap } from '../world/WorldMap'
import type { StrategicPoint } from '../terrain/strategic'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type GamePhase = 'title' | 'generating' | 'playing'
export type ViewMode = 'elevation' | 'temperature' | 'humidity' | 'biome' | 'strategic' | 'resource'

export interface GameState {
  /** Current application phase — drives top-level routing. */
  phase: GamePhase
  /** Active map view layer. */
  view: ViewMode
  /** Whether the tile inspector tooltip is enabled. */
  inspectorEnabled: boolean
  /** The world seed for the current game. */
  seed: number | string | null
  /** Tile-data store — null until generation completes. */
  worldMap: WorldMap | null
  /** Strategic points from terrain generation. */
  strategicPoints: StrategicPoint[]
  /** FPS counter from the render loop. */
  fps: number

  // ---- Actions ----
  setPhase: (phase: GamePhase) => void
  setView: (view: ViewMode) => void
  toggleInspector: () => void
  setSeed: (seed: number | string) => void
  setWorldMap: (world: WorldMap) => void
  setStrategicPoints: (points: StrategicPoint[]) => void
  setFps: (fps: number) => void
  /** Reset to title screen state. */
  reset: () => void
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

export const useGameStore = create<GameState>((set) => ({
  phase: 'title',
  view: 'biome',
  inspectorEnabled: true,
  seed: null,
  worldMap: null,
  strategicPoints: [],
  fps: 0,

  setPhase: (phase) => set({ phase }),
  setView: (view) => set({ view }),
  toggleInspector: () => set((s) => ({ inspectorEnabled: !s.inspectorEnabled })),
  setSeed: (seed) => set({ seed }),
  setWorldMap: (world) => set({ worldMap: world }),
  setStrategicPoints: (points) => set({ strategicPoints: points }),
  setFps: (fps) => set({ fps }),
  reset: () =>
    set({
      phase: 'title',
      view: 'biome',
      seed: null,
      worldMap: null,
      strategicPoints: [],
      fps: 0
    })
}))
