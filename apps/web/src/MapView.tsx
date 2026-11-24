/**
 * @module MapView
 * @description Full-screen map canvas with camera, renderer, compact toolbar,
 * tile inspector panel and nation detail panel.
 *
 * Wired to zustand GameStore for view mode, FPS and world data.
 */
import React, { useEffect, useRef, useCallback } from 'react'
import type { NationSnapshot, ResourceSlots, StrategicPoint } from '@sovereign/contracts'
import { Camera, LAYER_NAMES, resourceRgba } from '@sovereign/renderer'
import { MapRenderer } from '@sovereign/renderer/pixi'
import { WorldMap } from '@sovereign/simulation'
import {
  TileInspector,
  NationPanel,
  ResourceLegend,
  TimeControls,
  type InspectorData
} from '@sovereign/ui'
import { FrameLoop } from './host/FrameLoop'
import { Pacer } from './host/Pacer'
import type { WorldTicked } from './host/protocol'
import { SimulationHost } from './host/SimulationHost'
import { GestureTracker, type GestureEvent } from './input/GestureTracker'
import { createWorldWorker } from './host/createWorldWorker'
import { randomSeed } from './seed'
import { useGameStore, type ViewMode } from './state/GameStore'
import { SPEEDS } from './state/time'
import { viewConfig } from './viewConfig'

const VIEWS: ViewMode[] = [
  'elevation',
  'temperature',
  'humidity',
  'biome',
  'strategic',
  'resource',
  'political'
]

/** Keyboard shortcut letter per view mode (shown in toolbar tooltip). */
const VIEW_KEYS: Record<ViewMode, string> = {
  elevation: 'E',
  temperature: 'T',
  humidity: 'H',
  biome: 'B',
  strategic: 'G',
  resource: 'R',
  political: 'P'
}

/** Where a pointer is, in client coordinates: a pointer event, a mouse event or a tap. */
interface ClientPoint {
  clientX: number
  clientY: number
}

/** The zoom factor of one tap on the on-screen + / - buttons. */
const ZOOM_BUTTON_STEP = 1.5

/** Whether the page can go fullscreen: not so on an iPhone, where the button would do nothing. */
const CAN_FULLSCREEN = typeof document !== 'undefined' && document.fullscreenEnabled === true

