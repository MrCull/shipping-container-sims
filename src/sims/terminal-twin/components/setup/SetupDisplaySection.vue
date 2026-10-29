<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../../i18n/messages'
import { browserDisplayDefaults } from '../../i18n/display'
import { useSetupDraft } from '../../composables/useSetupDraft'
import { useTwinStore } from '../../store/twinStore'
import type { UnitSystem } from '../../scenario/types'

const d = useSetupDraft()
const store = useTwinStore()

/** Offered locales; the browser's and the current one are added if missing. */
const COMMON_LOCALES = ['en-GB', 'en-US', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'nl-NL', 'pt-BR', 'ja-JP', 'zh-CN']
const UNIT_SYSTEMS: UnitSystem[] = ['metric', 'imperial']
const browserLocale = browserDisplayDefaults(typeof navigator === 'undefined' ? [] : navigator.languages ?? []).locale

function localeName(tag: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}

const localeOptions = computed(() => {
  const tags = [...new Set([browserLocale, store.display.locale, ...COMMON_LOCALES])]
  return tags.map((tag) => {
    const name = `${localeName(tag)} · ${tag}`
    return { tag, label: tag === browserLocale ? t('setup.localeBrowser', { name }) : name }
  })
})

const preview = computed(() => {
  const fmt = store.fmt
  const sample = new Date(d.startDate ?? Date.now())
  const { date, time } = fmt.dateTime(sample)
  return t('setup.preview', { date, time, number: fmt.number(1234567.89, 2), weekStart: fmt.weekdayName(fmt.firstDayOfWeek()) })
})
</script>

<template>
  <fieldset class="field">
    <legend>{{ t('setup.display') }}</legend>
    <div class="row">
      <label class="field">
        <span>{{ t('setup.locale') }}</span>
        <select
          name="locale"
          data-testid="tt-locale"
          :value="store.display.locale"
          @change="store.setDisplay({ locale: ($event.target as HTMLSelectElement).value })"
        >
          <option
            v-for="o in localeOptions"
            :key="o.tag"
            :value="o.tag"
          >
            {{ o.label }}
          </option>
        </select>
      </label>
      <div
        class="field"
        role="radiogroup"
        :aria-label="t('setup.units')"
      >
        <span>{{ t('setup.units') }}</span>
        <label
          v-for="u in UNIT_SYSTEMS"
          :key="u"
          class="unit-choice"
        >
          <input
            type="radio"
            name="tt-units"
            :value="u"
            :checked="store.display.units === u"
            :data-testid="`tt-units-${u}`"
            @change="store.setDisplay({ units: u })"
          >
          {{ t(`setup.units.${u}`) }}
        </label>
      </div>
    </div>
    <p
      class="hint"
      data-testid="tt-display-preview"
    >
      {{ preview }}
    </p>
  </fieldset>
</template>

<style scoped src="./setupSection.css"></style>
