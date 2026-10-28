<script setup lang="ts">
/**
 * Dev-only asset viewer (`/sim/terminal-twin?viewer=<asset>` or `?viewer=yard`).
 * Shows one GLB with LOD switching, rig sliders from its sidecar, livery
 * selection and a 20 ft reference box; installs `window.__ttAssets`.
 */
import { markRaw, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { t } from '../i18n/messages'
import { LIVERY_ATLAS } from '../modules/containerAssets'
import { ASSETS, AssetViewerScene } from './assetViewerScene'
import type { AssetViewerApi, AssetViewStats, ViewerLod, YardStats } from './assetViewerApi'

const props = defineProps<{ initial: string }>()

const host = ref<HTMLElement | null>(null)
const stats = shallowRef<AssetViewStats | null>(null)
const yardStats = shallowRef<YardStats | null>(null)
const ready = ref(false)
const error = ref<string | null>(null)
const selected = ref(props.initial)
let view: AssetViewerScene | null = null
let observer: ResizeObserver | null = null

const names = ASSETS.map((a) => a.name)
const liveries = LIVERY_ATLAS.liveries

async function open(name: string): Promise<void> {
  if (!view) return
  ready.value = false
  error.value = null
  try {
    if (name === 'yard') {
      stats.value = null
      yardStats.value = await view.yard()
    } else {
      yardStats.value = null
      stats.value = await view.show(name)
    }
    selected.value = name
    ready.value = true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.includes('superseded')) error.value = msg
  }
}

function setLod(lod: ViewerLod): void {
  if (view) stats.value = view.setLod(lod)
}
function setLivery(e: Event): void {
  if (view) stats.value = view.setLivery(Number((e.target as HTMLSelectElement).value))
}
function setRig(node: string, e: Event): void {
  if (view) stats.value = view.setRig(node, Number((e.target as HTMLInputElement).value))
}

onMounted(() => {
  if (!host.value) return
  view = markRaw(new AssetViewerScene(host.value))
  observer = new ResizeObserver(() => host.value && view?.resize(host.value))
  observer.observe(host.value)
  const api: AssetViewerApi = {
    list: () => [...names],
    async show(name, options = {}) {
      if (!view) throw new Error(t('assetViewer.notMounted'))
      yardStats.value = null
      const s = await view.show(name, options)
      selected.value = name
      ready.value = true
      stats.value = s
      return s
    },
    setLod: (lod) => (stats.value = view!.setLod(lod)),
    setLivery: (i) => (stats.value = view!.setLivery(i)),
    setRig: (node, v) => (stats.value = view!.setRig(node, v)),
    stats: () => view?.stats() ?? null,
    async yard(count) {
      stats.value = null
      const s = await view!.yard(count)
      yardStats.value = s
      selected.value = 'yard'
      ready.value = true
      return s
    },
  }
  window.__ttAssets = api
  void open(props.initial && (props.initial === 'yard' || names.includes(props.initial)) ? props.initial : names[0])
})

onBeforeUnmount(() => {
  observer?.disconnect()
  view?.dispose()
  view = null
  delete window.__ttAssets
})
</script>

