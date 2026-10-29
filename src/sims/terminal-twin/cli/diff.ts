/** Process entry point for the run diff: `pnpm run tt:diff --help`. */
import { runDiffCli } from './diffCli'

process.exitCode = runDiffCli(process.argv.slice(2))
