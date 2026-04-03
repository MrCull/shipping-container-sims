export type AnalyticsParams = Record<string, string | number | boolean | null | undefined>

type GtagCommand = 'config' | 'event' | 'set' | 'js'

type Gtag = (command: GtagCommand, target: string | Date, params?: AnalyticsParams) => void

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: Gtag
  }
}

const GA_MEASUREMENT_ID = 'G-BFB7E3CEPZ'

function hasGtag(): boolean {
  return typeof window !== 'undefined' && typeof window.gtag === 'function'
}

function sendGtag(command: GtagCommand, target: string | Date, params?: AnalyticsParams): void {
  if (!hasGtag()) return
  window.gtag?.(command, target, params)
}

export function trackPageView(pagePath: string, pageTitle?: string): void {
  sendGtag('event', 'page_view', {
    page_path: pagePath,
    page_title: pageTitle ?? (typeof document !== 'undefined' ? document.title : undefined),
    page_location: typeof window !== 'undefined' ? window.location.href : undefined,
    send_to: GA_MEASUREMENT_ID,
  })
}

export function trackEvent(eventName: string, params: AnalyticsParams = {}): void {
  sendGtag('event', eventName, {
    ...params,
    send_to: GA_MEASUREMENT_ID,
  })
}
