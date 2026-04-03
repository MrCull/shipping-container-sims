<script setup lang="ts">
import { computed, defineAsyncComponent, onUnmounted } from 'vue'
import { useSimsStore } from '@/stores/sims'
import { useSimRegistry } from '@/composables/useSimRegistry'
import { watchSimHead } from '@/composables/useSiteHead'
import { useRouter } from 'vue-router'
import AudioControls from '@/components/AudioControls.vue'

const props = defineProps<{
  simId: string
}>()

const store = useSimsStore()
const router = useRouter()
const { registerAll } = useSimRegistry()

if (store.sims.length === 0) {
  registerAll()
}

const sim = computed(() => store.getById(props.simId))

const asyncComponent = computed(() => {
  if (!sim.value || sim.value.status !== 'playable') return null
  return defineAsyncComponent(sim.value.component)
})

function goHome() {
  router.push({ name: 'home' })
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
      <button
        class="back-btn"
        @click="goHome"
      >
        <span class="menu-icon">☰</span>
        <span class="back-arrow">◀</span>
        <span>MENU</span>
      </button>
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

    <AudioControls v-if="simId !== 'box-empire'" />

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
          ◀ BACK TO MENU
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
          ◀ BACK TO MENU
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

.sim-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1.5rem;
  background: rgba(17, 24, 39, 0.95);
  border-bottom: 1px solid var(--color-border);
  backdrop-filter: blur(8px);
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
  font-size: 0.62rem;
  line-height: 1;
}

.back-arrow {
  font-size: 0.7rem;
}

.sim-name {
  display: flex;
  align-items: center;
  gap: 0.5rem;
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
  50% { opacity: 0; }
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
