<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useSimsStore } from '@/stores/sims'
import { useSimRegistry } from '@/composables/useSimRegistry'
import { setHomePageMeta } from '@/composables/useSiteHead'
import { useMenuMusic } from '@/composables/useMenuMusic'
import GameTile from '@/components/GameTile.vue'
import GithubRepoLink from '@/components/GithubRepoLink.vue'
import AudioControls from '@/components/AudioControls.vue'
import { futureGameTeasers } from '@/data/future-game-teasers'
import { trackEvent } from '@/utils/analytics'
import { formatBuildStamp } from '@/utils/buildStamp'
import { orderWithFeaturedFirst, readLastPlayed } from '@/utils/lastPlayed'

const buildStamp = formatBuildStamp({
  buildTime: __BUILD_TIME__,
  commit: __BUILD_COMMIT__,
  isDev: import.meta.env.DEV,
})
const store = useSimsStore()
const { registerAll } = useSimRegistry()
const cookieNoticeVisible = ref(false)
const cookieConsentKey = 'shipping-container-sims-cookie-notice-dismissed'
const lastPlayedId = ref<string | null>(null)

/** Playable games, the one opened last first (it becomes the big tile). */
const games = computed(() => orderWithFeaturedFirst(store.playable, lastPlayedId.value))
const playableCount = computed(() => store.playable.length)

/** Not-yet-playable sims and the future game teasers, shown together as quiet chips. */
const stillBeingBuilt = computed(() => [
  ...store.comingSoon.map(s => ({ id: s.id, title: s.title, tagline: s.tagline })),
  ...futureGameTeasers.map(t => ({ id: t.id, title: t.title, tagline: t.tagline })),
])

useMenuMusic()

onMounted(() => {
  setHomePageMeta()
  registerAll()
  lastPlayedId.value = readLastPlayed()
  setAudioPopoverTheme(true)

  cookieNoticeVisible.value = window.localStorage.getItem(cookieConsentKey) !== 'true'
})

/** The volume popover is teleported to <body>, outside this page: theme it light through its CSS variables. */
const AUDIO_POPOVER_THEME: Record<string, string> = {
  '--audio-popover-bg': '#ffffff',
  '--audio-popover-border': '#d3d9e3',
  '--audio-popover-text': '#0d1b2e',
  '--audio-popover-accent': '#1f6fd1',
  '--audio-popover-active-border': '#1f6fd1',
  '--audio-popover-active-bg': 'rgba(31, 111, 209, 0.12)',
  '--audio-popover-shadow': '0 10px 30px rgba(13, 27, 46, 0.18)',
}

function setAudioPopoverTheme(on: boolean): void {
  const style = document.documentElement.style
  for (const [name, value] of Object.entries(AUDIO_POPOVER_THEME)) {
    if (on) style.setProperty(name, value)
    else style.removeProperty(name)
  }
}

onUnmounted(() => setAudioPopoverTheme(false))

function dismissCookieNotice(): void {
  cookieNoticeVisible.value = false
  window.localStorage.setItem(cookieConsentKey, 'true')
  trackEvent('cookie_notice_dismissed', {
    location: 'home_page',
  })
}
</script>

<template>
  <div class="home">
    <div class="wrap">
      <header class="top">
        <div class="logo">
          SHIPPING <b>CONTAINER</b> SIMS
        </div>
        <nav class="top-nav">
          <GithubRepoLink variant="header" />
          <AudioControls
            placement="inline"
            show-level
          />
        </nav>
      </header>

      <section class="head">
        <h1>Games about the<br><span>boxes</span> that move the world.</h1>
        <p>
          Stack them, stow them, run the port.
          <template v-if="playableCount">
            {{ playableCount }} free games,
          </template>
          straight in your browser.
        </p>
      </section>

      <main>
        <section
          v-if="games.length"
          class="wall"
          aria-label="Games"
        >
          <GameTile
            v-for="(sim, index) in games"
            :key="sim.id"
            :sim="sim"
            :featured="index === 0"
            :resume="index === 0 && sim.id === lastPlayedId"
          />
        </section>

        <section
          v-if="stillBeingBuilt.length"
          class="later"
          aria-label="Still being built"
        >
          <span class="later-label">STILL BEING BUILT</span>
          <span
            v-for="item in stillBeingBuilt"
            :key="item.id"
            class="chip"
          ><b>{{ item.title }}</b>{{ item.tagline }}</span>
        </section>

        <section
          v-if="cookieNoticeVisible"
          class="cookie-notice"
          aria-label="Cookie and analytics notice"
        >
          <p class="cookie-text">
            This site uses a small number of cookies to understand visits and improve the experience.
          </p>
          <button
            type="button"
            class="cookie-dismiss"
            @click="dismissCookieNotice"
          >
            OK
          </button>
        </section>
      </main>

      <footer class="site-footer">
        <span>Shipping Container Sims &copy; {{ new Date().getFullYear() }} &middot; <GithubRepoLink variant="footer" /></span>
        <span
          class="build-stamp"
          data-testid="build-stamp"
        >
          {{ buildStamp.text }}
          <template v-if="buildStamp.commitUrl">
            &middot;
            <a
              :href="buildStamp.commitUrl"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="build-stamp-commit"
            >{{ buildStamp.commit }}</a>
          </template>
        </span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
