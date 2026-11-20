// End-to-end test of the map on a phone: Chromium with touch emulation at 390 x 844 (portrait) and
// 844 x 390 (landscape). Checks that the layout fits (no horizontal scroll, the toolbar and the
// panels inside the screen and clear of each other, tap targets big enough) and that touch works:
// a one-finger drag pans, a two-finger pinch zooms, the toolbar's + and - zoom, a tap on a nation opens its
// panel as a sheet that fits, and a tap on the map fills the tile inspector (a phone has no hover).
//
//   pnpm --filter @sovereign/web e2e:mobile
//
// Set E2E_SHOTS=<directory> to also save screenshots of the phone layout there.
//
// It starts the Vite dev server itself and needs Chromium. Real iOS and Android devices are not
// covered; this is Chromium's emulation of them.
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
const MIN_TAP_TARGET = 40

async function runOrientation(browser, url, name, viewport, nation) {
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

  await withTimeout(page.goto(url), 30_000, `${name}: load`)
  await withTimeout(page.fill('#seed-input', String(SEED)), 10_000, `${name}: seed`)
  await withTimeout(page.tap('text=New World'), 10_000, `${name}: New World`)
  await withTimeout(
    page.waitForFunction(() => !/generating/i.test(document.body.innerText), null, {
      timeout: 240_000
    }),
    245_000,
    `${name}: generation`
  )
  await page.waitForSelector('.canvas-shell__host canvas')
  await page.waitForTimeout(1500)

  // ---- layout ----
  // A nation panel cannot be opened without a nation to tap, so put one in the page (with some content,
  // so it has a realistic height) and measure the sheet it takes once its slide-in has finished.
  await page.evaluate(() => {
    const probe = document.createElement('aside')
    probe.className = 'nation-panel'
    probe.dataset.layoutProbe = ''
    probe.innerHTML = '<p>probe</p>'.repeat(30)
    document.querySelector('.canvas-shell').append(probe)
  })
  await page.waitForTimeout(900)
  const layout = await page.evaluate(() => {
    const rect = (el) => {
      const b = el.getBoundingClientRect()
      return {
        left: b.left,
        top: b.top,
        right: b.right,
        bottom: b.bottom,
        width: b.width,
        height: b.height
      }
    }
    const visible = (el) => el !== null && getComputedStyle(el).display !== 'none'
    const one = (selector) => document.querySelector(selector)
    const toolbar = one('.canvas-shell__toolbar')
    const toggle = one('.canvas-shell__toggle')
    const zoomButtons = [...document.querySelectorAll('.toolbar-btn[aria-label^="Zoom"]')]
    const inspector = one('.inspector')
    const nationPanel = (() => {
      const probe = document.querySelector('[data-layout-probe]')
      return probe ? rect(probe) : null
    })()
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      toolbar: toolbar ? rect(toolbar) : null,
      toggle: visible(toggle) ? rect(toggle) : null,
      zoomButtons: zoomButtons.length,
      inspector: inspector ? rect(inspector) : null,
      nationPanel,
      buttons: [...document.querySelectorAll('.toolbar-btn, .canvas-shell__toggle')]
        .filter((el) => visible(el) && visible(el.parentElement))
        .map((el) => ({
          label: el.getAttribute('aria-label') ?? el.title ?? el.className,
          ...rect(el)
        }))
    }
  })
  const { innerWidth: w, innerHeight: h } = layout
  const inside = (r) => r.left >= -0.5 && r.top >= -0.5 && r.right <= w + 0.5 && r.bottom <= h + 0.5
  const overlap = (a, b) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

  if (layout.scrollWidth > w) fail(`the page scrolls sideways (${layout.scrollWidth} > ${w})`)
  if (!layout.toolbar || !inside(layout.toolbar))
    fail(`the toolbar is not inside the screen: ${JSON.stringify(layout.toolbar)}`)
  if (layout.zoomButtons !== 2)
    fail(`expected two zoom buttons in the toolbar, found ${layout.zoomButtons}`)
  for (const b of layout.buttons) {
    if (b.width < MIN_TAP_TARGET || b.height < MIN_TAP_TARGET) {
      fail(
        `a button is too small to tap: ${b.label} ${Math.round(b.width)} x ${Math.round(b.height)}`
      )
    }
  }
  await page.evaluate(() => document.querySelector('[data-layout-probe]')?.remove())
  const named = { toolbar: layout.toolbar, toggle: layout.toggle }
  const entries = Object.entries(named).filter(([, r]) => r)
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      if (overlap(entries[i][1], entries[j][1]))
        fail(`${entries[i][0]} and ${entries[j][0]} overlap`)
    }
  }
  for (const [label, panel] of [
    ['inspector', layout.inspector],
    ['nation panel', layout.nationPanel]
  ]) {
    if (!panel) continue
    if (!inside(panel)) fail(`the ${label} is not inside the screen: ${JSON.stringify(panel)}`)
    if (layout.toolbar && overlap(panel, layout.toolbar)) fail(`the ${label} covers the toolbar`)
    if (layout.toggle && overlap(panel, layout.toggle))
      fail(`the ${label} covers the toolbar toggle`)
  }

  if (process.env.E2E_SHOTS) {
    await page.screenshot({
      path: `${process.env.E2E_SHOTS}/mobile-${name.split(' ')[0]}-idle.png`
    })
  }

  // ---- touch ----
  const cdp = await context.newCDPSession(page)
  const touch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id }))
    })
  // The shell publishes the camera as data attributes, so the test reads numbers, not pixels (software
  // GL screenshots of a WebGL canvas are not stable enough to compare).
  const camera = () => readCamera(page)
  const settle = () => page.waitForTimeout(500)

  const cx = Math.round(w / 2)
  const cy = Math.round(h * 0.4)
  const start = await camera()
  if (!(start.zoom > 0)) fail('the camera is not published on the map shell')

  // one finger dragging left and down: the map follows the finger, so the camera moves right and up
  await touch('touchStart', [[cx + 60, cy]])
  for (let i = 1; i <= 6; i += 1) await touch('touchMove', [[cx + 60 - i * 20, cy + i * 4]])
  await touch('touchEnd', [])
  await settle()
  const panned = await camera()
  if (!(panned.x > start.x) || !(panned.y < start.y)) {
    fail(
      `a one-finger drag did not pan the map as the finger moved: ${JSON.stringify({ start, panned })}`
    )
  }
  if (Math.abs(panned.zoom - start.zoom) > 1e-6) fail('a one-finger drag changed the zoom')

  // two fingers moving apart zoom in, about the point between them
  await touch('touchStart', [
    [cx - 15, cy],
    [cx + 15, cy]
  ])
  for (let i = 1; i <= 6; i += 1)
    await touch('touchMove', [
      [cx - 15 - i * 12, cy],
      [cx + 15 + i * 12, cy]
    ])
  await touch('touchEnd', [])
  await settle()
  const pinched = await camera()
  if (!(pinched.zoom > panned.zoom * 1.5)) {
    fail(`a two-finger pinch out did not zoom in: ${panned.zoom} -> ${pinched.zoom}`)
  }

  // two fingers moving together zoom out
  await touch('touchStart', [
    [cx - 90, cy],
    [cx + 90, cy]
  ])
  for (let i = 1; i <= 6; i += 1)
    await touch('touchMove', [
      [cx - 90 + i * 12, cy],
      [cx + 90 - i * 12, cy]
    ])
  await touch('touchEnd', [])
  await settle()
  const pinchedIn = await camera()
  if (!(pinchedIn.zoom < pinched.zoom * 0.8)) {
    fail(`a two-finger pinch in did not zoom out: ${pinched.zoom} -> ${pinchedIn.zoom}`)
  }

  // the toolbar's + and - buttons zoom by a fixed step
  const before = await camera()
  await page
    .tap('.toolbar-btn[aria-label="Zoom in"]', { timeout: 5_000 })
    .catch((error) =>
      fail(`the zoom-in button cannot be tapped: ${String(error.message).split('\n')[0]}`)
    )
  await settle()
  const zoomedIn = await camera()
  if (Math.abs(zoomedIn.zoom / before.zoom - 1.5) > 0.02) {
    fail(`the zoom-in button should zoom by 1.5: ${before.zoom} -> ${zoomedIn.zoom}`)
  }
  await page
    .tap('.toolbar-btn[aria-label="Zoom out"]', { timeout: 5_000 })
    .catch((error) =>
      fail(`the zoom-out button cannot be tapped: ${String(error.message).split('\n')[0]}`)
    )
  await settle()
  const zoomedOut = await camera()
  if (Math.abs(zoomedIn.zoom / zoomedOut.zoom - 1.5) > 0.02) {
    fail(`the zoom-out button should zoom out by 1.5: ${zoomedIn.zoom} -> ${zoomedOut.zoom}`)
  }

  // ---- tap a nation: its panel opens as a bottom sheet that fits and leaves the toolbar free ----
  // Zoom right out, drag the first nation's capital to the middle of the screen with one finger, zoom
  // back in about the middle and tap it.
  const zoomOutButton = '.toolbar-btn[aria-label="Zoom out"]'
  const zoomInButton = '.toolbar-btn[aria-label="Zoom in"]'
  for (let i = 0; i < 6; i += 1) await page.tap(zoomOutButton, { timeout: 5_000 })
  const fingerDrag = async (dx, dy) => {
    await touch('touchStart', [[cx, cy]])
    for (let i = 1; i <= 6; i += 1)
      await touch('touchMove', [[cx + (dx * i) / 6, cy + (dy * i) / 6]])
    await touch('touchEnd', [])
    await page.waitForTimeout(150)
  }
  if (!(await centerOn(page, nation, fingerDrag, viewport, 2)))
    fail('could not bring the nation to the middle of the screen')
  for (let i = 0; i < 6; i += 1) await page.tap(zoomInButton, { timeout: 5_000 })
  await centerOn(page, nation, fingerDrag, viewport, 1)
  await settle()
  await page.touchscreen.tap(w / 2, h / 2)
  await page.waitForTimeout(500)
  if (process.env.E2E_SHOTS) {
    await page.screenshot({
      path: `${process.env.E2E_SHOTS}/mobile-${name.split(' ')[0]}-nation.png`
    })
  }
  const sheet = await page.evaluate(() => {
    const panel = document.querySelector('.nation-panel')
    const toolbar = document.querySelector('.canvas-shell__toolbar')
    const inspector = document.querySelector('.inspector')
    const r = (el) => (el ? el.getBoundingClientRect().toJSON() : null)
    return {
      panel: r(panel),
      text: panel?.textContent ?? '',
      toolbar: r(toolbar),
      inspectorShown: inspector !== null && getComputedStyle(inspector).display !== 'none'
    }
  })
  if (!sheet.panel) {
    fail(`tapping the capital of ${nation.name} did not open its panel`)
  } else {
    if (!sheet.text.includes(nation.name))
      fail(`the panel is not for ${nation.name}: "${sheet.text.slice(0, 50)}"`)
    if (!inside(sheet.panel))
      fail(`the nation panel is not inside the screen: ${JSON.stringify(sheet.panel)}`)
    if (overlap(sheet.panel, sheet.toolbar)) fail('the nation panel covers the toolbar')
    if (sheet.inspectorShown) fail('the tile inspector is still shown over the nation panel')
    await page
      .tap('.nation-panel__close', { timeout: 5_000 })
      .catch((error) => fail(`the panel cannot be closed: ${String(error.message).split('\n')[0]}`))
    await page.waitForTimeout(300)
    if (await page.$('.nation-panel')) fail('the nation panel did not close')
  }

  // a phone has no hover: a tap on the map must fill the tile inspector
  await page.touchscreen.tap(cx, cy)
  await page.waitForTimeout(400)
  const inspectorText = await page.evaluate(
    () => document.querySelector('.inspector')?.textContent ?? ''
  )
  if (!/position/i.test(inspectorText))
    fail(`tapping a tile did not fill the inspector: "${inspectorText.slice(0, 60)}"`)

  await context.close()
  return problems
}

const nation = firstNationPoint(SEED)
const server = await startDevServer(PORT)
let browser
let failure
try {
  browser = await chromium.launch({ args: SOFTWARE_GL })
  const problems = [
    ...(await runOrientation(
      browser,
      server.url,
      'portrait 390x844',
      { width: 390, height: 844 },
      nation
    )),
    ...(await runOrientation(
      browser,
      server.url,
      'landscape 844x390',
      { width: 844, height: 390 },
      nation
    ))
  ]
  if (problems.length > 0) throw new Error(problems.join('\n'))
  console.log('mobile e2e OK: the layout fits and touch pans, pinches, zooms and inspects')
} catch (error) {
  failure = error
} finally {
  await browser?.close().catch(() => {})
  server.stop()
}
if (failure) {
  console.error(`mobile e2e FAILED:\n${failure.message}`)
  process.exit(1)
}
process.exit(0)
