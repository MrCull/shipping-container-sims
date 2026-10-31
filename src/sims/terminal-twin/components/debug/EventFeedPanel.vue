<script setup lang="ts">
import TtIcon from '../ui/TtIcon.vue'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { BREAKPOINT_KINDS, breakpointLabel, type BreakpointKind } from '../../modules/breakpoints'
import { buildFeedRows, FEED_MAX_ROWS, FEED_REFRESH_MS, shouldSummarise, type FeedRow } from '../../modules/eventFeed'
import { useTwinStore } from '../../store/twinStore'
import { t, type MessageKey } from '../../i18n/messages'
import type { EventSummary } from '../../worker/protocol'

const store = useTwinStore()

const rows = shallowRef<FeedRow[]>([])
const summarised = computed(() => !store.paused && shouldSummarise(store.speed))
const bpKind = ref<BreakpointKind>('eventType')
const bpValue = ref('')
let timer: ReturnType<typeof setInterval> | null = null

/** Rebuild the rows from the capped buffer. Runs a few times per second, never per frame. */
function refresh(): void {
  if (!store.feedOpen) return
  const built = buildFeedRows(store.recentEvents, {
    text: store.feedFilter,
    displayTime: store.displayTime,
    summarise: summarised.value,
    maxRows: FEED_MAX_ROWS,
  })
  // Newest on top, so the list needs no scroll management while it streams.
  rows.value = built.reverse()
}

const elapsed = (time: number): string => store.fmt.clock(store.choice.startDateTime, time).elapsed

function subjectsOf(e: EventSummary): string {
  const s = e.subjects
  return [...(s.equipment ?? []), ...(s.containers ?? []), ...(s.vessels ?? [])].slice(0, 3).join(' ')
}

function rowKey(row: FeedRow): string {
  return row.kind === 'event' ? `e${row.event.id}` : `b${row.firstId}`
}

function open(row: FeedRow): void {
  void store.inspectEvent(row.kind === 'event' ? row.event.id : row.lastId)
}

async function addBreakpoint(): Promise<void> {
  if (await store.addBreakpoint(bpKind.value, bpValue.value)) bpValue.value = ''
}

