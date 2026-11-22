// Run: node --test scripts/test-smoke-server.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { smokeDevServer, smokeProdServer } from './smoke-server.mjs'

const opts = { port: 5199, vite: 'VITE' }

test('with no environment variables (local or CI) the dev project serves the smoke build: build it, then vite preview', () => {
  for (const env of [{}, { CI: 'true' }]) {
    const s = smokeDevServer(env, opts)
    assert.equal(s.mode, 'build')
    assert.equal(s.buildDir, '.smoke-build')
    assert.equal(
      s.command,
      'VITE build --mode smoke --outDir .smoke-build --emptyOutDir --logLevel warn && VITE preview --outDir .smoke-build --host 127.0.0.1 --port 5199 --strictPort',
    )
    assert.equal(s.url, 'http://127.0.0.1:5199')
  }
})

test('SMOKE_SERVER=dev is the explicit opt-in to the Vite dev server (hot reload), locally or in CI', () => {
  for (const env of [{ SMOKE_SERVER: 'dev' }, { CI: 'true', SMOKE_SERVER: 'dev' }]) {
    const s = smokeDevServer(env, opts)
    assert.equal(s.mode, 'dev')
    assert.equal(s.command, 'VITE --host 127.0.0.1 --port 5199 --strictPort')
  }
})

test('SMOKE_SERVER=build picks the smoke build explicitly', () => {
  assert.equal(smokeDevServer({ SMOKE_SERVER: 'build' }, opts).mode, 'build')
})

test('SMOKE_BUILD_PREBUILT=1 serves an existing smoke build without rebuilding (a CI shard handed the artifact)', () => {
  const s = smokeDevServer({ SMOKE_BUILD_PREBUILT: '1', SMOKE_BUILD_DIR: 'out/smoke' }, opts)
  assert.equal(s.buildDir, 'out/smoke')
  assert.equal(s.command, 'VITE preview --outDir out/smoke --host 127.0.0.1 --port 5199 --strictPort')
})

test('an unknown SMOKE_SERVER value is an error, not a silent fallback', () => {
  assert.throws(() => smokeDevServer({ SMOKE_SERVER: 'prod' }, opts), /SMOKE_SERVER must be "dev" or "build"/)
})

test('the prod project builds the production bundle into .smoke-dist, then serves it', () => {
  const s = smokeProdServer({}, opts)
  assert.equal(s.url, 'http://127.0.0.1:5199')
  assert.equal(
    s.command,
    'VITE build --outDir .smoke-dist --emptyOutDir --logLevel warn && VITE preview --outDir .smoke-dist --host 127.0.0.1 --port 5199 --strictPort',
  )
})

test('SMOKE_PROD_PREBUILT=1 serves an existing production build (a CI shard handed the artifact)', () => {
  const s = smokeProdServer({ SMOKE_PROD_PREBUILT: '1', SMOKE_PROD_DIR: 'out/prod' }, opts)
  assert.equal(s.command, 'VITE preview --outDir out/prod --host 127.0.0.1 --port 5199 --strictPort')
})