<template>
  <div
    class="viewer"
    :data-viewer-ready="ready ? selected : undefined"
  >
    <div
      ref="host"
      class="canvas-host"
    />
    <aside class="panel">
      <h2>{{ t('assetViewer.title') }} <span class="dev">{{ t('assetViewer.devBadge') }}</span></h2>
      <label>
        {{ t('assetViewer.asset') }}
        <select
          :value="selected"
          @change="open(($event.target as HTMLSelectElement).value)"
        >
          <option
            v-for="n in names"
            :key="n"
            :value="n"
          >{{ n }}</option>
          <option value="yard">
            {{ t('assetViewer.yardOption') }}
          </option>
        </select>
      </label>
      <p
        v-if="error"
        class="error"
      >
        {{ error }}
      </p>
      <template v-if="stats">
        <div class="row">
          <button
            v-for="lod in [...Object.keys(stats.lods), 'auto'] as ViewerLod[]"
            :key="lod"
            :class="{ on: stats.lod === lod }"
            @click="setLod(lod)"
          >
            {{ lod }}
          </button>
        </div>
        <label v-if="stats.kind === 'container'">
          {{ t('assetViewer.livery') }}
          <select
            :value="stats.livery"
            @change="setLivery"
          >
            <option
              v-for="l in liveries"
              :key="l.index"
              :value="l.index"
            >
              {{ t('assetViewer.liveryOption', { index: l.index, line: l.line ?? t('assetViewer.genericLivery') }) }}
            </option>
          </select>
        </label>
        <label
          v-for="rig in stats.rig"
          :key="rig.node"
        >
          {{ t('assetViewer.rigLabel', { node: rig.node, axis: rig.axis, unit: rig.unit }) }} <span class="mono">{{ stats.rigValues[rig.node] }}</span>
          <input
            type="range"
            :min="rig.min"
            :max="rig.max"
            :step="rig.unit === 'deg' ? 1 : 0.05"
            :value="stats.rigValues[rig.node]"
            @input="setRig(rig.node, $event)"
          >
        </label>
        <dl>
          <dt>{{ t('assetViewer.showing') }}</dt><dd class="mono">
            {{ stats.shownLod }}
          </dd>
          <dt>{{ t('assetViewer.triangles') }}</dt><dd class="mono">
            {{ stats.triangles }}
          </dd>
          <dt>{{ t('assetViewer.drawCalls') }}</dt><dd class="mono">
            {{ stats.drawCalls }}
          </dd>
          <template
            v-for="(l, name) in stats.lods"
            :key="name"
          >
            <dt>{{ name }}</dt><dd class="mono">
              {{ t('assetViewer.lodCost', { triangles: l.triangles, drawCalls: l.drawCalls }) }}
            </dd>
          </template>
        </dl>
        <p class="hint">
          {{ t(stats.kind === 'shc' ? 'assetViewer.referenceHintShc' : 'assetViewer.referenceHint') }}
        </p>
      </template>
      <dl v-if="yardStats">
        <dt>{{ t('assetViewer.instances') }}</dt><dd class="mono">
          {{ yardStats.instances }}
        </dd>
        <dt>{{ t('assetViewer.lodSplit') }}</dt><dd class="mono">
          {{ t('assetViewer.lodSplitValue', { lod0: yardStats.lod0, lod1: yardStats.lod1 }) }}
        </dd>
        <dt>{{ t('assetViewer.containerTriangles') }}</dt><dd class="mono">
          {{ yardStats.containerTriangles }}
        </dd>
        <dt>{{ t('assetViewer.frameDrawCalls') }}</dt><dd class="mono">
          {{ yardStats.drawCalls }}
        </dd>
        <dt>{{ t('assetViewer.frameTriangles') }}</dt><dd class="mono">
          {{ yardStats.triangles }}
        </dd>
        <dt>{{ t('assetViewer.fps') }}</dt><dd class="mono">
          {{ yardStats.fps }}
        </dd>
      </dl>
    </aside>
  </div>
</template>

<style scoped>
.viewer {
  position: relative;
  flex: 1;
  display: flex;
  min-height: calc(100vh - 52px);
}
.canvas-host {
  flex: 1;
  position: relative;
}
.canvas-host :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}
.panel {
  position: absolute;
  top: 12px;
  left: 12px;
  width: 260px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: color-mix(in srgb, var(--color-bg-card) 92%, transparent);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-text);
  font: 13px var(--font-body);
}
h2 {
  margin: 0;
  font-size: 15px;
}
.dev {
  font-size: 11px;
  color: var(--color-accent);
}
label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--color-text-muted);
}
select,
button {
  font: inherit;
  color: var(--color-text);
  background: var(--color-bg-card-hover);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 4px 6px;
}
.row {
  display: flex;
  gap: 6px;
}
button.on {
  border-color: var(--color-primary);
  background: var(--color-primary);
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  margin: 0;
}
dt {
  color: var(--color-text-muted);
}
dd {
  margin: 0;
}
.mono {
  font-family: ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace;
}
.hint {
  margin: 0;
  color: var(--color-text-muted);
}
.error {
  color: var(--color-danger);
}
</style>
