<script setup lang="ts">
import boxEmpireLogo from '../../assets/logo.svg?url'

const emit = defineEmits<{
  start: []
  sandbox: []
}>()
</script>

<template>
  <div class="start-screen">
    <div class="start-modal">
      <div class="start-icon">
        <img
          :src="boxEmpireLogo"
          alt=""
          class="start-icon-img"
        >
      </div>
      <h1 class="start-title">
        Box Empire
      </h1>
      <p class="start-tagline">
        Build your shipping empire from a single container
      </p>
      <div class="start-description">
        <p>Learn the basics of container terminal operations:</p>
        <ul>
          <li>Manage truck arrivals through the gatehouse</li>
          <li>Store containers in the yard</li>
          <li>Load and discharge vessels</li>
          <li>Earn revenue from cargo handling</li>
        </ul>
      </div>
      <button
        class="start-btn"
        @click="emit('start')"
      >
        ▶ Start Tutorial
      </button>
      <button
        class="sandbox-btn"
        @click="emit('sandbox')"
      >
        ⚙ Sandbox Mode
      </button>
    </div>
  </div>
</template>

<style scoped>
.start-screen {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.85);
  z-index: 100;
}

.start-modal {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border: 2px solid var(--color-primary, #f59e0b);
  border-radius: 16px;
  padding: 40px 48px;
  max-width: 480px;
  text-align: center;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
}

.start-icon {
  margin-bottom: 12px;
  display: flex;
  justify-content: center;
}

.start-icon-img {
  width: 88px;
  height: 88px;
  object-fit: contain;
}

.start-title {
  font-family: var(--font-retro, monospace);
  font-size: 2rem;
  color: var(--color-primary, #f59e0b);
  margin: 0 0 8px 0;
  text-shadow: 0 2px 10px rgba(245, 158, 11, 0.3);
}

.start-tagline {
  font-family: var(--font-retro, monospace);
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.7);
  margin: 0 0 20px 0;
}

.start-description {
  text-align: left;
  margin-bottom: 24px;
}

.start-description p {
  font-family: var(--font-retro, monospace);
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.8);
  margin: 0 0 8px 0;
}

.start-description ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.start-description li {
  font-family: var(--font-retro, monospace);
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.65);
  padding: 3px 0 3px 16px;
  position: relative;
}

.start-description li::before {
  content: '▸';
  position: absolute;
  left: 0;
  color: var(--color-primary, #f59e0b);
}

.start-btn {
  padding: 12px 32px;
  border: 2px solid var(--color-primary, #f59e0b);
  border-radius: 8px;
  background: var(--color-primary, #f59e0b);
  color: #000;
  font-family: var(--font-retro, monospace);
  font-size: 1rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.start-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 20px rgba(245, 158, 11, 0.5);
}

.sandbox-btn {
  margin-top: 10px;
  padding: 10px 32px;
  border: 2px solid #3498db;
  border-radius: 8px;
  background: transparent;
  color: #5dade2;
  font-family: var(--font-retro, monospace);
  font-size: 0.88rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
  width: 100%;
}

.sandbox-btn:hover {
  background: rgba(52, 152, 219, 0.15);
  border-color: #5dade2;
  color: #fff;
}
</style>
