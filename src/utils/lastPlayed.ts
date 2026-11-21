/** The home page features the game the player opened last; this remembers it across visits. */
const LAST_PLAYED_KEY = 'shipping-container-sims-last-played'

export function rememberLastPlayed(simId: string): void {
  try {
    window.localStorage.setItem(LAST_PLAYED_KEY, simId)
  } catch {
    // Storage blocked (private mode): the home page just keeps its default order.
  }
}

export function readLastPlayed(): string | null {
  try {
    return window.localStorage.getItem(LAST_PLAYED_KEY)
  } catch {
    return null
  }
}

/** The games in their usual order, except that the last played one (if still listed) moves to the front. */
export function orderWithFeaturedFirst<T extends { id: string }>(games: readonly T[], lastPlayedId: string | null): T[] {
  const featured = games.find(g => g.id === lastPlayedId)
  if (!featured) return [...games]
  return [featured, ...games.filter(g => g !== featured)]
}
