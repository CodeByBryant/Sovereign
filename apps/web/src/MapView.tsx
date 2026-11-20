/**
 * @module MapView
 * @description Full-screen map canvas with camera, renderer, compact toolbar,
 * tile inspector panel and nation detail panel.
 *
 * Wired to zustand GameStore for view mode, FPS and world data.
 */
import React, { useEffect, useRef, useCallback } from 'react'
import { defaultWorldConfig as world, type TerrainConfig } from '@sovereign/config'
import type { StrategicPoint } from '@sovereign/contracts'
import { Camera, politicalRgba } from '@sovereign/renderer'
import { MapRenderer } from '@sovereign/renderer/pixi'
import { WorldMap, spawnNations, type Nation } from '@sovereign/simulation'
import type { TerrainWorkerRequest, TerrainWorkerResponse } from './host/terrain.worker'
import TerrainWorker from './host/terrain.worker?worker'
import { TileInspector, NationPanel, type InspectorData } from '@sovereign/ui'
import { FrameLoop } from './host/FrameLoop'
import { randomSeed } from './seed'
import { useGameStore, type ViewMode } from './state/GameStore'
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

const MapView: React.FC = () => {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<MapRenderer | null>(null)
  const cameraRef = useRef<Camera | null>(null)
  const mapSizeRef = useRef({ width: 0, height: 0, tileSize: 1 })
  const biomeIdsRef = useRef<Uint8Array | null>(null)
  const nationsRef = useRef<Nation[]>([])
  const strategicPointsRef = useRef<StrategicPoint[]>([])
  const strategicGridRef = useRef<Map<number, StrategicPoint>>(new Map())

  // --- Zustand selectors ---
  const seed = useGameStore((s) => s.seed)
  const view = useGameStore((s) => s.view)
  const fps = useGameStore((s) => s.fps)
  const inspectorEnabled = useGameStore((s) => s.inspectorEnabled)
  const selectedNation = useGameStore((s) => s.selectedNation)
  const setView = useGameStore((s) => s.setView)
  const setFps = useGameStore((s) => s.setFps)
  const setPhase = useGameStore((s) => s.setPhase)
  const setWorldMap = useGameStore((s) => s.setWorldMap)
  const setStrategicPoints = useGameStore((s) => s.setStrategicPoints)
  const setNations = useGameStore((s) => s.setNations)
  const selectNation = useGameStore((s) => s.selectNation)

  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const [showToolbar, setShowToolbar] = React.useState(true)
  const [inspectorData, setInspectorData] = React.useState<InspectorData | null>(null)

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
      const frameLoop = new FrameLoop(renderer, setFps)

      const resize = (): void => renderer.resize()
      const resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(canvas)
      window.addEventListener('resize', resize)

      /* ------------- Pointer / wheel events ------------- */
      let isDragging = false
      let lastX = 0
      let lastY = 0

      const onPointerDown = (e: PointerEvent): void => {
        isDragging = true
        lastX = e.clientX
        lastY = e.clientY
        canvas.setPointerCapture(e.pointerId)
      }

      const onPointerMove = (e: PointerEvent): void => {
        if (!isDragging) {
          handleHover(e, canvas, renderer)
          return
        }
        camera.pan(e.clientX - lastX, e.clientY - lastY)
        lastX = e.clientX
        lastY = e.clientY
      }

      const onPointerUp = (e: PointerEvent): void => {
        isDragging = false
        canvas.releasePointerCapture(e.pointerId)
      }

      const onWheel = (e: WheelEvent): void => {
        e.preventDefault()
        const { width, height } = renderer.getViewportSize()
        const rect = canvas.getBoundingClientRect()
        const anchorX = e.clientX - rect.left
        const anchorY = e.clientY - rect.top
        const scale = 1 + (e.deltaY > 0 ? -1 : 1) * viewConfig.camera.zoomStep
        camera.zoomAt(scale, anchorX, anchorY, width, height)
      }

      const onClick = (e: MouseEvent): void => {
        handleClick(e, canvas, renderer)
      }

      canvas.addEventListener('pointerdown', onPointerDown)
      canvas.addEventListener('pointermove', onPointerMove)
      canvas.addEventListener('pointerup', onPointerUp)
      canvas.addEventListener('pointerleave', onPointerUp)
      canvas.addEventListener('wheel', onWheel, { passive: false })
      canvas.addEventListener('click', onClick)

      /* ------------- Spawn terrain worker ------------- */
      const { tileSize } = viewConfig.map
      const terrainConfig: TerrainConfig = { ...world.map, ...world.elevation }

      const worker = new TerrainWorker()

      const useSeed = seed ?? randomSeed()

      const request: TerrainWorkerRequest = {
        type: 'generate',
        seed: useSeed,
        terrain: terrainConfig,
        temperature: world.temperature,
        humidity: world.humidity,
        biomeNoise: world.biomeNoise,
        rivers: world.rivers,
        biomes: world.biomes,
        strategic: world.strategic,
        resources: world.resources,
        minLandRatio: world.map.minLandRatio
      }

      worker.postMessage(request)

      worker.onmessage = async (event: MessageEvent<TerrainWorkerResponse>): Promise<void> => {
        const data = event.data
        if (data.type !== 'done') return

        const { width, height } = data

        // The pixel buffers were transferred from the worker, so wrapping them copies nothing.
        const pixels = (buf: ArrayBuffer): Uint8ClampedArray => new Uint8ClampedArray(buf)
        const biomePixels = pixels(data.biomePixels)

        renderer.setLayer('elevation', pixels(data.elevationPixels), width, height)
        renderer.setLayer('temperature', pixels(data.temperaturePixels), width, height)
        renderer.setLayer('humidity', pixels(data.humidityPixels), width, height)
        renderer.setLayer('biome', biomePixels, width, height)
        renderer.setLayer('strategic', pixels(data.strategicPixels), width, height)
        renderer.setLayer('resource', pixels(data.resourcePixels), width, height)

        mapSizeRef.current = { width, height, tileSize }
        biomeIdsRef.current = new Uint8Array(data.biomeIds)
        strategicPointsRef.current = data.strategicPoints

        // Build strategic spatial grid (cell size 8)
        const sGrid = new Map<number, StrategicPoint>()
        const SCELL = 8
        const sgridW = Math.ceil(width / SCELL)
        for (const sp of data.strategicPoints) {
          const key = Math.floor(sp.y / SCELL) * sgridW + Math.floor(sp.x / SCELL)
          const existing = sGrid.get(key)
          if (!existing || sp.value > existing.value) sGrid.set(key, sp)
        }
        strategicGridRef.current = sGrid

        // Build WorldMap from raw fields
        const ownershipArr = new Uint8Array(width * height).fill(255)
        const worldMap = new WorldMap({
          width,
          height,
          seaLevel: data.seaLevel,
          elevation: new Float32Array(data.elevationField),
          temperature: new Float32Array(data.temperatureField),
          humidity: new Float32Array(data.humidityField),
          biomeIds: new Uint8Array(data.biomeIds),
          riverMask: new Uint8Array(data.riverMask),
          resourceType: new Uint8Array(data.resourceType),
          resourceDensity: new Uint8Array(data.resourceDensity),
          ownership: ownershipArr
        })

        // --- Nation spawning ---
        const nationsConfig = world.nations
        const terrainForSpawn: TerrainConfig = {
          width,
          height,
          seaLevel: data.seaLevel,
          islandMode: world.map.islandMode,
          ...world.elevation
        }
        const { nations, ownerMap } = spawnNations(
          worldMap.elevation,
          worldMap.biomeIds,
          worldMap.riverMask,
          terrainForSpawn,
          nationsConfig.count,
          useSeed,
          nationsConfig.minSpacing
        )

        // Write string-based ownerMap into Uint8Array ownership layer
        // Nation index (0–254) maps to nation array index; '' → 255 (unclaimed)
        const nationIdToIndex = new Map<string, number>()
        for (let ni = 0; ni < nations.length; ni += 1) {
          nationIdToIndex.set(nations[ni].id, ni)
        }
        for (let i = 0; i < ownerMap.length; i += 1) {
          if (ownerMap[i] !== '') {
            const nIdx = nationIdToIndex.get(ownerMap[i])
            if (nIdx !== undefined) ownershipArr[i] = nIdx
          }
        }
        nationsRef.current = nations

        setWorldMap(worldMap)
        setStrategicPoints(data.strategicPoints)
        setNations(nations)

        // --- Political overlay ---
        renderer.setLayer(
          'political',
          politicalRgba(
            biomePixels,
            ownershipArr,
            nations.map((n) => n.color),
            width,
            height,
            viewConfig.political
          ),
          width,
          height
        )
        renderer.showLayer(useGameStore.getState().view)

        setPhase('playing')
        worker.terminate()
      }

      frameLoop.start()

      return () => {
        frameLoop.stop()
        worker.terminate()
        resizeObserver.disconnect()
        window.removeEventListener('resize', resize)
        canvas.removeEventListener('pointerdown', onPointerDown)
        canvas.removeEventListener('pointermove', onPointerMove)
        canvas.removeEventListener('pointerup', onPointerUp)
        canvas.removeEventListener('pointerleave', onPointerUp)
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
    (e: PointerEvent, canvas: HTMLCanvasElement, renderer: MapRenderer) => {
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
    (e: MouseEvent, canvas: HTMLCanvasElement, renderer: MapRenderer) => {
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

  /* ---------------------------------------------------------------- */
  /*  Keyboard shortcuts                                               */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const key = e.key.toLowerCase()
      if (key === 'e') setView('elevation')
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
  }, [setView])

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

  const toggleFullscreen = useCallback(() => {
    if (!shellRef.current) return
    if (!document.fullscreenElement) void shellRef.current.requestFullscreen()
    else void document.exitFullscreen()
  }, [])

  /* ---------------------------------------------------------------- */
  /*  Active nation for panel                                          */
  /* ---------------------------------------------------------------- */
  const activeNation =
    selectedNation >= 0 && selectedNation < nationsRef.current.length
      ? nationsRef.current[selectedNation]
      : null

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <section className="canvas-shell" ref={shellRef}>
      <div ref={hostRef} className="canvas-shell__host" />

      <div className="canvas-shell__hud">
        FPS: {fps} · {view}
        {useGameStore((s) => s.phase) === 'generating' ? ' · generating…' : ''}
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
            className={`toolbar-btn toolbar-btn--compact${inspectorEnabled ? ' toolbar-btn--active' : ''}`}
            onClick={() => useGameStore.getState().toggleInspector()}
            title="Inspector (I)"
          >
            <svg viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 5v2M8 9v4" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>

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
        </div>
      )}

      {inspectorEnabled && <TileInspector data={inspectorData} />}

      {activeNation && <NationPanel nation={activeNation} onClose={() => selectNation(-1)} />}
    </section>
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
