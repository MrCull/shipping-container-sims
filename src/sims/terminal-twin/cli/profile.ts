/** Process entry point for the profiler: `pnpm run tt:profile --help`. */
import { runProfileCli } from './profileCli'

process.exitCode = runProfileCli(process.argv.slice(2))
