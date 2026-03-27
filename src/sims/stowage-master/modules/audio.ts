function assetUrl(filename: string): string {
  return new URL(`../assets/audio/${filename}`, import.meta.url).href
}

export const SOUNDS: Record<string, string> = {
  explosion: assetUrl('explosion-fx.mp3'),
  scream: assetUrl('man-screaming.mp3'),
  shipSink: assetUrl('ship-sink-splash.mp3'),
  underwater: assetUrl('underwater-explosion.mp3'),
  splash: assetUrl('water-splash.mp3'),
}

export interface SoundCue {
  sound: string
  delay: number
}

export const DISASTER_SEQUENCES: Record<string, SoundCue[]> = {
  capsize: [
    { sound: 'scream', delay: 0 },
    { sound: 'splash', delay: 0.8 },
    { sound: 'shipSink', delay: 1.5 },
    { sound: 'underwater', delay: 2.5 },
  ],
  founder: [
    { sound: 'scream', delay: 0 },
    { sound: 'shipSink', delay: 0.5 },
    { sound: 'underwater', delay: 1.5 },
    { sound: 'splash', delay: 2.5 },
  ],
  collapse: [
    { sound: 'explosion', delay: 0 },
    { sound: 'splash', delay: 1.0 },
  ],
  explosion: [
    { sound: 'explosion', delay: 0 },
    { sound: 'scream', delay: 0.3 },
    { sound: 'explosion', delay: 1.0 },
    { sound: 'shipSink', delay: 2.0 },
    { sound: 'underwater', delay: 3.0 },
  ],
}

export const PLACEMENT_SOUND = {
  startFreq: 80,
  endFreq: 40,
  duration: 0.15,
} as const
