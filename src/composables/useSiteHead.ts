import { watch } from 'vue'
import type { SimDefinition } from '@/types/sim'

/** Production site origin; override with VITE_SITE_ORIGIN in .env for previews. */
export function getSiteOrigin(): string {
  const fromEnv = import.meta.env.VITE_SITE_ORIGIN
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return fromEnv.replace(/\/$/, '')
  }
  return 'https://container-games.net'
}

const SITE_NAME = 'Shipping Container Sims'
const DEFAULT_TITLE = `${SITE_NAME} | Port & logistics browser games`
const DEFAULT_DESCRIPTION =
  'Play free 3D shipping-container games in your browser: stack towers in Contenga, plan vessel stowage in ' +
  'Stowage Master, and build a logistics empire in Box Empire. Stack, ship, and simulate — no install required.'

function ensureMeta(attr: 'name' | 'property', key: string): HTMLMetaElement {
  const selector = attr === 'name' ? `meta[name="${key}"]` : `meta[property="${key}"]`
  let el = document.head.querySelector(selector) as HTMLMetaElement | null
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  return el
}

function setLinkRel(rel: string, href: string): void {
  let el = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    document.head.appendChild(el)
  }
  el.href = href
}

export function applySiteMeta(opts: {
  title: string
  description: string
  canonicalPath: string
  ogType?: 'website' | 'article'
}): void {
  const origin = getSiteOrigin()
  const path = opts.canonicalPath.startsWith('/') ? opts.canonicalPath : `/${opts.canonicalPath}`
  const canonical = `${origin}${path === '//' ? '/' : path}`

  document.title = opts.title

  ensureMeta('name', 'description').content = opts.description
  setLinkRel('canonical', canonical)

  ensureMeta('property', 'og:type').content = opts.ogType ?? 'website'
  ensureMeta('property', 'og:site_name').content = SITE_NAME
  ensureMeta('property', 'og:title').content = opts.title
  ensureMeta('property', 'og:description').content = opts.description
  ensureMeta('property', 'og:url').content = canonical

  const shareImage = `${origin}/favicon.svg`
  ensureMeta('property', 'og:image').content = shareImage
  ensureMeta('name', 'twitter:image').content = shareImage

  ensureMeta('name', 'twitter:card').content = 'summary'
  ensureMeta('name', 'twitter:title').content = opts.title
  ensureMeta('name', 'twitter:description').content = opts.description
}

export function setHomePageMeta(): void {
  applySiteMeta({
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    canonicalPath: '/',
  })
}

export function setSimPageMeta(sim: SimDefinition): void {
  const description = `${sim.tagline} ${sim.description}`.replace(/\s+/g, ' ').trim()
  applySiteMeta({
    title: `${sim.icon} ${sim.title} | ${SITE_NAME}`,
    description,
    canonicalPath: `/sim/${sim.id}`,
  })
}

export function setSimNotFoundMeta(simId: string): void {
  applySiteMeta({
    title: `Game not found | ${SITE_NAME}`,
    description: `No game matches “${simId}” on ${SITE_NAME}. Browse container stacking, stowage, and tycoon games on the home page.`,
    canonicalPath: '/',
  })
}

/** Call from SimPage: keeps document title and meta in sync when sim loads or route changes. */
export function watchSimHead(
  getSim: () => SimDefinition | undefined,
  getSimId: () => string,
): () => void {
  return watch(
    () => [getSimId(), getSim()] as const,
    ([id, sim]) => {
      if (sim) setSimPageMeta(sim)
      else setSimNotFoundMeta(id)
    },
    { immediate: true },
  )
}
