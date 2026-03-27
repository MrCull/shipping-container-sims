function assetUrl(filename: string): string {
  return new URL(`../assets/audio/${filename}`, import.meta.url).href
}

export const SOUNDS: Record<string, string> = {
  // Placement sounds
  containerLoad: assetUrl('container-loaded-to-ship.mp3'),
  containerSet: assetUrl('container-set-down-on-ship.mp3'),
  correctDing: assetUrl('correct-ding.mp3'),

  // Bonus / reward sounds
  bonus: assetUrl('gaming-bonus-sound.mp3'),
  negative: assetUrl('gaming-negative-event-sound.mp3'),
  cheer: assetUrl('group-yay-cheer.mp3'),
  levelUp: assetUrl('horns-level-up.mp3'),
  levelPassed: assetUrl('level-passed-ok.mp3'),
  caChing: assetUrl('money-increase-ca-ching-.mp3'),
  moneyGame: assetUrl('money-increase-game-sound.mp3'),
  jackpot: assetUrl('positive-high-score-reached-like-jackpot-4-seconds.wav'),

  // Timer sounds
  clockTicking: assetUrl('clock-ticking-8-seconds.mp3'),
  countdownBoom: assetUrl('20-seconds-increating-pitch-countdown-then-5-seconds-of-boom.mp3'),
  boo: assetUrl('boo-3-seconds.mp3'),

  // Ship horns
  shipHornLarge: assetUrl('large-ship-three-horns-in-a-row.mp3'),
  shipHornSmall: assetUrl('small-ship-three-horns-in-a-row.mp3'),

  // Disaster sounds
  scream: assetUrl('man-screaming.mp3'),
  explosionFx: assetUrl('explosion-fx.mp3'),
  sinkSplash: assetUrl('ship-sink-splash.mp3'),
  underwaterExplosion: assetUrl('underwater-explosion.mp3'),
  waterSplash: assetUrl('water-splash.mp3'),

  // Ambient
  truckEngine: assetUrl('quiet-truck-engine.mp3'),
}

export interface SoundCue {
  sound: string
  delay: number
}

export const DISASTER_SEQUENCES: Record<string, SoundCue[]> = {
  capsize: [
    { sound: 'negative', delay: 0 },
    { sound: 'scream', delay: 0.3 },
    { sound: 'sinkSplash', delay: 1.0 },
    { sound: 'waterSplash', delay: 1.8 },
  ],
  founder: [
    { sound: 'negative', delay: 0 },
    { sound: 'scream', delay: 0.4 },
    { sound: 'sinkSplash', delay: 0.8 },
    { sound: 'waterSplash', delay: 2.0 },
  ],
  collapse: [
    { sound: 'negative', delay: 0 },
    { sound: 'scream', delay: 0.5 },
    { sound: 'negative', delay: 1.2 },
  ],
  explosion: [
    { sound: 'explosionFx', delay: 0 },
    { sound: 'scream', delay: 0.2 },
    { sound: 'underwaterExplosion', delay: 1.0 },
    { sound: 'negative', delay: 2.0 },
  ],
}

export const PLACEMENT_SOUND = {
  startFreq: 220,
  endFreq: 110,
  duration: 0.12,
} as const
