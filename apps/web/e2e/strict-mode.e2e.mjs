// End-to-end regression test for the development build, which runs React.StrictMode: effects mount,
// unmount and mount again. An early version of the Pixi renderer shared the page's canvas, so the
// second mount reused a destroyed WebGL context and froze the tab. The renderer now creates and
// owns its canvas; this drives a real browser through that double mount and checks that the page
// stays alive, that exactly one canvas is left, and that nothing logged an error. It then checks the
// mouse still works (hover inspects a tile, the wheel zooms, a drag pans, a click selects a nation),
// so the touch support cannot have changed the desktop.
//
//   pnpm --filter @sovereign/web e2e
//
// It starts the Vite dev server itself and needs Chromium (`pnpm exec playwright install chromium`).
// There is no GPU in CI, so Chromium is asked for its software GL.
import { chromium } from 'playwright'
import {
  SOFTWARE_GL,
  centerOn,
  firstNationPoint,
  readCamera,
  startDevServer,
  withTimeout
} from './support.mjs'

const PORT = 5199
const SEED = 1337

const nation = firstNationPoint(SEED)

const server = await startDevServer(PORT)
const URL = server.url
let browser
let failure
try {
  browser = await chromium.launch({
    args: SOFTWARE_GL
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const problems = []
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console.error: ${message.text()}`)
  })

  await withTimeout(page.goto(URL), 30_000, 'load the page')
  await withTimeout(page.fill('#seed-input', '1337'), 10_000, 'fill the seed')
  await withTimeout(page.click('text=New World'), 10_000, 'click New World')
  await withTimeout(
    page.waitForSelector('.canvas-shell__host canvas', { timeout: 60_000 }),
    65_000,
    'the map canvas'
  )

  // A frozen tab never answers; a healthy one answers every round trip within moments.
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await withTimeout(
      page.evaluate(() => document.title),
      5_000,
      `page round trip ${i + 1}`
    )
  }

  const canvases = await page.evaluate(
    () => document.querySelectorAll('.canvas-shell__host canvas').length
  )
  if (canvases !== 1)
    problems.push(`expected exactly one map canvas after the StrictMode remount, found ${canvases}`)

  // Nothing may sit on top of the controls pinned to the top corners. The toggle is clickable, so
  // the point at its centre must hit it; the FPS label ignores the pointer, so no panel may
  // overlap its box. Either failing means a side panel has covered a control.
  const covered = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null
    const problems = []
    const toggle = document.querySelector('.canvas-shell__toggle')
    if (!toggle) problems.push('the toolbar toggle is missing')
    else {
      const b = toggle.getBoundingClientRect()
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
      if (hit === null || !toggle.contains(hit)) problems.push('the toolbar toggle is covered')
    }
    const hud = box('.canvas-shell__hud')
    if (!hud) problems.push('the FPS label is missing')
    for (const panel of document.querySelectorAll('.inspector, .nation-panel')) {
      const p = panel.getBoundingClientRect()
      if (
        hud &&
        p.left < hud.right &&
        p.right > hud.left &&
        p.top < hud.bottom &&
        p.bottom > hud.top
      ) {
        problems.push(`the FPS label is covered by .${panel.className}`)
      }
    }
    return problems
  })
  problems.push(...covered)
  // ---- the mouse ----
  await withTimeout(
    page.waitForFunction(() => !/generating/i.test(document.body.innerText), null, {
      timeout: 240_000
    }),
    245_000,
    'the world to generate'
  )
  await page.waitForTimeout(800)
  const viewport = { width: 1280, height: 800 }
  const centre = [viewport.width / 2, viewport.height / 2]
  const camera = () => readCamera(page)
  const start = await camera()
  if (!(start.zoom > 0)) problems.push('the camera is not published on the map shell')

  await page.mouse.move(...centre)
  await page.waitForTimeout(300)
  const hovered = await page.evaluate(() => document.querySelector('.inspector')?.textContent ?? '')
  if (!/position/i.test(hovered))
    problems.push(`hovering did not fill the tile inspector: "${hovered.slice(0, 50)}"`)

  await page.mouse.wheel(0, -100)
  await page.waitForTimeout(300)
  const zoomedIn = await camera()
  if (!(zoomedIn.zoom > start.zoom))
    problems.push(`the wheel did not zoom in: ${start.zoom} -> ${zoomedIn.zoom}`)

  const mouseDrag = async (dx, dy) => {
    await page.mouse.move(...centre)
    await page.mouse.down()
    await page.mouse.move(centre[0] + dx / 2, centre[1] + dy / 2, { steps: 4 })
    await page.mouse.move(centre[0] + dx, centre[1] + dy, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(100)
  }
  const beforeDrag = await camera()
  await mouseDrag(-80, 30)
  const afterDrag = await camera()
  if (!(afterDrag.x > beforeDrag.x) || !(afterDrag.y < beforeDrag.y)) {
    problems.push(
      `dragging with the mouse did not pan: ${JSON.stringify({ beforeDrag, afterDrag })}`
    )
  }

  // click the first nation's capital: its panel opens; Escape closes it
  await page.mouse.move(...centre)
  for (let i = 0; i < 40 && (await camera()).zoom > 0.21; i += 1) {
    await page.mouse.wheel(0, 100)
    await page.waitForTimeout(40)
  }
  if (!(await centerOn(page, nation, mouseDrag, viewport, 2)))
    problems.push('could not bring the nation to the middle')
  for (let i = 0; i < 40 && (await camera()).zoom < 1.2; i += 1) {
    await page.mouse.wheel(0, -100)
    await page.waitForTimeout(40)
  }
  await centerOn(page, nation, mouseDrag, viewport, 1)
  await page.mouse.click(...centre)
  await page.waitForTimeout(500)
  const panelText = await page.evaluate(
    () => document.querySelector('.nation-panel')?.textContent ?? ''
  )
  if (!panelText.includes(nation.name)) {
    problems.push(
      `clicking the capital of ${nation.name} did not open its panel: "${panelText.slice(0, 50)}"`
    )
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  if (await page.$('.nation-panel')) problems.push('Escape did not close the nation panel')

  if (problems.length > 0) throw new Error(problems.join('\n'))
  console.log('StrictMode e2e OK: one canvas, page responsive, no errors')
} catch (error) {
  failure = error
} finally {
  await browser?.close().catch(() => {})
  server.stop()
}
if (failure) {
  console.error(`StrictMode e2e FAILED:\n${failure.message}`)
  process.exit(1)
}
process.exit(0)
