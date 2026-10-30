/**
 * Discrete-event priority queue: a binary min-heap over a plain array
 * (so it is JSON-serialisable inside SimState). Order: time, then event id
 * (= scheduling order), which makes same-time events deterministic.
 */
import type { EngineEvent } from './events'

function before(a: EngineEvent, b: EngineEvent): boolean {
  return a.t < b.t || (a.t === b.t && a.id < b.id)
}

export function heapPush(heap: EngineEvent[], ev: EngineEvent): void {
  heap.push(ev)
  let i = heap.length - 1
  while (i > 0) {
    const parent = (i - 1) >> 1
    if (!before(heap[i], heap[parent])) break
    ;[heap[i], heap[parent]] = [heap[parent], heap[i]]
    i = parent
  }
}

export function heapPop(heap: EngineEvent[]): EngineEvent | undefined {
  if (heap.length === 0) return undefined
  const top = heap[0]
  const last = heap.pop() as EngineEvent
  if (heap.length > 0) {
    heap[0] = last
    let i = 0
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let m = i
      if (l < heap.length && before(heap[l], heap[m])) m = l
      if (r < heap.length && before(heap[r], heap[m])) m = r
      if (m === i) break
      ;[heap[i], heap[m]] = [heap[m], heap[i]]
      i = m
    }
  }
  return top
}
