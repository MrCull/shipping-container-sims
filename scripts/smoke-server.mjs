// Which server the Playwright `dev` smoke project runs against (playwright.config.ts). Test: node --test scripts/test-smoke-server.mjs
//
// - `build` (the default, locally and in CI): the smoke build, a bundled production build made with
//   `vite build --mode smoke`, which keeps the dev API (`window.__tt`, the `?viewer=` asset viewer), served statically by
//   `vite preview`. Local runs and CI serve the same bundle, so a spec that passes locally passes in CI (hashed asset
//   names such as `hero-shc-<hash>.glb` included).
// - `dev`: the Vite dev server (unbundled modules, hot reload; slow page boots, no build step). Opt-in only, for
//   debugging a spec while editing the app.
//
// SMOKE_SERVER=dev|build picks the server explicitly. SMOKE_BUILD_DIR (default `.smoke-build`) is the build's directory;
// SMOKE_BUILD_PREBUILT=1 serves that directory as it is (built earlier with `pnpm run build:smoke`, or handed to a CI
// shard as an artifact) instead of rebuilding it.

/**
 * @param {Record<string, string | undefined>} env
 * @param {{ port: number, vite: string }} opts
 * @returns {{ mode: 'dev' | 'build', buildDir: string, command: string, url: string }}
 */
export function smokeDevServer(env, { port, vite }) {
  const mode = env.SMOKE_SERVER || 'build'
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

/**
 * The `prod` smoke project's server: a production build (no dev API) into SMOKE_PROD_DIR (default `.smoke-dist`),
 * served by `vite preview`. SMOKE_PROD_PREBUILT=1 serves that directory as it is (built once by the CI build job and
 * handed to every shard, which starts both servers whatever specs it runs).
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ port: number, vite: string }} opts
 * @returns {{ dir: string, command: string, url: string }}
 */
export function smokeProdServer(env, { port, vite }) {
  const dir = env.SMOKE_PROD_DIR || '.smoke-dist'
  const preview = `${vite} preview --outDir ${dir} --host 127.0.0.1 --port ${port} --strictPort`
  const command = env.SMOKE_PROD_PREBUILT === '1' ? preview : `${vite} build --outDir ${dir} --emptyOutDir --logLevel warn && ${preview}`
  return { dir, command, url: `http://127.0.0.1:${port}` }
}
