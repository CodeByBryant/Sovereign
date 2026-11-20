/**
 * @module SimulationHost
 * @description The app's handle on the simulation, which runs in a worker so that generating and
 * (later) stepping a world never blocks the UI. One request is in flight at a time.
 *
 * The worker is injected, so the host is tested with a fake and the app supplies the real one.
 */
import type { WorldConfigOverrides } from '@sovereign/config'
import type { WorldReady, WorldRequest, WorldResponse } from './protocol'

/** The part of a `Worker` the host uses. */
export interface WorkerLike {
  postMessage(message: WorldRequest): void
  terminate(): void
  onmessage: ((event: { data: WorldResponse }) => void) | null
  onerror: ((event: { message?: string }) => void) | null
}

type Pending =
  | { kind: 'create'; resolve: (world: WorldReady) => void; reject: (error: Error) => void }
  | { kind: 'hash'; resolve: (hash: string) => void; reject: (error: Error) => void }

export class SimulationHost {
  private readonly worker: WorkerLike
  private pending: Pending | null = null
  private disposed = false

  constructor(createWorker: () => WorkerLike) {
    this.worker = createWorker()
    this.worker.onmessage = (event) => this.handle(event.data)
    this.worker.onerror = (event) => {
      this.settle(new Error(`the world worker failed: ${event.message ?? 'unknown error'}`))
    }
  }

  /** Generate a world. Rejects if the engine rejects the seed or config. */
  create(seed: number | string, config?: WorldConfigOverrides): Promise<WorldReady> {
    return this.request<WorldReady>('create', {
      type: 'create',
      seed,
      ...(config === undefined ? {} : { config })
    })
  }

  /** The state hash of the world the worker holds. */
  hash(): Promise<string> {
    return this.request<string>('hash', { type: 'hash' })
  }

  /** Stop the worker. Anything still pending is rejected; the host cannot be used again. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.settle(new Error('the simulation host has been disposed'))
    this.worker.terminate()
  }

  private request<T>(kind: Pending['kind'], message: WorldRequest): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('the simulation host has been disposed'))
    if (this.pending !== null) return Promise.reject(new Error('the simulation host is busy'))
    return new Promise<T>((resolve, reject) => {
      this.pending = { kind, resolve, reject } as Pending
      this.worker.postMessage(message)
    })
  }

  private handle(response: WorldResponse): void {
    const pending = this.pending
    if (pending === null) return // nobody is waiting for this
    if (response.type === 'error') return this.settle(new Error(response.message))
    if (response.type === 'ready' && pending.kind === 'create') {
      this.pending = null
      return pending.resolve(response)
    }
    if (response.type === 'hash' && pending.kind === 'hash') {
      this.pending = null
      return pending.resolve(response.hash)
    }
    this.settle(
      new Error(`unexpected "${response.type}" response while waiting for ${pending.kind}`)
    )
  }

  /** Reject whatever is pending, if anything. */
  private settle(error: Error): void {
    const pending = this.pending
    this.pending = null
    pending?.reject(error)
  }
}
