import WorldWorker from './world.worker?worker'
import type { WorkerLike } from './SimulationHost'

/** The real world worker, for the app (tests give the host a fake instead). */
export function createWorldWorker(): WorkerLike {
  return new WorldWorker() as unknown as WorkerLike
}
