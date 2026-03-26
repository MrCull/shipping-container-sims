<script setup lang="ts">
defineProps<{ stars: number }>()
</script>

<template>
  <div class="star-rating">
    <span
      v-for="i in 5"
      :key="i"
      class="star"
      :class="{ filled: i <= stars }"
    >&#9733;</span>
  </div>
</template>

<style scoped>
.star-rating {
  display: flex;
  gap: 4px;
  justify-content: center;
}
.star {
  font-size: 32px;
  color: #444;
  transition: color 0.3s;
}
.star.filled {
  color: #ffcc00;
  text-shadow: 0 0 8px rgba(255, 204, 0, 0.5);
}
</style>
