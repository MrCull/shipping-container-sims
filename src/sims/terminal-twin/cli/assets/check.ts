/** Process entry point for the asset budget check: `npm run tt:assets:check -- --help`. */
import { runBudgetCli } from './budgetCheck'

process.exitCode = runBudgetCli(process.argv.slice(2))
