/** Types for smoke-server.mjs (imported by playwright.config.ts). */
export function smokeDevServer(
  env: Record<string, string | undefined>,
  opts: { port: number; vite: string },
): { mode: 'dev' | 'build'; buildDir: string; command: string; url: string }
export function smokeProdServer(
  env: Record<string, string | undefined>,
  opts: { port: number; vite: string },
): { dir: string; command: string; url: string }
