/**
 * @module MapView
 * @description Full-screen map canvas with camera, renderer, toolbar
 * and tooltip inspector. Extracted from the original App component.
 *
 * Wired to zustand GameStore for view mode, FPS and world data.
 */
import React, { useEffect, useRef, useCallback } from 'react'
import { Camera } from '../core/camera/Camera'
import { Renderer } from '../core/rendering/Renderer'
import { Simulation } from '../core/simulation/Simulation'
import { defaultConfig } from '../config/Config'
import type { TerrainConfig } from '../core/terrain/TerrainGenerator'
import { getBiomeById } from '../core/terrain/biomes'
import { STRATEGIC_META, type StrategicPoint } from '../core/terrain/strategic'
import { WorldMap } from '../core/world/WorldMap'
import type { TerrainWorkerRequest, TerrainWorkerResponse } from '../core/terrain/terrain.worker'
import { useGameStore, type ViewMode } from '../core/state/GameStore'

const VIEWS: ViewMode[] = ['elevation', 'temperature', 'humidity', 'biome', 'strategic', 'resource']

const MapView: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const mapsRef = useRef<Partial<Record<ViewMode, ImageBitmap[]>>>({})
  const mapSizeRef = useRef({ width: 0, height: 0, tileSize: 1 })
  const biomeIdsRef = useRef<Uint8Array | null>(null)
  const strategicPointsRef = useRef<StrategicPoint[]>([])
  const strategicGridRef = useRef<Map<number, StrategicPoint>>(new Map())
  const chunkLayoutRef = useRef<Array<{ x: number; y: number; width: number; height: number }>>([])

  // --- Zustand selectors ---
  const seed = useGameStore((s) => s.seed)
  const view = useGameStore((s) => s.view)
  const fps = useGameStore((s) => s.fps)
  const inspectorEnabled = useGameStore((s) => s.inspectorEnabled)
  const setView = useGameStore((s) => s.setView)
  const setFps = useGameStore((s) => s.setFps)
  const setPhase = useGameStore((s) => s.setPhase)
  const setWorldMap = useGameStore((s) => s.setWorldMap)
  const setStrategicPoints = useGameStore((s) => s.setStrategicPoints)

  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const [showToolbar, setShowToolbar] = React.useState(true)
  const [tooltip, setTooltip] = React.useState<{ x: number; y: number; text: string } | null>(null)

  /* ---------------------------------------------------------------- */
  /*  Canvas / Camera / Renderer bootstrap                             */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    const camera = new Camera({
      minZoom: defaultConfig.camera.minZoom,
      maxZoom: defaultConfig.camera.maxZoom
    })
    const renderer = new Renderer(canvas, camera)
    rendererRef.current = renderer
    const simulation = new Simulation(renderer, setFps)

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
        handleTooltip(e, canvas, camera, renderer)
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
      const scale = 1 + (e.deltaY > 0 ? -1 : 1) * defaultConfig.camera.zoomStep
      camera.zoomAt(scale, anchorX, anchorY, width, height)
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointerleave', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    /* ------------- Spawn terrain worker ------------- */
    const { tileSize, chunkSize, ...mapConfig } = defaultConfig.terrain.map
    const terrainConfig: TerrainConfig = { ...mapConfig, ...defaultConfig.terrain.elevation }

    const worker = new Worker(new URL('../core/terrain/terrain.worker.ts', import.meta.url), {
      type: 'module'
    })

    const useSeed = seed ?? defaultConfig.terrain.seed

    const request: TerrainWorkerRequest = {
      type: 'generate',
      seed: useSeed,
      terrain: terrainConfig,
      temperature: defaultConfig.terrain.temperature,
      humidity: defaultConfig.terrain.humidity,
      biomeNoise: defaultConfig.terrain.biomeNoise,
      rivers: defaultConfig.terrain.rivers,
      biomes: defaultConfig.terrain.biomes,
      strategic: defaultConfig.terrain.strategic,
      resources: defaultConfig.terrain.resources
    }

    worker.postMessage(request)

    worker.onmessage = async (event: MessageEvent<TerrainWorkerResponse>): Promise<void> => {
      const data = event.data
      if (data.type !== 'done') return

      const { width, height } = data

      const imageDataFromBuffer = (buf: ArrayBuffer, w: number, h: number): ImageData =>
        new ImageData(new Uint8ClampedArray(buf), w, h)

      const buildChunks = async (imgData: ImageData, cs: number): Promise<ImageBitmap[]> => {
        const chunks: ImageBitmap[] = []
        for (let y = 0; y < imgData.height; y += cs) {
          for (let x = 0; x < imgData.width; x += cs) {
            const cw = Math.min(cs, imgData.width - x)
            const ch = Math.min(cs, imgData.height - y)
            const bitmap = await createImageBitmap(imgData, x, y, cw, ch)
            chunks.push(bitmap)
          }
        }
        return chunks
      }

      // Reconstruct ImageData from transferred buffers
      const elevationMap = imageDataFromBuffer(data.elevationPixels, width, height)
      const temperatureMap = imageDataFromBuffer(data.temperaturePixels, width, height)
      const humidityMap = imageDataFromBuffer(data.humidityPixels, width, height)
      const biomeMap = imageDataFromBuffer(data.biomePixels, width, height)
      const strategicMap = imageDataFromBuffer(data.strategicPixels, width, height)
      const resourceMap = imageDataFromBuffer(data.resourcePixels, width, height)

      // Chunk all views
      const [elevC, tempC, humC, bioC, stratC, resC] = await Promise.all([
        buildChunks(elevationMap, chunkSize),
        buildChunks(temperatureMap, chunkSize),
        buildChunks(humidityMap, chunkSize),
        buildChunks(biomeMap, chunkSize),
        buildChunks(strategicMap, chunkSize),
        buildChunks(resourceMap, chunkSize)
      ])

      mapsRef.current = {
        elevation: elevC,
        temperature: tempC,
        humidity: humC,
        biome: bioC,
        strategic: stratC,
        resource: resC
      }
      mapSizeRef.current = { width, height, tileSize }
      biomeIdsRef.current = new Uint8Array(data.biomeIds)
      strategicPointsRef.current = data.strategicPoints

      // Precompute chunk layout
      const chunksWide = Math.ceil(width / chunkSize)
      const layout: Array<{ x: number; y: number; width: number; height: number }> = []
      for (let ci = 0; ci < elevC.length; ci += 1) {
        const cx = ci % chunksWide
        const cy = Math.floor(ci / chunksWide)
        layout.push({
          x: cx * chunkSize * tileSize,
          y: cy * chunkSize * tileSize,
          width: Math.min(chunkSize, width - cx * chunkSize) * tileSize,
          height: Math.min(chunkSize, height - cy * chunkSize) * tileSize
        })
      }
      chunkLayoutRef.current = layout

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
        ownership: new Uint8Array(width * height).fill(255)
      })
      setWorldMap(worldMap)
      setStrategicPoints(data.strategicPoints)

      // Set initial chunks on renderer
      if (rendererRef.current) {
        const currentView = useGameStore.getState().view
        const current = mapsRef.current[currentView]
        if (current) {
          rendererRef.current.setMapChunks(
            current.map((bitmap, i) => ({ bitmap, ...layout[i] })),
            width * tileSize,
            height * tileSize
          )
        }
      }

      setPhase('playing')
      worker.terminate()
    }

    simulation.start()

    return () => {
      simulation.stop()
      worker.terminate()
      resizeObserver.disconnect()
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointerleave', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
      rendererRef.current = null
      biomeIdsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------------------------------------------------------- */
  /*  Tooltip handler                                                  */
  /* ---------------------------------------------------------------- */
  const handleTooltip = useCallback(
    (e: PointerEvent, canvas: HTMLCanvasElement, camera: Camera, renderer: Renderer) => {
      if (!inspectorEnabled || !biomeIdsRef.current) {
        setTooltip(null)
        return
      }

      const rect = canvas.getBoundingClientRect()
      const screenX = e.clientX - rect.left
      const screenY = e.clientY - rect.top
      const { width, height } = renderer.getViewportSize()
      const world = camera.screenToWorld(screenX, screenY, width, height)
      const { width: mapWidth, height: mapHeight, tileSize } = mapSizeRef.current
      const mapX = Math.floor((world.x + (mapWidth * tileSize) / 2) / tileSize)
      const mapY = Math.floor((world.y + (mapHeight * tileSize) / 2) / tileSize)

      if (mapX < 0 || mapY < 0 || mapX >= mapWidth || mapY >= mapHeight) {
        setTooltip(null)
        return
      }

      // Use WorldMap.at() for rich tile info
      const worldMap = useGameStore.getState().worldMap
      if (worldMap) {
        const tile = worldMap.at(mapX, mapY)
        if (tile) {
          const parts: string[] = [getBiomeById(tile.biomeId).name]
          if (tile.isRiver) parts.push('River')
          if (tile.resource !== 0) parts.push(tile.resourceLabel)

          // Check strategic points
          const SCELL = 8
          const sgridW = Math.ceil(mapSizeRef.current.width / SCELL)
          const cellKey = Math.floor(mapY / SCELL) * sgridW + Math.floor(mapX / SCELL)
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              const sp = strategicGridRef.current.get(cellKey + dy * sgridW + dx)
              if (sp && Math.abs(sp.x - mapX) + Math.abs(sp.y - mapY) <= 4) {
                parts.push(`${STRATEGIC_META[sp.type].label} (${sp.value}/10)`)
                break
              }
            }
          }

          setTooltip({ x: screenX, y: screenY, text: parts.join(' · ') })
          return
        }
      }

      // Fallback to basic biome lookup
      const biomeIds = biomeIdsRef.current
      const biome = getBiomeById(biomeIds[mapY * mapWidth + mapX])
      setTooltip({ x: screenX, y: screenY, text: biome.name })
    },
    [inspectorEnabled]
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
      else if (key === 's') setShowToolbar((prev) => !prev)
      else if (key === 'i') useGameStore.getState().toggleInspector()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setView])

  /* ---------------------------------------------------------------- */
  /*  View-mode switching                                              */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const chunks = mapsRef.current[view]
    const renderer = rendererRef.current
    const layout = chunkLayoutRef.current
    if (chunks && renderer && layout.length > 0) {
      const { width, height, tileSize } = mapSizeRef.current
      renderer.setMapChunks(
        chunks.map((bitmap, i) => ({ bitmap, ...layout[i] })),
        width * tileSize,
        height * tileSize
      )
    }
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
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <section className="canvas-shell" ref={shellRef}>
      <canvas ref={canvasRef} className="canvas-shell__viewport" />

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
              className={`toolbar-btn${view === v ? ' toolbar-btn--active' : ''}`}
              onClick={() => setView(v)}
              title={`${v.charAt(0).toUpperCase() + v.slice(1)} (${v[0].toUpperCase()})`}
            >
              <ToolbarIcon mode={v} />
              <span>{v.length > 5 ? v.slice(0, 5) : v.charAt(0).toUpperCase() + v.slice(1)}</span>
            </button>
          ))}

          <div className="toolbar-divider" />

          <button className="toolbar-btn" onClick={toggleFullscreen} title="Fullscreen">
            <svg viewBox="0 0 16 16">
              {isFullscreen ? (
                <path d="M5 1v4H1v2h6V1zm6 0v6h6V5h-4V1zM1 11h4v4H3v-2H1zm10 0h2v2h2v2h-4z" />
              ) : (
                <path d="M1 1h5v2H3v3H1zm9 0h5v5h-2V3h-3zM1 10h2v3h3v2H1zm12 3h-3v2h5v-5h-2z" />
              )}
            </svg>
            <span>{isFullscreen ? 'Exit' : 'Full'}</span>
          </button>
        </div>
      )}

      {tooltip && (
        <div
          className="canvas-shell__tooltip"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          {tooltip.text}
        </div>
      )}
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
    default:
      return null
  }
}

export default MapView
