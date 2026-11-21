/** Process entry point for the crane plan printer: `pnpm run tt:plan --help`. */
import { runPlanCli } from './planCli'

process.exitCode = runPlanCli(process.argv.slice(2))
