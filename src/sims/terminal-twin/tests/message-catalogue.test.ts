/**
 * String audit: every user-visible string of the sim's components comes from
 * the message catalogue (`i18n/messages.ts`), so translations can be added
 * later without touching components.
 *
 * Fails on, in any `.vue` file under the sim:
 * - template text containing letters (outside `{{ }}`);
 * - static user-facing attributes with letters (title, aria-label, placeholder, alt, label);
 * - string literals that read as UI text (two or more words, or one capitalised
 *   word) in `<script>` and in template expressions (`{{ }}`, `:attr`, `@event`).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'
import ts from 'typescript'
import { catalogues, t } from '../i18n/messages'

const SIM_DIR = fileURLToPath(new URL('..', import.meta.url))
const USER_FACING_ATTRS = new Set(['title', 'aria-label', 'placeholder', 'alt', 'label', 'aria-description'])
const HAS_LETTER = /\p{L}/u
const SENTENCE = /\p{L}{2,}[^\S\n]+\p{L}{2,}/u
const CAPITALISED_WORD = /^\p{Lu}\p{Ll}+…?$/u

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : vueFiles(p)
    return e.name.endsWith('.vue') ? [p] : []
  })
}

interface TemplateNode {
  type: number
  content?: string | { content: string }
  name?: string
  value?: { content: string } | undefined
  exp?: { content: string } | undefined
  props?: TemplateNode[]
  children?: TemplateNode[]
  loc: { start: { line: number } }
}

// @vue/compiler-core NodeTypes
const ELEMENT = 1
const TEXT = 2
const INTERPOLATION = 5
const ATTRIBUTE = 6
const DIRECTIVE = 7

/** A string literal that reads as UI text: two or more words, or a capitalised word ("Paused", "Start…"). */
function looksUserFacing(text: string): boolean {
  return SENTENCE.test(text) || CAPITALISED_WORD.test(text)
}

/** User-facing string literals in a TS/JS snippet, with their 0-based line offsets. */
function literalsIn(code: string): { text: string; line: number }[] {
  const sf = ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out: { text: string; line: number }[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
    const literal =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    if (literal && looksUserFacing(node.text)) {
      out.push({ text: node.text, line: sf.getLineAndCharacterOfPosition(node.getStart()).line })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** Hard-coded user-facing strings in one SFC, as `file:line kind "text"`. */
function auditSfc(file: string, source: string): string[] {
  const where = relative(SIM_DIR, file)
  const found: string[] = []
  const { descriptor } = parse(source, { filename: file })
  const expression = (code: string | undefined, line: number): void => {
    for (const lit of literalsIn(`(${code ?? ''})`)) found.push(`${where}:${line} expression "${lit.text}"`)
  }

  const walk = (node: TemplateNode): void => {
    const line = node.loc.start.line
    if (node.type === TEXT && typeof node.content === 'string' && HAS_LETTER.test(node.content)) {
      found.push(`${where}:${line} text "${node.content.trim()}"`)
    }
    if (node.type === INTERPOLATION && typeof node.content === 'object') expression(node.content.content, line)
    if (node.type === ELEMENT) {
      for (const prop of node.props ?? []) {
        const propLine = prop.loc.start.line
        if (prop.type === ATTRIBUTE && USER_FACING_ATTRS.has(prop.name ?? '') && HAS_LETTER.test(prop.value?.content ?? '')) {
          found.push(`${where}:${propLine} ${prop.name}="${prop.value?.content}"`)
        }
        if (prop.type === DIRECTIVE && prop.exp) expression(prop.exp.content, propLine)
      }
    }
    node.children?.forEach(walk)
  }
  if (descriptor.template?.ast) walk(descriptor.template.ast as unknown as TemplateNode)

  const script = descriptor.scriptSetup ?? descriptor.script
  if (script) {
    for (const lit of literalsIn(script.content)) {
      found.push(`${where}:${lit.line + script.loc.start.line} script "${lit.text}"`)
    }
  }
  return found
}

describe('message catalogue', () => {
  it('no hard-coded user-facing strings remain in the sim components', () => {
    const files = vueFiles(SIM_DIR)
    expect(files.length).toBeGreaterThan(0)
    const found = files.flatMap((f) => auditSfc(f, readFileSync(f, 'utf8')))
    expect(found, 'Move these strings to i18n/messages.ts and use t()').toEqual([])
  })

  it('the audit catches template text, user-facing attributes, expressions and script sentences', () => {
    const sample = `<script setup lang="ts">
import { t } from './x'
const ok = t('a.b')
const bad = 'Enter a date and time'
const label = computed(() => (ok ? 'Paused' : 'live-pill'))
</script>
<template>
  <button title="Pause now" class="speed-btn" :title="t('topbar.pause')">Run</button>
  <span :class="{ active: ok }">{{ ok }} ×{{ bad }} {{ loading ? 'Starting…' : t('setup.start') }}</span>
</template>`
    const found = auditSfc(join(SIM_DIR, 'Sample.vue'), sample).sort()
    expect(found).toEqual(
      [
        'Sample.vue:4 script "Enter a date and time"',
        'Sample.vue:5 script "Paused"',
        'Sample.vue:8 text "Run"',
        'Sample.vue:8 title="Pause now"',
        'Sample.vue:9 expression "Starting…"',
      ].sort(),
    )
  })

  it('t() fills placeholders and every catalogue has the same keys as English', () => {
    expect(t('twin.runStopped', { error: 'boom' })).toBe('Run stopped: boom')
    const keys = Object.keys(catalogues.en).sort()
    for (const messages of Object.values(catalogues)) expect(Object.keys(messages).sort()).toEqual(keys)
  })
})
