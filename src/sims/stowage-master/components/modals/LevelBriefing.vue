<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useGameStore } from '../../store/gameStore'

const store = useGameStore()
const pageIndex = ref(0)

const pages = computed(() => store.levelConfig?.briefingPages ?? [])
const currentPage = computed(() => pages.value[pageIndex.value])
const isLastPage = computed(() => pageIndex.value >= pages.value.length - 1)

// Reset page index whenever a new briefing starts
watch(() => store.phase, (phase) => {
  if (phase === 'briefing') pageIndex.value = 0
})

function next() {
  if (isLastPage.value) {
    store.confirmBriefing()
  } else {
    pageIndex.value++
  }
}
</script>

<template>
  <div
    v-if="store.phase === 'briefing' && currentPage"
    class="overlay"
  >
    <div class="card">
      <div
        v-if="pages.length > 1"
        class="progress-bar"
      >
        <div
          v-for="(_, i) in pages"
          :key="i"
          class="progress-pip"
          :class="{ 'progress-pip--active': i === pageIndex, 'progress-pip--done': i < pageIndex }"
        />
      </div>

      <div class="icon">
        {{ currentPage.icon }}
      </div>

      <h2 class="title">
        {{ currentPage.title }}
      </h2>

      <p
        v-for="(para, i) in currentPage.body"
        :key="i"
        class="body"
      >
        {{ para }}
      </p>

      <div
        v-if="currentPage.legend?.length"
        class="legend"
      >
        <div
          v-for="(item, i) in currentPage.legend"
          :key="i"
          class="legend-row"
        >
          <span
            class="swatch"
            :style="{ background: item.color }"
          />
          <span class="legend-text">{{ item.text }}</span>
        </div>
      </div>

      <ol
        v-if="currentPage.steps?.length"
        class="steps"
      >
        <li
          v-for="(step, i) in currentPage.steps"
          :key="i"
        >
          {{ step }}
        </li>
      </ol>

      <p
        v-if="currentPage.warn"
        class="warn"
      >
        ⚠ {{ currentPage.warn }}
      </p>

      <button
        class="btn"
        @click="next"
      >
        {{ isLastPage ? 'START' : 'NEXT ›' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.84);
  z-index: 120;
  /* Block all pointer events on everything behind */
  pointer-events: all;
}

.card {
  background: linear-gradient(160deg, #0c1422 0%, #101c30 100%);
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: 14px;
  padding: 32px 38px 28px;
  max-width: 500px;
  width: 92%;
  text-align: center;
  box-shadow: 0 12px 50px rgba(0, 0, 0, 0.7);
  max-height: 90vh;
  overflow-y: auto;
}

.progress-bar {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-bottom: 22px;
}

.progress-pip {
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.15);
  flex: 1;
  max-width: 40px;
  transition: background 0.2s;
}

.progress-pip--done   { background: rgba(255, 204, 0, 0.4); }
.progress-pip--active { background: #ffcc00; }

.icon {
  font-size: 38px;
  margin-bottom: 10px;
  line-height: 1;
}

.title {
  font-size: 20px;
  font-weight: bold;
  letter-spacing: 2px;
  color: #ffcc00;
  margin-bottom: 14px;
  text-transform: uppercase;
}

.body {
  font-size: 13px;
  color: #bbb;
  line-height: 1.65;
  margin-bottom: 12px;
  text-align: left;
}

.legend {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 7px;
  padding: 8px 12px;
  text-align: left;
}

.swatch {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.legend-text {
  font-size: 12px;
  color: #ccc;
  line-height: 1.4;
}

.steps {
  text-align: left;
  padding-left: 20px;
  margin-bottom: 14px;
  counter-reset: step;
  list-style: none;
}

.steps li {
  font-size: 12px;
  color: #bbb;
  line-height: 1.7;
  position: relative;
  padding-left: 4px;
  counter-increment: step;
}

.steps li::before {
  content: counter(step) '.';
  color: #ffcc00;
  font-weight: bold;
  margin-right: 6px;
}

.warn {
  font-size: 12px;
  color: #ffaa00;
  background: rgba(255, 170, 0, 0.08);
  border: 1px solid rgba(255, 170, 0, 0.25);
  border-radius: 6px;
  padding: 8px 12px;
  text-align: left;
  margin-bottom: 18px;
  line-height: 1.5;
}

.btn {
  display: inline-block;
  padding: 10px 36px;
  background: linear-gradient(135deg, #ffcc00, #ff9900);
  border: none;
  border-radius: 6px;
  color: #000;
  font-weight: bold;
  font-size: 14px;
  letter-spacing: 1px;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
  margin-top: 4px;
}

.btn:hover {
  opacity: 0.88;
  transform: scale(1.03);
}
</style>
