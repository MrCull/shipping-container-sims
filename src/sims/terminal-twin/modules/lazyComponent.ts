/**
 * Loading state for an on-demand component chunk (the dashboard). Unlike a bare
 * `defineAsyncComponent`, it exposes `loading | ready | error` so the host can
 * show a spinner line while the chunk is fetched and a message with a retry when
 * the fetch fails, instead of rendering nothing.
 */
import { markRaw, ref, shallowRef, type Component, type Ref, type ShallowRef } from 'vue'

export type LazyState = 'loading' | 'ready' | 'error'

export interface LazyComponent {
  state: Ref<LazyState>
  error: Ref<string>
  component: ShallowRef<Component | null>
  /** Fetch the chunk (also the retry after a failure); a newer call supersedes an older one still in flight. */
  load: () => Promise<void>
}

export function createLazyComponent(importer: () => Promise<{ default: Component }>): LazyComponent {
  const state = ref<LazyState>('loading')
  const error = ref('')
  const component = shallowRef<Component | null>(null)
  let latest = 0

  async function load(): Promise<void> {
    const mine = ++latest
    state.value = 'loading'
    error.value = ''
    try {
      const mod = await importer()
      if (mine !== latest) return
      component.value = markRaw(mod.default)
      state.value = 'ready'
    } catch (err) {
      if (mine !== latest) return
      error.value = err instanceof Error ? err.message : String(err)
      state.value = 'error'
    }
  }

  return { state, error, component, load }
}
