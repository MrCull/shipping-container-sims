/** Process entry point for the frame-rate baseline: `pnpm run tt:baseline` (options in `baseline.ts`). */
import { baselineMain } from './baseline'

process.exitCode = await baselineMain(process.argv.slice(2))
