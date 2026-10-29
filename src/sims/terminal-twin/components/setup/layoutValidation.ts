/** Layout section: the scenario-start fields' validation message (null when valid). */
import { t } from '../../i18n/messages'
import type { SetupDraft } from '../../composables/useSetupDraft'

export function validateLayout(d: SetupDraft): string | null {
  if (!d.startDate) return t('setup.errorStart')
  if (!Number.isInteger(d.seed) || d.seed < 0) return t('setup.errorSeed')
  return null
}
