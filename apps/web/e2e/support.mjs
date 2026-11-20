// Shared helpers for the browser end-to-end tests: start the Vite dev server, wait for it, and put a
// time limit on anything that could hang.
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const withTimeout = (promise, ms, what) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${what}`)), ms))
  ])

export async function waitForServer(url, ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`the dev server did not come up at ${url}`)
}

/** Starts `vite` on `port` and returns its URL and a function that stops it. */
export async function startDevServer(port) {
  const server = spawn(
    'pnpm',
    ['exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { stdio: 'ignore', detached: true }
  )
  const stop = () => {
    try {
      process.kill(-server.pid)
    } catch {
      // already gone
    }
  }
  const url = `http://127.0.0.1:${port}/`
  try {
    await waitForServer(url, 60_000)
  } catch (error) {
    stop()
    throw error
  }
  return { url, stop }
}

/** Chromium has no GPU in CI, so ask for its software GL. */
export const SOFTWARE_GL = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader'
]

/**
 * The first nation of the world for `seed`, from the headless simulator (the same engine the page
 * runs in its worker), as a point in the camera's world coordinates (pixels from the map centre).
 */
export function firstNationPoint(seed) {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const json = execFileSync('pnpm', ['-s', 'sim', '--', '--seed', String(seed), '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024
  })
  const { width, height, nations } = JSON.parse(json)
  const tileSize = 4 // apps/web/src/viewConfig.ts
  const capital = nations[0].capital
  const tx = capital % width
  const ty = Math.floor(capital / width)
  return {
    name: nations[0].name,
    x: (tx + 0.5) * tileSize - (width * tileSize) / 2,
    y: (ty + 0.5) * tileSize - (height * tileSize) / 2
  }
}

/** The camera the map shell publishes as data attributes. */
export const readCamera = (page) =>
  page.$eval('.canvas-shell', (el) => ({
    zoom: Number(el.dataset.cameraZoom),
    x: Number(el.dataset.cameraX),
    y: Number(el.dataset.cameraY)
  }))

/**
 * Drags the map (with `drag(dx, dy)`, which moves the finger or mouse by that many screen pixels)
 * until `point` (camera world coordinates) is at the centre of the screen, to within `tolerance` px.
 * The camera moves opposite to the drag, so the drag is the negated distance still to go.
 */
export async function centerOn(page, point, drag, viewport, tolerance = 1) {
  for (let round = 0; round < 14; round += 1) {
    const camera = await readCamera(page)
    const needX = (point.x - camera.x) * camera.zoom
    const needY = (point.y - camera.y) * camera.zoom
    if (Math.hypot(needX, needY) <= tolerance) return true
    const limit = (v, max) => Math.max(-max, Math.min(max, v))
    await drag(limit(-needX, viewport.width * 0.35), limit(-needY, viewport.height * 0.25))
  }
  return false
}
