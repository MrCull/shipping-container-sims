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

scope.addEventListener('message', (e) => {
  scope.postMessage(host.handle(e.data))
})
