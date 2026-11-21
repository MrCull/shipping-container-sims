/** Types for smoke-server.mjs (imported by playwright.config.ts). */
export function smokeDevServer(
  env: Record<string, string | undefined>,
  opts: { port: number; vite: string },
): { mode: 'dev' | 'build'; buildDir: string; command: string; url: string }
