/** Process entry point for the engine benchmark: `pnpm run tt:bench --help` lives in `benchCli.ts`. */
import { benchMain } from './benchCli'

process.exitCode = benchMain(process.argv.slice(2))
