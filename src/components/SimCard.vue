<script setup lang="ts">
import type { SimDefinition } from '@/types/sim'

defineProps<{
  sim: SimDefinition
}>()
</script>

<template>
  <router-link
    :to="sim.status === 'playable' ? { name: 'sim', params: { simId: sim.id } } : ''"
    class="sim-card"
    :class="[`status-${sim.status}`]"
    :style="{ '--card-accent': sim.color }"
  >
    <div class="card-icon">{{ sim.icon }}</div>

    <div class="card-body">
      <h3 class="card-title">{{ sim.title }}</h3>
      <p class="card-tagline">{{ sim.tagline }}</p>
      <p class="card-desc">{{ sim.description }}</p>

      <div class="card-footer">
        <div class="card-tags">
          <span v-for="tag in sim.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>
        <span class="card-status">
          {{ sim.status === 'playable' ? '► PLAY' : sim.status === 'wip' ? '⚙ WIP' : '🔒 SOON' }}
        </span>
      </div>
    </div>

    <div class="scanline" />
  </router-link>
</template>

<style scoped>
.sim-card {
  position: relative;
  display: flex;
  gap: 1.25rem;
  padding: 1.5rem;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.25s ease;
  cursor: default;
}

.sim-card.status-playable {
  cursor: pointer;
}

.sim-card.status-playable:hover {
  background: var(--color-bg-card-hover);
  border-color: var(--card-accent, var(--color-primary));
  transform: translateY(-2px);
  box-shadow:
    0 0 20px color-mix(in srgb, var(--card-accent) 25%, transparent),
    0 8px 32px rgba(0, 0, 0, 0.4);
}

.sim-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 4px;
  height: 100%;
  background: var(--card-accent, var(--color-primary));
  opacity: 0.6;
  transition: opacity 0.25s;
}

.sim-card:hover::before {
  opacity: 1;
}

.scanline {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(255, 255, 255, 0.015) 2px,
    rgba(255, 255, 255, 0.015) 4px
  );
  pointer-events: none;
}

.card-icon {
  flex-shrink: 0;
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  border: 1px solid var(--color-border);
}

.card-body {
  flex: 1;
  min-width: 0;
}

.card-title {
  font-family: var(--font-retro);
  font-size: 0.85rem;
  line-height: 1.4;
  color: var(--color-text);
  margin-bottom: 0.25rem;
}

.card-tagline {
  font-size: 0.8rem;
  color: var(--color-accent);
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.card-desc {
  font-size: 0.85rem;
  color: var(--color-text-muted);
  line-height: 1.5;
  margin-bottom: 0.75rem;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.card-tags {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.tag {
  font-size: 0.65rem;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.card-status {
  font-family: var(--font-retro);
  font-size: 0.6rem;
  white-space: nowrap;
  color: var(--card-accent, var(--color-primary));
}

.status-coming-soon {
  opacity: 0.65;
}
</style>
