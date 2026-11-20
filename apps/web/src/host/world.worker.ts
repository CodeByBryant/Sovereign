/**
 * @module world.worker
 * @description The Web Worker that owns the simulation. It creates the `World` from a seed and
 * config, and answers requests about it; see `protocol.ts`. It keeps the world for later phases to
 * step, and sends the app only copies and freshly drawn pixel buffers.
 */
import { World } from '@sovereign/simulation'
import { viewConfig } from '../viewConfig'
import type { WorldRequest, WorldResponse } from './protocol'
import { buildReady } from './readyMessage'

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<WorldRequest>) => void) | null
  postMessage: (message: WorldResponse, transfer?: ArrayBuffer[]) => void
}

let world: World | null = null

ctx.onmessage = (event): void => {
  const request = event.data
  try {
    if (request.type === 'create') {
      world = World.create({ seed: request.seed, config: request.config })
      const { message, transfer } = buildReady(world, viewConfig.political)
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
