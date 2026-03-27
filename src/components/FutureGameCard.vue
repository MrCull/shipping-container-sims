<script setup lang="ts">
import type { FutureGameTeaser } from '@/types/future-game-teaser'

defineProps<{
  teaser: FutureGameTeaser
}>()
</script>

<template>
  <article
    class="future-card"
    :style="{ '--card-accent': teaser.color }"
  >
    <div class="card-top">
      <div class="card-icon">
        {{ teaser.icon }}
      </div>
      <span class="card-status">◆ PLANNED</span>
    </div>

    <h3 class="card-title">
      {{ teaser.title }}
    </h3>
    <p class="card-tagline">
      {{ teaser.tagline }}
    </p>
    <p
      class="card-desc"
      :title="teaser.description"
    >
      {{ teaser.description }}
    </p>

    <div class="card-tags">
      <span
        v-for="tag in teaser.tags"
        :key="tag"
        class="tag"
      >{{ tag }}</span>
    </div>

    <div class="scanline" />
  </article>
</template>

<style scoped>
.future-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1.1rem;
  background: linear-gradient(
    145deg,
    rgba(17, 24, 39, 0.95) 0%,
    color-mix(in srgb, var(--card-accent) 8%, var(--color-bg-card)) 100%
  );
  border: 1px dashed color-mix(in srgb, var(--card-accent) 45%, var(--color-border));
  border-radius: 8px;
  overflow: hidden;
  aspect-ratio: 1 / 1;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
}

.future-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 3px;
  background: linear-gradient(
    90deg,
    transparent,
    var(--card-accent),
    transparent
  );
  opacity: 0.65;
}

.scanline {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(255, 255, 255, 0.012) 2px,
    rgba(255, 255, 255, 0.012) 4px
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
  background: color-mix(in srgb, var(--card-accent) 12%, rgba(255, 255, 255, 0.04));
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--card-accent) 35%, var(--color-border));
  flex-shrink: 0;
}

.card-title {
  font-family: var(--font-retro);
  font-size: 0.7rem;
  line-height: 1.5;
  color: var(--color-text);
}

.card-tagline {
  font-size: 0.75rem;
  color: var(--card-accent);
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
  background: color-mix(in srgb, var(--card-accent) 10%, rgba(255, 255, 255, 0.04));
  color: var(--color-text-muted);
  border: 1px solid color-mix(in srgb, var(--card-accent) 25%, var(--color-border));
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.card-status {
  font-family: var(--font-retro);
  font-size: 0.5rem;
  white-space: nowrap;
  color: var(--card-accent);
  padding-top: 0.35rem;
  letter-spacing: 0.12em;
  opacity: 0.9;
}
</style>
