#!/usr/bin/env node
// Fail when a tracked Markdown file has a line longer than MAX_MD_LINE characters. Agents add to the same doc rows
// in parallel: one long line per topic makes every such pair of changes a merge conflict (spec #320 phase 2 hand-resolved
// four in terminal-twin-AGENTS.md and docs/agents/tooling.md). Split a long bullet into sub-bullets, one fact each, and
// move a long table cell into a section the row points to.
//
//   node scripts/check-md-line-length.mjs [file...]   (no files: every tracked *.md)
//
// Test: node --test scripts/test-check-md-line-length.mjs
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const MAX_MD_LINE = 1500

/** @returns {{ line: number, length: number }[]} the lines of `text` longer than `max` characters */
export function longLines(text, max = MAX_MD_LINE) {
  const out = []
  text.split('\n').forEach((l, i) => {
    if ([...l].length > max) out.push({ line: i + 1, length: [...l].length })
  })
  return out
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let files = process.argv.slice(2)
  if (!files.length) {
    const res = spawnSync('git', ['ls-files', '-z', '*.md'], { encoding: 'utf8', maxBuffer: 1 << 26 })
    if (res.status !== 0) {
      console.error(res.stderr || 'git ls-files failed')
      process.exit(1)
    }
    files = res.stdout.split('\0').filter(Boolean)
  }
  const bad = files.flatMap((f) => longLines(readFileSync(f, 'utf8')).map((l) => `${f}:${l.line} (${l.length} characters)`))
  if (bad.length) {
    console.error(`Markdown lines over ${MAX_MD_LINE} characters (split them; see the header of scripts/check-md-line-length.mjs):\n${bad.join('\n')}`)
    process.exit(1)
  }
}
