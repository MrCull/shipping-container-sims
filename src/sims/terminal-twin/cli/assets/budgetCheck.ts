/**
 * Phase 2 asset budget check (`pnpm run tt:assets:check`, also a Vitest suite
 * and a PR CI step). Inspects every committed GLB under `assets/models/` and
 * its `.meta.json` sidecar: triangles and draw calls per LOD, file size,
 * required rig node names, sidecar fields, and the library total.
 * It never needs Blender.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readGlbJson, subtreeStats } from './glb'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ASSETS_DIR = join(HERE, '..', '..', 'assets')
export const MODELS_DIR = join(ASSETS_DIR, 'models')
export const BUDGETS_FILE = join(ASSETS_DIR, 'budgets.json')

export interface LodBudget {
  maxTriangles: number
  maxDrawCalls: number
}
export interface KindBudget {
  lods: Record<string, LodBudget>
  maxFileBytes: number
  requiredNodes: string[]
}
/** A named set of assets drawn together (a terminal's surroundings): the totals over all their LODs. */
export interface GroupBudget {
  assets: string[]
  maxTriangles: number
  maxDrawCalls: number
}
export interface Budgets {
  libraryMaxBytes: number
  groups?: Record<string, GroupBudget>
  requiredMetaFields: string[]
  kinds: Record<string, KindBudget>
}

export interface AssetReport {
  name: string
  file: string
  kind: string
  bytes: number
  lods: Record<string, { triangles: number; drawCalls: number }>
  problems: string[]
}

export interface LibraryReport {
  ok: boolean
  assets: AssetReport[]
  libraryBytes: number
  problems: string[]
}

export function loadBudgets(file = BUDGETS_FILE): Budgets {
  return JSON.parse(readFileSync(file, 'utf8')) as Budgets
}

function findGlbs(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...findGlbs(p))
    else if (entry.name.endsWith('.glb')) out.push(p)
  }
  return out.sort()
}

function checkAsset(file: string, budgets: Budgets): AssetReport {
  const name = basename(file, '.glb')
  const bytes = statSync(file).size
  const report: AssetReport = { name, file, kind: '?', bytes, lods: {}, problems: [] }
  const problem = (msg: string) => report.problems.push(`${name}: ${msg}`)

  const metaFile = file.replace(/\.glb$/, '.meta.json')
  if (!existsSync(metaFile)) {
    problem(`no sidecar (${basename(metaFile)})`)
    return report
  }
  const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as Record<string, unknown>
  for (const field of budgets.requiredMetaFields) {
    if (!(field in meta)) problem(`sidecar is missing "${field}"`)
  }
  report.kind = String(meta.kind ?? '?')
  const budget = budgets.kinds[report.kind]
  if (!budget) {
    problem(`unknown kind "${report.kind}" (add it to budgets.json)`)
    return report
  }
  if (bytes > budget.maxFileBytes) problem(`file is ${bytes} bytes (budget ${budget.maxFileBytes})`)

  const json = readGlbJson(file)
  const nodes = json.nodes ?? []
  const nodeNames = nodes.map((n) => n.name ?? '')
  for (const required of budget.requiredNodes) {
    if (!nodeNames.includes(required)) problem(`missing required node "${required}"`)
  }
  const documented = new Set(
    Array.isArray(meta.nodes) ? (meta.nodes as { name?: string }[]).map((n) => n.name) : [],
  )
  const roots = new Set(json.scenes?.[json.scene ?? 0]?.nodes ?? [])
  nodes.forEach((n, i) => {
    if (roots.has(i) || !n.name) return // the asset root is named after the asset
    if (!documented.has(n.name)) problem(`node "${n.name}" is not listed in the sidecar`)
  })

  for (const [lod, limit] of Object.entries(budget.lods)) {
    const index = nodeNames.indexOf(lod)
    if (index < 0) continue // reported above as a missing required node
    const stats = subtreeStats(json, index)
    report.lods[lod] = stats
    if (stats.triangles > limit.maxTriangles) problem(`${lod} has ${stats.triangles} triangles (budget ${limit.maxTriangles})`)
    if (stats.drawCalls > limit.maxDrawCalls) problem(`${lod} has ${stats.drawCalls} draw calls (budget ${limit.maxDrawCalls})`)
  }
  for (const ext of json.extensionsRequired ?? []) {
    if (ext === 'KHR_draco_mesh_compression' || ext === 'KHR_texture_basisu') {
      problem(`uses ${ext}; the pipeline is meshopt + WebP (no decoder is shipped for it)`)
    }
  }
  for (const b of json.buffers ?? []) if (b.uri) problem(`references an external buffer (${b.uri})`)
  for (const img of json.images ?? []) if (img.uri) problem(`references an external image (${img.uri})`)
  return report
}

