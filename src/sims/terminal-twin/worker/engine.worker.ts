/**
 * Web Worker entry: runs the engine off the main thread.
 * Create with `new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })`.
 */
import { createEngineHost } from './engineHost'
import type { WorkerRequestMessage } from './protocol'

/** Minimal worker scope (the app tsconfig uses DOM types, not WebWorker). */
const scope = self as unknown as {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (e: MessageEvent<WorkerRequestMessage>) => void): void
}

const host = createEngineHost()

// Serve requests strictly in order (a request may await async decision handlers).
let queue: Promise<void> = Promise.resolve()
scope.addEventListener('message', (e) => {
  queue = queue.then(async () => scope.postMessage(await host.handle(e.data)))
})
