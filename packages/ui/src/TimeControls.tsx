/**
 * @module TimeControls
 * @description The transport bar: the date, play / pause, and the speed (in-game days per real second).
 * It only draws and reports clicks; the app owns the clock.
 */
import React from 'react'

/** Days in a year: the calendar has no months, only years and days. */
const DAYS_PER_YEAR = 365

/** The in-game date for a number of days since the start: "Year 3 · Day 12" (both count from 1). */
export function formatDate(days: number): string {
  const whole = Number.isFinite(days) && days > 0 ? Math.floor(days) : 0
  const year = Math.floor(whole / DAYS_PER_YEAR) + 1
  const day = (whole % DAYS_PER_YEAR) + 1
  return `Year ${year} · Day ${day}`
}

interface Props {
  /** In-game days since the start. */
  time: number
  paused: boolean
  /** The current speed, in days per second. */
  speed: number
  /** The speeds to offer, slowest first. */
  speeds: readonly number[]
  /** True when nothing can change any more: the borders have settled. */
  saturated?: boolean
  onTogglePause: () => void
  onSpeed: (speed: number) => void
}

/**
 * After a click with a mouse or a finger the button lets go of the keyboard focus, so Space goes on to play
 * and pause the world (a focused button would take it for itself). A keyboard activation (`detail` 0) keeps
 * the focus, so someone using the keys is not lost.
 */
const release = (event: React.MouseEvent<HTMLButtonElement>): void => {
  if (event.detail > 0) event.currentTarget.blur()
}

const TimeControls: React.FC<Props> = ({
  time,
  paused,
  speed,
  speeds,
  saturated = false,
  onTogglePause,
  onSpeed
}) => (
  <div className="time-controls" role="group" aria-label="Time">
    <span className="time-controls__date">{formatDate(time)}</span>
    <button
      type="button"
      className={`time-controls__btn time-controls__play${paused ? '' : ' time-controls__btn--active'}`}
      aria-label={paused ? 'Play' : 'Pause'}
      aria-pressed={!paused}
      title={paused ? 'Play (Space)' : 'Pause (Space)'}
      onClick={(event) => {
        onTogglePause()
        release(event)
      }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {paused ? <path d="M4 2l10 6-10 6z" /> : <path d="M3 2h4v12H3zM9 2h4v12H9z" />}
      </svg>
    </button>
    {speeds.map((s) => (
      <button
        key={s}
        type="button"
        className={`time-controls__btn time-controls__speed${s === speed ? ' time-controls__btn--active' : ''}`}
        aria-label={`${s} days per second`}
        aria-pressed={s === speed}
        title={`${s} days per second (− / +)`}
        onClick={(event) => {
          onSpeed(s)
          release(event)
        }}
      >
        {s}×
      </button>
    ))}
    {saturated && <span className="time-controls__note">Borders settled</span>}
  </div>
)

export default TimeControls
