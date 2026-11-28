#!/usr/bin/env node
// Writes a spec and its tickets to files without their bodies passing through an agent's context, through
// `gh api -X GET search/issues` (allowed in cloud sessions; it returns issue bodies).
//
//   node scripts/fetch-issues.mjs <out-dir> <spec> [<ticket>...] [--repo owner/name]
//
// Writes `spec-<n>.md` and one `ticket-<n>.md` per ticket (`# #<n> <title>`, then the body) and prints one summary
// line per ticket with its `## Blocked by` issues, the same lines as scripts/tickets-from-sub-issues.mjs. With only the
// spec number it finds the tickets itself: issues that mention the spec in their body and name it in their `## Parent`
// section (the /to-tickets template), and says how many it found. The repo defaults to the `origin` remote's.
// Test: node --test scripts/test-fetch-issues.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitTickets } from './tickets-from-sub-issues.mjs'

/** The first issue number in the body's `## Parent` section (a ticket has one parent), or null. */
export function parentOf(body) {
  const m = /^## Parent\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(body ?? '')
  const n = m && /#(\d+)/.exec(m[1])
  return n ? Number(n[1]) : null
}

/** The issue with this number in a search response, or null. */
export function pickIssue(response, number) {
  return (response.items ?? []).find((i) => i.number === number) ?? null
}

/** The issues of a search response whose `## Parent` section names the spec, in number order. */
export function subIssuesOf(response, spec) {
  return (response.items ?? []).filter((i) => i.number !== spec && parentOf(i.body) === spec).sort((a, b) => a.number - b.number)
}

/** Writes spec-<n>.md and the ticket files; returns the ticket summary lines. */
export function writeIssues(outDir, spec, tickets) {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, `spec-${spec.number}.md`), `# #${spec.number} ${spec.title}\n\n${spec.body ?? ''}\n`)
  return splitTickets(tickets, outDir)
}

/** `owner/name` from an origin URL (https, ssh, or a proxy path ending in owner/name), or null. */
export function repoOfRemote(url) {
  const m = /[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url ?? '')
  return m ? `${m[1]}/${m[2]}` : null
}

/** One search request through gh; the response stays in this process. */
function search(q, page = 1) {
  const out = execFileSync('gh', ['api', '-X', 'GET', 'search/issues', '-f', `q=${q}`, '-f', 'per_page=100', '-f', `page=${page}`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return JSON.parse(out)
}

/** Every page of a search (the API stops at 1,000 results). */
function searchAll(q) {
  const items = []
  for (let page = 1; page <= 10; page++) {
    const r = search(q, page)
    items.push(...(r.items ?? []))
    if (items.length >= r.total_count || !(r.items ?? []).length) break
  }
  return { items }
}

function fetchOne(repo, n) {
  const issue = pickIssue(search(`repo:${repo} is:issue ${n}`), n)
  if (!issue) throw new Error(`issue #${n} not found in ${repo}`)
  return issue
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const ri = args.indexOf('--repo')
  const repoArg = ri >= 0 ? args.splice(ri, 2)[1] : null
  const [outDir, ...nums] = args
  const numbers = nums.map(Number)
  if (!outDir || !numbers.length || numbers.some((n) => !Number.isInteger(n) || n <= 0)) {
    console.error('usage: node scripts/fetch-issues.mjs <out-dir> <spec> [<ticket>...] [--repo owner/name]')
    process.exit(2)
  }
  let repo = repoArg
  if (!repo) {
    try {
      repo = repoOfRemote(execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim())
    } catch {
      repo = null
    }
  }
  if (!repo) {
    console.error('fetch-issues: no origin remote; pass --repo owner/name')
    process.exit(2)
  }
  const [specNo, ...ticketNos] = numbers
  try {
    let spec
    let tickets
    if (ticketNos.length) {
      spec = fetchOne(repo, specNo)
      tickets = ticketNos.map((n) => fetchOne(repo, n))
    } else {
      const found = searchAll(`repo:${repo} is:issue ${specNo}`)
      spec = pickIssue(found, specNo)
      if (!spec) throw new Error(`issue #${specNo} not found in ${repo}`)
      tickets = subIssuesOf(found, specNo)
      console.log(`fetch-issues: #${specNo} ${spec.title}: ${tickets.length} ticket${tickets.length === 1 ? '' : 's'} found (## Parent #${specNo})`)
    }
    for (const line of writeIssues(outDir, spec, tickets)) console.log(line)
    console.log(`fetch-issues: wrote spec-${specNo}.md and ${tickets.length} ticket file${tickets.length === 1 ? '' : 's'} to ${outDir}`)
  } catch (e) {
    console.error(`fetch-issues: ${e.message.split('\n')[0]}`)
    process.exit(1)
  }
}
