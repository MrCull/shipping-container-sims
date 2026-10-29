/**
 * `pnpm run tt:assets` — regenerates the phase 2 asset library from scratch:
 *   1. runs the Blender (bpy) generators headless into a temporary staging folder,
 *   2. post-processes each GLB with gltf-transform (meshopt geometry compression;
 *      textures are already WebP from the Blender exporter),
 *   3. replaces `assets/models/<group>/` with the result (GLBs, sidecars, atlas, previews).
 *
 * Options:
 *   --check          regenerate into a temp folder and compare with the committed files (exit 1 on any difference)
 *   --only <group>   regenerate one group only (containers | shc | asc | sts | trucks | vessels | infrastructure; repeatable); default all
 *   --no-previews    skip the Cycles previews (keeps the committed ones)
 *   --samples <n>    Cycles samples per preview (default 48)
 *   --python <exe>   Python with bpy (default: $TT_BPY_PYTHON, then python3.13 / python3 / python, or `py -3.13` on Windows)
 *
 * Works on Windows, macOS and Linux (no shell; paths via node:path).
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, meshopt, prune } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import {
  BAY_PITCH_M,
  BOW_M,
  HALF_OFFSET_M,
  QUAY_ABOVE_WATER_M,
  ROW_PITCH_M,
  TIER_PITCH_M,
  VESSEL_CLASSES,
} from '../../scenario/vesselClasses'
import { ASSETS_DIR, MODELS_DIR, runBudgetCli } from './budgetCheck'

const GENERATOR = join(ASSETS_DIR, 'generators', 'build.py')
const GROUPS = ['containers', 'shc', 'asc', 'sts', 'trucks', 'vessels', 'infrastructure']

/** What the hull generator needs from the engine's vessel model (so hulls are built on the engine's bay grid). */
function vesselClassTable() {
  return {
    classes: VESSEL_CLASSES,
    grid: {
      bayPitchM: BAY_PITCH_M,
      rowPitchM: ROW_PITCH_M,
      tierPitchM: TIER_PITCH_M,
      bowM: BOW_M,
      halfOffsetM: HALF_OFFSET_M,
      quayAboveWaterM: QUAY_ABOVE_WATER_M,
    },
  }
}

interface Options {
  only: string[]
  check: boolean
  previews: boolean
  samples: number
  python?: string
}

function parseArgs(argv: string[]): Options {
  const o: Options = { only: [], check: false, previews: true, samples: 48, python: process.env.TT_BPY_PYTHON }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--check') o.check = true
    else if (a === '--only') o.only.push(argv[++i])
    else if (a === '--no-previews') o.previews = false
    else if (a === '--samples') o.samples = Number(argv[++i])
    else if (a === '--python') o.python = argv[++i]
    else if (a === '--help') {
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0])
      process.exit(0)
    } else throw new Error(`Unknown argument ${a} (see --help)`)
  }
  return o
}

/** A Python command (exe + leading args) that can `import bpy`. */
function findPython(explicit?: string): string[] {
  const candidates: string[][] = explicit
    ? [[explicit]]
    : process.platform === 'win32'
      ? [['py', '-3.13'], ['python']]
      : [['python3.13'], ['python3'], ['python']]
  for (const c of candidates) {
    const r = spawnSync(c[0], [...c.slice(1), '-c', 'import bpy; print(bpy.app.version_string)'], { encoding: 'utf8' })
    if (r.status === 0) {
      console.log(`Using ${c.join(' ')} (bpy ${r.stdout.trim()})`)
      return c
    }
  }
  throw new Error(
    'No Python with bpy found. Create a venv with Python 3.13 and `pip install -r src/sims/terminal-twin/assets/generators/requirements.txt`, ' +
      'then pass --python <venv python> or set TT_BPY_PYTHON.',
  )
}

async function compress(src: string, dest: string): Promise<void> {
  await MeshoptEncoder.ready
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  })
  const doc = await io.read(src)
  await doc.transform(dedup(), prune({ keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  writeFileSync(dest, await io.writeBinary(doc))
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.')) // generator scratch (.work/)
    .flatMap((e) => (e.isDirectory() ? listFiles(join(dir, e.name)).map((f) => join(e.name, f)) : [e.name]))
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2))
  for (const g of opts.only) if (!GROUPS.includes(g)) throw new Error(`Unknown group ${g} (known: ${GROUPS.join(', ')})`)
  const groups = opts.only.length ? GROUPS.filter((g) => opts.only.includes(g)) : GROUPS
  const python = findPython(opts.python)
  const staging = mkdtempSync(join(tmpdir(), 'tt-assets-stage-'))
  const result = mkdtempSync(join(tmpdir(), 'tt-assets-out-'))
  try {
    const classesFile = join(staging, 'vessel-classes.json')
    writeFileSync(classesFile, JSON.stringify(vesselClassTable(), null, 2))
    const args = [...python.slice(1), GENERATOR, '--out', staging, '--samples', String(opts.samples), '--vessel-classes', classesFile]
    if (!opts.previews) args.push('--no-previews')
    for (const g of groups) args.push('--only', g)
    console.log('Generating with Blender…')
    const gen = spawnSync(python[0], args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 1 << 28 })
    for (const line of gen.stdout.split('\n')) if (line.startsWith('[') || line.startsWith('bpy')) console.log(`  ${line}`)
    if (gen.status !== 0) throw new Error(`Blender generator failed (exit ${gen.status})`)

    for (const group of groups) {
      const from = join(staging, group)
      const to = join(result, group)
      mkdirSync(to, { recursive: true })
      for (const file of listFiles(from)) {
        mkdirSync(join(to, file, '..'), { recursive: true })
        if (file.endsWith('.glb')) await compress(join(from, file), join(to, file))
        else cpSync(join(from, file), join(to, file))
      }
      if (!opts.previews) {
        const committed = join(MODELS_DIR, group, 'previews')
        if (existsSync(committed)) cpSync(committed, join(to, 'previews'), { recursive: true })
      }
    }

    if (opts.check) {
      const diffs: string[] = []
      for (const group of groups) {
        const a = listFiles(join(MODELS_DIR, group)).sort()
        const b = listFiles(join(result, group)).sort()
        for (const f of new Set([...a, ...b])) {
          const pa = join(MODELS_DIR, group, f)
          const pb = join(result, group, f)
          if (!existsSync(pa) || !existsSync(pb)) diffs.push(`${group}/${f}: only in ${existsSync(pa) ? 'committed' : 'regenerated'}`)
          else if (!readFileSync(pa).equals(readFileSync(pb))) diffs.push(`${group}/${f}: differs`)
        }
      }
      for (const d of diffs) console.log(`  ✗ ${d}`)
      console.log(diffs.length ? `Regeneration differs from the committed assets (${diffs.length} files)` : 'Regenerated assets are identical to the committed ones')
      return diffs.length ? 1 : 0
    }

    for (const group of groups) {
      const target = join(MODELS_DIR, group)
      rmSync(target, { recursive: true, force: true })
      cpSync(join(result, group), target, { recursive: true })
      for (const f of listFiles(target)) {
        console.log(`  wrote ${relative(process.cwd(), join(target, f))} (${(statSync(join(target, f)).size / 1024).toFixed(1)} KB)`)
      }
    }
    return runBudgetCli([])
  } finally {
    rmSync(staging, { recursive: true, force: true })
    rmSync(result, { recursive: true, force: true })
  }
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  },
)
