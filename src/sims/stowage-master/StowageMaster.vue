<script setup lang="ts">
import { onMounted } from 'vue'
import { useGameStore } from './store/gameStore'
import GameCanvas from './components/GameCanvas.vue'
import TopBar from './components/TopBar.vue'
import ContainerInfo from './components/ContainerInfo.vue'
import LoadList from './components/LoadList.vue'
import PortLegend from './components/PortLegend.vue'
import ShipStatus from './components/ShipStatus.vue'
import LastPlacement from './components/LastPlacement.vue'
import LastDischarge from './components/LastDischarge.vue'
import ScorePopup from './components/ScorePopup.vue'
import EventFeed from './components/EventFeed.vue'
import MoveCounter from './components/MoveCounter.vue'
import TimerWidget from './components/TimerWidget.vue'
import DischargeBar from './components/ui/DischargeBar.vue'
import StartScreen from './components/modals/StartScreen.vue'
import LevelComplete from './components/modals/LevelComplete.vue'
import LevelFailed from './components/modals/LevelFailed.vue'
import DisasterOverlay from './components/modals/DisasterOverlay.vue'

const store = useGameStore()

onMounted(() => {
  // Reset to the start screen every time this component mounts — handles
  // returning from the main menu mid-game.
  store.setPhase('start')
})
</script>

<template>
  <div class="stowage-master">
    <GameCanvas />
    <TopBar />
    <ContainerInfo />
    <LoadList />
    <PortLegend />
    <ShipStatus />
    <LastPlacement />
    <LastDischarge />
    <ScorePopup />
    <EventFeed />
    <MoveCounter />
    <TimerWidget />
    <DischargeBar />
    <StartScreen />
    <LevelComplete />
    <LevelFailed />
    <DisasterOverlay />
  </div>
</template>

<style scoped>
.stowage-master {
  flex: 1;
  display: flex;
  position: relative;
  overflow: hidden;
  background: #0a0e1a;
  font-family: var(--font-body);
  color: #eee;
}
</style>
