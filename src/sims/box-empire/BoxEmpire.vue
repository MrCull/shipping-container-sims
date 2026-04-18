<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useGameStore } from './store/gameStore'
import { useGodModeHotkey } from '@/composables/useGodModeHotkey'
import GameCanvas from './components/GameCanvas.vue'
import TopBar from './components/TopBar.vue'
import EventFeed from './components/EventFeed.vue'
import NarratorDialog from './components/ui/NarratorDialog.vue'
import JobQueueWidget from './components/ui/JobQueueWidget.vue'
import ContainerInfo from './components/ContainerInfo.vue'
import EquipmentInfo from './components/EquipmentInfo.vue'
import GatehouseInfo from './components/GatehouseInfo.vue'
import VesselInfo from './components/VesselInfo.vue'
import StartScreen from './components/modals/StartScreen.vue'
import TutorialComplete from './components/modals/TutorialComplete.vue'
import CareerIntroModal from './components/modals/CareerIntroModal.vue'
import SandboxOnboarding from './components/modals/SandboxOnboarding.vue'
import KeyboardHint from './components/ui/KeyboardHint.vue'

const store = useGameStore()
useGodModeHotkey()

const showSandboxOnboarding = ref(false)

onMounted(() => {
  store.resetToMenu()
})

function handleStart(): void {
  store.initTutorial()
}

function handleRestart(): void {
  store.initTutorial()
}

function handleContinueCareer(): void {
  store.beginCareerIntro()
}

function handleSandbox(): void {
  store.startSandboxMode()
  showSandboxOnboarding.value = true
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
          || store.gamePhase === 'sandbox'
      "
    >
      <TopBar />
      <NarratorDialog v-if="store.gamePhase !== 'sandbox'" />
      <EventFeed />
      <ContainerInfo />
      <EquipmentInfo />
      <GatehouseInfo />
      <VesselInfo />
      <JobQueueWidget />
    </template>

    <StartScreen
      v-if="store.gamePhase === 'menu'"
      @start="handleStart"
      @sandbox="handleSandbox"
    />

    <TutorialComplete
      v-if="store.gamePhase === 'completed'"
      @restart="handleRestart"
      @continue-career="handleContinueCareer"
      @sandbox="handleSandbox"
    />

    <CareerIntroModal
      v-if="store.gamePhase === 'career_intro'"
      @play-tutorial-again="handlePlayTutorialFromCareer"
    />

    <SandboxOnboarding
      v-if="showSandboxOnboarding"
      @done="showSandboxOnboarding = false"
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
