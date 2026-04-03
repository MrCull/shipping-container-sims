<script setup lang="ts">
import { useGameStore } from './store/gameStore'
import { useGodModeHotkey } from '@/composables/useGodModeHotkey'
import GameCanvas from './components/GameCanvas.vue'
import TopBar from './components/TopBar.vue'
import EventFeed from './components/EventFeed.vue'
import NarratorDialog from './components/ui/NarratorDialog.vue'
import JobQueueWidget from './components/ui/JobQueueWidget.vue'
import ContainerInfo from './components/ContainerInfo.vue'
import EquipmentInfo from './components/EquipmentInfo.vue'
import StartScreen from './components/modals/StartScreen.vue'
import TutorialComplete from './components/modals/TutorialComplete.vue'
import CareerIntroModal from './components/modals/CareerIntroModal.vue'
import KeyboardHint from './components/ui/KeyboardHint.vue'

const store = useGameStore()
useGodModeHotkey()

function handleStart(): void {
  store.initTutorial()
}

function handleRestart(): void {
  store.initTutorial()
}

function handleContinueCareer(): void {
  store.beginCareerIntro()
}

function handlePlayTutorialFromCareer(): void {
  store.initTutorial()
}
</script>

<template>
  <div class="box-empire">
    <GameCanvas />

    <template
      v-if="
        store.gamePhase === 'tutorial'
          || store.gamePhase === 'playing'
          || store.gamePhase === 'completed'
          || store.gamePhase === 'career_intro'
      "
    >
      <TopBar />
      <NarratorDialog />
      <EventFeed />
      <ContainerInfo />
      <EquipmentInfo />
      <JobQueueWidget />
    </template>

    <StartScreen
      v-if="store.gamePhase === 'menu'"
      @start="handleStart"
    />

    <TutorialComplete
      v-if="store.gamePhase === 'completed'"
      @restart="handleRestart"
      @continue-career="handleContinueCareer"
    />

    <CareerIntroModal
      v-if="store.gamePhase === 'career_intro'"
      @play-tutorial-again="handlePlayTutorialFromCareer"
    />

    <KeyboardHint />
  </div>
</template>

<style scoped>
.box-empire {
  flex: 1;
  display: flex;
  position: relative;
  width: 100%;
  min-height: 0;
  overflow: hidden;
  background: #0a0e1a;
}
</style>
