<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { eventsInvolving, type Fact } from '../../modules/entityInspector'
import { useTwinStore } from '../../store/twinStore'
import { t, type MessageKey } from '../../i18n/messages'

const store = useTwinStore()

const REFRESH_MS = 500
let timer: ReturnType<typeof setInterval> | null = null

const elapsed = (time: number): string => store.fmt.clock(store.choice.startDateTime, time).elapsed

const inspected = computed(() => {
  const e = store.inspectedEvent
  return e ? { ...e, current: e.chain[e.index] } : null
})

const view = computed(() => store.entityView)

const recent = computed(() => (store.selectedId ? eventsInvolving(store.recentEvents, store.selectedId, 12) : []))

function factText(f: Fact): string {
  if (f.value === null) return t('inspector.none')
  if (f.token) return t(`inspector.${f.token}.${f.value}` as MessageKey)
  if (typeof f.value === 'number' && f.unit === 'length') return store.fmt.length(f.value)
  if (typeof f.value === 'number' && f.unit === 'time') return t('inspector.seconds', { n: store.fmt.number(f.value, 0) })
  return String(f.value)
}

function selectable(kind: string): boolean {
  return kind === 'container' || kind === 'equipment' || kind === 'vessel'
}

onMounted(() => {
  // The entity view follows the engine: refresh a few times a second while something is selected.
  timer = setInterval(() => {
    if (store.inspectorOpen && store.selectedId && !store.busy) void store.refreshEntity()
  }, REFRESH_MS)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <aside
    class="inspector"
    data-hud-region="rightPanel"
    data-testid="tt-inspector"
  >
    <button
      v-if="!store.inspectorOpen"
      type="button"
      class="tab"
      data-testid="tt-inspector-toggle"
      :title="t('inspector.toggle')"
      :aria-label="t('inspector.toggle')"
      aria-expanded="false"
      @click="store.toggleInspector()"
    >
      {{ t('inspector.title') }}
    </button>
    <section
      v-else
      class="body"
      :aria-label="t('inspector.title')"
    >
      <header class="head">
        <h2>{{ t('inspector.title') }}</h2>
        <button
          type="button"
          class="icon-btn"
          data-testid="tt-inspector-toggle"
          :title="t('inspector.close')"
          :aria-label="t('inspector.close')"
          aria-expanded="true"
          @click="store.toggleInspector()"
        >
          ▶
        </button>
      </header>

      <p
        v-if="!inspected && !view"
        class="muted"
      >
        {{ t('inspector.nothing') }}
      </p>

      <section
        v-if="inspected"
        class="block"
        data-testid="tt-event-inspector"
        :aria-label="t('inspector.event')"
      >
        <h3>{{ t('inspector.event') }}</h3>
        <p
          class="heading"
          data-testid="tt-event-heading"
        >
          {{ t('inspector.eventHeading', { id: inspected.current.id, type: inspected.current.type }) }}
        </p>
        <p class="muted">
          {{ t('inspector.eventTime', { time: elapsed(inspected.current.t), seq: inspected.current.seq }) }}
        </p>
        <div
          v-if="inspected.current.subjects.length > 0"
          class="subjects"
        >
          <template
            v-for="s in inspected.current.subjects"
            :key="`${s.kind}:${s.id}`"
          >
            <button
              v-if="selectable(s.kind)"
              type="button"
              class="chip"
              @click="store.select(s.id)"
            >
              {{ s.id }}
            </button>
            <span
              v-else
              class="chip plain"
            >{{ s.id }}</span>
          </template>
        </div>

        <template v-if="inspected.current.decision">
          <h3>{{ t('inspector.decision') }}</h3>
          <dl
            class="facts"
            data-testid="tt-decision"
          >
            <dt>{{ t('inspector.decisionPoint') }}</dt>
            <dd>{{ inspected.current.decision.decisionPoint }}</dd>
            <dt>{{ t('inspector.correlation') }}</dt>
            <dd>{{ inspected.current.decision.correlationId }}</dd>
            <template v-if="inspected.current.decision.handler">
              <dt>{{ t('inspector.handler') }}</dt>
              <dd>{{ inspected.current.decision.handler }}</dd>
            </template>
            <template v-if="inspected.current.decision.outcome">
              <dt>{{ t('inspector.outcome') }}</dt>
              <dd>{{ inspected.current.decision.outcome }}</dd>
            </template>
            <template v-if="inspected.current.decision.failure">
              <dt>{{ t('inspector.failure') }}</dt>
              <dd>{{ inspected.current.decision.failure }}: {{ inspected.current.decision.message }}</dd>
            </template>
          </dl>
          <template v-if="inspected.current.decision.requestJson">
            <h3>{{ t('inspector.request') }}</h3>
            <pre data-testid="tt-decision-request">{{ inspected.current.decision.requestJson }}</pre>
          </template>
          <template v-if="inspected.current.decision.replyJson">
            <h3>{{ t('inspector.reply') }}</h3>
            <pre data-testid="tt-decision-reply">{{ inspected.current.decision.replyJson }}</pre>
          </template>
        </template>

        <h3>{{ t('inspector.payload') }}</h3>
        <pre data-testid="tt-event-payload">{{ inspected.current.payloadJson }}</pre>

        <h3>{{ t('inspector.causeChain') }}</h3>
        <p class="muted">
          {{ t('inspector.causeChainHint') }}
        </p>
        <ol
          class="chain"
          data-testid="tt-cause-chain"
        >
          <li
            v-for="(e, i) in inspected.chain"
            :key="e.id"
          >
            <button
              type="button"
              class="chain-row"
              :class="{ current: i === inspected.index }"
              :data-event-id="e.id"
              @click="store.inspectEvent(e.id)"
            >
              <span class="num">#{{ e.id }}</span>
              <span class="type">{{ e.type }}</span>
              <span
                v-if="e.causedBy === null"
                class="root"
              >{{ t('inspector.rootEvent') }}</span>
            </button>
          </li>
        </ol>
      </section>

      <section
        v-if="view && store.selectedId"
        class="block"
        data-testid="tt-entity-inspector"
        :aria-label="t('inspector.selection')"
      >
        <h3>{{ t('inspector.selection') }}</h3>
        <p
          class="heading"
          data-testid="tt-entity-heading"
        >
          {{ t('inspector.selectionHeading', { kind: t(`inspector.kind.${view.kind}` as MessageKey), id: view.id }) }}
        </p>
        <div class="buttons">
          <button
            type="button"
            class="btn"
            data-testid="tt-follow"
            :aria-pressed="store.following"
            @click="store.toggleFollow()"
          >
            {{ store.following ? t('inspector.unfollow') : t('inspector.follow') }}
          </button>
          <button
            type="button"
            class="btn"
            @click="store.select(null)"
          >
            {{ t('inspector.deselect') }}
          </button>
        </div>
        <h3>{{ t('inspector.state') }}</h3>
        <dl class="facts">
          <template
            v-for="f in view.facts"
            :key="f.label"
          >
            <dt>{{ t(f.label) }}</dt>
            <dd>
              <button
                v-if="f.link && f.value !== null"
                type="button"
                class="chip"
                @click="store.select(String(f.value))"
              >
                {{ factText(f) }}
              </button>
              <template v-else>
                {{ factText(f) }}
              </template>
            </dd>
          </template>
        </dl>
        <template v-if="view.kind !== 'container'">
          <h3>{{ t('inspector.job') }}</h3>
          <dl
            v-if="view.job"
            class="facts"
            data-testid="tt-entity-job"
          >
            <template
              v-for="f in view.job"
              :key="f.label"
            >
              <dt>{{ t(f.label) }}</dt>
              <dd>
                <button
                  v-if="f.link && f.value !== null"
                  type="button"
                  class="chip"
                  @click="store.select(String(f.value))"
                >
                  {{ factText(f) }}
                </button>
                <template v-else>
                  {{ factText(f) }}
                </template>
              </dd>
            </template>
          </dl>
          <p
            v-else
            class="muted"
          >
            {{ t('inspector.idle') }}
          </p>
        </template>
        <template v-else>
          <h3>{{ t('inspector.custodyHistory') }}</h3>
          <ol
            class="history"
            data-testid="tt-custody-history"
          >
            <li
              v-for="(c, i) in view.custody"
              :key="i"
              :class="{ current: c.current }"
            >
              {{ t('inspector.custodyRow', { time: elapsed(c.t), owner: `${c.ownerKind}:${c.ownerId}` }) }}
              <span
                v-if="c.current"
                class="now"
              >{{ t('inspector.custodyNow') }}</span>
              <button
                v-if="c.eventId !== null"
                type="button"
                class="chip"
                @click="store.inspectEvent(c.eventId)"
              >
                #{{ c.eventId }}
              </button>
            </li>
          </ol>
        </template>
        <template v-if="view.kind !== 'container'">
          <h3>{{ t('inspector.recentEvents') }}</h3>
          <p
            v-if="recent.length === 0"
            class="muted"
          >
            {{ t('inspector.noEvents') }}
          </p>
          <ol
            v-else
            class="history"
            data-testid="tt-entity-events"
          >
            <li
              v-for="e in recent"
              :key="e.id"
            >
              <button
                type="button"
                class="chip"
                @click="store.inspectEvent(e.id)"
              >
                #{{ e.id }}
              </button>
              {{ elapsed(e.t) }} {{ e.type }}
            </li>
          </ol>
        </template>
      </section>
    </section>
  </aside>
</template>

<style scoped>
.inspector {
  /* Side panel region: a full-height grid column, as wide as its tab or its open body. */
  grid-column: 3;
  grid-row: 1 / -1;
  position: relative;
  display: flex;
  min-height: 0;
  z-index: 7;
  pointer-events: none;
  font-size: 0.8rem;
  color: var(--color-text);
}

.inspector > * {
  pointer-events: auto;
}

.tab {
  align-self: flex-start;
  margin-top: 0.8rem;
  padding: 0.45rem 0.7rem;
  border: 1px solid var(--color-border);
  border-right: none;
  border-radius: 8px 0 0 8px;
  background: rgba(17, 24, 39, 0.9);
  color: var(--color-text);
  font-size: 0.8rem;
}

.tab:hover,
.btn:hover,
.icon-btn:hover,
.chip:hover {
  border-color: var(--color-primary);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  width: 22rem;
  flex: none;
  min-height: 0;
  padding: 0.6rem 0.7rem;
  border-left: 1px solid var(--color-border);
  background: rgba(17, 24, 39, 0.94);
  overflow-y: auto;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

h2 {
  font-size: 0.95rem;
}

h3 {
  margin-top: 0.3rem;
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.block {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid var(--color-border);
}

.heading {
  font-weight: 600;
  font-size: 0.9rem;
}

.muted {
  color: var(--color-text-muted);
  font-size: 0.75rem;
}

.buttons,
.subjects {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.btn,
.icon-btn,
.chip {
  padding: 0.2rem 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 0.75rem;
}

.chip {
  font-family: var(--tt-font-mono);
  padding: 0.1rem 0.4rem;
}

.chip.plain {
  color: var(--color-text-muted);
}

.facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.15rem 0.7rem;
}

.facts dt {
  color: var(--color-text-muted);
}

.facts dd {
  font-family: var(--tt-font-mono);
  overflow-wrap: anywhere;
}

pre {
  max-height: 14rem;
  overflow: auto;
  padding: 0.4rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  font-family: var(--tt-font-mono);
  font-size: 0.7rem;
}

.chain,
.history {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chain-row {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
  width: 100%;
  padding: 0.2rem 0.35rem;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text);
  text-align: left;
  font-size: 0.75rem;
}

.chain-row:hover {
  background: var(--color-bg-card-hover);
}

.chain-row.current {
  border-color: var(--color-accent);
}

.num {
  font-family: var(--tt-font-mono);
  color: var(--color-text-muted);
}

.type {
  font-weight: 600;
}

.root {
  margin-left: auto;
  color: var(--color-accent);
  font-size: 0.7rem;
  text-transform: uppercase;
}

.history li {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: baseline;
  font-family: var(--tt-font-mono);
  font-size: 0.72rem;
}

.history li.current {
  color: var(--color-accent);
}

.now {
  font-family: var(--font-body);
  text-transform: uppercase;
  font-size: 0.65rem;
}
</style>
