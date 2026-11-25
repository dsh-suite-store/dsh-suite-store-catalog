/**
 * Nested field rules must hold in CI's validator, not just in check-pr.mjs.
 *
 * Each case was previously green under `catalog.mjs check` (the only validator
 * CI ran) while `check-pr.mjs` / the schema rejected it:
 *   - an extra key on `category`
 *   - an extra key on a `capabilityRedLines` item
 *   - a duplicated `requires` entry
 *
 * A real subprocess is used because the rule spans parse -> validate -> check.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'

import { linkDirectory } from './support/link.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/** A valid two-member submission; the case under test edits one fragment. */
function submission(extra) {
  return `id: pkg
owner: probe
version: 1.0.0
title:
  en: P
summary:
  en: S
category:
  primary: productivity${extra.category ?? ''}
members:
  - plugin: probe/alpha${extra.requires ?? ''}
  - plugin: probe/beta
  - plugin: probe/gamma
${extra.redline ?? ''}`
}

let sandbox

/** Run `catalog.mjs check` on the given submission. */
async function check(text) {
  await writeFile(join(sandbox, 'suites/probe/pkg/1.0.0.yml'), text, 'utf8')
  return new Promise((resolve) => {
    execFile(
      'node',
      [join(sandbox, 'scripts/catalog.mjs'), 'check', '--index', 'index.json'],
      { cwd: sandbox, timeout: 60_000 },
      (error, stdout, stderr) => resolve({ ok: error === null, text: `${stdout}\n${stderr}` }),
    )
  })
}

before(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'nested-schema-'))
  await cp(join(repo, 'scripts'), join(sandbox, 'scripts'), { recursive: true })
  await cp(join(repo, 'schema'), join(sandbox, 'schema'), { recursive: true })
  await cp(join(repo, 'package.json'), join(sandbox, 'package.json'))
  await linkDirectory(join(sandbox, 'node_modules'), join(repo, 'node_modules'))
  await writeFile(join(sandbox, 'index.json'), JSON.stringify({
    plugins: ['alpha', 'beta', 'gamma'].map((name) => ({
      owner: 'probe', name, description: 'p', stars: 5,
      default_branch: 'main', pushed_at: '2026-01-01T00:00:00Z',
      created_at: '2025-01-01T00:00:00Z', topics: [], capabilities: [],
    })),
  }), 'utf8')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(join(sandbox, 'suites/probe/pkg'), { recursive: true })
})

after(async () => {
  await rm(sandbox, { recursive: true, force: true })
})

describe('nested field rules run in CI', () => {
  it('accepts a clean submission', async () => {
    const result = await check(submission({}))
    assert.equal(result.ok, true, result.text)
  })

  it('rejects an unknown category key', async () => {
    const result = await check(submission({ category: '\n  evil: true' }))
    assert.equal(result.ok, false, `expected a rejection, got:\n${result.text}`)
    assert.match(result.text, /unsupported category field "evil"/u)
  })

  it('rejects an unknown key on a capability red line', async () => {
    const text = submission({
      redline: 'capabilityRedLines:\n  - text:\n      en: "No secrets in logs"\n    members: []\n    evil: true\n',
    })
    const result = await check(text)
    assert.equal(result.ok, false, `expected a rejection, got:\n${result.text}`)
    assert.match(result.text, /unsupported red-line field "evil"/u)
  })

  it('rejects a duplicated requires entry', async () => {
    const result = await check(submission({ requires: '\n    requires:\n      - probe/beta\n      - probe/beta' }))
    assert.equal(result.ok, false, `expected a rejection, got:\n${result.text}`)
    assert.match(result.text, /duplicate entries in requires/u)
  })

  it('rejects a duplicated member on a red line', async () => {
    // The schema declares uniqueItems on redline members; the validator only
    // checked that each member EXISTS, so a duplicate passed both CI and
    // check-pr and shipped as a duplicate edge/row.
    const text = submission({
      redline: 'capabilityRedLines:\n  - text:\n      en: "No secrets in logs"\n    members:\n      - probe/beta\n      - probe/beta\n',
    })
    const result = await check(text)
    assert.equal(result.ok, false, `expected a rejection, got:\n${result.text}`)
    assert.match(result.text, /duplicate entries in a red line/u)
  })
})
