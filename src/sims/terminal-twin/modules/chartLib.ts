/**
 * The tree-shaken Apache ECharts build used by the dashboard. This module must
 * only ever be reached through a dynamic `import('./chartLib')` (see
 * `tests/dashboard-lazy.test.ts`), so ECharts stays out of the initial bundle
 * and the 3D view's startup is not slowed.
 */
import * as echarts from 'echarts/core'
import { CustomChart, HeatmapChart, LineChart } from 'echarts/charts'
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  TransformComponent,
  VisualMapComponent,
} from 'echarts/components'
import { LabelLayout } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart,
  HeatmapChart,
  CustomChart,
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  TransformComponent,
  VisualMapComponent,
  LabelLayout,
  CanvasRenderer,
])

export { echarts }
export type { EChartsType } from 'echarts/core'
