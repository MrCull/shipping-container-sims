/** Process entry point for the headless runner: `pnpm run tt:run --help`. */
import { runCli } from './runCli'

process.exitCode = runCli(process.argv.slice(2))
