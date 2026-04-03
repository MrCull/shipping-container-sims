import { createRouter, createWebHistory } from 'vue-router'
import HomePage from '@/pages/HomePage.vue'
import { trackPageView } from '@/utils/analytics'

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

router.afterEach((to) => {
  const path = typeof to.fullPath === 'string' ? to.fullPath : '/'
  const title = typeof document !== 'undefined' ? document.title : undefined
  trackPageView(path, title)
})
