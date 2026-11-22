import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { formatDate, TimeControls } from '../src'

describe('formatDate', () => {
  it('counts years of 365 days from year 1, day 1', () => {
    expect(formatDate(0)).toBe('Year 1 · Day 1')
    expect(formatDate(1)).toBe('Year 1 · Day 2')
    expect(formatDate(364)).toBe('Year 1 · Day 365')
    expect(formatDate(365)).toBe('Year 2 · Day 1')
    expect(formatDate(365 * 12 + 39)).toBe('Year 13 · Day 40')
  })

  it('shows whole days: a part of a day is still that day', () => {
    expect(formatDate(0.9)).toBe('Year 1 · Day 1')
    expect(formatDate(364.99)).toBe('Year 1 · Day 365')
  })

  it('starts at the first day for a time that makes no sense', () => {
    expect(formatDate(-5)).toBe('Year 1 · Day 1')
    expect(formatDate(Number.NaN)).toBe('Year 1 · Day 1')
    expect(formatDate(Number.POSITIVE_INFINITY)).toBe('Year 1 · Day 1')
  })

  it('keeps counting for a long game', () => {
    expect(formatDate(365 * 1000)).toBe('Year 1001 · Day 1')
  })
})

const noop = (): void => undefined
const render = (over: Partial<Parameters<typeof TimeControls>[0]> = {}): string =>
  renderToStaticMarkup(
    <TimeControls
      time={400}
      paused={false}
      speed={10}
      speeds={[1, 10, 100, 1000]}
      onTogglePause={noop}
      onSpeed={noop}
      {...over}
    />
  )

describe('TimeControls', () => {
  it('shows the date', () => {
    expect(render()).toContain('Year 2 · Day 36')
  })

  it('offers Pause while time runs, with the button pressed', () => {
    const html = render({ paused: false })
    expect(html).toContain('aria-label="Pause"')
    expect(html).toMatch(
      /aria-label="Pause"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Pause"/
    )
  })

  it('offers Play while time is stopped, with the button not pressed', () => {
    const html = render({ paused: true })
    expect(html).toContain('aria-label="Play"')
    expect(html).not.toContain('aria-label="Pause"')
    expect(html).toMatch(
      /aria-label="Play"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*aria-label="Play"/
    )
  })

  it('has a button for each speed, naming it in days a second, and presses only the current one', () => {
    const html = render({ speed: 100 })
    for (const s of [1, 10, 100, 1000]) expect(html).toContain(`aria-label="${s} days per second"`)
    const pressed = html.match(/aria-pressed="true"/g) ?? []
    // the play / pause button (running) and the one speed
    expect(pressed).toHaveLength(2)
    expect(html).toMatch(
      /aria-label="100 days per second"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="100 days per second"/
    )
    expect(html).toMatch(
      /aria-label="10 days per second"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*aria-label="10 days per second"/
    )
  })

  it('writes each speed as a multiplier', () => {
    const html = render()
    expect(html).toContain('>1×<')
    expect(html).toContain('>1000×<')
  })

  it('says so when the borders have settled, and not before', () => {
    expect(render({ saturated: true })).toContain('Borders settled')
    expect(render({ saturated: false })).not.toContain('Borders settled')
    expect(render()).not.toContain('Borders settled')
  })

  it('has plain buttons that do not submit anything', () => {
    const html = render()
    const buttons = html.match(/<button/g) ?? []
    const typed = html.match(/<button[^>]*type="button"/g) ?? []
    expect(buttons.length).toBe(5)
    expect(typed.length).toBe(buttons.length)
  })

  it('is a labelled group, so a screen reader announces it as the time controls', () => {
    expect(render()).toMatch(
      /role="group"[^>]*aria-label="Time"|aria-label="Time"[^>]*role="group"/
    )
  })
})
