// In-memory-only holder for the player's OpenRouter API key.
//
// Rules:
// - The key is NEVER written to localStorage, sessionStorage, IndexedDB, cookies, Pinia
//   state, console.*, trackEvent, the Jev inspector history, error messages, or the URL.
// - The Pinia store (`store/jevStore.ts`) mirrors only a boolean `hasKey`, so Vue devtools
//   never shows the key.
// - The key lives in this module-scoped variable only, so it is lost on a full page reload
//   but survives in-app (SPA) route changes — that counts as "in memory for this tab".
// - `clearApiKey()` runs on "Forget key", on "Disable Jev", and automatically on a 401/403.
// - The key input field must be `type="password"`, `autocomplete="off"`, `spellcheck="false"`,
//   with no `name` attribute (so browsers don't offer to save it); clear the input's ref as
//   soon as the key is handed to the vault.
// - A key typed on this page is visible in the tab's memory and the network panel to someone
//   at the player's own machine. This is accepted for bring-your-own-key and disclosed in the
//   key dialog (plan 04).
//
// Only jevClient.ts should import getApiKeyForRequest().

let apiKey: string | null = null

export function setApiKey(key: string): void {
  apiKey = key.trim() || null
}

export function clearApiKey(): void {
  apiKey = null
}

export function hasApiKey(): boolean {
  return apiKey !== null
}

/** Only jevClient.ts should import this. */
export function getApiKeyForRequest(): string | null {
  return apiKey
}
