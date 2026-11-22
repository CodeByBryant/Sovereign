// End-to-end test of time: the transport bar (date, play / pause, speeds), the keys (Space, + and -),
// and the world growing while it runs.
//
// Desktop (1280 x 800): a new world starts paused; Play makes the date advance, Space pauses and the
// date stops; the speeds change how fast it advances; the nation panel's province count grows while
// time runs and stops growing once the borders settle ("Borders settled").
// Phone (390 x 844 and 844 x 390, touch): the bar fits, its buttons are big enough to tap, it does not
// overlap the HUD, the toolbar toggle or the resource legend, and a tap on Play makes time run.
//
//   pnpm --filter @sovereign/web e2e:time
//
// It starts the Vite dev server itself and needs Chromium. The world is 2000 x 2000, so this takes a few
// minutes in software GL. Set E2E_SHOTS=<directory> to save screenshots there.
import { chromium } from 'playwright'
import { SOFTWARE_GL, centerOn, firstNationPoint, startDevServer, withTimeout } from './support.mjs'

const PORT = 5197
const SEED = 1337
const MIN_TAP_TARGET = 40

/** The in-game day the date shows: "Year 2 · Day 36" is day 400 (counted from 0). */
const daysOf = (page) =>
  page.$eval('.time-controls__date', (el) => {
    const match = /Year (\d+) · Day (\d+)/.exec(el.textContent ?? '')
    if (!match) throw new Error(`no date in "${el.textContent}"`)
    return (Number(match[1]) - 1) * 365 + Number(match[2]) - 1
  })

/** Play / pause, the speed, and whether the borders have settled, as the bar shows them. */
const barState = (page) =>
  page.evaluate(() => {
    const play = document.querySelector('.time-controls__play')
    const speed = document.querySelector('.time-controls__speed[aria-pressed="true"]')
    return {
      running: play?.getAttribute('aria-pressed') === 'true',
      label: play?.getAttribute('aria-label'),
      speed: speed ? Number(speed.getAttribute('aria-label')?.split(' ')[0]) : null,
      settled: document.querySelector('.time-controls__note') !== null
    }
  })

/** The "Provinces" figure of the open nation panel. */
const provincesOf = (page) =>
  page.evaluate(() => {
    for (const row of document.querySelectorAll('.nation-panel__stat-row')) {
      if (row.querySelector('.nation-panel__stat-label')?.textContent === 'Provinces') {
        return Number(row.querySelector('.nation-panel__stat-value')?.textContent)
      }
    }
    return null
  })

async function boot(page, url, tap) {
  await withTimeout(page.goto(url), 30_000, 'load the page')
  await withTimeout(page.fill('#seed-input', String(SEED)), 10_000, 'fill the seed')
  await withTimeout(tap('text=New World'), 10_000, 'New World')
  await withTimeout(
    page.waitForFunction(() => document.querySelector('.time-controls') !== null, null, {
      timeout: 240_000
    }),
    245_000,
    'the world and its time controls'
  )
  await page.waitForTimeout(800)
}

