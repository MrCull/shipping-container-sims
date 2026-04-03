<script setup lang="ts">
import { useRouter } from 'vue-router'
import type { SimDefinition } from '@/types/sim'

const props = defineProps<{
  sim: SimDefinition
}>()
const router = useRouter()

function getUnavailableMessage(sim: SimDefinition): string {
  return sim.status === 'wip'
    ? 'This sim is not ready yet. It is still in development.'
    : 'This sim is coming soon and is not playable yet.'
}

function openSim(): void {
  if (props.sim.status !== 'playable') {
    return
  }

  router.push({ name: 'sim', params: { simId: props.sim.id } })
}
</script>

<template>
  <article
    class="sim-card"
    :class="[`status-${sim.status}`]"
    :style="{ '--card-accent': sim.color }"
    :aria-disabled="sim.status !== 'playable'"
    :title="sim.status !== 'playable' ? getUnavailableMessage(props.sim) : undefined"
    :tabindex="sim.status === 'playable' ? 0 : -1"
    @click="openSim"
    @keydown.enter.prevent="openSim"
    @keydown.space.prevent="openSim"
  >
    <div class="card-top">
      <div class="card-icon">
        <img
          v-if="sim.logoSrc"
          :src="sim.logoSrc"
          alt=""
          class="card-icon-img"
        >
        <span v-else>{{ sim.icon }}</span>
      </div>
      <span class="card-status">
        {{ sim.status === 'playable' ? '► PLAY' : sim.status === 'wip' ? '⚙ WIP' : '🔒 SOON' }}
      </span>
    </div>

    <h3 class="card-title">
      {{ sim.title }}
    </h3>
    <p class="card-tagline">
      {{ sim.tagline }}
    </p>
    <p class="card-desc">
      {{ sim.description }}
    </p>

    <div class="card-tags">
      <span
        v-for="tag in sim.tags"
        :key="tag"
        class="tag"
      >{{ tag }}</span>
    </div>

    <div
      v-if="sim.status !== 'playable'"
      class="card-tooltip"
      role="tooltip"
    >
      {{ getUnavailableMessage(props.sim) }}
    </div>

    <div class="scanline" />
  </article>
</template>

<style scoped>
.sim-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1.1rem;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.25s ease;
  cursor: default;
  aspect-ratio: 1 / 1;
}

.sim-card.status-playable {
  cursor: pointer;
}

.sim-card.status-coming-soon,
.sim-card.status-wip {
  cursor: not-allowed;
  opacity: 0.58;
  filter: saturate(0.75);
}

.sim-card.status-coming-soon .card-title,
.sim-card.status-coming-soon .card-tagline,
.sim-card.status-wip .card-title,
.sim-card.status-wip .card-tagline {
  color: color-mix(in srgb, var(--color-text-muted) 82%, var(--card-accent) 18%);
}

.sim-card.status-coming-soon .card-icon,
.sim-card.status-wip .card-icon,
.sim-card.status-coming-soon .tag,
.sim-card.status-wip .tag {
  opacity: 0.78;
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
  width: 100%;
  height: 3px;
  background: var(--card-accent, var(--color-primary));
  opacity: 0.5;
  transition: opacity 0.25s;
}

.sim-card:hover::before {
  opacity: 1;
}

.card-tooltip {
  position: absolute;
  left: 1rem;
  right: 1rem;
  bottom: calc(100% + 0.55rem);
  padding: 0.55rem 0.7rem;
  border: 1px solid color-mix(in srgb, var(--card-accent) 45%, var(--color-border));
  border-radius: 6px;
  background: rgba(10, 15, 26, 0.96);
  color: var(--color-text);
  font-size: 0.68rem;
  line-height: 1.45;
  opacity: 0;
  pointer-events: none;
  transform: translateY(6px);
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
  z-index: 2;
}

.sim-card.status-coming-soon:hover .card-tooltip,
.sim-card.status-coming-soon:focus-visible .card-tooltip,
.sim-card.status-wip:hover .card-tooltip,
.sim-card.status-wip:focus-visible .card-tooltip {
  opacity: 1;
  transform: translateY(0);
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

.card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 0.25rem;
}

.card-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.75rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  border: 1px solid var(--color-border);
  flex-shrink: 0;
}

.card-icon-img {
  width: 36px;
  height: 36px;
  object-fit: contain;
}

.card-title {
  font-family: var(--font-retro);
  font-size: 0.7rem;
  line-height: 1.5;
  color: var(--color-text);
}

.card-tagline {
  font-size: 0.75rem;
  color: var(--color-accent);
  font-weight: 600;
}

.card-desc {
  font-size: 0.78rem;
  color: var(--color-text-muted);
  line-height: 1.5;
  flex: 1;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.card-tags {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
  margin-top: auto;
}

.tag {
  font-size: 0.6rem;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.card-status {
  font-family: var(--font-retro);
  font-size: 0.55rem;
  white-space: nowrap;
  color: var(--card-accent, var(--color-primary));
  padding-top: 0.2rem;
}

.status-coming-soon {
  opacity: 0.65;
}
</style>
