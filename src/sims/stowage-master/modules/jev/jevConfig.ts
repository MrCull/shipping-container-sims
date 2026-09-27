// Every Jev tunable lives here — never inline in client/store/controller code.

export const JEV_CONFIG = {
  endpoint: 'https://openrouter.ai/api/alpha/decisions',
  keyInfoEndpoint: 'https://openrouter.ai/api/v1/key',
  model: 'typesafe/jev-1.13',
  appTitle: 'Shipping Container Sims – Stowage Master',
  requestTimeoutMs: 20_000,
  maxRetryAfterMs: 10_000,
  retriesPerMove: 1, // "retry once, then pause"
  defaultSettleDelayMs: 350, // see plan 03 §3.4
  maxStateTokensEstimate: 24_000, // leave headroom under the 32K context (plan 02 §2.7)
  historyLimit: 50, // inspector exchanges kept in memory
  stateSchemaVersion: 'sm-jev-state-v1',
  questionVersion: 'sm-jev-q-v1',
  prefsStorageKey: 'stowage-master-jev-prefs', // prefs only, NEVER the key
} as const
