<script setup lang="ts">
import { computed } from 'vue'
import type { SimDefinition } from '@/types/sim'
import { trackEvent } from '@/utils/analytics'

const props = defineProps<{
  sim: SimDefinition
  /** The big first tile: longer text and a larger title. */
  featured?: boolean
  /** The player opened this game last: show a "Continue" badge and button. */
  resume?: boolean
}>()

const progressSummary = computed(() => props.sim.progressSummary?.() ?? null)
const kind = computed(() => props.sim.tags.slice(0, 2).join(' · '))

function onClick(): void {
  trackEvent('sim_card_click', {
    sim_id: props.sim.id,
    sim_title: props.sim.title,
    sim_status: props.sim.status,
    location: 'home_page',
  })
}
</script>

<template>
  <RouterLink
    class="tile"
    :class="{ featured }"
    :to="{ name: 'sim', params: { simId: sim.id } }"
    :style="{ '--tile-color': sim.color }"
    :data-testid="`game-tile-${sim.id}`"
    @click="onClick"
  >
    <img
      v-if="sim.cardImage"
      :src="sim.cardImage"
      alt=""
      class="tile-art"
      :loading="featured ? 'eager' : 'lazy'"
    >
    <span
      v-if="resume"
      class="badge"
    >CONTINUE</span>
    <div class="tile-text">
      <span class="kind">{{ kind }}</span>
      <h3 class="tile-title">
        {{ sim.title }}
      </h3>
      <p
        v-if="featured"
        class="tile-desc tile-desc-long"
      >
        {{ sim.description }}
      </p>
      <p
        class="tile-desc"
        :class="{ 'tile-desc-short': featured }"
      >
        {{ sim.tagline }}
      </p>
      <div class="go">
        <span class="btn">{{ resume ? '▶ Continue' : '▶ Play' }}</span>
        <span
          v-if="progressSummary"
          class="meta"
        >Your best: <b>{{ progressSummary }}</b></span>
      </div>
    </div>
  </RouterLink>
</template>

<style scoped>
.tile {
  position: relative;
  isolation: isolate;
  display: flex;
  align-items: flex-end;
  min-height: 100%;
  border-radius: 16px;
  overflow: hidden;
  color: #fff;
  background: linear-gradient(135deg, color-mix(in srgb, var(--tile-color) 55%, #0a182e), #0a182e);
}

.tile-art {
  position: absolute;
  inset: 0;
  z-index: -2;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.6s ease;
}

/* Dark navy scrim from the bottom so the words read on any screenshot. */
.tile::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background: linear-gradient(0deg, rgba(10, 24, 46, 0.92) 0%, rgba(10, 24, 46, 0.55) 30%, rgba(10, 24, 46, 0) 58%);
}

.tile:hover .tile-art,
.tile:focus-visible .tile-art {
  transform: scale(1.05);
}

.tile:focus-visible {
  outline: 3px solid var(--home-accent, #1f6fd1);
  outline-offset: 3px;
}

.badge {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 1;
  padding: 7px 9px;
  border-radius: 4px;
  background: #fff;
  color: var(--home-accent, #1f6fd1);
  font: 9px var(--font-retro);
  letter-spacing: 0.08em;
  box-shadow: 0 2px 8px rgba(10, 24, 46, 0.3);
}

.tile-text {
  display: grid;
  gap: 6px;
  width: 100%;
  padding: 22px 24px;
}

.featured .tile-text {
  gap: 10px;
  padding: 32px;
}

.kind {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #c4dcff;
}

.tile-title {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: -0.02em;
}

.featured .tile-title {
  font-size: 50px;
  letter-spacing: -0.035em;
}

.tile-desc {
  max-width: 46ch;
  font-size: 15px;
  line-height: 1.5;
  color: #d9e0ee;
}

.featured .tile-desc {
  font-size: 17px;
}

/* The big tile shows the full description on wide screens and the tagline on phones. */
.tile-desc-short {
  display: none;
}

.go {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
}

.btn {
  display: inline-flex;
  align-items: center;
  padding: 10px 20px;
  border-radius: 999px;
  background: var(--home-accent, #1f6fd1);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
}

.featured .btn {
  padding: 13px 26px;
  font-size: 16px;
}

.meta {
  font-size: 13px;
  color: #d9e0ee;
}

@media (max-width: 720px) {
  .tile::before {
    background: linear-gradient(0deg, rgba(10, 24, 46, 0.95) 0%, rgba(10, 24, 46, 0.8) 50%, rgba(10, 24, 46, 0) 88%);
  }

  .badge {
    left: auto;
    right: 14px;
  }

  .featured .tile-text {
    padding: 20px;
  }

  .featured .tile-title {
    font-size: 36px;
  }

  .tile-desc-long {
    display: none;
  }

  .tile-desc-short {
    display: block;
  }
}
</style>
