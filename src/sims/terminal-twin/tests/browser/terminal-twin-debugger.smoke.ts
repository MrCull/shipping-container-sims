/**
 * TT-18 browser smoke tests: breakpoints, single-step, cause chain, click
 * selection, follow camera, feed throttling and the live overlays, driven by
 * the dev-only `window.__tt` API plus real clicks. Run with `pnpm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import type { EngineEvent } from '../../engine'
import type {} from '../../dev/devApi' // window.__tt typing

const FIXTURE = 'shc-1sts-2shc-1wtp'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

async function open(page: Page, fixture = FIXTURE): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((name) => window.__tt!.load(name), fixture)
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
}

test('a breakpoint on an event type pauses playback exactly at that event and the inspector shows it', async ({ page }) => {
  const errors = collectErrors(page)
  await open(page)
  await page.keyboard.press('e')
  await expect(page.getByTestId('tt-feed-filter')).toBeVisible()

  // Through the UI: pick the kind, type the value, add.
  await page.getByTestId('tt-bp-kind').selectOption('eventType')
  await page.getByTestId('tt-bp-value').fill('ShcRoutingLoaded')
  await page.getByTestId('tt-bp-add').click()
  await expect(page.getByTestId('tt-bp-list')).toContainText('eventType:ShcRoutingLoaded')

  await page.evaluate(() => window.__tt!.setSpeed(600))
  await page.waitForFunction(() => window.__tt!.debug().breakHit !== null)

  const hit = await page.evaluate(() => window.__tt!.debug())
  expect(hit.breakHit!.event.type).toBe('ShcRoutingLoaded')
  expect(hit.paused).toBe(true)
  const clock = await page.evaluate(() => window.__tt!.clock())
  expect(clock.displayTime).toBe(hit.breakHit!.event.t)
  expect(clock.engine!.now).toBe(hit.breakHit!.event.t)
  const log = await page.evaluate(() => window.__tt!.query<{ id: number }[]>('eventLog'))
  expect(log[log.length - 1].id).toBe(hit.breakHit!.event.id)

  await expect(page.getByTestId('tt-break-hit')).toContainText('ShcRoutingLoaded')
  await expect(page.getByTestId('tt-event-heading')).toContainText(`#${hit.breakHit!.event.id}`)
  await expect(page.getByTestId('tt-event-heading')).toContainText('ShcRoutingLoaded')

  // Continue runs on to the next hit.
  await page.getByTestId('tt-continue').click()
  await page.waitForFunction((id) => {
    const h = window.__tt!.debug().breakHit
    return h !== null && h.event.id !== id
  }, hit.breakHit!.event.id)
  expect(errors).toEqual([])
})

test('breakpoints on container, equipment and decision point stop at matching events', async ({ page }) => {
  await open(page)
  const boxes = await page.evaluate(() => window.__tt!.query<{ id: string }[]>('containers'))
  const cases: { kind: 'container' | 'equipment' | 'decision'; value: string; check: (e: EngineEvent) => boolean }[] = [
    { kind: 'container', value: boxes[2].id, check: (e) => e.subjects.containers?.includes(boxes[2].id) ?? false },
    // SHC01 only: with the default oldest-job dispatch the first idle SHC takes every job, so SHC02 has no events in this fixture.
    { kind: 'equipment', value: 'SHC01', check: (e) => e.subjects.equipment?.includes('SHC01') ?? false },
    { kind: 'decision', value: 'shcDispatch', check: (e) => e.type.startsWith('Decision') && (e.payload as { decisionPoint: string }).decisionPoint === 'shcDispatch' },
  ]
  for (const c of cases) {
    await page.evaluate(
      async ({ kind, value }) => {
        await window.__tt!.reset()
        await window.__tt!.clearBreakpoints()
        await window.__tt!.addBreakpoint(kind, value)
        await window.__tt!.runTo(1e5)
      },
      { kind: c.kind, value: c.value },
    )
    const hitId = await page.evaluate(() => window.__tt!.debug().breakHit!.event.id)
    const chain = await page.evaluate((id) => window.__tt!.why(id), hitId)
    expect(c.check(chain[0]), `${c.kind} breakpoint stopped at ${chain[0].type}`).toBe(true)
  }
})

test('single-step processes exactly one event per press at any speed setting', async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.__tt!.setSpeed(600))
  await page.evaluate(() => window.__tt!.pause())
  for (let i = 0; i < 4; i++) {
    const before = await page.evaluate(() => window.__tt!.clock().engine!.eventsTotal)
    await page.getByTestId('tt-topbar-step').click()
    await page.waitForFunction((n) => window.__tt!.clock().engine!.eventsTotal === n + 1 && !window.__tt!.clock().busy, before)
    const after = await page.evaluate(() => window.__tt!.clock())
    expect(after.engine!.eventsTotal).toBe(before + 1)
    expect(after.paused).toBe(true)
  }
  // The '.' shortcut is the same single step.
  const before = await page.evaluate(() => window.__tt!.clock().engine!.eventsTotal)
  await page.keyboard.press('.')
  await page.waitForFunction((n) => window.__tt!.clock().engine!.eventsTotal === n + 1, before)
})

test('the cause chain reaches the root event and equals the engine why; each link can be inspected', async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'ShcDroppedAtWtp' }))
  const log = await page.evaluate(() => window.__tt!.query<{ id: number; type: string }[]>('eventLog'))
  const target = log[log.length - 1]
  await page.evaluate((id) => window.__tt!.inspectEvent(id), target.id)
  await page.keyboard.press('i').catch(() => {})
  const ui = await page.evaluate(() => window.__tt!.ui())
  if (!ui.inspectorOpen) await page.keyboard.press('i')

  const why = await page.evaluate((id) => window.__tt!.why(id), target.id)
  const debug = await page.evaluate(() => window.__tt!.debug())
  expect(debug.inspectedEvent!.chain.map((e) => e.id)).toEqual(why.map((e) => e.id))
  expect(debug.inspectedEvent!.chain.at(-1)!.type).toBe('ScenarioStarted')

  const rows = page.getByTestId('tt-cause-chain').locator('button')
  await expect(rows).toHaveCount(why.length)
  // Click through to the root.
  await rows.last().click()
  await expect(page.getByTestId('tt-event-heading')).toContainText('ScenarioStarted')
  await expect(page.getByTestId('tt-event-payload')).toContainText('seed')
  // And back to the first link.
  await rows.first().click()
  await expect(page.getByTestId('tt-event-heading')).toContainText(target.type)
})

test('a decision event shows the handler, its request and its reply', async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'DecisionResolved' }))
  const log = await page.evaluate(() => window.__tt!.query<{ id: number; type: string }[]>('eventLog'))
  await page.evaluate((id) => window.__tt!.inspectEvent(id), log[log.length - 1].id)
  const decision = page.getByTestId('tt-decision')
  await expect(decision).toContainText('strategy:')
  await expect(page.getByTestId('tt-decision-request')).toBeVisible()
  await expect(page.getByTestId('tt-decision-reply')).toBeVisible()
})

test('Esc closes one thing per press, in order, the inspector included; it never pauses, steps or changes speed (#169)', async ({ page }) => {
  const errors = collectErrors(page)
  await open(page)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'ShcDroppedAtWtp' }))
  await page.evaluate(() => window.__tt!.setSpeed(60)) // a speed resumes playback, so pause after it
  await page.evaluate(() => window.__tt!.pause())
  const ui = () => page.evaluate(() => window.__tt!.ui())
  const clockNow = () => page.evaluate(() => window.__tt!.clock())
  const before = await clockNow()

  // Open in turn: a selection (its inspector comes with it), Colour by and Run to (opened by a click, so focus stays on
  // their buttons, outside the popups), shortcut help, and the dashboard (B).
  await page.evaluate(() => window.__tt!.select('SHC01'))
  await expect.poll(async () => (await ui()).inspectorOpen).toBe(true)
  await page.getByTestId('tt-colour-by').click()
  await expect(page.getByTestId('tt-colour-by-panel')).toBeVisible()
  await page.getByRole('button', { name: 'Run to…' }).click()
  await expect(page.getByLabel('Target sim time')).toBeVisible()
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  await page.keyboard.press('b')
  await expect.poll(async () => (await ui()).dashboardOpen).toBe(true)
  await expect.poll(ui).toMatchObject({ dashboardOpen: true, colourByOpen: true, runToOpen: true, helpOpen: true, inspectorOpen: true, selectedId: 'SHC01' })

  // One press each: dialog, then popups, then help, then the inspector, then the selection.
  const steps: { closes: string; state: Record<string, unknown> }[] = [
    { closes: 'dashboard', state: { dashboardOpen: false, colourByOpen: true, runToOpen: true, helpOpen: true, inspectorOpen: true, selectedId: 'SHC01' } },
    { closes: 'Colour by', state: { colourByOpen: false, runToOpen: true, helpOpen: true, inspectorOpen: true, selectedId: 'SHC01' } },
    { closes: 'Run to', state: { runToOpen: false, helpOpen: true, inspectorOpen: true, selectedId: 'SHC01' } },
    { closes: 'help', state: { helpOpen: false, inspectorOpen: true, selectedId: 'SHC01' } },
    { closes: 'inspector', state: { inspectorOpen: false, selectedId: 'SHC01' } },
    { closes: 'selection', state: { selectedId: null, inspectorOpen: false } },
  ]
  for (const step of steps) {
    await page.keyboard.press('Escape')
    await expect.poll(ui, `Esc closes ${step.closes}`).toMatchObject(step.state)
    expect(await clockNow(), `Esc closing ${step.closes} leaves the run alone`).toEqual(before)
  }
  // Nothing left open: Esc does nothing more.
  await page.keyboard.press('Escape')
  expect(await ui()).toMatchObject({ selectedId: null, inspectorOpen: false, helpOpen: false, dashboardOpen: false })
  expect(await clockNow()).toEqual(before)

  // Typing in a field does not trigger Esc: the feed filter keeps the inspector and the selection.
  await page.evaluate(() => window.__tt!.select('SHC01'))
  await page.keyboard.press('e')
  await expect(page.getByTestId('tt-feed-filter')).toBeVisible()
  await page.getByTestId('tt-feed-filter').focus()
  await page.keyboard.press('Escape')
  expect(await ui()).toMatchObject({ selectedId: 'SHC01', inspectorOpen: true })
  expect(await clockNow()).toEqual(before)
  expect(errors).toEqual([])
})

test('clicking a container in 3D selects it and shows its custody history', async ({ page }) => {
  const errors = collectErrors(page)
  await open(page)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'ShcDroppedAtWtp' }))
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 3)
  // A box that is on screen and not hidden behind another one.
  const target = await page.evaluate(() => {
    const state = window.__tt!.sceneState()!
    for (const id of Object.keys(state.containers)) {
      const p = window.__tt!.screenPoint(id)
      if (p && window.__tt!.pickAt(p.x, p.y) === id && state.containers[id]?.kind !== 'vesselSlot') return { id, ...p }
    }
    return null
  })
  expect(target, 'a pickable box in view').not.toBeNull()
  await page.mouse.click(target!.x, target!.y)
  await expect.poll(() => page.evaluate(() => window.__tt!.ui().selectedId)).toBe(target!.id)
  await expect(page.getByTestId('tt-entity-heading')).toContainText(target!.id)
  const history = page.getByTestId('tt-custody-history').locator('li')
  expect(await history.count()).toBeGreaterThanOrEqual(2)
  await expect(history.last()).toContainText('now')
  // The shown history is the engine's, including the first custody (vessel slot, shown in maritime notation).
  await expect(history.first()).toContainText('VESSEL.V')
  const box = await page.evaluate((id) => window.__tt!.query<{ custodyHistory: unknown[] }>('container', id), target!.id)
  expect(await history.count()).toBe(box.custodyHistory.length)
  // Derived, never stored (#109): a box set down on a WTP pad is on the terminal, and the tooltip carries the same facts.
  const facts = page.getByTestId('tt-entity-inspector').locator('dl.facts').first()
  await expect(facts).toContainText('Transit status')
  await expect(facts).toContainText('On terminal')
  await expect(facts).toContainText('Content status')
  await expect(facts).toContainText('Dwell on terminal')
  const tip = await page.getByTestId('tt-entity-heading').getAttribute('title')
  expect(tip).toContain('Transit status: On terminal')
  expect(tip).toContain('Dwell on terminal:')

  // A click on empty sky deselects.
  const sky = await page.evaluate(() => {
    for (let y = 130; y < 700; y += 40) for (let x = 440; x < 840; x += 40) if (window.__tt!.pickAt(x, y) === null && document.elementFromPoint(x, y)?.tagName === 'CANVAS') return { x, y } // on the 3D canvas, not a panel over it
    return null
  })
  expect(sky, 'an empty spot in the view').not.toBeNull()
  await page.mouse.click(sky!.x, sky!.y)
  await expect.poll(() => page.evaluate(() => window.__tt!.ui().selectedId)).toBeNull()
  expect(errors).toEqual([])
})

test('the follow camera tracks a moving SHC smoothly', async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'ShcRoutingLoaded' }))
  const shcId = await page.evaluate(() => {
    const state = window.__tt!.sceneState()!
    return Object.entries(state.shcs).find(([, s]) => s.status !== 'parked')?.[0] ?? Object.keys(state.shcs)[0]
  })
  await page.evaluate((id) => window.__tt!.select(id), shcId)
  await expect(page.getByTestId('tt-follow')).toBeVisible()
  await page.getByTestId('tt-follow').click()
  expect((await page.evaluate(() => window.__tt!.ui())).following).toBe(true)

  await page.evaluate(() => window.__tt!.setSpeed(10))
  const samples: { dx: number; dz: number; jump: number; moved: number }[] = []
  let prev: { x: number; z: number } | null = null
  let start: { x: number; z: number } | null = null
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(120)
    const s = await page.evaluate((id) => ({ cam: window.__tt!.cameraPose()!.target, shc: window.__tt!.sceneState()!.shcs[id] }), shcId)
    start ??= { x: s.shc.x, z: s.shc.z }
    samples.push({
      dx: Math.abs(s.cam.x - s.shc.x),
      dz: Math.abs(s.cam.z - s.shc.z),
      jump: prev ? Math.hypot(s.cam.x - prev.x, s.cam.z - prev.z) : 0,
      moved: Math.hypot(s.shc.x - start.x, s.shc.z - start.z),
    })
    prev = { x: s.cam.x, z: s.cam.z }
  }
  // The carrier moved, the camera stayed on it, and never jumped.
  expect(Math.max(...samples.map((s) => s.moved))).toBeGreaterThan(10)
  expect(Math.max(...samples.map((s) => s.dx))).toBeLessThan(6)
  expect(Math.max(...samples.map((s) => s.dz))).toBeLessThan(6)
  expect(Math.max(...samples.map((s) => s.jump))).toBeLessThan(40)
})

test('at x600 the feed stays capped, summarises bursts and refreshes at a throttled rate', async ({ page }) => {
  const errors = collectErrors(page)
  await open(page)
  await page.keyboard.press('e')
  await expect(page.getByTestId('tt-feed-rows')).toBeAttached()
  await page.evaluate(() => {
    const target = document.querySelector('[data-testid="tt-feed-rows"]')!
    const w = window as unknown as { __feedBatches: number }
    w.__feedBatches = 0
    new MutationObserver(() => w.__feedBatches++).observe(target, { childList: true, subtree: true, characterData: true })
  })
  await page.evaluate(() => window.__tt!.setSpeed(600))
  await page.waitForTimeout(2500)
  await expect(page.getByTestId('tt-feed-summarised')).toBeVisible()
  const rowCount = await page.getByTestId('tt-feed-rows').locator('li').count()
  expect(rowCount).toBeGreaterThan(0)
  expect(rowCount).toBeLessThanOrEqual(150)
  const batches = await page.evaluate(() => (window as unknown as { __feedBatches: number }).__feedBatches)
  // 250 ms refresh: at most ~4 per second (plus a little slack), however many events arrive.
  expect(batches).toBeLessThanOrEqual(14)
  // The view kept animating and the feed memory stayed capped.
  expect((await page.evaluate(() => window.__tt!.scene()))!.frames).toBeGreaterThan(5)
  expect(errors).toEqual([])
})

test('each overlay toggles independently and reflects live engine state', async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'ShcDroppedAtWtp' }))
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 3)

  const keys = ['laneGraph', 'reservations', 'occupancy', 'labels'] as const
  for (const key of keys) {
    const state = await page.evaluate((k) => window.__tt!.overlays({ laneGraph: false, reservations: false, occupancy: false, labels: false, [k]: true }), key)
    expect(Object.entries(state).filter(([, on]) => on).map(([name]) => name)).toEqual([key])
  }

  // Occupancy: pads occupied in the overlay = boxes the scene has on pads.
  await page.evaluate(() => window.__tt!.overlays({ laneGraph: false, reservations: false, occupancy: true, labels: false }))
  await page.waitForFunction(() => window.__tt!.scene()!.layers.padsOccupied + window.__tt!.scene()!.layers.padsFree > 0)
  const occ = await page.evaluate(() => {
    const scene = window.__tt!.scene()!
    const state = window.__tt!.sceneState()!
    const onPads = Object.values(state.containers).filter((c) => c?.kind === 'wtpPad').length
    const onGp = Object.values(state.containers).filter((c) => c?.kind === 'groundPosition').length
    return { layers: scene.layers, onPads, onGp }
  })
  expect(occ.layers.padsOccupied).toBe(occ.onPads)
  expect(occ.layers.padsOccupied).toBeGreaterThan(0)
  expect(occ.layers.groundPositionsOccupied).toBe(occ.onGp)
  expect(occ.layers.labels).toBe(0)

  // Labels: one per crane, carrier and visible vessel; occupancy plates are off again. Declutter (#65) hides labels
  // that would overlap a higher-priority one, so visible + hidden = expected and no two visible boxes overlap.
  await page.evaluate(() => window.__tt!.overlays({ occupancy: false, labels: true }))
  await page.evaluate(() => window.__tt!.viewPreset('overview')) // every entity on screen: off-screen labels count as neither shown nor hidden
  await page.waitForFunction(() => window.__tt!.scene()!.layers.labels > 0)
  await page.waitForTimeout(500)
  const labels = await page.evaluate(() => {
    const scene = window.__tt!.scene()!
    const state = window.__tt!.sceneState()!
    const visibleVessels = Object.values(state.vessels).filter((v) => ['mooring', 'berthed', 'unmooring', 'at-anchorage'].includes(v.status)).length
    return { shown: scene.layers.labels, hidden: scene.layers.labelsHidden, boxes: scene.layers.labelBoxes, expected: scene.sts + scene.shcs + scene.ascs + visibleVessels, pads: scene.layers.padsOccupied + scene.layers.padsFree }
  })
  expect(labels.shown).toBeGreaterThan(0)
  expect(labels.shown + labels.hidden).toBe(labels.expected)
  expect(labels.boxes.length).toBe(labels.shown)
  for (let i = 0; i < labels.boxes.length; i++)
    for (let j = i + 1; j < labels.boxes.length; j++) {
      const a = labels.boxes[i]
      const b = labels.boxes[j]
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
      expect(apart, `${a.id} and ${b.id}`).toBe(true)
    }
  expect(labels.pads).toBe(0)

  // The O shortcut is the master switch: everything hidden, counts go to zero.
  await page.evaluate(() => window.__tt!.overlays({ occupancy: true, labels: true }))
  await page.keyboard.press('o')
  await page.waitForFunction(() => window.__tt!.scene()!.layers.labels === 0)
  await page.keyboard.press('o')
  await page.waitForFunction(() => window.__tt!.scene()!.layers.labels > 0)
})
