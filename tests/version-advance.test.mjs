// Regression tests for the G3 bypass: adding an OLDER version beside an existing
// newer one was accepted, because the guard asked "is it older than the newest"
// instead of "did this change add it".
//
// Both entry points are covered, since they run different code:
//   check-pr.mjs  — the PR admission checker (checkOne's guard)
//   catalog.mjs   — `check --base <ref>`, which is what simulate-pr runs
//
// A real git repo is used: the whole rule is about what git reports as ADDED, so
// a mock would only assert the mock.
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { linkDirectory } from './support/link.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Two distinct member sets, so a second version is not rejected by G13. */
const MEMBERS_A = ['probe/alpha', 'probe/beta', 'probe/gamma']
const MEMBERS_B = ['probe/alpha', 'probe/beta', 'probe/delta']

/**
 * One submission document.
 *
 * The member set is a parameter because two versions of one bundle with an
 * IDENTICAL set are rejected by G13 — which is exactly how the original bug hid
 * during the first attempt at reproducing it.
 *
 * @param version - the version to stamp.
 * @param members - plugin refs for this version.
 * @returns the YAML.
 */
function submission(version, members = MEMBERS_A) {
  return `id: pkg
owner: 'probe'
version: ${version}
title:
  en: 'Probe'
summary:
  en: 'For the version-advance tests'
category:
  primary: productivity
members:
${members.map((ref) => `  - plugin: '${ref}'`).join('\n')}
`
}

let sandbox

/** Run a script in the sandbox; reports success plus combined output. */
function run(script, args) {
  return new Promise((resolve) => {
    execFile(
      'node',
      [join(sandbox, 'scripts', script), ...args],
      { cwd: sandbox, timeout: 90_000 },
      (error, stdout, stderr) => resolve({ ok: error === null, text: `${stdout}\n${stderr}` }),
    )
  })
}

const git = (...args) => execFileSync('git', args, { cwd: sandbox, encoding: 'utf8' })
const gitCommit = (message) => {
  git('add', '-A')
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message], { cwd: sandbox })
}

before(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'catalog-g3-'))
  await cp(join(repo, 'scripts'), join(sandbox, 'scripts'), { recursive: true })
  await cp(join(repo, 'schema'), join(sandbox, 'schema'), { recursive: true })
  await cp(join(repo, 'package.json'), join(sandbox, 'package.json'))
  await linkDirectory(join(sandbox, 'node_modules'), join(repo, 'node_modules'))
  // `node_modules` is a junction to the real tree; without this every `git add`
  // walks it and the commit carries the whole dependency set.
  await writeFile(join(sandbox, '.gitignore'), 'node_modules/\n', 'utf8')

  // A local index: the real one is a 15 MB download, and this test must not
  // depend on the network.
  await writeFile(join(sandbox, 'index.json'), JSON.stringify({
    plugins: [...MEMBERS_A, ...MEMBERS_B].map((ref) => ({
      owner: ref.split('/')[0], name: ref.split('/')[1],
      description: 'probe', stars: 5, default_branch: 'main',
      pushed_at: '2026-01-01T00:00:00Z', created_at: '2025-01-01T00:00:00Z',
      topics: [], capabilities: [],
    })),
  }), 'utf8')

  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: sandbox })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: sandbox })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: sandbox })
  await mkdir(join(sandbox, 'suites/probe/pkg'), { recursive: true })
  await writeFile(join(sandbox, 'suites/probe/pkg/1.0.0.yml'), submission('1.0.0'), 'utf8')
  gitCommit('base: 1.0.0')
})

after(async () => {
  await rm(sandbox, { recursive: true, force: true })
})

/**
 * Put the repo back on `main` and start a PR branch from it.
 *
 * The diff has to cross a branch boundary: committing straight onto `main` makes
 * `main...HEAD` empty, which is how the first version of this test asserted
 * nothing at all.
 *
 * @param branch - the branch name for this case.
 */
async function startPrBranch(branch) {
  git('checkout', '-q', 'main')
  git('reset', '-q', '--hard', 'main')
  // Drop any version files a previous case left behind.
  const { readdirSync } = await import('node:fs')
  for (const file of readdirSync(join(sandbox, 'suites/probe/pkg'))) {
    if (file !== '1.0.0.yml') rmSyncSafe(join(sandbox, 'suites/probe/pkg', file))
  }
  git('checkout', '-q', '-b', branch)
}

function rmSyncSafe(path) {
  try {
    rmSyncImpl(path)
  } catch { /* already gone */ }
}

import { rmSync as rmSyncImpl } from 'node:fs'

describe('G3 rejects an older version added beside a newer one', () => {
  it('check-pr --diff rejects a newly added 0.9.0', async () => {
    await startPrBranch('pr-older')
    await writeFile(join(sandbox, 'suites/probe/pkg/0.9.0.yml'), submission('0.9.0', MEMBERS_B), 'utf8')
    gitCommit('add 0.9.0 (should be rejected)')

    const result = await run('check-pr.mjs', ['--diff', '--base', 'main', '--index', 'index.json'])
    assert.equal(result.ok, false, `expected a rejection, got:\n${result.text}`)
    assert.match(result.text, /G3/u, result.text)
    assert.match(result.text, /must be greater than the existing 1\.0\.0/u, result.text)
  })

  it('catalog.mjs check --base rejects the same commit', async () => {
    // The same tree through the other entry point; `simulate-pr` runs this one.
    const result = await run('catalog.mjs', ['check', '--base', 'main', '--index', 'index.json'])
    assert.equal(result.ok, false, `expected a rejection, got:\n${result.text}`)
    assert.match(result.text, /G3/u, result.text)
  })

  it('an explicit path is treated as a submission, not as history', async () => {
    const result = await run('check-pr.mjs', ['suites/probe/pkg/0.9.0.yml', '--index', 'index.json'])
    assert.equal(result.ok, false, `expected a rejection, got:\n${result.text}`)
    assert.match(result.text, /G3/u, result.text)
  })
})

describe('the rule still allows what it exists for', () => {
  it('accepts a real upgrade (1.0.0 -> 1.0.1)', async () => {
    await startPrBranch('pr-upgrade')
    await writeFile(join(sandbox, 'suites/probe/pkg/1.0.1.yml'), submission('1.0.1', MEMBERS_B), 'utf8')
    gitCommit('add 1.0.1 (a real upgrade)')

    const diffCheck = await run('check-pr.mjs', ['--diff', '--base', 'main', '--index', 'index.json'])
    assert.equal(diffCheck.ok, true, `expected success, got:\n${diffCheck.text}`)

    const catalogCheck = await run('catalog.mjs', ['check', '--base', 'main', '--index', 'index.json'])
    assert.equal(catalogCheck.ok, true, `expected success, got:\n${catalogCheck.text}`)
  })

  it('--all accepts a tree that legitimately holds several versions', async () => {
    // History is not a submission: walking the whole tree must not demand that
    // every older file advance past the newest.
    await startPrBranch('pr-all')
    await writeFile(join(sandbox, 'suites/probe/pkg/0.9.0.yml'), submission('0.9.0', MEMBERS_B), 'utf8')

    const result = await run('check-pr.mjs', ['--all', '--index', 'index.json'])
    assert.equal(result.ok, true, `expected --all to accept history, got:\n${result.text}`)
  })
})
