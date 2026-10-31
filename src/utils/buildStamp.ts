/** Formatting for the build stamp shown on the main menu (values come from Vite `define`, see vite.config.ts). */

export const COMMIT_URL_BASE = 'https://github.com/MrCull/shipping-container-sims/commit/'

export interface BuildStampInput {
  /** ISO build time. */
  buildTime: string
  /** Short commit hash; empty, undefined or "unknown" when git was unavailable at build time. */
  commit: string | undefined
  isDev: boolean
}

export interface BuildStamp {
  text: string
  commit: string | null
  commitUrl: string | null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad2 = (n: number): string => String(n).padStart(2, '0')

export function formatBuildStamp(input: BuildStampInput): BuildStamp {
  const date = new Date(input.buildTime)
  if (input.isDev || Number.isNaN(date.getTime())) {
    return { text: 'dev', commit: null, commitUrl: null }
  }
  const text = `Built ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  const commit = input.commit?.trim()
  if (!commit || commit === 'unknown') {
    return { text, commit: null, commitUrl: null }
  }
  return { text, commit, commitUrl: `${COMMIT_URL_BASE}${commit}` }
}
