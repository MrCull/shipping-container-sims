import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { SimDefinition } from '@/types/sim'

export const useSimsStore = defineStore('sims', () => {
  const sims = ref<SimDefinition[]>([])

  const playable = computed(() =>
    sims.value
      .filter(s => s.status === 'playable')
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999)),
  )
  const comingSoon = computed(() =>
    sims.value
      .filter(s => s.status !== 'playable')
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999)),
  )

  function register(sim: SimDefinition) {
    const idx = sims.value.findIndex(s => s.id === sim.id)
    if (idx >= 0) {
      sims.value[idx] = sim
    } else {
      sims.value.push(sim)
    }
  }

  function getById(id: string): SimDefinition | undefined {
    return sims.value.find(s => s.id === id)
  }

  return { sims, playable, comingSoon, register, getById }
})
