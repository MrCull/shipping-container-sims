<script setup lang="ts">
import { ref } from 'vue'
import { useJevStore } from '../../store/jevStore'
import { validateApiKey } from '../../modules/jev/jevClient'
import type { JevErrorKind } from '../../types/jev'

const jev = useJevStore()
const keyInput = ref('')
const showKey = ref(false)
const isValidating = ref(false)
const errorMessage = ref<string | null>(null)

function mapErrorMessage(kind: JevErrorKind, fallback: string): string {
  if (kind === 'auth') return 'Key not recognised'
  if (kind === 'network' || kind === 'timeout') return "Couldn't reach OpenRouter"
  return fallback
}

function resetAndClose(): void {
  keyInput.value = ''
  errorMessage.value = null
  showKey.value = false
  jev.closeKeyDialog()
}

function onCancel(): void {
  if (isValidating.value) return
  resetAndClose()
}

async function onVerify(): Promise<void> {
  if (isValidating.value || !keyInput.value.trim()) return
  errorMessage.value = null
  isValidating.value = true
  const result = await validateApiKey(keyInput.value)
  isValidating.value = false

  if (!result.ok) {
    errorMessage.value = mapErrorMessage(result.error.kind, result.error.message)
    return
  }

  jev.setKey(keyInput.value, result.limitRemaining)
  jev.enable()
  keyInput.value = ''
  showKey.value = false
  jev.closeKeyDialog()
}
</script>

<template>
  <div
    v-if="jev.isKeyDialogOpen"
    class="modal-overlay"
    @keydown.stop
    @keydown.esc="onCancel"
  >
    <div class="modal-content jev-key-dialog">
      <h2 class="dialog-title">
        Enable Jev assist
      </h2>
      <p class="dialog-copy">
        Jev (TypeSafe, via OpenRouter) is a decision model that can pick moves for you. It sees
        the rules, the ship and the cargo, and returns a choice with probabilities. It does not
        explain its choices.
      </p>

      <label
        class="field-label"
        for="jev-api-key"
      >OpenRouter API key</label>
      <div class="key-field">
        <input
          id="jev-api-key"
          v-model="keyInput"
          :type="showKey ? 'text' : 'password'"
          autocomplete="off"
          spellcheck="false"
          placeholder="sk-or-..."
          :disabled="isValidating"
          @keydown.enter="onVerify"
        >
        <button
          type="button"
          class="show-toggle"
          :disabled="isValidating"
          @click="showKey = !showKey"
        >
          {{ showKey ? 'Hide' : 'Show' }}
        </button>
      </div>
      <a
        class="key-link"
        href="https://openrouter.ai/keys"
        target="_blank"
        rel="noopener noreferrer"
      >
        Get an OpenRouter API key ↗
      </a>

      <ul class="disclosure">
        <li>Your key is kept only in this browser tab's memory. It is never saved, and it is cleared when you refresh or close the page.</li>
        <li>Each Jev move sends the current game state (no personal data) to OpenRouter/TypeSafe.</li>
        <li>Cost is charged to your OpenRouter account: roughly $0.0001–0.0004 per move (under $0.10 for the largest level) at current pricing.</li>
      </ul>

      <p
        v-if="errorMessage"
        class="error-message"
      >
        {{ errorMessage }}
      </p>

      <div class="dialog-actions">
        <button
          type="button"
          class="btn btn-secondary"
          :disabled="isValidating"
          @click="onCancel"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="isValidating || !keyInput.trim()"
          @click="onVerify"
        >
          {{ isValidating ? 'Verifying…' : 'Verify & enable' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.88);
  z-index: 200;
}

.modal-content.jev-key-dialog {
  background: linear-gradient(160deg, #0c1422 0%, #101c30 100%);
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: 14px;
  padding: 30px 34px 26px;
  width: min(440px, 92vw);
  box-shadow: 0 12px 50px rgba(0, 0, 0, 0.7);
  text-align: left;
}

.dialog-title {
  font-size: 18px;
  font-weight: bold;
  letter-spacing: 1px;
  color: #ffcc00;
  margin-bottom: 12px;
  text-transform: uppercase;
}

.dialog-copy {
  font-size: 12.5px;
  color: #bbb;
  line-height: 1.6;
  margin-bottom: 16px;
}

.field-label {
  display: block;
  font-size: 11px;
  color: #8f96a3;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.key-field {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}

.key-field input {
  flex: 1;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  padding: 9px 10px;
  color: #eee;
  font-size: 13px;
  font-family: var(--font-body, monospace);
}

.key-field input:focus {
  outline: none;
  border-color: #ffcc00;
}

.show-toggle {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  padding: 0 12px;
  color: #ccc;
  font-size: 11px;
  cursor: pointer;
}

.show-toggle:hover {
  border-color: #ffcc00;
}

.key-link {
  display: inline-block;
  font-size: 11px;
  color: #5cc8ff;
  text-decoration: none;
  margin-bottom: 16px;
}

.key-link:hover {
  text-decoration: underline;
}

.disclosure {
  list-style: none;
  padding: 0;
  margin: 0 0 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.disclosure li {
  position: relative;
  padding-left: 14px;
  font-size: 11px;
  color: #9aa3b0;
  line-height: 1.5;
}

.disclosure li::before {
  content: '•';
  position: absolute;
  left: 0;
  color: #ffcc00;
}

.error-message {
  font-size: 12px;
  color: #ff6a6a;
  background: rgba(255, 68, 68, 0.1);
  border: 1px solid rgba(255, 68, 68, 0.3);
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 14px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn {
  padding: 9px 22px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: bold;
  cursor: pointer;
  border: none;
  transition: opacity 0.15s, transform 0.1s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.08);
  color: #ccc;
  border: 1px solid rgba(255, 255, 255, 0.18);
}

.btn-secondary:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.35);
}

.btn-primary {
  background: linear-gradient(135deg, #ffcc00, #ff9900);
  color: #000;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
  transform: scale(1.02);
}
</style>
