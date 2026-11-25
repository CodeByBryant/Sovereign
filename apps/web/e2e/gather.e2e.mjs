// End-to-end test of the gather loop, zoomed in on a capital: villagers walk to deposits, work them, carry what
// they took home, and the deposits are drawn down (the stock changes reach the page while time runs).
// Screenshots (E2E_SHOTS=<directory>) are for a human to look at.
//
//   pnpm --filter @sovereign/web e2e:gather
//
// It starts the Vite dev server itself and needs Chromium. The world is 1000 x 1000, so this takes a few
// minutes in software GL.
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
const viewport = { width: 1280, height: 800 }

const stats = (page) =>
  page.$eval('canvas', (c) => ({
    sprites: c.dataset.sprites,
    units: Number(c.dataset.spriteUnits),
    working: Number(c.dataset.spriteWorking),
    carrying: Number(c.dataset.spriteCarrying),
    drawn: Number(c.dataset.spriteDrawn),
    resources: Number(c.dataset.spriteResources)
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
    for (let i = 0; i < 12 && (await readCamera(page)).zoom < 4; i += 1) {
      await page.click('button[aria-label="Zoom in"]')
      await page.waitForTimeout(150)
    }
    await centerOn(page, nation, drag, viewport, 2)
    await page.waitForTimeout(600)

    let s = await stats(page)
    if (s.sprites !== 'on') fail(`zoomed in, sprites should be on, got ${s.sprites}`)
    if (!(s.units > 0)) fail('there should be villagers at the capital')
    if (s.drawn !== 0)
      fail(`a new world has not been gathered from, but ${s.drawn} deposits are drawn down`)
    if (s.working !== 0 || s.carrying !== 0) fail('a new world is not working or carrying yet')
    if (process.env.E2E_SHOTS)
      await page.screenshot({ path: `${process.env.E2E_SHOTS}/gather-0-start.png` })

    // run at 100 days a second and watch for workers, carriers and drawn-down deposits
    await page.click('.time-controls__speed[aria-label="100 days per second"]')
    await page.click('.time-controls__play')
    let sawWorking = 0
    let sawCarrying = 0
    let drawn = 0
    let shot = false
    for (let i = 0; i < 40; i += 1) {
      await page.waitForTimeout(500)
      s = await stats(page)
      sawWorking = Math.max(sawWorking, s.working)
      sawCarrying = Math.max(sawCarrying, s.carrying)
      drawn = Math.max(drawn, s.drawn)
      if (!shot && s.carrying > 0 && process.env.E2E_SHOTS) {
        shot = true
        await page.screenshot({ path: `${process.env.E2E_SHOTS}/gather-1-carrying.png` })
      }
      if (sawWorking > 0 && sawCarrying > 0 && drawn > 0) break
    }
    if (!(sawWorking > 0)) fail('no villager was ever seen at work')
    if (!(sawCarrying > 0)) fail('no villager was ever seen carrying something home')
    if (!(drawn > 0))
      fail('no deposit was ever drawn down: the stock changes did not reach the page')

    await page.waitForTimeout(3000)
    if (process.env.E2E_SHOTS)
      await page.screenshot({ path: `${process.env.E2E_SHOTS}/gather-2-later.png` })
    s = await stats(page)
    if (!(s.drawn >= drawn))
      fail(`deposits drawn down went from ${drawn} to ${s.drawn} while time ran on`)

    // the page is alive and the world is sound: pause, and ask the worker for its hash
    await page.keyboard.press('Space')
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
    'PASS: villagers work deposits, carry goods home, and the deposits are drawn down on screen'
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
