<script setup lang="ts">
/**
 * Yardshift screens over the yard (#386): intro, pause, level picker, result and fail. Content comes from
 * modules/screens.ts; buttons call store actions.
 */
import { computed } from 'vue'
import { LEVELS } from '../../modules/levels'
import { failView, introView, pickerRows, resultView } from '../../modules/screens'
import { minRehandlesFor } from '../../modules/stars'
import { useYardshiftStore } from '../../store/yardshiftStore'

const store = useYardshiftStore()
const level = computed(() => store.state.level)
const min = computed(() => minRehandlesFor(level.value.number))
const intro = computed(() => introView(level.value, min.value))
const result = computed(() => resultView(store.state, min.value, LEVELS.length))
const fail = computed(() => failView(store.state))
const rows = computed(() => pickerRows(LEVELS, store.progress, store.unlockAll))
const screen = computed(() => {
  if (store.overlay) return store.overlay
  if (store.state.status === 'complete') return 'result'
  if (store.state.status === 'failed') return 'fail'
  return null
})

function play(n: number): void {
  store.loadLevel(n, { intro: true })
}
</script>

<template>
  <div
    v-if="screen"
    class="screen"
    :data-testid="`ys-screen-${screen}`"
  >
    <div class="card">
      <template v-if="screen === 'intro'">
        <h2>{{ intro.title }}</h2>
        <p>{{ intro.objective }}</p>
        <p class="target">
          {{ intro.target }}
        </p>
        <p>{{ intro.shift }}</p>
        <p class="tip">
          {{ intro.tip }}
        </p>
        <div class="buttons">
          <button
            type="button"
            class="primary"
            data-testid="ys-start"
            @click="store.startShift()"
          >
            Start shift ›
          </button>
          <button
            type="button"
            data-testid="ys-levels"
            @click="store.openLevels()"
          >
            Levels
          </button>
        </div>
      </template>

      <template v-else-if="screen === 'pause'">
        <h2>Paused</h2>
        <div class="buttons">
          <button
            type="button"
            class="primary"
            data-testid="ys-resume"
            @click="store.resume()"
          >
            Resume
          </button>
          <button
            type="button"
            @click="store.restart()"
          >
            Restart
          </button>
          <button
            type="button"
            data-testid="ys-levels"
            @click="store.openLevels()"
          >
            Levels
          </button>
        </div>
      </template>

      <template v-else-if="screen === 'levels'">
        <h2>Choose shift</h2>
        <ol class="levels">
          <li
            v-for="row in rows"
            :key="row.number"
          >
            <button
              type="button"
              class="row"
              :disabled="row.locked"
              :data-testid="`ys-level-${row.number}`"
              :data-locked="row.locked"
              @click="play(row.number)"
            >
              <span class="name">{{ row.number }}. {{ row.name }}</span>
              <span class="stars">{{ row.stars }}</span>
              <span class="best">{{ row.best }}</span>
            </button>
          </li>
        </ol>
        <div class="buttons">
          <button
            type="button"
            @click="store.closeLevels()"
          >
            Back
          </button>
        </div>
      </template>

      <template v-else-if="screen === 'result'">
        <h2>{{ result.title }}</h2>
        <p
          class="big-stars"
          data-testid="ys-result-stars"
          :data-stars="result.stars"
        >
          {{ '★'.repeat(result.stars) }}<span class="dim-star">{{ '★'.repeat(3 - result.stars) }}</span>
        </p>
        <p class="target">
          {{ result.verdict }}
        </p>
        <p data-testid="ys-result-rehandles">
          {{ result.rehandles }}
        </p>
        <p>{{ result.score }} · {{ result.combo }}</p>
        <p>{{ result.bonuses }}</p>
        <p>{{ result.timeEarned }}</p>
        <div class="buttons">
          <button
            v-if="result.hasNext"
            type="button"
            class="primary"
            data-testid="ys-next"
            @click="play(level.number + 1)"
          >
            Next shift ›
          </button>
          <button
            type="button"
            data-testid="ys-retry"
            @click="store.restart()"
          >
            Retry
          </button>
          <button
            type="button"
            data-testid="ys-levels"
            @click="store.openLevels()"
          >
            Levels
          </button>
        </div>
      </template>

      <template v-else-if="screen === 'fail'">
        <h2>{{ fail.title }}</h2>
        <p data-testid="ys-fail-reason">
          {{ fail.reason }}
        </p>
        <p>{{ fail.left }}</p>
        <div class="buttons">
          <button
            v-if="fail.canUndo"
            type="button"
            @click="store.undo()"
          >
            Undo last move
          </button>
          <button
            type="button"
            class="primary"
            data-testid="ys-retry"
            @click="store.restart()"
          >
            Try again
          </button>
          <button
            type="button"
            data-testid="ys-levels"
            @click="store.openLevels()"
          >
            Levels
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.screen {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgb(8 19 29 / 78%);
}
.card {
  width: min(360px, 100%);
  max-height: 100%;
  overflow-y: auto;
  padding: 20px;
  border-radius: 12px;
  background: #142530;
  text-align: center;
  box-shadow: 0 8px 30px rgb(0 0 0 / 40%);
}
h2 {
  margin: 0 0 10px;
  color: #ffc85c;
  letter-spacing: 0.06em;
}
p {
  margin: 4px 0;
}
.target {
  font-weight: 700;
}
.tip {
  margin-top: 10px;
  font-style: italic;
  opacity: 0.85;
}
.big-stars {
  font-size: 2rem;
  color: #ffc85c;
}
.dim-star {
  color: #3c5363;
}
.buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 14px;
}
button {
  padding: 10px 16px;
  border: 1px solid #3c5363;
  border-radius: 8px;
  background: #1d3442;
  color: #e7eef2;
  font-weight: 700;
  cursor: pointer;
}
button.primary {
  border-color: #ffcb60;
  background: #ffcb60;
  color: #142530;
}
.levels {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}
.row {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 8px;
  padding: 8px 10px;
  text-align: left;
  font-weight: 600;
}
.row:disabled {
  opacity: 0.45;
  cursor: default;
}
.row .stars {
  color: #ffc85c;
}
.row .best {
  font-size: 0.8rem;
  opacity: 0.8;
}
</style>
