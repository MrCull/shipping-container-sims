<script setup lang="ts">
// Request/response inspector for Jev (plan 05 §5.3). Shows evidence sent and probabilities
// returned for each recorded exchange — never an invented rationale (skill rule). Reads
// `jevStore.history`, written by `useJevController.ts`.

import { computed, reactive } from 'vue'
import { useJevStore } from '../../store/jevStore'
import { confidenceLabel } from '../../modules/jev/jevSummaries'
import type { JevExchange, JevExchangeOutcome } from '../../types/jev'

const jev = useJevStore()

const expandedSent = reactive(new Set<number>())
const expandedReceived = reactive(new Set<number>())
const expandedRaw = reactive(new Set<number>())

function toggle(set: Set<number>, seq: number): void {
  if (set.has(seq)) set.delete(seq)
  else set.add(seq)
}

const totals = computed(() => {
  const history = jev.history
  const exchanges = history.length
  const executed = history.filter(e => e.outcome === 'executed').length
  const errors = history.filter(e => e.outcome === 'error').length
  const totalCost = history.reduce((sum, e) => sum + (e.costUsd ?? 0), 0)
  const withLatency = history.filter(e => typeof e.latencyMs === 'number')
  const avgLatencyMs = withLatency.length > 0
    ? withLatency.reduce((sum, e) => sum + (e.latencyMs ?? 0), 0) / withLatency.length
    : null
  return { exchanges, executed, errors, totalCost, avgLatencyMs }
})

const OUTCOME_ICON: Record<JevExchangeOutcome, string> = {
  pending: '…',
  executed: '✔',
  stale: '⏱',
  rejected: '⚠',
  error: '✖',
  cancelled: '⏹',
  paused_low_confidence: '⏸',
}

function outcomeIcon(outcome: JevExchangeOutcome): string {
  return OUTCOME_ICON[outcome] ?? '?'
}

function line1(exchange: JevExchange): string {
  const parts = [`#${exchange.seq}`, exchange.kind.toUpperCase()]
  if (exchange.choice) parts.push(exchange.choice)
  if (typeof exchange.confidence === 'number') {
    parts.push(`conf ${exchange.confidence.toFixed(2)} (${confidenceLabel(exchange.confidence)})`)
  }
  if (typeof exchange.latencyMs === 'number') parts.push(`${(exchange.latencyMs / 1000).toFixed(1)} s`)
  if (typeof exchange.costUsd === 'number') parts.push(`$${exchange.costUsd.toFixed(5)}`)

  const outcomeTail = exchange.outcome === 'executed'
    ? `${outcomeIcon('executed')} ${exchange.gameResult ? formatSignedPoints(exchange.gameResult.points) : ''}`.trim()
    : `${outcomeIcon(exchange.outcome)} ${exchange.outcome.replace(/_/g, ' ')}`

  parts.push(outcomeTail)
  return parts.join(' · ')
}

function formatSignedPoints(points: number): string {
  return points >= 0 ? `+${points}` : `${points}`
}

function outcomeMessage(exchange: JevExchange): string {
  if (exchange.outcome === 'executed' && exchange.gameResult) {
    const reasons = exchange.gameResult.reasons
    const disaster = exchange.gameResult.disaster ? ` — disaster: ${exchange.gameResult.disaster}` : ''
    return `${reasons.length > 0 ? reasons.join('; ') : 'No score reasons recorded.'}${disaster}`
  }
  if (exchange.outcome === 'error' && exchange.error) {
    return `${exchange.error.kind}: ${exchange.error.message}`
  }
  if (exchange.outcome === 'stale') return 'Discarded: the game moved on before the response arrived.'
  if (exchange.outcome === 'rejected') return "Discarded: the game rejected Jev's chosen slot."
  if (exchange.outcome === 'cancelled') return 'Cancelled by the player.'
  if (exchange.outcome === 'paused_low_confidence') return 'Paused: confidence was below the auto-play threshold.'
  return 'Waiting for a response…'
}