const MapView: React.FC = () => {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<MapRenderer | null>(null)
  const cameraRef = useRef<Camera | null>(null)
  const mapSizeRef = useRef({ width: 0, height: 0, tileSize: 1 })
  const biomeIdsRef = useRef<Uint8Array | null>(null)
  // what the resource overlay is drawn from, so a change of focus can redraw it
  const baseLayerRef = useRef<Uint8ClampedArray | null>(null)
  const resourcesRef = useRef<ResourceSlots | null>(null)
  const nationsRef = useRef<NationSnapshot[]>([])
  const strategicPointsRef = useRef<StrategicPoint[]>([])
  const strategicGridRef = useRef<Map<number, StrategicPoint>>(new Map())
  // the world worker once a world exists (the run loop and the flushes talk to it)
  const simulationRef = useRef<SimulationHost | null>(null)

  // --- Zustand selectors ---
  const seed = useGameStore((s) => s.seed)
  const view = useGameStore((s) => s.view)
  const fps = useGameStore((s) => s.fps)
  const inspectorEnabled = useGameStore((s) => s.inspectorEnabled)
  const selectedNation = useGameStore((s) => s.selectedNation)
  const setView = useGameStore((s) => s.setView)
  const resourceFocus = useGameStore((s) => s.resourceFocus)
  const setResourceFocus = useGameStore((s) => s.setResourceFocus)
  const setFps = useGameStore((s) => s.setFps)
  const phase = useGameStore((s) => s.phase)
  const paused = useGameStore((s) => s.paused)
  const setPhase = useGameStore((s) => s.setPhase)
  const setWorldMap = useGameStore((s) => s.setWorldMap)
  const setStrategicPoints = useGameStore((s) => s.setStrategicPoints)
  const setNations = useGameStore((s) => s.setNations)
  const selectNation = useGameStore((s) => s.selectNation)

  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const [showToolbar, setShowToolbar] = React.useState(true)
  const [inspectorData, setInspectorData] = React.useState<InspectorData | null>(null)

  /* ---------------------------------------------------------------- */
  /*  Tile lookup helpers                                              */
  /* ---------------------------------------------------------------- */
  const getTileAt = useCallback((screenX: number, screenY: number, renderer: MapRenderer) => {
    const tile = renderer.screenToTile(screenX, screenY)
    if (!tile) return null
    const worldMap = useGameStore.getState().worldMap
    return worldMap ? worldMap.at(tile.x, tile.y) : null
  }, [])

  const buildInspectorData = useCallback(
    (screenX: number, screenY: number, renderer: MapRenderer): InspectorData | null => {
      const tile = getTileAt(screenX, screenY, renderer)
      if (!tile) return null
      // Strategic point near tile
      const SCELL = 8
      const sgridW = Math.ceil(mapSizeRef.current.width / SCELL)
      const cellKey = Math.floor(tile.y / SCELL) * sgridW + Math.floor(tile.x / SCELL)
      let sp: StrategicPoint | null = null
      outer: for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const candidate = strategicGridRef.current.get(cellKey + dy * sgridW + dx)
          if (candidate && Math.abs(candidate.x - tile.x) + Math.abs(candidate.y - tile.y) <= 4) {
            sp = candidate
            break outer
          }
        }
      }
      // Nation ownership
      const nation =
        tile.ownerId >= 0 && tile.ownerId < nationsRef.current.length
          ? nationsRef.current[tile.ownerId]
          : null
      return { tile, strategic: sp, nation }
    },
    [getTileAt]
  )

  /* ---------------------------------------------------------------- */
  /*  Hover handler                                                    */
  /* ---------------------------------------------------------------- */
  const handleHover = useCallback(
    (e: ClientPoint, canvas: HTMLCanvasElement, renderer: MapRenderer) => {
      if (!inspectorEnabled) {
        setInspectorData(null)
        return
      }
      const rect = canvas.getBoundingClientRect()
      setInspectorData(buildInspectorData(e.clientX - rect.left, e.clientY - rect.top, renderer))
    },
    [inspectorEnabled, buildInspectorData]
  )

  /* ---------------------------------------------------------------- */
  /*  Click handler (nation selection)                                 */
  /* ---------------------------------------------------------------- */
  const handleClick = useCallback(
    (e: ClientPoint, canvas: HTMLCanvasElement, renderer: MapRenderer) => {
      const rect = canvas.getBoundingClientRect()
      const tile = getTileAt(e.clientX - rect.left, e.clientY - rect.top, renderer)
      if (tile && tile.ownerId >= 0 && tile.ownerId < nationsRef.current.length) {
        selectNation(tile.ownerId)
      } else {
        selectNation(-1)
      }
    },
    [getTileAt, selectNation]
  )

  /**
   * Publish where the camera is as `data-` attributes on the shell, so a test (or an accessibility
   * tool) can read the view without inspecting pixels. Cheap: three attribute writes per camera change.
   */
  const publishCamera = useCallback((camera: Camera) => {
    const shell = shellRef.current
    if (!shell) return
    shell.dataset.cameraZoom = camera.zoom.toFixed(4)
    shell.dataset.cameraX = camera.x.toFixed(1)
    shell.dataset.cameraY = camera.y.toFixed(1)
  }, [])

  /* ---------------------------------------------------------------- */
  /*  Canvas / Camera / Renderer bootstrap                             */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined

    const camera = new Camera({
      minZoom: viewConfig.camera.minZoom,
      maxZoom: viewConfig.camera.maxZoom
    })
    let disposed = false
    let stop: (() => void) | undefined

    // Pixi initialises asynchronously, and React may run this effect's cleanup before that finishes
    // (StrictMode does so in development), so everything that needs the renderer runs from here.
    const start = (renderer: MapRenderer): (() => void) => {
      const canvas = renderer.canvas
      rendererRef.current = renderer
      cameraRef.current = camera
      publishCamera(camera)
      const frameLoop = new FrameLoop(renderer, setFps)

      const resize = (): void => renderer.resize()
      const resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(canvas)
      window.addEventListener('resize', resize)

      /* ------------- Pointer / wheel events ------------- */
      // One tracker turns the pointer stream (a mouse, one finger, two fingers) into pan, pinch and
      // tap. A mouse selects with the browser's `click` and inspects on hover, as it always did; a
      // finger or pen has no hover, so a tap both selects a nation and fills the tile inspector.
      const tracker = new GestureTracker()
      let lastPointerType = 'mouse'
      const local = (x: number, y: number): { x: number; y: number } => {
        const rect = canvas.getBoundingClientRect()
        return { x: x - rect.left, y: y - rect.top }
      }

      const apply = (events: GestureEvent[]): void => {
        for (const event of events) {
          if (event.type === 'pan') {
            camera.pan(event.dx, event.dy)
            publishCamera(camera)
          } else if (event.type === 'pinch') {
            const { width, height } = renderer.getViewportSize()
            const anchor = local(event.anchor.x, event.anchor.y)
            camera.pan(event.dx, event.dy)
            camera.zoomAt(event.scale, anchor.x, anchor.y, width, height)
            publishCamera(camera)
          } else if (lastPointerType !== 'mouse') {
            handleClick({ clientX: event.at.x, clientY: event.at.y }, canvas, renderer)
            const at = local(event.at.x, event.at.y)
            setInspectorData(buildInspectorData(at.x, at.y, renderer))
          }
        }
      }

      const releaseCapture = (id: number): void => {
        if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id)
      }

      const onPointerDown = (e: PointerEvent): void => {
        lastPointerType = e.pointerType
        canvas.setPointerCapture(e.pointerId)
        tracker.down(e.pointerId, e.clientX, e.clientY, e.timeStamp)
      }

      const onPointerMove = (e: PointerEvent): void => {
        if (tracker.active === 0) {
          if (e.pointerType === 'mouse') handleHover(e, canvas, renderer)
          return
        }
        apply(tracker.move(e.pointerId, e.clientX, e.clientY))
      }

      const onPointerUp = (e: PointerEvent): void => {
        apply(tracker.up(e.pointerId, e.clientX, e.clientY, e.timeStamp))
        releaseCapture(e.pointerId)
      }

      const onPointerCancel = (e: PointerEvent): void => {
        tracker.cancel(e.pointerId)
        releaseCapture(e.pointerId)
      }

      const onWheel = (e: WheelEvent): void => {
        e.preventDefault()
        const { width, height } = renderer.getViewportSize()
        const rect = canvas.getBoundingClientRect()
        const anchorX = e.clientX - rect.left
        const anchorY = e.clientY - rect.top
        const scale = 1 + (e.deltaY > 0 ? -1 : 1) * viewConfig.camera.zoomStep
        camera.zoomAt(scale, anchorX, anchorY, width, height)
        publishCamera(camera)
      }

      const onClick = (e: MouseEvent): void => {
        // a touch or pen tap is handled by the tracker; the browser's synthesised click would repeat it
        if (lastPointerType === 'mouse') handleClick(e, canvas, renderer)
      }

      canvas.addEventListener('pointerdown', onPointerDown)
      canvas.addEventListener('pointermove', onPointerMove)
      canvas.addEventListener('pointerup', onPointerUp)
      canvas.addEventListener('pointercancel', onPointerCancel)
      canvas.addEventListener('pointerleave', onPointerCancel)
      canvas.addEventListener('wheel', onWheel, { passive: false })
      canvas.addEventListener('click', onClick)

      /* ------------- Generate the world in the worker ------------- */
      const { tileSize } = viewConfig.map
      const simulation = new SimulationHost(createWorldWorker)
      let cancelled = false

      simulation
        .create(seed ?? randomSeed())
        .then((ready) => {
          if (cancelled) return
          const { width, height, seaLevel } = ready.snapshot

          for (const name of LAYER_NAMES) renderer.setLayer(name, ready.layers[name], width, height)

          mapSizeRef.current = { width, height, tileSize }
          biomeIdsRef.current = ready.fields.biomeIds
          baseLayerRef.current = ready.layers.biome
          resourcesRef.current = ready.fields.resources
          strategicPointsRef.current = ready.strategicPoints
          nationsRef.current = ready.snapshot.nations

          // Build strategic spatial grid (cell size 8)
          const sGrid = new Map<number, StrategicPoint>()
          const SCELL = 8
          const sgridW = Math.ceil(width / SCELL)
          for (const sp of ready.strategicPoints) {
            const key = Math.floor(sp.y / SCELL) * sgridW + Math.floor(sp.x / SCELL)
            const existing = sGrid.get(key)
            if (!existing || sp.value > existing.value) sGrid.set(key, sp)
          }
          strategicGridRef.current = sGrid

          simulationRef.current = simulation
          useGameStore.getState().setPaused(true)
          useGameStore.getState().setClock({
            tick: ready.snapshot.tick,
            time: ready.snapshot.time,
            timestep: ready.snapshot.timestep,
            saturated: false
          })
          setWorldMap(new WorldMap({ width, height, seaLevel, ...ready.fields }))
          setStrategicPoints(ready.strategicPoints)
          setNations(ready.snapshot.nations)
          renderer.showLayer(useGameStore.getState().view)
          setPhase('playing')
          publishCamera(camera)
        })
        .catch((error: unknown) => {
          if (cancelled) return
          // Generation failed (the engine rejected the seed or config): go back rather than hang.
          console.error(error)
          setPhase('title')
        })

      frameLoop.start()

      return () => {
        cancelled = true
        simulationRef.current = null
        frameLoop.stop()
        simulation.dispose()
        resizeObserver.disconnect()
        window.removeEventListener('resize', resize)
        canvas.removeEventListener('pointerdown', onPointerDown)
        canvas.removeEventListener('pointermove', onPointerMove)
        canvas.removeEventListener('pointerup', onPointerUp)
        canvas.removeEventListener('pointercancel', onPointerCancel)
        canvas.removeEventListener('pointerleave', onPointerCancel)
        canvas.removeEventListener('wheel', onWheel)
        canvas.removeEventListener('click', onClick)
        rendererRef.current = null
        cameraRef.current = null
        biomeIdsRef.current = null
        renderer.destroy()
      }
    }

    void MapRenderer.create(host, camera, {
      className: 'canvas-shell__viewport',
      background: viewConfig.canvas.background,
      tileSize: viewConfig.map.tileSize
    }).then((renderer) => {
      if (disposed) {
        renderer.destroy()
        return
      }
      stop = start(renderer)
    })

    return () => {
      disposed = true
      stop?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------------------------------------------------------- */
  /*  Keyboard shortcuts                                               */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const key = e.key.toLowerCase()
      if (e.key === ' ') {
        // a focused button takes Space itself (it presses); anywhere else Space plays and pauses
        if (e.target instanceof HTMLButtonElement) return
        e.preventDefault()
        useGameStore.getState().togglePaused()
      } else if (key === '+' || key === '=') useGameStore.getState().faster()
      else if (key === '-' || key === '_') useGameStore.getState().slower()
      else if (key === 'e') setView('elevation')
      else if (key === 't') setView('temperature')
      else if (key === 'h') setView('humidity')
      else if (key === 'b') setView('biome')
      else if (key === 'g') setView('strategic')
      else if (key === 'r') setView('resource')
      else if (key === 'p') setView('political')
      else if (key === 's') setShowToolbar((prev) => !prev)
      else if (key === 'i') useGameStore.getState().toggleInspector()
      else if (key === 'escape') selectNation(-1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setView, selectNation])

  /* ---------------------------------------------------------------- */
  /*  View-mode switching                                              */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    rendererRef.current?.showLayer(view)
  }, [view])

  /* ---------------------------------------------------------------- */
  /*  Fullscreen                                                       */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const handler = (): void => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  /* ---------------------------------------------------------------- */
  /*  Time: the run loop                                               */
  /* ---------------------------------------------------------------- */

  /** Take what a run sent back: the clock, the nations, and (when provinces changed hands) the map. */
  const applyTicked = useCallback((ticked: WorldTicked): void => {
    const store = useGameStore.getState()
    store.setClock({
      tick: ticked.tick,
      time: ticked.time,
      timestep: store.timestep,
      saturated: ticked.saturated
    })
    if (ticked.claims > 0) {
      nationsRef.current = ticked.nations
      store.setNations(ticked.nations)
    }
    if (ticked.ownership !== undefined) store.worldMap?.ownership.set(ticked.ownership)
    if (ticked.political !== undefined) {
      const { width, height } = mapSizeRef.current
      rendererRef.current?.setLayer('political', ticked.political, width, height)
    }
  }, [])

  /** Ask for what the worker held back (the player paused, or switched to the political view). */
  const flush = useCallback(async (): Promise<void> => {
    const simulation = simulationRef.current
    if (simulation === null) return
    while (simulation.busy) await new Promise((resolve) => setTimeout(resolve, 16))
    if (simulationRef.current !== simulation) return // a new world, or the page went away
    const ticked = await simulation.run(0, {
      flush: true,
      political: useGameStore.getState().view === 'political'
    })
    applyTicked(ticked)
  }, [applyTicked])

  // While time runs, each frame asks the worker for the ticks that much real time is worth. One request
  // is in flight at a time: a frame that finds the worker busy waits, and its time is kept for the next.
  useEffect(() => {
    const simulation = simulationRef.current
    if (phase !== 'playing' || paused || simulation === null) return undefined
    const pacer = new Pacer()
    let last = performance.now()
    let frame = 0
    let stopped = false
    const loop = (now: number): void => {
      if (stopped) return
      frame = requestAnimationFrame(loop)
      if (simulation.busy) return
      const { speed, timestep, view: shown } = useGameStore.getState()
      const ticks = pacer.advance(now - last, speed, timestep)
      last = now
      if (ticks === 0) return
      simulation
        .run(ticks, { political: shown === 'political' })
        .then((ticked) => {
          if (!stopped) applyTicked(ticked)
        })
        .catch((error: unknown) => console.error(error))
    }
    frame = requestAnimationFrame(loop)
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
    }
  }, [phase, paused, applyTicked])

  // Pausing, or showing the political view, brings up to date whatever the throttle held back.
  useEffect(() => {
    if (phase !== 'playing') return
    if (paused || view === 'political') void flush().catch((error: unknown) => console.error(error))
  }, [phase, paused, view, flush])

  // A change of focus redraws the resource overlay: one resource as a heat map, or all of them.
  useEffect(() => {
    const renderer = rendererRef.current
    const base = baseLayerRef.current
    const resources = resourcesRef.current
    if (!renderer || !base || !resources) return
    const { width, height } = mapSizeRef.current
    renderer.setLayer('resource', resourceRgba(base, resources, resourceFocus), width, height)
  }, [resourceFocus])

  /** Zoom about the middle of the screen: the toolbar's + / - buttons, for devices with no wheel. */
  const zoomBy = useCallback(
    (factor: number) => {
      const camera = cameraRef.current
      const renderer = rendererRef.current
      if (!camera || !renderer) return
      const { width, height } = renderer.getViewportSize()
      camera.zoomAt(factor, width / 2, height / 2, width, height)
      publishCamera(camera)
    },
    [publishCamera]
  )

  const toggleFullscreen = useCallback(() => {
    if (!shellRef.current) return
    if (!document.fullscreenElement) void shellRef.current.requestFullscreen()
    else void document.exitFullscreen()
  }, [])

  /* ---------------------------------------------------------------- */
  /*  Active nation for panel                                          */
  /* ---------------------------------------------------------------- */
  const nations = useGameStore((s) => s.nations)
  const activeNation =
    selectedNation >= 0 && selectedNation < nations.length ? nations[selectedNation] : null

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <section
      className="canvas-shell"
      ref={shellRef}
      data-view={view}
      data-resource-focus={resourceFocus}
    >
      <div ref={hostRef} className="canvas-shell__host" />

      <div className="canvas-shell__topbar">
        <div className="canvas-shell__hud">
          FPS: {fps} · {view}
          {phase === 'generating' ? ' · generating…' : ''}
        </div>
        {phase === 'playing' && <ClockBar />}
      </div>

      <button
        className="canvas-shell__toggle btn btn--secondary"
        onClick={() => setShowToolbar((prev) => !prev)}
        title="Toggle toolbar (S)"
      >
        {showToolbar ? '▾' : '▴'}
      </button>

      {showToolbar && (
        <div className="canvas-shell__toolbar">
          {VIEWS.map((v) => (
            <button
              key={v}
              className={`toolbar-btn toolbar-btn--compact${view === v ? ' toolbar-btn--active' : ''}`}
              onClick={() => setView(v)}
              title={`${v.charAt(0).toUpperCase() + v.slice(1)} (${VIEW_KEYS[v]})`}
            >
              <ToolbarIcon mode={v} />
            </button>
          ))}

          <div className="toolbar-divider" />

          <button
            className="toolbar-btn toolbar-btn--compact"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => zoomBy(1 / ZOOM_BUTTON_STEP)}
          >
            <svg viewBox="0 0 16 16">
              <path d="M3 8h10" stroke="currentColor" strokeWidth="1.8" fill="none" />
            </svg>
          </button>

          <button
            className="toolbar-btn toolbar-btn--compact"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => zoomBy(ZOOM_BUTTON_STEP)}
          >
            <svg viewBox="0 0 16 16">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" fill="none" />
            </svg>
          </button>

          <button
            className={`toolbar-btn toolbar-btn--compact${inspectorEnabled ? ' toolbar-btn--active' : ''}`}
            onClick={() => useGameStore.getState().toggleInspector()}
            title="Inspector (I)"
          >
            <svg viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 5v2M8 9v4" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>

          {CAN_FULLSCREEN && (
            <button
              className="toolbar-btn toolbar-btn--compact"
              onClick={toggleFullscreen}
              title="Fullscreen"
            >
              <svg viewBox="0 0 16 16">
                {isFullscreen ? (
                  <path d="M5 1v4H1v2h6V1zm6 0v6h6V5h-4V1zM1 11h4v4H3v-2H1zm10 0h2v2h2v2h-4z" />
                ) : (
                  <path d="M1 1h5v2H3v3H1zm9 0h5v5h-2V3h-3zM1 10h2v3h3v2H1zm12 3h-3v2h5v-5h-2z" />
                )}
              </svg>
            </button>
          )}
        </div>
      )}

      {view === 'resource' && <ResourceLegend focus={resourceFocus} onFocus={setResourceFocus} />}

      {inspectorEnabled && <TileInspector data={inspectorData} />}

      {activeNation && <NationPanel nation={activeNation} onClose={() => selectNation(-1)} />}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Time controls (their own subscriptions: a tick does not redraw the map view) */
