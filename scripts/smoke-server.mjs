// Which server the Playwright `dev` smoke project runs against (playwright.config.ts). Test: node --test scripts/test-smoke-server.mjs
//
// - `dev`: the Vite dev server (unbundled modules; slow page boots, but no build step). The local default.
// - `build`: the smoke build, a bundled production build made with `vite build --mode smoke`, which keeps the dev API
//   (`window.__tt`, the `?viewer=` asset viewer), served statically by `vite preview`. The CI default.
//
// SMOKE_SERVER=dev|build overrides the default. SMOKE_BUILD_DIR (default `.smoke-build`) is the build's directory;
// SMOKE_BUILD_PREBUILT=1 serves that directory as it is (built earlier with `pnpm run build:smoke`, or handed to a CI
// shard as an artifact) instead of rebuilding it.

/**
 * @param {Record<string, string | undefined>} env
 * @param {{ port: number, vite: string }} opts
 * @returns {{ mode: 'dev' | 'build', buildDir: string, command: string, url: string }}
 */
export function smokeDevServer(env, { port, vite }) {
  const mode = env.SMOKE_SERVER || (env.CI ? 'build' : 'dev')
  if (mode !== 'dev' && mode !== 'build') throw new Error(`SMOKE_SERVER must be "dev" or "build", got "${mode}"`)
  const buildDir = env.SMOKE_BUILD_DIR || '.smoke-build'
  const host = `--host 127.0.0.1 --port ${port} --strictPort`
  const url = `http://127.0.0.1:${port}`
  if (mode === 'dev') return { mode, buildDir, command: `${vite} ${host}`, url }
  const preview = `${vite} preview --outDir ${buildDir} ${host}`
  const command =
    env.SMOKE_BUILD_PREBUILT === '1' ? preview : `${vite} build --mode smoke --outDir ${buildDir} --emptyOutDir --logLevel warn && ${preview}`
  return { mode, buildDir, command, url }
}
