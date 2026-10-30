/** Friendly text for the engine's `ScenarioEnded` reason ("moves >= 4", …), through the message catalogue. */
import type { Formatter } from '../i18n/format'
import { t } from '../i18n/messages'

export function describeEndReason(reason: string | null, fmt: Formatter): string {
  if (!reason) return ''
  const match = /^(moves|simDurationS|vesselsCompleted) >= (\d+(?:\.\d+)?)$/.exec(reason)
  if (!match) return t('endReason.other', { reason })
  const n = Number(match[2])
  if (match[1] === 'moves') return t('endReason.moves', { n: fmt.number(n, 0) })
  if (match[1] === 'simDurationS') return t('endReason.duration', { duration: fmt.duration(n) })
  return t('endReason.vessels', { n: fmt.number(n, 0) })
}