/* ------------------------------------------------------------------ */
const ClockBar: React.FC = () => {
  const time = useGameStore((s) => s.time)
  const paused = useGameStore((s) => s.paused)
  const speed = useGameStore((s) => s.speed)
  const saturated = useGameStore((s) => s.saturated)
  const togglePaused = useGameStore((s) => s.togglePaused)
  const setSpeed = useGameStore((s) => s.setSpeed)
  return (
    <TimeControls
      time={time}
      paused={paused}
      speed={speed}
      speeds={SPEEDS}
      saturated={saturated}
      onTogglePause={togglePaused}
      onSpeed={setSpeed}
    />
  )
}

/* ------------------------------------------------------------------ */
/*  Toolbar icon SVGs                                                  */
/* ------------------------------------------------------------------ */
const ToolbarIcon: React.FC<{ mode: ViewMode }> = ({ mode }) => {
  switch (mode) {
    case 'elevation':
      return (
        <svg viewBox="0 0 16 16">
          <path d="M2 14l5-10 3 5 2-3 2 8z" />
        </svg>
      )
    case 'temperature':
      return (
        <svg viewBox="0 0 16 16">
          <path d="M7 1h2v8.5a3 3 0 11-2 0zM8 14a2 2 0 100-4 2 2 0 000 4z" />
        </svg>
      )
    case 'humidity':
      return (
        <svg viewBox="0 0 16 16">
          <path d="M8 1C6 4 3 7.5 3 10a5 5 0 0010 0c0-2.5-3-6-5-9z" />
        </svg>
      )
    case 'biome':
      return (
        <svg viewBox="0 0 16 16">
          <path d="M8 1l3 4h-2v3h3l-4 4-4-4h3V5H5z" />
          <rect x="2" y="13" width="12" height="2" rx="1" />
        </svg>
      )
    case 'strategic':
      return (
        <svg viewBox="0 0 16 16">
          <path d="M8 1l2 5h5l-4 3 1.5 5L8 11l-4.5 3L5 9 1 6h5z" />
        </svg>
      )
    case 'resource':
      return (
        <svg viewBox="0 0 16 16">
          <path d="M4 2l4 2 4-2v9l-4 3-4-3z" />
          <path d="M8 4v10M4 2l4 2M12 2l-4 2" fill="none" stroke="currentColor" strokeWidth="0.5" />
        </svg>
      )
    case 'political':
      return (
        <svg viewBox="0 0 16 16">
          <path d="M3 2h4v5H3zM9 2h4v5H9zM3 9h4v5H3zM9 9h4v5H9z" />
        </svg>
      )
    default:
      return null
  }
}

export default MapView
