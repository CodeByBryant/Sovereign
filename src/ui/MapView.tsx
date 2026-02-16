/**
 * @module MapView
 * @description Full-screen map canvas with camera, renderer, compact toolbar,
 * tile inspector panel and nation detail panel.
 *
 * Wired to zustand GameStore for view mode, FPS and world data.
 */
import React, { useEffect, useRef, useCallback } from 'react'
import { Camera } from '../core/camera/Camera'
import { Renderer } from '../core/rendering/Renderer'
import { Simulation } from '../core/simulation/Simulation'
import { defaultConfig } from '../config/Config'
import type { TerrainConfig } from '../core/terrain/TerrainGenerator'
import { type StrategicPoint } from '../core/terrain/strategic'
import { WorldMap } from '../core/world/WorldMap'
import { spawnNations } from '../core/systems/NationSpawner'
import type { Nation } from '../core/entities/Nation'
import type { TerrainWorkerRequest, TerrainWorkerResponse } from '../core/terrain/terrain.worker'
import { useGameStore, type ViewMode } from '../core/state/GameStore'
import TileInspector, { type InspectorData } from './TileInspector'
import NationPanel from './NationPanel'

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
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const cameraRef = useRef<Camera | null>(null)
  const mapsRef = useRef<Partial<Record<ViewMode, ImageBitmap[]>>>({})
  const mapSizeRef = useRef({ width: 0, height: 0, tileSize: 1 })
  const biomeIdsRef = useRef<Uint8Array | null>(null)
  const nationsRef = useRef<Nation[]>([])
  const strategicPointsRef = useRef<StrategicPoint[]>([])
  const strategicGridRef = useRef<Map<number, StrategicPoint>>(new Map())
  const chunkLayoutRef = useRef<Array<{ x: number; y: number; width: number; height: number }>>([])

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
    const canvas = canvasRef.current
    if (!canvas) return undefined

    const camera = new Camera({
      minZoom: defaultConfig.camera.minZoom,
      maxZoom: defaultConfig.camera.maxZoom
    })
    const renderer = new Renderer(canvas, camera)
    rendererRef.current = renderer
    cameraRef.current = camera
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
        handleHover(e, canvas, camera, renderer)
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

    const onClick = (e: MouseEvent): void => {
      handleClick(e, canvas, camera, renderer)
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointerleave', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('click', onClick)

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
      resources: defaultConfig.terrain.resources,
      minLandRatio: defaultConfig.terrain.map.minLandRatio
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
      const nationsConfig = defaultConfig.terrain.nations
      const terrainForSpawn: TerrainConfig = {
        width,
        height,
        seaLevel: data.seaLevel,
        islandMode: defaultConfig.terrain.map.islandMode,
        ...defaultConfig.terrain.elevation
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

      // --- Build political overlay ImageData ---
      const politicalData = new Uint8ClampedArray(biomeMap.data)
      const alpha = nationsConfig.territoryAlpha
      const darken = nationsConfig.borderDarken

      // Pre-compute border set for each nation
      const borderSet = new Set<number>()
      for (const nation of nations) {
        const nIdx = nationIdToIndex.get(nation.id)!
        for (const tileIdx of nation.provinces) {
          const tx = tileIdx % width
          const ty = (tileIdx - tx) / width
          const neighbours = [
            tx > 0 ? tileIdx - 1 : -1,
            tx < width - 1 ? tileIdx + 1 : -1,
            ty > 0 ? tileIdx - width : -1,
            ty < height - 1 ? tileIdx + width : -1
          ]
          for (const ni of neighbours) {
            if (ni >= 0 && ownershipArr[ni] !== nIdx) {
              borderSet.add(tileIdx)
              break
            }
          }
        }
      }

      // Blend nation colours onto biome base
      for (let i = 0; i < ownerMap.length; i += 1) {
        if (ownershipArr[i] === 255) continue
        const nation = nations[ownershipArr[i]]
        const [nr, ng, nb] = nation.color
        const px = i * 4
        const isBorder = borderSet.has(i)
        const blend = isBorder ? alpha + darken : alpha
        politicalData[px] = Math.round(politicalData[px] * (1 - blend) + nr * blend)
        politicalData[px + 1] = Math.round(politicalData[px + 1] * (1 - blend) + ng * blend)
        politicalData[px + 2] = Math.round(politicalData[px + 2] * (1 - blend) + nb * blend)
        if (isBorder) {
          // Darken border tiles slightly more
          politicalData[px] = Math.round(politicalData[px] * 0.7)
          politicalData[px + 1] = Math.round(politicalData[px + 1] * 0.7)
          politicalData[px + 2] = Math.round(politicalData[px + 2] * 0.7)
        }
      }
      const politicalImg = new ImageData(politicalData, width, height)
      const polC = await buildChunks(politicalImg, chunkSize)
      mapsRef.current.political = polC

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
      canvas.removeEventListener('click', onClick)
      rendererRef.current = null
      cameraRef.current = null
      biomeIdsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------------------------------------------------------- */
  /*  Tile lookup helpers                                              */
  /* ---------------------------------------------------------------- */
  const getTileAt = useCallback(
    (screenX: number, screenY: number, camera: Camera, renderer: Renderer) => {
      const { width, height } = renderer.getViewportSize()
      const world = camera.screenToWorld(screenX, screenY, width, height)
      const { width: mapW, height: mapH, tileSize } = mapSizeRef.current
      const mapX = Math.floor((world.x + (mapW * tileSize) / 2) / tileSize)
      const mapY = Math.floor((world.y + (mapH * tileSize) / 2) / tileSize)
      if (mapX < 0 || mapY < 0 || mapX >= mapW || mapY >= mapH) return null
      const worldMap = useGameStore.getState().worldMap
      return worldMap ? worldMap.at(mapX, mapY) : null
    },
    []
  )

  const buildInspectorData = useCallback(
    (
      screenX: number,
      screenY: number,
      camera: Camera,
      renderer: Renderer
    ): InspectorData | null => {
      const tile = getTileAt(screenX, screenY, camera, renderer)
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
    (e: PointerEvent, canvas: HTMLCanvasElement, camera: Camera, renderer: Renderer) => {
      if (!inspectorEnabled) {
        setInspectorData(null)
        return
      }
      const rect = canvas.getBoundingClientRect()
      setInspectorData(
        buildInspectorData(e.clientX - rect.left, e.clientY - rect.top, camera, renderer)
      )
    },
    [inspectorEnabled, buildInspectorData]
  )

  /* ---------------------------------------------------------------- */
  /*  Click handler (nation selection)                                 */
  /* ---------------------------------------------------------------- */
  const handleClick = useCallback(
    (e: MouseEvent, canvas: HTMLCanvasElement, camera: Camera, renderer: Renderer) => {
      const rect = canvas.getBoundingClientRect()
      const tile = getTileAt(e.clientX - rect.left, e.clientY - rect.top, camera, renderer)
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
