#!/usr/bin/env node
// Splits a saved GitHub MCP `issue_read` `get_sub_issues` result into one `ticket-<n>.md` per sub-issue and prints
// one line per ticket: number, state, title and the issues named in its `## Blocked by` section (the frontier view).
// The MCP result is often too large for context (56 KB for spec #356) and is saved to a file; read it with this.
// Usage: node scripts/tickets-from-sub-issues.mjs <saved-result.json> <out-dir>
// Test: node --test scripts/test-tickets-from-sub-issues.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The sub-issue array from a raw array, or from the MCP wrapper `[{ type: 'text', text: '<json array>' }]`. */
export function parseSubIssues(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (Array.isArray(data) && data[0]?.type === 'text' && typeof data[0].text === 'string') return JSON.parse(data[0].text)
  if (Array.isArray(data)) return data
  throw new Error('expected a sub-issue array or an MCP text wrapper around one')
}

/** Issue numbers named in the body's `## Blocked by` section (up to the next heading); [] when it says none. */
export function blockersOf(body) {
  const m = /^## Blocked by\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(body ?? '')
  if (!m) return []
  return [...new Set([...m[1].matchAll(/#(\d+)/g)].map((x) => Number(x[1])))]
}

/** Writes the ticket files and returns the summary lines. */
export function splitTickets(issues, outDir) {
  mkdirSync(outDir, { recursive: true })
  return issues.map((i) => {
    writeFileSync(join(outDir, `ticket-${i.number}.md`), `# #${i.number} ${i.title}\n\n${i.body ?? ''}\n`)
    const b = blockersOf(i.body)
    return `#${i.number} ${i.state} ${i.title} | blocked by: ${b.length ? b.map((n) => `#${n}`).join(', ') : 'none'}`
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, outDir] = process.argv.slice(2)
  if (!file || !outDir) {
    console.error('usage: node scripts/tickets-from-sub-issues.mjs <saved-result.json> <out-dir>')
    process.exit(2)
  }
  for (const line of splitTickets(parseSubIssues(readFileSync(file, 'utf8')), outDir)) console.log(line)
}
