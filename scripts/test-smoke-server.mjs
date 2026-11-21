// Run: node --test scripts/test-smoke-server.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { smokeDevServer } from './smoke-server.mjs'

const opts = { port: 5199, vite: 'VITE' }

test('locally (no CI, no SMOKE_SERVER) the dev project uses the Vite dev server', () => {
  const s = smokeDevServer({}, opts)
  assert.equal(s.mode, 'dev')
  assert.equal(s.command, 'VITE --host 127.0.0.1 --port 5199 --strictPort')
  assert.equal(s.url, 'http://127.0.0.1:5199')
})

test('in CI the dev project serves the smoke build: build it, then vite preview on its directory', () => {
  const s = smokeDevServer({ CI: 'true' }, opts)
  assert.equal(s.mode, 'build')
  assert.equal(s.buildDir, '.smoke-build')
  assert.equal(
    s.command,
    'VITE build --mode smoke --outDir .smoke-build --emptyOutDir --logLevel warn && VITE preview --outDir .smoke-build --host 127.0.0.1 --port 5199 --strictPort',
  )
  assert.equal(s.url, 'http://127.0.0.1:5199')
})

test('SMOKE_SERVER picks the mode explicitly, overriding CI', () => {
  assert.equal(smokeDevServer({ SMOKE_SERVER: 'build' }, opts).mode, 'build')
  assert.equal(smokeDevServer({ CI: 'true', SMOKE_SERVER: 'dev' }, opts).mode, 'dev')
})

test('SMOKE_BUILD_PREBUILT=1 serves an existing smoke build without rebuilding (a CI shard handed the artifact)', () => {
  const s = smokeDevServer({ SMOKE_SERVER: 'build', SMOKE_BUILD_PREBUILT: '1', SMOKE_BUILD_DIR: 'out/smoke' }, opts)
  assert.equal(s.buildDir, 'out/smoke')
  assert.equal(s.command, 'VITE preview --outDir out/smoke --host 127.0.0.1 --port 5199 --strictPort')
})

test('an unknown SMOKE_SERVER value is an error, not a silent fallback', () => {
  assert.throws(() => smokeDevServer({ SMOKE_SERVER: 'prod' }, opts), /SMOKE_SERVER must be "dev" or "build"/)
})
