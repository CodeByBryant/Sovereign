// End-to-end regression test for the development build, which runs React.StrictMode: effects mount,
// unmount and mount again. An early version of the Pixi renderer shared the page's canvas, so the
// second mount reused a destroyed WebGL context and froze the tab. The renderer now creates and
// owns its canvas; this drives a real browser through that double mount and checks that the page
// stays alive, that exactly one canvas is left, and that nothing logged an error.
//
//   pnpm --filter @sovereign/web e2e
//
// It starts the Vite dev server itself and needs Chromium (`pnpm exec playwright install chromium`).
// There is no GPU in CI, so Chromium is asked for its software GL.
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 5199
const URL = `http://127.0.0.1:${PORT}/`

const withTimeout = (promise, ms, what) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${what}`)), ms))
  ])

async function waitForServer(url, ms) {
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

const server = spawn(
  'pnpm',
  ['exec', 'vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  {
    stdio: 'ignore',
    detached: true
  }
)
const stopServer = () => {
  try {
    process.kill(-server.pid)
  } catch {
    // already gone
  }
}

let browser
let failure
try {
  await waitForServer(URL, 60_000)
  browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
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
  if (problems.length > 0) throw new Error(problems.join('\n'))
  console.log('StrictMode e2e OK: one canvas, page responsive, no errors')
} catch (error) {
  failure = error
} finally {
  await browser?.close().catch(() => {})
  stopServer()
}
if (failure) {
  console.error(`StrictMode e2e FAILED:\n${failure.message}`)
  process.exit(1)
}
process.exit(0)
