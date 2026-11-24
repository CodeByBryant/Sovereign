/**
 * @module GameStore
 * @description Global state store using zustand.
 *
 * Single source of truth for the entire application. The store is
 * the serialisation target for save/load.
 */
import { create } from 'zustand'
import type { NationSnapshot, StrategicPoint } from '@sovereign/contracts'
import type { WorldMap } from '@sovereign/simulation'
import { DEFAULT_SPEED, fasterThan, isSpeed, slowerThan, type Speed } from './time'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type GamePhase = 'title' | 'generating' | 'playing'
export type ViewMode =
  'elevation' | 'temperature' | 'humidity' | 'biome' | 'strategic' | 'resource' | 'political'

export interface GameState {
  /** Current application phase — drives top-level routing. */
  phase: GamePhase
  /** Active map view layer. */
  view: ViewMode
  /** The resource the resource overlay is focused on (a catalogue id), or 0 for all of them. */
  resourceFocus: number
  /** Whether the tile inspector tooltip is enabled. */
  inspectorEnabled: boolean
  /** The world seed for the current game. */
  seed: number | string | null
  /** Tile-data store — null until generation completes. */
  worldMap: WorldMap | null
  /** Strategic points from terrain generation. */
  strategicPoints: StrategicPoint[]
  /** Spawned nations — empty until nation spawning completes. */
  nations: NationSnapshot[]
  /** Index of nation currently selected in the detail panel, or -1. */
  selectedNation: number
  /** FPS counter from the render loop. */
  fps: number
  /** Whether time is stopped. A new world starts paused. */
  paused: boolean
  /** How fast time runs: in-game days per real second (one of `SPEEDS`). */
  speed: Speed
  /** Simulation ticks run so far. */
  tick: number
  /** In-game days so far (`tick * timestep`). */
  time: number
  /** In-game days per tick. */
  timestep: number
  /** True when no nation can claim anything more: the borders have settled. */
  saturated: boolean

  // ---- Actions ----
  setPhase: (phase: GamePhase) => void
  setView: (view: ViewMode) => void
  setResourceFocus: (id: number) => void
  toggleInspector: () => void
  setSeed: (seed: number | string) => void
  setWorldMap: (world: WorldMap) => void
  setStrategicPoints: (points: StrategicPoint[]) => void
  setNations: (nations: NationSnapshot[]) => void
  selectNation: (index: number) => void
  setFps: (fps: number) => void
  setPaused: (paused: boolean) => void
  togglePaused: () => void
  /** Set the speed; anything that is not one of `SPEEDS` is ignored. */
  setSpeed: (speed: number) => void
  faster: () => void
  slower: () => void
  /** Record where the simulation's clock is. */
  setClock: (clock: { tick: number; time: number; timestep: number; saturated: boolean }) => void
  /** Reset to title screen state. */
  reset: () => void
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

export const useGameStore = create<GameState>((set) => ({
  phase: 'title',
  view: 'biome',
  resourceFocus: 0,
  inspectorEnabled: true,
  seed: null,
  worldMap: null,
  strategicPoints: [],
  nations: [],
  selectedNation: -1,
  fps: 0,
  paused: true,
  speed: DEFAULT_SPEED,
  tick: 0,
  time: 0,
  timestep: 1,
  saturated: false,

  setPhase: (phase) => set({ phase }),
  setView: (view) => set({ view }),
  setResourceFocus: (id) => set({ resourceFocus: id }),
  toggleInspector: () => set((s) => ({ inspectorEnabled: !s.inspectorEnabled })),
  setSeed: (seed) => set({ seed }),
  setWorldMap: (world) => set({ worldMap: world }),
  setStrategicPoints: (points) => set({ strategicPoints: points }),
  setNations: (nations) => set({ nations }),
  selectNation: (index) => set({ selectedNation: index }),
  setFps: (fps) => set({ fps }),
  setPaused: (paused) => set({ paused }),
  togglePaused: () => set((s) => ({ paused: !s.paused })),
  setSpeed: (speed) => set((s) => (isSpeed(speed) ? { speed } : s)),
  faster: () => set((s) => ({ speed: fasterThan(s.speed) })),
  slower: () => set((s) => ({ speed: slowerThan(s.speed) })),
  setClock: ({ tick, time, timestep, saturated }) => set({ tick, time, timestep, saturated }),
  reset: () =>
    set({
      phase: 'title',
      view: 'biome',
      resourceFocus: 0,
      seed: null,
      worldMap: null,
      strategicPoints: [],
      nations: [],
      selectedNation: -1,
      fps: 0,
      paused: true,
      speed: DEFAULT_SPEED,
      tick: 0,
      time: 0,
      timestep: 1,
      saturated: false
    })
}))
