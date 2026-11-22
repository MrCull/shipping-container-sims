/** Process entry point for the experiment runner: `pnpm run tt:experiment --help`. */
import { runExperimentCli } from './experimentCli'

process.exitCode = runExperimentCli(process.argv.slice(2))