onMounted(() => {
  timer = setInterval(refresh, FEED_REFRESH_MS)
  refresh()
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
watch(() => [store.feedOpen, store.feedFilter, store.paused, summarised.value], refresh)
</script>

<template>
  <aside
    class="feed"
    data-hud-region="leftPanel"
    :class="{ open: store.feedOpen }"
    data-testid="tt-feed-panel"
  >
    <button
      v-if="!store.feedOpen"
      type="button"
      class="tab"
      data-testid="tt-feed-toggle"
      :title="t('debug.feed.toggle')"
      :aria-label="t('debug.feed.toggle')"
      aria-expanded="false"
      @click="store.toggleFeed()"
    >
      {{ t('debug.feed.title') }}
    </button>
    <section
      v-else
      class="body"
      :aria-label="t('debug.feed.title')"
    >
      <header class="head">
        <h2>{{ t('debug.feed.title') }}</h2>
        <button
          type="button"
          class="icon-btn"
          data-testid="tt-feed-toggle"
          :title="t('debug.feed.close')"
          :aria-label="t('debug.feed.close')"
          aria-expanded="true"
          @click="store.toggleFeed()"
        >
          <TtIcon name="prev" />
        </button>
      </header>

      <div class="controls">
        <button
          type="button"
          class="btn"
          data-testid="tt-step"
          :disabled="store.busy"
          :title="t('debug.stepHint')"
          @click="store.step().catch(() => {})"
        >
          {{ t('debug.step') }}
        </button>
        <button
          type="button"
          class="btn"
          data-testid="tt-continue"
          :disabled="store.busy || !store.paused"
          @click="store.resume()"
        >
          {{ t('debug.continue') }}
        </button>
      </div>
      <p
        v-if="store.breakHit"
        class="stopped"
        role="status"
        data-testid="tt-break-hit"
      >
        {{ t('debug.stoppedAt', { type: store.breakHit.event.type, id: store.breakHit.event.id }) }}
      </p>

      <section
        class="breakpoints"
        :aria-label="t('debug.breakpoints')"
      >
        <h3>{{ t('debug.breakpoints') }}</h3>
        <form
          class="bp-form"
          @submit.prevent="addBreakpoint"
        >
          <select
            v-model="bpKind"
            :aria-label="t('debug.bp.kind')"
            data-testid="tt-bp-kind"
          >
            <option
              v-for="kind in BREAKPOINT_KINDS"
              :key="kind"
              :value="kind"
            >
              {{ t(`debug.bp.kind.${kind}` as MessageKey) }}
            </option>
          </select>
          <input
            v-model="bpValue"
            type="text"
            :aria-label="t('debug.bp.value')"
            :placeholder="t('debug.bp.valuePlaceholder')"
            data-testid="tt-bp-value"
            autocomplete="off"
          >
          <button
            type="submit"
            class="btn"
            data-testid="tt-bp-add"
          >
            {{ t('debug.bp.add') }}
          </button>
        </form>
        <p
          v-if="store.breakpoints.length === 0"
          class="muted"
        >
          {{ t('debug.bp.none') }}
        </p>
        <ul
          v-else
          class="bp-list"
          :aria-label="t('debug.bp.list')"
          data-testid="tt-bp-list"
        >
          <li
            v-for="bp in store.breakpoints"
            :key="bp.id"
          >
            <code>{{ breakpointLabel(bp) }}</code>
            <button
              type="button"
              class="icon-btn"
              :aria-label="t('debug.bp.remove', { label: breakpointLabel(bp) })"
              @click="store.removeBreakpoint(bp.id)"
            >
              ×
            </button>
          </li>
        </ul>
        <button
          v-if="store.breakpoints.length > 1"
          type="button"
          class="link"
          @click="store.clearBreakpoints()"
        >
          {{ t('debug.bp.clear') }}
        </button>
      </section>

      <input
        v-model="store.feedFilter"
        type="search"
        class="filter"
        :aria-label="t('debug.feed.filter')"
        :placeholder="t('debug.feed.filterPlaceholder')"
        data-testid="tt-feed-filter"
        autocomplete="off"
      >
      <p
        v-if="summarised"
        class="muted"
        data-testid="tt-feed-summarised"
      >
        {{ t('debug.feed.summarised') }}
      </p>
      <p
        v-if="rows.length === 0"
        class="muted"
      >
        {{ t('debug.feed.empty') }}
      </p>
      <ol
        class="rows"
        :aria-label="t('debug.feed.list')"
        data-testid="tt-feed-rows"
      >
        <li
          v-for="row in rows"
          :key="rowKey(row)"
        >
          <button
            v-if="row.kind === 'event'"
            type="button"
            class="row"
            :class="{ hit: store.breakHit?.event.id === row.event.id }"
            :data-event-id="row.event.id"
            @click="open(row)"
          >
            <span class="time">{{ elapsed(row.event.t) }}</span>
            <span class="type">{{ row.event.type }}</span>
            <span class="who">{{ subjectsOf(row.event) }}</span>
          </button>
          <button
            v-else
            type="button"
            class="row burst"
            :title="t('debug.feed.burstTitle', { first: row.firstId, last: row.lastId })"
            data-burst="true"
            @click="open(row)"
          >
            <span class="time">{{ elapsed(row.t1) }}</span>
            <span class="type">{{ t('debug.feed.burst', { count: row.count, type: row.type }) }}</span>
          </button>
        </li>
      </ol>
    </section>
  </aside>
</template>

<style scoped>
.feed {
  /* Side panel region: a full-height grid column, as wide as its tab or its open body. */
  grid-column: 1;
  grid-row: 1 / -1;
  position: relative;
  display: flex;
  min-height: 0;
  z-index: 7;
  pointer-events: none;
  font-size: 0.8rem;
  color: var(--tt-text);
}

.feed > * {
  pointer-events: auto;
}

.tab {
  align-self: flex-start;
  margin-top: 0.8rem;
  padding: 0.45rem 0.7rem;
  border: 1px solid var(--tt-border);
  border-left: none;
  border-radius: 0 8px 8px 0;
  background: var(--tt-panel);
  -webkit-backdrop-filter: var(--tt-blur);
  backdrop-filter: var(--tt-blur);
  color: var(--tt-text);
  font-size: 0.8rem;
}

.tab:hover,
.icon-btn:hover,
.btn:hover {
  border-color: var(--tt-accent);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 21rem;
  flex: none;
  min-height: 0;
  padding: 0.6rem 0.7rem;
  border-right: 1px solid var(--tt-border);
  background: var(--tt-panel-strong);
  -webkit-backdrop-filter: var(--tt-blur);
  backdrop-filter: var(--tt-blur);
  overflow: hidden;
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
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--tt-text-muted);
}

.controls {
  display: flex;
  gap: 0.4rem;
}

.btn,
.icon-btn {
  padding: 0.3rem 0.65rem;
  border: 1px solid var(--tt-border);
  border-radius: 6px;
  background: var(--tt-bg);
  color: var(--tt-text);
  font-size: 0.8rem;
}

.btn:disabled {
  opacity: 0.5;
}

.icon-btn {
  padding: 0.1rem 0.45rem;
}

.stopped {
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--tt-accent);
  border-radius: 6px;
  background: var(--tt-accent-soft);
  font-weight: 600;
}

.breakpoints {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.bp-form {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.3rem;
}

select,
input {
  min-width: 0;
  padding: 0.3rem 0.4rem;
  border: 1px solid var(--tt-border);
  border-radius: 6px;
  background: var(--tt-bg);
  color: var(--tt-text);
  font-size: 0.8rem;
}

.bp-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.bp-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.15rem 0.4rem;
  border: 1px solid var(--tt-border);
  border-radius: 6px;
}

code {
  font-family: var(--tt-font-mono);
  font-size: 0.75rem;
}

.link {
  align-self: flex-start;
  border: none;
  background: none;
  color: var(--tt-accent);
  font-size: 0.75rem;
  text-decoration: underline;
}

.muted {
  color: var(--tt-text-muted);
  font-size: 0.75rem;
}

.rows {
  list-style: none;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.row {
  display: grid;
  grid-template-columns: 5.4rem 1fr;
  grid-template-areas:
    'time type'
    'time who';
  column-gap: 0.4rem;
  width: 100%;
  padding: 0.2rem 0.3rem;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--tt-text);
  text-align: left;
  font-size: 0.75rem;
}

.row:hover {
  background: var(--tt-surface-hover);
}

.row.hit {
  background: var(--tt-accent-soft);
}

.row.burst .type {
  color: var(--tt-accent);
}

.time {
  grid-area: time;
  font-family: var(--tt-font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--tt-text-muted);
}

.type {
  grid-area: type;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}

.who {
  grid-area: who;
  color: var(--tt-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filter {
  width: 100%;
}
</style>
