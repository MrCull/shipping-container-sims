/**
 * Main-thread client for the engine worker: promise-based requests matched
 * by request id. Each request resolves with the result plus the Delta and
 * EngineInfo the worker collected while serving it (replies arrive in
 * request order).
 */
import type { Delta, EngineInfo, WorkerReply, WorkerRequest } from '../worker/protocol'

export interface EngineResponse<T> {
  result: T
  delta: Delta
  info: EngineInfo
}

type Pending = { resolve: (v: EngineResponse<unknown>) => void; reject: (e: Error) => void }

export class EngineClient {
  private worker: Worker
  private nextRid = 1
  private pending = new Map<number, Pending>()

  constructor() {
    this.worker = new Worker(new URL('../worker/engine.worker.ts', import.meta.url), { type: 'module' })
    this.worker.addEventListener('message', (e: MessageEvent<WorkerReply>) => this.receive(e.data))
    this.worker.addEventListener('error', (e) => this.failAll(new Error(`Engine worker error: ${e.message}`)))
  }

  request<T = unknown>(req: WorkerRequest): Promise<EngineResponse<T>> {
    const rid = this.nextRid++
    return new Promise<EngineResponse<T>>((resolve, reject) => {
      this.pending.set(rid, { resolve: resolve as Pending['resolve'], reject })
      this.worker.postMessage({ ...req, rid })
    })
  }

  private receive(reply: WorkerReply): void {
    const p = this.pending.get(reply.rid)
    this.pending.delete(reply.rid)
    if (!p) return
    if (reply.ok) p.resolve({ result: reply.result, delta: reply.delta, info: reply.info })
    else p.reject(new Error(reply.error))
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }

  dispose(): void {
    this.worker.terminate()
    this.failAll(new Error('Engine worker terminated'))
  }
}
