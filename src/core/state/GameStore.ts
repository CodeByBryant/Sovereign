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
import type { Nation } from '../entities/Nation'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type GamePhase = 'title' | 'generating' | 'playing'
export type ViewMode =
  | 'elevation'
  | 'temperature'
  | 'humidity'
  | 'biome'
  | 'strategic'
  | 'resource'
  | 'political'

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
  /** Spawned nations — empty until nation spawning completes. */
  nations: Nation[]
  /** Index of nation currently selected in the detail panel, or -1. */
  selectedNation: number
  /** FPS counter from the render loop. */
  fps: number

  // ---- Actions ----
  setPhase: (phase: GamePhase) => void
  setView: (view: ViewMode) => void
  toggleInspector: () => void
  setSeed: (seed: number | string) => void
  setWorldMap: (world: WorldMap) => void
  setStrategicPoints: (points: StrategicPoint[]) => void
  setNations: (nations: Nation[]) => void
  selectNation: (index: number) => void
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
  nations: [],
  selectedNation: -1,
  fps: 0,

  setPhase: (phase) => set({ phase }),
  setView: (view) => set({ view }),
  toggleInspector: () => set((s) => ({ inspectorEnabled: !s.inspectorEnabled })),
  setSeed: (seed) => set({ seed }),
  setWorldMap: (world) => set({ worldMap: world }),
  setStrategicPoints: (points) => set({ strategicPoints: points }),
  setNations: (nations) => set({ nations }),
  selectNation: (index) => set({ selectedNation: index }),
  setFps: (fps) => set({ fps }),
  reset: () =>
    set({
      phase: 'title',
      view: 'biome',
      seed: null,
      worldMap: null,
      strategicPoints: [],
      nations: [],
      selectedNation: -1,
      fps: 0
    })
}))
