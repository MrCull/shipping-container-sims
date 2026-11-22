/**
 * One `tt:experiment --jobs N` worker process (forked by `experimentCli.ts` with the tsx loader): receives replicate
 * plans over IPC, runs each headless (`executeReplicateHeadless`) and sends back `{ index, result }`, one at a time.
 */
import { executeReplicateHeadless, executeSafely, type ReplicatePlan } from './experiment'

process.on('message', (msg: { index: number; plan: ReplicatePlan }) => {
  const result = executeSafely(executeReplicateHeadless, msg.plan)
  process.send?.({ index: msg.index, result })
})
