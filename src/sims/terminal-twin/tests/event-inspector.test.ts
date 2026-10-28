/**
 * Event inspector model (TT-18): payload, subject links and, for decision
 * events, the handler's request and reply, built from real engine events.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { describeEvent } from '../modules/eventInspector'

const sim = createSimulation(fixtures['shc-1sts-2shc-1wtp'])
sim.runUntil()
const log = sim.eventLog()

describe('describeEvent', () => {
  it('lists subjects as selectable ids by kind and pretty-prints the payload without bulky motion segments', () => {
    const picked = log.find((e) => e.type === 'StsPicked')!
    const d = describeEvent(picked)
    expect(d.id).toBe(picked.id)
    expect(d.subjects).toContainEqual({ kind: 'container', id: picked.subjects.containers![0] })
    expect(d.subjects).toContainEqual({ kind: 'equipment', id: picked.subjects.equipment![0] })
    expect(JSON.parse(d.payloadJson)).toMatchObject({ stsId: expect.any(String), containerId: picked.subjects.containers![0] })
    expect(d.decision).toBeNull()
  })

  it('a resolved decision shows the decision point, handler, outcome, request and reply', () => {
    const resolved = log.find((e) => e.type === 'DecisionResolved' && (e.payload as { decisionPoint: string }).decisionPoint === 'shcDispatch')!
    const d = describeEvent(resolved)
    expect(d.decision).not.toBeNull()
    expect(d.decision!.decisionPoint).toBe('shcDispatch')
    expect(d.decision!.correlationId).toMatch(/^shcDispatch-\d+$/)
    expect(d.decision!.handler).toMatch(/^strategy:/)
    expect(d.decision!.outcome).toBe('ok')
    expect(JSON.parse(d.decision!.replyJson!)).toEqual((resolved.payload as { reply: unknown }).reply)
    expect(JSON.parse(d.decision!.requestJson!)).toEqual((resolved.payload as { request: unknown }).request)
  })

  it('a decision request shows the request and no reply yet', () => {
    const requested = log.find((e) => e.type === 'DecisionRequested')!
    const d = describeEvent(requested)
    expect(d.decision!.requestJson).not.toBeNull()
    expect(d.decision!.replyJson).toBeNull()
  })
})
