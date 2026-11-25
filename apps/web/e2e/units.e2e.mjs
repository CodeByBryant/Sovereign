// End-to-end test of the sprite layers: zoomed out the map shows overlays only; zoomed in, resource
// objects, roads, a hall at each capital and the walking villagers are drawn, and the villagers move
// while time runs. Screenshots (E2E_SHOTS=<directory>) are for a human to look at.
//
//   pnpm --filter @sovereign/web e2e:units
//
// It starts the Vite dev server itself and needs Chromium. The world is 1000 x 1000, so this takes a
// few minutes in software GL.
import { chromium } from 'playwright'
import {
  SOFTWARE_GL,
  centerOn,
  firstNationPoint,
  readCamera,
  startDevServer,
  withTimeout
} from './support.mjs'

const PORT = 5198
const SEED = 1337
const viewport = { width: 1280, height: 800 }

const stats = (page) =>
  page.$eval('canvas', (c) => ({
    sprites: c.dataset.sprites,
    roads: Number(c.dataset.spriteRoads),
    resources: Number(c.dataset.spriteResources),
    halls: Number(c.dataset.spriteHalls),
    units: Number(c.dataset.spriteUnits)
  }))

async function main() {
  const problems = []
  const fail = (message) => problems.push(message)
  const nation = firstNationPoint(SEED)
  const { url, stop } = await startDevServer(PORT)
  const browser = await chromium.launch({ args: SOFTWARE_GL })
  try {
    const page = await browser.newPage({ viewport })
    page.on('pageerror', (error) => fail(`pageerror: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error') fail(`console.error: ${message.text()}`)
    })
    await withTimeout(page.goto(url), 30_000, 'load the page')
    await page.fill('#seed-input', String(SEED))
    await page.click('text=New World')
    await withTimeout(
      page.waitForFunction(() => document.querySelector('.time-controls') !== null, null, {
        timeout: 240_000
      }),
      245_000,
      'the world and its time controls'
    )
    await page.waitForTimeout(800)

    // far out: overlays only
    let s = await stats(page)
    if (s.sprites !== 'off') fail(`zoomed out, sprites should be off, got ${s.sprites}`)
    if (s.units !== 0 || s.resources !== 0) fail('zoomed out, no sprites should be made')

    // centre the first nation, then zoom in with the + button
    const drag = async (dx, dy) => {
      const x = viewport.width / 2
      const y = viewport.height / 2
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 })
      await page.mouse.move(x + dx, y + dy, { steps: 4 })
      await page.mouse.up()
      await page.waitForTimeout(100)
    }
    if (!(await centerOn(page, nation, drag, viewport, 2)))
      fail('could not centre the first nation')
    for (let i = 0; i < 12 && (await readCamera(page)).zoom < 5; i += 1) {
      await page.click('button[aria-label="Zoom in"]')
      await page.waitForTimeout(150)
    }
    await centerOn(page, nation, drag, viewport, 2)
    await page.waitForTimeout(600)
    const zoom = (await readCamera(page)).zoom
    if (zoom < 2.5) fail(`could not zoom in far enough (zoom ${zoom})`)

    s = await stats(page)
    if (s.sprites !== 'on') fail(`zoomed in, sprites should be on, got ${s.sprites}`)
    if (!(s.units > 0)) fail('zoomed in on a capital, there should be villagers')
    if (!(s.halls >= 1)) fail('zoomed in on a capital, its hall should be drawn')
    if (!(s.resources > 0)) fail('zoomed in on land, there should be resource objects')
    if (process.env.E2E_SHOTS)
      await page.screenshot({ path: `${process.env.E2E_SHOTS}/units-still.png` })

    // time runs, and the villagers walk: the picture changes
    const before = await page.screenshot({ clip: { x: 340, y: 150, width: 600, height: 500 } })
    await page.click('.time-controls__play')
    await page.waitForTimeout(3000)
    const after = await page.screenshot({ clip: { x: 340, y: 150, width: 600, height: 500 } })
    if (before.equals(after))
      fail('the picture did not change while time ran: villagers did not move')
    if (process.env.E2E_SHOTS)
      await page.screenshot({ path: `${process.env.E2E_SHOTS}/units-running.png` })

    // zooming back out takes the sprites away
    for (let i = 0; i < 14 && (await readCamera(page)).zoom > 1; i += 1) {
      await page.click('button[aria-label="Zoom out"]')
      await page.waitForTimeout(100)
    }
    s = await stats(page)
    if (s.sprites !== 'off') fail('zoomed back out, sprites should be off again')
    await withTimeout(
      page.evaluate(() => document.title),
      5_000,
      'the page being alive'
    )
    await page.close()
  } finally {
    await browser.close()
    stop()
  }
  if (problems.length > 0) {
    console.error(`FAIL\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    process.exit(1)
  }
  console.log(
    'PASS: sprites gate on zoom, draw resources, halls and villagers, and the villagers move'
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
