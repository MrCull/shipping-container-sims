/** Process entry point for the run diff: `npm run tt:diff -- --help`. */
import { runDiffCli } from './diffCli'

process.exitCode = runDiffCli(process.argv.slice(2))