async function desktop(browser, url, nation) {
  const problems = []
  const fail = (message) => problems.push(`desktop: ${message}`)
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', (error) => fail(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') fail(`console.error: ${message.text()}`)
  })
  await boot(page, url, (selector) => page.click(selector))

  // a new world starts paused on the first day, at 10 days a second
  let state = await barState(page)
  if (state.running) fail('a new world should start paused')
  if (state.label !== 'Play') fail(`a paused world should offer Play, not "${state.label}"`)
  if (state.speed !== 10) fail(`a new world should run at 10 days a second, not ${state.speed}`)
  if ((await daysOf(page)) !== 0) fail('a new world should start on the first day')
  await page.waitForTimeout(1200)
  if ((await daysOf(page)) !== 0) fail('time moved while the world was paused')

  // Play: the date advances, at about the speed chosen (10 days a second)
  await page.click('.time-controls__play')
  state = await barState(page)
  if (!state.running || state.label !== 'Pause') fail('Play did not start time')
  await page
    .waitForFunction(
      () =>
        /Day (\d+)/.exec(document.querySelector('.time-controls__date')?.textContent ?? '')?.[1] >
        '3',
      null,
      { timeout: 15_000 }
    )
    .catch(() => fail('the date did not advance after Play'))
  const a = await daysOf(page)
  await page.waitForTimeout(2000)
  const b = await daysOf(page)
  const slow = b - a
  if (slow < 8 || slow > 30)
    fail(`at 10 days a second, 2 seconds should be about 20 days, got ${slow}`)

  // Space pauses: the date stops (allowing the run that was in flight to land)
  await page.keyboard.press('Space')
  state = await barState(page)
  if (state.running) fail('Space did not pause')
  await page.waitForTimeout(500)
  const stopped = await daysOf(page)
  await page.waitForTimeout(1500)
  if ((await daysOf(page)) !== stopped) fail('time kept moving after Space paused it')
  await page.keyboard.press('Space')
  if (!(await barState(page)).running) fail('Space did not resume')

  // + and - change the speed one step at a time; the buttons pick one directly
  await page.keyboard.press('+')
  if ((await barState(page)).speed !== 100) fail('+ should go from 10 to 100 days a second')
  await page.keyboard.press('-')
  await page.keyboard.press('-')
  if ((await barState(page)).speed !== 1) fail('- twice from 100 should reach 1 day a second')
  await page.click('.time-controls__speed[aria-label="1000 days per second"]')
  if ((await barState(page)).speed !== 1000) fail('the 1000x button did not set 1000 days a second')
  const f0 = await daysOf(page)
  await page.waitForTimeout(1500)
  const fast = (await daysOf(page)) - f0
  if (fast < 400) fail(`at 1000 days a second, 1.5 seconds should pass many days, got ${fast}`)
  if (fast < slow * 5) fail(`1000 days a second (${fast}) is not much faster than 10 (${slow})`)

  // after a mouse click on a button, Space still plays and pauses (the button lets go of the focus)
  if (!(await barState(page)).running) fail('the world should be running here')
  await page.keyboard.press('Space')
  if ((await barState(page)).running) fail('Space after clicking a speed button should pause')
  await page.keyboard.press('Space')
  if (!(await barState(page)).running) fail('Space should resume')

  // a key press on a focused button must not also toggle (Space on the Play button presses it once)
  await page.focus('.time-controls__play')
  const before = (await barState(page)).running
  await page.keyboard.press('Space')
  if ((await barState(page)).running === before)
    fail('Space on the focused Play button did nothing')
  if ((await barState(page)).running !== !before)
    fail('Space on the focused button should press it once')
  if ((await barState(page)).running === false) await page.click('.time-controls__play')

  // growth: open the first nation's panel and watch its provinces grow
  const viewport = { width: 1280, height: 800 }
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
  if (!(await centerOn(page, nation, drag, viewport, 2))) fail('could not centre the first nation')
  await page.mouse.click(viewport.width / 2, viewport.height / 2)
  await page.waitForSelector('.nation-panel', { timeout: 5_000 }).catch(() => {})
  const first = await provincesOf(page)
  if (first === null) {
    fail('clicking the first nation did not open its panel')
  } else {
    await page.waitForTimeout(4000) // at 1000 days a second: years pass
    const grown = await provincesOf(page)
    if (!(grown > first)) fail(`the nation did not grow while time ran: ${first} -> ${grown}`)
  }

  // the borders settle: the bar says so, and then nothing changes
  await withTimeout(
    page.waitForFunction(() => document.querySelector('.time-controls__note') !== null, null, {
      timeout: 150_000
    }),
    155_000,
    'the borders settling'
  ).catch(() => fail('the borders never settled'))
  const settled = await provincesOf(page)
  await page.waitForTimeout(2500)
  if ((await provincesOf(page)) !== settled) fail('a nation changed after the borders settled')
  if (!(await barState(page)).settled) fail('the "Borders settled" note went away')

  // the political view shows the settled world, and the page is still alive
  await page.keyboard.press('p')
  await page.waitForTimeout(1500)
  await withTimeout(
    page.evaluate(() => document.title),
    5_000,
    'a round trip after the political view'
  )
  if (process.env.E2E_SHOTS)
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/time-desktop.png` })
  await page.close()
  return problems
}

async function phone(browser, url, name, viewport) {
  const problems = []
  const fail = (message) => problems.push(`${name}: ${message}`)
  const context = await browser.newContext({
    viewport,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => fail(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') fail(`console.error: ${message.text()}`)
  })
  await boot(page, url, (selector) => page.tap(selector))

  const measure = () =>
    page.evaluate(() => {
      const r = (el) => (el ? el.getBoundingClientRect().toJSON() : null)
      const visible = (el) => el !== null && getComputedStyle(el).display !== 'none'
      const bar = document.querySelector('.time-controls')
      return {
        w: window.innerWidth,
        h: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        bar: r(bar),
        hud: r(document.querySelector('.canvas-shell__hud')),
        toolbar: r(document.querySelector('.canvas-shell__toolbar')),
        toggle: r(document.querySelector('.canvas-shell__toggle')),
        legend: visible(document.querySelector('.resource-legend'))
          ? r(document.querySelector('.resource-legend'))
          : null,
        buttons: [...document.querySelectorAll('.time-controls__btn')].map((b) => ({
          label: b.getAttribute('aria-label'),
          ...r(b)
        }))
      }
    })
  const overlap = (a, b) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

  let m = await measure()
  const inside = (r) =>
    r.left >= -0.5 && r.top >= -0.5 && r.right <= m.w + 0.5 && r.bottom <= m.h + 0.5
  if (m.scrollWidth > m.w) fail(`the page scrolls sideways (${m.scrollWidth} > ${m.w})`)
  if (!m.bar || !inside(m.bar))
    fail(`the time controls are not inside the screen: ${JSON.stringify(m.bar)}`)
  if (m.buttons.length !== 5)
    fail(`expected play and four speeds, found ${m.buttons.length} buttons`)
  for (const b of m.buttons) {
    if (b.width < MIN_TAP_TARGET || b.height < MIN_TAP_TARGET) {
      fail(
        `a time button is too small to tap: ${b.label} ${Math.round(b.width)} x ${Math.round(b.height)}`
      )
    }
  }
  for (const [label, other] of [
    ['HUD', m.hud],
    ['toolbar', m.toolbar],
    ['toolbar toggle', m.toggle]
  ]) {
    if (m.bar && other && overlap(m.bar, other)) fail(`the time controls overlap the ${label}`)
  }
  if (process.env.E2E_SHOTS)
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/time-${name.split(' ')[0]}.png` })

  // the resource legend strip must not sit on the time controls
  await page
    .tap('.toolbar-btn[title="Resource (R)"]', { timeout: 5_000 })
    .catch(() => fail('cannot choose the resource view'))
  await page.waitForTimeout(500)
  m = await measure()
  if (!m.legend) fail('the resource view shows no legend')
  else if (m.bar && overlap(m.bar, m.legend)) fail('the resource legend covers the time controls')
  if (m.scrollWidth > m.w) fail('the legend makes the page scroll sideways')
  if (process.env.E2E_SHOTS)
    await page.screenshot({
      path: `${process.env.E2E_SHOTS}/time-${name.split(' ')[0]}-legend.png`
    })

  // a tap on Play runs time; a tap on a speed picks it
  if ((await barState(page)).running) fail('a new world should start paused')
  await page.tap('.time-controls__play', { timeout: 5_000 })
  await page.tap('.time-controls__speed[aria-label="100 days per second"]', { timeout: 5_000 })
  const t0 = await daysOf(page)
  await page.waitForTimeout(1500)
  const t1 = await daysOf(page)
  if (!(t1 - t0 >= 30)) fail(`a tap on Play did not run time at 100 days a second (${t0} -> ${t1})`)
  if ((await barState(page)).speed !== 100) fail('a tap on 100x did not pick it')
  await page.tap('.time-controls__play', { timeout: 5_000 })
  await page.waitForTimeout(500)
  const stopped = await daysOf(page)
  await page.waitForTimeout(1200)
  if ((await daysOf(page)) !== stopped) fail('a tap on Pause did not stop time')

  await context.close()
  return problems
}

// E2E_ONLY=desktop or E2E_ONLY=phone runs just that part (the desktop part runs the world to settlement)
const only = process.env.E2E_ONLY
const nation = firstNationPoint(SEED)
const server = await startDevServer(PORT)
let browser
let failure
try {
  browser = await chromium.launch({ args: SOFTWARE_GL })
  const problems = [
    ...(only === 'phone' ? [] : await desktop(browser, server.url, nation)),
    ...(only === 'desktop'
      ? []
      : await phone(browser, server.url, 'portrait 390x844', { width: 390, height: 844 })),
    ...(only === 'desktop'
      ? []
      : await phone(browser, server.url, 'landscape 844x390', { width: 844, height: 390 }))
  ]
  if (problems.length > 0) throw new Error(problems.join('\n'))
  console.log(
    'time e2e OK: play, pause, speeds and keys work, nations grow and settle, the phone layout fits'
  )
} catch (error) {
  failure = error
} finally {
  await browser?.close().catch(() => {})
  server.stop()
}
if (failure) {
  console.error(failure instanceof Error ? failure.message : failure)
  process.exit(1)
}
