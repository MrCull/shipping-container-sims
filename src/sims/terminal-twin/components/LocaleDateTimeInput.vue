<script setup lang="ts">
/**
 * Date and time entry in the chosen locale (V11-17). Replaces the browser's
 * `datetime-local` picker, which follows the browser's locale. The model is
 * the local ISO string (`YYYY-MM-DDTHH:mm[:ss]`); the field shows and parses
 * the locale's own format. Unparseable text emits '' (so required checks fail).
 */
import { computed, ref, watch } from 'vue'
import { useTwinStore } from '../store/twinStore'
import { dateInputPattern, formatDateInput, parseDateInput } from '../i18n/dateInput'
import { fromLocalInputValue, toLocalInputValue } from '../modules/time'
import { t } from '../i18n/messages'

const props = defineProps<{
  modelValue: string
  seconds?: boolean
  required?: boolean
  name?: string
  testId?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const store = useTwinStore()
const locale = computed(() => store.display.locale)
const placeholder = computed(() => dateInputPattern(locale.value, props.seconds))

function shown(): string {
  const d = props.modelValue ? fromLocalInputValue(props.modelValue) : null
  return d ? formatDateInput(d, locale.value, props.seconds) : ''
}

const text = ref(shown())
const invalid = ref(false)

// Re-render when the model or the locale changes (not while the text is being typed).
let lastEmitted: string | null = null
function emitValue(value: string): void {
  lastEmitted = value
  emit('update:modelValue', value)
}
watch(() => props.modelValue, (v) => {
  if (v === lastEmitted) return
  text.value = shown()
  invalid.value = false
})
watch([locale, () => props.seconds], () => {
  text.value = shown()
  invalid.value = false
})

function commit(): void {
  const raw = text.value.trim()
  if (raw === '') {
    invalid.value = props.required === true
    emitValue('')
    return
  }
  const d = parseDateInput(raw, locale.value, props.seconds)
  invalid.value = d === null
  if (d) {
    const value = toLocalInputValue(d, props.seconds)
    emitValue(value)
    text.value = formatDateInput(d, locale.value, props.seconds)
  } else {
    emitValue('')
  }
}
</script>

<template>
  <input
    v-model="text"
    type="text"
    class="locale-datetime"
    inputmode="numeric"
    autocomplete="off"
    spellcheck="false"
    :name="name"
    :required="required"
    :placeholder="placeholder"
    :aria-invalid="invalid || undefined"
    :aria-description="t('dateInput.hint', { pattern: placeholder })"
    :title="t('dateInput.hint', { pattern: placeholder })"
    :data-testid="testId"
    :data-locale="locale"
    @change="commit"
    @blur="commit"
    @keydown.enter="commit"
  >
</template>

<style scoped>
.locale-datetime {
  padding: 0.45rem 0.6rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text);
  font-family: var(--tt-font-mono);
  min-width: 0;
  width: 100%;
}

.locale-datetime[aria-invalid='true'] {
  border-color: var(--color-danger, #e5484d);
  outline: 1px solid var(--color-danger, #e5484d);
}
</style>
