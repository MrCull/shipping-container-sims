<script setup lang="ts">
import { onMounted } from 'vue'
import { useSimsStore } from '@/stores/sims'
import { useSimRegistry } from '@/composables/useSimRegistry'
import { useMenuMusic } from '@/composables/useMenuMusic'
import HeroBackground from '@/components/HeroBackground.vue'
import SimCard from '@/components/SimCard.vue'

const store = useSimsStore()
const { registerAll } = useSimRegistry()

useMenuMusic()

onMounted(() => {
  registerAll()
})
</script>

<template>
  <div class="home">
    <header class="hero">
      <HeroBackground />
      <div class="hero-content">
        <h1 class="hero-title">
          <span class="title-line">SHIPPING</span>
          <span class="title-line accent">CONTAINER</span>
          <span class="title-line">SIMS</span>
        </h1>
        <p class="hero-sub">Stack &bull; Ship &bull; Simulate</p>
        <div class="hero-divider">
          <span class="divider-pixel" v-for="n in 20" :key="n" />
        </div>
      </div>
    </header>

    <main class="content">
      <section v-if="store.playable.length" class="sim-section">
        <h2 class="section-title">
          <span class="blink">►</span> READY TO PLAY
        </h2>
        <div class="sim-grid">
          <SimCard v-for="sim in store.playable" :key="sim.id" :sim="sim" />
        </div>
      </section>

      <section v-if="store.comingSoon.length" class="sim-section">
        <h2 class="section-title">
          <span class="lock-icon">🔒</span> COMING SOON
        </h2>
        <div class="sim-grid">
          <SimCard v-for="sim in store.comingSoon" :key="sim.id" :sim="sim" />
        </div>
      </section>

      <footer class="site-footer">
        <p>SHIPPING CONTAINER SIMS &copy; {{ new Date().getFullYear() }}</p>
        <p class="footer-sub">INSERT COIN TO CONTINUE...</p>
      </footer>
    </main>
  </div>
</template>

<style scoped>
.home {
  min-height: 100vh;
}

.hero {
  position: relative;
  min-height: 50vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.hero-content {
  position: relative;
  z-index: 1;
  text-align: center;
  padding: 3rem 1.5rem;
}

.hero-title {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.title-line {
  font-family: var(--font-retro);
  font-size: clamp(1.2rem, 4vw, 2.6rem);
  letter-spacing: 0.15em;
  text-shadow:
    0 0 10px rgba(59, 130, 246, 0.5),
    0 0 40px rgba(59, 130, 246, 0.2);
}

.title-line.accent {
  color: var(--color-accent);
  text-shadow:
    0 0 10px rgba(245, 158, 11, 0.6),
    0 0 40px rgba(245, 158, 11, 0.3);
}

.hero-sub {
  margin-top: 1rem;
  font-family: var(--font-retro);
  font-size: 0.65rem;
  letter-spacing: 0.3em;
  color: var(--color-text-muted);
}

.hero-divider {
  display: flex;
  justify-content: center;
  gap: 4px;
  margin-top: 1.5rem;
}

.divider-pixel {
  width: 8px;
  height: 4px;
  background: var(--color-primary);
  opacity: 0.5;
}

.divider-pixel:nth-child(even) {
  background: var(--color-accent);
  opacity: 0.7;
}

.content {
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem 1.5rem 4rem;
}

.sim-section {
  margin-bottom: 3rem;
}

.section-title {
  font-family: var(--font-retro);
  font-size: 0.75rem;
  letter-spacing: 0.15em;
  color: var(--color-text-muted);
  margin-bottom: 1.25rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.blink {
  animation: blink 1s step-end infinite;
  color: var(--color-success);
}

@keyframes blink {
  50% { opacity: 0; }
}

.lock-icon {
  font-style: normal;
}

.sim-grid {
  display: grid;
  gap: 1rem;
}

.site-footer {
  text-align: center;
  padding-top: 3rem;
  border-top: 1px solid var(--color-border);
  font-family: var(--font-retro);
  font-size: 0.55rem;
  letter-spacing: 0.15em;
  color: var(--color-text-muted);
  line-height: 2;
}

.footer-sub {
  animation: blink 1.5s step-end infinite;
  color: var(--color-accent);
}
</style>
