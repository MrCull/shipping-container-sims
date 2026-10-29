<script setup lang="ts">
import { computed } from 'vue'
import { useTwinStore } from '../store/twinStore'
import { t } from '../i18n/messages'

const store = useTwinStore()
const text = computed(() => {
  const b = store.banner
  if (!b) return ''
  if (b.kind === 'complete') return t('twin.banner.complete')
  return b.vesselName ? t('twin.banner.departure', { name: b.vesselName }) : t('twin.banner.departureUnnamed')
})
</script>

<template>
  <div
    v-if="store.banner"
    :key="store.banner.id"
    class="departure-banner"
    :class="store.banner.kind"
    role="status"
    data-testid="tt-departure-banner"
  >
    {{ text }}
  </div>
</template>

<style scoped>
/* Decorative and click-through: it never blocks the 3D view or the controls beneath it. */
.departure-banner {
  grid-column: 2;
  grid-row: 2;
  align-self: start;
  justify-self: center;
  position: relative;
  margin-top: 0.6rem;
  z-index: 7;
  pointer-events: none;
  padding: 0.45rem 1.2rem;
  border-radius: 999px;
  border: 1px solid var(--color-accent);
  background: rgba(17, 24, 39, 0.88);
  color: var(--color-text);
  font-size: 0.9rem;
  box-shadow: 0 0 14px rgba(245, 158, 11, 0.35);
  animation: tt-banner 3.5s ease-in-out forwards;
}

@keyframes tt-banner {
  0% {
    opacity: 0;
    transform: translateY(-0.8rem);
  }
  10%,
  80% {
    opacity: 1;
    transform: translateY(0);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .departure-banner {
    animation: tt-banner-fade 3.5s forwards;
  }

  @keyframes tt-banner-fade {
    0%,
    80% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
}
</style>
