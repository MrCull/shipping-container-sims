<script setup lang="ts">
defineProps<{
  title: string
  loaded: string
  rehandles: string
}>()
</script>

<template>
  <header class="hud">
    <div class="brand">
      <span class="wordmark">YARDSHIFT</span>
      <span class="title">{{ title }}</span>
    </div>
    <dl class="stats">
      <div>
        <dt>LOADED</dt>
        <dd data-testid="ys-loaded">
          {{ loaded }}
        </dd>
      </div>
      <div>
        <dt>REHANDLES</dt>
        <dd data-testid="ys-rehandles">
          {{ rehandles }}
        </dd>
      </div>
    </dl>
  </header>
</template>

<style scoped>
.hud {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px;
  background: #142530;
  color: #e7eef2;
}
.brand {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.wordmark {
  color: #ffc85c;
  font-weight: 800;
  letter-spacing: 0.12em;
  font-size: 0.95rem;
}
.title {
  font-size: 0.75rem;
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stats {
  display: flex;
  gap: 16px;
  margin: 0;
}
.stats div {
  text-align: right;
}
dt {
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  opacity: 0.7;
}
dd {
  margin: 0;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
</style>
