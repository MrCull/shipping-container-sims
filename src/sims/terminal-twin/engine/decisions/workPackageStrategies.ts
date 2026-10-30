/**
 * Built-in workPackageRelease strategies (TT-10). Pure: request in, reply out.
 */
import type { WorkPackageReleaseReply, WorkPackageReleaseRequest } from './types'

/** Released packages that are not complete (the active one included). */
const openCount = (req: WorkPackageReleaseRequest): number =>
  req.packages.filter((p) => p.status === 'released' || p.status === 'active').length

/**
 * Keep `k` packages released AHEAD of the active one: with a package active the
 * crane has k + 1 open packages; with none active (it is about to start the
 * first released one) it has k + 1 as well, so the first call releases k + 1.
 */
export function keepKAheadRelease(req: WorkPackageReleaseRequest): WorkPackageReleaseReply {
  const want = req.k + 1 - openCount(req)
  const planned = req.packages.filter((p) => p.status === 'planned')
  return { packageIds: want > 0 ? planned.slice(0, want).map((p) => p.packageId) : [] }
}

/** Release one package only when the crane has none left to work. */
export function justInTimeRelease(req: WorkPackageReleaseRequest): WorkPackageReleaseReply {
  if (openCount(req) > 0) return { packageIds: [] }
  const next = req.packages.find((p) => p.status === 'planned')
  return { packageIds: next ? [next.packageId] : [] }
}