/* The home page is light (paper and navy, blue accent); the sims keep the dark site tokens from main.css. */
.home {
  --home-bg: #eef1f5;
  --home-line: #d3d9e3;
  --home-ink: #0d1b2e;
  --home-muted: #4a5870;
  --home-accent: #1f6fd1;
  --home-dim: #66738a;
  min-height: 100vh;
  background: var(--home-bg);
  color: var(--home-ink);
  font-family: var(--font-body);
}

.wrap {
  max-width: 1320px;
  margin: 0 auto;
  padding: 0 24px;
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-block: 18px;
}

.logo {
  font: 12px/1.5 var(--font-retro);
  letter-spacing: 0.04em;
}

.logo b {
  color: var(--home-accent);
  font-weight: 400;
}

.top-nav {
  display: flex;
  align-items: center;
  gap: 18px;
}

.top-nav :deep(.github-repo-link) {
  font: 600 14px var(--font-body);
  letter-spacing: 0;
  text-transform: none;
  color: var(--home-muted);
  opacity: 1;
}

.top-nav :deep(.github-repo-link:hover) {
  color: var(--home-ink);
}

/* The shared volume control (speaker button and the slider popover button), restyled for the light page. */
.top-nav :deep(.audio-btn) {
  height: 36px;
  min-width: 36px;
  padding: 0 10px;
  border: 1px solid var(--home-line);
  border-radius: 999px;
  background: #fff;
  color: var(--home-ink);
  font-size: 1rem;
}

.top-nav :deep(.audio-btn:hover) {
  border-color: var(--home-accent);
  background: #fff;
}

.top-nav :deep(.audio-menu-btn) {
  padding: 0 10px 0 12px;
  font-size: 0.7rem;
  color: var(--home-muted);
  --audio-level-color: var(--home-accent);
}

.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 28px;
  padding-block: 14px 22px;
}

.head h1 {
  font-size: 60px;
  font-weight: 700;
  line-height: 0.98;
  letter-spacing: -0.04em;
}

.head h1 span {
  color: var(--home-accent);
}

.head p {
  max-width: 36ch;
  padding-bottom: 6px;
  font-size: 17px;
  line-height: 1.55;
  color: var(--home-muted);
}

/* The wall: the first game big on the left, the next two stacked on its right, the fourth full width,
   any further games half width. */
.wall {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  grid-auto-rows: 150px;
  gap: 14px;
}

.wall > :deep(.tile) {
  grid-column: span 6;
  grid-row: span 3;
}

.wall > :deep(.tile:nth-child(1)) {
  grid-column: span 7;
  grid-row: span 4;
}

.wall > :deep(.tile:nth-child(2)),
.wall > :deep(.tile:nth-child(3)) {
  grid-column: span 5;
  grid-row: span 2;
}

.wall > :deep(.tile:nth-child(4):last-child),
.wall > :deep(.tile:nth-child(1):last-child) {
  grid-column: 1 / -1;
}

.later {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
  padding-block: 30px 6px;
  font-size: 14px;
  color: var(--home-muted);
}

.later-label {
  margin-right: 8px;
  font: 10px var(--font-retro);
  letter-spacing: 0.08em;
  color: var(--home-dim);
}

.chip {
  padding: 9px 14px;
  border: 1px dashed #a9b4c6;
  border-radius: 10px;
}

.chip b {
  display: block;
  font-weight: 600;
  color: var(--home-ink);
}

.cookie-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 24px;
  padding: 12px 16px;
  border: 1px solid var(--home-line);
  border-radius: 10px;
  background: #fff;
}

.cookie-text {
  font-size: 14px;
  color: var(--home-muted);
}

.cookie-dismiss {
  flex: 0 0 auto;
  padding: 8px 18px;
  border: 0;
  border-radius: 999px;
  background: var(--home-accent);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
}

.cookie-dismiss:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--home-accent) 45%, transparent);
  outline-offset: 2px;
}

.site-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px 24px;
  margin-top: 30px;
  padding-block: 22px 28px;
  border-top: 1px solid var(--home-line);
  font-size: 13px;
  color: var(--home-dim);
}

.site-footer :deep(.github-repo-link) {
  font: inherit;
  letter-spacing: 0;
  text-transform: none;
  color: inherit;
  opacity: 1;
  vertical-align: bottom;
}

.build-stamp a {
  color: inherit;
  text-decoration: underline;
}

@media (max-width: 960px) {
  .wall {
    grid-auto-rows: 130px;
  }

  .wall > :deep(.tile:nth-child(1)) {
    grid-column: span 12;
    grid-row: span 3;
  }

  .wall > :deep(.tile:nth-child(2)),
  .wall > :deep(.tile:nth-child(3)) {
    grid-column: span 6;
  }

  .head {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .head h1 {
    font-size: 44px;
  }
}

@media (max-width: 720px) {
  .wrap {
    padding: 0 14px;
  }

  .logo {
    font-size: 9px;
  }

  .top-nav {
    gap: 10px;
  }

  .top-nav :deep(.github-label) {
    display: none;
  }

  .head h1 {
    font-size: 34px;
  }

  .wall {
    grid-template-columns: 1fr;
    grid-auto-rows: auto;
    gap: 12px;
  }

  .wall > :deep(.tile),
  .wall > :deep(.tile:nth-child(n)) {
    grid-column: auto;
    grid-row: auto;
    min-height: 250px;
  }

  .wall > :deep(.tile:nth-child(1)) {
    min-height: 340px;
  }

  .cookie-notice {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
