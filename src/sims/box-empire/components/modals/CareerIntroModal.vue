<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../../store/gameStore'

const store = useGameStore()

const LAST_STORY_PAGE = 3
const TOTAL_PAGES = 4

const isComingSoonPage = computed(() => store.careerIntroPage === TOTAL_PAGES)

const title = computed(() => {
  switch (store.careerIntroPage) {
    case 1:
      return 'An unexpected inheritance'
    case 2:
      return 'Rust and quiet berths'
    case 3:
      return 'Your chapter'
    case 4:
      return 'Career mode'
    default:
      return ''
  }
})

const body = computed(() => {
  switch (store.careerIntroPage) {
    case 1:
      return 'A letter arrives from a solicitor you never expected to hear from. A relative you barely knew has passed away, and among the paperwork is a deed to a small container terminal on the coast — yours now, free and clear.'
    case 2:
      return 'They loved the idea of the port life, but the books tell a gentler story: years of thin margins, aging cranes, and vessels that only called when larger terminals were full. The yard has heart, but it has not been a winning business.'
    case 3:
      return 'That changes with you. You will earn money one job at a time, keep the gate and quay humming, and reinvest over time — refurbishing tired equipment, buying better tools when you can afford them, and eventually welcoming more boxes and bigger ships. Small wins first; ambition later.'
    case 4:
      return 'The full career campaign — upgrades, deeper economics, escalating traffic, and those larger vessels — is still in development. Thank you for playing the tutorial; the rest of the story will dock here when it is ready.'
    default:
      return ''
  }
})

function onPrimary(): void {
  if (isComingSoonPage.value) {
    store.exitCareerIntroToMenu()
  } else {
    store.advanceCareerIntro()
  }
}

const emit = defineEmits<{
  playTutorialAgain: []
}>()
</script>

<template>
  <div class="career-screen">
    <div class="career-modal">
      <p class="page-indicator">
        {{ store.careerIntroPage }} / {{ TOTAL_PAGES }}
      </p>
      <h1 class="career-title">
        {{ title }}
      </h1>
      <p class="career-body">
        {{ body }}
      </p>

      <div
        v-if="isComingSoonPage"
        class="coming-soon-badge"
      >
        Coming soon
      </div>

      <div class="actions">
        <button
          type="button"
          class="primary-btn"
          @click="onPrimary"
        >
          {{ isComingSoonPage ? 'Back to start' : (store.careerIntroPage < LAST_STORY_PAGE ? 'Next' : 'Continue') }}
        </button>
        <button
          v-if="isComingSoonPage"
          type="button"
          class="secondary-btn"
          @click="emit('playTutorialAgain')"
        >
          Play tutorial again
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.career-screen {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.88);
  z-index: 110;
}

.career-modal {
  background: linear-gradient(145deg, #141e30 0%, #1a1a2e 55%, #16213e 100%);
  border: 2px solid rgba(46, 204, 113, 0.55);
  border-radius: 16px;
  padding: 36px 44px;
  max-width: 520px;
  text-align: center;
  box-shadow: 0 10px 48px rgba(46, 204, 113, 0.12);
  animation: modal-pop 0.35s ease-out;
}

@keyframes modal-pop {
  0% {
    transform: scale(0.92);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.page-indicator {
  font-family: var(--font-retro, monospace);
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.45);
  margin: 0 0 12px 0;
  letter-spacing: 0.06em;
}

.career-title {
  font-family: var(--font-retro, monospace);
  font-size: 1.35rem;
  color: #2ecc71;
  margin: 0 0 16px 0;
  text-shadow: 0 2px 14px rgba(46, 204, 113, 0.25);
  line-height: 1.25;
}

.career-body {
  font-family: var(--font-retro, monospace);
  font-size: 0.82rem;
  color: rgba(255, 255, 255, 0.82);
  line-height: 1.65;
  margin: 0 0 22px 0;
  text-align: left;
}

.coming-soon-badge {
  display: inline-block;
  font-family: var(--font-retro, monospace);
  font-size: 0.72rem;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: #f1c40f;
  border: 1px solid rgba(241, 196, 15, 0.45);
  background: rgba(241, 196, 15, 0.1);
  border-radius: 8px;
  padding: 8px 18px;
  margin-bottom: 20px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
}

.primary-btn {
  padding: 10px 26px;
  border: 2px solid #2ecc71;
  border-radius: 8px;
  background: #2ecc71;
  color: #0a1628;
  font-family: var(--font-retro, monospace);
  font-size: 0.88rem;
  font-weight: bold;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}

.primary-btn:hover {
  transform: scale(1.03);
  box-shadow: 0 4px 22px rgba(46, 204, 113, 0.45);
}

.secondary-btn {
  padding: 10px 22px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.88);
  font-family: var(--font-retro, monospace);
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.secondary-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.55);
}
</style>
