/// <reference types="vite/client" />

/** Injected by Vite `define` (vite.config.ts): ISO build time and short commit hash ("" without git). */
declare const __BUILD_TIME__: string
declare const __BUILD_COMMIT__: string

interface ImportMetaEnv {
  /** Optional absolute site URL for canonical/OG tags (e.g. https://staging.example.com). */
  readonly VITE_SITE_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

declare module '*.mp3' {
  const src: string
  export default src
}
