#!/usr/bin/env node
/**
 * Report members that no longer exist (§6.5).
 *
 * Writes Markdown to stdout and NEVER edits `suites/`. Two reasons:
 *
 * 1. A member disappearing from npm can be a registry incident. Deleting it
 *    automatically would turn a five-minute outage into a permanent content
 *    change.
 * 2. The owner of a bundle is the person who knows whether to replace that
 *    member or drop the slot. A bot cannot make that call, and a silent edit
 *    removes the chance to ask.
 *
 * Exit code is always 0: a report that found problems is still a successful
 * job. Only an inability to produce the report is a failure.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { readSubmissions } from './build.mjs'
import { buildCatalogue, fetchIndex } from './catalogue.mjs'
import { readCategories } from './categories.mjs'

const root = resolve(import.meta.dirname, '..')
const TIMEOUT_MS = 8_000
/** Small on purpose: the registry throttles a wide fan-out. */
const PROBE_CONCURRENCY = 4

/**
 * The `owner/name` of a member's GitHub repository.
 *
 * `repo` is the link the sheet renders (`https://github.com/owner/name`), so the
 * API path is derived from it rather than from a separate field that could
 * disagree with the link. `repo` comes straight from the index, where it may be
 * a GitLab/Gitea/homepage URL, carry a subpath, or differ in case — probing
 * `api.github.com/repos/<not-owner/name>` answers 404, which would be reported
 * as the permanent, actionable state "gone" for a member that is fine.
 *
 * @param {unknown} repo - a member's `repo`.
 * @returns {string | undefined} `owner/name`, or undefined when it is not a
 *   GitHub repository URL.
 */
function githubRepoOf(repo) {
  // `…/owner/repo/tree/<branch>/<subpath>` names the repository before `/tree`:
  // the index stores monorepo subpaths that way.
  const match = /^https:\/\/github\.com\/([^/#?\s]+)\/([^/#?\s]+?)(?:\.git)?(?:[/?#].*)?$/u.exec(String(repo))
  return match === null ? undefined : `${match[1]}/${match[2]}`
}

/** An inconclusive probe: not proof that the member is gone. */
const UNREACHABLE = 'unreachable'

async function probe(url, headers = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'dsh-suite-store-catalog-decay', ...headers },
    })
    if (response.status === 404) return { state: 'gone' }
    // 403/429 on the GitHub API is the rate limit, not a missing repository:
    // the anonymous limit is 60 requests/hour per IP, which one CI runner can
    // exhaust. Reporting it as "gone" would tell owners to delete live members.
    if (response.status === 403 || response.status === 429) return { state: UNREACHABLE, rateLimited: true }
    if (!response.ok) return { state: UNREACHABLE }
    return { state: 'ok' }
  } catch {
    return { state: UNREACHABLE }
  } finally {
    clearTimeout(timer)
  }
}

// Decay reads the same resolved documents the build publishes, not the raw
// YAML: a raw member is only `plugin: owner/name`, which is nothing to probe.
//
// The index is loaded from the same two places the build accepts: an explicit
// `--index` for CI's cache, else the checkout's own copy, else the network. A
// decay run that cannot read the index reports everything as unreachable, which
// would be a false alarm rather than a finding.
const indexFlag = process.argv.indexOf('--index')
const indexPath = indexFlag === -1 ? undefined : process.argv[indexFlag + 1]
if (indexFlag !== -1 && (indexPath === undefined || indexPath.startsWith('--'))) {
  // Without this, `--index` last became `resolve(undefined)`, which throws a
  // TypeError about `paths[0]` instead of naming the flag.
  console.error('decay: --index needs a file path after it (--index <plugins.json>)')
  process.exit(2)
}
const catalogue = indexPath === undefined
  ? buildCatalogue((await fetchIndex()).index)
  : buildCatalogue(JSON.parse(await readFile(resolve(indexPath), 'utf8')))
const categories = await readCategories()
const byBundle = await readSubmissions(root, catalogue, categories)

/**
 * Probe every distinct member once, with bounded concurrency.
 *
 * Sequential probing with an 8s timeout meant a degraded registry could take
 * `members × 8s`. The concurrency stays small on purpose: catalogue.mjs
 * documents that too much parallelism makes the registry throttle.
 */
const TOKEN = process.env.GITHUB_TOKEN
const slots = []
for (const versions of byBundle.values()) {
  const newest = versions.at(-1)
  for (const member of newest.doc.members) {
    const github = typeof member.npm === 'string' && member.npm !== ''
      ? undefined
      : githubRepoOf(member.repo)
    slots.push({
      bundle: `${newest.owner}/${newest.id}`,
      slot: member.key,
      source: member.npm ?? member.repo,
      url: typeof member.npm === 'string' && member.npm !== ''
        ? `https://registry.npmjs.org/${encodeURIComponent(member.npm)}`
        : github === undefined ? undefined : `https://api.github.com/repos/${github}`,
    })
  }
}

const states = new Map()
const queue = [...new Set(slots.map((slot) => slot.url).filter((url) => url !== undefined))]
const AUTH = TOKEN === undefined ? {} : { authorization: `Bearer ${TOKEN}` }
const worker = async () => {
  while (queue.length > 0) {
    const url = queue.shift()
    states.set(url, await probe(url, url.startsWith('https://api.github.com/') ? AUTH : {}))
  }
}
await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, worker))

const rows = slots
  .map((slot) => ({
    ...slot,
    ...(slot.url === undefined ? { state: UNREACHABLE } : states.get(slot.url)),
  }))
  .filter((row) => row.state !== 'ok')
const limited = rows.filter((row) => row.rateLimited === true).length

const cell = (value) => String(value).replace(/\|/gu, '\\|').replace(/`/gu, "'")
const line = (row) => `| ${cell(row.bundle)} | \`${cell(row.slot)}\` | \`${cell(row.source)}\` | ${row.state} |`

process.stdout.write(`# 腐坏检测报告\n\n`)
process.stdout.write(`生成于 ${new Date().toISOString()}，检查 ${String(byBundle.size)} 个整合包。\n\n`)
if (limited > 0) {
  // One line for the whole run, not a per-member state: a rate limit is a
  // configuration problem (no GITHUB_TOKEN), not a fact about a member.
  process.stdout.write(`> 本次有 ${String(limited)} 个 GitHub 探测被限流（403/429）。设置环境变量 \`GITHUB_TOKEN\` 可提高额度；限流期间的探测结果不作数。\n\n`)
}

const gone = rows.filter((row) => row.state === 'gone')
if (gone.length === 0 && rows.length === 0) {
  process.stdout.write('所有成员都可达。无需处理。\n')
} else {
  if (gone.length > 0) {
    process.stdout.write(`## 已失效（${String(gone.length)}）\n\n`)
    process.stdout.write('成员在源上已不存在。请整合包 owner 替换或移除该槽位。\n\n')
    process.stdout.write('| 整合包 | 槽位 | 来源 | 状态 |\n|---|---|---|---|\n')
    for (const row of gone) process.stdout.write(`${line(row)}\n`)
    process.stdout.write('\n')
  }
  const unreachable = rows.filter((row) => row.state === UNREACHABLE)
  if (unreachable.length > 0) {
    process.stdout.write(`## 暂时无法确认（${String(unreachable.length)}）\n\n`)
    process.stdout.write('可能是网络、registry 抖动或 API 限流。**不需要处理**，下次检查会重新确认。\n\n')
    process.stdout.write('| 整合包 | 槽位 | 来源 | 状态 |\n|---|---|---|---|\n')
    for (const row of unreachable) process.stdout.write(`${line(row)}\n`)
  }
}
