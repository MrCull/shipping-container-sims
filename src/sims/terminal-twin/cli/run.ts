/** Process entry point for the headless runner: `npm run tt:run -- --help`. */
import { runCli } from './runCli'

process.exitCode = runCli(process.argv.slice(2))
