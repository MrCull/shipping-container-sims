import { useSimsStore } from '@/stores/sims'
import type { SimDefinition } from '@/types/sim'

/**
 * Registers all known sims into the Pinia store.
 * Each sim folder exports a `definition` that gets registered here.
 * When adding a new sim, import its definition and add it to the array below.
 */
export function useSimRegistry() {
  const store = useSimsStore()

  async function registerAll() {
    const modules = import.meta.glob<{ definition: SimDefinition }>(
      '@/sims/*/definition.ts',
      { eager: true }
    )

    for (const mod of Object.values(modules)) {
      store.register(mod.definition)
    }
  }

  return { registerAll }
}
