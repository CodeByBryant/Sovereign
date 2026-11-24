import { describe, expect, it } from 'vitest'
import { SimulationHost, type WorkerLike } from '../src/host/SimulationHost'
import type { WorldReady, WorldRequest, WorldResponse, WorldTicked } from '../src/host/protocol'

/** A worker double: records what it is sent and lets the test answer. */
class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: WorldResponse }) => void) | null = null
  onerror: ((event: { message?: string }) => void) | null = null
  sent: WorldRequest[] = []
  terminated = 0
  postMessage(message: WorldRequest): void {
    this.sent.push(message)
  }
  terminate(): void {
    this.terminated += 1
  }
  reply(data: WorldResponse): void {
    this.onmessage?.({ data })
  }
}

const READY = {
  type: 'ready',
  snapshot: { seed: 1, tick: 0, time: 0, width: 4, height: 4, seaLevel: 0.2, nations: [] },
  strategicPoints: [],
  layers: {},
  fields: {}
} as unknown as WorldReady

const TICKED: WorldTicked = {
  type: 'ticked',
  tick: 10,
  time: 10,
  claims: 2,
  saturated: false,
  nations: [],
  units: {
    tick: 10,
    count: 0,
    id: new Uint32Array(0),
    kind: new Uint8Array(0),
    owner: new Uint8Array(0),
    x: new Float32Array(0),
    y: new Float32Array(0)
  }
}

const setup = (): { host: SimulationHost; worker: FakeWorker } => {
  const worker = new FakeWorker()
  return { host: new SimulationHost(() => worker), worker }
}

describe('SimulationHost', () => {
  it('asks the worker to create a world and resolves with what it sends back', async () => {
    const { host, worker } = setup()
    const pending = host.create(42, { map: { width: 32 } })
    expect(worker.sent).toEqual([{ type: 'create', seed: 42, config: { map: { width: 32 } } }])
    worker.reply(READY)
    await expect(pending).resolves.toBe(READY)
  })

  it('omits the config from the request when none is given', async () => {
    const { host, worker } = setup()
    const pending = host.create('a seed')
    expect(worker.sent).toEqual([{ type: 'create', seed: 'a seed' }])
    worker.reply(READY)
    await pending
  })

  it("rejects with the worker's message when the engine reports an error", async () => {
    const { host, worker } = setup()
    const pending = host.create(1)
    worker.reply({ type: 'error', message: 'invalid world config: map.width must be ...' })
    await expect(pending).rejects.toThrow('invalid world config: map.width must be ...')
  })

  it('rejects when the worker itself fails', async () => {
    const { host, worker } = setup()
    const pending = host.create(1)
    worker.onerror?.({ message: 'script error' })
    await expect(pending).rejects.toThrow(/script error/)
  })

  it('rejects when the worker fails without saying why', async () => {
    const { host, worker } = setup()
    const pending = host.create(1)
    worker.onerror?.({})
    await expect(pending).rejects.toThrow(/worker/i)
  })

  it('allows only one request at a time', async () => {
    const { host, worker } = setup()
    const first = host.create(1)
    await expect(host.create(2)).rejects.toThrow(/busy/i)
    worker.reply(READY)
    await first
    // once settled, it is free again
    const second = host.create(3)
    worker.reply(READY)
    await second
  })

  it('asks for the world hash and resolves with it', async () => {
    const { host, worker } = setup()
    const pending = host.hash()
    expect(worker.sent).toEqual([{ type: 'hash' }])
    worker.reply({ type: 'hash', hash: 'f'.repeat(32) })
    await expect(pending).resolves.toBe('f'.repeat(32))
  })

  it('rejects a response of the wrong kind for what was asked', async () => {
    const waitingForWorld = setup()
    const create = waitingForWorld.host.create(1)
    waitingForWorld.worker.reply({ type: 'hash', hash: 'a'.repeat(32) })
    await expect(create).rejects.toThrow(/unexpected "hash" response while waiting for create/)

    const waitingForHash = setup()
    const hash = waitingForHash.host.hash()
    waitingForHash.worker.reply(READY)
    await expect(hash).rejects.toThrow(/unexpected "ready" response while waiting for hash/)
  })

  it('ignores a response that nobody is waiting for', () => {
    const { worker } = setup()
    expect(() => worker.reply(READY)).not.toThrow()
  })

  it('terminates the worker once on dispose, and refuses to be used afterwards', async () => {
    const { host, worker } = setup()
    host.dispose()
    host.dispose()
    expect(worker.terminated).toBe(1)
    await expect(host.create(1)).rejects.toThrow(/disposed/i)
    await expect(host.hash()).rejects.toThrow(/disposed/i)
  })

  it('rejects a request that is pending when the host is disposed', async () => {
    const { host } = setup()
    const pending = host.create(1)
    host.dispose()
    await expect(pending).rejects.toThrow(/disposed/i)
  })

  it('asks the worker to run some ticks and resolves with where the world is', async () => {
    const { host, worker } = setup()
    const pending = host.run(10)
    expect(worker.sent).toEqual([{ type: 'run', ticks: 10 }])
    worker.reply(TICKED)
    await expect(pending).resolves.toBe(TICKED)
  })

  it('passes on whether the political overlay is wanted and whether to flush', async () => {
    const { host, worker } = setup()
    const pending = host.run(0, { political: true, flush: true })
    expect(worker.sent).toEqual([{ type: 'run', ticks: 0, political: true, flush: true }])
    worker.reply(TICKED)
    await pending
  })

  it('is busy while a run is in flight, and free again after', async () => {
    const { host, worker } = setup()
    const first = host.run(5)
    await expect(host.run(5)).rejects.toThrow(/busy/i)
    expect(host.busy).toBe(true)
    worker.reply(TICKED)
    await first
    expect(host.busy).toBe(false)
  })

  it('rejects a run answered with the wrong kind of response', async () => {
    const { host, worker } = setup()
    const pending = host.run(5)
    worker.reply({ type: 'hash', hash: 'a'.repeat(32) })
    await expect(pending).rejects.toThrow(/unexpected "hash" response while waiting for run/)
  })

  it('rejects a create answered with a run result', async () => {
    const { host, worker } = setup()
    const pending = host.create(1)
    worker.reply(TICKED)
    await expect(pending).rejects.toThrow(/unexpected "ticked" response while waiting for create/)
  })

  it('rejects a run when the engine reports an error', async () => {
    const { host, worker } = setup()
    const pending = host.run(5)
    worker.reply({ type: 'error', message: 'ticks must be a non-negative integer' })
    await expect(pending).rejects.toThrow(/non-negative/)
  })
})
