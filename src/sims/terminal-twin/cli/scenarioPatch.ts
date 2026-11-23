/**
 * JSON Merge Patch (RFC 7396) on a scenario, shared by `tt:run --patch` and experiment configs' `patch`, so an
 * experiment replicate's `tt:run` command line reproduces it exactly.
 */
import { existsSync, readFileSync } from 'node:fs'

const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** JSON Merge Patch (RFC 7396): objects merge key by key, `null` deletes, anything else replaces. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch
  const out: Record<string, unknown> = isPlainObject(target) ? { ...target } : {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else out[k] = mergePatch(out[k], v)
  }
  return out
}

/** A `--patch` argument: inline JSON (starts with `{`) or a JSON file; throws with a readable message. */
export function readPatchArg(arg: string): Record<string, unknown> {
  const text = arg.trimStart().startsWith('{') ? arg : existsSync(arg) ? readFileSync(arg, 'utf8') : null
  if (text === null) throw new Error(`Bad --patch "${arg}" (a JSON object, or a JSON file that holds one)`)
  let patch: unknown
  try {
    patch = JSON.parse(text)
  } catch (err) {
    throw new Error(`Bad --patch "${arg}": ${(err as Error).message}`, { cause: err })
  }
  if (!isPlainObject(patch)) throw new Error(`Bad --patch "${arg}" (must be a JSON object)`)
  return patch
}

/** Quote one word for a POSIX shell (single quotes; a `'` becomes `'\''`). */
export const shellQuote = (word: string) => `'${word.replace(/'/g, `'\\''`)}'`
