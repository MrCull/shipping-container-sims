import { createRouter, createWebHistory } from 'vue-router'
import HomePage from '@/pages/HomePage.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomePage,
    },
    {
      path: '/sim/:simId',
      name: 'sim',
      component: () => import('@/pages/SimPage.vue'),
      props: true,
    },
  ],
})
