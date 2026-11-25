/**
 * Two owners may not publish the same bundle id.
 *
 * The plugin rejects a document that repeats an id — "bundle id X appears more
 * than once" — because every per-id route (`?id=`) and every provenance claim
 * is keyed on it. So a collision is not a duplicate listing; it is a document
 * the client refuses to load, which empties the store for everyone.
 *
 * The check lived only in `buildCatalog`, which `check` never calls. A PR
 * adding `alice/same-id` and `bob/same-id` went green, merged, and broke the
 * release build afterwards. These tests pin the rule on the path a PR runs.
 */
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

import { linkDirectory } from './support/link.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

const MEMBERS_A = ['probe/alpha', 'probe/beta', 'probe/gamma']
const MEMBERS_B = ['probe/alpha', 'probe/beta', 'probe/delta']

/** One submission for a given owner/id. */
function submission(owner, id, members) {
  return `id: ${id}
owner: '${owner}'
version: 1.0.0
title:
  en: 'Probe'
summary:
  en: 'For the id-uniqueness tests'
category:
  primary: productivity
members:
${members.map((ref) => `  - plugin: '${ref}'`).join('\n')}
`
}

let sandbox

function run(args) {
  return new Promise((resolve) => {
    execFile(
      'node',
      [join(sandbox, 'scripts', 'catalog.mjs'), ...args],
      { cwd: sandbox, timeout: 90_000 },
      (error, stdout, stderr) => resolve({ ok: error === null, text: `${stdout}\n${stderr}` }),
    )
  })
}

before(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'catalog-id-'))
  await cp(join(repo, 'scripts'), join(sandbox, 'scripts'), { recursive: true })
  await cp(join(repo, 'schema'), join(sandbox, 'schema'), { recursive: true })
  await cp(join(repo, 'package.json'), join(sandbox, 'package.json'))
  await linkDirectory(join(sandbox, 'node_modules'), join(repo, 'node_modules'))
  await writeFile(join(sandbox, 'index.json'), JSON.stringify({
    plugins: [...MEMBERS_A, ...MEMBERS_B]
      .map((ref) => ref.split('/')[1])
      .filter((name, at, all) => all.indexOf(name) === at)
      .map((name) => ({
        owner: 'probe', name, description: 'probe', stars: 5,
        default_branch: 'main', pushed_at: '2026-01-01T00:00:00Z',
        created_at: '2025-01-01T00:00:00Z', topics: [], capabilities: [],
      })),
  }), 'utf8')
})

after(async () => {
  await rm(sandbox, { recursive: true, force: true })
})

describe('bundle ids are unique across owners', () => {
  it('passes when the ids differ', async () => {
    // The control: without it a rejection below could be any other gate.
    await rm(join(sandbox, 'suites'), { recursive: true, force: true })
    await mkdir(join(sandbox, 'suites/alice/one'), { recursive: true })
    await mkdir(join(sandbox, 'suites/bob/two'), { recursive: true })
    await writeFile(join(sandbox, 'suites/alice/one/1.0.0.yml'), submission('alice', 'one', MEMBERS_A), 'utf8')
    await writeFile(join(sandbox, 'suites/bob/two/1.0.0.yml'), submission('bob', 'two', MEMBERS_B), 'utf8')

    const result = await run(['check', '--index', 'index.json'])
    assert.equal(result.ok, true, result.text)
  })

  it('rejects two owners claiming the same id', async () => {
    await rm(join(sandbox, 'suites'), { recursive: true, force: true })
    await mkdir(join(sandbox, 'suites/alice/same-id'), { recursive: true })
    await mkdir(join(sandbox, 'suites/bob/same-id'), { recursive: true })
    await writeFile(join(sandbox, 'suites/alice/same-id/1.0.0.yml'), submission('alice', 'same-id', MEMBERS_A), 'utf8')
    await writeFile(join(sandbox, 'suites/bob/same-id/1.0.0.yml'), submission('bob', 'same-id', MEMBERS_B), 'utf8')

    const result = await run(['check', '--index', 'index.json'])
    assert.equal(result.ok, false, `expected a rejection, got:\n${result.text}`)
    assert.match(result.text, /share an id/u, result.text)
    // And it must name BOTH sides, or the author cannot tell which to rename.
    assert.match(result.text, /alice\/same-id/u, result.text)
    assert.match(result.text, /bob\/same-id/u, result.text)
  })

  it('rejects a single-file check that collides with an existing bundle', async () => {
    // The `check <path>` form only validates one file; the existing owner's
    // bundle is then only in the lenient sibling scan.
    await rm(join(sandbox, 'suites'), { recursive: true, force: true })
    await mkdir(join(sandbox, 'suites/alice/same-id'), { recursive: true })
    await mkdir(join(sandbox, 'suites/bob/same-id'), { recursive: true })
    await writeFile(join(sandbox, 'suites/alice/same-id/1.0.0.yml'), submission('alice', 'same-id', MEMBERS_A), 'utf8')
    await writeFile(join(sandbox, 'suites/bob/same-id/1.0.0.yml'), submission('bob', 'same-id', MEMBERS_B), 'utf8')

    const result = await run(['check', 'suites/bob/same-id/1.0.0.yml', '--index', 'index.json'])
    assert.equal(result.ok, false, `expected a rejection, got:\n${result.text}`)
    assert.match(result.text, /share an id/u, result.text)
  })
})
