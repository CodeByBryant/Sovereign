/**
 * @module world.worker
 * @description The Web Worker that owns the simulation. It creates the `World` from a seed and
 * config, steps it when asked to run, and answers requests about it; see `protocol.ts`. It sends the
 * app only copies and freshly drawn pixel buffers.
 */
import { World } from '@sovereign/simulation'
import { viewConfig } from '../viewConfig'
import type { WorldRequest, WorldResponse } from './protocol'
import { buildReady } from './readyMessage'
import { TickRunner } from './tickRunner'

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<WorldRequest>) => void) | null
  postMessage: (message: WorldResponse, transfer?: ArrayBuffer[]) => void
}

let world: World | null = null
let runner: TickRunner | null = null

ctx.onmessage = (event): void => {
  const request = event.data
  try {
    if (request.type === 'create') {
      world = World.create({ seed: request.seed, config: request.config })
      runner = new TickRunner(world, viewConfig.political, () => performance.now())
      const { message, transfer } = buildReady(world, viewConfig.political)
      ctx.postMessage(message, transfer)
    } else if (request.type === 'run') {
      if (runner === null) throw new Error('no world has been created yet')
      const { message, transfer } = runner.run(request.ticks, {
        political: request.political,
        flush: request.flush
      })
      ctx.postMessage(message, transfer)
    } else if (request.type === 'hash') {
      if (world === null) throw new Error('no world has been created yet')
      ctx.postMessage({ type: 'hash', hash: world.stateHash() })
    }
  } catch (error) {
    ctx.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error)
    })
  }
}
