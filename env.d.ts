/// <reference types="vite/client" />

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