function optionEntries(exchange: JevExchange): Array<[string, string]> {
  const question = exchange.requestBody.questions.move
  if (!question) return []
  return Object.entries(question.criteria)
}

function stateField<T = unknown>(exchange: JevExchange, key: string): T | undefined {
  return exchange.requestBody.state[key] as T | undefined
}

/** Top 8 options by probability, chosen option first, the rest summed as "others". */
function probabilityBars(exchange: JevExchange): Array<{ slotId: string; p: number; chosen: boolean }> {
  const ranked = exchange.ranked ?? []
  const top = ranked.slice(0, 8).map(r => ({ slotId: r.slotId, p: r.p, chosen: r.slotId === exchange.choice }))
  if (!top.some(r => r.chosen) && exchange.choice) {
    const chosenEntry = ranked.find(r => r.slotId === exchange.choice)
    if (chosenEntry) top.unshift({ slotId: chosenEntry.slotId, p: chosenEntry.p, chosen: true })
  }
  return top
}

function othersSum(exchange: JevExchange): number {
  const ranked = exchange.ranked ?? []
  const shown = new Set(probabilityBars(exchange).map(r => r.slotId))
  return ranked.filter(r => !shown.has(r.slotId)).reduce((sum, r) => sum + r.p, 0)
}

/** Defence in depth: the key is never stored in a request/response body, but confirm before
 *  rendering or copying raw JSON anyway (skill rule — never let a key reach the UI). */
function hasAuthorizationField(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || typeof value !== 'object') return false
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key.toLowerCase() === 'authorization') return true
    if (hasAuthorizationField(nested, depth + 1)) return true
  }
  return false
}

function safeJson(value: unknown): { ok: true; text: string } | { ok: false; text: string } {
  if (hasAuthorizationField(value)) {
    return { ok: false, text: '[withheld: an "Authorization" field was found in this object]' }
  }
  try {
    return { ok: true, text: JSON.stringify(value, null, 2) }
  } catch {
    return { ok: false, text: '[could not stringify this object]' }
  }
}

async function copyJson(value: unknown): Promise<void> {
  const result = safeJson(value)
  if (!result.ok) return
  try {
    await navigator.clipboard.writeText(result.text)
  } catch {
    // Clipboard access can fail (permissions, insecure context) — non-fatal for an inspector tool.
  }
}

function close(): void {
  jev.closeInspector()
}
</script>

