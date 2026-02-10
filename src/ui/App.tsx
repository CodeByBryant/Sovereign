import React, { useEffect, useRef, useState } from 'react'
import { Camera } from '../core/camera/Camera'
import { Renderer } from '../core/rendering/Renderer'
import { Simulation } from '../core/simulation/Simulation'
import { defaultConfig } from '../config/Config'
import {
  TerrainGenerator,
  type BiomeNoiseConfig,
  type HumidityConfig,
  type TerrainConfig,
  type TemperatureConfig
} from '../core/terrain/TerrainGenerator'
import { buildBiomeMap, getBiomeById } from '../core/terrain/biomes'
import { RiverGenerator } from '../core/terrain/rivers'
import {
  detectStrategicPoints,
  buildStrategicOverlay,
  STRATEGIC_META,
  type StrategicPoint
} from '../core/terrain/strategic'

type ViewMode = 'elevation' | 'temperature' | 'humidity' | 'biome' | 'strategic'

const App = (): JSX.Element => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const mapsRef = useRef<Partial<Record<ViewMode, ImageBitmap[]>>>({})
  const mapSizeRef = useRef({ width: 0, height: 0, tileSize: 1 })
  const biomeIdsRef = useRef<Uint8Array | null>(null)
  const strategicPointsRef = useRef<StrategicPoint[]>([])
  /** Spatial grid for O(1) strategic tooltip lookup. Cell size = 8 tiles. */
  const strategicGridRef = useRef<Map<number, StrategicPoint>>(new Map())
  /** Precomputed chunk layout — positions computed once, bitmaps swapped per view. */
  const chunkLayoutRef = useRef<Array<{ x: number; y: number; width: number; height: number }>>([])
  const mapDataRef = useRef<{
    elevation: Float32Array
    temperature: Float32Array
    humidity: Float32Array
    biomeIds: Uint8Array
    riverMask: Uint8Array
  } | null>(null)
  const [fps, setFps] = useState(0)
  const [view, setView] = useState<ViewMode>('biome')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isGenerating, setIsGenerating] = useState(true)
  const [showToolbar, setShowToolbar] = useState(true)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return undefined
    }

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

    let isDragging = false
    let lastX = 0
    let lastY = 0

    const onPointerDown = (event: PointerEvent): void => {
      isDragging = true
      lastX = event.clientX
      lastY = event.clientY
      canvas.setPointerCapture(event.pointerId)
    }

    const onPointerMove = (event: PointerEvent): void => {
      if (!isDragging) {
        if (!biomeIdsRef.current) {
          setTooltip(null)
          return
        }

        const rect = canvas.getBoundingClientRect()
        const screenX = event.clientX - rect.left
        const screenY = event.clientY - rect.top
        const { width, height } = renderer.getViewportSize()
        const world = camera.screenToWorld(screenX, screenY, width, height)
        const { width: mapWidth, height: mapHeight, tileSize } = mapSizeRef.current
        const mapX = Math.floor((world.x + (mapWidth * tileSize) / 2) / tileSize)
        const mapY = Math.floor((world.y + (mapHeight * tileSize) / 2) / tileSize)

        if (mapX < 0 || mapY < 0 || mapX >= mapWidth || mapY >= mapHeight) {
          setTooltip(null)
          return
        }

        const biomeIds = biomeIdsRef.current
        const biomeIndex = biomeIds[mapY * mapWidth + mapX]
        const biome = getBiomeById(biomeIndex)

        // Check if there's a strategic point nearby via spatial grid (O(1)).
        let label = biome.name
        const SCELL = 8
        const sgridW = Math.ceil(mapSizeRef.current.width / SCELL)
        const cellKey = Math.floor(mapY / SCELL) * sgridW + Math.floor(mapX / SCELL)
        // Check current cell + neighbours
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const sp = strategicGridRef.current.get(cellKey + dy * sgridW + dx)
            if (sp && Math.abs(sp.x - mapX) + Math.abs(sp.y - mapY) <= 4) {
              label = `${STRATEGIC_META[sp.type].label} (${sp.value}/10) · ${biome.name}`
              break
            }
          }
          if (label !== biome.name) break
        }
        setTooltip({ x: screenX, y: screenY, name: label })
        return
      }

      const deltaX = event.clientX - lastX
      const deltaY = event.clientY - lastY
      lastX = event.clientX
      lastY = event.clientY

      camera.pan(deltaX, deltaY)
    }

    const onPointerUp = (event: PointerEvent): void => {
      isDragging = false
      canvas.releasePointerCapture(event.pointerId)
    }

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()

      const { width, height } = renderer.getViewportSize()
      const rect = canvas.getBoundingClientRect()
      const anchorX = event.clientX - rect.left
      const anchorY = event.clientY - rect.top
      const zoomDirection = event.deltaY > 0 ? -1 : 1
      const scale = 1 + zoomDirection * defaultConfig.camera.zoomStep

      camera.zoomAt(scale, anchorX, anchorY, width, height)
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointerleave', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    const { tileSize, chunkSize, ...mapConfig } = defaultConfig.terrain.map
    const terrainConfig: TerrainConfig = {
      ...mapConfig,
      ...defaultConfig.terrain.elevation
    }
    const temperatureConfig: TemperatureConfig = defaultConfig.terrain.temperature
    const humidityConfig: HumidityConfig = defaultConfig.terrain.humidity
    const biomeNoiseConfig: BiomeNoiseConfig = defaultConfig.terrain.biomeNoise
    const riverConfig = defaultConfig.terrain.rivers

    const buildChunks = async (imageData: ImageData, chunkSize: number): Promise<ImageBitmap[]> => {
      const chunks: ImageBitmap[] = []
      const tilesWide = imageData.width
      const tilesHigh = imageData.height

      for (let y = 0; y < tilesHigh; y += chunkSize) {
        for (let x = 0; x < tilesWide; x += chunkSize) {
          const chunkWidth = Math.min(chunkSize, tilesWide - x)
          const chunkHeight = Math.min(chunkSize, tilesHigh - y)

          // Crop directly from the ImageData to avoid per-pixel copies.
          // Scaling is done at render time for tiles.
          const bitmap = await createImageBitmap(imageData, x, y, chunkWidth, chunkHeight)
          chunks.push(bitmap)
        }
      }

      return chunks
    }

    const generateMaps = async (): Promise<void> => {
      setIsGenerating(true)
      const generator = new TerrainGenerator(defaultConfig.terrain.seed)
      const elevationField = generator.generateElevationField(terrainConfig)
      const temperatureField = generator.generateTemperatureField(
        elevationField,
        terrainConfig,
        temperatureConfig
      )
      const baseHumidityField = generator.generateHumidityField(
        elevationField,
        terrainConfig,
        humidityConfig
      )
      const riverGenerator = new RiverGenerator(defaultConfig.terrain.seed)
      const riverData = riverGenerator.generate(
        elevationField,
        baseHumidityField,
        terrainConfig,
        riverConfig
      )
      const humidityField = riverData.humidity

      const biomeNoiseField = generator.generateBiomeNoiseField(biomeNoiseConfig, terrainConfig)
      const elevationMap = generator.generateElevationMap(elevationField, terrainConfig)
      const temperatureMap = generator.generateTemperatureMap(temperatureField, terrainConfig)
      const humidityMap = generator.generateHumidityMap(humidityField, terrainConfig)
      const { imageData: biomeMap, biomeIds } = buildBiomeMap(
        elevationField,
        temperatureField,
        humidityField,
        biomeNoiseField,
        terrainConfig.width,
        terrainConfig.height,
        terrainConfig.seaLevel,
        defaultConfig.terrain.biomes
      )
      riverGenerator.applyToImage(biomeMap, riverData.riverWidth)

      // ---- Strategic points ----
      const strategicData = detectStrategicPoints(
        elevationField,
        riverData.riverMask,
        terrainConfig,
        defaultConfig.terrain.biomes,
        defaultConfig.terrain.strategic
      )
      strategicPointsRef.current = strategicData.points
      const strategicMap = buildStrategicOverlay(biomeMap, strategicData.points)

      const tileSize = defaultConfig.terrain.map.tileSize
      const chunkSize = defaultConfig.terrain.map.chunkSize
      const [elevationChunks, temperatureChunks, humidityChunks, biomeChunks, strategicChunks] =
        await Promise.all([
          buildChunks(elevationMap, chunkSize),
          buildChunks(temperatureMap, chunkSize),
          buildChunks(humidityMap, chunkSize),
          buildChunks(biomeMap, chunkSize),
          buildChunks(strategicMap, chunkSize)
        ])

      mapsRef.current = {
        elevation: elevationChunks,
        temperature: temperatureChunks,
        humidity: humidityChunks,
        biome: biomeChunks,
        strategic: strategicChunks
      }
      mapSizeRef.current = { width: biomeMap.width, height: biomeMap.height, tileSize }
      biomeIdsRef.current = biomeIds

      // Precompute chunk layout once (positions never change, only bitmaps swap).
      const tilesWide = biomeMap.width
      const tilesHigh = biomeMap.height
      const chunkTiles = chunkSize
      const chunksWide = Math.ceil(tilesWide / chunkTiles)
      const layout: Array<{ x: number; y: number; width: number; height: number }> = []
      const totalChunks = elevationChunks.length
      for (let ci = 0; ci < totalChunks; ci += 1) {
        const cx = ci % chunksWide
        const cy = Math.floor(ci / chunksWide)
        layout.push({
          x: cx * chunkTiles * tileSize,
          y: cy * chunkTiles * tileSize,
          width: Math.min(chunkTiles, tilesWide - cx * chunkTiles) * tileSize,
          height: Math.min(chunkTiles, tilesHigh - cy * chunkTiles) * tileSize
        })
      }
      chunkLayoutRef.current = layout

      // Build spatial grid for strategic points (cell size 8).
      const sGrid = new Map<number, StrategicPoint>()
      const SCELL = 8
      const sgridW = Math.ceil(terrainConfig.width / SCELL)
      for (const sp of strategicData.points) {
        const key = Math.floor(sp.y / SCELL) * sgridW + Math.floor(sp.x / SCELL)
        const existing = sGrid.get(key)
        if (!existing || sp.value > existing.value) sGrid.set(key, sp)
      }
      strategicGridRef.current = sGrid

      mapDataRef.current = {
        elevation: elevationField,
        temperature: temperatureField,
        humidity: humidityField,
        biomeIds,
        riverMask: riverData.riverMask
      }

      if (rendererRef.current) {
        const current = mapsRef.current[view]
        if (current) {
          rendererRef.current.setMapChunks(
            current.map((bitmap, i) => ({ bitmap, ...layout[i] })),
            tilesWide * tileSize,
            tilesHigh * tileSize
          )
        }
      }

      setIsGenerating(false)
    }

    void generateMaps()

    simulation.start()

    return () => {
      simulation.stop()
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
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      const key = event.key.toLowerCase()
      if (key === 'e') {
        setView('elevation')
      } else if (key === 't') {
        setView('temperature')
      } else if (key === 'h') {
        setView('humidity')
      } else if (key === 'b') {
        setView('biome')
      } else if (key === 'g') {
        setView('strategic')
      } else if (key === 's') {
        setShowToolbar((prev) => !prev)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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

  useEffect(() => {
    const handleFullscreenChange = (): void => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const toggleFullscreen = (): void => {
    if (!shellRef.current) {
      return
    }

    if (!document.fullscreenElement) {
      void shellRef.current.requestFullscreen()
    } else {
      void document.exitFullscreen()
    }
  }

  return (
    <div className="app app--canvas">
      <section className="canvas-shell" ref={shellRef}>
        <canvas ref={canvasRef} className="canvas-shell__viewport" />

        <div className="canvas-shell__hud">
          FPS: {fps} · {view}
          {isGenerating ? ' · generating…' : ''}
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
            {/* ---- View-mode buttons ---- */}
            <button
              className={`toolbar-btn${view === 'elevation' ? ' toolbar-btn--active' : ''}`}
              onClick={() => setView('elevation')}
              title="Elevation (E)"
            >
              <svg viewBox="0 0 16 16">
                <path d="M2 14l5-10 3 5 2-3 2 8z" />
              </svg>
              <span>Elev</span>
            </button>

            <button
              className={`toolbar-btn${view === 'temperature' ? ' toolbar-btn--active' : ''}`}
              onClick={() => setView('temperature')}
              title="Temperature (T)"
            >
              <svg viewBox="0 0 16 16">
                <path d="M7 1h2v8.5a3 3 0 11-2 0zM8 14a2 2 0 100-4 2 2 0 000 4z" />
              </svg>
              <span>Temp</span>
            </button>

            <button
              className={`toolbar-btn${view === 'humidity' ? ' toolbar-btn--active' : ''}`}
              onClick={() => setView('humidity')}
              title="Humidity (H)"
            >
              <svg viewBox="0 0 16 16">
                <path d="M8 1C6 4 3 7.5 3 10a5 5 0 0010 0c0-2.5-3-6-5-9z" />
              </svg>
              <span>Humid</span>
            </button>

            <button
              className={`toolbar-btn${view === 'biome' ? ' toolbar-btn--active' : ''}`}
              onClick={() => setView('biome')}
              title="Biomes (B)"
            >
              <svg viewBox="0 0 16 16">
                <path d="M8 1l3 4h-2v3h3l-4 4-4-4h3V5H5z" />
                <rect x="2" y="13" width="12" height="2" rx="1" />
              </svg>
              <span>Biome</span>
            </button>

            <button
              className={`toolbar-btn${view === 'strategic' ? ' toolbar-btn--active' : ''}`}
              onClick={() => setView('strategic')}
              title="Strategic (G)"
            >
              <svg viewBox="0 0 16 16">
                <path d="M8 1l2 5h5l-4 3 1.5 5L8 11l-4.5 3L5 9 1 6h5z" />
              </svg>
              <span>Strat</span>
            </button>

            <div className="toolbar-divider" />

            {/* ---- Utility buttons ---- */}
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
            {tooltip.name}
          </div>
        )}
      </section>
    </div>
  )
}

export default App