export function checkAssetLibrary(dir = MODELS_DIR, budgets = loadBudgets()): LibraryReport {
  const assets = findGlbs(dir).map((f) => checkAsset(f, budgets))
  const libraryBytes = assets.reduce((s, a) => s + a.bytes, 0)
  const problems = assets.flatMap((a) => a.problems)
  if (libraryBytes > budgets.libraryMaxBytes) {
    problems.push(`library is ${libraryBytes} bytes (budget ${budgets.libraryMaxBytes})`)
  }
  for (const [group, limit] of Object.entries(budgets.groups ?? {})) {
    // A library that holds none of a group's assets (a partial or test library) has nothing to cap.
    if (!limit.assets.some((name) => assets.some((a) => a.name === name))) continue
    let triangles = 0
    let drawCalls = 0
    for (const name of limit.assets) {
      const asset = assets.find((a) => a.name === name)
      if (!asset) {
        problems.push(`group ${group}: no asset named "${name}"`)
        continue
      }
      for (const stats of Object.values(asset.lods)) {
        triangles += stats.triangles
        drawCalls += stats.drawCalls
      }
    }
    if (triangles > limit.maxTriangles) problems.push(`group ${group}: ${triangles} triangles (budget ${limit.maxTriangles})`)
    if (drawCalls > limit.maxDrawCalls) problems.push(`group ${group}: ${drawCalls} draw calls (budget ${limit.maxDrawCalls})`)
  }
  return { ok: problems.length === 0, assets, libraryBytes, problems }
}

const USAGE = `Usage: pnpm run tt:assets:check [-- --dir <models dir>] [--budgets <budgets.json>]
Checks every GLB + .meta.json sidecar against assets/budgets.json. Exit 0 ok, 1 over budget, 2 usage.`

export function runBudgetCli(argv: string[], print: (line: string) => void = console.log): number {
  let dir = MODELS_DIR
  let budgetsFile = BUDGETS_FILE
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir' && argv[i + 1]) dir = argv[++i]
    else if (a === '--budgets' && argv[i + 1]) budgetsFile = argv[++i]
    else {
      print(a === '--help' ? USAGE : `Unknown argument ${a}\n${USAGE}`)
      return a === '--help' ? 0 : 2
    }
  }
  const budgets = loadBudgets(budgetsFile)
  const report = checkAssetLibrary(dir, budgets)
  for (const a of report.assets) {
    const lods = Object.entries(a.lods)
      .map(([lod, s]) => `${lod} ${s.triangles} tris/${s.drawCalls} dc`)
      .join(', ')
    print(`${a.problems.length ? 'FAIL' : 'ok  '} ${a.name} [${a.kind}] ${(a.bytes / 1024).toFixed(1)} KB  ${lods}  (${relative(dir, a.file)})`)
  }
  print(`Library: ${report.assets.length} assets, ${(report.libraryBytes / 1024 / 1024).toFixed(2)} MB (budget ${(budgets.libraryMaxBytes / 1e6).toFixed(0)} MB)`)
  for (const p of report.problems) print(`  ✗ ${p}`)
  print(report.ok ? 'Budgets: pass' : `Budgets: FAIL (${report.problems.length} problems)`)
  return report.ok ? 0 : 1
}
