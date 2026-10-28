/** Friendly copy for the final report's highlights, through the message catalogue and the shared formatter. */
import type { Highlight } from '../engine'
import type { Formatter } from '../i18n/format'
import { t } from '../i18n/messages'

export function highlightText(h: Highlight, fmt: Formatter): string {
  switch (h.kind) {
    case 'hardestCrane':
      return h.netMovesPerHour === null
        ? t('highlight.hardestCraneNoRate', { id: h.entity, moves: fmt.number(h.moves, 0) })
        : t('highlight.hardestCrane', { id: h.entity, moves: fmt.number(h.moves, 0), rate: fmt.movesPerHour(h.netMovesPerHour) })
    case 'busiestBlock':
      return t('highlight.busiestBlock', { block: h.entity, pct: fmt.percent(h.utilisationPct) })
    case 'busiestShc':
      return t('highlight.busiestShc', { id: h.entity, jobs: fmt.number(h.jobs, 0) })
    case 'longestWait':
      return t(`highlight.longestWait.${h.source}`, { id: h.entity, duration: fmt.duration(h.seconds) })
  }
}
