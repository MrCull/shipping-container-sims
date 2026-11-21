import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './assets/main.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
// Smoke tests reuse one booted page per worker (#329): dev and smoke builds expose a reset (src/utils/smokeReset.ts).
if (import.meta.env.DEV || import.meta.env.MODE === 'smoke') {
  void import('./utils/smokeReset').then(({ installSmokeReset }) => installSmokeReset(router, pinia))
}
app.mount('#app')
