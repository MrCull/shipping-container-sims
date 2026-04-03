<script setup lang="ts">
import { computed, defineAsyncComponent, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import AudioControls from '@/components/AudioControls.vue'
import { useSimRegistry } from '@/composables/useSimRegistry'
import { watchSimHead } from '@/composables/useSiteHead'
import { useGameStore as useStowageMasterStore } from '@/sims/stowage-master/store/gameStore'
import { useSimsStore } from '@/stores/sims'

const props = defineProps<{
  simId: string
}>()

const store = useSimsStore()
const router = useRouter()
const { registerAll } = useSimRegistry()
const stowageStore = useStowageMasterStore()

if (store.sims.length === 0) {
  registerAll()
}

const sim = computed(() => store.getById(props.simId))

const asyncComponent = computed(() => {
  if (!sim.value || sim.value.status !== 'playable') return null
  return defineAsyncComponent(sim.value.component)
})

const showGodBadge = computed(() =>
  props.simId === 'stowage-master' &&
  stowageStore.phase === 'start' &&
  stowageStore.isGodMode
)

function goHome() {
  router.push({ name: 'home' })
}

function handleMenuClick() {
  if (props.simId === 'stowage-master' && stowageStore.phase !== 'start') {
    stowageStore.returnToStartMenu()
    return
  }
  goHome()
}

const stopHeadWatch = watchSimHead(
  () => sim.value,
  () => props.simId,
)

onUnmounted(() => {
  stopHeadWatch()
})
</script>

<template>
  <div class="sim-page">
    <header class="sim-header">
      <div class="header-actions">
        <button
          class="back-btn"
          @click="handleMenuClick"
        >
          <span class="menu-icon">MENU</span>
          <span class="back-arrow">&lt;</span>
          <span>MENU</span>
        </button>
      </div>

      <h1
        v-if="sim"
        class="sim-name"
      >
        <img
          v-if="sim.logoSrc"
          :src="sim.logoSrc"
          alt=""
          class="sim-name-logo"
        >
        <span v-else>{{ sim.icon }}</span>
        <span>{{ sim.title }}</span>
      </h1>
    </header>

    <div
      v-if="simId !== 'box-empire'"
      class="top-right-controls"
    >
      <div
        v-if="showGodBadge"
        class="god-badge"
        title="God mode enabled"
      >
        ⚡
      </div>
      <AudioControls placement="inline" />
    </div>

    <main class="sim-content">
      <template v-if="sim && sim.status === 'playable' && asyncComponent">
        <component :is="asyncComponent" />
      </template>

      <div
        v-else-if="sim"
        class="coming-soon-screen"
      >
        <div class="cs-icon">
          <img
            v-if="sim.logoSrc"
            :src="sim.logoSrc"
            alt=""
            class="cs-icon-img"
          >
          <span v-else>{{ sim.icon }}</span>
        </div>
        <h2 class="cs-title">
          {{ sim.title }}
        </h2>
        <p class="cs-tagline">
          {{ sim.tagline }}
        </p>
        <div class="cs-status">
          <span class="blink">■</span> {{ sim.status === 'wip' ? 'WORK IN PROGRESS' : 'COMING SOON' }}
        </div>
        <p class="cs-desc">
          {{ sim.description }}
        </p>
        <button
          class="back-home-btn"
          @click="goHome"
        >
          &lt; BACK TO MENU
        </button>
      </div>

      <div
        v-else
        class="not-found"
      >
        <p class="nf-text">
          SIM NOT FOUND
        </p>
        <button
          class="back-home-btn"
          @click="goHome"
        >
          &lt; BACK TO MENU
        </button>
      </div>
    </main>
  </div>
</template>

<style scoped>
.sim-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  position: relative;
}

.top-right-controls {
  position: absolute;
  top: 1rem;
  right: 1rem;
  z-index: 140;
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.god-badge {
  min-width: 2.4rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 0.5rem;
  border: 1px solid rgba(255, 204, 0, 0.7);
  border-radius: 4px;
  color: #ffcc00;
  background: rgba(255, 204, 0, 0.18);
  box-shadow: 0 0 12px rgba(255, 204, 0, 0.18);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  line-height: 1;
}

.sim-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1.5rem;
  background: rgba(17, 24, 39, 0.95);
  border-bottom: 1px solid var(--color-border);
  backdrop-filter: blur(8px);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.4rem 0.8rem;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text-muted);
  font-family: var(--font-retro);
  font-size: 0.55rem;
  letter-spacing: 0.1em;
  transition: all 0.2s;
}

.back-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}

.menu-icon {
  font-size: 0.5rem;
  line-height: 1;
}

.back-arrow {
  font-size: 0.7rem;
}

.sim-name {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  max-width: min(48vw, calc(100vw - 360px));
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-retro);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
}

.sim-name-logo {
  width: 26px;
  height: 26px;
  object-fit: contain;
}

.sim-content {
  flex: 1;
  display: flex;
}

.coming-soon-screen,
.not-found {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 3rem;
  text-align: center;
}

.cs-icon {
  font-size: 4rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cs-icon-img {
  width: 5rem;
  height: 5rem;
  object-fit: contain;
}

.cs-title {
  font-family: var(--font-retro);
  font-size: 1.2rem;
  letter-spacing: 0.1em;
}

.cs-tagline {
  color: var(--color-accent);
  font-weight: 600;
  font-size: 0.9rem;
}

.cs-status {
  font-family: var(--font-retro);
  font-size: 0.65rem;
  color: var(--color-text-muted);
  letter-spacing: 0.15em;
}

.cs-desc {
  max-width: 480px;
  color: var(--color-text-muted);
  line-height: 1.6;
}

.blink {
  animation: blink 1s step-end infinite;
  color: var(--color-accent);
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

.nf-text {
  font-family: var(--font-retro);
  font-size: 1.2rem;
  color: var(--color-danger);
}

.back-home-btn {
  margin-top: 1rem;
  padding: 0.6rem 1.2rem;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text);
  font-family: var(--font-retro);
  font-size: 0.6rem;
  letter-spacing: 0.1em;
  transition: all 0.2s;
}

.back-home-btn:hover {
  border-color: var(--color-primary);
  background: rgba(59, 130, 246, 0.1);
}
</style>