<template>
  <div
    v-if="jev.isInspectorOpen"
    class="jev-inspector"
  >
    <div class="inspector-header">
      <div class="header-top">
        <span class="header-title">Jev inspector</span>
        <button
          type="button"
          class="close-btn"
          title="Close"
          @click="close"
        >
          ✕
        </button>
      </div>
      <div class="header-totals">
        {{ totals.exchanges }} exchange{{ totals.exchanges === 1 ? '' : 's' }} ·
        {{ totals.executed }} executed ·
        {{ totals.errors }} error{{ totals.errors === 1 ? '' : 's' }} ·
        ${{ totals.totalCost.toFixed(4) }} total ·
        avg {{ totals.avgLatencyMs !== null ? (totals.avgLatencyMs / 1000).toFixed(1) + ' s' : '—' }}
      </div>
      <div class="header-row">
        <span class="reminder">Jev returns choices and probabilities, not explanations.</span>
        <button
          type="button"
          class="clear-btn"
          :disabled="jev.history.length === 0"
          @click="jev.clearHistory()"
        >
          Clear
        </button>
      </div>
    </div>

    <div class="inspector-list">
      <div
        v-if="jev.history.length === 0"
        class="empty-note"
      >
        No Jev exchanges yet this session.
      </div>

      <div
        v-for="exchange in jev.history"
        :key="exchange.seq"
        class="exchange-card"
        :class="`outcome-${exchange.outcome}`"
      >
        <div class="line1">
          {{ line1(exchange) }}
        </div>

        <button
          type="button"
          class="expand-btn"
          @click="toggle(expandedSent, exchange.seq)"
        >
          Sent {{ expandedSent.has(exchange.seq) ? '▾' : '▸' }}
        </button>
        <div
          v-if="expandedSent.has(exchange.seq)"
          class="expand-body"
        >
          <p class="summary-text">
            {{ exchange.requestSummary }}
          </p>
          <div class="kv-block">
            <div class="kv-title">
              Stability
            </div>
            <pre class="kv-pre">{{ JSON.stringify(stateField(exchange, 'stability'), null, 2) }}</pre>
          </div>
          <div class="kv-block">
            <div class="kv-title">
              Move
            </div>
            <pre class="kv-pre">{{ JSON.stringify(stateField(exchange, 'move'), null, 2) }}</pre>
          </div>
          <div class="kv-block">
            <div class="kv-title">
              Options ({{ optionEntries(exchange).length }})
            </div>
            <ul class="option-list">
              <li
                v-for="[slotId, description] in optionEntries(exchange)"
                :key="slotId"
              >
                <strong>{{ slotId }}</strong> — {{ description }}
              </li>
            </ul>
          </div>
        </div>

        <button
          type="button"
          class="expand-btn"
          @click="toggle(expandedReceived, exchange.seq)"
        >
          Received {{ expandedReceived.has(exchange.seq) ? '▾' : '▸' }}
        </button>
        <div
          v-if="expandedReceived.has(exchange.seq)"
          class="expand-body"
        >
          <p
            v-if="exchange.responseSummary"
            class="summary-text"
          >
            {{ exchange.responseSummary }}
          </p>
          <p
            v-else
            class="summary-text muted"
          >
            No response recorded.
          </p>
          <div
            v-for="bar in probabilityBars(exchange)"
            :key="bar.slotId"
            class="prob-row"
            :class="{ chosen: bar.chosen }"
          >
            <span class="prob-label">{{ bar.slotId }}</span>
            <span class="prob-bar-track">
              <span
                class="prob-bar-fill"
                :style="{ width: `${Math.round(bar.p * 100)}%` }"
              />
            </span>
            <span class="prob-value">{{ Math.round(bar.p * 100) }}%</span>
          </div>
          <div
            v-if="othersSum(exchange) > 0.001"
            class="prob-row prob-row--others"
          >
            <span class="prob-label">others</span>
            <span class="prob-bar-track">
              <span
                class="prob-bar-fill prob-bar-fill--others"
                :style="{ width: `${Math.round(othersSum(exchange) * 100)}%` }"
              />
            </span>
            <span class="prob-value">{{ Math.round(othersSum(exchange) * 100) }}%</span>
          </div>
          <div
            v-if="exchange.warnings && exchange.warnings.length > 0"
            class="warnings"
          >
            <span
              v-for="(w, i) in exchange.warnings"
              :key="i"
              class="warning-chip"
            >{{ w }}</span>
          </div>
        </div>

        <div class="outcome-line">
          {{ outcomeMessage(exchange) }}
        </div>

        <button
          type="button"
          class="expand-btn"
          @click="toggle(expandedRaw, exchange.seq)"
        >
          Raw JSON {{ expandedRaw.has(exchange.seq) ? '▾' : '▸' }}
        </button>
        <div
          v-if="expandedRaw.has(exchange.seq)"
          class="expand-body"
        >
          <div class="raw-block">
            <div class="raw-header">
              <span>Request</span>
              <button
                type="button"
                class="copy-btn"
                @click="copyJson(exchange.requestBody)"
              >
                Copy
              </button>
            </div>
            <pre class="raw-pre">{{ safeJson(exchange.requestBody).text }}</pre>
          </div>
          <div
            v-if="exchange.responseBody"
            class="raw-block"
          >
            <div class="raw-header">
              <span>Response</span>
              <button
                type="button"
                class="copy-btn"
                @click="copyJson(exchange.responseBody)"
              >
                Copy
              </button>
            </div>
            <pre class="raw-pre">{{ safeJson(exchange.responseBody).text }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.jev-inspector {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  width: 360px;
  max-width: 40vw;
  display: flex;
  flex-direction: column;
  background: rgba(8, 10, 16, 0.94);
  border-left: 1px solid rgba(255, 204, 0, 0.3);
  backdrop-filter: blur(4px);
  pointer-events: all;
  color: #eee;
}

@media (max-width: 700px) {
  .jev-inspector {
    top: auto;
    left: 0;
    right: 0;
    width: 100%;
    max-width: 100%;
    height: 60vh;
    border-left: none;
    border-top: 1px solid rgba(255, 204, 0, 0.3);
  }
}

.inspector-header {
  flex-shrink: 0;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-title {
  font-size: 12px;
  font-weight: bold;
  color: #ffcc00;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}

.close-btn {
  background: none;
  border: none;
  color: #888;
  font-size: 13px;
  cursor: pointer;
}

.close-btn:hover {
  color: #ffcc00;
}

.header-totals {
  margin-top: 6px;
  font-size: 10px;
  color: #9aa3b2;
  line-height: 1.5;
}

.header-row {
  margin-top: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.reminder {
  font-size: 9.5px;
  color: #8f96a3;
  font-style: italic;
}

.clear-btn {
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 5px;
  padding: 3px 8px;
  color: #eee;
  font-size: 10px;
  cursor: pointer;
}

.clear-btn:hover:not(:disabled) {
  border-color: #ffcc00;
}

.clear-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.inspector-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty-note {
  font-size: 11px;
  color: #777;
  padding: 12px 4px;
}

.exchange-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 8px;
  font-size: 10.5px;
}

.exchange-card.outcome-error,
.exchange-card.outcome-rejected {
  border-color: rgba(255, 68, 68, 0.35);
}

.exchange-card.outcome-executed {
  border-color: rgba(0, 255, 136, 0.25);
}

.line1 {
  font-family: var(--font-mono, monospace);
  color: #eee;
  margin-bottom: 6px;
  word-break: break-word;
}

.expand-btn {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: #ffcc00;
  font-size: 10px;
  padding: 3px 0;
  cursor: pointer;
}

.expand-btn:hover {
  color: #ffe066;
}

.expand-body {
  margin: 2px 0 6px;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
}

.summary-text {
  margin: 0 0 6px;
  color: #ccc;
  line-height: 1.4;
}

.summary-text.muted {
  color: #777;
  font-style: italic;
}

.kv-block {
  margin-bottom: 6px;
}

.kv-title {
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #8f96a3;
  margin-bottom: 2px;
}

.kv-pre,
.raw-pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 9.5px;
  color: #bcd;
  max-height: 180px;
  overflow-y: auto;
}

.option-list {
  margin: 0;
  padding-left: 14px;
  color: #ccc;
}

.option-list li {
  margin-bottom: 2px;
}

.prob-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}

.prob-label {
  width: 66px;
  flex-shrink: 0;
  font-family: var(--font-mono, monospace);
  font-size: 9.5px;
  color: #ccc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prob-bar-track {
  flex: 1;
  height: 8px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  overflow: hidden;
}

.prob-bar-fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #ffcc00, #ff9900);
}

.prob-bar-fill--others {
  background: rgba(255, 255, 255, 0.3);
}

.prob-row.chosen .prob-label {
  color: #ffcc00;
  font-weight: bold;
}

.prob-value {
  width: 32px;
  flex-shrink: 0;
  text-align: right;
  font-size: 9.5px;
  color: #999;
}

.warnings {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.warning-chip {
  font-size: 9px;
  color: #ffaa00;
  background: rgba(255, 170, 0, 0.12);
  border: 1px solid rgba(255, 170, 0, 0.3);
  border-radius: 3px;
  padding: 1px 5px;
}

.outcome-line {
  font-size: 10px;
  color: #aaa;
  padding: 2px 0 4px;
  line-height: 1.4;
}

.raw-block {
  margin-bottom: 6px;
}

.raw-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 3px;
  color: #8f96a3;
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.copy-btn {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  padding: 1px 6px;
  color: #eee;
  font-size: 9px;
  cursor: pointer;
}

.copy-btn:hover {
  border-color: #ffcc00;
}
</style>
