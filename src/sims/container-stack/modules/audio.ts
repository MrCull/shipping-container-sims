function assetUrl(filename: string): string {
  return new URL(`../assets/audio/${filename}`, import.meta.url).href
}

export const SOUNDS: Record<string, string> = {
  containerLoad: assetUrl('container-loaded-to-ship.mp3'),
  containerSet: assetUrl('container-set-down-on-ship.mp3'),
  correctDing: assetUrl('correct-ding.mp3'),
  bonus: assetUrl('gaming-bonus-sound.mp3'),
  negative: assetUrl('gaming-negative-event-sound.mp3'),
  levelUp: assetUrl('level-up.mp3'),
  hornsLevelUp: assetUrl('horns-level-up.mp3'),
  caChing: assetUrl('money-increase-ca-ching-.mp3'),
  scream: assetUrl('man-screaming.mp3'),
  explosionFx: assetUrl('explosion-fx.mp3'),
  levelPassedOk: assetUrl('level-passed-ok.mp3'),
  tickClock: assetUrl('level-up-quick-sound.mp3'),
  countdownTick: assetUrl('correct-ding.mp3'),
  countdownUrgent: assetUrl('countdown-urgent.mp3'),
}

export interface SoundCue {
  key: string
  delay: number
  volume?: number
}

export const COLLAPSE_SEQUENCE: SoundCue[] = [
  { key: 'containerLoad', delay: 0, volume: 0.55 },
  { key: 'negative', delay: 0.08, volume: 0.85 },
  { key: 'explosionFx', delay: 0.12, volume: 0.72 },
]
