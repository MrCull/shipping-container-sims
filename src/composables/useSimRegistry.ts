import { useSimsStore } from '@/stores/sims'
import type { SimDefinition } from '@/types/sim'

/**
 * Registers all known sims into the Pinia store via glob discovery.
 * When adding a playable sim, add its `/sim/{id}` URL to `public/sitemap.xml` for SEO.
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
