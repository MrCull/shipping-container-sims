/** Process entry point for golden checks/updates: `pnpm run tt:golden --help`. */
import { runGoldenCli } from './golden'

process.exitCode = runGoldenCli(process.argv.slice(2))
