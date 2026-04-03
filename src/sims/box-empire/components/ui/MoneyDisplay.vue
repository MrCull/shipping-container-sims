<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGameStore } from '../../store/gameStore'

const store = useGameStore()
const displayMoney = ref(0)
const showChange = ref(false)
const changeAmount = ref(0)
const isNegativeBalance = computed(() => displayMoney.value < 0)
const isNegativeChange = computed(() => changeAmount.value < 0)

watch(() => store.money, (newVal, oldVal) => {
  const diff = newVal - (oldVal ?? 0)
  if (diff !== 0) {
    changeAmount.value = diff
    showChange.value = true
    setTimeout(() => { showChange.value = false }, 1200)
  }
  displayMoney.value = newVal
})
</script>

<template>
  <div class="money-display">
    <span class="money-icon">💰</span>
    <span
      :class="['money-amount', isNegativeBalance ? 'negative' : 'positive']"
    >${{ displayMoney.toLocaleString() }}</span>
    <transition name="fade">
      <span
        v-if="showChange"
        :class="['money-change', isNegativeChange ? 'negative' : 'positive']"
      >{{ changeAmount > 0 ? '+' : '' }}${{ changeAmount }}</span>
    </transition>
  </div>
</template>

<style scoped>
.money-display {
  display: flex;
  align-items: center;
  gap: 6px;
  position: relative;
}

.money-icon {
  font-size: 1.2rem;
}

.money-amount {
  font-family: var(--font-retro, monospace);
  font-size: 1.1rem;
  font-weight: bold;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}

.money-amount.positive {
  color: #2ecc71;
}

.money-amount.negative {
  color: #e74c3c;
}

.money-change {
  font-family: var(--font-retro, monospace);
  font-size: 0.9rem;
  font-weight: bold;
  animation: float-up 1.2s ease-out;
  position: absolute;
  right: -50px;
  top: -8px;
}

.money-change.positive {
  color: #f1c40f;
}

.money-change.negative {
  color: #e74c3c;
}

@keyframes float-up {
  0% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-20px); }
}

.fade-enter-active { transition: opacity 0.2s; }
.fade-leave-active { transition: opacity 0.5s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
