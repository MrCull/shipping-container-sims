/** Process entry point for golden checks/updates: `npm run tt:golden -- --help`. */
import { runGoldenCli } from './golden'

process.exitCode = runGoldenCli(process.argv.slice(2))
