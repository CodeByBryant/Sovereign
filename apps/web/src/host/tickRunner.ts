/**
 * @module tickRunner
 * @description Runs the world a number of ticks and builds the message that tells the app what changed.
 * Pure (no worker APIs; the clock is injected), so it is tested directly, like `readyMessage`.
 *
 * What changes while time passes is small (the nations' stats and areas) except when a province changes
 * hands: then the ownership layer (4 MB) and, if the political overlay is on screen, the overlay (16 MB)
 * are sent again. Those are rebuilt at most every `minOverlayMs` so that running at a thousand days a
 * second does not mean a thousand copies a second; the claims held back go out when the throttle allows,
 * when the app asks to flush (the player paused or switched to the political view), or when the borders
 * stop moving for good (nothing more will come to send it with).
 */
import { biomeRgba, politicalRgba, type PoliticalStyle } from '@sovereign/renderer'
import type { World } from '@sovereign/simulation'
import type { RunOptions, WorldTicked } from './protocol'
import { unitBuffers } from './readyMessage'

export interface Ticked {
  message: WorldTicked
  /** The buffers to hand to `postMessage` as its transfer list. */
  transfer: ArrayBuffer[]
}

export class TickRunner {
  private claimsSeen: number
  private ownershipDirty = false
  private politicalDirty = false
  private lastSent = Number.NEGATIVE_INFINITY
  private base: Uint8ClampedArray | null = null

  constructor(
    private readonly world: World,
    private readonly style: PoliticalStyle,
    private readonly now: () => number,
    private readonly minOverlayMs = 250
  ) {
    this.claimsSeen = world.expansionClaims
  }

  /** True when provinces have changed hands and the app has not been told the new ownership yet. */
  get pending(): boolean {
    return this.ownershipDirty
  }

  /** Whether the app's political overlay is out of date (it has had no overlay since provinces changed hands). */
  get politicalStale(): boolean {
    return this.politicalDirty
  }

  run(ticks: number, options: RunOptions = {}): Ticked {
    const world = this.world
    world.run(ticks) // (it rejects a number of ticks that is negative or not whole)
    const claims = world.expansionClaims - this.claimsSeen
    this.claimsSeen = world.expansionClaims
    if (claims > 0) {
      this.ownershipDirty = true
      this.politicalDirty = true
    }

    const message: WorldTicked = {
      type: 'ticked',
      tick: world.clock.tick,
      time: world.clock.time,
      claims,
      saturated: world.saturated,
      nations: world.snapshot().nations,
      units: world.unitPositions()
    }
    const transfer: ArrayBuffer[] = unitBuffers(message.units)
    const stock = world.drainStockChanges()
    if (stock.tile.length > 0) {
      message.stock = stock
      transfer.push(
        stock.tile.buffer as ArrayBuffer,
        stock.layer.buffer as ArrayBuffer,
        stock.value.buffer as ArrayBuffer
      )
    }

    const due =
      options.flush === true || world.saturated || this.now() - this.lastSent >= this.minOverlayMs
    if (due) {
      let sent = false
      if (this.ownershipDirty) {
        message.ownership = world.map.ownership.slice()
        transfer.push(message.ownership.buffer as ArrayBuffer)
        this.ownershipDirty = false
        sent = true
      }
      if (this.politicalDirty && options.political === true) {
        message.political = this.paintPolitical()
        transfer.push(message.political.buffer as ArrayBuffer)
        this.politicalDirty = false
        sent = true
      }
      if (sent) this.lastSent = this.now()
    }
    return { message, transfer }
  }

  private paintPolitical(): Uint8ClampedArray {
    const world = this.world
    const t = world.terrain
    // the base map never changes: paint it once
    this.base ??= biomeRgba(t.biomeIds, t.riverWidth, t.width, t.height, true)
    return politicalRgba(
      this.base,
      world.map.ownership,
      world.nations.map((n) => n.color),
      t.width,
      t.height,
      this.style,
      world.provinces.provinceOf
    )
  }
}
